/**
 * The one line under a headline never goes missing.
 *
 * Unit CK, release 0.6.80: two stories printed with `articles.dek` empty and
 * every reader-facing spot that prints a dek verbatim -- `<p
 * className="dek">{lead.dek}</p>` (`index.tsx:406`) chief among them -- left a
 * visible hole instead of falling back to anything. Publishing now refuses an
 * empty dek (`desk.ts` `performPublish`, `opinion.ts`
 * `performPublishEditorial`), but the archive already holds stories filed
 * before that gate existed, so the render side needs its own answer too.
 *
 * Every render spot that shows a dek -- the front-page lead, a story listing
 * row, the story page, the Opinion panel -- calls `dekOrFallback` and nothing
 * else, so the fallback text and its cutoff live in exactly one place.
 */

const DEK_FALLBACK_LIMIT = 240;

/**
 * The first sentence of `body`, cut at a word boundary at
 * `DEK_FALLBACK_LIMIT` characters, for use as a dek when none was written.
 *
 * Whitespace is collapsed first so a body pasted with hard line breaks does
 * not cut mid-word on a line break that was never a real word boundary.
 */
export function firstSentenceForDek(body: string | null | undefined): string {
  const text = String(body ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  let sentence = (match ? match[0] : text).trim();
  if (sentence.length > DEK_FALLBACK_LIMIT) {
    const cut = sentence.slice(0, DEK_FALLBACK_LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    sentence = `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }
  return sentence;
}

/**
 * The dek to print: the stored one, trimmed, or the first sentence of the
 * body when the stored one is empty or whitespace-only.
 *
 * The single call every render spot makes -- never `story.dek` directly.
 */
export function dekOrFallback(dek: string | null | undefined, body: string | null | undefined): string {
  const clean = String(dek ?? "").trim();
  return clean || firstSentenceForDek(body);
}
