import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanDailyScanPolicyInput,
  dailyScanRuntime,
  nextDailyOccurrence,
  nextEligibleDailyOccurrence,
  persistDailyScanPolicy,
  runSnapshotRuntimes,
} from "./daily-scan.ts";
import { getSql } from "../db.ts";
import { planAutomaticFailover } from "./automatic-failover.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import type { EffectiveProviderChoice } from "./ai.ts";
import { readFileSync } from "node:fs";

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

describe("daily scan policy compare-and-swap", () => {
  it("accepts sequential current revisions and rejects a stale revision", async () => {
    const sql = await getSql();
    await sql.query(
      "create table if not exists daily_scan_policies(newsroom_id integer primary key,enabled boolean not null,paused boolean not null,pause_reason text,local_time text not null,runtime text not null,model_effort text,source_cap integer not null,selected_source_ids jsonb not null,revision integer not null,updated_at timestamptz,configured_by_user_id text not null)",
    );
    const newsroomId = 88001;
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
