import { createHash } from "node:crypto";
import { getSql } from "../db.ts";
import { bytesToVector, dotProduct, EVIDENCE_DIMS } from "./evidence-embed.server.ts";
import { PARTS_VERSION, documentParts } from "./story-meaning-parts.ts";
import { siteUrl } from "../paper.ts";

/**
 * Search by meaning over the paper's OWN published stories and over the files
 * an editor uploaded with "Add documents" (DEF-1). Desk only: nothing in this
 * file is reachable from the public search box.
 *
 * It is given the query's vector (the caller embeds the words once for all the
 * lists) and returns the closest owners, newest data first:
 *
 *   past stories    one row per published story, scored by its closest part
 *                   (the headline + summary, or any body part).
 *   uploaded files  one row per file, scored by its closest part, with the
 *                   start of that part as the excerpt.
 *
 * Two rules the evidence search already keeps are kept here:
 *
 *   - Nothing is stored but vectors. A hit is joined back to the LIVE row at
 *     query time -- `articles.status = 'published'` in the caller's newsroom,
 *     a `story_documents` row that still exists -- so an unpublished or
 *     deleted story is gone from the very next search, whatever the vector
 *     cache still holds. The hourly prune only tidies the table.
 *   - Nonsense gets nothing. A row must reach MEANING_MIN_SCORE, the same
 *     cut the evidence list measured on the real model (Oct 24).
 */

/** Same cut as the evidence list (evidence-search.server.ts, measured Oct 24). */
export const STORY_MEANING_MIN_SCORE = 0.46;
const VECTOR_CACHE_MS = 5 * 60 * 1000;
/** Extra candidates fetched so unpublished ones can be dropped and 5 remain. */
const CANDIDATE_SLACK = 4;

export type PastStoryRow = {
  articleId: number;
  slug: string;
  headline: string;
  publishedAt: string;
  /** Where a reader opens it (the paper's address when one is configured). */
  url: string;
  /** The lead the story came from, so the desk can open it; null for imports. */
  leadId: number | null;
  score: number;
};

export type UploadedFileRow = {
  documentId: string;
  filename: string;
  uploadedAt: string;
  /** The start of the part of the file that matched (cut again, never stored). */
  excerptStart: string;
  leadId: number | null;
  leadHeadline: string | null;
  score: number;
};

export type StoryMeaningCoverage = { covered: number; total: number };

type OwnerVectors = {
  /** owner_id -> its parts, in part order. */
  byOwner: Map<string, { part: number; vector: Float32Array; sourceMd5: string }[]>;
  covered: number;
  total: number;
};
type CacheEntry = { loadedAt: number; value: OwnerVectors };

const cache = new Map<string, CacheEntry>();

/** The fill, the prune and tests call this after writing. */
export function clearStoryMeaningCache(): void {
  cache.clear();
}

function fromRows(
  rows: { owner_id: string; part: number; vector: unknown; source_md5: string }[],
  total: number,
): OwnerVectors {
  const byOwner: OwnerVectors["byOwner"] = new Map();
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.owner_id);
    if (Number(row.part) < 0) continue; // the "nothing usable" marker
    const vector = bytesToVector(row.vector);
    if (vector.length !== EVIDENCE_DIMS) continue;
    const list = byOwner.get(row.owner_id) ?? [];
    list.push({ part: Number(row.part), vector, sourceMd5: row.source_md5 });
    byOwner.set(row.owner_id, list);
  }
  return { byOwner, covered: seen.size, total };
}

async function loadArticleVectors(newsroomId: number): Promise<OwnerVectors> {
  const key = `article:${newsroomId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < VECTOR_CACHE_MS) return hit.value;
  const sql = await getSql();
  const [rows, totals] = await Promise.all([
    sql.query<{ owner_id: string; part: number; vector: unknown; source_md5: string }>(
      `select v.owner_id, v.part, v.vector, v.source_md5
       from story_meaning_vectors v
       join articles a on a.id::text = v.owner_id
       where v.kind = 'article' and a.newsroom_id = $1 and a.status = 'published'`,
      [newsroomId],
    ),
    sql.query<{ n: number }>(
      `select count(*)::int as n from articles where newsroom_id = $1 and status = 'published'`,
      [newsroomId],
    ),
  ]);
  const value = fromRows(rows, totals[0]?.n ?? 0);
  cache.set(key, { loadedAt: Date.now(), value });
  return value;
}

/** Files that count as "uploaded": read, with text, not a fetched web document. */
export const UPLOADED_FILE_SQL = `
  d.status = 'read'
  and d.full_text is not null
  and length(d.full_text) >= 20
  and d.source_url is null
  and d.mime <> 'application/x-townreporter-source-links'`;

async function loadDocumentVectors(newsroomId: number): Promise<OwnerVectors> {
  const key = `document:${newsroomId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < VECTOR_CACHE_MS) return hit.value;
  const sql = await getSql();
  const [rows, totals] = await Promise.all([
    sql.query<{ owner_id: string; part: number; vector: unknown; source_md5: string }>(
      `select v.owner_id, v.part, v.vector, v.source_md5
       from story_meaning_vectors v
       join story_documents d on d.id = v.owner_id
       where v.kind = 'document' and d.newsroom_id = $1 and ${UPLOADED_FILE_SQL}`,
      [newsroomId],
    ),
    sql.query<{ n: number }>(
      `select count(*)::int as n from story_documents d
       where d.newsroom_id = $1 and ${UPLOADED_FILE_SQL}`,
      [newsroomId],
    ),
  ]);
  const value = fromRows(rows, totals[0]?.n ?? 0);
  cache.set(key, { loadedAt: Date.now(), value });
  return value;
}

/** Rank owners by their closest part. Returns [ownerId, bestPart, score]. */
function rank(
  index: OwnerVectors,
  queryVector: Float32Array,
  take: number,
): { ownerId: string; part: number; sourceMd5: string; score: number }[] {
  const scored: { ownerId: string; part: number; sourceMd5: string; score: number }[] = [];
  for (const [ownerId, parts] of index.byOwner) {
    let best = Number.NEGATIVE_INFINITY;
    let bestPart = 0;
    let bestKey = "";
    for (const entry of parts) {
      const score = dotProduct(queryVector, entry.vector);
      if (score > best) {
        best = score;
        bestPart = entry.part;
        bestKey = entry.sourceMd5;
      }
    }
    if (best >= STORY_MEANING_MIN_SCORE) {
      scored.push({ ownerId, part: bestPart, sourceMd5: bestKey, score: best });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, take);
}

/** How many of this newsroom's published stories have a vector. */
export async function pastStoryCoverage(newsroomId: number): Promise<StoryMeaningCoverage> {
  const index = await loadArticleVectors(newsroomId);
  return { covered: index.covered, total: index.total };
}

/** How many of this newsroom's uploaded files have a vector. */
export async function uploadedFileCoverage(newsroomId: number): Promise<StoryMeaningCoverage> {
  const index = await loadDocumentVectors(newsroomId);
  return { covered: index.covered, total: index.total };
}

/**
 * The published stories closest in meaning to the query vector. A story whose
 * lead is `excludeLeadId` is left out (the story being written is not "past").
 */
export async function searchPastStories(
  newsroomId: number,
  queryVector: Float32Array,
  options: { limit?: number; excludeLeadId?: number } = {},
): Promise<PastStoryRow[]> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const index = await loadArticleVectors(newsroomId);
  const candidates = rank(index, queryVector, limit * CANDIDATE_SLACK);
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => Number(c.ownerId)).filter((n) => Number.isInteger(n));
  const sql = await getSql();
  // The live row decides: published, this newsroom, still there.
  const rows = await sql.query<{
    id: number;
    slug: string;
    headline: string;
    published_at: string;
    lead_id: number | null;
  }>(
    `select a.id, a.slug, a.headline, a.published_at::text as published_at, a.lead_id
     from articles a
     where a.id = any($1::int[]) and a.newsroom_id = $2 and a.status = 'published'`,
    [ids, newsroomId],
  );
  const live = new Map(rows.map((row) => [String(row.id), row]));
  const out: PastStoryRow[] = [];
  for (const candidate of candidates) {
    const row = live.get(candidate.ownerId);
    if (!row) continue;
    if (options.excludeLeadId !== undefined && row.lead_id === options.excludeLeadId) continue;
    out.push({
      articleId: row.id,
      slug: row.slug,
      headline: row.headline,
      publishedAt: row.published_at,
      url: siteUrl(`/articles/${row.slug}`),
      leadId: row.lead_id,
      score: candidate.score,
    });
    if (out.length >= limit) break;
  }
  return out;
}

const EXCERPT_CHARS = 200;

/** The uploaded files closest in meaning to the query vector. */
export async function searchUploadedFiles(
  newsroomId: number,
  queryVector: Float32Array,
  options: { limit?: number } = {},
): Promise<UploadedFileRow[]> {
  const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 3)));
  const index = await loadDocumentVectors(newsroomId);
  const candidates = rank(index, queryVector, limit * CANDIDATE_SLACK);
  if (candidates.length === 0) return [];

  const sql = await getSql();
  // The live row decides, and supplies the text to cut again for the excerpt.
  const rows = await sql.query<{
    id: string;
    filename: string;
    created_at: string;
    full_text: string;
    lead_id: number | null;
    lead_headline: string | null;
  }>(
    `select d.id, d.filename, d.created_at::text as created_at, d.full_text, d.lead_id,
            l.headline as lead_headline
     from story_documents d
     left join leads l on l.id = d.lead_id and l.newsroom_id = d.newsroom_id
     where d.id = any($1::text[]) and d.newsroom_id = $2 and ${UPLOADED_FILE_SQL}`,
    [candidates.map((c) => c.ownerId), newsroomId],
  );
  const live = new Map(rows.map((row) => [row.id, row]));
  const out: UploadedFileRow[] = [];
  for (const candidate of candidates) {
    const row = live.get(candidate.ownerId);
    if (!row) continue;
    // The vector was cut from different text (the file was read again and the
    // fill has not caught up): its part number points at the wrong words.
    const key = `${PARTS_VERSION}:${createHash("md5").update(row.full_text, "utf8").digest("hex")}`;
    if (key !== candidate.sourceMd5) continue;
    const part = documentParts(row.full_text)[candidate.part] ?? "";
    out.push({
      documentId: row.id,
      filename: row.filename,
      uploadedAt: row.created_at,
      excerptStart: part.slice(0, EXCERPT_CHARS),
      leadId: row.lead_id,
      leadHeadline: row.lead_headline,
      score: candidate.score,
    });
    if (out.length >= limit) break;
  }
  return out;
}
