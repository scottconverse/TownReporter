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
 * Stopping a job with Stop, against a real PostgreSQL.
 *
 * THE CLAIM THIS FILE EXISTS FOR (release H, DHI-5): when the editor presses
 * Stop on a story draft, the `desk_jobs` row ends `cancelled`. Before the fix it
 * ended `failed` with stage "Cancelled", so the row read like a model failure.
 * A dark round stopped by the same server function keeps `failed`, because the
 * dark Retry gate reads that word.
 *
 * WHY A REAL POSTGRES. The status is written by one SQL statement and read back
 * by the page and the job card; the row is the evidence.
 *
 * THE MUTATION THAT MATTERS. Changing `requestJobCancel` back to a plain
 * `status = 'failed'` fails the first test.
 */

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the draft Stop proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `townreporter_test_draft_stop_${process.pid}_${Date.now()}`;
const NEWSROOM = 974_611;
const EDITOR = "draft-stop-editor";
let created = false;
let db: typeof import("../db.ts");
let jobs: typeof import("./jobs.ts");

describe("pressing Stop on a job (release H DHI-5)", { skip, timeout: 120000 }, () => {
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
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await jobs.ensureJobsSchema();
    await sql`
      insert into newsrooms (id, name) values (${NEWSROOM}, ${"Draft stop test"})
      on conflict (id) do nothing
    `;
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

  it("ends a stopped story draft as cancelled, with the reason the page reads", async () => {
    const job = await jobs.enqueueJob({
      userId: EDITOR,
      newsroomId: NEWSROOM,
      kind: "draft",
      subjectId: 4_201,
      modelChoice: "deepseek",
      kick: false,
    });
    await jobs.requestJobCancel(job.id);
    const sql = await db.getSql();
    const [row] = await sql<{ status: string; stage: string; error: string | null; cancel_requested: boolean }>`
      select status, stage, error, cancel_requested from desk_jobs where id = ${job.id}
    `;
    assert.equal(row?.status, "cancelled");
    assert.equal(row?.stage, "Cancelled");
    assert.equal(row?.error, jobs.JOB_CANCELLED_REASON);
    assert.equal(row?.cancel_requested, true);
  });

  it("keeps a stopped dark round as failed, so its Retry still runs", async () => {
    const job = await jobs.enqueueJob({
      userId: EDITOR,
      newsroomId: NEWSROOM,
      kind: "dark",
      subjectId: 4_202,
      modelChoice: "deepseek",
      kick: false,
    });
    await jobs.requestJobCancel(job.id);
    const sql = await db.getSql();
    const [row] = await sql<{ status: string }>`select status from desk_jobs where id = ${job.id}`;
    assert.equal(row?.status, "failed");
  });
});
