import assert from "node:assert/strict";
import { it } from "node:test";
import { darkRunStopCopy } from "./dark-run-copy.ts";

it("keeps a separate output-limit failure visible beside an unreachable synthesis stop", () => {
  const copy = darkRunStopCopy(
    "Local model (halo/qwen3.8-27b-q6-fast) is unreachable. Check that it is running and that this machine is online.",
    "Synthesis: Local model (halo/qwen3.8-27b-q6-fast) is unreachable. Brief: Local model: Provider says: reply was cut off because the output token limit was reached (finish reason: length).",
  );
  assert.match(copy, /Synthesis stopped because the local server could not be reached/i);
  assert.match(copy, /Separately, the brief reply was cut off at the output token limit/i);
  assert.match(copy, /increase the model.s output limit|write a shorter brief/i);
  assert.doesNotMatch(copy, /reply was cut off.*unreachable/i);
});
