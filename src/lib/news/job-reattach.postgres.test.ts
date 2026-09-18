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

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the restart-durability proof" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_job_reattach_${process.pid}_${Date.now()}`;
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
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

it("a queued job survives a restart and is claimed by the new server", { skip, timeout: 20_000 }, async () => {
  const sql = await db.getSql();
  await jobs.ensureJobsSchema();
  const [row] = await sql.query<{ id: number }>(
    `insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status,stage,lane,model_choice,model_choice_source,created_at,updated_at)
     values(1,'restart-queued','pull',88001,'queued','Waiting for a worker','default','auto','auto',now(),now()) returning id`,
  );
  const started: number[] = [];
  jobs.__setJobWorkForTest(async (job) => {
    started.push(job.id);
    await sql.query("update desk_jobs set result_json=$1 where id=$2", [JSON.stringify({ resumed: true }), job.id]);
  });
  try {
    const result = await jobs.reattachDurableJobsOnStartup();
    assert.equal(result.ran >= 1, true);
    assert.deepEqual(started.includes(row!.id), true);
    const [stored] = await sql.query<{ status: string; result_json: string }>(
      "select status,result_json from desk_jobs where id=$1", [row!.id],
    );
    assert.equal(stored!.status, "completed");
    assert.deepEqual(JSON.parse(stored!.result_json), { resumed: true });
  } finally {
    jobs.__setJobWorkForTest();
  }
});

it("running extraction resumes from its checkpoint without rereading completed pages", { skip, timeout: 20_000 }, async () => {
  const sql = await db.getSql();
  await jobs.ensureJobsSchema();
  const checkpoint = { pages: [1, 2, 3, 4], nextPage: 5, batch: "4/37" };
  const [row] = await sql.query<{ id: number }>(
    `insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status,stage,lane,model_choice,model_choice_source,created_at,updated_at,started_at,claim_token,result_json)
     values(1,'restart-extract','artifact-ocr',88002,'running','Extracting a long document batch 4 of 37','default','auto','auto',now(),now(),now(),'dead-claim',$1) returning id`,
    [JSON.stringify(checkpoint)],
  );
  const observed: string[] = [];
  jobs.__setJobWorkForTest(async (job) => {
    const [stored] = await sql.query<{ result_json: string }>("select result_json from desk_jobs where id=$1", [job.id]);
    const state = JSON.parse(stored!.result_json);
    observed.push(state.nextPage);
    await sql.query("update desk_jobs set result_json=$1 where id=$2", [JSON.stringify({ ...state, nextPage: 6, pages: [...state.pages, 5] }), job.id]);
  });
  try {
    await sql.query("update desk_jobs set updated_at=now() - interval '5 minutes' where id=$1", [row!.id]);
    const result = await jobs.reattachDurableJobsOnStartup();
    assert.equal(result.ran >= 1, true);
    assert.deepEqual(observed, [5]);
    const [stored] = await sql.query<{ status: string; result_json: string; claim_token: string | null }>(
      "select status,result_json,claim_token from desk_jobs where id=$1", [row!.id],
    );
    assert.equal(stored!.status, "completed");
    assert.deepEqual(JSON.parse(stored!.result_json), { pages: [1,2,3,4,5], nextPage: 6, batch: "4/37" });
    assert.notEqual(stored!.claim_token, "dead-claim");
  } finally {
    jobs.__setJobWorkForTest();
  }
});

it("a stale running row from a dead process is adopted honestly, never stranded or PID-killed", { skip, timeout: 20_000 }, async () => {
  const sql = await db.getSql();
  await jobs.ensureJobsSchema();
  const [row] = await sql.query<{ id: number }>(
    `insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status,stage,lane,model_choice,model_choice_source,created_at,updated_at,started_at,claim_token,result_json)
     values(1,'restart-stale','extract',88003,'running','Interrupted extraction','default','auto','auto',now(),now() - interval '5 minutes',now() - interval '5 minutes','dead-process',$1) returning id`,
    [JSON.stringify({ nextPage: 3 })],
  );
  const observed: number[] = [];
  jobs.__setJobWorkForTest(async (job) => { observed.push(job.id); });
  try {
    const result = await jobs.reattachDurableJobsOnStartup();
    assert.equal(result.ran >= 1, true);
    assert.deepEqual(observed, [row!.id]);
    const [stored] = await sql.query<{ status: string; claim_token: string | null; error: string | null }>(
      "select status,claim_token,error from desk_jobs where id=$1", [row!.id],
    );
    assert.equal(stored!.status, "completed");
    assert.notEqual(stored!.claim_token, "dead-process");
  } finally {
    jobs.__setJobWorkForTest();
  }
});
