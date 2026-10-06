/**
 * Reading the accepted source pool and building the inventory deliverable.
 *
 * READ-ONLY. Nothing in this file writes a source row, and nothing here is on
 * the scan's hot path: the inventory is what an editor opens to see the whole
 * pool once, and what the rotation calls to learn each source's facts. Both are
 * reads of columns the schema already keeps (0002, 0115, 0116) plus the section
 * links in `section_sources`, so no new data is gathered to produce it.
 *
 * WHY A SEPARATE READER AND NOT `querySourceRows`. `desk.ts` owns the watch-list
 * order and the review queue; this needs the same rows in id order with the
 * beat links joined in, and it must be callable offline (plain `node --test`,
 * disposable PGlite) where `desk.ts`'s `@/lib/*` aliases do not resolve.
 */
import { getSql } from "../db.ts";
import {
  inventoryRows,
  toCsv,
  type InventoryRow,
  type SourceHealthFacts,
} from "./source-inventory.ts";

/** Every accepted (or paused) source for a newsroom, with its section keys. */
export async function acceptedSourceFacts(
  newsroomId: number,
): Promise<SourceHealthFacts[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: number;
    url: string;
    title: string;
    kind: string | null;
    tier: string | null;
    status: string;
    last_error: string | null;
    last_fetched_at: string | null;
    last_ok_at: string | null;
    consecutive_failures: number | null;
    failure_streak_started_at: string | null;
    retry_after: string | null;
    blocked_at: string | null;
    blocked_attempts: number | null;
    created_at: string | null;
    new_since_last_pass: number | null;
    last_hash: string | null;
    beats: string[] | null;
  }>(
    `select s.id, s.url, s.title, s.kind, s.tier, s.status, s.last_error,
            s.last_fetched_at::text as last_fetched_at,
            s.last_ok_at::text as last_ok_at,
            s.last_hash,
            s.consecutive_failures,
            s.failure_streak_started_at::text as failure_streak_started_at,
            s.retry_after::text as retry_after,
            s.blocked_at::text as blocked_at,
            s.blocked_attempts,
            s.created_at::text as created_at,
            (select count(*) from snapshots sn
               where sn.source_id = s.id
                 and sn.created_at >= coalesce(
                   (select max(started_at) from scan_runs where newsroom_id = $1),
                   '-infinity'::timestamptz))::int as new_since_last_pass,
            (select array_agg(ss.section_key order by ss.section_key)
               from section_sources ss
              where ss.newsroom_id = $1 and ss.source_id = s.id) as beats
       from sources s
      where s.newsroom_id = $1 and s.status in ('accepted','paused')
      order by s.id`,
    [newsroomId],
  );
  return rows.map((row) => ({ ...row, beats: row.beats ?? [] }));
}

/** The inventory deliverable, built from the accepted pool. */
export async function buildInventory(
  newsroomId: number,
  options: { nowMs?: number } = {},
): Promise<{ rows: InventoryRow[]; csv: string }> {
  const facts = await acceptedSourceFacts(newsroomId);
  const rows = inventoryRows(facts, { nowMs: options.nowMs });
  return { rows, csv: toCsv(rows) };
}
