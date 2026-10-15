// FB19: the Daily scan panel reads the DAILY run's own numbers. A manual scan
// that started later must not stand in for the daily run, and a daily run
// that has not started must not borrow another scan's numbers.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { readDailyScanPolicy } from "./daily-scan.ts";

// This file needs the migrated schema; it asks for it itself, the same way
// daily-scan.execution.test.ts does.
await applyMigrationsToTestPglite();

const NEWSROOM = 611;

async function reset() {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,'Test room 611') on conflict (id) do nothing", [NEWSROOM]);
  await sql.query("delete from scan_runs where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from daily_scan_reservations where newsroom_id=$1", [NEWSROOM]);
}

/** One daily reservation and its scan run, then a manual run that started later. */
async function seedDailyRunThenManualRun(opts: { dailyFinished: boolean }) {
  const sql = await getSql();
  const [reservation] = await sql.query<{ id: number }>(
    "insert into daily_scan_reservations(newsroom_id,local_day,status,policy_revision,policy_snapshot,source_snapshot,model_snapshot) values($1,'2026-10-14','completed',1,'{}','{}','{}') returning id",
    [NEWSROOM],
  );
  const [daily] = await sql.query<{ id: number }>(
    `insert into scan_runs(user_id,newsroom_id,started_at,finished_at,sources_fetched,leads_created,execution_origin,daily_reservation_id)
     values('owner-611',$1,'2026-10-14T12:00:00Z',$2,58,3,'scheduled',$3) returning id`,
    [NEWSROOM, opts.dailyFinished ? "2026-10-14T12:20:00Z" : null, reservation.id],
  );
  await sql.query("update daily_scan_reservations set scan_run_id=$1 where id=$2", [daily.id, reservation.id]);
  await sql.query(
    `insert into scan_runs(user_id,newsroom_id,started_at,finished_at,sources_fetched,leads_created,execution_origin)
     values('owner-611',$1,'2026-10-15T15:00:00Z','2026-10-15T15:05:00Z',12,0,'manual')`,
    [NEWSROOM],
  );
}

beforeEach(reset);

describe("daily scan panel reads the daily run, not the newest scan", () => {
  it("shows the daily run's numbers even when a manual scan started later", async () => {
    await seedDailyRunThenManualRun({ dailyFinished: true });
    const policy = await readDailyScanPolicy(NEWSROOM, new Date("2026-10-15T16:00:00Z"));
    assert.equal(policy.lastScan?.sources_fetched, 58, "the manual scan read 12; the daily run read 58");
    assert.equal(policy.lastScan?.leads_created, 3);
    assert.equal(policy.lastScan?.startedAt, "2026-10-14T12:00:00.000Z");
    assert.equal(policy.lastScan?.finishedAt, "2026-10-14T12:20:00.000Z");
  });

  it("reports a daily run still going with no finish time", async () => {
    await seedDailyRunThenManualRun({ dailyFinished: false });
    const policy = await readDailyScanPolicy(NEWSROOM, new Date("2026-10-15T16:00:00Z"));
    assert.equal(policy.lastScan?.sources_fetched, 58);
    assert.equal(policy.lastScan?.finishedAt, null);
  });

  it("is null when the daily scan has no run, even if a manual scan exists", async () => {
    const sql = await getSql();
    await sql.query(
      `insert into scan_runs(user_id,newsroom_id,started_at,finished_at,sources_fetched,leads_created,execution_origin)
       values('owner-611',$1,'2026-10-15T15:00:00Z','2026-10-15T15:05:00Z',12,0,'manual')`,
      [NEWSROOM],
    );
    const policy = await readDailyScanPolicy(NEWSROOM, new Date("2026-10-15T16:00:00Z"));
    assert.equal(policy.lastScan, null);
  });
});
