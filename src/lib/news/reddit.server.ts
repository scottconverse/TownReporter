import { fetchPublicHttp } from "./fetch-url";
import { parseRedditFeed, type RedditPost } from "./reddit";

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
    const since = Date.now() - lastRequestAt;
    if (since < gapMs) await sleep(gapMs - since);

    let res: Response;
    try {
      lastRequestAt = Date.now();
      res = await fetchPublicHttp(new URL(url));
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
      gapMs = Math.min(gapMs * 2, 60_000);
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
