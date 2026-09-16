import assert from "node:assert/strict";
import { test } from "node:test";
import { opinionFallbackRuntimeReceipt } from "./opinion-runtime-receipt.ts";

test("Opinion preserves the requested local runtime and records Codex's destination effort", () => {
  assert.deepEqual(
    opinionFallbackRuntimeReceipt({
      requestedRuntime: "local-model",
      requestedEffort: null,
      previous: "local-model",
      next: "codex-frontier",
      reason: "unavailable",
    }),
    {
      requestedRuntime: "local-model",
      requestedEffort: null,
      actualRuntime: "codex-frontier",
      actualEffort: "medium",
      stage: "Switched to Codex Sol: Local model was unavailable",
      note: "This draft moved to Codex Sol because Local model was unavailable",
    },
  );
});

test("Opinion revalidates an unsupported source effort for a Claude destination", () => {
  const receipt = opinionFallbackRuntimeReceipt({
    requestedRuntime: "custom:11111111-1111-4111-8111-111111111111",
    requestedEffort: "none",
    previous: "codex-frontier",
    next: "claude-sonnet",
    reason: "quota",
  });
  assert.equal(receipt.requestedRuntime, "custom:11111111-1111-4111-8111-111111111111");
  assert.equal(receipt.requestedEffort, "none");
  assert.equal(receipt.actualRuntime, "claude-sonnet");
  assert.equal(receipt.actualEffort, "medium");
});
