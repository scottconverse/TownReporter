import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/**
 * Stop a Dark Desk dig, against a real PostgreSQL.
 *
 * THE CLAIM THIS FILE EXISTS FOR: when the editor presses Stop on a running
 * dig, the round ends at its next boundary -- and the ROWS it leaves say so.
 * The run record reads "cancelled" with the queue's own reason, and the file is
 * paused with the same sentence. Before unit U25 there was no press to press
 * (the walkthrough scanned every button on `/desk/dark` for /stop|pause|halt|
 * cancel|abandon/ and found none) and `performDarkRound` never read
 * `desk_jobs.cancel_requested` at all, so the flag a Stop sets was written and
 * never seen.
 *
 * WHY A REAL POSTGRES. The whole finding is about rows one press writes and the
 * worker reads -- `desk_jobs.cancel_requested` set by `requestJobCancel`, read
 * fresh by `throwIfJobCancelled`, and the terminal summary written into
 * `dark_runs` and `investigations`. PGLite would prove the same statements, but
 * this is the path CI runs and the follow-up Stop proof already takes, so it is
 * the same shape of evidence (`follow-up-stop.postgres.test.ts`).
 *
 * THE MUTATION THAT MATTERS. Deleting `if (cancelled) { ... }` from the catch
 * in `performDarkRound` fails the first test: the round still stops, but its
 * rows read like an ordinary failure and the file does not say who stopped it.
 */

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the dark Stop proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `townreporter_test_dark_stop_${process.pid}_${Date.now()}`;
const NEWSROOM = 974_501;
const EDITOR = "dark-stop-editor";
let created = false;
let db: typeof import("../db.ts");
let jobs: typeof import("./jobs.ts");
let dark: typeof import("./dark.ts");

describe("stopping a Dark Desk dig (U25 B4)", { skip, timeout: 120000 }, () => {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
      created = true;
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = withDatabase(adminUrl, databaseName);
    db = await import("../db.ts");
    jobs = await import("./jobs.ts");
    dark = await import("./dark.ts");
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await jobs.ensureJobsSchema();
    await dark.ensureDarkSchema();
    await sql`
      insert into newsrooms (id, name) values (${NEWSROOM}, ${"Dark stop test"})
      on conflict (id) do nothing
    `.catch(() => undefined);
  });

  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`drop database ${databaseName}`);
    } finally {
      await admin.end();
    }
  });

  /** One open file with a `dark` job the editor has already asked to stop. */
  async function seedCancelledRound() {
    const sql = await db.getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title, summary, status)
      values (${EDITOR}, ${NEWSROOM}, ${"Kid City USA Longmont closure with one week's notice"}, ${""}, ${"open"})
      returning id
    `;
    const [job] = await sql<{ id: number }>`
      insert into desk_jobs (user_id, newsroom_id, kind, subject_id, status, cancel_requested)
      values (${EDITOR}, ${NEWSROOM}, ${"dark"}, ${inv!.id}, ${"running"}, ${true})
      returning id
    `;
    const full = await jobs.latestJob({ newsroomId: NEWSROOM, kind: "dark", subjectId: inv!.id });
    assert.ok(full, "the seeded dark job could not be read back");
    return { investigationId: inv!.id, jobId: job!.id, job: full };
  }

  it("records that the editor stopped it, and pauses the file with the same sentence", async () => {
    const seeded = await seedCancelledRound();
    const err = await dark.performDarkRound(seeded.job).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(err instanceof jobs.JobCancelledError, `the round did not stop: ${String(err)}`);

    const sql = await db.getSql();
    const [run] = await sql<{ stop_reason: string | null; error: string | null; summary: string | null }>`
      select stop_reason, error, summary from dark_runs
      where investigation_id = ${seeded.investigationId}
      order by id desc limit 1
    `;
    assert.equal(run?.stop_reason, "cancelled", "the run record does not say it was cancelled");
    assert.equal(run?.error, jobs.JOB_CANCELLED_REASON);
    assert.match(String(run?.summary ?? ""), /Stopped by the editor/);
    assert.ok(
      !/Stopped at the hop limit/.test(String(run?.summary ?? "")),
      "a stopped run must not read like one that finished its hops",
    );

    const [file] = await sql<{ status: string; pause_reason: string | null }>`
      select status, pause_reason from investigations where id = ${seeded.investigationId}
    `;
    assert.equal(file?.status, "paused");
    assert.equal(file?.pause_reason, jobs.JOB_CANCELLED_REASON);
  });

  it("does not stop a round nobody asked to stop", async () => {
    const sql = await db.getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title, summary, status)
      values (${EDITOR}, ${NEWSROOM}, ${"A dig nobody stopped"}, ${""}, ${"open"})
      returning id
    `;
    const [job] = await sql<{ id: number }>`
      insert into desk_jobs (user_id, newsroom_id, kind, subject_id, status, cancel_requested)
      values (${EDITOR}, ${NEWSROOM}, ${"dark"}, ${inv!.id}, ${"running"}, ${false})
      returning id
    `;
    // With no provider configured the round cannot plan anything, so this
    // proves the flag is what stops it: the same call, one boolean apart,
    // reaches the provider instead of the cancel path.
    const full = await jobs.latestJob({ newsroomId: NEWSROOM, kind: "dark", subjectId: inv!.id });
    assert.ok(full);
    const err = await dark.performDarkRound(full).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(
      !(err instanceof jobs.JobCancelledError),
      "a round with no cancel requested took the cancelled path",
    );
    const [run] = await sql<{ stop_reason: string | null }>`
      select stop_reason from dark_runs where investigation_id = ${inv!.id} order by id desc limit 1
    `;
    assert.notEqual(run?.stop_reason, "cancelled");
    void job;
  });
});
