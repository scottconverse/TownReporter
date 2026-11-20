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
/**
 * True when the lead has at least one source and NONE of them addresses a
 * story -- every URL is a home page, section list or feed. That is the one
 * case the Queue's chip is about: a lead with a front page AND the story's own
 * page is fully checkable, so it gets no chip (the front page stays on the
 * row and in the chip's hover list for the leads that still need it).
 */
export function onlyHomeOrListSourceUrls(urls: readonly (string | null | undefined)[]): boolean {
  const present = urls.map((raw) => String(raw ?? "").trim()).filter(Boolean);
  return present.length > 0 && present.every((url) => looksLikeHomeOrListPage(url));
}

/** One article link a scanned page carried: where it goes and the words the page printed for it. */
export type StoryLink = { url: string; title: string };

/** One page the scan read, with the article links it carried (see ingest.ts's discoverStoryLinkEntries). */
export type ScannedPageLinkList = { url: string; storyLinks?: readonly StoryLink[] };

const MATCH_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "at", "by", "with",
  "from", "is", "are", "was", "were", "be", "been", "its", "it", "this", "that",
  "as", "after", "before", "over", "under", "new", "says", "say", "said", "will",
  "has", "have", "had", "his", "her", "their", "our", "your", "you", "we", "they",
  "not", "but", "how", "why", "what", "when", "where", "who", "than", "then",
]);

/** Content words of a headline or link title, lowercased, deduplicated. */
function matchTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9$%.]+/)) {
    const word = raw.replace(/^[.']+|[.']+$/g, "");
    if (word.length < 3 || MATCH_WORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

/** Compare two addresses the way a reader would: ignore scheme, `www.`, query, hash and trailing slash. */
function pageIdentity(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .split("#")[0]!
    .split("?")[0]!
    .replace(/\/+$/, "");
}

/**
 * The story's own page for a lead that cited only a list page.
 *
 * The scan already read the list page and kept the article links it carried
 * (with their link text). For the lead's headline, this finds the ONE link on
 * that page whose link text plainly names the same story:
 *
 *   - the link must share at least three content words with the headline AND
 *     at least 60% of the link's own content words must appear in the headline
 *     (a title is usually longer than the headline the model wrote from it);
 *   - if more than one link passes, the best must lead the runner-up by two
 *     words, otherwise the answer is not clear and nothing is returned.
 *
 * `null` means no clear match, and filing adds nothing: a guessed link would
 * put a different story on the lead, which is worse than the list page alone.
 */
export function storyUrlForListSource(
  headline: string,
  listUrl: string,
  pages: readonly ScannedPageLinkList[],
): string | null {
  const listIdentity = pageIdentity(listUrl);
  if (!listIdentity) return null;
  const page = pages.find((candidate) => pageIdentity(candidate.url) === listIdentity);
  if (!page?.storyLinks?.length) return null;
  const headlineTokens = matchTokens(headline);
  if (headlineTokens.size < 3) return null;

  const scored: { url: string; shared: number }[] = [];
  for (const link of page.storyLinks) {
    const identity = pageIdentity(link.url);
    if (!identity || identity === listIdentity) continue;
    const titleTokens = matchTokens(link.title ?? "");
    if (!titleTokens.size) continue;
    let shared = 0;
    for (const word of titleTokens) if (headlineTokens.has(word)) shared += 1;
    if (shared < 3 || shared / titleTokens.size < 0.6) continue;
    scored.push({ url: link.url, shared });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.shared - a.shared);
  const best = scored[0]!;
  const runnerUp = scored[1];
  if (runnerUp && best.shared - runnerUp.shared < 2) return null;
  return best.url;
}

/**
 * Add each cited list page's own story link to the lead's source URLs, ahead
 * of the list page. A list page is kept; a lead with no clear story link is
 * left exactly as the model wrote it.
 */
export function withStoryUrlsForListSources(
  headline: string,
  urls: readonly string[],
  pages: readonly ScannedPageLinkList[],
): string[] {
  const out: string[] = [];
  const added = new Set<string>();
  for (const url of urls) {
    if (looksLikeHomeOrListPage(url)) {
      const story = storyUrlForListSource(headline, url, pages);
      const key = story ? pageIdentity(story) : "";
      if (story && !added.has(key)) {
        added.add(key);
        out.push(story);
      }
    }
    out.push(url);
  }
  return out;
}

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
