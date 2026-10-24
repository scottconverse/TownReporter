import { getSql } from "../db.ts";
import {
  bytesToVector,
  dotProduct,
  embedTexts,
  EVIDENCE_DIMS,
} from "./evidence-embed.server.ts";

/**
 * Evidence search for the Story page (D285/D286).
 *
 * Two lists, two rules:
 *
 *   Exact words  -- the substring rule the desk already knows, on
 *                   `artifact_chunks.excerpt`, scoped to the newsroom, one row
 *                   per distinct excerpt (the newest capture wins).
 *   Close in     -- MiniLM vectors held in `evidence_vectors`, compared in
 *   meaning        memory. The table stores only md5(excerpt) -> vector: no
 *                  text, no url, so the vector store cannot become a second
 *                  copy of the archive that a takedown would have to chase.
 *                  Every hit is joined back to a live chunk, which is what
 *                  makes a takedown (excerpt blanked) or a legal removal
 *                  (chunk rows deleted) drop out of the next search.
 *
 * The vectors are loaded once per process and reloaded after five minutes;
 * the fill and prune paths clear the cache so a freshly embedded piece is
 * visible on the very next search.
 */

export type EvidenceRow = {
  md5: string;
  chunkId: number;
  versionId: number;
  title: string;
  url: string;
  capturedAt: string;
  excerptStart: string;
  score?: number;
};

export type EvidenceMeaningStatus = {
  ready: boolean;
  reason?: string;
  covered: number;
  total: number;
};

export type EvidenceSearchResult =
  | {
      ok: true;
      exact: EvidenceRow[];
      meaning: EvidenceRow[];
      meaningStatus: EvidenceMeaningStatus;
    }
  | { ok: false; error: string };

export const EVIDENCE_QUERY_MAX = 200;
export const EVIDENCE_QUERY_EMPTY = "Type a few words to search.";
const EXACT_LIMIT = 30;
const MEANING_CANDIDATES = 60;
const MEANING_LIMIT = 5;
const VECTOR_CACHE_MS = 5 * 60 * 1000;

type ChunkRow = {
  md5: string;
  chunk_id: number;
  version_id: number;
  title: string | null;
  url: string;
  captured_at: string;
  excerpt_start: string;
};

type VectorCache = { loadedAt: number; vectors: Map<string, Float32Array> };
let vectorCache: VectorCache | null = null;

/** Tests, the fill clock and the prune clock call this after writing. */
export function clearEvidenceVectorCache(): void {
  vectorCache = null;
}

/** Every stored vector, at most once per five minutes. */
async function loadVectors(): Promise<Map<string, Float32Array>> {
  if (vectorCache && Date.now() - vectorCache.loadedAt < VECTOR_CACHE_MS) {
    return vectorCache.vectors;
  }
  const sql = await getSql();
  const rows = await sql<{ excerpt_md5: string; vector: unknown }>`
    select excerpt_md5, vector from evidence_vectors
  `;
  const vectors = new Map<string, Float32Array>();
  for (const row of rows) {
    const vector = bytesToVector(row.vector);
    if (vector.length === EVIDENCE_DIMS) vectors.set(row.excerpt_md5, vector);
  }
  vectorCache = { loadedAt: Date.now(), vectors };
  return vectors;
}

/** Escape the three characters LIKE treats specially, for `escape '\'`. */
export function escapeLikeQuery(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function toRow(row: ChunkRow, score?: number): EvidenceRow {
  const out: EvidenceRow = {
    md5: row.md5,
    chunkId: row.chunk_id,
    versionId: row.version_id,
    title: row.title ?? "",
    url: row.url,
    capturedAt: row.captured_at,
    excerptStart: row.excerpt_start,
  };
  if (score !== undefined) out.score = score;
  return out;
}

/** The exact-words list: one row per distinct excerpt, newest capture first. */
async function exactRows(newsroomId: number, q: string): Promise<EvidenceRow[]> {
  const sql = await getSql();
  const pattern = `%${escapeLikeQuery(q)}%`;
  const rows = await sql<ChunkRow>`
    select * from (
      select distinct on (md5(c.excerpt))
        md5(c.excerpt) as md5,
        c.id as chunk_id,
        c.version_id,
        v.title,
        v.url,
        v.captured_at::text as captured_at,
        left(c.excerpt, 200) as excerpt_start
      from artifact_chunks c
      join artifact_versions v on v.id = c.version_id
      where c.newsroom_id = ${newsroomId}
        and c.excerpt <> ''
        and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)
        and c.excerpt ilike ${pattern} escape '\\'
      order by md5(c.excerpt), v.captured_at desc, c.id desc
    ) t
    order by captured_at desc
    limit ${EXACT_LIMIT}
  `;
  return rows.map((row) => toRow(row));
}

/** How much of this newsroom's evidence has a vector so far. */
async function coverage(
  newsroomId: number,
): Promise<{ covered: number; total: number }> {
  const sql = await getSql();
  const [row] = await sql<{ covered: number; total: number }>`
    select
      (select count(distinct md5(c.excerpt))::int
         from artifact_chunks c
         join evidence_vectors ev on ev.excerpt_md5 = md5(c.excerpt)
        where c.newsroom_id = ${newsroomId} and c.excerpt <> ''
          and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)) as covered,
      (select count(distinct md5(c.excerpt))::int
         from artifact_chunks c
        where c.newsroom_id = ${newsroomId} and c.excerpt <> ''
          and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)) as total
  `;
  return { covered: row?.covered ?? 0, total: row?.total ?? 0 };
}

/** The meaning list, or the reason it could not be drawn. */
async function meaningRows(
  newsroomId: number,
  q: string,
  exactMd5s: Set<string>,
): Promise<{ rows: EvidenceRow[]; error?: string }> {
  let queryVector: Float32Array;
  try {
    const [embedded] = await embedTexts([q]);
    if (!embedded) throw new Error("the meaning model returned nothing");
    queryVector = embedded;
  } catch (err) {
    return { rows: [], error: shortReason(err) };
  }

  let vectors: Map<string, Float32Array>;
  try {
    vectors = await loadVectors();
  } catch (err) {
    return { rows: [], error: shortReason(err) };
  }

  const scored: { md5: string; score: number }[] = [];
  for (const [md5, vector] of vectors) {
    if (exactMd5s.has(md5)) continue;
    scored.push({ md5, score: dotProduct(queryVector, vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, MEANING_CANDIDATES);
  if (candidates.length === 0) return { rows: [] };

  const scoreByMd5 = new Map(candidates.map((c) => [c.md5, c.score]));
  const sql = await getSql();
  const md5s = candidates.map((c) => c.md5);
  const rows = await sql<ChunkRow>`
    select * from (
      select distinct on (md5(c.excerpt))
        md5(c.excerpt) as md5,
        c.id as chunk_id,
        c.version_id,
        v.title,
        v.url,
        v.captured_at::text as captured_at,
        left(c.excerpt, 200) as excerpt_start
      from artifact_chunks c
      join artifact_versions v on v.id = c.version_id
      where c.newsroom_id = ${newsroomId}
        and c.excerpt <> ''
        and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)
        and md5(c.excerpt) = any(${md5s}::text[])
      order by md5(c.excerpt), v.captured_at desc, c.id desc
    ) t
  `;
  const best = rows
    .map((row) => toRow(row, scoreByMd5.get(row.md5) ?? 0))
    .filter((row) => !exactMd5s.has(row.md5))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MEANING_LIMIT);
  return { rows: best };
}

function shortReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const trimmed = message.trim().replace(/\s+/g, " ").replace(/\.$/, "").slice(0, 160);
  return trimmed || "the meaning model did not load";
}

export async function searchEvidence(
  context: { newsroomId: number },
  rawQuery: string,
): Promise<EvidenceSearchResult> {
  const q = String(rawQuery ?? "").trim();
  if (!q || q.length > EVIDENCE_QUERY_MAX) {
    return { ok: false, error: EVIDENCE_QUERY_EMPTY };
  }

  const [exact, counts] = await Promise.all([
    exactRows(context.newsroomId, q),
    coverage(context.newsroomId),
  ]);
  const exactMd5s = new Set(exact.map((row) => row.md5));
  const meaning = await meaningRows(context.newsroomId, q, exactMd5s);

  const meaningStatus: EvidenceMeaningStatus = {
    ready: !meaning.error,
    covered: counts.covered,
    total: counts.total,
  };
  if (meaning.error) meaningStatus.reason = meaning.error;

  return { ok: true, exact, meaning: meaning.rows, meaningStatus };
}
