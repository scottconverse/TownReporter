/**
 * The name a reader sees for a source the desk supplied itself.
 *
 * WHY THIS EXISTS (THV-2). An AI opinion's Claims and sources appendix is
 * written from material the desk handed the model: the editor's pasted text,
 * the uploaded documents, the research notes, and the assignment. The model
 * names those in the appendix the way it saw them -- "Opinion desk pasted
 * material.txt", "the assignment in the prompt" -- and those names went onto
 * the public page. A reader of "OPINION: Keep the A Line at 15 minutes" was
 * shown a filename from our own file store and a reference to a prompt they
 * cannot see. Scott, Oct 14 2026: "change it to 'the supplied document'".
 *
 * DELIBERATELY NARROW. Only a name that is one of the desk's own internal
 * artifacts is rewritten. An ordinary source line -- a city page, a news
 * story, a named packet with a page locator -- is returned untouched, because
 * the whole value of the appendix is that it says precisely what was read.
 *
 * Pure text-in text-out so it can be tested without a database, and applied at
 * RENDER time (see `readerText`) as well as where a new appendix is written,
 * so pieces already published are corrected without editing stored text.
 */

/** The one line every rewritten reference becomes. */
export const SUPPLIED_DOCUMENT_NAME = "the supplied document";

/**
 * The desk's own artifacts, by the name they carry when they reach the model.
 *
 * Each entry is a whole-name or whole-phrase match, not a substring hunt: a
 * story that legitimately mentions a document called "pasted material" is not
 * the desk's file. `SUPPLIED_DOCUMENT_NAME` itself is matched too, so a piece
 * that already carries the corrected wording, or an editor who wrote it by
 * hand, is stable under a second pass.
 */
const INTERNAL_NAMES: RegExp[] = [
  // The pasted-text row `model-request-commit.server.ts` stores, with and
  // without its extension, and whatever the desk prefixed it with.
  /\bopinion desk pasted material(?:\.txt)?\b/gi,
  /\bopinion desk pasted text(?:\.txt)?\b/gi,
  // The document rows the file store holds for this piece, as their reading
  // notes name them: a PDF/DOCX/image the editor uploaded is supplied material
  // and the filename is ours, not a public record's.
  /\b(?:attached|uploaded|supplied|pasted) (?:document|file|text)(?:\s+\S{1,40}\.(?:txt|md|pdf|docx?|rtf|png|jpe?g))?\b/gi,
  // The assignment: the prompt field "WHAT THE EDITOR ASKED FOR", which the
  // model refers back to in the appendix. The editor's own words are the
  // material; the place they sat is not the reader's business.
  /\bthe assignment in the prompt\b/gi,
  /\bthe (?:editor'?s? )?(?:assignment|prompt|instruction|question) (?:given |provided |included )?(?:in|to) the (?:prompt|run|model|system prompt)\b/gi,
  /\bwhat the editor asked for\b/gi,
  // "the prompt" is internal here only when it is the whole name. A line that
  // merely MENTIONS the prompt is a claim a reader can read; only a bare
  // citation of it points at something they cannot see. So this one must match
  // the entire line (or bullet, or parenthesised), never a phrase inside one.
  /^the (?:system )?prompt[.,]?$/i,
];

/**
 * The desk's own FILE names, matched anywhere in a line. Only the pasted-material
 * row and an uploaded packet's filename are in here: both are names we invented,
 * so no public record can share them, and a line that builds a sentence around
 * one is still citing us. The prompt references are deliberately NOT here -- the
 * sentence around "the prompt" is the model's own claim and stays word for word.
 */
const INTERNAL_NAME_SOURCE = /\bopinion desk pasted (?:material|text)(?:\.txt)?\b/gi;

/**
 * The same names, for finding where a line's citation OPENS. Anchored at the
 * start of what follows the bullet, because a citation is a name that opens a
 * line; a name buried mid-sentence is the model writing around it, and there
 * the sentence's casing is kept (`readerSourceLine`).
 */
const INTERNAL_NAME_ANY = /\bopinion desk pasted (?:material|text)(?:\.txt)?\b/i;

/**
 * The assignment references, matched inside a sentence. Only the reference goes;
 * the sentence around it is the model's own claim and keeps every other word.
 * These are safe to sweep because they name the desk's prompt and nothing a
 * reader can look up -- unlike a city page or a named packet, which must never
 * be touched.
 */
const INTERNAL_PHRASE_SOURCES = [
  /\bthe assignment in the prompt\b/gi,
  /\bwhat the editor asked for\b/gi,
];

/** True when a source line is naming something the desk supplied, not a public record. */
export function isInternalSourceName(name: string): boolean {
  const text = String(name ?? "").trim();
  if (!text) return false;
  return INTERNAL_NAMES.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/**
 * True when the text IS one of the desk's artifacts and nothing else.
 *
 * This is the difference that keeps the rule narrow: "the prompt" alone is a
 * citation of something the reader cannot see and is renamed, while a sentence
 * that merely mentions the prompt is the model's own claim and keeps every
 * word. Same for the pasted-material row, which reaches the page both as a
 * bare source and inside a sentence about it.
 */
function isStandaloneInternalName(head: string): boolean {
  const bare = head.trim().replace(/[.,;:]+$/, "");
  if (!bare) return false;
  return INTERNAL_NAMES.some((pattern) => {
    pattern.lastIndex = 0;
    const at = pattern.exec(bare);
    return at?.index === 0 && at[0].length === bare.length;
  });
}

/**
 * The reader's copy of a source name: the desk's own artifacts become
 * "the supplied document", and everything else is returned exactly as it was
 * written, character for character.
 *
 * The page's own capital belongs to a citation that opens a line: a filename
 * standing alone ("Opinion desk pasted material.txt" in a sources list, or a
 * bullet led by one). There the desk's capitalised name becomes "The supplied
 * document". A reference the desk wrote mid-sentence ("cited to the assignment
 * in the prompt") keeps the sentence's own casing and gets the reader's words
 * plain, so the page never acquires a stray capital or a doubled article.
 *
 * A caller that has already peeled the name off its line passes the bare name:
 * the lead is the line's, not the name's.
 */
export function readerSourceName(name: string): string {
  const text = String(name ?? "");
  if (!isInternalSourceName(text)) return text;
  // The name itself: surrounding whitespace and any wrapping quotes are the
  // line's furniture, not part of what the desk called the file.
  const named = text.trim().replace(/^["'“”]|["'“”]$/g, "");
  // Already the reader's wording -- a piece corrected on a previous pass, or an
  // editor who typed it by hand -- so a second pass changes nothing.
  if (named.toLowerCase() === SUPPLIED_DOCUMENT_NAME) return text;
  const named0 = SUPPLIED_DOCUMENT_NAME.replace(/^the\s+/, "");
  const capital = /^[A-Z]/.test(named) ? "The" : "the";
  return `${capital} ${named0}`;
}

/**
 * The whole appendix, with every internal source name replaced.
 *
 * Two shapes reach the reader. A bullet that is a citation end to end -- the
 * bullet, the file's name, a page locator, nothing else -- is renamed as a
 * whole so the locator survives word for word. A line that merely CONTAINS one
 * of the desk's filenames has just that name swapped, so the sentence the model
 * built around it is untouched. Text with no internal name is returned
 * unchanged, including its exact whitespace, so a stored piece is never
 * rewritten by accident.
 */
export function readerAppendixText(text: string): string {
  const body = String(text ?? "");
  if (!body || !isInternalSourceName(body)) return body;
  return body
    .split("\n")
    .map(readerSourceLine)
    .join("\n");
}

/** One line of an appendix, with the desk's own artifacts named for the reader. */
function readerSourceLine(line: string): string {
  const bullet = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)/)?.[0] ?? "";
  const rest = line.slice(bullet.length);
  if (isStandaloneInternalName(rest)) return `${bullet}${readerSourceName(rest)}`;
  /*
    A bullet whose citation opens on the desk's own file and then says what the
    reader is being pointed at: "- Opinion desk pasted material.txt (page 2) --
    the ridership figure." The name changes and the locator and the note after
    it are carried across word for word, which is what keeps the citation
    checkable.
  */
  const at = rest.search(INTERNAL_NAME_ANY);
  if (at === 0) {
    const name = INTERNAL_NAME_ANY.exec(rest)![0];
    const after = rest.slice(name.length).trim();
    const head = name.replace(/[.,;:]+$/, "");
    if (!after || after.startsWith("(") || after.startsWith("—") || after.startsWith("-"))
      return `${bullet}${readerSourceName(head)}${after ? ` ${after}` : ""}`;
  }
  /*
    Anywhere else the desk's own FILE names still go -- a reading note headed
    `Opinion desk pasted material.txt` carries the filename into the citation
    itself ("… (file: Opinion desk pasted material.txt)"), and that name is
    ours whatever sentence the model built around it.
  */
  const swapped = line.replace(INTERNAL_NAME_SOURCE, SUPPLIED_DOCUMENT_NAME);
  /*
    And a sentence the model built around the assignment keeps every word but
    the reference, which is swapped in place: "Cited to the assignment in the
    prompt, the desk wrote the outline." The sentence's own casing is kept, so
    the reader gets "the supplied document" and never a stray capital.
  */
  return INTERNAL_PHRASE_SOURCES.reduce(
    (text, pattern) => text.replace(pattern, SUPPLIED_DOCUMENT_NAME),
    swapped,
  );
}
