/*
  A budget stop is not a verification failure.

  Run 4 of the 2026-09-16 isolated acceptance (docs/proofs/dark-desk-run-budget-0651.md)
  reported failed:1 with deferred:0 after the run clock ran out during the
  adversarial review. Nothing had failed - the meter had simply stopped the
  work, and the signals it never reached are deferred to a later round.

  verifyRunSignals already has the right vocabulary: `deferred` means "not
  attempted, keep it for later". This asserts budget stops land there.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureDarkSchema } from "./dark.ts";
import { createDarkRunBudget } from "./dark-run-budget.ts";
import { verifyRunSignals } from "./dark-verify.ts";
import { resolveResearchPreferences } from "./dark-preferences.ts";

const preferences = resolveResearchPreferences(
  { mode: "lookback", lookbackDays: 90, verificationLimit: 3 },
  new Date("2026-09-07T00:00:00Z"),
);

async function seedSignals(userId: string, newsroomId: number, count: number) {
  await ensureDarkSchema();
  const sql = await getSql();
  const [inv] = await sql<{ id: number }>`
    insert into investigations(user_id,newsroom_id,title)
    values(${userId},${newsroomId},'Budget stop probe') returning id`;
  const [run] = await sql<{ id: number }>`
    insert into dark_runs(user_id,newsroom_id) values(${userId},${newsroomId}) returning id`;
  for (let i = 0; i < count; i++)
    await sql`
      insert into dark_signals(user_id,newsroom_id,run_id,investigation_id,name,posture,signal_type,strength,confidence,observation,stage,verification_status)
      values(${userId},${newsroomId},${run!.id},${inv!.id},${"Signal " + i},'Follow the Thread','pattern',8,0.4,'Record changed','black-desk','unverified')`;
  return { investigationId: inv!.id, runId: run!.id };
}

test("a model-call budget stop defers the untouched signals instead of failing them", async () => {
  const userId = "verify-budget-stop";
  const newsroomId = 95;
  const { investigationId, runId } = await seedSignals(userId, newsroomId, 3);

  // No model calls left at all: the review must not start and must not blame
  // the signals for it.
  const runBudget = createDarkRunBudget({
    elapsedMs: 600_000,
    modelCalls: 0,
    searches: 100,
    documentReads: 100,
  });

  const out = await verifyRunSignals({
    userId,
    newsroomId,
    runId,
    investigationId,
    place: { city: "Longmont", state: "Colorado" },
    preferences,
    runBudget,
    deps: {
      search: async () => [],
      model: async () => null,
    },
  });

  assert.equal(out.verified, 0);
  assert.equal(out.failed, 0, "a budget stop is not a failure");
  assert.equal(out.deferred, 3, "the signal it never reached is deferred");
  assert.equal(out.unverified, 3);
  assert.equal(runBudget.stopReason, "model-call-limit");
});

test("a search budget stop defers the untouched signals instead of failing them", async () => {
  const userId = "verify-search-stop";
  const newsroomId = 96;
  const { investigationId, runId } = await seedSignals(userId, newsroomId, 3);

  const runBudget = createDarkRunBudget({
    elapsedMs: 600_000,
    modelCalls: 100,
    searches: 0,
    documentReads: 100,
  });

  const out = await verifyRunSignals({
    userId,
    newsroomId,
    runId,
    investigationId,
    place: { city: "Longmont", state: "Colorado" },
    preferences,
    runBudget,
    deps: {
      search: async () => [],
      model: async () => null,
    },
  });

  assert.equal(out.failed, 0, "a search budget stop is not a failure");
  assert.equal(out.deferred, 3);
  assert.equal(out.unverified, 3);
  assert.equal(runBudget.stopReason, "search-limit");
});

test("a live-shaped verification names its provider instead of calling itself injected", async () => {
  const userId = "verify-provider-label";
  const newsroomId = 99;
  const { investigationId, runId } = await seedSignals(userId, newsroomId, 1);

  const runBudget = createDarkRunBudget({
    elapsedMs: 600_000,
    modelCalls: 10,
    searches: 100,
    documentReads: 100,
  });

  await verifyRunSignals({
    userId,
    newsroomId,
    runId,
    investigationId,
    place: { city: "Longmont", state: "Colorado" },
    preferences,
    choice: "codex-luna",
    runBudget,
    // Production passes a failover-wrapped callback here, exactly like this.
    deps: { search: async () => [], model: async () => null },
  });

  const call = runBudget.snapshot().calls[0];
  assert.ok(call, "the verification call was recorded");
  assert.notEqual(call!.provider, "injected", "a live provider call must not be logged as a test double");
  assert.notEqual(call!.model, "injected", "a live provider call must name its model");
  assert.equal(call!.provider, "codex-luna", "the recorded provider is the editor's choice");
});
