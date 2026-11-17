import { getSql } from "../db.ts";
import {
  embedTexts,
  vectorToBytes,
  EVIDENCE_DIMS,
  EVIDENCE_MODEL,
} from "./evidence-embed.server.ts";
import { clearEvidenceVectorCache } from "./evidence-search.server.ts";

/**
 * The background half of meaning search (D286): give every distinct evidence
 * excerpt a vector, a batch at a time, and drop vectors whose excerpt no
 * longer exists anywhere.
 *
 * `fillEvidenceVectorsOnce` is what `startUnattendedScheduler` calls once a
 * minute; each call does `batch` excerpts and returns how many it inserted, so
 * the clock never holds a transaction open across thousands of embeddings.
 * Both functions are safe to call again at any time (`on conflict do nothing`,
 * and a prune that only deletes rows no live chunk can match).
 *
 * Nothing here stores text: the row is md5(excerpt) -> vector, so pruning a
 * vector after a takedown also leaves no residue of the passage itself.
 */

/**
 * Nov 17 2026: the old fill read every row of `artifact_chunks` (distinct on
 * md5, a sort, a regexp on each row) once a minute. That took about two
 * minutes, so it ran back to back all day, slowed the desk pages and the
 * nightly backup, and kept a query open after the app stopped.
 *
 * Now the fill walks the table by id. Each call reads at most `window` rows
 * after the last id it saw (a primary-key range, not the whole table) and
 * moves the mark forward. New chunks get higher ids, so they are found on the
 * next call. The mark lives in memory: after a restart the walk starts again
 * at id 0, a window at a time, which also picks up an excerpt edited in place.
 */
let scannedThroughId = 0;

/** Tests only: start the walk again at id 0. */
export function resetEvidenceFillCursorForTests(): void {
  scannedThroughId = 0;
}

export async function fillEvidenceVectorsOnce(
  options: { batch?: number; window?: number } = {},
): Promise<number> {
  const batch = Math.max(1, Math.min(200, Math.floor(options.batch ?? 32)));
  const window = Math.max(batch, Math.min(100_000, Math.floor(options.window ?? 20_000)));
  const sql = await getSql();
  const [top] = await sql<{ max_id: number | null }>`
    select max(id)::int as max_id from artifact_chunks
  `;
  const maxId = Number(top?.max_id ?? 0);
  // The table was emptied or replaced (a restore): start the walk again.
  if (scannedThroughId > maxId) scannedThroughId = 0;
  if (scannedThroughId >= maxId) return 0;
  const from = scannedThroughId;
  const to = Math.min(maxId, from + window);
  const rows = await sql<{ id: number; md5: string; excerpt: string }>`
    select c.id, md5(c.excerpt) as md5, c.excerpt
    from artifact_chunks c
    where c.id > ${from} and c.id <= ${to}
      and c.excerpt <> ''
      and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)
      and not exists (
        select 1 from evidence_vectors ev where ev.excerpt_md5 = md5(c.excerpt)
      )
    order by c.id
    limit ${batch}
  `;
  // A full batch may stop before the end of the window: carry on from the last
  // row taken. A short batch means the window had nothing more to give.
  scannedThroughId = rows.length === batch ? Number(rows[rows.length - 1]!.id) : to;
  const seen = new Set<string>();
  const pending = rows.filter((row) => {
    if (seen.has(row.md5)) return false;
    seen.add(row.md5);
    return true;
  });
  if (pending.length === 0) return 0;

  const vectors = await embedTexts(pending.map((row) => row.excerpt));
  let inserted = 0;
  for (let i = 0; i < pending.length; i += 1) {
    const vector = vectors[i];
    if (!vector || vector.length !== EVIDENCE_DIMS) continue;
    const bytes = vectorToBytes(vector);
    const done = await sql<{ excerpt_md5: string }>`
      insert into evidence_vectors (excerpt_md5, model, dims, vector)
      values (${pending[i]!.md5}, ${EVIDENCE_MODEL}, ${EVIDENCE_DIMS}, ${bytes})
      on conflict (excerpt_md5) do nothing
      returning excerpt_md5
    `;
    inserted += done.length;
  }
  if (inserted > 0) clearEvidenceVectorCache();
  return inserted;
}

/** Delete vectors no live excerpt can match (takedown, legal removal, edits). */
export async function pruneEvidenceVectorsOnce(): Promise<number> {
  const sql = await getSql();
  const removed = await sql<{ excerpt_md5: string }>`
    delete from evidence_vectors ev
    where not exists (
      select 1 from artifact_chunks c
      where c.excerpt <> ''
        and (length(c.excerpt) - length(regexp_replace(c.excerpt, '[\\x01-\\x08\\x0b\\x0e-\\x1f' || chr(65533) || ']', '', 'g'))) < 0.02 * length(c.excerpt)
        and md5(c.excerpt) = ev.excerpt_md5
    )
    returning excerpt_md5
  `;
  if (removed.length > 0) clearEvidenceVectorCache();
  return removed.length;
}
