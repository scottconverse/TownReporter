import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";
import type { IngestDocument } from "./ingest.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this concurrency proof" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_routine_checks_${process.pid}_${Date.now()}`;
let db: typeof import("../db.ts");
let checks: typeof import("./routine-notice-checks.server.ts");
let created = false;

const html = `<html><script type="application/ld+json">${JSON.stringify({
  "@type": "Event",
  "@id": "pg-event",
  name: "PG library event",
  startDate: "2026-09-12T10:00:00-06:00",
  organizer: { name: "Town Library" },
  location: { name: "Main Library" },
})}</script></html>`;
const document: IngestDocument = {
  ok: false,
  status: 200,
  outcome: "parse-failed",
  text: "",
  title: "PG event",
  extras: [],
  contentType: "text/html",
  needsOcr: false,
  redirectChain: [],
  extractionMethod: "readability",
  pages: [],
  notices: [],
  rawBytes: new TextEncoder().encode(html),
};

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
    checks = await import("./routine-notice-checks.server.ts");
    const sql = await db.getSql();
    for (const name of readdirSync(resolve(process.cwd(), "migrations"))
      .filter((value) => /^\d+.*\.sql$/.test(value))
      .sort()) {
      await sql.query(readFileSync(resolve(process.cwd(), "migrations", name), "utf8"));
    }
    await sql.query("delete from newsroom_members where newsroom_id=1");
    await sql.query(
      "insert into newsroom_members(user_id,newsroom_id,role) values('routine-check-pg-owner',1,'owner')",
    );
    const [source] = await sql.query<{ id: number }>(
      "insert into sources(user_id,newsroom_id,url,title,status) values('routine-check-pg-owner',1,'https://example.test/routine-check-pg','PG source','accepted') returning id",
    );
    await sql.query(
      "insert into routine_notice_policies(newsroom_id,paused,revision,updated_by) values(1,false,1,'routine-check-pg-owner')",
    );
    await sql.query(
      "insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) values(1,$1,'https://example.test/routine-check-pg','library-notice')",
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

test(
  "real PostgreSQL serializes concurrent retries to one bound capture and receipt",
  { skip, timeout: 20_000 },
  async () => {
    const sql = await db.getSql();
    const [source] = await sql.query<{ id: number }>(
      "select id from sources where newsroom_id=1 and url='https://example.test/routine-check-pg'",
    );
    const requestId = randomUUID();
    const input = {
      requestId,
      sourceId: source!.id,
      sourceUrl: "https://example.test/routine-check-pg",
      formatKey: "library-notice" as const,
      expectedPolicyRevision: 1,
    };
    const actor = { userId: "routine-check-pg-owner", newsroomId: 1 };
    const [left, right] = await Promise.all([
      checks.checkRoutineNoticeSourceForOwner(actor, input, { ingest: async () => document }),
      checks.checkRoutineNoticeSourceForOwner(actor, input, { ingest: async () => document }),
    ]);
    assert.equal(left.check.checkId, right.check.checkId);
    const [counts] = await sql.query<{ checks: number; captures: number; refs: number; audits: number }>(
      `select (select count(*)::int from routine_notice_checks where newsroom_id=1) checks,
              (select count(*)::int from capture_events where newsroom_id=1 and trigger_kind='routine-notice-check') captures,
              (select count(*)::int from routine_notice_candidate_refs) refs,
              (select count(*)::int from audit_events where newsroom_id=1 and action='routine-notice-check') audits`,
    );
    assert.deepEqual(counts, { checks: 1, captures: 1, refs: 1, audits: 1 });
  },
);

test(
  "an owner removal in progress prevents the final capture transaction",
  { skip, timeout: 20_000 },
  async () => {
    const sql = await db.getSql();
    const [source] = await sql.query<{ id: number }>("select id from sources where newsroom_id=1");
    const remover = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await remover.connect();
    await remover.query("begin");
    await remover.query("delete from newsroom_members where user_id='routine-check-pg-owner'");
    const pending = checks.checkRoutineNoticeSourceForOwner(
      { userId: "routine-check-pg-owner", newsroomId: 1 },
      {
        requestId: randomUUID(),
        sourceId: source!.id,
        sourceUrl: "https://example.test/routine-check-pg",
        formatKey: "library-notice",
        expectedPolicyRevision: 1,
      },
      { ingest: async () => document },
    );
    const refused = assert.rejects(pending, /only.*owner/i);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await remover.query("commit");
    await remover.end();
    await refused;
    const [counts] = await sql.query<{ checks: number; captures: number }>(
      `select (select count(*)::int from routine_notice_checks where newsroom_id=1) checks,
              (select count(*)::int from capture_events where newsroom_id=1 and trigger_kind='routine-notice-check') captures`,
    );
    assert.deepEqual(counts, { checks: 1, captures: 1 });
  },
);
