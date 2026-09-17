import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDarkRunBudget,
  type DarkRunBudgetLimits,
} from "./dark-run-budget.ts";

const LIMITS: DarkRunBudgetLimits = {
  elapsedMs: 10_000,
  modelCalls: 2,
  searches: 3,
  documentReads: 2,
};

describe("DarkRunBudget", () => {
  it("stops before a capped operation and keeps an explicit reason", () => {
    let now = 1_000;
    const budget = createDarkRunBudget(LIMITS, { now: () => now });

    assert.equal(budget.consumeSearch(), true);
    assert.equal(budget.consumeSearch(), true);
    assert.equal(budget.consumeSearch(), true);
    assert.equal(budget.consumeSearch(), false);
    assert.equal(budget.stopReason, "search-limit");
    assert.deepEqual(budget.snapshot().totals, {
      modelCalls: 0,
      searches: 3,
      documentReads: 0,
      elapsedMs: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });

    now += 500;
    assert.equal(budget.snapshot().totals.elapsedMs, 500);
  });

  it("accounts model calls and reports token totals only when every call reports them", () => {
    let now = 5_000;
    const budget = createDarkRunBudget(LIMITS, { now: () => now });
    const first = budget.startModelCall({ stage: "planning hop 1", provider: "claude", model: "haiku" });
    assert.ok(first);
    now += 120;
    first.finish({ result: "ok", inputTokens: 100, outputTokens: 25, totalTokens: 125 });

    const second = budget.startModelCall({ stage: "synthesis", provider: "codex", model: "terra" });
    assert.ok(second);
    now += 80;
    second.finish({ result: "timeout", timedOut: true });

    const snapshot = budget.snapshot();
    assert.equal(snapshot.totals.modelCalls, 2);
    assert.equal(snapshot.totals.elapsedMs, 200);
    assert.equal(snapshot.totals.inputTokens, null, "a partial provider report is not a whole-run total");
    assert.equal(snapshot.totals.outputTokens, null);
    assert.equal(snapshot.totals.totalTokens, null);
    assert.deepEqual(snapshot.calls, [
      {
        stage: "planning hop 1",
        provider: "claude",
        model: "haiku",
        durationMs: 120,
        result: "ok",
        timedOut: false,
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
      {
        stage: "synthesis",
        provider: "codex",
        model: "terra",
        durationMs: 80,
        result: "timeout",
        timedOut: true,
      },
    ]);
    assert.equal(budget.startModelCall({ stage: "extra", provider: "codex", model: "terra" }), null);
    assert.equal(budget.stopReason, "model-call-limit");
  });

  it("enforces elapsed wall time across every operation kind", () => {
    let now = 10_000;
    const budget = createDarkRunBudget(LIMITS, { now: () => now });
    now += LIMITS.elapsedMs;

    assert.equal(budget.consumeDocumentRead(), false);
    assert.equal(budget.stopReason, "elapsed-time-limit");
    assert.equal(budget.remainingMs(), 0);
  });
});
