import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNSAVED_DAILY_SCAN_POLICY,
  cleanDailyScanPolicyInput,
  dailyScanRuntime,
  nextDailyOccurrence,
  nextEligibleDailyOccurrence,
  persistDailyScanPolicy,
  runSnapshotRuntimes,
  setDailyScanPaused,
  planDailySourceRotation,
  dailyRotationNote,
} from "./daily-scan.ts";
import { getSql } from "../db.ts";
import { planAutomaticFailover } from "./automatic-failover.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import type { EffectiveProviderChoice } from "./ai.ts";
import { readFileSync } from "node:fs";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

describe("daily scan wall clock", () => {
  it("moves a skipped spring-forward time to the first valid instant after the gap", () => {
    assert.equal(
      nextDailyOccurrence(
        "America/Denver",
        "02:30",
        new Date("2026-03-08T07:00:00Z"),
      ).toISOString(),
      "2026-03-08T09:00:00.000Z",
    );
  });

  it("chooses the first occurrence of a repeated fall-back time", () => {
    assert.equal(
      nextDailyOccurrence(
        "America/Denver",
        "01:30",
        new Date("2026-11-01T06:00:00Z"),
      ).toISOString(),
      "2026-11-01T07:30:00.000Z",
    );
  });
  it("reports due now after the trigger until today is reserved, then reports tomorrow", () => {
    const now = new Date("2026-09-04T14:00:00Z");
    assert.equal(
      nextEligibleDailyOccurrence("America/Denver", "06:00", now, null).toISOString(),
      now.toISOString(),
    );
    assert.equal(
      nextEligibleDailyOccurrence("America/Denver", "06:00", now, "2026-09-04").toISOString(),
      "2026-09-05T12:00:00.000Z",
    );
  });
});

describe("scheduled scan trust boundaries", () => {
  const server = readFileSync(new URL("./daily-scan.server.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../../migrations/0050_daily_scan.sql", import.meta.url),
    "utf8",
  );
  it("defaults disabled and fences one local day plus one open reservation", () => {
    assert.match(migration, /enabled boolean not null default false/);
    assert.match(migration, /unique\(newsroom_id,\s*local_day\)/);
    assert.match(migration, /where status in \('queued',\s*'running'\)/);
  });
  it("forces subscription CLI transports and never names an API-key fallback", () => {
    assert.match(server, /ai-claude-code\.server\.ts/);
    assert.match(server, /ai-codex\.server\.ts/);
    assert.doesNotMatch(server, /ANTHROPIC_API_KEY|configured gateway|resolveProvider/);
  });
  it("routes a scheduled run around a technical provider failure", async () => {
    /*
      0.6.63 Unit Y: the ladder is now DeepSeek v4.1 Flash -> Qwen 3.6 35B ->
      Codex Terra. Two things in this fixture followed it, and neither one is
      an assertion being relaxed:

       - `claude-frontier` is no longer a rung, so a scheduled run has no rung
         "after" it and the walk restarts from the ladder's top -- DeepSeek.
       - The probe answers about the rung it was handed instead of returning
         one hardcoded provider. The old constant probe ("Codex Terra for
         everything") made the plan read `next: "codex-balanced"` while the
         merged planner returns `next: <the rung it probed>`; a plan whose
         `next` and `label` disagree is not a shape this desk can act on.
    */
    const probed: string[] = [];
    const plan = await planAutomaticFailover({
      source: "scheduled",
      current: "claude-frontier",
      error: "Claude Code request timed out after 150s, 0 bytes out",
      probe: async (choice) => {
        probed.push(choice);
        return { ok: true, choice: choice as EffectiveProviderChoice, label: modelChoiceLabel(choice) };
      },
    });
    assert.deepEqual(probed, ["deepseek-flash"], "the walk starts at the ladder's first rung");
    assert.deepEqual(plan, {
      next: "deepseek-flash",
      label: "DeepSeek v4.1 Flash",
      reason: "timeout",
    });
  });
});

describe("daily scan request validation", () => {
  it("migrates legacy runtime names without silently choosing Opus", () => {
    assert.equal(dailyScanRuntime("claude-cli"), "claude-sonnet");
    assert.equal(dailyScanRuntime("codex-terra"), "codex-balanced");
    assert.equal(dailyScanRuntime("codex-sol"), "codex-frontier");
    assert.equal(dailyScanRuntime("local"), "local-model");
    assert.equal(dailyScanRuntime("claude-frontier"), "claude-frontier");
    assert.equal(dailyScanRuntime("custom:gemini"), "custom:gemini");
  });
  for (const raw of [
    null,
    {},
    { enabled: "true" },
    {
      enabled: false,
      localTime: "06:00",
      runtime: "unknown-provider",
      sourceCap: 12,
      selectedSourceIds: [],
      expectedRevision: 0,
    },
    {
      enabled: "false",
      localTime: "06:00",
      runtime: "local",
      sourceCap: 12,
      selectedSourceIds: [1],
      expectedRevision: 0,
    },
    {
      enabled: false,
      localTime: "06:00",
      runtime: "local",
      sourceCap: 12,
      selectedSourceIds: null,
      expectedRevision: 0,
    },
    {
      enabled: false,
      localTime: "06:00",
      runtime: "local",
      sourceCap: 12,
      selectedSourceIds: ["1"],
      expectedRevision: 0,
    },
  ]) {
    it(`rejects malformed input ${JSON.stringify(raw)}`, () =>
      assert.ok(cleanDailyScanPolicyInput(raw).invalidError));
  }
});

/*
  The policy table as these tests read and write it. PGlite here is not the
  migrated database (see `getSql`), so the shape the two compare-and-swap tests
  need is spelled once, in one place, for both of them.
*/
const POLICY_TABLE =
  "create table if not exists daily_scan_policies(newsroom_id integer primary key,enabled boolean not null,paused boolean not null,pause_reason text,local_time text not null,runtime text not null,model_effort text,source_cap integer not null,selected_source_ids jsonb not null,revision integer not null,updated_at timestamptz,configured_by_user_id text not null)";

/*
  U18a-1: `daily_scan_policies` is the real table now -- `migrations/*.sql` is
  applied before this file loads -- so its `newsroom_id` is a real foreign key
  into `newsrooms`, and a test room needs its row before a policy can be
  written for it.
*/
async function ensureNewsroomRow(sql: Awaited<ReturnType<typeof getSql>>, newsroomId: number) {
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    newsroomId,
    `Test room ${newsroomId}`,
  ]);
}

describe("daily scan policy compare-and-swap", () => {
  it("accepts sequential current revisions and rejects a stale revision", async () => {
    const sql = await getSql();
    await sql.query(POLICY_TABLE);
    const newsroomId = 88001;
    await ensureNewsroomRow(sql, newsroomId);
    await sql.query("delete from daily_scan_policies where newsroom_id=$1", [newsroomId]);
    const input = {
      enabled: false,
      localTime: "06:00",
      runtime: "local-model" as const,
      modelEffort: null,
      sourceCap: 12,
      selectedSourceIds: [7],
      expectedRevision: 0,
    };
    assert.equal(await persistDailyScanPolicy(sql, newsroomId, "owner", input, [7]), true);
    assert.equal(
      await persistDailyScanPolicy(
        sql,
        newsroomId,
        "owner",
        { ...input, localTime: "07:00", expectedRevision: 1 },
        [7],
      ),
      true,
    );
    assert.equal(
      await persistDailyScanPolicy(
        sql,
        newsroomId,
        "owner",
        { ...input, localTime: "08:00", expectedRevision: 1 },
        [7],
      ),
      false,
    );
    const [row] = await sql.query<{ revision: number; local_time: string }>(
      "select revision,local_time from daily_scan_policies where newsroom_id=$1",
      [newsroomId],
    );
    assert.deepEqual(row, { revision: 2, local_time: "07:00" });
  });
});

/*
  Unit CX3 (0.6.81): Pause on a desk that never saved a schedule.

  `readDailyScanPolicy` answers `revision: 0` for a desk with no row, and every
  row starts at revision 1 -- so Pause and Resume were sending a revision no
  row could ever match, and a fresh desk was refused with "The schedule changed
  in another window" about a change nobody had made. 0 means "there is no row":
  Pause writes the hold its owner asked for, Resume confirms there is nothing
  to hold, and a 0 that has gone stale is refused like any other.
*/
describe("daily scan pause on a desk that never saved a schedule", () => {
  const OWNER = "owner-91";
  const policyRow = async (newsroomId: number) => {
    const sql = await getSql();
    const [row] = await sql.query<{
      enabled: boolean;
      paused: boolean;
      pause_reason: string | null;
      local_time: string;
      runtime: string;
      model_effort: string | null;
      source_cap: number;
      selected_source_ids: number[];
      revision: number;
      configured_by_user_id: string;
    }>(
      "select enabled,paused,pause_reason,local_time,runtime,model_effort,source_cap,selected_source_ids,revision,configured_by_user_id from daily_scan_policies where newsroom_id=$1",
      [newsroomId],
    );
    return row;
  };

  it("pauses a desk whose schedule was never saved, writing the schedule it already had", async () => {
    const sql = await getSql();
    await sql.query(POLICY_TABLE);
    const newsroomId = 88002;
    await ensureNewsroomRow(sql, newsroomId);
    await sql.query("delete from daily_scan_policies where newsroom_id=$1", [newsroomId]);

    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, true, 0), true);
    assert.deepEqual(await policyRow(newsroomId), {
      enabled: false,
      paused: true,
      pause_reason: "Paused by the owner.",
      local_time: UNSAVED_DAILY_SCAN_POLICY.localTime,
      runtime: UNSAVED_DAILY_SCAN_POLICY.runtime,
      model_effort: UNSAVED_DAILY_SCAN_POLICY.modelEffort,
      source_cap: UNSAVED_DAILY_SCAN_POLICY.sourceCap,
      selected_source_ids: [],
      revision: 1,
      configured_by_user_id: OWNER,
    });

    /* And Resume is the same compare-and-swap it always was, on the row Pause wrote. */
    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, false, 1), true);
    const resumed = await policyRow(newsroomId);
    assert.deepEqual(
      [resumed.paused, resumed.pause_reason, resumed.revision],
      [false, null, 2],
    );
  });

  it("resumes a desk with no schedule at all without configuring one", async () => {
    const sql = await getSql();
    await sql.query(POLICY_TABLE);
    const newsroomId = 88003;
    await ensureNewsroomRow(sql, newsroomId);
    await sql.query("delete from daily_scan_policies where newsroom_id=$1", [newsroomId]);
    /* The desk is not paused, so resuming asks for the state it already has. */
    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, false, 0), true);
    const rows = await sql.query("select 1 from daily_scan_policies where newsroom_id=$1", [
      newsroomId,
    ]);
    assert.equal(rows.length, 0, "resuming an unsaved schedule writes nothing");
  });

  /*
    The one thing 0 must not become: a way to write without a revision. Both
    branches prove no row exists under the caller, so a screen holding a stale
    0 -- a tab open while another window saved -- is refused like any other
    stale revision, and the other window's schedule is left alone.
  */
  it("still refuses a stale revision, including a stale 0", async () => {
    const sql = await getSql();
    await sql.query(POLICY_TABLE);
    const newsroomId = 88004;
    await ensureNewsroomRow(sql, newsroomId);
    await sql.query("delete from daily_scan_policies where newsroom_id=$1", [newsroomId]);
    await sql.query(
      "insert into daily_scan_policies(newsroom_id,enabled,paused,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id) values($1,true,false,'07:00','codex-terra',12,'[]'::jsonb,5,'other-window')",
      [newsroomId],
    );
    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, true, 0), false);
    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, false, 0), false);
    assert.equal(await setDailyScanPaused(sql, newsroomId, OWNER, true, 4), false);
    const row = await policyRow(newsroomId);
    assert.deepEqual([row.revision, row.paused, row.local_time], [5, false, "07:00"]);
  });

  /*
    The write's defaults are the READ's, not the table's. `runtime` is the one
    that would bite: the column default is 'local' and the read's answer for no
    row is 'auto', so a row built from the column default would have the paper
    running Local model the moment its owner enabled the scan -- a schedule
    change nobody asked for, made by pressing Pause.
  */
  it("writes the read's defaults, never the table's", () => {
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.runtime, dailyScanRuntime(undefined));
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.runtime, "auto");
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.localTime, "06:00");
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.sourceCap, 12);
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.enabled, false);
    assert.equal(UNSAVED_DAILY_SCAN_POLICY.paused, false);
    assert.deepEqual(UNSAVED_DAILY_SCAN_POLICY.selectedSourceIds, []);
    const source = readFileSync(new URL("./daily-scan.ts", import.meta.url), "utf8");
    /* The array is copied out of the constant rather than handed over by reference. */
    for (const field of ["localTime", "sourceCap", "selectedSourceIds", "revision"] as const)
      assert.match(
        source,
        new RegExp(`p\\?\\.\\w+ \\?\\? (\\[\\.\\.\\.)?UNSAVED_DAILY_SCAN_POLICY\\.${field}`),
        `the read's ${field} fallback is the constant Pause writes`,
      );
  });
});

/*
  Unit AA (0.6.64) item 6: "the run record names the resolved model". Both
  writes a scheduled run makes -- `daily_scan_reservations.model_snapshot` and
  `scan_runs.model_snapshot` -- store the runtime receipt whole, so the panel's
  new "Model:" line reads it from the reservation the run left behind. These
  pin the read, including the pre-0.6.64 row that named only `modelChoice`.
*/
describe("daily scan run record names the model", () => {
  it("reads requested and resolved out of a scheduled run's model snapshot", () => {
    assert.deepEqual(
      runSnapshotRuntimes({
        runtime: "deepseek-flash",
        modelChoice: "deepseek-flash",
        transport: "local",
        localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
        requestedRuntime: "auto",
        requestedEffort: "medium",
        resolvedRuntime: "deepseek-flash",
        switchReason: null,
        switchNote: null,
      }),
      { requestedRuntime: "auto", resolvedRuntime: "deepseek-flash" },
    );
  });
  it("names the model a pre-0.6.64 reservation recorded, which carries only modelChoice", () => {
    assert.deepEqual(
      runSnapshotRuntimes({ runtime: "claude-haiku", modelChoice: "claude-haiku", transport: "cli" }),
      { requestedRuntime: null, resolvedRuntime: "claude-haiku" },
    );
  });
  it("says nothing rather than guessing at a snapshot it cannot read", () => {
    for (const value of [null, undefined, "auto", {}, { requestedRuntime: 7, resolvedRuntime: "  " }])
      assert.deepEqual(runSnapshotRuntimes(value), { requestedRuntime: null, resolvedRuntime: null });
  });
});

/*
  THE DAILY ROTATION PLAN (migration 0128 and adaptive-source-selection.ts).

  The scheduled pass used to read exactly the editor's stored twelve every day,
  so with 201 accepted sources the other 189 were never read. These pin the
  replacement: the editor's picks still come first and are never dropped, the
  rest of the budget rotates by due/longest-waiting, parked rows are deferred
  not deleted, and the plan states the freshness it actually buys.
*/
describe("daily scan rotation plan", () => {
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
  const src = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    url: `https://city.example.gov/source-${id}`,
    title: `Source ${id}`,
    kind: "official",
    tier: "A",
    status: "accepted",
    ...over,
  });

  it("reads the editor's selected sources first and never drops one", () => {
    const plan = planDailySourceRotation({
      facts: [src(1, { last_ok_at: ago(40) }), src(2, { last_ok_at: ago(30) }), src(3)],
      selectedSourceIds: [2],
      cap: 3,
      nowMs: NOW,
    });
    assert.equal(plan.sourceIds[0], 2);
    assert.equal(plan.selectedCount, 1);
    assert.equal(plan.rotatedCount, 2);
  });

  it("fills the remaining budget from the rotation, oldest waiting first", () => {
    const plan = planDailySourceRotation({
      facts: [
        src(1, { last_ok_at: ago(1) }),
        src(2, { last_ok_at: ago(40) }),
        src(3, { last_ok_at: ago(20) }),
      ],
      selectedSourceIds: [],
      cap: 2,
      nowMs: NOW,
    });
    assert.deepEqual(plan.sourceIds, [2, 3]);
    assert.equal(plan.budget, 2);
  });

  it("defers a parked source and reports the gap instead of hiding it", () => {
    const plan = planDailySourceRotation({
      facts: [
        src(1, { last_ok_at: ago(5) }),
        src(2, { retry_after: new Date(NOW + 3_600_000).toISOString() }),
      ],
      selectedSourceIds: [],
      cap: 12,
      nowMs: NOW,
    });
    assert.deepEqual(plan.sourceIds, [1]);
    assert.ok(plan.deferredIds.includes(2));
  });

  it("states the full-pass interval truthfully rather than promising coverage", () => {
    const facts = Array.from({ length: 20 }, (_, i) => src(i + 1, { last_ok_at: ago(i) }));
    const plan = planDailySourceRotation({ facts, selectedSourceIds: [], cap: 10, nowMs: NOW });
    assert.equal(plan.poolSize, 20);
    assert.equal(plan.fullPassDays, 2);
    assert.match(plan.note, /full pass takes about 2 days/);
  });

  it("names quiet sources that carry no priority flag", () => {
    const plan = planDailySourceRotation({
      facts: [
        src(1, { url: "https://x.gov/rss.xml", last_ok_at: ago(9) }),
        src(2, { url: "https://x.gov/council/agenda", last_ok_at: ago(9) }),
      ],
      selectedSourceIds: [],
      preferences: [{ sourceId: 2, highPriority: true }],
      cap: 12,
      nowMs: NOW,
    });
    assert.deepEqual(plan.unmarkedQuietIds, [1]);
    assert.match(plan.note, /1 quiet source/);
  });

  it("clamps the budget to the schema's cap and says so plainly when the pool is empty", () => {
    const plan = planDailySourceRotation({ facts: [], selectedSourceIds: [], cap: 99, nowMs: NOW });
    assert.equal(plan.budget, 12);
    assert.equal(plan.sourceIds.length, 0);
    assert.equal(dailyRotationNote({
      poolSize: 0,
      selectedCount: 0,
      rotatedCount: 0,
      budget: 12,
      fullPassDays: 1,
      unmarkedQuietCount: 0,
    }), "No accepted sources to read.");
  });

  /*
    CONTRADICTION 1 (issue 3): a source the host parked must not be BOTH selected
    and read. The old planner re-added every stored pick over the rotation's
    deferral list, so a blocked/parked source could be read in the same pass that
    the plan also reported it deferred. The stored pick is preserved (it is named
    in `selectedDeferredIds`), but the automatic run does not read it.
  */
  it("never reads a parked or blocked source the editor selected, and says it waits", () => {
    const plan = planDailySourceRotation({
      facts: [
        src(1, { last_ok_at: ago(5) }),
        src(2, { retry_after: new Date(NOW + 3_600_000).toISOString() }),
        src(3, { blocked_at: "2026-10-04T00:00:00Z" }),
      ],
      selectedSourceIds: [2, 3],
      cap: 12,
      nowMs: NOW,
    });
    assert.ok(!plan.sourceIds.includes(2), "a parked pick must not be read");
    assert.ok(!plan.sourceIds.includes(3), "a blocked pick must not be read");
    assert.deepEqual(plan.selectedDeferredIds.sort((a, b) => a - b), [2, 3]);
    const reasons = new Map(plan.deferrals.map((d) => [d.sourceId, d.reason]));
    assert.equal(reasons.get(2), "parked");
    assert.equal(reasons.get(3), "blocked");
    assert.match(plan.note, /selections wait/);
  });

  /*
    CONTRADICTION 2 (issue 5): selected IDs can exceed the cap. The plan must NOT
    claim a bounded budget while returning more IDs than the cap; it schedules a
    bounded eligible subset and defers the rest VISIBLY. `sourceIds.length` must
    never exceed `budget`, and every selected source that did not run is named.
  */
  it("keeps sourceIds within the cap when the editor selected more than the budget", () => {
    const facts = Array.from({ length: 20 }, (_, i) => src(i + 1, { last_ok_at: ago(i) }));
    const plan = planDailySourceRotation({
      facts,
      selectedSourceIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      cap: 5,
      nowMs: NOW,
    });
    assert.equal(plan.budget, 5);
    assert.ok(
      plan.sourceIds.length <= plan.budget,
      `read set ${plan.sourceIds.length} must not exceed budget ${plan.budget}`,
    );
    // The first five picks ran, in order; the other ten are visibly deferred.
    assert.deepEqual(plan.sourceIds, [1, 2, 3, 4, 5]);
    assert.equal(plan.selectedDeferredIds.length, 10);
    assert.deepEqual(plan.selectedDeferredIds, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const reasons = plan.deferrals.filter((d) => plan.selectedDeferredIds.includes(d.sourceId));
    assert.ok(reasons.every((d) => d.reason === "over-budget"));
  });

  /*
    CONTRADICTION 3 (issue 5): freshness must be computed from the ACTUAL chosen
    and deferred set, not from the internal pre-selection rotation. Here the
    editor's pick forces a very old source OUT of the read set, so the stalest
    deferred day must reflect that source's real age.
  */
  it("reports freshness from the real chosen set, not the internal rotation", () => {
    const facts = [
      src(1, { last_ok_at: ago(90) }), // the stalest source in the pool
      src(2, { last_ok_at: ago(1) }),
      src(3, { last_ok_at: ago(2) }),
    ];
    const plan = planDailySourceRotation({
      facts,
      selectedSourceIds: [2, 3],
      cap: 2,
      nowMs: NOW,
    });
    // The picks fill the budget, so source 1 (90 days old) is deferred, and that
    // is the stalest deferred day the plan must report.
    assert.deepEqual(plan.sourceIds, [2, 3]);
    assert.equal(plan.stalestDeferredDays, 90);
    assert.equal(plan.fullPassDays, 2);
  });
});
/*
  THE WIRING PIN. `daily-scan.ts` owns the plan; `daily-scan.server.ts` has to
  CALL it, or the schedule goes on reading the same fixed dozen. This is the
  same source-text pin style the trust-boundary suite above uses, because the
  server module pulls in `jobs.ts` and `@tanstack/react-start` and cannot be
  imported by a plain `node --test` run.

  THE MUTATION it defends against: reverting the pool read back to
  `id=any($2::int[])` over the stored selection, which is exactly the old
  behaviour the brief says not to keep.
*/
describe("daily scan server calls the rotation", () => {
  const server = readFileSync(new URL("./daily-scan.server.ts", import.meta.url), "utf8");
  it("selects the accepted pool and cuts it with planDailySourceRotation", () => {
    assert.match(server, /planDailySourceRotation\(/);
    assert.match(server, /selectedSourceIds: p\.selected_source_ids/);
    assert.match(server, /cap: p\.source_cap/);
    assert.match(server, /status='accepted' order by id/);
  });
});
