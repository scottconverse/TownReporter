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
