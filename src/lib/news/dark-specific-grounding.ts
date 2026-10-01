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
 * Fold a string to the form two spellings of the same specific agree on:
 * case, punctuation and the abbreviations in `CANONICAL_WORD`.
 */
export function normaliseForGrounding(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => CANONICAL_WORD[word] ?? word)
    .join(" ");
}

/**
 * A corpus folded once, for the callers that judge hundreds of strings against
 * the same captures (one hop's plan is every one of its fields).
 */
export type GroundingCorpus = string | { readonly normalised: string };

export function prepareCorpus(text: string): GroundingCorpus {
  return { normalised: normaliseForGrounding(stripMarkedSpecifics(text)) };
}

function normalisedCorpus(corpus: GroundingCorpus): string {
  return typeof corpus === "string"
    ? normaliseForGrounding(stripMarkedSpecifics(corpus))
    : corpus.normalised;
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
 */
function stripMarkedSpecifics(text: string): string {
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
  return normalisedCorpus(corpus).includes(needle);
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
  if (words.length < 3) return false;
  const haystack = normalisedCorpus(corpus);
  for (let start = 0; start < words.length - 1; start++) {
    for (let end = start + 2; end <= words.length; end++) {
      if (end - start === words.length) continue;
      if (haystack.includes(words.slice(start, end).join(" "))) return true;
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

function isNameRun(raw: string): boolean {
  const words = raw
    .split(/\s+/)
    .map((word) => word.replace(/[.'’]/g, "").toLowerCase())
    .filter(Boolean);
  if (words.length < 2) return false;
  return words.some((word) => !NOT_A_NAME.has(word));
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
    if (m.index === undefined || !isNameRun(m[0])) continue;
    found.push({ kind: "name", text: m[0], index: m.index, end: m.index + m[0].length });
  }
  const trimmed = found
    .map((m) => (m.kind === "name" ? trimLeadingGrammar(trimTrailingPunctuation(m)) : trimTrailingPunctuation(m)))
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
 * The same text with every ungrounded specific marked in place.
 *
 * Byte-for-byte unchanged when everything in it is grounded, which is the
 * common case and the one that must stay invisible.
 */
export function markUngroundedSpecifics(text: string, corpus: GroundingCorpus): string {
  if (!text) return text;
  const pending = findSpecifics(text).filter(
    (specific) => !specificIsGrounded(specific, corpus) && !alreadyMarked(text, specific.index + specific.text.length),
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
    item.label = ground(item.label);
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
