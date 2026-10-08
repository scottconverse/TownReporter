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
const DEK_WORD_CAP = 45;

const DEK_PROCESS_WORDS = /\b(?:supplied|passage|record|establish(?:es|ed|ing)?|action\s+account|tier)\b/i;
const DEK_STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "before", "being", "but", "for", "from", "has", "have",
  "into", "its", "more", "that", "the", "their", "there", "this", "those", "through", "under", "was",
  "were", "what", "when", "where", "which", "while", "with", "would",
]);

function dekTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g) ?? [])
    .filter((word) => word.length > 3 && !DEK_STOP_WORDS.has(word));
}

/** Writer-side rules for the short summary under a headline. */
export function dekRuleProblems(dek: string, headline: string, body: string): string[] {
  const clean = dek.trim().replace(/\s+/g, " ");
  if (!clean) return ["The dek is empty."];
  const words = clean.split(/\s+/).length;
  const sentences = clean
    .split(/(?<=[!?])\s+|(?<=[.!?])\s+(?=[A-Z“"'(])/)
    .filter(Boolean);
  const problems: string[] = [];
  if (sentences.length < 1 || sentences.length > 2) problems.push("Write one or two sentences.");
  if (words < 20 || words > 40) problems.push("Write 20 to 40 words, never more than 45.");
  if (DEK_PROCESS_WORDS.test(clean)) problems.push("Remove process words such as supplied, passage, record, establish, action account and tier.");

  const firstParagraph = body.split(/\r?\n\s*\r?\n/)[0] ?? body;
  const dekWords = dekTerms(clean);
  const paragraphWords = new Set(dekTerms(firstParagraph));
  const overlap = dekWords.filter((word) => paragraphWords.has(word)).length;
  if (dekWords.length < 3 || overlap / dekWords.length < 0.3) {
    problems.push("Match the first paragraph's lead story and facts.");
  }
  const headlineWords = new Set(dekTerms(headline));
  if (dekWords.length >= 6 && dekWords.every((word) => headlineWords.has(word))) {
    problems.push("Add to the headline instead of repeating it.");
  }
  return problems;
}

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
  let end = text.search(/[.!?](?=\s|$)/);
  while (end >= 0 && text[end] === "." && /\b(?:Jan|Feb|Aug|Sept|Oct|Nov|Dec)\.$/i.test(text.slice(0, end + 1).split(" ").at(-1) ?? "")) {
    const next = text.slice(end + 1).search(/[.!?](?=\s|$)/);
    end = next < 0 ? -1 : end + 1 + next;
  }
  let sentence = (end >= 0 ? text.slice(0, end + 1) : text).trim();
  if (sentence.length > DEK_FALLBACK_LIMIT) {
    const cut = sentence.slice(0, DEK_FALLBACK_LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    sentence = `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }
  const words = sentence.split(/\s+/);
  if (words.length > DEK_WORD_CAP) sentence = `${words.slice(0, DEK_WORD_CAP).join(" ")}…`;
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
