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
      return stripProcessNarration(cleaned).trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
