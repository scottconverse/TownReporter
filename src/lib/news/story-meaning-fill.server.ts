import { getSql, withTransaction } from "../db.ts";
import {
  embedTexts,
  vectorToBytes,
  EVIDENCE_DIMS,
  EVIDENCE_MODEL,
} from "./evidence-embed.server.ts";
import { clearStoryMeaningCache, UPLOADED_FILE_SQL } from "./story-meaning-search.server.ts";
import { PARTS_VERSION, articleParts, documentParts } from "./story-meaning-parts.ts";

/**
 * The background half of "search by meaning" for our own stories and for the
 * files an editor uploaded (DEF-1). The same job shape as
 * `evidence-vector-fill.server.ts`:
 *
 *   `fillStoryMeaningOnce` is what `startUnattendedScheduler` calls once a
 *   minute. Each call does a few stories and a few files, newest first, and
 *   returns how many it finished, so the clock never holds a connection across
 *   hours of embedding. Safe to call again at any time.
 *
 *   `pruneStoryMeaningOnce` runs hourly and drops the rows of a story that is
 *   no longer published or deleted and of a file that is gone. The search does
 *   not wait for it: it joins each hit back to the live row, so an unpublished
 *   story is already out of the results.
 *
 * Nothing here stores text. A row is (kind, owner, part) -> vector, plus the
 * md5 of the text it was cut from, which is how an edited story or a re-read
 * file is noticed and embedded again.
 */

/** Marks "this owner has no usable text": stops the fill returning to it. */
const EMPTY_PART = -1;

/** `source_md5` for an article, computed by the database. */
const ARTICLE_KEY_SQL =
  "$1::text || ':' || md5(a.headline || chr(10) || coalesce(a.dek, '') || chr(10) || a.body)";
/** `source_md5` for a file, computed by the database. */
const DOCUMENT_KEY_SQL = "$1::text || ':' || md5(d.full_text)";

type Owner = { owner_id: string; source_md5: string };
type ArticleOwner = Owner & { headline: string; dek: string | null; body: string };
type DocumentOwner = Owner & { full_text: string };

const EMBED_CHUNK = 32;

async function embedAll(parts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < parts.length; i += EMBED_CHUNK) {
    out.push(...(await embedTexts(parts.slice(i, i + EMBED_CHUNK))));
  }
  return out;
}

/**
 * Replace every row of one owner with the vectors for its current text. One
 * transaction: a search sees all of an owner's parts or none of them, and a
 * crash half way leaves the owner pending, not half done.
 */
async function writeOwner(
  kind: "article" | "document",
  owner: Owner,
  parts: string[],
): Promise<void> {
  const vectors = parts.length > 0 ? await embedAll(parts) : [];
  const usable: { part: number; bytes: Uint8Array }[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const vector = vectors[i];
    if (vector && vector.length === EVIDENCE_DIMS) {
      usable.push({ part: i, bytes: vectorToBytes(vector) });
    }
  }
  await withTransaction(async (tx) => {
    await tx`delete from story_meaning_vectors where kind = ${kind} and owner_id = ${owner.owner_id}`;
    if (usable.length === 0) {
      await tx`
        insert into story_meaning_vectors (kind, owner_id, part, source_md5, model, dims, vector)
        values (${kind}, ${owner.owner_id}, ${EMPTY_PART}, ${owner.source_md5}, ${EVIDENCE_MODEL}, 0, ${new Uint8Array(0)})
      `;
      return;
    }
    for (const { part, bytes } of usable) {
      await tx`
        insert into story_meaning_vectors (kind, owner_id, part, source_md5, model, dims, vector)
        values (${kind}, ${owner.owner_id}, ${part}, ${owner.source_md5}, ${EVIDENCE_MODEL}, ${EVIDENCE_DIMS}, ${bytes})
      `;
    }
  });
}

export async function fillStoryMeaningOnce(
  options: { articles?: number; documents?: number } = {},
): Promise<number> {
  const articleBatch = Math.max(0, Math.min(25, Math.floor(options.articles ?? 6)));
  const documentBatch = Math.max(0, Math.min(5, Math.floor(options.documents ?? 1)));
  const sql = await getSql();
  let finished = 0;

  if (articleBatch > 0) {
    const pending = await sql.query<ArticleOwner>(
      `select a.id::text as owner_id, a.headline, a.dek, a.body,
              ${ARTICLE_KEY_SQL} as source_md5
       from articles a
       where a.status = 'published'
         and not exists (
           select 1 from story_meaning_vectors v
           where v.kind = 'article' and v.owner_id = a.id::text
             and v.source_md5 = ${ARTICLE_KEY_SQL}
         )
       order by a.published_at desc, a.id desc
       limit ${articleBatch}`,
      [PARTS_VERSION],
    );
    for (const row of pending) {
      await writeOwner("article", row, articleParts(row));
      finished += 1;
    }
  }

  if (documentBatch > 0) {
    const pending = await sql.query<DocumentOwner>(
      `select d.id as owner_id, d.full_text, ${DOCUMENT_KEY_SQL} as source_md5
       from story_documents d
       where ${UPLOADED_FILE_SQL}
         and not exists (
           select 1 from story_meaning_vectors v
           where v.kind = 'document' and v.owner_id = d.id
             and v.source_md5 = ${DOCUMENT_KEY_SQL}
         )
       order by d.created_at desc, d.id desc
       limit ${documentBatch}`,
      [PARTS_VERSION],
    );
    for (const row of pending) {
      await writeOwner("document", row, documentParts(row.full_text));
      finished += 1;
    }
  }

  if (finished > 0) clearStoryMeaningCache();
  return finished;
}

/**
 * Delete the rows of a story that is no longer published (or is gone) and of
 * a file that is gone or no longer qualifies. Returns how many rows went.
 */
export async function pruneStoryMeaningOnce(): Promise<number> {
  const sql = await getSql();
  const removed = await sql.query<{ owner_id: string }>(
    `delete from story_meaning_vectors v
     where (v.kind = 'article' and not exists (
              select 1 from articles a
              where a.id::text = v.owner_id and a.status = 'published'))
        or (v.kind = 'document' and not exists (
              select 1 from story_documents d
              where d.id = v.owner_id and ${UPLOADED_FILE_SQL}))
     returning v.owner_id`,
  );
  if (removed.length > 0) clearStoryMeaningCache();
  return removed.length;
}
