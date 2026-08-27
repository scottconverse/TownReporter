import { chunksFromEvidence, type PdfPage, type TextChunk } from "./ingest.ts";

export type EvidenceDoc = {
  url: string;
  title: string;
  text: string;
  pages?: PdfPage[];
};

export type RetrievedChunk = {
  url: string;
  title: string;
  excerpt: string;
  locator: string;
  page_number: number | null;
  score: number;
};

export type VersionDiff = {
  added: string[];
  removed: string[];
};

const STOP = new Set([
  "about",
  "after",
  "before",
  "their",
  "there",
  "these",
  "those",
  "which",
  "would",
  "could",
  "should",
  "other",
  "into",
  "from",
  "with",
  "that",
  "this",
  "have",
  "been",
  "were",
  "will",
  "longmont",
]);

export function queryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

export function scoreExcerpt(excerpt: string, queries: string[]): number {
  const blob = excerpt.toLowerCase();
  const tokens = queries.flatMap(queryTokens);
  if (!tokens.length) return 0;
  const uniq = [...new Set(tokens)];
  let score = 0;
  for (const t of uniq) {
    if (blob.includes(t)) score += t.length > 7 ? 2 : 1;
  }
  if (/\$[\d,]+/.test(excerpt)) score += 3;
  if (/\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(excerpt)) {
    score += 2;
  }
  if (/\b(amendment|contract|delay|contradict|previous|prior)\b/i.test(excerpt)) score += 2;
  return score;
}

/**
 * Pick the chunks that answer the current questions. Context limits belong here,
 * not in how much of the document is stored.
 */
export function retrieveRelevantChunks(
  docs: EvidenceDoc[],
  queries: string[],
  opts: { budgetChars?: number; perDoc?: number } = {},
): RetrievedChunk[] {
  const budget = opts.budgetChars ?? 14000;
  const perDoc = opts.perDoc ?? 8;
  const scored: RetrievedChunk[] = [];
  for (const doc of docs) {
    if (!doc.text && !doc.pages?.length) continue;
    const chunks: TextChunk[] = chunksFromEvidence(doc.text, doc.pages);
    const ranked = chunks
      .map((c) => ({
        url: doc.url,
        title: doc.title,
        excerpt: c.excerpt,
        locator: c.locator,
        page_number: c.page_number,
        score: scoreExcerpt(c.excerpt, queries),
      }))
      .sort((a, b) => b.score - a.score);
    const keep: RetrievedChunk[] = [];
    const first = chunks[0];
    const transcriptHead =
      /YouTube transcript/i.test(doc.text.slice(0, 500)) ||
      /\[\d+:\d{2}(?::\d{2})?\]/.test(doc.text.slice(0, 800));
    if (first && !(transcriptHead && scoreExcerpt(first.excerpt, queries) <= 0)) {
      keep.push({
        url: doc.url,
        title: doc.title,
        excerpt: first.excerpt,
        locator: first.locator,
        page_number: first.page_number,
        score: Math.max(1, scoreExcerpt(first.excerpt, queries)),
      });
    }
    for (const c of ranked) {
      if (keep.length >= perDoc) break;
      if (keep.some((k) => k.locator === c.locator)) continue;
      if (c.score <= 0 && keep.length >= 1) continue;
      keep.push(c);
    }
    scored.push(...keep);
  }
  scored.sort((a, b) => b.score - a.score);
  const out: RetrievedChunk[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const c of scored) {
    const key = `${c.url}:${c.locator}`;
    if (seen.has(key)) continue;
    if (used + c.excerpt.length > budget && out.length) continue;
    seen.add(key);
    out.push(c);
    used += c.excerpt.length;
  }
  return out;
}

export function formatRetrievedEvidence(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "(no evidence chunks)";
  return chunks
    .map(
      (c) =>
        `URL ${c.url}\nTITLE ${c.title}\nLOCATOR ${c.locator}${c.page_number != null ? ` page:${c.page_number}` : ""}\n${c.excerpt}`,
    )
    .join("\n\n");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 20);
}

function normPhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Human-readable sentence changes between two captures. */
export function describeTextChanges(older: string, newer: string): VersionDiff {
  if (normPhrase(older) === normPhrase(newer)) return { added: [], removed: [] };
  const a = sentences(older);
  const b = sentences(newer);
  const A = new Set(a.map(normPhrase));
  const B = new Set(b.map(normPhrase));
  return {
    removed: a.filter((s) => !B.has(normPhrase(s))).slice(0, 24),
    added: b.filter((s) => !A.has(normPhrase(s))).slice(0, 24),
  };
}
