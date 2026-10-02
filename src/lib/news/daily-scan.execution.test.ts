import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";
import { getPglite, getSql } from "../db.ts";
import {
  commitDailyScanResults,
  finalizeDailyScanFailure,
  runForcedDailyChat,
  tickDailyScans,
} from "./daily-scan.server.ts";
import { readDailyScanPolicy } from "./daily-scan.ts";
import type { DeskJob } from "./jobs.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

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
  /*
    The `sources` fixture above is a copy of the production table, so it has to
    carry the migrations too -- a copy that omits one is a fixture that lies
    about the schema (AK3). 0097 is the suggested-source origin columns
    (`proposed_reason`, `proposed_by`, `reviewed_at`, ...). It needs `exec`,
    not `query`: one file, several statements.
  */
  const pg = await getPglite();
  await pg.exec(
    await readFile(new URL("../../../migrations/0097_suggested_source_origin.sql", import.meta.url), "utf8"),
  );
  // 0099 is the structured-progress columns (stage_index, pct, step_text,
  // beat_at, cancel_requested, ...) that `executeJob` and the JobCard read.
  // Same rule as 0097 above: a hand-built copy of `desk_jobs` that omits a
  // migration is a fixture that lies about the schema. `exec`, not `query`:
  // one file, several statements.
  await pg.exec(
    await readFile(new URL("../../../migrations/0099_desk_job_progress.sql", import.meta.url), "utf8"),
  );
  await sql.query("alter table desk_jobs add column if not exists failover_note text not null default ''");
  await sql.query("alter table desk_jobs add column if not exists result_json text not null default '{}'");
  // U18a-1: `scan_runs.daily_reservation_id` is a real foreign key now, so the
  // runs that point at a reservation have to go before the reservation does.
  for (const t of [
    "daily_commit_marker",
    "scan_runs",
    "daily_scan_reservations",
    "desk_jobs",
    "newsroom_members",
    "daily_scan_policies",
    "sources",
    "paper_settings",
  ])
    await sql.query(`delete from ${t}`);
  // U18a-1: `daily_scan_policies` and `daily_scan_reservations` are the real
  // tables now, so room 501's `newsroom_id` is a real foreign key and the room
  // has to exist before anything can be written for it.
  await sql.query("insert into newsrooms(id,name) values(501,'Test room 501') on conflict (id) do nothing");
  await sql.query(
    // Column names, not positions: the real table has picked up columns
    // (`model_effort` in 0061 among them) since the fixture's column list was
    // written, and this insert now targets the real one.
    "insert into daily_scan_policies(newsroom_id,enabled,paused,pause_reason,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id,updated_at) values(501,true,false,null,'06:00','codex-terra',12,'[1]',1,'owner-501',now())",
  );
  // Column names again: the real `newsroom_members` is (user_id, role,
  // created_at, newsroom_id), so a positional three-value insert would land
  // the newsroom id on `created_at`.
  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values('owner-501','owner',501)",
  );
  await sql.query(
    "insert into desk_jobs(id,newsroom_id,user_id,kind,subject_id,status,claim_token,error,finished_at) values(501,501,'owner-501','scan',601,'running','lease-current',null,null)",
  );
  await sql.query(
    // The three snapshots are `not null` in the real table; the fixture's copy
    // declared them nullable.
    "insert into daily_scan_reservations(id,newsroom_id,local_day,scan_run_id,desk_job_id,status,policy_revision,policy_snapshot,source_snapshot,model_snapshot) values(701,501,'2026-09-04',601,501,'running',1,'{}','{}','{}')",
  );
  await sql.query(
    "insert into scan_runs(id,newsroom_id,user_id,daily_reservation_id,finished_at,error) values(601,501,'owner-501',701,null,null)",
  );
}
beforeEach(reset);

describe("daily scan refuses loudly, never silently", () => {
    /*
      The scheduled scan used to skip in silence when the account that
      configured it was no longer the newsroom owner. No log line, no
      pause_reason, no notice in the UI: a configured-looking paper simply
      stopped producing, and nothing told the operator why.

      The timezone and runtime checks in the same function already paused the
      policy with a sentence. This binds to that behavior for the owner case.
    */
    it("pauses the policy with a reason when the configuring account is not the owner", async () => {
      const sql = await getSql();
      await sql.query("update newsroom_members set role='editor' where user_id='owner-501'");
      // U18a-1: the reservations table is the real one, so the run pointing at
      // this reservation has to go first.
      await sql.query("delete from scan_runs where newsroom_id=501");
      await sql.query("delete from daily_scan_reservations where newsroom_id=501");
      // SG1: the ownership pause is only reached by a paper that HAS finished
      // setup -- an un-set-up one is skipped before this check runs.
      await sql.query("insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'America/Denver',true)");

      const result = await tickDailyScans(new Date("2026-09-04T14:00:00Z"), {
        runtimeSnapshot: async () => ({ ok: true }) as never,
        kick: false,
      });

      assert.equal(result.reserved, 0, "it must not reserve a run for a non-owner");
      const [row] = await sql.query<{ paused: boolean; pause_reason: string | null }>(
        "select paused, pause_reason from daily_scan_policies where newsroom_id=501",
      );
      assert.equal(row.paused, true, "the policy must be paused, not left looking healthy");
      assert.match(
        row.pause_reason ?? "",
        /no longer the owner/i,
        "the pause_reason must tell the operator what to fix",
      );
    });

    it("reserves normally once the configuring account is the owner again", async () => {
      /*
        Same setup the passing catch-up test uses: the reservation needs a paper
        timezone, an accepted source and a shaped runtime, and the fixture's own
        seeded job/reservation must be cleared. Without those the tick returns 0
        for reasons that have nothing to do with ownership, which is exactly what
        this test is NOT about.
      */
      const sql = await getSql();
      await sql.query("delete from scan_runs");
      await sql.query("delete from daily_scan_reservations");
      await sql.query("delete from desk_jobs");
      await sql.query("delete from scan_runs");
      // SG1: the scheduled scan only runs for a paper that has finished setup.
      await sql.query("insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'America/Denver',true)");
      await sql.query("insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/source','Source','rss','1','accepted')");

      const runtimeSnapshot = async () => ({
        requestedRuntime: "codex-balanced" as const, requestedEffort: null, resolvedRuntime: "codex-balanced" as const, switchReason: null, switchNote: null,
        runtime: "codex-terra" as const,
        modelChoice: "codex-balanced" as const,
        model: "selected-terra",
        transport: "codex" as const,
      });

      const result = await tickDailyScans(new Date("2026-09-04T14:00:00Z"), {
        runtimeSnapshot,
        kick: false,
      });
      assert.deepEqual(result, { reserved: 1 }, "an owner-configured policy must reserve a run");
    });
  });

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
  it("stores a selected custom model for the scheduled run without copying its secret", async () => {
    const sql = await getSql();
    await sql.query("delete from scan_runs");
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from scan_runs");
    await sql.query("update daily_scan_policies set runtime=$1 where newsroom_id=501", [
      "custom:11111111-1111-4111-8111-111111111111",
    ]);
    // SG1: a scheduled run needs a paper that has finished setup.
    await sql.query("insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'America/Denver',true)");
    await sql.query(
      "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/custom','Custom','rss','1','accepted')",
    );
    const snapshot = {
      requestedRuntime: "custom:11111111-1111-4111-8111-111111111111" as const, requestedEffort: null, resolvedRuntime: "custom:11111111-1111-4111-8111-111111111111" as const, switchReason: null, switchNote: null,
      runtime: "custom:11111111-1111-4111-8111-111111111111" as const,
      modelChoice: "custom:11111111-1111-4111-8111-111111111111" as const,
      transport: "custom" as const,
      model: "gemini-2.5-flash",
      newsroomId: 501,
      label: "Gemini",
    };
    let selected = "";
    assert.deepEqual(
      await tickDailyScans(new Date("2026-09-04T12:00:00Z"), {
        kick: false,
        runtimeSnapshot: async (_room, runtime) => {
          selected = runtime;
          return snapshot;
        },
      }),
      { reserved: 1 },
    );
    assert.equal(selected, snapshot.runtime);
    const [reservation] = await sql.query<{ model_snapshot: unknown }>(
      "select model_snapshot from daily_scan_reservations where newsroom_id=501",
    );
    assert.deepEqual(reservation.model_snapshot, snapshot);
    assert.doesNotMatch(JSON.stringify(reservation.model_snapshot), /api.?key|secret|base.?url/i);
    const [queued] = await sql.query<{ model_choice: string }>(
      "select model_choice from desk_jobs where newsroom_id=501",
    );
    assert.equal(queued.model_choice, snapshot.modelChoice);
  });

  for (const timezone of [null, "   "] as const) {
    it(`uses the UI's effective timezone for ${String(timezone)} legacy settings`, async () => {
      const sql = await getSql();
      await sql.query("delete from scan_runs");
      await sql.query("delete from daily_scan_reservations");
      await sql.query("delete from desk_jobs");
      await sql.query("delete from scan_runs");
      await sql.query("insert into paper_settings(newsroom_id,timezone,onboarded) values(501,$1,true)", [
        timezone,
      ]);
      await sql.query(
        "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/source','Source','rss','1','accepted')",
      );
      const now = new Date("2026-09-04T12:00:00Z");
      const shown = await readDailyScanPolicy(501, now);
      assert.equal(shown.nextRunAt, now.toISOString());
      const deps = {
        kick: false,
        runtimeSnapshot: async () => ({
          requestedRuntime: "codex-balanced" as const, requestedEffort: null, resolvedRuntime: "codex-balanced" as const, switchReason: null, switchNote: null,
        runtime: "codex-terra" as const,
          modelChoice: "codex-balanced" as const,
          model: "fixture",
          transport: "codex" as const,
        }),
      };
      assert.deepEqual(await tickDailyScans(now, deps), { reserved: 1 });
      const [receipt] = await sql.query<{ policy_snapshot: { timezone: string } }>(
        "select policy_snapshot from daily_scan_reservations where newsroom_id=501",
      );
      assert.equal(receipt.policy_snapshot.timezone, shown.timezone);
      assert.deepEqual(await tickDailyScans(now, deps), { reserved: 0 });
    });
  }
  /*
    SG1 / Option A, item 4(c): THE SCHEDULER SKIP.

    An install nobody has set up has no town, and a scheduled scan there would
    search the shipped Longmont sources on the owner's behalf and spend their
    credit. The tick skips it QUIETLY -- no reservation, no scan_runs row, no
    desk_jobs row, no pause, no error -- and says so in one log line.

    This is the old "missing-row legacy settings" case, which used to reserve a
    run against the shipped Longmont timezone. Under Option A a row that does
    not exist is exactly "not set up", so it is now the skip.
  */
  it("skips a newsroom with no paper_settings row at all: no reservation, no run, no job", async () => {
    const sql = await getSql();
    await sql.query("delete from scan_runs");
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from paper_settings");
    await sql.query(
      "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/source','Source','rss','1','accepted')",
    );
    const deps = {
      kick: false,
      runtimeSnapshot: async () => {
        throw new Error("the scheduler must not even probe a model for an un-set-up paper");
      },
    };
    assert.deepEqual(
      await tickDailyScans(new Date("2026-09-04T14:00:00Z"), deps),
      { reserved: 0 },
    );
    assert.equal((await sql.query("select * from daily_scan_reservations")).length, 0);
    assert.equal((await sql.query("select * from scan_runs")).length, 0);
    assert.equal((await sql.query("select * from desk_jobs")).length, 0);
  });

  it("skips an onboarded = false row the same way, and runs again once onboarded is true", async () => {
    const sql = await getSql();
    await sql.query("delete from scan_runs");
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from paper_settings");
    await sql.query(
      "insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'America/Denver',false)",
    );
    await sql.query(
      "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/source','Source','rss','1','accepted')",
    );
    const now = new Date("2026-09-04T14:00:00Z");
    const runtimeSnapshot = async () => ({
      requestedRuntime: "codex-balanced" as const,
      requestedEffort: null,
      resolvedRuntime: "codex-balanced" as const,
      switchReason: null,
      switchNote: null,
      runtime: "codex-terra" as const,
      modelChoice: "codex-balanced" as const,
      model: "fixture",
      transport: "codex" as const,
    });
    assert.deepEqual(await tickDailyScans(now, { runtimeSnapshot, kick: false }), {
      reserved: 0,
    });
    assert.equal((await sql.query("select * from desk_jobs")).length, 0);
    // Finish setup, and the very same tick reserves normally.
    await sql.query("update paper_settings set onboarded=true where newsroom_id=501");
    assert.deepEqual(await tickDailyScans(now, { runtimeSnapshot, kick: false }), {
      reserved: 1,
    });
  });

  it("pauses an invalid timezone without preventing another newsroom's due scan", async () => {
    const sql = await getSql();
    await sql.query("delete from scan_runs");
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from scan_runs");
    await sql.query(
      "insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'Not/AZone',true),(502,'UTC',true)",
    );
    await sql.query(
      "insert into newsrooms(id,name) values(502,'Test room 502') on conflict (id) do nothing",
    );
    await sql.query(
      "insert into daily_scan_policies(newsroom_id,enabled,paused,pause_reason,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id,updated_at) values(502,true,false,null,'06:00','codex-terra',12,'[2]',1,'owner-502',now())",
    );
    await sql.query(
      "insert into newsroom_members(user_id,role,newsroom_id) values('owner-502','owner',502)",
    );
    await sql.query(
      "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(2,502,'fixture','https://example.test/source','Source','rss','1','accepted')",
    );
    const probed: number[] = [];
    assert.deepEqual(
      await tickDailyScans(new Date("2026-09-04T12:00:00Z"), {
        kick: false,
        runtimeSnapshot: async (room) => {
          probed.push(room);
          return {
            requestedRuntime: "codex-balanced" as const, requestedEffort: null, resolvedRuntime: "codex-balanced" as const, switchReason: null, switchNote: null,
        runtime: "codex-terra" as const,
            modelChoice: "codex-balanced" as const,
            model: "fixture",
            transport: "codex" as const,
          };
        },
      }),
      { reserved: 1 },
    );
    assert.deepEqual(probed, [502]);
    const [bad] = await sql.query<{ paused: boolean; pause_reason: string }>(
      "select paused,pause_reason from daily_scan_policies where newsroom_id=501",
    );
    assert.equal(bad.paused, true);
    assert.match(bad.pause_reason, /timezone/i);
  });
  it("shows a due catch-up, reserves it once, then shows the next local day", async () => {
    const sql = await getSql();
    await sql.query("delete from scan_runs");
    await sql.query("delete from daily_scan_reservations");
    await sql.query("delete from desk_jobs");
    await sql.query("delete from scan_runs");
    await sql.query(
      "insert into paper_settings(newsroom_id,timezone,onboarded) values(501,'America/Denver',true)",
    );
    await sql.query(
      "insert into sources(id,newsroom_id,user_id,url,title,kind,tier,status) values(1,501,'fixture','https://example.test/source','Source','rss','1','accepted')",
    );
    const now = new Date("2026-09-04T14:00:00Z");
    const before = await readDailyScanPolicy(501, now);
    assert.equal(before.nextRunAt, now.toISOString());
    let probes = 0;
    const runtimeSnapshot = async () => {
      probes += 1;
      return {
        requestedRuntime: "codex-balanced" as const, requestedEffort: null, resolvedRuntime: "codex-balanced" as const, switchReason: null, switchNote: null,
        runtime: "codex-terra" as const,
        modelChoice: "codex-balanced" as const,
        model: "selected-terra",
        transport: "codex" as const,
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
                  ? "claude-sonnet"
                  : runtime === "codex-terra"
                    ? "codex-balanced"
                    : "codex-frontier",
              transport: runtime === "claude-cli" ? "claude-code" : "codex",
              model: `selected-${runtime}`,
            };
      const result = await runForcedDailyChat(snapshot as any, "system", "user", 99, undefined, {
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

  it("calls only the saved Custom AI adapter with its newsroom and exact Gemini model", async () => {
    const snapshot = {
      runtime: "custom:11111111-1111-4111-8111-111111111111",
      modelChoice: "custom:11111111-1111-4111-8111-111111111111",
      transport: "custom",
      model: "gemini-2.5-flash",
      newsroomId: 501,
      label: "Gemini",
    } as const;
    assert.doesNotMatch(JSON.stringify(snapshot), /api.?key|secret|base.?url/i);
    const calls: string[] = [];
    const result = await runForcedDailyChat(snapshot as any, "system", "user", 99, undefined, {
      claude: async () => { throw new Error("wrong transport"); },
      codex: async () => { throw new Error("wrong transport"); },
      local: async () => { throw new Error("wrong transport"); },
      custom: async (_system, _user, _maxTokens, options) => {
        calls.push(`${options.choice}:${options.newsroomId}:${options.model}`);
        return "gemini-result";
      },
    });
    assert.deepEqual(calls, [
      "custom:11111111-1111-4111-8111-111111111111:501:gemini-2.5-flash",
    ]);
    assert.equal(result, "gemini-result");
  });

  /*
    A scheduled scan row written by an older build can still hold this snapshot.
    GR-C removed the SuperGrok transport, so no adapter can run it and the run
    is refused with the generic "invalid snapshot" answer rather than silently
    reaching for a different provider.
  */
  it("refuses a stored SuperGrok scan snapshot instead of switching transport", async () => {
    const snapshot = {
      runtime: "grok-oauth",
      modelChoice: "grok-oauth",
      transport: "xai-oauth",
      model: "grok-4.6",
      newsroomId: 501,
    } as const;
    const calls: string[] = [];
    await assert.rejects(
      runForcedDailyChat(snapshot as any, "system", "user", 99, undefined, {
        claude: async () => { calls.push("claude"); throw new Error("wrong transport"); },
        codex: async () => { calls.push("codex"); throw new Error("wrong transport"); },
        local: async () => { calls.push("local"); throw new Error("wrong transport"); },
      }),
      /forced runtime snapshot is invalid/,
    );
    assert.deepEqual(calls, []);
  });
});
