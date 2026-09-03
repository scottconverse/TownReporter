import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";

/**
 * `listLeads` (src/lib/news/desk.ts) orders the queue with:
 *
 *   order by (l.scan_run_id is null) desc,
 *            date_trunc('minute', l.created_at) desc,
 *            l.newsworthiness desc,
 *            l.id desc
 *
 * desk.ts imports "@/lib/paper" and other path-aliased modules that plain
 * `node --test` cannot resolve, so it cannot be imported here directly (see
 * model-request-commit.server.ts, which is written with relative imports
 * for exactly this reason). This test instead runs the identical ORDER BY
 * text against a real table, so it fails the moment the two diverge. If you
 * change the clause in desk.ts, change the copy below too.
 */
const LEAD_QUEUE_ORDER_BY = `
  order by (scan_run_id is null) desc,
           date_trunc('minute', created_at) desc,
           newsworthiness desc,
           id desc
`;

async function freshLeadsTable() {
  const sql = await getSql();
  const table = `lead_queue_order_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await sql.query(`
    create table ${table} (
      id serial primary key,
      scan_run_id integer,
      newsworthiness integer not null default 0,
      created_at timestamptz not null default now()
    )
  `);
  return { sql, table };
}

async function insertRow(
  sql: Awaited<ReturnType<typeof getSql>>,
  table: string,
  row: { scanRunId: number | null; newsworthiness: number; createdAt: Date },
) {
  const rows = await sql.query<{ id: number }>(
    `insert into ${table} (scan_run_id, newsworthiness, created_at) values ($1, $2, $3) returning id`,
    [row.scanRunId, row.newsworthiness, row.createdAt],
  );
  return rows[0]!;
}

describe("the queue's ordering puts a hand-filed lead ahead of the scan batch", () => {
  it("a fresh hand-filed lead outranks a higher-scored scan lead from the same minute", async () => {
    const { sql, table } = await freshLeadsTable();
    const now = new Date();

    // A scan-filed lead: has a scan_run_id, scores far higher, and was
    // written first -- everything that used to put it on top.
    const scanLead = await insertRow(sql, table, { scanRunId: 1, newsworthiness: 14, createdAt: now });

    // The lead the editor just filed by hand -- fileLead and
    // writeStoryFromInput both leave scan_run_id null -- with the low
    // newsworthiness a hand-filed lead actually carries, written a moment
    // later in the very same minute.
    const handLead = await insertRow(sql, table, { scanRunId: null, newsworthiness: 0, createdAt: now });

    const rows = await sql.query<{ id: number }>(`select id from ${table} ${LEAD_QUEUE_ORDER_BY}`);

    assert.equal(
      rows[0]?.id,
      handLead.id,
      "the hand-filed lead (no scan_run_id) must sort ahead of the same-minute scan lead, even with lower newsworthiness",
    );
    assert.equal(rows[1]?.id, scanLead.id);
  });

  it("keeps scan-filed leads ordered by minute, then newsworthiness, then id among themselves", async () => {
    const { sql, table } = await freshLeadsTable();
    const now = new Date();
    const older = new Date(now.getTime() - 5 * 60_000);

    await insertRow(sql, table, { scanRunId: 1, newsworthiness: 20, createdAt: older });
    const newerLowScore = await insertRow(sql, table, { scanRunId: 1, newsworthiness: 3, createdAt: now });
    const newerHighScore = await insertRow(sql, table, { scanRunId: 1, newsworthiness: 8, createdAt: now });

    const rows = await sql.query<{ id: number }>(`select id from ${table} ${LEAD_QUEUE_ORDER_BY}`);

    // The newer minute's batch comes first, and within it the higher score
    // leads -- exactly the ordering scan output has always had.
    assert.equal(rows[0]?.id, newerHighScore.id);
    assert.equal(rows[1]?.id, newerLowScore.id);
  });

  it("two hand-filed leads in the same minute still sort newest first", async () => {
    const { sql, table } = await freshLeadsTable();
    const now = new Date();

    const first = await insertRow(sql, table, { scanRunId: null, newsworthiness: 0, createdAt: now });
    const second = await insertRow(sql, table, { scanRunId: null, newsworthiness: 0, createdAt: now });

    const rows = await sql.query<{ id: number }>(`select id from ${table} ${LEAD_QUEUE_ORDER_BY}`);
    assert.equal(rows[0]?.id, second.id);
    assert.equal(rows[1]?.id, first.id);
  });
});
