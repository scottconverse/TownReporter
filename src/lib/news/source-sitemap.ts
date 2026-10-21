/**
 * READING THE CITY'S OWN SITEMAP (A5, free tier).
 *
 * `sitemapCandidates` (`source-replacements.ts`) needs `<loc>`s that came from
 * the newsroom's OWN official host, and nothing before this file produced them:
 * the "Use this instead" panel was fed only siblings, which are already on the
 * watch list, so its press could never file anything.
 *
 * WHAT IT READS. `https://<host>/sitemap.xml`, and when that is missing (or is
 * a page rather than a sitemap) the `Sitemap:` lines of `robots.txt`. An index
 * is followed to at most `SITEMAP_READ_CHILD_CAP` children and no further --
 * following an index's index is how a repair job becomes a crawl.
 *
 * THE BUDGET IS THE POINT. Ten seconds and five megabytes across the whole
 * read, checked before every request, because this runs inside a panel the
 * editor is waiting on. Any failure -- a refused connection, a 404, a body that
 * is not a sitemap -- yields no locations rather than an error: the panel still
 * shows the siblings it already has, and no editor press can make the desk
 * crash on a host that is simply not publishing one.
 *
 * THE FETCHER IS A PARAMETER. `readSitemapLocs` takes the text fetcher, so the
 * reading rules above are testable against fake XML with no network at all.
 */
import { locsFromSitemap, sitemapsFromRobots } from "./source-alternates.ts";
import { fetchPublicHttp } from "./fetch-url.ts";

/** The whole read, across the root sitemap, robots.txt and every child. */
export const SITEMAP_READ_BUDGET_MS = 10_000;

/** Characters accepted across every body read, which is bytes for the ASCII a
 *  sitemap almost always is. */
export const SITEMAP_READ_BUDGET_CHARS = 5_000_000;

/** How many child sitemaps an index (or robots.txt) may lead to. */
export const SITEMAP_READ_CHILD_CAP = 3;

/** How many sitemap candidates the panel is offered. A sitemap can hold tens of
 *  thousands of pages; the editor judges a short list, not an index. */
export const SITEMAP_CANDIDATE_CAP = 15;

/** Fetch one sitemap address as text, giving up after `timeoutMs`. */
export type SitemapTextFetcher = (url: string, timeoutMs: number) => Promise<string>;

/** The real fetcher: the desk's guarded public read, so the same address rules
 *  (no private hosts, capped bodies) apply as to every other fetch. */
export async function fetchSitemapText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchPublicHttp(
    new URL(url),
    4,
    AbortSignal.timeout(Math.max(1, timeoutMs)),
  );
  if (!response.ok) throw new Error(`Sitemap answered ${response.status}`);
  return response.text();
}

function budgetLeft(deadline: number, spent: number): number {
  if (spent >= SITEMAP_READ_BUDGET_CHARS) return 0;
  return deadline - Date.now();
}

/**
 * The `<loc>`s of a host's sitemap, within the budget, or `[]` for any host
 * that does not answer with one.
 */
export async function readSitemapLocs(
  host: string,
  fetchText: SitemapTextFetcher = fetchSitemapText,
): Promise<string[]> {
  const clean = String(host ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
  if (!clean) return [];

  const deadline = Date.now() + SITEMAP_READ_BUDGET_MS;
  let spent = 0;

  /** One read inside the budget; null for no answer, an error or no budget. */
  const read = async (url: string): Promise<string | null> => {
    const remaining = budgetLeft(deadline, spent);
    if (remaining <= 0) return null;
    try {
      const text = await fetchText(url, remaining);
      spent += text.length;
      return text;
    } catch {
      return null;
    }
  };

  /** The document locations of at most `SITEMAP_READ_CHILD_CAP` child sitemaps. */
  const readChildren = async (children: readonly string[]): Promise<string[]> => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const child of children.slice(0, SITEMAP_READ_CHILD_CAP)) {
      if (budgetLeft(deadline, spent) <= 0) break;
      const xml = await read(child);
      if (xml === null) continue;
      const parsed = locsFromSitemap(xml);
      // One level only: an index of indexes is a crawl.
      if (parsed.kind === "index") continue;
      for (const loc of parsed.locs) {
        if (seen.has(loc)) continue;
        seen.add(loc);
        out.push(loc);
      }
    }
    return out;
  };

  const root = await read(`https://${clean}/sitemap.xml`);
  if (root !== null) {
    const parsed = locsFromSitemap(root);
    if (parsed.locs.length) {
      return parsed.kind === "index" ? readChildren(parsed.locs) : parsed.locs;
    }
  }

  const robots = await read(`https://${clean}/robots.txt`);
  if (robots === null) return [];
  return readChildren(sitemapsFromRobots(robots));
}

/** An address as the desk compares it: lower-cased, no hash, no trailing slash
 *  on the path, so `/agenda/` and `/agenda` are one page. */
export function normalizeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * DROP WHAT THE NEWSROOM ALREADY HOLDS.
 *
 * The proposal door refuses any address the newsroom has a `sources` row for,
 * whatever its status, so a sitemap candidate that is already a source is a
 * button that cannot work. `knownUrls` is every row's URL, not just the
 * accepted ones, for exactly that reason.
 */
export function dropKnownSourceUrls(
  locs: readonly string[],
  knownUrls: readonly string[],
): string[] {
  const known = new Set<string>();
  for (const raw of knownUrls ?? []) {
    const key = normalizeSourceUrl(raw);
    if (key) known.add(key);
  }
  if (!known.size) return [...(locs ?? [])];
  return (locs ?? []).filter((loc) => {
    const key = normalizeSourceUrl(loc);
    return key === null || !known.has(key);
  });
}
