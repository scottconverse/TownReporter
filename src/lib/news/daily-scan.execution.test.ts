import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import {
  commitDailyScanResults,
  finalizeDailyScanFailure,
  runForcedDailyChat,
  tickDailyScans,
} from "./daily-scan.server.ts";
import { readDailyScanPolicy } from "./daily-scan.ts";
import type { DeskJob } from "./jobs.ts";

const job: DeskJob = {
  id: 501,
  newsroom_id: 501,
  user_id: "owner-501",
  kind: "scan",
  subject_id: 601,
  model_choice: "codex-balanced",
  model_choice_source: "scheduled",
  lane: "default",
  status: "running",
  stage: "Working",
  failover_note: "",
  error: null,
  created_at: "",
  updated_at: "",
  started_at: null,
  finished_at: null,
  claim_token: "lease-current",
};

async function reset() {
  const sql = await getSql();
  for (const q of [
    "create table if not exists daily_commit_marker(value text)",
    "create table if not exists daily_scan_policies(newsroom_id integer primary key,enabled boolean,paused boolean,pause_reason text,local_time text,runtime text,source_cap integer,selected_source_ids jsonb,revision integer,configured_by_user_id text,updated_at timestamptz)",
    "create table if not exists newsroom_members(user_id text primary key,role text,newsroom_id integer)",
    "create table if not exists desk_jobs(id serial primary key,newsroom_id integer,user_id text,kind text,subject_id integer,model_choice text,model_choice_source text,lane text,status text,stage text,claim_token text,error text,created_at timestamptz default now(),finished_at timestamptz)",
    "create table if not exists daily_scan_reservations(id serial primary key,newsroom_id integer,local_day date,scan_run_id integer,desk_job_id integer,status text,policy_revision integer,policy_snapshot jsonb,source_snapshot jsonb,model_snapshot jsonb,error text,created_at timestamptz default now(),finished_at timestamptz)",
    "create unique index if not exists daily_scan_reservation_day_test on daily_scan_reservations(newsroom_id,local_day)",
    "create unique index if not exists daily_scan_reservation_open_test on daily_scan_reservations(newsroom_id) where status in ('queued','running')",
    "create table if not exists scan_runs(id serial primary key,user_id text,newsroom_id integer,source_snapshot jsonb,policy_snapshot jsonb,model_snapshot jsonb,execution_origin text,daily_reservation_id integer,finished_at timestamptz,error text)",
    "create table if not exists paper_settings(id serial primary key,newsroom_id integer unique,name text,city text,state text,location text,timezone text,tagline text,kicker text,deck text,trust text,council_votes_url text,youtube_channels jsonb,meeting_keywords jsonb,seed_sources jsonb,editor_email text)",
    "create table if not exists sources(id integer primary key,newsroom_id integer,url text,title text,kind text,tier integer,status text,last_hash text,last_fetched_at timestamptz,last_error text)",
  ])
    await sql.query(q);
  for (const t of [
    "daily_commit_marker",
    "daily_scan_reservations",
    "scan_runs",
    "desk_jobs",
    "newsroom_members",
    "daily_scan_policies",
    "sources",
    "paper_settings",
  ])
    await sql.query(`delete from ${t}`);
  await sql.query(
    "insert into daily_scan_policies values(501,true,false,null,'06:00','codex-terra',12,'[1]',1,'owner-501',now())",
  );
  await sql.query("insert into newsroom_members values('owner-501','owner',501)");
  await sql.query(
    "insert into desk_jobs(id,newsroom_id,user_id,kind,subject_id,status,claim_token,error,finished_at) values(501,501,'owner-501','scan',601,'running','lease-current',null,null)",
  );
  await sql.query(
    "insert into daily_scan_reservations(id,newsroom_id,local_day,scan_run_id,desk_job_id,status,policy_revision) values(701,501,'2026-09-04',601,501,'running',1)",
  );
  await sql.query(
    "insert into scan_runs(id,newsroom_id,daily_reservation_id,finished_at,error) values(601,501,701,null,null)",
  );
}
beforeEach(reset);

describe("scheduled final commit fence", () => {
  it("commits computed results only while policy, owner, and lease are current", async () => {
    await commitDailyScanResults(job, (sql) =>
      sql.query("insert into daily_commit_marker values('kept')"),
    );
    const sql = await getSql();
    assert.equal((await sql.query("select * from daily_commit_marker")).length, 1);
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "select status from daily_scan_reservations where id=701",
        )
      )[0].status,
      "completed",
    );
  });
  for (const scenario of ["paused", "owner-revoked", "lease-lost", "terminal"] as const) {
    it(`rolls back every result when ${scenario}`, async () => {
      const sql = await getSql();
      if (scenario === "paused")
        await sql.query("update daily_scan_policies set paused=true where newsroom_id=501");
      if (scenario === "owner-revoked")
        await sql.query("delete from newsroom_members where newsroom_id=501");
      if (scenario === "lease-lost")
        await sql.query("update desk_jobs set claim_token='replacement' where id=501");
      if (scenario === "terminal")
        await sql.query("update daily_scan_reservations set status='failed' where id=701");
      await assert.rejects(
        () =>
          commitDailyScanResults(job, (tx) =>
            tx.query("insert into daily_commit_marker values('must rollback')"),
          ),
        /withdrawn|lease was lost/,
      );
      assert.equal((await sql.query("select * from daily_commit_marker")).length, 0);
      assert.equal(
        (
          await sql.query<{ status: string }>(
            "select status from daily_scan_reservations where id=701",
          )
        )[0].status,
        scenario === "terminal" ? "failed" : "running",
      );
    });
  }
});

describe("scheduled tick and policy status", () => {
  it("shows a due catch-up, reserves it once, then shows the next local day", async () => {
    const sql = await getSql();
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from scan_runs");
    await sql.query(
      "insert into paper_settings(newsroom_id,timezone) values(501,'America/Denver')",
    );
    await sql.query(
      "insert into sources values(1,501,'https://example.test/source','Source','rss',1,'accepted',null,null,null)",
    );
    const now = new Date("2026-09-04T14:00:00Z");
    const before = await readDailyScanPolicy(501, now);
    assert.equal(before.nextRunAt, now.toISOString());
    let probes = 0;
    const runtimeSnapshot = async () => {
      probes += 1;
      return {
        runtime: "codex-terra" as const,
        modelChoice: "codex-balanced",
        model: "selected-terra",
        transport: "codex",
      };
    };
    assert.deepEqual(await tickDailyScans(now, { runtimeSnapshot, kick: false }), {
      reserved: 1,
    });
    assert.deepEqual(await tickDailyScans(now, { runtimeSnapshot, kick: false }), {
      reserved: 0,
    });
    assert.equal(probes, 1);
    const after = await readDailyScanPolicy(501, now);
    assert.equal(after.nextRunAt, "2026-09-05T12:00:00.000Z");
    assert.equal(after.openRun?.status, "queued");
  });
});

describe("scheduled failure fence", () => {
  it("a lease-lost worker cannot mark failure or pause quota", async () => {
    const sql = await getSql();
    await sql.query("update desk_jobs set claim_token='replacement' where id=501");
    await finalizeDailyScanFailure(job, "429 quota");
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "select status from daily_scan_reservations where id=701",
        )
      )[0].status,
      "running",
    );
    assert.equal(
      (
        await sql.query<{ paused: boolean }>(
          "select paused from daily_scan_policies where newsroom_id=501",
        )
      )[0].paused,
      false,
    );
  });
  it("a current worker records failure but cannot pause a newer policy revision", async () => {
    const sql = await getSql();
    await sql.query("update daily_scan_policies set revision=2 where newsroom_id=501");
    await finalizeDailyScanFailure(job, "429 quota");
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "select status from daily_scan_reservations where id=701",
        )
      )[0].status,
      "failed",
    );
    assert.equal(
      (
        await sql.query<{ paused: boolean }>(
          "select paused from daily_scan_policies where newsroom_id=501",
        )
      )[0].paused,
      false,
    );
  });
  it("pauses the matching policy on subscription quota with no reset time", async () => {
    await finalizeDailyScanFailure(job, "429 subscription quota reached");
    const [p] = await (
      await getSql()
    ).query<{ paused: boolean; pause_reason: string }>(
      "select paused,pause_reason from daily_scan_policies where newsroom_id=501",
    );
    assert.equal(p.paused, true);
    assert.match(p.pause_reason, /Resume manually/);
    assert.doesNotMatch(p.pause_reason, /hour|tomorrow|\d{1,2}:/);
  });
});

describe("scheduled runtime transport", () => {
  for (const runtime of ["claude-cli", "codex-terra", "codex-sol", "local"] as const) {
    it(`calls only the explicitly selected ${runtime} adapter`, async () => {
      const calls: string[] = [];
      const snapshot =
        runtime === "local"
          ? {
              runtime,
              modelChoice: "local-model",
              transport: "local",
              localModel: { baseUrl: "http://127.0.0.1:1234", id: "selected-local" },
            }
          : {
              runtime,
              modelChoice:
                runtime === "claude-cli"
                  ? "claude-frontier"
                  : runtime === "codex-terra"
                    ? "codex-balanced"
                    : "codex-frontier",
              transport: runtime === "claude-cli" ? "claude-code" : "codex",
              model: `selected-${runtime}`,
            };
      const result = await runForcedDailyChat(snapshot, "system", "user", 99, undefined, {
        claude: async () => (calls.push("claude"), "claude-result"),
        codex: async () => (calls.push("codex"), "codex-result"),
        local: async (_system, _user, _maxTokens, options) => {
          calls.push(`local:${options.localModel?.id}`);
          return "local-result";
        },
      });
      const expected =
        runtime === "claude-cli"
          ? ["claude"]
          : runtime === "local"
            ? ["local:selected-local"]
            : ["codex"];
      assert.deepEqual(calls, expected);
      assert.equal(result, `${expected[0].split(":")[0]}-result`);
    });
  }
});
