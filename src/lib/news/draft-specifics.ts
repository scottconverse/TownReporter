/**
 * The specifics a finished draft states that no source the check could read
 * carries (round 2, item 5).
 *
 * THE FAILURE THIS EXISTS FOR. A council recap (dev draft 430) asserted about
 * nine specifics in its back half -- two budget reading dates, a bike-share
 * condition, an RTD ridership figure, a fall in state marijuana revenue, two
 * Hygiene water requests, a composting window, "free rent and utilities", a
 * change of owner and a set of ranks -- that appear in NONE of the run's
 * readable captures. The desk's own evidence check could not see them: it ran
 * over the draft's recorded claims, and the writer had recorded none of these.
 * So the story carried them unmarked, and the one check that exists to catch
 * invented material had nothing to check them against.
 *
 * THE RULE. A draft may state a name, a number, a vote, a date or an address
 * only when something the check can read says it. `dark-specific-grounding.ts`
 * already knows how to find a specific and how to say whether a corpus carries
 * it -- it was written for the Dark Desk's "not in any capture yet" marker. This
 * module is the second caller: it reads a FINISHED DRAFT against the text of
 * every source the writer was given, and returns the specifics nothing carries.
 * The pane then lists them as rows that need a person, which is the same shape
 * the claims-of-absence gate uses for a thing it refuses to print unchecked.
 *
 * WHAT COUNTS AS A SOURCE. The caller passes the text the writer actually had:
 * the captured pages, the uploads, and the desk's own packet lines (the lead's
 * headline and why, the memo's angle and follow). A specific that appears in
 * any of them is the desk's own material, not an invention, and is left alone.
 *
 * Pure -- no DOM, no database, no model -- so a draft can be measured in code
 * and a test can prove the rule without a live call.
 */

import {
  findSpecifics,
  isSpecificGrounded,
  placeCorpus,
  prepareCorpus,
  specificIsGrounded,
  type SpecificKind,
} from "./dark-specific-grounding.ts";

/** One specific a draft states that its sources do not. */
export type DraftGroundingRow = { kind: SpecificKind | "vote"; text: string };

export type DraftGroundingPlace = {
  city?: string | null;
  state?: string | null;
  county?: string | null;
};

export type DraftGroundingInput = {
  /** The final draft body (markdown, as stored). */
  body: string;
  /**
   * Every text the check could read: one string per captured page, upload or
   * desk packet line. Joined, order does not matter.
   */
  sources: readonly string[];
  /** The paper's own city, state and county, so it can name its own place. */
  place?: DraftGroundingPlace;
  /** Most rows to keep. A draft with more flagged specifics is a rewrite. */
  limit?: number;
};

/** The rows a draft may carry before the list stops being a list. */
const DEFAULT_LIMIT = 24;

/**
 * URL tokens, so a path is never read as a specific.
 *
 * `ungroundedSpecifics` does NOT filter URL spans (`markUngroundedSpecifics`
 * does), and `/2026/09/23/longmont-council…` carries an ISO-date-shaped run and
 * a long digit run that would each report as an invented date. A URL is judged
 * WHOLE elsewhere -- it is a source or it is a dead link -- so it is removed
 * here, before any specific is read, replaced by spaces so the words around it
 * keep their boundaries.
 */
const URL_TOKEN = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"'`]+|[\w.+-]+@[\w-]+\.[\w.-]+/giu;

function stripUrls(text: string): string {
  return text.replace(URL_TOKEN, (match) => " ".repeat(match.length));
}

/**
 * A recorded vote tally -- "5-2", "7–0", "6-1-2".
 *
 * Read only when a vote word sits within a short reach of it, because a bare
 * "5-2" in prose is a range or a score, not a vote, and flagging it would fill
 * the pane with rows nobody can act on. `dark-specific-grounding.ts` has no
 * "vote" kind, so this is the one place a tally is lifted out on its own.
 */
const VOTE_TALLY = /\b\d{1,2}\s*[-–]\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?\b/g;
const VOTE_VERB = /\b(vot(?:e|ed|es|ing)|approved|adopted|passed|defeated|failed|carried)\b/i;
const VOTE_REACH = 24;

/**
 * A bare month and day -- "Nov. 17", "December 1" -- with no year.
 *
 * `dark-specific-grounding.ts` reads a date only when a four-digit year is
 * attached (`MONTH_DATE`), which is right for the Dark Desk's search queries
 * and wrong here: the draft that started this item gave its budget readings as
 * "Nov. 17" and "Dec. 1" and nothing else. A day-without-year is still a date a
 * reader will plan around, so it is lifted out on its own. The lookahead leaves
 * a full "Nov. 17, 2026" to the shared `MONTH_DATE`, so the two never report the
 * same span twice. Case-sensitive, so the verb "may 5" is not a date.
 */
const MONTH_DAY =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?[ \t]+(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b(?!\s*,?\s*\d{4})/gu;

/** A tally's own reading of itself, `5-2` however the body spaced it. */
function tallyText(match: string): string {
  return match
    .split(/[-–]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("-");
}

function voteTallies(text: string): { text: string; index: number }[] {
  const found: { text: string; index: number }[] = [];
  VOTE_TALLY.lastIndex = 0;
  for (const match of text.matchAll(VOTE_TALLY)) {
    if (match.index === undefined) continue;
    const start = Math.max(0, match.index - VOTE_REACH);
    const end = Math.min(text.length, match.index + match[0].length + VOTE_REACH);
    if (!VOTE_VERB.test(text.slice(start, end))) continue;
    found.push({ text: tallyText(match[0]), index: match.index });
  }
  return found;
}

/** Every year-less month-and-day in the text, in order. See `MONTH_DAY`. */
function monthDays(text: string): { text: string; index: number }[] {
  const found: { text: string; index: number }[] = [];
  MONTH_DAY.lastIndex = 0;
  for (const match of text.matchAll(MONTH_DAY)) {
    if (match.index === undefined) continue;
    found.push({ text: match[0].replace(/\s+/g, " "), index: match.index });
  }
  return found;
}

/**
 * The specifics in `input.body` that nothing in `input.sources` carries, in the
 * order they appear, deduplicated, and capped at `input.limit`.
 *
 * Everything that appears in the sources is left alone: the rule is not "few
 * specifics" but "no specific the packet does not have".
 */
export function ungroundedDraftSpecifics(input: DraftGroundingInput): DraftGroundingRow[] {
  const body = stripUrls(input.body ?? "");
  if (!body.trim()) return [];
  const corpus = prepareCorpus(input.sources.join("\n\n"), placeCorpus(input.place ?? {}));

  const found: { kind: DraftGroundingRow["kind"]; text: string; index: number }[] = findSpecifics(body)
    .filter((specific) => !specificIsGrounded(specific, corpus))
    .map(({ kind, text, index }) => ({ kind, text, index }));
  /*
    A vote tally and a year-less date are read here rather than in the shared
    extractor -- see `VOTE_TALLY` and `MONTH_DAY` above. Both are judged with
    `isSpecificGrounded`, the same token-boundary test the shared kinds use, so
    a body that spells "5-2" and a source that spells "5 – 2" still agree.
  */
  for (const tally of voteTallies(body)) {
    if (isSpecificGrounded(tally.text, corpus)) continue;
    found.push({ kind: "vote", text: tally.text, index: tally.index });
  }
  for (const date of monthDays(body)) {
    if (isSpecificGrounded(date.text, corpus)) continue;
    found.push({ kind: "date", text: date.text, index: date.index });
  }

  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const seen = new Set<string>();
  const rows: DraftGroundingRow[] = [];
  for (const specific of found) {
    const key = `${specific.kind}\u0000${specific.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: specific.kind, text: specific.text });
    if (rows.length >= (input.limit ?? DEFAULT_LIMIT)) break;
  }
  return rows;
}
