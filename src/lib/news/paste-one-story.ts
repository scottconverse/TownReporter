/**
 * "Paste a story I already have": one pasted story, straight into the Queue.
 *
 * The owner, 2026-09-24: "the same function in opinion that just lets me paste
 * in an already written story, just one, to dump in the queue, as a regular
 * non-opinion story for massaging later via the queue."
 *
 * Opinion already has this (`fileWrittenEditorial`, opinion.ts:374) and it is
 * the one thing the news side could not do: pasting a finished story into
 * "Write a story" ran the writer over it, which is the opposite of filing it.
 *
 * This is deliberately NOT a second save path. It builds ONE card in the shape
 * `import-review.ts` builds its cards in, and that card goes through the same
 * `importFinishedStories` server function the review screen calls: the same
 * lead origin `import`, the same draft holding the paste exactly, the same
 * link -> source extraction, the same disclosure choices, the same duplicate
 * warning. There is no new server function and no new table.
 *
 * Three things it does differently from a report import, all of them because
 * there is nothing here to read:
 *
 * 1. No model call at all, not even the structure-only one. One story pasted
 *    with no headings has nothing to split, so nothing is split.
 * 2. Nothing is taken out of the text. The report reader lifts `**Why it
 *    matters:**`, `**Score:**` and the rest into editor-note fields, because a
 *    scanner's report format defines them; a story you wrote has no such
 *    format, and guessing that a line is a note is how a published story ends
 *    up missing a paragraph. The paste is the draft, byte for byte -- with the
 *    single exception of the line that becomes the headline, which is the
 *    headline and not the first line of the body (see `bodyFromPaste`).
 * 3. The section is not guessed. The chooser opens at "Section not chosen —
 *    pick one" and the ordinary confirm-at-publish gate asks later. An import
 *    suggests from the text because a report's own headings say what a story
 *    is about; a single paste says nothing a chooser should act on.
 */

import { IMPORT_LIMITS, extractLinks, type DisclosureKey } from "./import-stories.ts";
import { type ReviewCard } from "./import-review.ts";

/**
 * Who wrote a pasted story, until the editor says otherwise.
 *
 * "A person" and not "An outside AI tool": the box says *paste a story I
 * already have*, and the common case is the editor's own words or a colleague's
 * — the same reading the report reader takes for a story with no report format
 * around it (`parsePlainStory`, import-stories.ts:433). It is one select away
 * from being changed, and the line it prints is shown next to it.
 */
export const PASTE_ONE_DISCLOSURE: DisclosureKey = "person";

/** The card key for the one card this screen ever has. */
export const PASTE_ONE_KEY = "pasted-story";

export type PasteOneInput = {
  /** The story, exactly as pasted. */
  text: string;
  /** Empty -> the first line of the paste becomes the headline. */
  headline?: string;
  /** A newsroom section key, or "" for "Section not chosen — pick one". */
  section?: string;
  disclosureKey?: DisclosureKey;
  disclosureOther?: string;
};

/**
 * The headline a paste carries when the editor did not type one.
 *
 * The first line that has anything in it, with a markdown heading marker and a
 * wrapping `**` taken off — `# Council votes` and `**Council votes**` are both
 * headlines a person would write on the first line. Never invented: an empty
 * paste gives an empty headline, and the desk says so by name rather than
 * calling the story "Untitled".
 */
export function headlineFromPaste(text: string): string {
  const first =
    String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return first
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim()
    .slice(0, IMPORT_LIMITS.headline);
}

/**
 * The paste without the line the headline was taken from.
 *
 * Step G, from the Unit X2 walk (item 11): when the headline is the paste's
 * first line, that line is the headline and must not be repeated as the body's
 * first line, or every story pasted this way opens in the editor with its own
 * headline sitting over it again. This is structure, not rewriting: the one
 * line the headline was taken from comes off, together with the blank lines
 * that separated it from the text, and every remaining line stays byte for
 * byte as pasted, in order.
 *
 * The first line that has anything in it is the one that came off -- the same
 * line `headlineFromPaste` read -- so a paste that opens with blank lines
 * loses only those blanks and its headline line.
 *
 * Nothing else is ever touched. A `**Score:**` line stays in the story (see
 * the note at the top of this file); only the headline's own line leaves.
 *
 * A paste that is nothing but a headline therefore has no body left, and the
 * ordinary "This story has no text." refusal says so -- filing a draft whose
 * body repeats the headline field above it is worse than asking for the story.
 */
export function bodyFromPaste(text: string): string {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = lines.findIndex((line) => line.trim().length > 0);
  if (head < 0) return "";
  let start = head + 1;
  /* The blank lines between the headline and the first paragraph go with it. */
  while (start < lines.length && !lines[start]!.trim()) start++;
  return lines.slice(start).join("\n");
}

/**
 * The one card this screen files.
 *
 * Ticked and a finished story, both of them: the editor pasted one thing and
 * asked for it to go to the Queue, so there is nothing to tick and nothing to
 * call "not a story". `include: true` on a card holding no text is refused by
 * the server the same way an empty card is refused on the review screen.
 *
 * `kind` is "story" and not read off the text the way a report card's is
 * (`defaultImportKind`): a report is read for whatever is in it, and a short
 * block there is a lead with no story written yet. Here the editor has said
 * what this is by choosing the box marked *paste a story I already have* --
 * telling them their own finished story is a story idea would be the screen
 * arguing with the button they just pressed. It is a toggle away either way.
 */
export function pasteOneStoryCard(input: PasteOneInput): ReviewCard {
  const text = String(input.text ?? "");
  const typed = String(input.headline ?? "").trim().slice(0, IMPORT_LIMITS.headline);
  return {
    key: PASTE_ONE_KEY,
    include: true,
    kind: "story",
    includeByDefault: true,
    isStory: true,
    headline: typed || headlineFromPaste(text),
    /*
      Empty, and not `topicFromText(...)`: the section is the editor's to
      choose here (see the note at the top), so nothing is offered that they
      did not ask for.
    */
    suggestedSection: "",
    section: String(input.section ?? "").trim().slice(0, 40),
    dek: "",
    bodyChoice: "main",
    /*
      Never re-paragraphed, never trimmed of anything but the line the headline
      came from: a headline the editor typed leaves the paste whole, and a
      headline read off the first line takes that one line off the top.
    */
    body: typed ? text : bodyFromPaste(text),
    plainBrief: "",
    /* A story a person wrote cites nothing by name; it carries its own links. */
    citations: [],
    links: extractLinks(text).map((l) => ({ ...l, keep: true })),
    /* No report format, so no editor notes to lift out of the text. */
    score: "",
    triage: "",
    reporterNextStep: "",
    hold: false,
    disclosureKey: input.disclosureKey ?? PASTE_ONE_DISCLOSURE,
    disclosureOther: String(input.disclosureOther ?? "").trim(),
    cleanSplit: true,
    warning: "",
  };
}
