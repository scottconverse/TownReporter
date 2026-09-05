import { fetchPublicHttpOnce } from "./fetch-url.ts";
import { htmlToPlainText } from "./html-text.ts";
import { isRedditUrl, isRedditThreadUrl, parseRedditFeed, threadFeed, type RedditPost } from "./reddit.ts";

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

/** One queue for this process; other processes on the same IP need coordination too. */
let lastRequestAt = Number.NEGATIVE_INFINITY;
let gapMs = MIN_GAP_MS;
let cooldownUntil = 0;
let requestQueue: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reserve queue order synchronously, before waiting. Only the queue head can
 * send, and it retains ownership until the response body finishes (or fails).
 * Check the current cooldown at the head, so a preceding 429 affects waiters.
 */
function scheduleRedditRequest(send: () => Promise<Response>): Promise<Response> {
  const request = requestQueue.then(async () => {
    let wait: number;
    while ((wait = Math.max(lastRequestAt + gapMs, cooldownUntil) - Date.now()) > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
    const res = await send();
    if (res.status === 429) {
      gapMs = Math.min(gapMs * 2, RATE_LIMIT_PAUSE_MS);
      cooldownUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    }
    // Buffer inside the queue: fetch resolves at headers, before the network
    // body finishes. Return a fresh readable response to existing consumers.
    const body = res.body === null ? null : await res.arrayBuffer();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
  requestQueue = request.then(() => {}, () => {});
  return request;
}

/** Every hop stays on Reddit and retains the generic fetcher's DNS/rebinding guard. */
async function pacedRedditGet(
  raw: string,
  chain: string[] = [],
  resolveShortLink = false,
): Promise<Response> {
  let url = new URL(raw);
  const seen = new Set<string>();
  for (let hops = 0; ; hops++) {
    if (!isRedditUrl(url) || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Reddit redirect must use a public Reddit HTTP(S) URL");
    }
    if (seen.has(url.toString())) throw new Error("Reddit redirect loop");
    seen.add(url.toString());
    chain.push(url.toString());
    // Resolve the short URL to its canonical permalink, then request the RSS
    // directly rather than spending another request on the JavaScript shell.
    if (resolveShortLink && url.hostname !== "redd.it" && isRedditThreadUrl(url)) {
      url = new URL(threadFeed(url.toString()));
      resolveShortLink = false;
      if (chain[chain.length - 1] !== url.toString()) chain.push(url.toString());
    }
    const res = await fetchPublicHttpOnce(url, scheduleRedditRequest);
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      if (resolveShortLink && res.ok) throw new Error("Reddit short link did not resolve to a thread");
      return res;
    }
    if (hops >= 4) throw new Error("Too many Reddit redirects");
    const location = res.headers.get("location");
    if (!location) throw new Error("Reddit redirect with no location");
    url = new URL(location, url);
  }
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
      log.push({ url, ok: false, status: 429, posts: 0, note: "rate limited" });
      if (rateLimited >= MAX_429) {
        return {
          posts,
          log,
          incomplete: true,
          reason: `Reddit rate-limited this machine ${rateLimited} times. Stopped rather than pushing. Try again in a few minutes.`,
        };
      }
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
  lastRequestAt = Number.NEGATIVE_INFINITY;
  gapMs = MIN_GAP_MS;
  cooldownUntil = 0;
  requestQueue = Promise.resolve();
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
 * The `.rss` equivalent of a reddit.com URL, or `null` when the page truly
 * has none (a wiki page, `/r/<sub>/about`, a multireddit landing, the
 * reddit.com home page, and the like).
 *
 * Every one of these classes returns Atom XML `parseRedditFeed` already
 * parses, via the same browser-like-User-Agent `.rss` technique as a thread
 * permalink — Reddit does not special-case threads here, only this codebase
 * used to. Thread permalinks are handled by the caller before this is
 * reached (see `fetchRedditDocument`); this covers everything else
 * reddit-shaped:
 *
 *  - subreddit front page   `/r/<sub>/`               -> `/r/<sub>/.rss`
 *  - subreddit sort         `/r/<sub>/new`             -> `/r/<sub>/new/.rss`
 *                           `/r/<sub>/hot|rising`      -> matching `.rss`
 *                           `/r/<sub>/top`             -> `/r/<sub>/top/.rss?t=<period>`
 *  - subreddit search       `/r/<sub>/search?q=…`      -> `/r/<sub>/search.rss?q=…&restrict_sr=on[&sort=…]`
 *  - site search            `/search?q=…`              -> `/search.rss?q=…`
 *  - user page              `/user/<name>` or `/u/<name>` -> `/user/<name>/.rss`
 */
function redditFeedUrl(url: URL): string | null {
  if (isRedditThreadUrl(url)) return threadFeed(url.toString());

  // Raw path segments, still percent-encoded as Reddit expects them (e.g. a
  // multireddit's "+" must survive untouched, not become "%2B").
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length === 2 && (segments[0] === "user" || segments[0] === "u")) {
    return `https://www.reddit.com/user/${segments[1]}/.rss`;
  }

  if (segments[0] === "search") {
    const q = url.searchParams.get("q");
    return q ? `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}` : null;
  }

  if (segments[0] === "r" && segments[1]) {
    const sub = segments[1];
    const rest = segments.slice(2);

    if (rest.length === 0) return `https://www.reddit.com/r/${sub}/.rss`;

    if (rest.length === 1 && (rest[0] === "new" || rest[0] === "hot" || rest[0] === "rising")) {
      return `https://www.reddit.com/r/${sub}/${rest[0]}/.rss`;
    }

    if (rest.length === 1 && rest[0] === "top") {
      const t = url.searchParams.get("t");
      return `https://www.reddit.com/r/${sub}/top/.rss${t ? `?t=${encodeURIComponent(t)}` : ""}`;
    }

    if (rest.length === 1 && rest[0] === "search") {
      const q = url.searchParams.get("q");
      if (!q) return null;
      const sort = url.searchParams.get("sort");
      return (
        `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=on` +
        (sort ? `&sort=${encodeURIComponent(sort)}` : "")
      );
    }
  }

  return null;
}

/** A short, human-readable label for a listing feed — used as the document title/header. */
function redditListingTitle(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "user" || segments[0] === "u") return `u/${segments[1] ?? ""}`;
  if (segments[0] === "search") return `Reddit search: ${url.searchParams.get("q") ?? ""}`.trim();
  if (segments[0] === "r" && segments[1]) {
    const sub = segments[1];
    const rest = segments.slice(2);
    if (rest[0] === "search") return `r/${sub} search: ${url.searchParams.get("q") ?? ""}`.trim();
    if (rest[0]) return `r/${sub}/${rest[0]}`;
    return `r/${sub}`;
  }
  return url.hostname;
}

/**
 * Dark Desk F5: fetch a reddit.com/redd.it URL for the generic fetch/ingest
 * path (ingest.ts), the way `reddit.ts`'s doc comment says a curated source
 * already does it — browser-like User-Agent (fetchPublicHttp's default), the
 * `.rss` endpoint wherever one exists, paced through the same shared queue
 * and cooldown as `sweepRedditFeeds`, shared within this process.
 *
 * A thread permalink (`/r/<sub>/comments/<id>/...`) gets its `.rss` feed
 * parsed into post title + top comment excerpts. Everything else
 * reddit-shaped that `redditFeedUrl` can map — a subreddit front page or
 * sort, a subreddit or site search, a user page — gets its own `.rss`
 * listing feed, parsed the same way, one entry per post. Only a page
 * `redditFeedUrl` returns `null` for (a wiki page, `/about`, the reddit.com
 * home page, and similar pages with no feed) falls back to
 * `old.reddit.com`, which still serves plain server-rendered HTML
 * reddit.com does not. Short links resolve through paced, guarded Reddit
 * redirects to a canonical thread before fetching its RSS.
 */
export async function fetchRedditDocument(url: URL): Promise<RedditDocument> {
  const isShortLink = url.hostname === "redd.it";
  const isThread = isShortLink || isRedditThreadUrl(url);
  const listingFeedUrl = isShortLink || isThread ? null : redditFeedUrl(url);
  const isFeed = isThread || listingFeedUrl !== null;
  const fetchUrl = isShortLink
    ? url.toString()
    : isThread
      ? threadFeed(url.toString())
      : (listingFeedUrl ?? oldRedditUrl(url));
  const redirectChain = [url.toString()];

  let res: Response;
  try {
    res = await pacedRedditGet(fetchUrl, redirectChain, isShortLink);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : "network error",
      title: url.toString(),
      extras: [],
      contentType: "",
      extractionMethod: isFeed ? "reddit-rss" : "reddit-old",
      redirectChain,
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      status: 429,
      text: "Reddit rate-limited this request. No content was captured — try again later.",
      title: "Too many requests",
      extras: [],
      contentType: "",
      extractionMethod: isFeed ? "reddit-rss" : "reddit-old",
      redirectChain,
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
      extractionMethod: isFeed ? "reddit-rss" : "reddit-old",
      redirectChain,
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
      redirectChain,
    };
  }

  if (isFeed) {
    const xml = await res.text();
    const posts = parseRedditFeed(xml);
    // A listing feed's entries are separate posts, not one thread's
    // comments — each becomes its own short block (title, author, excerpt)
    // rather than being read as a running conversation.
    const title = redditListingTitle(url);
    const body = posts
      .slice(0, 40)
      .map((p) => [p.title, p.author ? `by ${p.author}` : "", p.excerpt].filter(Boolean).join("\n"))
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
      redirectChain,
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
    redirectChain,
  };
}

/**
 * Same path/query on old.reddit.com — still server-rendered HTML, unlike
 * reddit.com's JS app shell. Used only when `redditFeedUrl` returns `null`
 * — a page with no `.rss` equivalent (a wiki page, `/about`, the reddit.com
 * home page, and similar). Short links are resolved separately before this
 * fallback is even considered.
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
