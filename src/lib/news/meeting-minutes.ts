import type { VoteRecord } from "./meeting-story-section5.ts";

/*
  Council votes read from the OFFICIAL MINUTES (Goal C unit C2, design D214).

  Why this file exists: a city can list no "Minutes" document on its own
  meeting and still publish that meeting's minutes -- Longmont prints them
  inside the packet of a later meeting, verbatim, as `MINUTES / City Council
  Regular Session / October 6, 2026` followed by the item headings and the
  motions. The portal document list is therefore not where the minutes are; the
  text is.

  Everything here is pure: text in, votes out. `./meeting-minutes.server.ts`
  does the looking-up and the downloading.
*/

export type MinutesMotion = {
  /** The agenda item that voted, e.g. "4A" for a motion under 4 > A. */
  item: string;
  /** The item's heading text, e.g. "17. ADJOURN". Decides the adjournment case. */
  heading: string;
  /** The "to ..." clause only, not the whole motion block. */
  motion: string;
  mover: string;
  seconder: string;
  /** "N-M", digits and one hyphen, whatever dash the PDF used. */
  tally: string;
  result: "Passed" | "Failed";
  /** The MOTION block, whitespace-collapsed, for provenance. */
  excerpt: string;
};

export type MinutesSection = {
  /** The minutes text only. */
  text: string;
  /** 1-based page of the text this section starts on. */
  page: number;
};

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/*
  Page footers are GLUED into sentences by the PDF text layer:
    "...Crystal Prieto.City Council Regular Session, October 06, 2026 Page 1"
    "A.City Council Regular Session, October 06, 2026 Page 18"
  Each word of the body name has to start with a capital without an internal
  capital, which is what stops the pattern from swallowing the name glued in
  front of it ("...Alex KalkhoferCity Council Regular Session..." keeps
  "Kalkhofer").
*/
const PAGE_FOOTER = new RegExp(
  String.raw`(?:[A-Z][a-z0-9&'\-]*\s+)+(?:Session|Commission|Board|Committee|Council)\s*,\s*(?:${MONTHS})\s+\d{1,2},\s+\d{4}\s+Page\s+\d+`,
  "g",
);

const TOP_HEADING = /^\s*(\d{1,2})\.\s+[A-Z]/;
const SUB_HEADING = /^\s*([A-Z])\.(?:\s|$)/;
const MOTION_START = /^\s*MOTION\s*$/;
const VOTE_LINE = /^\s*(?:Carried|Failed)\s*:/;

/** The section's own `MINUTES` line: alone on its line, either case. */
const MINUTES_LINE = /^[ \t]*MINUTES[ \t]*$/gm;
/** The line that ends the minutes: "ADJOURN", usually numbered "17. ADJOURN". */
const ADJOURN_LINE = /^[ \t]*(?:\d{1,2}\.[ \t]*)?ADJOURN\b/im;

export function stripPageFooters(text: string): string {
  return text.replace(PAGE_FOOTER, "");
}

/** "October 6, 2026" and "October 06, 2026" both, from any date a caller has. */
function dateForms(raw: string): string[] {
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const month = MONTHS.split("|")[Number(iso[2]) - 1];
    if (!month) return [];
    const day = Number(iso[3]);
    return [`${month} ${day}, ${iso[1]}`, `${month} ${String(day).padStart(2, "0")}, ${iso[1]}`];
  }
  const named = raw.match(new RegExp(String.raw`\b(${MONTHS})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, "i"));
  if (!named) return [];
  const month = MONTHS.split("|").find((m) => m.toLowerCase() === named[1]!.toLowerCase())!;
  const day = Number(named[2]);
  return [`${month} ${day}, ${named[3]}`, `${month} ${String(day).padStart(2, "0")}, ${named[3]}`];
}

/**
 * The minutes of ONE meeting, out of text that may hold several documents.
 *
 * A section is a `MINUTES` line followed within 200 characters by the body's
 * name and the meeting's date. It ends at the next standalone `MINUTES` line,
 * or 400 characters past the adjournment line, whichever comes first -- the
 * minutes of a meeting stop when the meeting adjourns.
 *
 * `page` counts the form feeds the extractor left between pages, so a caller
 * that extracted pages separately gets the page the section really starts on.
 */
export function minutesSectionFor(
  text: string,
  input: { bodyTitle: string; meetingDate: string },
): MinutesSection | null {
  const body = input.bodyTitle.trim().toLowerCase();
  const dates = dateForms(input.meetingDate);
  if (!body || !dates.length) return null;

  MINUTES_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MINUTES_LINE.exec(text))) {
    const start = match.index;
    const head = text.slice(start, start + 200);
    const headLower = head.toLowerCase();
    if (!headLower.includes(body)) continue;
    if (!dates.some((form) => headLower.includes(form.toLowerCase()))) continue;
    const end = sectionEnd(text, start + match[0].length);
    return {
      text: text.slice(start, end),
      page: 1 + count(text.slice(0, start), "\f"),
    };
  }
  return null;
}

function sectionEnd(text: string, searchFrom: number): number {
  const rest = text.slice(searchFrom);
  const ends: number[] = [];
  const nextMinutes = rest.search(MINUTES_LINE);
  if (nextMinutes >= 0) ends.push(searchFrom + nextMinutes);
  const adjourn = rest.search(ADJOURN_LINE);
  if (adjourn >= 0) ends.push(Math.min(searchFrom + adjourn + 400, text.length));
  return ends.length ? Math.min(...ends) : text.length;
}

function count(haystack: string, needle: string): number {
  let total = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    total += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return total;
}

/**
 * Every motion the minutes record, by agenda item.
 *
 * Item ids are the minutes' own: top-level `4.` gives "4", a sub-heading `A.`
 * under it gives "4A". A motion under 12A is 12A's vote and never 12's -- a
 * parent item that took no vote of its own decided nothing.
 */
export function minutesVotesByItem(sectionText: string): Record<string, MinutesMotion[]> {
  const lines = stripPageFooters(sectionText).split(/\r?\n|\f/);
  const byItem: Record<string, MinutesMotion[]> = {};
  let top = "";
  let topText = "";
  let subText = "";
  let current = "";
  let blockItem = "";
  let blockHeading = "";
  let block: string[] | null = null;

  const flush = () => {
    if (block && blockItem) {
      const motion = motionFromBlock(blockItem, block.join("\n"), blockHeading);
      if (motion) (byItem[motion.item] ??= []).push(motion);
    }
    block = null;
  };

  for (const line of lines) {
    if (MOTION_START.test(line)) {
      flush();
      block = [];
      blockItem = current;
      blockHeading = [topText, subText].filter(Boolean).join(" ");
      continue;
    }
    // Inside a motion block only a vote line ends it: an agenda-style line in
    // the middle of a motion's text is prose, not a new item.
    if (block) {
      block.push(line);
      if (VOTE_LINE.test(line)) flush();
      continue;
    }
    const heading = line.match(TOP_HEADING);
    if (heading) {
      top = heading[1]!;
      topText = line.trim();
      subText = "";
      current = top;
      continue;
    }
    const sub = line.match(SUB_HEADING);
    if (sub && top) {
      current = `${top}${sub[1]!}`;
      subText = line.trim();
    }
  }
  flush();
  return byItem;
}

function motionFromBlock(item: string, raw: string, heading: string): MinutesMotion | null {
  const text = raw.replace(/\s+/g, " ").trim();
  const vote = text.match(/\b(Carried|Failed)\s*:\s*(\d{1,3})\s*\S\s*(\d{1,3})\b/);
  if (!vote) return null;
  const moved = text.match(
    /([A-Z][^,]*?)\s+moved,\s*seconded by\s+([^,]*?),\s+to\s+([\s\S]+?)(?:\s*(?:Approved|Dissented|Abstained|Carried|Failed)\s*:|$)/,
  );
  if (!moved) return null;
  const motion = moved[3]!.replace(/\s+/g, " ").trim();
  if (!motion) return null;
  return {
    item,
    heading,
    motion,
    mover: moved[1]!.trim(),
    seconder: moved[2]!.trim(),
    tally: `${Number(vote[2])}-${Number(vote[3])}`,
    result: vote[1]!.toLowerCase() === "carried" ? "Passed" : "Failed",
    excerpt: `MOTION ${text}`.slice(0, 400),
  };
}

/*
  Housekeeping motions that are not the item's decision. Item 9I of the Oct 6,
  2026 minutes voted on O-2026-73 and then, last, "to extend the meeting past
  11:00 p.m."; storing the extension as 9I's vote would publish a wrong vote.
  An item that really is an adjournment ("17. ADJOURN") keeps its motion: the
  heading, not the clause, says whether the motion is housekeeping.
*/
const PROCEDURAL_MOTION =
  /^(?:extend (?:the meeting|past)|extend .*\bpast \d|(?:take a )?recess|take a (?:short )?break|adjourn|suspend the rules)/i;

/**
 * The minutes' motions as vote records, keyed by item, ready for
 * `extractStructuredVote`.
 *
 * Procedural motions are dropped first; among what remains the LAST is the
 * item's decision, and the row says so rather than hiding the others.
 */
export function minutesVoteRecords(
  byItem: Record<string, MinutesMotion[]>,
  locator: string,
): (VoteRecord & { item: string })[] {
  const records: (VoteRecord & { item: string })[] = [];
  for (const [item, motions] of Object.entries(byItem)) {
    const last = motions[motions.length - 1];
    if (!last) continue;
    const deciding = /\badjourn/i.test(last.heading)
      ? motions
      : motions.filter((motion) => !PROCEDURAL_MOTION.test(motion.motion));
    const chosen = deciding[deciding.length - 1];
    if (!chosen) continue;
    const skipped = motions.length - deciding.length;
    const notes = [
      ...(deciding.length > 1
        ? [`minutes list ${deciding.length} motions under item ${item}; the last is used`]
        : []),
      ...(skipped ? [`skipped ${skipped} procedural motion(s) under item ${item}`] : []),
    ];
    records.push({
      item,
      motion: chosen.motion,
      mover: chosen.mover,
      seconder: chosen.seconder,
      tally: chosen.tally,
      result: chosen.result,
      source: "minutes",
      locator,
      excerpt: chosen.excerpt,
      notes: notes.length ? notes : undefined,
    });
  }
  return records;
}
