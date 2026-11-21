import { z } from "zod";

/**
 * The desk's half of "Send to Desk".
 *
 * A Chrome extension (scripts/reddit-send-to-desk/) hands the posts of the
 * Reddit tab the editor was reading to the desk page through
 * `window.postMessage`. Everything arriving that way is untrusted input: any
 * script on the desk origin could post the same shape, and the extension's
 * copy of these rules can be older than this file. So the page checks who
 * spoke, then validates every field here and drops anything that does not
 * pass. Nothing is filed from this list until the editor ticks it and presses
 * the file button, which goes through the normal `fileRedditTip` path.
 */

/** The only origins the desk accepts the hand-over from. */
export const REDDIT_DESK_ORIGINS = ["https://townreporter.org", "http://127.0.0.1:3100"] as const;

/** Page -> extension: "anything for me?" */
export const REDDIT_DESK_READY = "townreporter:reddit-desk-ready";
/**
 * Extension -> page: "the bridge is listening now".
 *
 * The two sides can load in either order (the content script at
 * `document_idle`, the page when React mounts), and whichever speaks first
 * may have no listener yet. This second, one-shot announcement lets a page
 * that asked too early ask again -- no polling, no timers.
 */
export const REDDIT_DESK_BRIDGE_READY = "townreporter:reddit-desk-bridge-ready";
/** Extension -> page: the posts the button collected. */
export const REDDIT_DESK_MESSAGE = "townreporter:reddit-send-to-desk";

const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com"];

export const MAX_DESK_POSTS = 50;
export const MAX_DESK_POSTS_INPUT = 200;
const MAX_TITLE = 300;
const MAX_EXCERPT = 1_000;
const MAX_AUTHOR = 100;
const MAX_TIME = 40;
const MAX_URL = 400;

export type DeskPost = {
  url: string;
  title: string;
  author: string;
  time: string;
  excerpt: string;
};

function capText(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  let cut = cleaned.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}

/**
 * A canonical https://www.reddit.com permalink, or null.
 *
 * Same rules as the extension's `parse.js`: https only, one of the three
 * Reddit hosts, a /r/.../comments/... path, no credentials, query or fragment.
 */
export function normalizeRedditPermalink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!REDDIT_HOSTS.includes(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith("/r/") || !url.pathname.includes("/comments/")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path.length > MAX_URL) return null;
  return "https://www.reddit.com" + path;
}

/**
 * Fields longer than the desk will ever show are cut, not trusted. The hard
 * ceiling here only stops a pathological payload (megabytes in one field)
 * from being walked at all.
 */
const HARD_FIELD_LIMIT = 20_000;
const postSchema = z.object({
  url: z.unknown(),
  title: z.string().max(HARD_FIELD_LIMIT),
  author: z.string().max(HARD_FIELD_LIMIT).optional(),
  time: z.string().max(HARD_FIELD_LIMIT).optional(),
  excerpt: z.string().max(HARD_FIELD_LIMIT).optional(),
});

const envelopeSchema = z.object({
  type: z.literal(REDDIT_DESK_MESSAGE),
  posts: z.array(z.unknown()).max(MAX_DESK_POSTS_INPUT),
  capturedAt: z.number().optional(),
});

/** Validate one untrusted record; null when it is not a post we may show. */
export function deskPostFromUnknown(raw: unknown): DeskPost | null {
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return null;
  const url = normalizeRedditPermalink(parsed.data.url);
  if (!url) return null;
  const title = capText(parsed.data.title, MAX_TITLE);
  if (!title) return null;
  return {
    url,
    title,
    author: capText(parsed.data.author ?? "", MAX_AUTHOR),
    time: capText(parsed.data.time ?? "", MAX_TIME),
    excerpt: capText(parsed.data.excerpt ?? "", MAX_EXCERPT),
  };
}

/** Validate a whole list, de-duplicating by URL and capping at 50. */
export function deskPostsFromUnknown(raw: unknown): DeskPost[] {
  if (!Array.isArray(raw)) return [];
  const out: DeskPost[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_DESK_POSTS) break;
    const post = deskPostFromUnknown(item);
    if (!post || seen.has(post.url)) continue;
    seen.add(post.url);
    out.push(post);
  }
  return out;
}

/**
 * The whole check the desk page makes on a `message` event: the speaker is
 * this window, the origin is this page's own (and one of the two desk
 * origins), and the payload validates. Null means "not for us".
 */
export function readRedditDeskEnvelope(input: {
  origin: string;
  ownOrigin: string;
  source: unknown;
  ownWindow: unknown;
  data: unknown;
}): DeskPost[] | null {
  if (input.origin !== input.ownOrigin) return null;
  if (!(REDDIT_DESK_ORIGINS as readonly string[]).includes(input.ownOrigin)) return null;
  if (input.source !== input.ownWindow) return null;
  const envelope = envelopeSchema.safeParse(input.data);
  if (!envelope.success) return null;
  return deskPostsFromUnknown(envelope.data.posts);
}
