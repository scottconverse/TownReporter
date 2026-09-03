/*
  The parser behind "Write a story" — one box on the Desk landing page that
  takes a URL, pasted text, or a bare idea and turns it into the same shape
  `fileLead` already accepts: a headline, a why-now line, a topic, and up to
  eight source URLs. Kept client-safe (no db import) so it can be unit tested
  on its own and reused by the server function that files the lead.
*/
import { sanitizePublicUrls } from "./schema.ts";
import { topicFromText } from "./desk-copy.ts";

export const WRITE_STORY_SCRATCH_LIMIT = 8000;
const HEADLINE_LIMIT = 180;
const MAX_SOURCE_URLS = 8;

// http(s) URLs anywhere in the pasted text, including mid-sentence.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export type WriteStoryParsed = {
  headline: string;
  why: string;
  topic: string;
  urls: string[];
  scratch: string;
};

export type WriteStoryParseResult =
  | { ok: true; value: WriteStoryParsed }
  | { ok: false; error: string };

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

/** First sentence of a block of text, ending on `.`, `!` or `?`, or the whole thing if none is found. */
function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/**
 * Turn free-form input — a URL, pasted text, an idea, any mix — into a lead.
 *
 * Rules, in order:
 *  1. Every http(s) URL anywhere in the text becomes a source URL (deduped,
 *     public-address only, capped at 8).
 *  2. What's left, with the URLs stripped out, supplies the headline: the
 *     first non-empty line if it reads as a headline (≤180 chars); otherwise
 *     the first sentence of the remaining text, capped at 180; otherwise —
 *     when the input was nothing but a URL — the first source's host and
 *     path.
 *  3. The why-now line is a fixed sentence, with the second line of the
 *     input appended when there is one.
 *  4. The topic defaults to "council", or whatever `topicFromText` reads
 *     out of the pasted text.
 *  5. The full original text is kept verbatim as the reporting-notes
 *     scratch, capped at 8000 chars, so the draft reads it as evidence.
 */
export function parseWriteStoryInput(rawText: string): WriteStoryParseResult {
  const text = String(rawText ?? "");
  const found = text.match(URL_RE) ?? [];
  const urls = sanitizePublicUrls(found).slice(0, MAX_SOURCE_URLS);

  const withoutUrls = text.replace(URL_RE, " ");
  const lines = withoutUrls
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let headline = "";
  let secondLine: string | null = null;

  if (lines.length > 0 && lines[0]!.length <= HEADLINE_LIMIT) {
    headline = lines[0]!;
    secondLine = lines[1] ?? null;
  } else if (lines.length > 0) {
    headline = firstSentence(lines.join(" ")).slice(0, HEADLINE_LIMIT);
  } else if (urls.length > 0) {
    headline = `Story from ${hostAndPath(urls[0]!)}`.slice(0, HEADLINE_LIMIT);
  }

  headline = headline.trim();
  if (headline.length < 8) {
    return {
      ok: false,
      error: "Paste a link, a bit of text, or the idea — there's not enough here to file yet.",
    };
  }

  let why = "Filed from the Write a story box.";
  if (secondLine) why = `${why} ${secondLine}`;
  why = why.slice(0, 800);

  const topic = topicFromText(text);
  const scratch = text.trim().slice(0, WRITE_STORY_SCRATCH_LIMIT);

  return { ok: true, value: { headline, why, topic, urls, scratch } };
}
