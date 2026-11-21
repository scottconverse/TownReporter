/**
 * Pure helpers for the Send to Desk extension.
 *
 * The collector runs inside the Reddit tab and only reads attributes and text
 * from the page. Everything that decides whether a record is allowed -- the
 * host, the permalink shape, the field lengths -- happens here, so it can be
 * tested without a browser. No network, no storage, no DOM.
 */

/** The only hosts a permalink may live on. */
export const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com"];

export const MAX_POSTS = 50;
export const MAX_TITLE = 300;
export const MAX_EXCERPT = 1000;
export const MAX_AUTHOR = 100;
export const MAX_TIME = 40;

export function isRedditHost(hostname) {
  if (typeof hostname !== "string") return false;
  return REDDIT_HOSTS.includes(hostname.toLowerCase());
}

/**
 * Collapse whitespace and cut to `max`, without leaving half a surrogate pair
 * at the end (a lone high surrogate renders as a replacement character).
 */
export function capText(value, max) {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  let cut = cleaned.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}

/**
 * A canonical https://www.reddit.com permalink, or null.
 *
 * Relative hrefs (old Reddit's `a.comments`, `shreddit-post[permalink]`) are
 * resolved against www.reddit.com; absolute ones must already be https and on
 * one of REDDIT_HOSTS. Query strings, fragments, credentials and trailing
 * slashes are dropped so the same post always yields the same URL -- which is
 * what the desk's de-dup keys on.
 */
export function normalizePermalink(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value, "https://www.reddit.com/");
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!isRedditHost(url.hostname)) return null;
  if (!url.pathname.includes("/comments/")) return null;
  if (!url.pathname.startsWith("/r/")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path.length > 400) return null;
  return "https://www.reddit.com" + path;
}

/**
 * Turn whatever the collector read into the records the desk accepts.
 *
 * Bad records are dropped rather than repaired; a post with no title or no
 * allowed permalink is not something the editor can file.
 */
export function toDeskPosts(rawPosts, max = MAX_POSTS) {
  const out = [];
  if (!Array.isArray(rawPosts)) return out;
  const seen = new Set();
  for (const raw of rawPosts) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== "object") continue;
    const url = normalizePermalink(raw.permalink ?? raw.url ?? "");
    if (!url || seen.has(url)) continue;
    const title = capText(raw.title, MAX_TITLE);
    if (!title) continue;
    seen.add(url);
    out.push({
      url,
      title,
      author: capText(raw.author, MAX_AUTHOR),
      time: capText(raw.time, MAX_TIME),
      excerpt: capText(raw.excerpt, MAX_EXCERPT),
    });
  }
  return out;
}
