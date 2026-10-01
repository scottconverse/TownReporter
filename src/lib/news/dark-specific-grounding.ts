/**
 * Unit DD1, item 1 — a specific the model wrote is kept only if something the
 * desk actually holds says it.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §5.2, C1) found the
 * Dark Desk's case file, run record, two "STILL OPEN" questions, a "BEING
 * TESTED" scenario and two searches all naming **1749 Main Street, Longmont**.
 * No capture in the file contained "1749": the Reddit post, the quoted closure
 * letter and the Colorado Shines licensing record the same round captured all
 * say **1941 Terry Street**. The desk had aimed its own research at a parcel it
 * invented, and asked the editor to go and check it.
 *
 * The mechanism was that a planner reply is durable state. `parsePlan` reads
 * the model's JSON, `persistPlan` and `persistDiscovery` write it to
 * `hypotheses`, `frontier_items` and `claims`, `plan.searches` becomes the
 * queries the app runs, and `plan.summary` becomes `investigations.summary` and
 * `dark_runs.summary`. Nothing between the model's reply and those columns
 * asked whether the specifics in it existed anywhere but in the reply.
 *
 * What this module adds, and what it deliberately does not:
 *
 *   - A **specific** is a street address, a dollar amount, a date, a
 *     licence/case/docket-style identifier, or a person's name. Those are the
 *     things an editor acts on and the things a fluent model produces most
 *     confidently when it has nothing to go on.
 *   - The **corpus** is what the desk holds: the text of the file's captures,
 *     plus the lead's or signal's own words. A specific that appears in it
 *     (normalised -- see below) is grounded and passes through untouched.
 *   - A specific that does not is not deleted. Deleting it would leave a
 *     sentence with a hole in it, and the editor still needs to see what the
 *     model was reaching for. It is kept and MARKED, in the text, with
 *     `UNGROUNDED_MARKER`, so "1749 Main Street (not in any capture yet)" reads
 *     as the open question it is rather than as a fact.
 *   - A QUERY that names an ungrounded specific is dropped outright. A marker
 *     cannot make a search term honest: running the query is the act of
 *     spending the editor's run on the invention, and a query is not read by a
 *     human before it is sent.
 *
 * Normalisation is what makes the rule usable rather than merely strict. The
 * capture says "1941 Terry St, Longmont, CO 80501" and a person writes "1941
 * Terry Street"; those are the same address, and a rule that called the second
 * one invented would be wrong about the one case it exists for.
 */

import type { HopPlan } from "./investigate.ts";

/** The visible marker. Quoted in the editor handbook; do not reword silently. */
export const UNGROUNDED_MARKER = "(not in any capture yet)";

/** `text` with a trailing marker and the space before it taken back off. */
const MARKER_SUFFIX = ` ${UNGROUNDED_MARKER}`;

/**
 * The same string with every marker taken out, and nothing else touched.
 *
 * The marker is a note to a READER. It is not part of a name, a URL or a search
 * term, and three places must not carry it:
 *
 *   - a query built from stored text. `"Front Range Municipal Solutions LLC
 *     (not in any capture yet)" Longmont` asks a provider for an exact phrase
 *     that cannot exist, so the search returns nothing and the hop reads as low
 *     yield when it was the app that broke it.
 *   - a URL label. A frontier item whose label is
 *     `https://…/View/123456 (not in any capture yet)/Agenda.pdf` is a URL the
 *     fetcher cannot reach -- see `groundPlan`, which never marks a URL at all.
 *   - the marker's own words. "capture" and "yet" are not content words and
 *     must not become search terms in a subject built out of marked prose.
 */
export function stripUngroundedMarker(text: string): string {
  if (!text.includes(UNGROUNDED_MARKER)) return text;
  return text.split(MARKER_SUFFIX).join("");
}

/** Suffix and month spellings that mean the same thing when they are compared. */
const CANONICAL_WORD: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  aven: "avenue",
  rd: "road",
  dr: "drive",
  ln: "lane",
  blvd: "boulevard",
  blv: "boulevard",
  ct: "court",
  pl: "place",
  ter: "terrace",
  terr: "terrace",
  hwy: "highway",
  pkwy: "parkway",
  cir: "circle",
  sq: "square",
  trl: "trail",
  jan: "january",
  feb: "february",
  mar: "march",
  apr: "april",
  jun: "june",
  jul: "july",
  aug: "august",
  sep: "september",
  sept: "september",
  oct: "october",
  nov: "november",
  dec: "december",
};

/**
 * Words that are capitalised by grammar rather than by being a name. A run of
 * capitalised words made only of these is a sentence, not a person.
 */
const NOT_A_NAME = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "he", "she", "they", "we",
  "you", "i", "and", "but", "or", "if", "when", "where", "while", "after", "before", "since",
  "because", "as", "so", "however", "meanwhile", "also", "both", "each", "every", "all", "some",
  "no", "not", "none", "one", "two", "three", "in", "on", "at", "by", "for", "from", "with",
  "without", "of", "to", "into", "over", "under", "about", "there", "here", "then", "than",
  "now", "still", "yet", "new", "old", "next", "last", "first", "second", "third",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december",
  "what", "which", "who", "whom", "whose", "why", "how", "yes", "ok", "okay",
]);

/**
 * Words that say a capitalised run is an INSTITUTION rather than a person.
 *
 * A two-word run of capital letters is what English does to a great many things
 * that are not people: a statute ("Colorado Open Records Act"), a public body
 * ("Secretary of State", "Boulder County Public Health"), a form ("Public
 * Records Request"). Marking those as invented PERSONS is worse than useless --
 * it drops the first-hop query that names a state agency, and it renders the
 * editor "Does the Colorado Secretary (not in any capture yet) of State list
 * ...", which reads as the desk doubting a government department exists.
 *
 * This list is generic: no place name is in it, because a paper's own town and
 * state are the paper's to know (see `GroundingCorpus.place`) and a
 * neighbourhood's name must never be hard-coded here.
 */
const INSTITUTION_WORD = new Set([
  "act", "administration", "agency", "assembly", "attorney", "authority", "board", "bureau",
  "cabinet", "city", "clerk", "code", "college", "commission", "committee", "congress",
  "council", "county", "court", "department", "district", "division", "federal", "governor",
  "mayor", "ministry", "national", "office", "ordinance", "planning", "police", "program",
  "project", "public", "records", "request", "school", "secretary", "senate", "sheriff",
  "state", "statute", "superintendent", "treasurer", "university",
]);

/**
 * The word a sentence opens with, which swallows the next capitalised run:
 * "Search Colorado Secretary of State" is an instruction, and "Search Colorado
 * Secretary" is not a person. Only the FIRST word is judged -- a verb in the
 * middle of a run ("Grand Junction Works") is left to `INSTITUTION_WORD`.
 *
 * Matched on the stem as well as the word, because the run that reaches here is
 * the one the sentence actually wrote: `Searched Colorado Shines` came back as
 * a name until "searched" was read as "search".
 */
const SENTENCE_OPENER = new Set([
  "search", "find", "check", "look", "review", "investigate", "pull", "call", "contact",
  "verify", "confirm", "ask", "see", "read", "visit", "open", "does", "do", "did", "is",
  "was", "were", "has", "have", "had", "can", "could", "should", "will", "would", "are",
  "get", "use", "try", "follow", "query", "compare", "trace", "run", "list", "add",
]);

/** "searched" is "search" with a suffix, and opens a sentence just the same. */
function isSentenceOpener(word: string): boolean {
  if (SENTENCE_OPENER.has(word)) return true;
  for (const suffix of ["ed", "es", "ing", "s"]) {
    if (word.endsWith(suffix) && SENTENCE_OPENER.has(word.slice(0, -suffix.length))) return true;
  }
  return false;
}

export type SpecificKind = "address" | "amount" | "date" | "identifier" | "name";

export type Specific = {
  kind: SpecificKind;
  /** The span exactly as it was written. */
  text: string;
  /** Where it starts in the string it was read from. */
  index: number;
};

export type UngroundedSpecific = { kind: SpecificKind; text: string };

const ADDRESS = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?\s+(?:[\p{Lu}][\p{L}'’.-]*\s+){0,3}` +
    String.raw`(?:[Ss]treet|[Ss]t|[Aa]venue|[Aa]ve|[Rr]oad|[Rr]d|[Dd]rive|[Dd]r|[Ll]ane|[Ll]n|` +
    String.raw`[Bb]oulevard|[Bb]lvd|[Cc]ourt|[Cc]t|[Pp]lace|[Pp]l|[Tt]errace|[Tt]er|` +
    String.raw`[Hh]ighway|[Hh]wy|[Pp]arkway|[Pp]kwy|[Cc]ircle|[Cc]ir|[Tt]rail|[Tt]rl|[Ww]ay|[Ss]quare|[Ss]q)\b\.?`,
  "gu",
);

const MONTH_DATE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/giu;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

const AMOUNT = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|trillion)\b)?/giu;

/** A licence, case, docket or parcel number: a run of digits too long to be prose. */
const LONG_NUMBER = /\b\d{5,}(?:-\d+)*\b/g;
const DOCKET = /\b(?:[A-Z]{1,4}-)?\d{4}-[A-Z]{1,4}-?\d{1,6}\b/g;
const LETTERED_DOCKET = /\b[A-Z]{1,4}-\d{2,4}-\d{1,6}\b/g;

const NAME_RUN = /\b\p{Lu}[\p{L}'’.]*\s+\p{Lu}[\p{L}'’.]*(?:\s+\p{Lu}[\p{L}'’.]*){0,2}\b/gu;

/**
 * Words that are the same in both spellings of a street address, and may be
 * dropped when they sit right after the house number. "1941 N. Terry Street"
 * and "1941 Terry Street" are one place; "West Virginia" is not "Virginia".
 */
const DIRECTIONAL = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
]);

/** The scale word in an amount, as the number of decimal places it shifts. */
const AMOUNT_SCALE: Record<string, number> = {
  thousand: 3,
  million: 6,
  billion: 9,
  trillion: 12,
};

const MONTH_INDEX: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

/*
  The three spellings of a date, and the one of an amount, are matched on the
  ALREADY-LOWERCASED text: this runs after `.toLowerCase()`, so the month names
  below are lower case on purpose.
*/
const AMOUNT_IN_TEXT = /\$\s?(\d[\d,]*)(?:\.(\d+))?\s*(thousand|million|billion|trillion)?\b/g;
const MONTH_DATE_IN_TEXT =
  /\b(january|february|march|april|may|june|july|august|september|sept|sep|october|november|december|jan|feb|mar|apr|jun|jul|aug|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
const ISO_DATE_IN_TEXT = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE_IN_TEXT = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;

const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * `$1.2 million` and `$1,200,000` are the same amount written two ways, and
 * `$200,000` is not -- which is the whole point, because a dropped digit in a
 * street number or an amount is the error class this module exists for.
 *
 * The shift is done on the DIGITS rather than with floating point: `1.2 * 1e6`
 * is 1200000.0000000002 in JS, and a rule whose answer depends on that is a
 * rule that grounds `$1.2 million` against `$1,200,000` on some days and not
 * others.
 */
function canonicalAmount(digits: string, fraction: string | undefined, scale: string | undefined): string {
  const whole = digits.replace(/,/g, "");
  const shift = AMOUNT_SCALE[scale ?? ""] ?? 0;
  let frac = fraction ?? "";
  let shifted = whole;
  if (frac) {
    const moved = Math.min(shift, frac.length);
    shifted = whole + frac.slice(0, moved);
    frac = frac.slice(moved);
    shifted += "0".repeat(shift - moved);
  } else {
    shifted += "0".repeat(shift);
  }
  const leading = shifted.replace(/^0+(?=\d)/, "");
  const tail = frac.replace(/0+$/, "");
  return tail ? `amt${leading}.${tail}` : `amt${leading}`;
}

/*
  No separators: the punctuation strip below would take the hyphens back out
  and leave three tokens, which is a weaker key than one. `date20261002`.
*/
function canonicalDate(year: number, month: number, day: number): string {
  return `date${year}${pad2(month)}${pad2(day)}`;
}

/**
 * Fold a string to the form two spellings of the same specific agree on.
 *
 * Four things are folded, each one a false positive or a false negative the
 * pre-merge audit found:
 *
 *   1. CASE AND PUNCTUATION, and the street-suffix abbreviations in
 *      `CANONICAL_WORD`: "1941 Terry St" is "1941 Terry Street".
 *   2. AMOUNTS, to one token: "$1.2 million" and "$1,200,000" both become
 *      `amt1200000`, and "$200,000" becomes `amt200000` -- which is NOT inside
 *      it, because the comparison is on whole tokens (see below).
 *   3. DATES, to one token: "October 2nd, 2026", "Oct. 2, 2026", "2026-10-02"
 *      and "10/2/2026" all become `date2026-10-02`.
 *   4. A DIRECTIONAL prefix right after a house number: "1941 N. Terry Street"
 *      is "1941 Terry Street". Only there -- "West Virginia" keeps its West.
 *
 * The result is a space-separated token string that is compared on TOKEN
 * BOUNDARIES, not as a substring. `String.includes` alone grounds "$200,000"
 * with "$1,200,000" (the digits "200 000" really are inside "1 200 000") and
 * "941 Terry Street" with "1941 Terry Street" -- the exact "digit dropped from
 * the number" failure the rule is for.
 */
export function normaliseForGrounding(text: string): string {
  let out = text.normalize("NFKC").toLowerCase();
  out = out.replace(AMOUNT_IN_TEXT, (_m, digits: string, fraction?: string, scale?: string) =>
    ` ${canonicalAmount(digits, fraction, scale)} `,
  );
  out = out.replace(ISO_DATE_IN_TEXT, (_m, y: string, mo: string, d: string) =>
    ` ${canonicalDate(Number(y), Number(mo), Number(d))} `,
  );
  out = out.replace(SLASH_DATE_IN_TEXT, (_m, mo: string, d: string, y: string) =>
    ` ${canonicalDate(y.length === 2 ? 2000 + Number(y) : Number(y), Number(mo), Number(d))} `,
  );
  out = out.replace(MONTH_DATE_IN_TEXT, (_m, month: string, d: string, y: string) =>
    ` ${canonicalDate(Number(y), MONTH_INDEX[month] ?? 1, Number(d))} `,
  );
  const words = out
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => CANONICAL_WORD[word] ?? word);
  const kept: string[] = [];
  for (const word of words) {
    const previous = kept[kept.length - 1];
    if (DIRECTIONAL.has(word) && previous !== undefined && /^\d+$/.test(previous)) continue;
    kept.push(word);
  }
  return kept.join(" ");
}

/**
 * A corpus folded once, for the callers that judge hundreds of strings against
 * the same captures (one hop's plan is every one of its fields).
 *
 * `place` is the paper's OWN city, state and county, read from the newsroom's
 * settings and never written into this module. A name run made only of those
 * words -- "Longmont Colorado", the paper's town and the paper's state -- is
 * grounded by definition: the desk knows where it publishes from, and a rule
 * that asked a capture to prove the town's own name would drop every first-hop
 * query a state agency is scoped to. It is not a free pass for a run built
 * around a place: "Doe Longmont" is still an ungrounded person, because the
 * surname is not a place word.
 */
export type GroundingCorpus = string | {
  readonly normalised: string;
  readonly place?: readonly string[];
};

export function prepareCorpus(text: string, place?: readonly string[]): GroundingCorpus {
  return {
    normalised: normaliseForGrounding(stripMarkedSpecifics(text)),
    /*
      Folded to WORDS, not to phrases: the comparison asks whether every word of
      a name run is a place word, and "Grand Junction" has to answer for "Grand"
      and for "Junction" separately or a paper there could never name its own
      city in a two-word run.
    */
    place: place?.length
      ? [...new Set(place.flatMap((part) => normaliseForGrounding(part).split(" ")).filter(Boolean))]
      : undefined,
  };
}

function normalisedCorpus(corpus: GroundingCorpus): string {
  return typeof corpus === "string"
    ? normaliseForGrounding(stripMarkedSpecifics(corpus))
    : corpus.normalised;
}

/** The paper's own place words, folded, for a corpus that carries them. */
function placeWords(corpus: GroundingCorpus): readonly string[] {
  return typeof corpus === "string" ? [] : (corpus.place ?? []);
}

/**
 * Compare on TOKEN BOUNDARIES, by padding both sides with the space that
 * separates tokens. A plain substring test is what let "$200,000" be grounded
 * by "$1,200,000" and "941 Terry Street" by "1941 Terry Street".
 */
function containsTokens(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * The paper's place, as a corpus part on its own, so a caller that has the
 * settings and not the captures can still say where the paper publishes from.
 */
export function placeCorpus(place: {
  city?: string | null;
  state?: string | null;
  county?: string | null;
}): readonly string[] {
  return [place.city, place.state, place.county]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
}

/**
 * Take every MARKED specific out of a corpus, marker and all.
 *
 * This is what stops the rule laundering itself. A marked specific is one no
 * capture carries -- but "1749 Main Street (not in any capture yet)" still
 * CONTAINS "1749 Main Street", and the file's own summary, its hypotheses and
 * its frontier items are all things a later hop reads back. Left in, the mark
 * would be a one-hop delay rather than a refusal: hop 1 invents the address,
 * hop 2 finds it in the text hop 1 wrote down, and calls it grounded.
 *
 * Removing the whole span rather than the four words of the marker is the
 * point: what must not be in the corpus is the specific.
 *
 * Exported for the second caller with the same need: the verification lane
 * builds search queries out of a signal's own name, and a marked specific in
 * that name must be gone from the query, not merely marked. See M1 of the
 * pre-merge audit.
 */
export function stripMarkedSpecifics(text: string): string {
  if (!text.includes(UNGROUNDED_MARKER)) return text;
  const spans = findSpecifics(text).filter((specific) =>
    text.startsWith(` ${UNGROUNDED_MARKER}`, specific.index + specific.text.length),
  );
  if (!spans.length) return text;
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const specific = spans[i]!;
    const end = specific.index + specific.text.length + 1 + UNGROUNDED_MARKER.length;
    out = `${out.slice(0, specific.index)}${out.slice(end)}`;
  }
  return out;
}

/** Is this one specific present in the corpus, however either side spells it? */
export function isSpecificGrounded(specific: string, corpus: GroundingCorpus): boolean {
  const needle = normaliseForGrounding(specific);
  if (!needle) return true;
  return containsTokens(normalisedCorpus(corpus), needle);
}

/**
 * Is this specific grounded, judged by the kind of thing it is?
 *
 * A street address, an amount, a date and an identifier are grounded whole or
 * not at all -- there is no such thing as half of "1749 Main Street". A RUN OF
 * CAPITALISED WORDS is different, because English puts things next to each
 * other that are not one name: a search scoped to the paper's city writes
 * `Shakeel Dalal Exampleton`, and "Shakeel Dalal Exampleton" is in no capture.
 * A name run is therefore grounded when the whole of it is, or when a
 * contiguous part of it of two words or more is -- which is the difference
 * between "the dig cannot search for the person the lead named" and "the dig
 * cannot search for a name nothing holds".
 *
 * Two tokens is the floor, and it is what keeps this from being a loophole: a
 * lone grounded word beside an invented one ("Doe Longmont", where only the
 * city is in the corpus) grounds neither half of the invention.
 */
export function specificIsGrounded(
  specific: { kind: SpecificKind; text: string },
  corpus: GroundingCorpus,
): boolean {
  if (isSpecificGrounded(specific.text, corpus)) return true;
  if (specific.kind !== "name") return false;
  const words = normaliseForGrounding(specific.text).split(" ").filter(Boolean);
  const place = placeWords(corpus);
  // The paper's own town and state, and nothing else: "Longmont Colorado" is
  // grounded, "Doe Longmont" is not. See `GroundingCorpus`.
  if (words.length > 0 && place.length > 0 && words.every((word) => place.includes(word))) return true;
  if (words.length < 3) return false;
  const haystack = normalisedCorpus(corpus);
  for (let start = 0; start < words.length - 1; start++) {
    for (let end = start + 2; end <= words.length; end++) {
      if (end - start === words.length) continue;
      if (containsTokens(haystack, words.slice(start, end).join(" "))) return true;
    }
  }
  return false;
}

type Match = { kind: SpecificKind; text: string; index: number; end: number };

function collects(re: RegExp, text: string, kind: SpecificKind, out: Match[]): void {
  // Every pattern is either global or has no /g; guard so a stale lastIndex
  // cannot silently skip the first match of a fresh string.
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    out.push({ kind, text: m[0], index: m.index, end: m.index + m[0].length });
  }
}

function runWords(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((word) => word.replace(/[.'’]/g, "").toLowerCase())
    .filter(Boolean);
}

function isNameRun(raw: string): boolean {
  const words = runWords(raw);
  if (words.length < 2) return false;
  return words.some((word) => !NOT_A_NAME.has(word));
}

/**
 * Is this capitalised run a PERSON, which is the only name this rule is about?
 *
 * It has to be asked, because `isNameRun` answers "is this a run of capitalised
 * words that is not merely a sentence", and English capitalises agencies,
 * statutes, forms, months and the verb a sentence opens with in exactly the
 * same way. A run that names an institution is not an invented person and must
 * not be marked as one: the failure the audit found was
 * `Longmont Colorado business license`, `Colorado Open Records Act request`,
 * `Boulder County Public Health`, `Public Records Request` and
 * `Search Colorado Secretary of State` all read as invented people, so their
 * queries were dropped and the hop looked low-yield when it was the rule that
 * was wrong.
 *
 * What is left is the given-surname shape: two or more capitalised words, none
 * of them an institution word, not opening with a sentence's verb. The paper's
 * own town and state are handled where the corpus is (see `GroundingCorpus`),
 * because this function has no settings to read.
 */
function isPersonNameRun(raw: string): boolean {
  const words = runWords(raw);
  if (words.length < 2) return false;
  if (!words.some((word) => !NOT_A_NAME.has(word))) return false;
  if (words.some((word) => INSTITUTION_WORD.has(word))) return false;
  if (isSentenceOpener(words[0]!)) return false;
  return true;
}

/**
 * A capitalised run that walks over a full stop is two sentences, not one name:
 * `Searched Colorado Shines. Zip 80501 applies.` came back as the single run
 * "Colorado Shines. Zip", so the editor was shown a marker after "Zip" with no
 * way to tell which of the two names was the one nothing carried.
 *
 * An INITIAL is not a sentence end -- "Gregory P. Halloran" is one name -- so a
 * period only cuts when the token before it is a word of two letters or more
 * and carries no period of its own. "P." and "U.S." therefore survive, and
 * "Shines." does not.
 */
function cutAtSentenceEnd(match: Match): Match {
  const text = match.text;
  for (let at = text.indexOf("."); at !== -1; at = text.indexOf(".", at + 1)) {
    if (!/\s/.test(text[at + 1] ?? "")) continue;
    const before = text.slice(0, at);
    const token = before.slice(before.search(/\S+$/));
    const bare = token.replace(/\.+$/, "");
    if (bare.length < 2 || bare.includes(".")) continue;
    return { ...match, text: before, end: match.index + before.length };
  }
  return match;
}

/**
 * A name run and an address both pick up the punctuation that follows them --
 * "Gregory P. Halloran." and "2880 Elm Ave." would otherwise be marked with the
 * full stop on the wrong side of the marker. The sentence's own full stop is
 * left where it was.
 */
function trimTrailingPunctuation(match: Match): Match {
  const trimmed = match.text.replace(/[.,;:]+$/, "");
  if (!trimmed) return match;
  return { ...match, text: trimmed, end: match.index + trimmed.length };
}

/**
 * A capitalised run that begins with a grammatical word -- "The Colorado
 * Shines record" -- is the name plus the article that introduced it. The
 * article is not part of the name, and leaving it on makes a grounded name
 * look invented.
 */
function trimLeadingGrammar(match: Match): Match {
  const words = match.text.split(/\s+/);
  let first = 0;
  while (first < words.length && NOT_A_NAME.has(words[first]!.replace(/[.'’]/g, "").toLowerCase()))
    first += 1;
  const kept = words.slice(first);
  if (kept.length < 2) return { ...match, text: "", end: match.index };
  const text = kept.join(" ");
  return { ...match, text, end: match.index + text.length };
}

/**
 * Every specific in this text, in the order they appear.
 *
 * Addresses are read first and anything overlapping one is dropped, so the
 * street name inside "1749 Main Street" is not also reported as a person.
 */
export function findSpecifics(text: string): Specific[] {
  if (!text) return [];
  const found: Match[] = [];
  collects(ADDRESS, text, "address", found);
  collects(MONTH_DATE, text, "date", found);
  collects(ISO_DATE, text, "date", found);
  collects(SLASH_DATE, text, "date", found);
  collects(AMOUNT, text, "amount", found);
  collects(LONG_NUMBER, text, "identifier", found);
  collects(DOCKET, text, "identifier", found);
  collects(LETTERED_DOCKET, text, "identifier", found);
  for (const m of text.matchAll(NAME_RUN)) {
    if (m.index === undefined) continue;
    const whole: Match = { kind: "name", text: m[0], index: m.index, end: m.index + m[0].length };
    // Cut the sentence end BEFORE anything else is trimmed: once the run is
    // "Colorado Shines. Zip" the period is interior and no later trim sees it.
    const oneSentence = cutAtSentenceEnd(whole);
    if (!isNameRun(oneSentence.text) || !isPersonNameRun(oneSentence.text)) continue;
    found.push(oneSentence);
  }
  const trimmed = found
    .map((m) => (m.kind === "name" ? trimLeadingGrammar(trimTrailingPunctuation(m)) : trimTrailingPunctuation(m)))
    // A run's first word can be grammar -- "The Colorado Shines record" -- and
    // trimming it can reveal that what is left is an institution after all.
    .map((m) => (m.kind === "name" && m.text && !isPersonNameRun(m.text) ? { ...m, text: "" } : m))
    .filter((m) => m.text);
  trimmed.sort((a, b) => a.index - b.index || b.end - a.end);
  /*
    A long name comes back as more than one run, because the pattern caps a run
    at four capitalised words: "Front Range Municipal Solutions LLC Longmont"
    arrives as "Front Range Municipal Solutions" and "LLC Longmont". They are
    one name, and they are only judged correctly as one -- the second half on
    its own is grounded by nothing. Runs that touch, with nothing but space
    between them, are joined.
  */
  for (let i = 0; i < trimmed.length - 1; i++) {
    const current = trimmed[i]!;
    const next = trimmed[i + 1]!;
    if (current.kind !== "name" || next.kind !== "name") continue;
    if (!/^\s+$/.test(text.slice(current.end, next.index))) continue;
    trimmed[i] = {
      kind: "name",
      text: `${current.text} ${next.text}`,
      index: current.index,
      end: next.end,
    };
    trimmed.splice(i + 1, 1);
    i -= 1;
  }
  const kept: Match[] = [];
  let furthest = -1;
  for (const m of trimmed) {
    if (m.index < furthest) continue;
    kept.push(m);
    furthest = m.end;
  }
  return kept.map(({ kind, text: raw, index }) => ({ kind, text: raw, index }));
}

/** The specifics in this text that nothing in the corpus carries. */
export function ungroundedSpecifics(text: string, corpus: GroundingCorpus): UngroundedSpecific[] {
  return findSpecifics(text)
    .filter((specific) => !specificIsGrounded(specific, corpus))
    .map(({ kind, text: raw }) => ({ kind, text: raw }));
}

function alreadyMarked(text: string, end: number): boolean {
  return text.startsWith(` ${UNGROUNDED_MARKER}`, end);
}

/**
 * Every URL, path-like token and email address in the text, as spans.
 *
 * A specific inside one of these is not a specific: `…/View/123456/Agenda.pdf`
 * carries a five-digit number, and an amount or a date can sit in a query
 * string. The marker cannot go inside one -- a URL with
 * `(not in any capture yet)` spliced into its path is a URL the fetcher cannot
 * reach, and the page the editor was promised is never read. These tokens are
 * judged WHOLE, elsewhere, or not at all.
 */
const URL_TOKEN = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>"'`]+|[\w.+-]+@[\w-]+\.[\w.-]+/giu;

function urlSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  URL_TOKEN.lastIndex = 0;
  for (const m of text.matchAll(URL_TOKEN)) {
    if (m.index === undefined) continue;
    const token = m[0].replace(/[.,;:)\]}'"]+$/, "");
    spans.push({ start: m.index, end: m.index + token.length });
  }
  return spans;
}

function insideUrl(spans: { start: number; end: number }[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

/** Is this one label a URL (or a path), which is never edited, only kept whole? */
export function isUrlLike(text: string): boolean {
  return /^\s*(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i.test(text);
}

/**
 * The same text with every ungrounded specific marked in place.
 *
 * Byte-for-byte unchanged when everything in it is grounded, which is the
 * common case and the one that must stay invisible.
 */
export function markUngroundedSpecifics(text: string, corpus: GroundingCorpus): string {
  if (!text) return text;
  const spans = urlSpans(text);
  const pending = findSpecifics(text).filter(
    (specific) =>
      !specificIsGrounded(specific, corpus) &&
      !alreadyMarked(text, specific.index + specific.text.length) &&
      !insideUrl(spans, specific.index, specific.index + specific.text.length),
  );
  if (!pending.length) return text;
  let out = text;
  for (let i = pending.length - 1; i >= 0; i--) {
    const specific = pending[i]!;
    const end = specific.index + specific.text.length;
    out = `${out.slice(0, end)} ${UNGROUNDED_MARKER}${out.slice(end)}`;
  }
  return out;
}

/**
 * Why this query may not be run, or `null` if it may.
 *
 * Returns the specific it named, so the run file can say what was dropped
 * rather than only that something was.
 */
export function queryNamesUngroundedSpecific(query: string, corpus: GroundingCorpus): string | null {
  const specific = ungroundedSpecifics(query, corpus)[0];
  return specific ? specific.text : null;
}

/** True when a model-written string may be written down or searched for as it stands. */
export function isDurableTextGrounded(text: string, corpus: GroundingCorpus): boolean {
  return ungroundedSpecifics(text, corpus).length === 0;
}

/**
 * The same string with the marker taken off the specifics a LATER capture has
 * since corroborated, and left on the ones still nothing carries.
 *
 * The marker is a statement about the file at the moment it was written: "no
 * capture here carries this". A hop that later reads the licensing record makes
 * that statement false, and a stale marker is not a harmless relic -- it is a
 * sentence the editor reads that the file no longer supports, and (M3 of the
 * audit) it is text a search query gets built out of. Grounded specifics lose
 * the marker; the rest keep it.
 */
export function unmarkGroundedSpecifics(text: string, corpus: GroundingCorpus): string {
  if (!text.includes(UNGROUNDED_MARKER)) return text;
  const marked = findSpecifics(text).filter((specific) =>
    text.startsWith(MARKER_SUFFIX, specific.index + specific.text.length),
  );
  let out = text;
  for (let i = marked.length - 1; i >= 0; i--) {
    const specific = marked[i]!;
    if (!specificIsGrounded(specific, corpus)) continue;
    const end = specific.index + specific.text.length;
    out = `${out.slice(0, end)}${out.slice(end + MARKER_SUFFIX.length)}`;
  }
  return out;
}

/**
 * Hold one whole hop to the grounding rule before any of it is written down.
 *
 * Applied where the plan is complete and the corpus is known -- in
 * `researchLoop`, after `parsePlan` and before `persistPlan`, the searches and
 * the summary write -- so a caller that injects its own planner is held to the
 * same rule as the production one.
 *
 * Non-mutating: returns a copy. The `droppedQueries` it returns are the ones
 * the caller must NOT run, so the caller can say so in the run file rather than
 * looking like a run that had nothing to do.
 */
export function groundPlan(
  plan: HopPlan,
  corpus: GroundingCorpus,
): { plan: HopPlan; droppedQueries: { query: string; named: string }[] } {
  const out = structuredClone(plan) as HopPlan;
  const droppedQueries: { query: string; named: string }[] = [];
  const groundQueryList = (queries: string[]): string[] =>
    queries.filter((query) => {
      const named = queryNamesUngroundedSpecific(query, corpus);
      if (named) {
        droppedQueries.push({ query, named });
        return false;
      }
      return true;
    });
  const ground = (text: string): string => markUngroundedSpecifics(text, corpus);

  out.searches = groundQueryList(out.searches);
  out.summary = ground(out.summary);
  out.questions = out.questions.map(ground);
  for (const entity of out.entities) {
    /*
      `name` is NOT marked, and `evidence` on the relationships and claims below
      is not either. Those three are keys, not prose: the entity's name is the
      canonical identity the resolver dedupes and merges on, and an evidence
      string is what `resolveProvenance` looks for inside the captures. A marker
      appended to either would make "Jane Smith (not in any capture yet)" a
      different person from "Jane Smith", and a marked excerpt a quote that is
      no longer in the page it was quoted from. The invented-name problem in
      those fields is the resolver's, and it already keeps an unresolved
      identity open on purpose rather than guessing.
    */
    entity.why = ground(entity.why);
  }
  for (const hypothesis of out.hypotheses) {
    hypothesis.text = ground(hypothesis.text);
    hypothesis.supporting = ground(hypothesis.supporting);
    hypothesis.contradicting = ground(hypothesis.contradicting);
  }
  for (const claim of out.claims) claim.text = ground(claim.text);
  for (const item of out.frontier) {
    /*
      A URL LABEL IS NEVER GROUNDED, because grounding it breaks it.
      `persistPlan` files a frontier item whose label IS the address of the
      document to read, and `investigate.ts` hands that label straight to the
      fetcher. A council packet's URL carries a five-digit document id, and
      LONG_NUMBER matches it -- so the marker was spliced into the middle of the
      path and the dig spent the hop fetching a URL that cannot exist.
      `boundedFrontierItems` validates these labels BEFORE `groundPlan` runs, so
      nothing downstream re-checks one. `why` is prose and is still marked --
      that is where the editor reads what the model was reaching for.
    */
    if (!isUrlLike(item.label)) item.label = ground(item.label);
    item.why = ground(item.why);
    item.queries = groundQueryList(item.queries ?? []);
  }
  for (const anomaly of out.anomalies) anomaly.summary = ground(anomaly.summary);
  for (const dead of out.dead_ends) {
    dead.hypothesis = ground(dead.hypothesis);
    dead.reason = ground(dead.reason);
  }
  return { plan: out, droppedQueries };
}
