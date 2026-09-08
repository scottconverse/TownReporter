import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
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
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this concurrency proof" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_routine_automation_${process.pid}_${Date.now()}`;
let db: typeof import("../db.ts");
let worker: typeof import("./routine-notice-worker.server.ts");
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
    worker = await import("./routine-notice-worker.server.ts");
    const sql = await db.getSql();
    for (const name of readdirSync(resolve(process.cwd(), "migrations"))
      .filter((value) => /^\d+.*\.sql$/.test(value))
      .sort())
      await sql.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    await sql.query("delete from newsroom_members where newsroom_id=1");
    await sql.query(
      "insert into newsroom_members(user_id,newsroom_id,role) values('routine-auto-owner',1,'owner')",
    );
    const [source] = await sql.query<{ id: number }>(
      "insert into sources(user_id,newsroom_id,url,title,status) values('routine-auto-owner',1,'https://example.test/calendar','Calendar','accepted') returning id",
    );
    await sql.query(
      "insert into routine_notice_policies(newsroom_id,paused,revision,updated_by) values(1,false,1,'routine-auto-owner')",
    );
    await sql.query(
      "insert into routine_notice_approvals(newsroom_id,source_id,format_key,source_url) values(1,$1,'community-arts-event-logistics','https://example.test/calendar')",
      [source!.id],
    );
    await sql.query(
      "insert into routine_notice_automations(newsroom_id,enabled,revision,timezone,local_time,today_section,weekend_section,deadlines_section,activated_by) values(1,true,1,'America/Denver','06:15','news','events','deadlines','routine-auto-owner')",
    );
    await sql.query(
      "insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality) values(1,$1,'community-arts-event-logistics','https://example.test/calendar','https://example.test/calendar','City','Town')",
      [source!.id],
    );
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

test("two PostgreSQL schedulers serialize to one routine run and one job", { skip, timeout: 20_000 }, async () => {
  const sql = await db.getSql();
  await sql.query(
    "create function pause_routine_run() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(954001); return NEW; end $$",
  );
  await sql.query(
    "create trigger pause_routine_run before insert on routine_notice_runs for each row execute function pause_routine_run()",
  );
  const blocker = new Client({ connectionString: withDatabase(adminUrl, dbName) });
  await blocker.connect();
  await blocker.query("select pg_advisory_lock(954001)");
  const pending = Promise.all([
    worker.tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z")),
    worker.tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z")),
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  await blocker.query("select pg_advisory_unlock(954001)");
  await blocker.end();
  const results = await pending;
  assert.equal(results.reduce((sum, result) => sum + result.queued, 0), 1);
  const [counts] = await sql.query<{ runs: number; jobs: number }>(
    "select (select count(*)::int from routine_notice_runs) runs,(select count(*)::int from desk_jobs where kind='routine-notice') jobs",
  );
  assert.deepEqual(counts, { runs: 1, jobs: 1 });
});
