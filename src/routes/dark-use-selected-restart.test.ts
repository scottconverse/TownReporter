import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRestartDarkRoundOnSelectedModel } from "./dark-use-selected-restart.ts";

describe("Use selected model restart timing", () => {
  for (const status of ["failed", "stopped", "cancelled", "completed"]) {
    it(`restarts when the selected job is ${status}`, () => {
      assert.equal(shouldRestartDarkRoundOnSelectedModel(487, { id: 487, status }, false), true);
    });
  }

  it("waits while the selected job is still running", () => {
    assert.equal(shouldRestartDarkRoundOnSelectedModel(487, { id: 487, status: "running" }, false), false);
    assert.equal(shouldRestartDarkRoundOnSelectedModel(487, { id: 487, status: "queued" }, false), false);
  });

  it("ignores a different job, no job, and an already restarted request", () => {
    assert.equal(shouldRestartDarkRoundOnSelectedModel(487, { id: 488, status: "completed" }, false), false);
    assert.equal(shouldRestartDarkRoundOnSelectedModel(487, null, false), false);
    assert.equal(shouldRestartDarkRoundOnSelectedModel(null, { id: 487, status: "completed" }, false), false);
    assert.equal(shouldRestartDarkRoundOnSelectedModel(487, { id: 487, status: "completed" }, true), false);
  });
});
