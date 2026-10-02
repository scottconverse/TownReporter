/**
 * Turning one line of a reporter's to-do list into an actual document hunt.
 *
 * The first version did the naive thing: take the line, run one keyword search,
 * open the top three hits. Handed the line "Get the district board's adopted
 * resolution and the certified ballot title text…" it returned three parcel-tax
 * resolutions from school districts in California, and wrote all of them into
 * the reporter's notes as if they were the record. Nothing in the pipeline
 * noticed that not one of them mentioned Colorado.
 *
 * Three separate defects, so three separate pieces here:
 *
 *  - `pullQueries` — one line becomes several short, anchored searches instead
 *    of one 240-character run-on that matches only its own generic nouns.
 *  - `docCandidateHosts` / `docIndexPages` — a board packet is usually not in
 *    any search index. It lives behind the issuing body's own meetings page, so
 *    go there and read the links — but only on a government or registered
 *    source's own host, because the guess is only ever right for a body that
 *    publishes records. See `isOfficialDocHost`.
 *  - `isOnSubject` — a fetched document that never names the city or the
 *    subject is not the record, whatever it scored. Drop it and report nothing
 *    found rather than poisoning the notes.
 */

import { isOnDomains } from "./absence-gate.ts";

const STOP = new Set([
  "the", "and", "then", "those", "that", "with", "from", "for", "are", "was",
  "get", "find", "any", "its", "their", "this", "these", "two", "both",
  "documents", "document", "text", "prior", "first", "likely", "discussed",
  "settle", "between", "whether", "what", "which", "full", "exact",
]);

/** Words worth searching on: long enough to mean something, not scaffolding. */
function keywords(line: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of line.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/**
 * Split a to-do line into up to `max` searches.
 *
 * A line that names several documents ("the resolution and the ballot title.
 * Then the board packet and minutes…") is split on sentence and clause breaks,
 * because each clause names a different record and they are not found by the
 * same query. Every query is anchored with the subjects and the city, which is
 * what stops "adopted resolution ballot title" drifting to San Mateo County.
 */
export function pullQueries(
  line: string,
  subjects: string[],
  city: string,
  max = 4,
): string[] {
  const anchor = [subjects[0], city].filter(Boolean).join(" ").trim();
  const clauses = line
    .split(/(?:[.;]|\bThen\b|\band then\b)/i)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c) => keywords(c).length >= 2);

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim().slice(0, 200);
    if (t.length < 8) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const clause of clauses.length ? clauses : [line]) {
    // Keep the clause's own words, but trimmed to the ones that carry meaning,
    // so a long clause still reads as a query rather than a paragraph.
    const words = keywords(clause).slice(0, 8).join(" ");
    add(anchor ? `${anchor} ${words}` : words);
    if (out.length >= max) break;
  }
  if (!out.length) add(anchor ? `${anchor} ${line}` : line);
  return out.slice(0, max);
}

/**
 * Is this a government or official body's own address?
 *
 * The guess that follows this -- "read /meetings on the top three hosts" -- is
 * only ever right for a body that publishes records. Ranked without this test,
 * the live report's three hosts were `en.m.wikipedia.org`, `m.imdb.com` and
 * `whitepalmapts.com`, and nine pages were fetched from them for nothing.
 *
 * `.us` is here for the town sites that use it (`longmont.co.us`), and
 * `.gov.<cc>` for the state and national addresses outside the US.
 */
export function isOfficialHost(host: string): boolean {
  const h = String(host ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!h || h.includes(" ")) return false;
  return /\.gov$/.test(h) || /\.gov\.[a-z]{2}$/.test(h) || /\.us$/.test(h) || /\.mil$/.test(h);
}

/**
 * A host worth guessing an index page on: an official body, or a source the
 * paper itself registered.
 *
 * The registered half is `absence-gate`'s `isOnDomains` -- the same suffix
 * match the Sources desk and the claims-of-absence gate use, so a paper with
 * `frprdistrict.com` on its watch list is treated the same way here as there.
 */
export function isOfficialDocHost(host: string, registered: string[] = []): boolean {
  if (isOfficialHost(host)) return true;
  if (!registered.length) return false;
  return isOnDomains(`https://${String(host ?? "").trim()}`, registered);
}

/**
 * The hosts that plausibly published the record, best first.
 *
 * The story's own sources lead, because the body that issued the record is
 * normally already cited there, and a host that survived a previous pass is a
 * far better bet than whatever a fresh keyword search turned up. `.gov` hosts
 * lead within each group.
 *
 * Ordering matters more than it looks: only the first few hosts get their
 * meetings page read, and sorting purely by `.gov` once put the state
 * legislature's site — which has no meetings page — ahead of the rail
 * district's own.
 */
export function docCandidateHosts(
  hitUrls: string[],
  storyUrls: string[],
  registered: string[] = [],
): string[] {
  const rank = new Map<string, number>();
  const add = (raw: string, base: number) => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      // A commercial host is never the body that issues the record, however
      // loudly a search engine ranked it, so it never gets a guessed page.
      if (!isOfficialDocHost(host, registered)) return;
      const score = base + (host.endsWith(".gov") ? 1 : 0);
      if ((rank.get(host) ?? -1) < score) rank.set(host, score);
    } catch {
      /* not a URL */
    }
  };
  for (const u of hitUrls) add(u, 0);
  for (const u of storyUrls) add(u, 2);
  return [...rank.entries()].sort((a, b) => b[1] - a[1]).map(([host]) => host);
}

/**
 * Pages on a body's own site that tend to list its records.
 *
 * Deliberately a fixed short list rather than a crawl: this runs inside a
 * reporter's click, and a crawl of an unknown host is both slow and a much
 * larger thing to point at an outside server.
 */
export const DOC_INDEX_PATHS = [
  "/meetings",
  "/meetings/",
  "/board-meetings",
  "/agendas",
  "/documents",
  "/news",
] as const;

export function docIndexPages(
  hosts: string[],
  perHost = 3,
  registered: string[] = [],
): string[] {
  const out: string[] = [];
  // Filtered again here rather than trusting the caller: this is the function
  // that decides what gets fetched, and a host that is not an official body is
  // a page nobody asked for.
  for (const host of hosts.filter((h) => isOfficialDocHost(h, registered)).slice(0, 3)) {
    for (const path of DOC_INDEX_PATHS.slice(0, perHost)) {
      out.push(`https://${host}${path}`);
    }
  }
  return out;
}

/**
 * Does this document actually concern the story?
 *
 * True when the text names the city, the state, or one of the story's named
 * subjects. A board resolution about the right subject always names at least
 * one of those; the California school-district PDFs named none.
 *
 * Matching is done on a normalized copy because extracted PDF text arrives with
 * broken spacing and stray case.
 */
export function isOnSubject(
  text: string,
  subjects: string[],
  city: string,
  state = "",
): boolean {
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  if (!hay.trim()) return false;
  const needles = [city, state, ...subjects]
    .map((n) => String(n ?? "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter((n) => n.length >= 4);
  // With nothing to anchor on, do not silently reject everything.
  if (!needles.length) return true;
  return needles.some((n) => hay.includes(n));
}

/** `frprdistrict.com` from `www.frprdistrict.com` — enough to tell one site from another. */
function siteKey(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

/**
 * Keep only the links from an index page that could be one of its records.
 *
 * A page's own document links sit on its own site, or point at a PDF somewhere
 * else. Everything else is furniture. This matters more than it sounds: the
 * rail district's board-meetings page is a Wix site, and the only links the
 * extractor found on it were two `siteassets.parastorage.com` build bundles —
 * multi-kilobyte query strings that were then fetched, kept, and written into
 * the reporter's notes as documents.
 */
export function siteOwnDocLinks(links: string[], pageUrl: string): string[] {
  let base = "";
  try {
    base = siteKey(new URL(pageUrl).hostname);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const raw of links) {
    try {
      const u = new URL(raw);
      const isPdf = u.pathname.toLowerCase().endsWith(".pdf");
      if (!isPdf && siteKey(u.hostname) !== base) continue;
      // A URL carrying a query string longer than the page itself is a build
      // artifact, not a record.
      if (u.search.length > 300) continue;
      out.push(raw);
    } catch {
      /* skip */
    }
  }
  return out;
}
