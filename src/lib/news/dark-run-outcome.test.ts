import assert from "node:assert/strict";
import test from "node:test";
import { darkRunOutcome } from "./dark-run-outcome.ts";

test("a failed synthesis is a failed run, while a finished dig is complete", () => {
  assert.equal(darkRunOutcome("synthesis-failed"), "failed");
  assert.equal(darkRunOutcome("completed"), "completed");
  assert.equal(darkRunOutcome("hop-limit"), "completed");
});
