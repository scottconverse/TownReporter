import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real concurrency proof",
    };
const skip = probe.ok ? false : probe.reason,
  dbName = `townreporter_daily_${process.pid}_${Date.now()}`;
let db: typeof import("../db.ts"),
  daily: typeof import("./daily-scan.server.ts"),
  created = false;
if (probe.ok) {
  before(async () => {
    const a = new Client({ connectionString: adminUrl });
    await a.connect();
    try {
      await a.query(`create database ${dbName}`);
      created = true;
    } finally {
      await a.end();
    }
    process.env.DATABASE_URL = withDatabase(adminUrl, dbName);
    db = await import("../db.ts");
    daily = await import("./daily-scan.server.ts");
    const s = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await s.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await s.query(
      "insert into paper_settings(newsroom_id,timezone) values(1,'America/Denver') on conflict(newsroom_id) do update set timezone=excluded.timezone; delete from newsroom_members where newsroom_id=1; insert into newsroom_members(user_id,role,newsroom_id) values('owner-91','owner',1); insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values('owner-91',1,'https://example.test','Town','official','A','accepted'); insert into daily_scan_policies(newsroom_id,enabled,paused,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id) select 1,true,false,'06:00','codex-terra',12,jsonb_build_array(id),1,'owner-91' from sources where newsroom_id=1 and url='https://example.test'",
    );
    const [fixture] = await s.query<{ settings: number; owners: number; policies: number }>(
      "select (select count(*)::int from paper_settings where newsroom_id=1) settings,(select count(*)::int from newsroom_members where newsroom_id=1 and user_id='owner-91' and role='owner') owners,(select count(*)::int from daily_scan_policies where newsroom_id=1 and configured_by_user_id='owner-91') policies",
    );
    assert.deepEqual(fixture, { settings: 1, owners: 1, policies: 1 });
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const a = new Client({ connectionString: adminUrl });
    await a.connect();
    try {
      await a.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [
        dbName,
      ]);
      await a.query(`drop database ${dbName}`);
    } finally {
      await a.end();
    }
  });
}
it(
  "two real PostgreSQL ticks atomically create one same-day scan job",
  { skip, timeout: 15000 },
  async () => {
    const fake = async () => ({
      runtime: "codex-terra" as const,
      modelChoice: "codex-balanced",
      model: "registry-model",
      transport: "codex",
    });
    await Promise.all([
      daily.tickDailyScans(new Date("2026-09-04T13:00:00Z"), {
        runtimeSnapshot: fake,
        kick: false,
      }),
      daily.tickDailyScans(new Date("2026-09-04T13:00:00Z"), {
        runtimeSnapshot: fake,
        kick: false,
      }),
    ]);
    const s = await db.getSql();
    assert.equal(
      (await s.query<{ n: number }>("select count(*)::int n from daily_scan_reservations"))[0].n,
      1,
    );
    assert.equal((await s.query<{ n: number }>("select count(*)::int n from scan_runs"))[0].n, 1);
    assert.equal((await s.query<{ n: number }>("select count(*)::int n from desk_jobs"))[0].n, 1);
  },
);
