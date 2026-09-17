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
const dbName = `townreporter_routine_${process.pid}_${Date.now()}`;
let db: typeof import("../db.ts");
let policy: typeof import("./routine-notice-policy.ts");
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
    policy = await import("./routine-notice-policy.ts");
    const sql = await db.getSql();
    for (const name of readdirSync(resolve(process.cwd(), "migrations"))
      .filter((value) => /^\d+.*\.sql$/.test(value))
      .sort()) {
      await sql.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    }
    await sql.query("delete from newsroom_members where newsroom_id=1");
    await sql.query(
      "insert into newsroom_members(user_id,newsroom_id,role) values('routine-pg-owner',1,'owner')",
    );
    await sql.query(
      "insert into sources(user_id,newsroom_id,url,title,status) values('routine-pg-owner',1,'https://example.test/routine-pg','PG source','accepted')",
    );
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [
        dbName,
      ]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

test(
  "real PostgreSQL serializes same-revision creation to one commit and one explicit conflict",
  { skip, timeout: 20_000 },
  async () => {
    const sql = await db.getSql();
    await sql.query(
      "create function pause_routine_policy_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(952052); return NEW; end $$",
    );
    await sql.query(
      "create trigger pause_routine_policy_insert before insert on routine_notice_policies for each row execute function pause_routine_policy_insert()",
    );
    const blocker = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await blocker.connect();
    await blocker.query("select pg_advisory_lock(952052)");
    const [beforeContent] = await sql.query<{ jobs: number; articles: number }>(
      "select (select count(*)::int from desk_jobs) jobs,(select count(*)::int from articles where status='published') articles",
    );
    const base = {
      expectedRevision: 0,
      approvals: [],
    };
    const pending = Promise.allSettled([
      policy.saveRoutineNoticePolicyFor("routine-pg-owner", 1, { ...base, paused: false }),
      policy.saveRoutineNoticePolicyFor("routine-pg-owner", 1, { ...base, paused: true }),
    ]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    await blocker.query("select pg_advisory_unlock(952052)");
    await blocker.end();
    const results = await pending;
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.match(String(rejected?.reason?.message), /changed.*reload/i);
    const [counts] = await sql.query<{
      policies: number;
      approvals: number;
      audits: number;
      jobs: number;
      articles: number;
    }>(
      "select (select count(*)::int from routine_notice_policies) policies,(select count(*)::int from routine_notice_approvals) approvals,(select count(*)::int from audit_events where action='routine-notice-policy') audits,(select count(*)::int from desk_jobs) jobs,(select count(*)::int from articles where status='published') articles",
    );
    assert.deepEqual(counts, {
      policies: 1,
      approvals: 0,
      audits: 1,
      jobs: beforeContent!.jobs,
      articles: beforeContent!.articles,
    });
    await sql.query("drop trigger pause_routine_policy_insert on routine_notice_policies");
    await sql.query("drop function pause_routine_policy_insert()");
  },
);

test(
  "an owner removal already in progress prevents the pending policy mutation",
  { skip, timeout: 20_000 },
  async () => {
    const sql = await db.getSql();
    await sql.query("delete from routine_notice_policy_changes where newsroom_id=1");
    await sql.query("delete from routine_notice_approvals where newsroom_id=1");
    await sql.query("delete from routine_notice_policies where newsroom_id=1");
    await sql.query("delete from audit_events where action='routine-notice-policy'");
    const remover = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await remover.connect();
    await remover.query("begin");
    await remover.query(
      "delete from newsroom_members where user_id='routine-pg-owner' and newsroom_id=1",
    );
    const pending = policy.saveRoutineNoticePolicyFor("routine-pg-owner", 1, {
      expectedRevision: 0,
      paused: true,
      approvals: [],
    });
    const refused = assert.rejects(pending, /only.*owner/i);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await remover.query("commit");
    await remover.end();
    await refused;
    const [counts] = await sql.query<{ policies: number; audits: number }>(
      "select (select count(*)::int from routine_notice_policies) policies,(select count(*)::int from audit_events where action='routine-notice-policy') audits",
    );
    assert.deepEqual(counts, { policies: 0, audits: 0 });
  },
);
