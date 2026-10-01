import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, it } from "node:test";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  H1 of the batch-7 pre-merge audit, on REAL PostgreSQL.

  `job-stage-write.test.ts` proves the defect and the fix on PGlite, which is
  the same engine and raised the same 2201B. This file exists for the part
  PGlite cannot speak to: the guard is evaluated by the server on the TEXT the
  driver received, and the audit's finding is about what that text is. A
  cooked `'^s*['` was an invalid regular expression on real Postgres too, and
  the statement must stay a plain string comparison no server version reads
  differently.

  It is also the only test that runs `setJobStage` against a row carrying a
  stage list on the real driver, so a future edit that reintroduces a backslash
  escape fails in the lane CI runs against Postgres as well as the unit lane.

  Skip is honest and local-only: without `TEST_POSTGRES_ADMIN_URL` this file
  reports why it did not run rather than passing vacuously.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL stage-write proof",
    };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_job_stage_write_${process.pid}_${Date.now()}`;
const NEWSROOM = 91096;
let db: typeof import("../db.ts");
let jobs: typeof import("./jobs.ts");
let created = false;

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = withDatabase(adminUrl, dbName);
    db = await import("../db.ts");
    jobs = await import("./jobs.ts");
    const sql = await db.getSql();
    for (const name of readdirSync(resolve(process.cwd(), "migrations"))
      .filter((value) => /^\d+.*\.sql$/.test(value))
      .sort()) {
      await sql.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    }
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [
        dbName,
      ]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

it("moves the chip row for an arrival when the job carries a stage list", { skip, timeout: 30_000 }, async () => {
  const sql = await db.getSql();
  const stages = ["Opening source material", "Writing the draft", "Checking names and spellings"];
  const [row] = await sql.query<{ id: number }>(
    `insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status,stage,lane,model_choice,model_choice_source,created_at,updated_at,stages_json,stage_index)
     values($1,'stage-write','draft',910961,'running','Queued','default','auto','auto',now(),now(),$2,0) returning id`,
    [NEWSROOM, JSON.stringify(stages)],
  );

  // The arrival, and the audit's failing input: with the cooked `'^s*['` guard
  // Postgres raises 2201B here and the row is never written.
  await jobs.setJobStage(row!.id, "Writing the draft");
  const [arrived] = await sql.query<{ stage: string; stage_index: number }>(
    "select stage,stage_index from desk_jobs where id=$1",
    [row!.id],
  );
  assert.equal(arrived!.stage, "Writing the draft");
  assert.equal(arrived!.stage_index, 1, "the arrival's position in the seeded list");

  // A step inside a stage is not an arrival, so the chip stays where it was.
  await jobs.setJobStage(row!.id, "Reading batch 2 of 7");
  const [stepped] = await sql.query<{ stage: string; stage_index: number }>(
    "select stage,stage_index from desk_jobs where id=$1",
    [row!.id],
  );
  assert.equal(stepped!.stage, "Reading batch 2 of 7");
  assert.equal(stepped!.stage_index, 1);

  // A malformed list costs a chip row, never the stage boundary that was
  // trying to report -- the property the guard exists for.
  await sql.query("update desk_jobs set stages_json=$1 where id=$2", ["not json", row!.id]);
  await jobs.setJobStage(row!.id, "Checking names and spellings");
  const [malformed] = await sql.query<{ stage: string; stage_index: number }>(
    "select stage,stage_index from desk_jobs where id=$1",
    [row!.id],
  );
  assert.equal(malformed!.stage, "Checking names and spellings");
  assert.equal(malformed!.stage_index, 1, "a non-array costs the chip, not the write");
});
