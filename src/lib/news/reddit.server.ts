import { fetchPublicHttp } from "./fetch-url.ts";
import { htmlToPlainText } from "./html-text.ts";
import { isRedditThreadUrl, parseRedditFeed, threadFeed, type RedditPost } from "./reddit.ts";

/**
 * Fetching Reddit at a pace that keeps working.
 *
 * Anonymous access allows roughly ten requests a minute per IP, and the limit
 * is per IP rather than per client — so being rate-limited does not just fail
 * this run, it degrades the path for every later one and for anything else on
 * this machine. Everything here exists to stay well inside that:
 *
 *  - at least eight seconds between any two requests,
 *  - strictly sequential; never two in flight,
 *  - a hard ceiling on requests per run,
 *  - on a 429, wait a minute and halve the pace,
 *  - after three 429s, stop and report what was actually collected.
 *
 * Partial coverage reported honestly beats complete coverage never delivered.
 */
const MIN_GAP_MS = 8_000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_429 = 3;

/**
 * Module-level, deliberately.
 *
 * The budget that matters is per IP, so two concurrent runs each politely
 * waiting eight seconds would together make a request every four — two polite
 * clients on one connection are one impolite client. Sharing the clock across
 * the whole process is what stops that.
 */
let lastRequestAt = 0;
let gapMs = MIN_GAP_MS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The pacing half only: wait out the shared gap, then make one request.
 * Shared by `sweepRedditFeeds` (many feeds) and `fetchRedditDocument`
 * (Dark Desk F5 — one URL from the generic fetch/ingest path) so every
 * reddit request in the process, regardless of caller, goes through the
 * same clock and never fires two in flight.
 */
async function pacedRedditGet(url: string): Promise<Response> {
  const since = Date.now() - lastRequestAt;
  if (since < gapMs) await sleep(gapMs - since);
  lastRequestAt = Date.now();
  return fetchPublicHttp(new URL(url));
}

/** 429 bookkeeping shared by both callers: slow the shared clock down, honestly. */
function noteRateLimited() {
  gapMs = Math.min(gapMs * 2, 60_000);
}

export type RedditFetchLog = {
  url: string;
  ok: boolean;
  status: number;
  posts: number;
  note?: string;
};

export type RedditSweep = {
  posts: RedditPost[];
  log: RedditFetchLog[];
  /** True when the sweep stopped early and did not cover what it meant to. */
  incomplete: boolean;
  reason?: string;
};

/**
 * Fetch a list of feeds in order, pacing between them.
 *
 * `maxRequests` is a ceiling on this run, not a target: a caller asking for
 * more feeds than that gets the first few and an honest `incomplete`.
 */
export async function sweepRedditFeeds(
  urls: string[],
  maxRequests = 4,
): Promise<RedditSweep> {
  const log: RedditFetchLog[] = [];
  const posts: RedditPost[] = [];
  const seen = new Set<string>();
  let rateLimited = 0;

  const wanted = urls.slice(0, maxRequests);
  for (const url of wanted) {
    let res: Response;
    try {
      res = await pacedRedditGet(url);
    } catch (err) {
      log.push({
        url,
        ok: false,
        status: 0,
        posts: 0,
        note: err instanceof Error ? err.message.slice(0, 160) : "network error",
      });
      continue;
    }

    if (res.status === 429) {
      rateLimited += 1;
      // Back off and slow down for the rest of the run, not just this request.
      noteRateLimited();
      log.push({ url, ok: false, status: 429, posts: 0, note: "rate limited" });
      if (rateLimited >= MAX_429) {
        return {
          posts,
          log,
          incomplete: true,
          reason: `Reddit rate-limited this machine ${rateLimited} times. Stopped rather than pushing. Try again in a few minutes.`,
        };
      }
      await sleep(RATE_LIMIT_PAUSE_MS);
      continue;
    }

    if (!res.ok) {
      log.push({ url, ok: false, status: res.status, posts: 0, note: `HTTP ${res.status}` });
      continue;
    }

    const xml = await res.text();
    const parsed = parseRedditFeed(xml);
    let added = 0;
    for (const p of parsed) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      posts.push(p);
      added += 1;
    }
    log.push({ url, ok: true, status: res.status, posts: added });
  }

  return {
    posts,
    log,
    incomplete: urls.length > wanted.length,
    reason:
      urls.length > wanted.length
        ? `Only the first ${wanted.length} of ${urls.length} feeds were read, to stay inside Reddit's rate limit.`
        : undefined,
  };
}

/** For tests: forget the shared clock between cases. */
export function resetRedditPacing() {
  lastRequestAt = 0;
  gapMs = MIN_GAP_MS;
}

export type RedditDocument = {
  ok: boolean;
  status: number;
  text: string;
  title: string;
  extras: string[];
  contentType: string;
  extractionMethod: string;
  redirectChain: string[];
};

/**
 * Dark Desk F5: fetch a reddit.com/redd.it URL for the generic fetch/ingest
 * path (ingest.ts), the way `reddit.ts`'s doc comment says a curated source
 * already does it — browser-like User-Agent (fetchPublicHttp's default), the
 * `.rss` endpoint for a thread permalink, paced through the same shared
 * clock as `sweepRedditFeeds` so this and the tip-subreddit scan can never
 * together exceed reddit's per-IP budget.
 *
 * A thread permalink (`/r/<sub>/comments/<id>/...`) gets its `.rss` feed
 * parsed into post title + top comment excerpts — real content instead of
 * the JS app shell. Anything else reddit-shaped (a subreddit front page, a
 * user page, a redd.it short link) has no `.rss` equivalent, so it falls
 * back to `old.reddit.com`, which still serves plain server-rendered HTML
 * reddit.com does not.
 */
export async function fetchRedditDocument(url: URL): Promise<RedditDocument> {
  const isThread = isRedditThreadUrl(url);
  const fetchUrl = isThread ? threadFeed(url.toString()) : oldRedditUrl(url);

  let res: Response;
  try {
    res = await pacedRedditGet(fetchUrl);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : "network error",
      title: url.toString(),
      extras: [],
      contentType: "",
      extractionMethod: isThread ? "reddit-rss" : "reddit-old",
      redirectChain: [url.toString()],
    };
  }

  if (res.status === 429) {
    noteRateLimited();
    return {
      ok: false,
      status: 429,
      text: "Reddit rate-limited this request. No content was captured — try again later.",
      title: "Too many requests",
      extras: [],
      contentType: "",
      extractionMethod: isThread ? "reddit-rss" : "reddit-old",
      redirectChain: [url.toString(), fetchUrl],
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      text: `Reddit returned HTTP ${res.status}. No content was captured.`,
      title: url.hostname,
      extras: [],
      contentType: "",
      extractionMethod: isThread ? "reddit-rss" : "reddit-old",
      redirectChain: [url.toString(), fetchUrl],
    };
  }

  if (isThread) {
    const xml = await res.text();
    const posts = parseRedditFeed(xml);
    // The thread's own .rss lists the submission plus its comments as
    // entries, newest/most-relevant first; the submission itself is not
    // reliably entry 0 across Reddit's feed shapes, so build the text from
    // every entry rather than assuming an order.
    const title = posts[0]?.title || url.pathname.split("/").filter(Boolean).pop() || "Reddit thread";
    const body = posts
      .slice(0, 40)
      .map((p) => `${p.author ? `${p.author}: ` : ""}${p.excerpt || p.title}`)
      .filter(Boolean)
      .join("\n\n");
    const text = `${title}\n\n${body}`.trim();
    return {
      ok: text.length >= 40,
      status: res.status,
      text,
      title,
      extras: [],
      contentType: "text/plain",
      extractionMethod: "reddit-rss",
      redirectChain: [url.toString(), fetchUrl],
    };
  }

  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140)
    : url.hostname;
  const text = htmlToPlainText(html).slice(0, 14000);
  return {
    ok: text.length >= 40,
    status: res.status,
    text,
    title,
    extras: [],
    contentType: "text/html",
    extractionMethod: "reddit-old",
    redirectChain: [url.toString(), fetchUrl],
  };
}

/**
 * Same path/query on old.reddit.com — still server-rendered HTML, unlike
 * reddit.com's JS app shell. Correct for any reddit.com/www.reddit.com/
 * old.reddit.com path (subreddit listing, user page, search). A redd.it
 * short link's path is a bare id in redd.it's own scheme, not a reddit.com
 * path, so this fallback does not resolve it — out of scope here; redd.it
 * links reaching this function fall back to whatever old.reddit.com does
 * with that path (typically a 404), which is at worst a failed capture,
 * never a poisoned one.
 */
function oldRedditUrl(url: URL): string {
  try {
    const u = new URL(url.toString());
    u.hostname = "old.reddit.com";
    return u.toString();
  } catch {
    return url.toString();
  }
}
