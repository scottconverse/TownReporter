import { canonicalPublicUrl } from "./fetch-outcome.ts";
import type { ProvenanceItem } from "./findings.ts";

/**
 * The reader's "How we reported this" list: how a story's sources are ordered
 * and deduplicated on the public page.
 *
 * WHY THIS IS ITS OWN MODULE. This rule lived inline in `articles.$slug.tsx`,
 * where nothing could test it and where it compared URLs as raw strings. It is
 * a decision about what a reader is shown -- and, since unit U11b2, about
 * whether a link an owner removed can come back -- so it belongs in a `.ts`
 * file a test can drive, the same shape as `check-gates.ts`,
 * `evidence-check-list.ts` and `finding-evidence-display.ts` beside it.
 */

/**
 * The same source is one source, however its URL is spelled.
 *
 * `canonicalPublicUrl` is the identity retrieval stores captures under and the
 * evidence page resolves them with: it lowercases the host, drops the fragment
 * and the tracking parameters, and trims a trailing slash. Comparing raw
 * strings here meant a story whose provenance held
 * `https://records.example.test/agenda` and whose `source_urls` held the same
 * address with a trailing slash printed that source TWICE: once as the record
 * card -- which may carry "the link was removed at the publisher's request" --
 * and once as a bare URL card with a live "Current source" link, handing back
 * on the same page exactly the link the owner removed.
 *
 * A URL that cannot be parsed is its own identity, which is what it was before
 * this existed.
 *
 * NOT `sourceIdentity`. `url-guard.ts` exports a function of that name, and it
 * answers a different question: the same host-plus-path, or null for anything
 * that is not a fetchable public page. This one never refuses -- a URL it cannot
 * parse is its own identity, because a reader is looking at a printed list and
 * something has to appear in it. Two exports under one name meant an import
 * decided which rule you got, and the reader's list is exactly where the
 * stricter reading (null for a source that would vanish from the list) would
 * have been silently wrong.
 */
export function readerSourceKey(url: string): string {
  try {
    return canonicalPublicUrl(url);
  } catch {
    return url;
  }
}

const GENERIC_SOURCE_TITLES = new Set(["portal", "home", "index", "untitled", "document"]);
const ID_LIKE_TITLE = /^[A-Z]{1,4}\s?[A-Za-z0-9]{10,}$/i;
const COMPACT_ID_TITLE = /^[A-Za-z0-9_-]{10,}$/;
/**
 * G34-R-1 (walk note, Nov 4 2026): a capture whose page had no `<title>` can
 * land with a title built from the URL's own path, and an id-addressed path is
 * all hex: `3f188e D228cf26794f408c829804aab32016c1`. That passed the checks
 * above -- it has letters, it is not a host, and it is not one compact token --
 * so a reader saw two hex strings where a source name belongs.
 *
 * A token of sixteen or more hex characters is a random id, not a word; a title
 * that is mostly such tokens (a short path prefix plus the id) is the same junk
 * spelled with a space. Either way the card falls back to the host, and the
 * full link stays underneath it (G31-W-2). Real titles -- "Joint Service Term
 * Sheet Redacted", "Detail Meeting" -- contain no such token and are untouched.
 */
const HEX_ID_TOKEN = /^[0-9a-f]{16,}$/i;
const SHORT_HEX_TOKEN = /^(?=[0-9a-f]{6,}$)(?=.*\d)(?=.*[a-f])[0-9a-f]+$/i;
/**
 * G35-R-1 (walk note, Nov 4 2026): a CDN file name lands as the source title
 * when the captured page was a document rather than an HTML page:
 * `6a96045e7fe1e956bc0f4d58_Rise%20Against%20ED%20Job%20Description%202026.pdf`.
 * The id and the name are joined by `_` (a CMS file field) or `-`, so
 * `isMostlyHexIdTokens` -- which splits on spaces only -- saw one token that
 * was not all hex and let the whole thing through as a title.
 *
 * The id prefix is dropped and the rest is judged by the same rules as any
 * other title; the words are the stored title's own. See `stripHexIdPrefix`.
 */
const HEX_ID_PREFIX = /^[0-9a-f]{16,}[_-]/i;
/** A file extension says what the file is, not what it is about. Only ever
 * dropped from a name this module already had to strip an id from. */
const DOCUMENT_FILE_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv)$/i;

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isMostlyHexIdTokens(text: string): boolean {
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.some((token) => HEX_ID_TOKEN.test(token))) return true;
  if (tokens.length < 2) return false;
  const idTokens = tokens.filter((token) => SHORT_HEX_TOKEN.test(token)).length;
  return idTokens * 2 >= tokens.length;
}

/**
 * A URL-spelled file name (`Rise%20Against`) read as words. A title with a
 * broken escape (`100% off`) is left exactly as it was: `decodeURIComponent`
 * throws on it, and the reader should see the words the page stored, not a
 * mangled line.
 */
function decodeTitleEscapes(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Drop a leading CMS file id joined to the rest of the name by `_` or `-`.
 * Returns the text unchanged when there is no such prefix, and the bare id
 * (which the junk rules then reject) when the prefix left nothing behind.
 */
function stripHexIdPrefix(text: string): { text: string; stripped: boolean } {
  const match = text.match(HEX_ID_PREFIX);
  if (!match) return { text, stripped: false };
  const rest = text.slice(match[0].length).trim();
  if (!rest) return { text: match[0].slice(0, -1), stripped: false };
  return { text: rest, stripped: true };
}

function isJunkSourceTitle(title: string, url: string): boolean {
  const text = title.trim().replace(/\s+/g, " ");
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters < 4) return true;
  if (GENERIC_SOURCE_TITLES.has(text.toLowerCase())) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (text.toLowerCase().replace(/^www\./, "") === sourceHostname(url)) return true;
  if (isMostlyHexIdTokens(text)) return true;
  if (!/\d/.test(text)) return false;
  return ID_LIKE_TITLE.test(text) || (!/\s/.test(text) && COMPACT_ID_TITLE.test(text));
}

/**
 * The website a reader can recognize when a page did not supply a usable
 * title. This is the last resort, not an editable desk label.
 *
 * G31-W-2 (walk note, Oct 31 2026): the fallback used to be the host plus every
 * path segment -- `longmont.primegov.com / public / portal`. It worked, but it
 * read as a web address rather than as the name of a source, and the card
 * already prints the full link underneath. So the fallback is the bare host
 * (`longmont.primegov.com`): a name a reader can recognize, with the address
 * still one click away on the card. No site is given a name this code invents.
 */
export function readerSourceUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return hostname || url.trim() || "Source";
  } catch {
    return url.trim() || "Source";
  }
}

/**
 * What a source card prints above its record details.
 *
 * A captured `<title>` is the best label when it is real. Form IDs, generic
 * application-shell words and bare URLs are not titles; for those the reader
 * gets the website plus the path instead. No desk-editable replacement label
 * exists, so this stays a pure, testable display rule.
 */
export function readableSourceTitle(title: string, url: string): string {
  const decoded = decodeTitleEscapes(title.trim()).replace(/\s+/g, " ");
  const { text: stripped, stripped: hadIdPrefix } = stripHexIdPrefix(decoded);
  const text = hadIdPrefix ? stripped.replace(DOCUMENT_FILE_EXTENSION, "").trim() : stripped;
  return isJunkSourceTitle(text, url) ? readerSourceUrlLabel(url) : text;
}

/**
 * Records first, then the cited URLs they do not already name.
 *
 * Every URL the story cites reaches "Sources & public records", including the
 * ones the provenance records do not cover: this used to be either/or, so a
 * story with any provenance record printed those and silently dropped the rest
 * of its `source_urls`. A meeting story is exactly the shape that broke -- it
 * is written from a recording, so its one source is the video, and a single
 * captured document anywhere in the story was enough to hide it.
 *
 * The records themselves are passed through untouched, flags and all: a
 * taken-down capture's `excerpt_removed` / `excerpt_removed_link_kept` are what
 * `ProvenanceBlock` renders the card from (unit U11b2).
 */
export function readerProvenanceItems(
  recorded: readonly ProvenanceItem[],
  sources: readonly string[],
): ProvenanceItem[] {
  const seen = new Set<string>();
  const items: ProvenanceItem[] = [];

  for (const item of recorded) {
    const key = item.url ? readerSourceKey(item.url) : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    items.push(item);
  }

  for (const url of sources) {
    const key = readerSourceKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      title: readerSourceUrlLabel(url),
      organization: "",
      document_date: "",
      url,
      captured_at: null,
      version_id: null,
      version_count: null,
      capture_event_id: null,
      disappeared: false,
      role: "source",
    });
  }

  return items;
}
