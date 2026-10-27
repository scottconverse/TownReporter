import { getSql } from "../db.ts";
import {
  bytesToVector,
  dotProduct,
  embedTexts,
  EVIDENCE_DIMS,
} from "./evidence-embed.server.ts";
import {
  pastStoryCoverage,
  searchPastStories,
  searchUploadedFiles,
  uploadedFileCoverage,
  type PastStoryRow,
  type StoryMeaningCoverage,
  type UploadedFileRow,
} from "./story-meaning-search.server.ts";

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
 * Two more meaning lists come from the paper's own material (DEF-1, desk only):
 * the published stories ("Our past stories close in meaning") and the files an
 * editor uploaded, which join "Close in meaning" with a "your file" label.
 * See `story-meaning-search.server.ts`. They are warn-only: if the model or the
 * table is not there, the evidence lists above are unchanged and the status
 * says the meaning lists are not available now.
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
  /** "file" marks an uploaded file (DEF-1); evidence rows leave this unset. */
  kind?: "file";
  /** For a file: the story it was uploaded to, so the desk can open it. */
  leadId?: number | null;
  leadHeadline?: string | null;
};

export type EvidenceMeaningStatus = {
  ready: boolean;
  reason?: string;
  covered: number;
  total: number;
};

/** Whether the paper's own stories and files could be searched by meaning. */
export type PastStoriesStatus = {
  ready: boolean;
  reason?: string;
  stories: StoryMeaningCoverage;
  files: StoryMeaningCoverage;
};

export type EvidenceSearchResult =
  | {
      ok: true;
      exact: EvidenceRow[];
      /** Evidence pieces, plus the editor's own uploaded files ("your file"). */
      meaning: EvidenceRow[];
      meaningStatus: EvidenceMeaningStatus;
      /** The paper's own published stories closest in meaning, newest data. */
      pastStories: PastStoryRow[];
      pastStoriesStatus: PastStoriesStatus;
    }
  | { ok: false; error: string };

export const EVIDENCE_QUERY_MAX = 200;
export const EVIDENCE_QUERY_EMPTY = "Type a few words to search.";
const EXACT_LIMIT = 30;
/** How many newest matching rows the exact-words list reads before it settles (see exactRows). */
const EXACT_PREFETCH = 600;
const MEANING_CANDIDATES = 60;
const MEANING_LIMIT = 5;
/** Past stories shown in the third list, and files mixed into "Close in meaning". */
export const PAST_STORIES_LIMIT = 5;
const FILE_LIMIT = 3;
const VECTOR_CACHE_MS = 5 * 60 * 1000;
/** Pieces and coverage counts per newsroom: fresh within about a minute. */
const PIECES_CACHE_MS = 30 * 1000;
/**
 * S2. A query has no meaning matches unless this newsroom's closest piece
 * reaches this cosine score. Measured Oct 24 on all 22,223 readable excerpts of
 * newsroom 1 (Xenova/all-MiniLM-L6-v2): the closest piece for the 12 nonsense
 * strings is at most 0.4232 ("vybrunt xoxo tlk"); the closest for the 26 real
 * queries is at least 0.4934 ("school board"). 0.46 sits between them.
 */
export const MEANING_MIN_SCORE = 0.46;

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

/** The live, readable pieces of one newsroom, and how many have a vector. */
type LivePieces = {
  loadedAt: number;
  md5s: Set<string>;
  covered: number;
  total: number;
};
const piecesCache = new Map<number, LivePieces>();

/** Tests, the fill clock and the prune clock call this after writing. */
export function clearEvidenceVectorCache(): void {
  vectorCache = null;
  piecesCache.clear();
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

/**
 * The exact-words list: one row per distinct excerpt, newest capture first.
 *
 * G24-S3-2: the whole match set used to be sorted by excerpt hash just to keep
 * one row per distinct excerpt (0.4 s on a common word). The rows are now read
 * newest-first and only the first EXACT_PREFETCH are taken; the first row seen
 * for an excerpt is its newest capture, which is the one the old query kept. If
 * those rows hold 30 distinct excerpts, or the match set is smaller than the
 * prefetch, the answer is the same as the full query's. Only when many matches
 * are copies of the same excerpt (fewer than 30 distinct in the prefetch) does
 * it fall back to the full query, so the list never changes. Migration 0157's
 * trigram index serves the `ilike`.
 */
async function exactRows(newsroomId: number, q: string): Promise<EvidenceRow[]> {
  const sql = await getSql();
  const pattern = `%${escapeLikeQuery(q)}%`;
  const recent = await sql<ChunkRow>`
    select
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
    order by v.captured_at desc, c.id desc
    limit ${EXACT_PREFETCH}
  `;
  const seen = new Set<string>();
  const firstOfEach: ChunkRow[] = [];
  for (const row of recent) {
    if (seen.has(row.md5)) continue;
    seen.add(row.md5);
    firstOfEach.push(row);
  }
  if (firstOfEach.length >= EXACT_LIMIT || recent.length < EXACT_PREFETCH) {
    return firstOfEach.slice(0, EXACT_LIMIT).map((row) => toRow(row));
  }
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

/**
 * This newsroom's live, readable pieces (one per distinct excerpt) and how many
 * of them have a vector. One query, kept for `PIECES_CACHE_MS`; the fill and
 * prune paths clear it, and a takedown is still dropped by the live row query.
 */
async function livePieces(newsroomId: number): Promise<LivePieces> {
  const cached = piecesCache.get(newsroomId);
  if (cached && Date.now() - cached.loadedAt < PIECES_CACHE_MS) return cached;
  const loadedAt = Date.now();
  const sql = await getSql();
  const rows = await sql<{ md5: string; has_vector: boolean }>`
    select m.md5, (ev.excerpt_md5 is not null) as has_vector
    from (
      select distinct md5(c.excerpt) as md5
      from artifact_chunks c
      where c.newsroom_id = ${newsroomId} and c.excerpt <> ''
        and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)
    ) m
    left join evidence_vectors ev on ev.excerpt_md5 = m.md5
  `;
  const md5s = new Set<string>();
  let covered = 0;
  for (const row of rows) {
    md5s.add(row.md5);
    if (row.has_vector) covered += 1;
  }
  const pieces: LivePieces = { loadedAt, md5s, covered, total: md5s.size };
  piecesCache.set(newsroomId, pieces);
  return pieces;
}

/** The query's meaning vector, or the reason the model could not give one. */
async function embedQuery(q: string): Promise<{ vector: Float32Array } | { error: string }> {
  try {
    const [embedded] = await embedTexts([q]);
    if (!embedded) throw new Error("the meaning model returned nothing");
    return { vector: embedded };
  } catch (err) {
    return { error: shortReason(err) };
  }
}

/** The meaning list, or the reason it could not be drawn. */
async function meaningRows(
  newsroomId: number,
  exactMd5s: Set<string>,
  pieces: LivePieces,
  queryVector: Float32Array,
): Promise<{ rows: EvidenceRow[]; error?: string }> {
  let vectors: Map<string, Float32Array>;
  try {
    vectors = await loadVectors();
  } catch (err) {
    return { rows: [], error: shortReason(err) };
  }

  // Rank only this newsroom's live, readable pieces, so another paper's
  // pieces can never fill the candidate list and push this one out (S1).
  const scored: { md5: string; score: number }[] = [];
  let closest = Number.NEGATIVE_INFINITY;
  for (const md5 of pieces.md5s) {
    const vector = vectors.get(md5);
    if (!vector) continue;
    const score = dotProduct(queryVector, vector);
    if (score > closest) closest = score;
    if (exactMd5s.has(md5)) continue;
    scored.push({ md5, score });
  }
  // Nonsense has no close piece in the newsroom, so it gets no meaning list (S2).
  if (closest < MEANING_MIN_SCORE) return { rows: [] };
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

/** An uploaded file as a row in "Close in meaning", labelled "your file" on screen. */
function fileToRow(file: UploadedFileRow): EvidenceRow {
  return {
    md5: `file-${file.documentId}`,
    chunkId: 0,
    versionId: 0,
    title: file.filename,
    url: "",
    capturedAt: file.uploadedAt,
    excerptStart: file.excerptStart,
    score: file.score,
    kind: "file",
    leadId: file.leadId,
    leadHeadline: file.leadHeadline,
  };
}

/**
 * The paper's own stories and the editor's uploaded files, by meaning. Never
 * throws: a missing table or a failed read becomes `ready: false`, and the
 * evidence lists are drawn as if this did not exist.
 */
async function ownMeaning(
  newsroomId: number,
  embedded: { vector: Float32Array } | { error: string },
): Promise<{ stories: PastStoryRow[]; files: UploadedFileRow[]; status: PastStoriesStatus }> {
  const none = { covered: 0, total: 0 };
  if ("error" in embedded) {
    return {
      stories: [],
      files: [],
      status: { ready: false, reason: embedded.error, stories: none, files: none },
    };
  }
  try {
    const [stories, files, storyCoverage, fileCoverage] = await Promise.all([
      searchPastStories(newsroomId, embedded.vector, { limit: PAST_STORIES_LIMIT }),
      searchUploadedFiles(newsroomId, embedded.vector, { limit: FILE_LIMIT }),
      pastStoryCoverage(newsroomId),
      uploadedFileCoverage(newsroomId),
    ]);
    return {
      stories,
      files,
      status: { ready: true, stories: storyCoverage, files: fileCoverage },
    };
  } catch (err) {
    return {
      stories: [],
      files: [],
      status: { ready: false, reason: shortReason(err), stories: none, files: none },
    };
  }
}

export async function searchEvidence(
  context: { newsroomId: number },
  rawQuery: string,
): Promise<EvidenceSearchResult> {
  const q = String(rawQuery ?? "").trim();
  if (!q || q.length > EVIDENCE_QUERY_MAX) {
    return { ok: false, error: EVIDENCE_QUERY_EMPTY };
  }

  const [exact, pieces] = await Promise.all([
    exactRows(context.newsroomId, q),
    livePieces(context.newsroomId),
  ]);
  const exactMd5s = new Set(exact.map((row) => row.md5));
  const embedded = await embedQuery(q);
  const meaning =
    "error" in embedded
      ? { rows: [] as EvidenceRow[], error: embedded.error }
      : await meaningRows(context.newsroomId, exactMd5s, pieces, embedded.vector);
  const own = await ownMeaning(context.newsroomId, embedded);

  const meaningStatus: EvidenceMeaningStatus = {
    ready: !meaning.error,
    covered: pieces.covered,
    total: pieces.total,
  };
  if (meaning.error) meaningStatus.reason = meaning.error;

  // Files sit in "Close in meaning" beside the evidence, closest first.
  const meaningWithFiles = [...meaning.rows, ...own.files.map(fileToRow)].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );

  return {
    ok: true,
    exact,
    meaning: meaningWithFiles,
    meaningStatus,
    pastStories: own.stories,
    pastStoriesStatus: own.status,
  };
}
