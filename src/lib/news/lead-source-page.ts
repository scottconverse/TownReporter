/**
 * G26-HP-1 (rule 22, warn and never block): is one of a lead's source URLs a
 * home page, a section list or a feed rather than a page ABOUT the story?
 *
 * The real leads: scan 97 filed `timescall.com/local-news/`,
 * `bouldercounty.gov/`, `svvsd.org/feed/` and `insidelongmontco.com/` in
 * `source_urls`. The scan model put them there and nothing looked at them, so
 * an editor opening the lead to check it landed on a front page and had to go
 * find the story themselves.
 *
 * This module only MARKS such a URL; it never drops it. The link stays on the
 * lead (an editor may still need it -- a front page that carried the item is
 * real provenance), and the Queue draws one plain warning beside it. Nothing
 * here refuses a lead, blocks a file or changes a status.
 *
 * Kept pure and free of imports so the check can be tested on its own and run
 * in the browser on a row's stored `source_urls` -- the Queue decides from the
 * URL itself, so leads filed before this existed are marked too, with no
 * schema change and no backfill.
 */

/** The words the Queue shows. One sentence, no jargon. */
export const HOME_OR_LIST_SOURCE_WARNING = "Source is a home or list page, not the story page";

/**
 * A path segment that names a SECTION rather than a story: `timescall.com/
 * local-news/`, `svvsd.org/news/`, `dailycamera.com/sports/`. A slug for one
 * story always carries more words than this (`/news/lyons-school-ranking-2026/`),
 * which is why only a ONE-segment path is read this way -- the same bias
 * `isIndexPageUrl` (./lead-match.ts) uses, kept separate here because the
 * question is different: that one decides whether two leads share a source,
 * this one decides whether to warn the editor.
 */
const SECTION_WORDS = new Set([
  "news",
  "newsroom",
  "local",
  "local-news",
  "localnews",
  "latest",
  "stories",
  "story",
  "section",
  "sections",
  "category",
  "categories",
  "topic",
  "topics",
  "tag",
  "tags",
  "sports",
  "opinion",
  "opinions",
  "editorials",
  "columns",
  "letters",
  "obituaries",
  "business",
  "politics",
  "government",
  "elections",
  "crime",
  "education",
  "schools",
  "community",
  "events",
  "calendar",
  "entertainment",
  "arts",
  "culture",
  "food",
  "health",
  "weather",
  "traffic",
  "real-estate",
  "jobs",
  "classifieds",
  "feed",
  "feeds",
  "rss",
  "atom",
  "index",
  "home",
]);

/** A last segment that is a feed whatever else it says: `/feed`, `/rss.xml`,
 * `/atom`, `?feed=rss2` (the query is checked separately, see the function). */
const FEED_SEGMENT = /^(feed|feeds|rss|atom|rss2)$/;
const FEED_FILE = /\.(xml|rss|atom)$/;

/**
 * True when this URL looks like a home page, a section/list page or a feed --
 * a page that is not about the story it was cited for.
 *
 *   - no path at all, or `/`                      -> `bouldercounty.gov/`,
 *                                                    `insidelongmontco.com/`
 *   - a feed path or file                          -> `svvsd.org/feed/`,
 *                                                    `.../rss`, `.../sitemap.xml`
 *   - a feed query                                 -> `.../news/?feed=rss2`
 *   - a ONE-segment section path                   -> `timescall.com/local-news/`
 *
 * A URL this cannot read (no host, junk) is NOT flagged: the warning is about
 * a page that is plainly not the story, and a guess is worse than silence.
 */
export function looksLikeHomeOrListPage(raw: string | null | undefined): boolean {
  const text = String(raw ?? "").trim();
  if (!text) return false;
  // The query is dropped before the path is read, but a WordPress-style feed
  // query is itself the feed marker, so it is checked on the raw string.
  const withoutHash = text.split("#")[0]!;
  const queryAt = withoutHash.indexOf("?");
  const query = queryAt < 0 ? "" : withoutHash.slice(queryAt + 1).toLowerCase();
  if (/(^|&)(feed|rss|atom)=/.test(query)) return true;

  let rest = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  const slash = rest.indexOf("/");
  const host = slash < 0 ? rest : rest.slice(0, slash);
  // A host, not a sentence: a lead's source URLs are sanitized public
  // addresses before they are stored (`sanitizePublicUrls`), so anything
  // without a dotted name here is junk some other path let through and reads
  // as "no path" only by accident. Silence, not a warning, is the answer.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)) return false;
  const path = slash < 0 ? "" : rest.slice(slash);
  const segments = path
    .toLowerCase()
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length === 0) return true;
  const last = segments[segments.length - 1]!;
  if (FEED_SEGMENT.test(last)) return true;
  if (FEED_FILE.test(last)) return true;
  return segments.length === 1 && SECTION_WORDS.has(last);
}

/**
 * The lead's source URLs that trip the check above, in the order the lead
 * lists them, each URL once. Empty means every source is a story page.
 */
export function homeOrListSourceUrls(urls: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = String(raw ?? "").trim();
    if (!url || seen.has(url)) continue;
    if (!looksLikeHomeOrListPage(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
