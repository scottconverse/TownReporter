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

export async function fillEvidenceVectorsOnce(
  options: { batch?: number } = {},
): Promise<number> {
  const batch = Math.max(1, Math.min(200, Math.floor(options.batch ?? 32)));
  const sql = await getSql();
  const pending = await sql<{ md5: string; excerpt: string }>`
    select * from (
      select distinct on (md5(c.excerpt)) md5(c.excerpt) as md5, c.excerpt
      from artifact_chunks c
      where c.excerpt <> ''
        and not exists (
          select 1 from evidence_vectors ev where ev.excerpt_md5 = md5(c.excerpt)
        )
      order by md5(c.excerpt), c.id desc
    ) t
    limit ${batch}
  `;
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
      where c.excerpt <> '' and md5(c.excerpt) = ev.excerpt_md5
    )
    returning excerpt_md5
  `;
  if (removed.length > 0) clearEvidenceVectorCache();
  return removed.length;
}
