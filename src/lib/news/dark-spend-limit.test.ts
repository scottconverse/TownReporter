// guards: a file could keep spending beyond its cap or promise a cap on unmeasured subscription usage
import { it } from "node:test";
import assert from "node:assert/strict";
import { createDarkRunBudgetForFile } from "./dark-run-budget.ts";
import { parseCliEnvelope } from "./ai-claude-code.server.ts";
import * as copy from "./desk-copy.ts";
it("stops paid calls at the file limit and marks unmeasured spend", () => {
  const limits = { elapsedMs: 120000, modelCalls: 10, searches: 10, documentReads: 10 };
  const budget = createDarkRunBudgetForFile(limits, { minutes: 2, dollars: 3 });
  for (const cost of [1.25, 1.75]) {
    const ai = parseCliEnvelope(JSON.stringify({ result: "Saved finding", total_cost_usd: cost }),
      { provider: "claude-code", model: "sonnet", durationMs: 1, timedOut: false });
    const call = budget.startModelCall({ stage: "research", provider: "claude-code", model: "sonnet" });
    assert.ok(call);
    call.finish({ result: "ok", ...ai.meta });
  }
  assert.equal(budget.startModelCall({ stage: "next", provider: "claude-code", model: "sonnet" }), null);
  assert.equal(budget.stopReason, "dollar-limit");
  assert.equal(budget.snapshot().totals.costDollars, 3);
  assert.equal(budget.snapshot().calls.length, 2);
  assert.match(copy.darkSpendLabel(3, budget.snapshot().totals), /\$3/);
  const unmeasured = createDarkRunBudgetForFile(limits, { minutes: 2, dollars: 3 });
  unmeasured.startModelCall({ stage: "research", provider: "codex", model: "terra" })!.finish({ result: "ok" });
  assert.doesNotMatch(copy.darkSpendLabel(3, unmeasured.snapshot().totals), /\$3/);
  assert.match(copy.darkSpendLabel(3, unmeasured.snapshot().totals), /not measured/i);
});
