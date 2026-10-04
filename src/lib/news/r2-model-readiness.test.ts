import { it } from "node:test";
import assert from "node:assert/strict";
import { modelReadinessOption } from "./model-readiness.ts";

it("names model options with Group 3 readiness only when facts exist", () => {
  const ready = { installed: true, signedIn: true, disabledByOperator: false, lastTest: null };
  for (const [status, word] of [
    [ready, "Ready"],
    [{ ...ready, signedIn: false }, "Sign in needed"],
    [{ ...ready, disabledByOperator: true }, "Turned off"],
    [{ ...ready, installed: false }, "Not installed"],
    [{ ...ready, lastTest: { ok: false } }, "Last test failed"],
  ] as const) {
    assert.equal(modelReadinessOption("Writing model", { status }), `Writing model · ${word}`);
  }
  assert.equal(modelReadinessOption("Unmeasured model", {}), "Unmeasured model");
  assert.equal(modelReadinessOption("Unmeasured model", { available: false }), "Unmeasured model");
  assert.equal(modelReadinessOption("API model", { available: true }), "API model · Ready");
  assert.equal(modelReadinessOption("API model", {
    connection: { enabled: false, hasApiKey: true, modelId: "example" },
  }), "API model · Turned off");
});
