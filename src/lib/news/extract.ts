export type ExtractedRef = { kind: string; value: string };

import { PAPER } from "../paper.ts";
import { scopedQuery, type ResearchScope } from "./research-scope.ts";

const LLC_RE =
  /\b([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,5}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?))\b/g;
/*
  Unit U25, B2. `po` used to be a bare alternative here, and `\b` before it only
  anchors the START of the word: `\bpo` matches the first two letters of any
  word beginning with them, and `([A-Z0-9][A-Z0-9/-]{3,})` then eats the rest.

  Measured on the Kid City USA file of 2026-09-30, every one of these came from
  a page about the word "under", and every one became a real query:

    "Portuguese" -> po + "rtuguese"   "points" -> po + "ints"
    "popular"    -> po + "pular"      "position" -> po + "SITION"
    "Pollock"    -> po + "llock"      "pointedly" -> po + "intedly"

  which is where `"SITION" RFP Longmont` and `"ints" RFP Longmont` came from --
  the two queries whose Bing results the desk then read as sources. `po` as a
  whole word ("PO #12345") still matches.
*/
const CONTRACT_RE = /\b(?:contract|agreement|po|purchase order)\b\s*#?\s*([A-Z0-9][A-Z0-9/-]{3,})\b/gi;
const RFP_RE = /\b(?:RFP|RFQ|IFB)[\s#:.-]*([A-Z0-9][A-Z0-9/-]{2,})\b/gi;
const ORD_RE = /\b(?:ordinance|resolution)\s*(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/gi;
const PARCEL_RE = /\b(?:parcel|AIN|assessor(?:'s)? (?:id|number)|PIN)\s*[:#]?\s*([A-Z0-9-]{5,})\b/gi;
/*
  Unit U25, B2. `under` is not a citation phrase, it is an English preposition,
  and matching it turned whole sentences into "references" -- the run's frontier
  filled with `under that name in our state`, `under` and eventually dictionary
  idioms, and the dig spent a whole round on the string "under". The phrases
  kept below all introduce a document or a record; `under` alone introduces
  whatever noun happens to follow it.
*/
const DATED_RE =
  /\b(?:pursuant to|according to|as previously approved|amended by|per section|see attachment|as discussed(?: at)?|prepared by|submitted by)\b[^.\n]{5,120}/gi;
const URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;
const AGENT_RE =
  /\b(?:registered agent|principal|prepared by|submitted by|applicant)\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
const CASE_RE = /\b((?:PLN|SP|CUP|ANX|PLAN)[- ]?\d{2,4}[- ]?\d+)\b/gi;
const MONEY_RE = /\$[\d,]+(?:\.\d{2})?/g;

/**
 * Whether `value` appears in the haystack as a whole word rather than inside one.
 *
 * Unit U25, B2's backstop. Every one of the junk values this run produced --
 * `SITION`, `ints`, `rtuguese`, `pular`, `llock`, `intedly` -- was a substring
 * of a longer word that a regex's capture group happened to start inside. A
 * value that never appears between word boundaries in the text it came from is
 * not a name, a number or an identifier; it is the tail of one.
 *
 * The regexes that produced them are anchored properly now (`CONTRACT_RE`), so
 * this is the general rule rather than the specific repair: any future pattern
 * that captures from mid-word is caught here instead of becoming a query.
 */
function appearsAsWholeWord(haystack: string, value: string): boolean {
  const needle = value.toLowerCase().replace(/\s+/g, " ");
  if (!needle) return false;
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[a-z0-9]/i.test(ch);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

export function extractReferences(text: string): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();
  /*
    Lower-cased and whitespace-collapsed ONCE per call rather than per
    candidate: this runs over the whole retrieved pack, up to 24,000 characters,
    and a page can yield eighty candidates.
  */
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const push = (kind: string, value: string) => {
    const v = value.replace(/\s+/g, " ").trim().slice(0, 240);
    if (v.length < 3) return;
    // A URL is its own value and is written as written; everything else has to
    // be a word the text actually contains, not a slice out of the middle.
    if (kind !== "url" && !appearsAsWholeWord(haystack, v)) return;
    const key = `${kind}:${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v });
  };
  let m: RegExpExecArray | null;
  LLC_RE.lastIndex = 0;
  while ((m = LLC_RE.exec(text))) push("company", m[1]!);
  CONTRACT_RE.lastIndex = 0;
  while ((m = CONTRACT_RE.exec(text))) push("contract", m[1]!);
  RFP_RE.lastIndex = 0;
  while ((m = RFP_RE.exec(text))) push("rfp", m[0]!.replace(/\s+/g, " "));
  ORD_RE.lastIndex = 0;
  while ((m = ORD_RE.exec(text))) push("legislation", m[0]!.replace(/\s+/g, " "));
  PARCEL_RE.lastIndex = 0;
  while ((m = PARCEL_RE.exec(text))) push("parcel", m[1]!);
  DATED_RE.lastIndex = 0;
  while ((m = DATED_RE.exec(text))) push("reference", m[0]!);
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    push("url", m[0]!.replace(/[.,;:]+$/, ""));
  }
  AGENT_RE.lastIndex = 0;
  while ((m = AGENT_RE.exec(text))) push("person", m[1]!);
  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) push("planning", m[1]!);
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(text))) push("amount", m[0]!);
  return out.slice(0, 80);
}

const SUBJECT_VERBS =
  /\s+(?:opens?|announces?|plans?|files?|launches?|builds?|breaks?|wins?|hires?|expands?|moves?|relocates?)\b/i;

/** Names in a headline that are not LLC-suffixed — "Ursa Major" from "Ursa Major opens …". */
export function namedSubjects(text: string, scope: ResearchScope): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  /*
    The paper's own city and state are places a story is about, not subjects of
    it: "Longmont City Council" and "Colorado regulators" are the desk's own
    beat, and a subject would put them in a quoted search. They come from the
    configured place, so another city's paper suppresses its own town's name --
    this list used to name the shipped paper's, and nothing else.
  */
  const stopWords = new Set([
    "the", "a", "an", "this", "city", "county", "new",
    ...[scope.city, scope.state].flatMap((name) => name.trim().toLowerCase().split(/\s+/)),
  ]);
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 4 || t.length > 80) return;
    const first = t.split(/\s+/)[0]!.toLowerCase();
    if (stopWords.has(first)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  const head = (text.split(/[\n.]/)[0] ?? text).trim();
  const parts = head.split(SUBJECT_VERBS);
  if (parts[0] && parts.length > 1) {
    const name = parts[0].replace(/^[^A-Za-z]+/, "").trim();
    if (/^[A-Z]/.test(name) && name.split(/\s+/).length <= 5) push(name);
  }
  const runs = text.match(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){1,3})\b/g) ?? [];
  for (const run of runs.slice(0, 8)) {
    if (/^(City Council|United States)\b/i.test(run)) continue;
    push(run);
  }
  return out.slice(0, 6);
}

export function primarySourceQueries(
  headline: string,
  subjects: string[],
  scope: ResearchScope,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const city = scope.city.trim();
  const add = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 8) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  if (!subjects.length) return out;
  add(`${headline} press release`);
  for (const s of subjects.slice(0, 4)) {
    add(scopedQuery([`"${s}"`, city, "press release OR announcement OR newsroom"]));
    add(`"${s}" press-release OR /media/ OR /newsroom`);
  }
  return out.slice(0, 6);
}

export function primarySourceScore(url: string, subjects: string[]): number {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.toLowerCase();
    let s = 0;
    if (/press[-_]?release|\/media\/|\/newsroom\/|\/news\//.test(path)) s += 4;
    if (/\.gov$/i.test(host)) s += 3;
    const hostKey = host.replace(/[^a-z0-9]/g, "");
    for (const n of subjects) {
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (slug.length >= 4 && hostKey.includes(slug.slice(0, 10))) s += 5;
    }
    const pathOnly = path.replace(/\/+$/, "") || "/";
    if (pathOnly === "/" || /^\/(local-news|news|latest)$/i.test(pathOnly)) s -= 4;
    return s;
  } catch {
    return 0;
  }
}

export function preferPrimaryUrls(urls: string[], subjects: string[]): string[] {
  return [...urls].sort((a, b) => primarySourceScore(b, subjects) - primarySourceScore(a, subjects) || b.length - a.length);
}

/**
 * Why this query must not be sent to a search provider, or `null` if it may.
 *
 * Unit U25, B2. The dig's fallback path derived searches from whatever text it
 * had -- captured pages included -- and so searched for scraped page titles,
 * whole sentences and URL prefixes. Measured on the Kid City USA walkthrough,
 * these all reached a provider:

 *   `"Under - Paducah, KY 42001 - Menu, Reviews, Hours &amp; Contact — https://restaurantjump" Longmont …`
 *   `"UNDER Definition &amp; Meaning - Merriam-Webster — https://merriam-webster" Longmont …`
 *   `"under that name in our state" Longmont …`
 *   `"ints" RFP Longmont …`   `"SITION" RFP Longmont …`   `"after" Longmont contract …`

 * A query is a search for a *thing*, and each of these is a slice of a *page*.
 * The reasons are named rather than lumped into one boolean so the run file can
 * say which rule dropped what, and so a test can hold each rule to its own
 * string. The caller caps and de-duplicates what survives; this only judges.
 */
export function junkQueryReason(query: string): string | null {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q) return "empty query";
  if (q.length > 200) return "a query longer than a sentence is a page, not a search";
  if (/https?:\/\/|www\./i.test(q)) return "the query contains an address";
  if (/&(?:amp|quot|lt|gt|nbsp|#\d+);/i.test(q)) return "the query contains scraped page markup";
  /*
    A page title arrives welded to its own site name -- `TITLE — host` or
    `Site | Section | Title` -- which no search for a record looks like.
  */
  if (/\S\s+—\s+\S/.test(q) || /\S\s+\|\s+\S.*\|\s*\S/.test(q))
    return "the query contains a page title";
  for (const quoted of q.match(/"([^"]*)"/g) ?? []) {
    const phrase = quoted.slice(1, -1).trim();
    if (!phrase) return "the query quotes nothing";
    const words = phrase.split(/\s+/);
    /*
      A quoted phrase of a sentence's length is a sentence the extractor picked
      up, not a thing anybody names. The longest phrases the desk writes itself
      are two words -- `"registered agent"`, `"normal process"`, `"according
      to"` -- and the longest real names it derives are five.
    */
    if (words.length > 5) return "a quoted sentence, not a search term";
    if (!/[a-z]/i.test(phrase)) return "a number or punctuation, not a name";
    if (!words.some((word) => /[a-z]{4,}/i.test(word.replace(/[^a-z0-9]/gi, ""))))
      return "a quoted fragment shorter than a word";
    /*
      `"under"`, `"after"`, `"ints"` -- one ordinary lowercase word in quotes is
      a word the desk pulled out of prose, not the name of anything. A real
      single-word subject is a proper noun or an identifier, so it carries a
      capital, a digit or a hyphen; the operators the desk writes itself
      (`"registered agent"`, `"normal process"`) are two words or more.
    */
    if (words.length === 1 && /^[a-z]{3,}$/.test(phrase))
      return "a quoted common word, not a name";
    /*
      `"SITION"` -- a run of capitals that is neither a name nor a short code.
      A name is written the way names are written (mixed case, a digit, a
      hyphen, a suffix -- "Kid City USA", "RFP-2024-09", "CDPHE"); a lone
      all-caps word of six characters or more out of a page of prose is the
      back half of a longer one. This is where "POSITION" went.
    */
    const only = words[0]!;
    if (words.length === 1 && !/[a-z]/.test(only.slice(1)) && !/[\d.\-/&']/.test(only) && only.length > 5)
      return "a fragment in capitals, not a name or a code";
  }
  return null;
}

/** `junkQueryReason`, kept as a filter for callers that only want the survivor list. */
export function isUsableQuery(query: string): boolean {
  return junkQueryReason(query) === null;
}

export function queriesForRef(ref: ExtractedRef, scope: ResearchScope): string[] {
  const v = ref.value;
  const city = scope.city.trim();
  const state = scope.state.trim();
  switch (ref.kind) {
    case "company":
      return [
        scopedQuery([`"${v}"`, city, "press release OR announcement OR newsroom"]),
        scopedQuery([`"${v}"`, city]),
        scopedQuery([`"${v}"`, `"registered agent"`, state]),
        `"${v}" campaign contribution`,
        `"${v}" contract OR RFP OR bid`,
      ];
    case "contract":
      return [scopedQuery([`"${v}"`, city, "contract"]), `"${v}" RFP`];
    case "rfp":
      return [scopedQuery([v, city]), `${v} proposal`];
    case "parcel":
      return [scopedQuery(["parcel", v, city]), scopedQuery([v, "assessor", city])];
    case "legislation":
      return [scopedQuery([v, city]), `${v} minutes`];
    case "person":
      return [
        scopedQuery([`"${v}"`, city]),
        scopedQuery([`"${v}"`, `"registered agent"`, state]),
        `"${v}" campaign contribution`,
        `"${v}" planning`,
      ];
    case "planning":
      return [scopedQuery([v, city]), `${v} planning`, `${v} campaign contribution`];
    case "url":
      return [];
    default:
      return [scopedQuery([`"${v}"`, city])];
  }
}

export function heuristicPlan(
  text: string,
  tried: Set<string>,
  scope: ResearchScope,
  searchesPerHop = 3,
  fetchesPerHop = 4,
): {
  searches: string[];
  fetch_urls: string[];
  frontier: { label: string; kind: string; why: string; priority: number; queries: string[] }[];
  summary: string;
} {
  const refs = extractReferences(text);
  const searches: string[] = [];
  const fetch_urls: string[] = [];
  const frontier: {
    label: string;
    kind: string;
    why: string;
    priority: number;
    queries: string[];
  }[] = [];
  const searched = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "url") fetch_urls.push(ref.value);
    else {
      /*
        Unit U25, B2: the queries a reference generates are judged before they
        are written down, not only before they are run. A junk query that lands
        in `pendingQueries` is re-run on the next hop by the frontier fill, so
        filtering at the search only would leave the file full of them.
      */
      const queries = queriesForRef(ref, scope).filter(isUsableQuery);
      frontier.push({
        label: ref.value,
        kind: ref.kind,
        why: "Referenced in evidence; not yet searched",
        priority: ref.kind === "company" || ref.kind === "contract" ? 9 : 6,
        queries,
      });
      for (const q of queries) {
        if (tried.has(q) || searched.has(q)) continue;
        searched.add(q);
        searches.push(q);
      }
    }
  }
  return {
    searches: searches.slice(0, searchesPerHop),
    fetch_urls: fetch_urls.slice(0, fetchesPerHop),
    frontier,
    summary: `Heuristic hop: ${Math.min(searches.length, searchesPerHop)} searches, ${Math.min(fetch_urls.length, fetchesPerHop)} fetches, ${frontier.length} frontier items.`,
  };
}

export type BaselineEvent = { key: string; at: Date; title: string; url: string };

export function detectMissingCadence(
  events: BaselineEvent[],
  now: Date,
  cadenceDays: number,
  graceDays = 7,
): { key: string; daysLate: number; lastSeen: Date; title: string; url: string }[] {
  const last = new Map<string, BaselineEvent>();
  for (const e of events) {
    const prev = last.get(e.key);
    if (!prev || e.at > prev.at) last.set(e.key, e);
  }
  const out: { key: string; daysLate: number; lastSeen: Date; title: string; url: string }[] = [];
  for (const e of last.values()) {
    const days = (now.getTime() - e.at.getTime()) / 86400000;
    const late = days - cadenceDays;
    if (late > graceDays) {
      out.push({
        key: e.key,
        daysLate: Math.round(late),
        lastSeen: e.at,
        title: e.title,
        url: e.url,
      });
    }
  }
  return out;
}

export function nthWeekday(d: Date, timeZone: string = PAPER.timezone): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    timeZone,
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value || "1");
  const wd = parts.find((p) => p.type === "weekday")?.value || "Thursday";
  const n = Math.ceil(day / 7);
  return `${n}-${wd}`;
}

export type StructureSnapshot = {
  title: string;
  attachmentCount: number;
  hasAppendixC: boolean;
  headingCount: number;
  length: number;
};

export function structureSnapshot(title: string, text: string, extras: string[] = []): StructureSnapshot {
  return {
    title,
    attachmentCount: extras.length,
    hasAppendixC: /appendix\s*c/i.test(text),
    headingCount: (text.match(/\b(agenda|minutes|staff report|ordinance|resolution|consent)\b/gi) ?? []).length,
    length: text.length,
  };
}

export type PatternAnomaly = {
  kind: string;
  summary: string;
  details: string;
};

export function detectPatternAnomalies(opts: {
  previous: StructureSnapshot | null;
  current: StructureSnapshot;
  usualNthWeekday?: string | null;
  observedAt?: Date;
  usualAttachmentCount?: number | null;
  usualLeadHours?: number | null;
  currentLeadHours?: number | null;
}): PatternAnomaly[] {
  const out: PatternAnomaly[] = [];
  const prev = opts.previous;
  if (prev) {
    if (prev.title && opts.current.title && prev.title !== opts.current.title) {
      out.push({
        kind: "renamed",
        summary: `Title changed from "${prev.title}" to "${opts.current.title}"`,
        details: "Recurring record appears under a new title.",
      });
    }
    if (prev.attachmentCount > 0 && opts.current.attachmentCount < prev.attachmentCount) {
      out.push({
        kind: "attachment-omitted",
        summary: `Attachments dropped from ${prev.attachmentCount} to ${opts.current.attachmentCount}`,
        details: "Packet normally includes more attachments than this capture.",
      });
    }
    if (prev.hasAppendixC && !opts.current.hasAppendixC) {
      out.push({
        kind: "structurally-altered",
        summary: "Expected Appendix C is absent",
        details: "Prior capture of this recurring record included Appendix C.",
      });
    }
    if (prev.length > 2000 && opts.current.length < prev.length * 0.4) {
      out.push({
        kind: "structurally-altered",
        summary: "Recurring document is much shorter than the learned baseline",
        details: `Prior length ${prev.length}, current ${opts.current.length}.`,
      });
    }
  }
  if (
    opts.usualNthWeekday &&
    opts.observedAt &&
    nthWeekday(opts.observedAt) !== opts.usualNthWeekday
  ) {
    out.push({
      kind: "cadence-shifted",
      summary: `Expected ${opts.usualNthWeekday}, observed ${nthWeekday(opts.observedAt)}`,
      details: "Publication weekday/nth pattern shifted from the learned baseline.",
    });
  }
  if (
    opts.usualAttachmentCount != null &&
    opts.usualAttachmentCount > 0 &&
    opts.current.attachmentCount < opts.usualAttachmentCount
  ) {
    out.push({
      kind: "attachment-omitted",
      summary: `Usual attachment count ${opts.usualAttachmentCount}, this capture ${opts.current.attachmentCount}`,
      details: "Learned packet structure is missing attachments.",
    });
  }
  if (
    opts.usualLeadHours != null &&
    opts.usualLeadHours >= 24 &&
    opts.currentLeadHours != null &&
    opts.currentLeadHours < opts.usualLeadHours * 0.5
  ) {
    out.push({
      kind: "late",
      summary: `Posted ${opts.currentLeadHours}h before the meeting; usual lead is ${opts.usualLeadHours}h`,
      details: "Agenda or packet arrived later than the learned posting window.",
    });
  }
  return out;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Best-effort meeting/hearing date from civic titles and headers. */
export function extractMeetingInstant(text: string): Date | null {
  const named = text.match(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},\\s+20\\d{2}\\b`, "i"));
  if (named) {
    const d = new Date(`${named[0]} UTC`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function leadHoursBefore(captured: Date, meeting: Date): number | null {
  const h = (meeting.getTime() - captured.getTime()) / 3600000;
  if (h <= 0 || h > 24 * 21) return null;
  return Math.round(h);
}

export function diffExcerpt(prev: string, next: string): string {
  if (prev === next) return "";
  if (!next) return "Content removed.";
  if (!prev) return "Content appeared.";
  const a = new Set(prev.split(/\s+/).filter((w) => w.length > 4));
  const b = next.split(/\s+/).filter((w) => w.length > 4);
  const added = b.filter((w) => !a.has(w)).slice(0, 24);
  const prevWords = prev.split(/\s+/).filter((w) => w.length > 4);
  const nextSet = new Set(b);
  const removed = prevWords.filter((w) => !nextSet.has(w)).slice(0, 24);
  return [
    removed.length ? `Removed: ${removed.join(" ")}` : "",
    added.length ? `Added: ${added.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function classifyClaimKind(raw: string): string {
  const k = raw.trim().toUpperCase();
  if (
    k === "FACT" ||
    k === "OBSERVATION" ||
    k === "ALLEGATION" ||
    k === "INFERENCE" ||
    k === "HYPOTHESIS" ||
    k === "UNKNOWN"
  ) {
    return k;
  }
  return "UNKNOWN";
}

/**
 * Normalized key for comparing two URLs that point at the same page.
 * Host case and a `www.` prefix and a trailing slash are not differences.
 * The query IS kept: `?meetingId=1` and `?meetingId=2` are different records.
 */
function urlKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return `${host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * A page that only lists other pages: the bare homepage of a site, and tag,
 * author or category archives.
 *
 * Deliberately narrow. Anything that might be a record — a PDF, an agenda, a
 * meeting portal page, a press release — must survive, so this matches only
 * shapes that are navigation by construction.
 */
function isListingPath(raw: string): boolean {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path || path === "/") return !u.search;
    return /^\/(tag|tags|category|categories|author|topics|section)\//.test(`${path}/`);
  } catch {
    return false;
  }
}

/**
 * A section front on a publisher we already watch — `/sports/high-school-sports/`
 * on the Times-Call, `/local-news` on the Leader.
 *
 * Three conditions together, because any one alone throws away records:
 *
 *  - The host must be one we watch. `frprdistrict.com/about-the-district` has
 *    the same shape and is a real page about a real district.
 *  - The host must not be a `.gov`. Government section pages ARE the record
 *    index — `longmontcolorado.gov/city-clerk/election-information/` is exactly
 *    the kind of page a story should cite.
 *  - Every path segment must be a short, digit-free word. Article URLs on these
 *    same publishers carry a date (`/2026/08/12/…`) or a long headline slug;
 *    section names do not.
 */
function isWatchedSectionFront(raw: string, watchedHosts: Set<string>): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    if (host.endsWith(".gov")) return false;
    if (!watchedHosts.has(host)) return false;
    return looksLikeSectionFront(raw);
  } catch {
    return false;
  }
}

/**
 * The URL shape of a section front: `/sports/high-school-sports/`, `/local-news`.
 *
 * Article URLs on the same publishers carry a date or a long headline slug;
 * section names are short, wordy and dateless. Used both to keep section fronts
 * out of a story's source list and to stop the body linking a paper's name to
 * one — "the Longmont Times-Call reported" pointed at the paper's high-school
 * sports section for a story about a rail tax.
 */
export function looksLikeSectionFront(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.search) return false;
    const segs = u.pathname.split("/").filter(Boolean);
    if (!segs.length || segs.length > 2) return false;
    return segs.every((seg) => seg.length < 25 && /^[a-z-]+$/i.test(seg));
  } catch {
    return false;
  }
}

/**
 * Strip the pages a story was found *through* from the list of pages it was
 * sourced *from*.
 *
 * The scan feeds the watch list's own pages to the writing pass as evidence, so
 * the writer cites them back: a rail-district story came out sourced to the
 * Times-Call high-school-sports section and the paper's homepage. Those are
 * where the lead was spotted, not where any fact in the story came from.
 *
 * Falls back to the input when everything would be dropped. An empty list hides
 * the provenance panel entirely, which is the opposite of what this is for.
 */
export function dropListingUrls(
  urls: string[],
  watched: string[] = [],
  /**
   * Return an empty list rather than falling back to the input.
   *
   * The fallback exists so a published story never shows an empty provenance
   * panel. When the caller is deciding which sites to go looking on, an empty
   * answer is the correct one — falling back handed a rail district's board
   * packet hunt to the local paper's homepage.
   */
  allowEmpty = false,
): string[] {
  const watchedKeys = new Set(watched.map(urlKey));
  const watchedHosts = new Set<string>();
  for (const w of watched) {
    try {
      watchedHosts.add(new URL(w).hostname.replace(/^www\./i, "").toLowerCase());
    } catch {
      /* not a URL — cannot contribute a host */
    }
  }
  const kept = urls.filter(
    (u) =>
      !isListingPath(u) &&
      !watchedKeys.has(urlKey(u)) &&
      !isWatchedSectionFront(u, watchedHosts),
  );
  return kept.length || allowEmpty ? kept : urls;
}
