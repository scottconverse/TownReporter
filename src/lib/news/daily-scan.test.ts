import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanDailyScanPolicyInput,
  nextDailyOccurrence,
  nextEligibleDailyOccurrence,
  persistDailyScanPolicy,
} from "./daily-scan.ts";
import { getSql } from "../db.ts";
import { planAutomaticFailover } from "./automatic-failover.ts";
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
  it("never fails a scheduled run over to another provider", async () => {
    let probes = 0;
    const plan = await planAutomaticFailover({
      source: "scheduled",
      current: "claude-frontier",
      error: "Claude Code request timed out after 150s, 0 bytes out",
      probe: async () => {
        probes += 1;
        return { ok: true, choice: "codex-balanced", label: "Codex Terra" };
      },
    });
    assert.equal(plan, null);
    assert.equal(probes, 0);
  });
});

describe("daily scan request validation", () => {
  for (const raw of [
    null,
    {},
    { enabled: "true" },
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
      "create table if not exists daily_scan_policies(newsroom_id integer primary key,enabled boolean not null,paused boolean not null,pause_reason text,local_time text not null,runtime text not null,source_cap integer not null,selected_source_ids jsonb not null,revision integer not null,updated_at timestamptz,configured_by_user_id text not null)",
    );
    const newsroomId = 88001;
    await sql.query("delete from daily_scan_policies where newsroom_id=$1", [newsroomId]);
    const input = {
      enabled: false,
      localTime: "06:00",
      runtime: "local" as const,
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
