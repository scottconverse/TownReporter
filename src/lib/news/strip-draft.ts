const NOTEBOOK =
  /^\s*(next checks? are|next check is|still to (pull|check|verify|review)|documents still to|follow[- ]up reporting|we should (look|check|pull)|reporter still needs)\b/i;
const SCOREKEEPING =
  /^\s*(\*{0,2}\s*)?(what is solid|what is not solid|confirmed from|still unknown|not solid yet|from local headlines)\b/i;
const TRAILER =
  /\*{0,2}\s*(What is solid\b|What is not solid\b|Next checks? are\b|Next check is\b|Still to pull\b)/i;
/*
  The notebook, written as prose. The line rules above miss the case where the model
  turns its own to-do list into a sentence: "TownReporter has not yet opened the Aug. 25
  agenda item, meeting packet, minutes…". That names the newsroom where the story should
  name the city, and the desk does not print it.

  Scope is deliberately this narrow. The editor does print unknowns phrased against the
  record ("the size of the funding pool is not stated in the pages reviewed") and does
  print "what remains unclear from the captured feed is…", so both stay. Only the paper's
  own open tabs go.
*/
export const PROCESS_NARRATION =
  /\b(?:townreporter|the newsroom)\b[^.!?]{0,60}\b(?:has|have)\s+not\b|\bthis (?:story|piece|article|report)\b[^.!?]{0,60}\b(?:has|have)\s+not\b/i;

/** Abbreviations whose period ends a word, not a sentence — "St. Vrain", "U.S. 287". */
const ABBREVIATION =
  "Mr|Mrs|Ms|Dr|Prof|Rev|Sen|Rep|Gov|St|Mt|Ft|Inc|Co|Ltd|Corp|Jr|Sr|vs|etc|No|Est|Ave|Blvd|Rd|Hwy|U\\.S|a\\.m|p\\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";

const SENTENCE_SPLIT = new RegExp(
  `(?<=[.!?]["”'’)]?)(?<!\\b(?:${ABBREVIATION})\\.)\\s+(?=[A-Z"“([])`,
);

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/*
  These phrases are editor checks when they describe what a notice or record
  leaves unstated. They can help the editor, but they are not reader-facing
  headline or dek copy. Keep the patterns tied to source material or an
  explicitly missing date/time/schedule; ordinary reporting about what a city
  did or did not decide is still news.
*/
const MISSING_FACT_NOTE = [
  /\b(?:notice|announcement|document|materials?|record|source)\b[^.!?]{0,100}\b(?:(?:does not|doesn't|did not|didn't|has not|have not|had not)\s+(?:state|say|specify|identify|list|provide|give|include|name|confirm|mention)|fails?\s+to\s+(?:state|say|specify|identify|list|provide|give|include|name|confirm|mention))\b/i,
  /\b(?:does not|doesn't|did not|didn't|has not|have not|had not)\s+(?:state|say|specify)\b/i,
  /\b(?:year|date|time|schedule|start date|end date|deadline|duration|location)\b[^.!?]{0,60}\b(?:(?:is|are|was|were|remains?)\s+)?(?:not\s+(?:stated|specified|identified|listed|given|provided|included|named|confirmed)|unstated|unspecified|unidentified|unlisted)\b/i,
  /\bno\s+(?:year|date|time|schedule|start date|end date|deadline|duration|location)\b[^.!?]{0,60}\b(?:is|are|was|were)?\s*(?:stated|specified|identified|listed|given|provided|included|named|confirmed)\b/i,
  /^\s*not\s+(?:specified|stated|identified|listed|given|provided|included|confirmed)(?:\s+(?:in|from)\s+(?:the\s+)?(?:notice|announcement|document|materials?|record|source|schedule))?\s*[.!?]*$/i,
  /\b(?:unclear|not clear)\s+from\s+(?:the\s+)?(?:notice|announcement|document|materials?|record|source|schedule)\b/i,
];

function cleanSummaryField(text: string): { text: string; notes: string[] } {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { text, notes: [] };
  const sentences = splitSentences(normalized);
  const notes = sentences.filter((sentence) => MISSING_FACT_NOTE.some((pattern) => pattern.test(sentence)));
  if (!notes.length) return { text, notes: [] };
  const noteSet = new Set(notes);
  return {
    text: sentences.filter((sentence) => !noteSet.has(sentence)).join(" "),
    notes,
  };
}

/** Remove missing-fact editor notes from reader-facing fields and retain them for editor checks. */
export function cleanMissingFactNotes(headline: string, dek: string): {
  headline: string;
  dek: string;
  notes: string[];
} {
  const cleanHeadline = cleanSummaryField(headline);
  const cleanDek = cleanSummaryField(dek);
  let cleaned = cleanHeadline.notes.length ? cleanHeadline.text.replace(/[.!?]+$/, "") : cleanHeadline.text;
  /*
    A headline that is nothing but a missing-fact note cleans to "" -- and a
    story with no headline is worse for the reader than a headline carrying an
    editor check. Fall back to the headline as written; the note is still kept
    in `notes` for the editor. Measured Oct 13 2026 (PR298-2): 0 of 157 live
    stories hit this, so it is a guard, not a cleanup.
  */
  if (cleanHeadline.notes.length && !/[\p{L}\p{N}]/u.test(cleaned)) cleaned = headline;
  return {
    headline: cleaned,
    dek: cleanDek.text,
    notes: [...new Set([...cleanHeadline.notes, ...cleanDek.notes])],
  };
}

/** Add removed summary notes to integrity checks without repeating existing notes. */
export function appendEditorChecks(existing: string | null | undefined, additions: readonly string[]): string {
  const current = String(existing ?? "").trim();
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const known = normalize(current);
  const missing = [...new Set(additions.map((note) => note.trim()).filter(Boolean))].filter(
    (note) => !known.includes(normalize(note)),
  );
  return [current, ...missing].filter(Boolean).join("\n");
}

/**
 * Drop the paper's own backlog from a paragraph. A paragraph that opens on it is
 * homework top to bottom and goes. Inside a sentence, the backlog is either the whole
 * clause ("TownReporter has not opened that story.") and the sentence goes with it, or
 * a clause tacked onto real reporting ("…neither item states the date, and TownReporter
 * has not yet opened the record.") and only the tail goes. Where it is woven through a
 * clause with nothing to cut on, the sentence is left alone for the editor.
 */
function stripProcessNarration(paragraph: string): string {
  const sentences = splitSentences(paragraph.replace(/\s+/g, " "));
  const hit = (s: string): number => {
    const m = PROCESS_NARRATION.exec(s);
    return m ? m.index : -1;
  };
  if (!sentences.some((s) => hit(s) >= 0)) return paragraph;
  if (hit(sentences[0]) === 0) return "";
  return sentences
    .map((s) => {
      const at = hit(s);
      if (at < 0) return s;
      if (at <= 3) return "";
      const before = s.slice(0, at);
      if (!/[,;:—–]\s+(?:and\s+)?$/.test(before)) return s;
      const trimmed = before.replace(/[,;:—–]\s+(?:and\s+)?$/, "").trim();
      if (trimmed.length < 20) return "";
      return /[.!?]["”'’]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
    })
    .filter(Boolean)
    .join(" ");
}

function isNotebookLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return NOTEBOOK.test(t) || SCOREKEEPING.test(t.replace(/^\*+\s*/, ""));
}

/** Drop the reporter's own to-dos — list lines and prose sentences — from the story. */
export function stripReporterNotebook(body: string): string {
  return stripNotebook(body, YEAR_NOTE);
}

/** What readers are shown: the same cut, plus the wordings a public page printed (TPT-3). */
export function stripReaderNotebook(body: string, writtenOn: Date = new Date()): string {
  return stripNotebook(body, READER_YEAR_NOTE, writtenOn);
}

function stripNotebook(body: string, yearNote: RegExp, writtenOn: Date = new Date()): string {
  const marker = body.search(TRAILER);
  const cut = marker >= 0 ? body.slice(0, marker) : body;
  return cut
    .split(/\n{2,}/)
    .map((p) => {
      const cleaned = p
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line && !isNotebookLine(line))
        .join("\n")
        .trim();
      if (!cleaned) return "";
      return stripYearNotesFromParagraph(stripProcessNarration(cleaned), writtenOn, yearNote).trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/*
  Scott, Oct 11 2026: a story never tells readers that a source "does not
  specify the year". A listing that says "Thursday, Oct. 15" in October means
  this October; saying otherwise makes the paper look dumb and treats the
  reader as dumb. The one exception is the turn of the year: a story written
  in December about a date in January or February, where the year can really
  be in doubt. There the sentence stays.
*/
const YEAR_NOTE =
  /\b(?:(?:does not|doesn't|did not|didn't|do not|don't|fails? to)\s+(?:state|specify|say|give|list|include|provide|name|identify)\s+(?:the|a|an|which|what)\s+(?:[\w-]+\s+){0,2}year|(?:year|years)\b[^.!?;]{0,60}\b(?:(?:is|are|was|were|remains?)\s+)?(?:not\s+(?:stated|specified|given|listed|included|provided|named|identified|clear)|unstated|unspecified|unclear)|no\s+year\b[^.!?;]{0,40}\b(?:is\s+|was\s+)?(?:stated|specified|given|listed|provided))/i;
/*
  Scott, Oct 16 2026 (TPT-3): a public page printed "The pages show month and
  day without a year." so readers also get the wordings below. The desk and the
  writer keep YEAR_NOTE, so what they save does not change (Scott, Oct 14).
  A sentence that only mentions a year (year-round, last year, a school year,
  a year of training) is not a missing-year note and stays.
*/
const READER_YEAR_NOTE =
  /\b(?:(?:does not|doesn't|did not|didn't|do not|don't|fails? to)\s+(?:state|specify|say|give|list|include|provide|name|identify)\s+(?:the|a|an|which|what)\s+(?:[\w-]+\s+){0,2}year|(?:year|years)(?![\w-])[^.!?;]{0,60}\b(?:(?:is|are|was|were|remains?)\s+)?(?:not\s+(?:stated|specified|given|listed|included|provided|named|identified|clear|shown|printed)|unstated|unspecified|unclear)|no\s+year(?![\w-])[^.!?;]{0,40}\b(?:is\s+|was\s+)?(?:stated|specified|given|listed|provided)|\bno\s+year\s+(?:is\s+|was\s+)?(?:attached|shown|printed|listed)\b|\bwithout\s+(?:the\s+|a\s+)?year(?![\w-])(?!\s+of\b)|\bwith\s+no\s+year(?![\w-])(?!\s+of\b)|\bmonth and day only\b|\b(?:show|list|give|name)s?\s+(?:only\s+)?(?:the\s+)?month and day(?!\s+(?:of|for|when)\b))/i;
const TURN_OF_YEAR_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?)\b\.?/;
const JOINED_TAIL = /,\s+(?:but|though|although|while|yet|and|so)\s+[^,]*$/i;

function capitalizeFirst(text: string): string {
  return text.replace(/^(["“(]?)([a-z])/, (_m, open: string, ch: string) => `${open}${ch.toUpperCase()}`);
}

function endSentence(text: string): string {
  const t = text.trim();
  return /[.!?]["”'’)]?$/.test(t) ? t : `${t}.`;
}

/** Drop the clause that tells readers a year is missing; keep the rest of the sentence. */
function stripYearNoteSentence(sentence: string, writtenOn: Date, yearNote: RegExp): string {
  if (!yearNote.test(sentence)) return sentence;
  if (writtenOn.getMonth() === 11 && TURN_OF_YEAR_DATE.test(sentence)) return sentence;
  const clauses = sentence.split(/;\s+/);
  const kept = clauses
    .map((clause) => {
      const at = clause.search(yearNote);
      if (at < 0) return clause;
      const before = clause.slice(0, at);
      const tail = JOINED_TAIL.exec(before);
      if (tail && tail.index >= 20) return clause.slice(0, tail.index);
      return "";
    })
    .map((clause) => clause.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
  if (!kept.length) return "";
  return endSentence(capitalizeFirst(kept.join("; ")));
}

function stripYearNotesFromParagraph(
  paragraph: string,
  writtenOn: Date = new Date(),
  yearNote: RegExp = YEAR_NOTE,
): string {
  if (!yearNote.test(paragraph)) return paragraph;
  return paragraph
    .split("\n")
    .map((line) =>
      yearNote.test(line)
        ? splitSentences(line.replace(/[ \t]+/g, " "))
            .map((sentence) => stripYearNoteSentence(sentence, writtenOn, yearNote))
            .filter(Boolean)
            .join(" ")
        : line,
    )
    .filter((line) => line.trim())
    .join("\n");
}

/** Remove "the source does not specify the year" from a story body (Scott's rule). */
export function stripYearNotes(body: string, writtenOn: Date = new Date()): string {
  return body
    .split(/\n{2,}/)
    .map((p) => stripYearNotesFromParagraph(p, writtenOn).trim())
    .filter(Boolean)
    .join("\n\n");
}
