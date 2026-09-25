import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";

const editorialSource = readFileSync(
  fileURLToPath(new URL("./editorial.server.ts", import.meta.url)),
  "utf8",
);

test("Story enqueue retains the editor request beside a preflight destination", () => {
  assert.deepEqual(initialModelRuntimeReceipt({
    requestedRuntime: "custom:story",
    requestedEffort: "none",
    actualRuntime: "codex-frontier",
    actualEffort: "medium",
    preflightFailover: { reason: "unavailable" },
  }), {
    requestedRuntime: "custom:story",
    requestedEffort: "none",
    actualRuntime: "codex-frontier",
    modelEffort: "medium",
    preflightFailover: { reason: "unavailable" },
  });
});

test("Dark enqueue retains Automatic separately from its pinned runtime", () => {
  const receipt = initialModelRuntimeReceipt({
    requestedRuntime: "auto",
    requestedEffort: "high",
    actualRuntime: "claude-sonnet",
    actualEffort: "high",
  });
  assert.equal(receipt.requestedRuntime, "auto");
  assert.equal(receipt.actualRuntime, "claude-sonnet");
});

test("Opinion enqueue retains the original effort when the destination revalidates it", () => {
  const receipt = initialModelRuntimeReceipt({
    requestedRuntime: "custom:opinion",
    requestedEffort: "none",
    actualRuntime: "claude-sonnet",
    actualEffort: "medium",
  });
  assert.equal(receipt.requestedEffort, "none");
  assert.equal(receipt.modelEffort, "medium");
});

test("a local-model job receipt pins the endpoint and model that preflight approved", () => {
  assert.deepEqual(initialModelRuntimeReceipt({
    requestedRuntime: "local-model",
    requestedEffort: "none",
    actualRuntime: "local-model",
    actualEffort: "none",
    localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "glm-5.2:cloud" },
  }), {
    requestedRuntime: "local-model",
    requestedEffort: "none",
    actualRuntime: "local-model",
    modelEffort: "none",
    localModelSnapshotVersion: 1,
    localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "glm-5.2:cloud" },
    preflightFailover: null,
  });
});

/*
  Unit Y item 2: the reason a rung was passed over belongs to the job, not to
  a log line. A receipt that says only "codex-balanced" cannot tell a skipped
  rung apart from one that was never in the ladder.
*/
test("a job receipt records the rungs Automatic passed over, and omits the key when none were", () => {
  const skipped = initialModelRuntimeReceipt({
    requestedRuntime: "auto",
    requestedEffort: null,
    actualRuntime: "codex-balanced",
    actualEffort: null,
    skippedRungs: ["Qwen 3.6 35B skipped: not loaded"],
  });
  assert.deepEqual(skipped.skippedRungs, ["Qwen 3.6 35B skipped: not loaded"]);
  assert.equal(skipped.actualRuntime, "codex-balanced");

  const clean = initialModelRuntimeReceipt({
    requestedRuntime: "auto",
    requestedEffort: null,
    actualRuntime: "deepseek-flash",
    actualEffort: null,
  });
  assert.equal("skippedRungs" in clean, false);

  // The caller may hand it a null meaning "nothing to say"; the key must not
  // appear as an empty array either, or every ordinary receipt grows a field
  // that says nothing.
  assert.equal(
    "skippedRungs" in
      initialModelRuntimeReceipt({
        requestedRuntime: "auto",
        requestedEffort: null,
        actualRuntime: "deepseek-flash",
        actualEffort: null,
        skippedRungs: null,
      }),
    false,
  );
});

test("Opinion's first document-stage switch records the immutable request and document attribution", () => {
  assert.match(
    editorialSource,
    /setJobModelRuntime\(\s*job\.id,\s*nextChoice,\s*nextEffort,\s*requestedChoice,\s*requestedEffort,\s*"documents"/s,
  );
});

test("Opinion keeps writer and checker runtime attribution separate", () => {
  assert.match(editorialSource, /requestedEffort,\s*"writer",\s*\);/s);
  assert.match(editorialSource, /requestedEffort,\s*"checker",\s*\);/s);
  const checkerSwitch = editorialSource.slice(
    editorialSource.indexOf("const recordNameSwitch"),
    editorialSource.indexOf("const nameChat"),
  );
  assert.doesNotMatch(checkerSwitch, /update editorial_requests set model_choice/);
});
