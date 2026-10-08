// guards: a file's chosen model could be silently replaced when the editor keeps investigating
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, calls, file, detail, Route } from "./dark-file-model-flow.harness.mjs";

test("the file model choice runs when the editor keeps investigating", async () => {
  calls.keep.length = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const workspace = container.querySelector("#investigation-workspace");
    assert.ok(workspace, "the most recent open file should be in the work area");
    const picker = workspace.querySelector(".model-picker-stub");
    assert.ok(picker, "the open file should have a model picker");
    assert.equal(picker.textContent.includes("Digging model"), true);
    assert.equal(picker.dataset.scope, "dark");
    assert.equal(picker.dataset.value, "codex-sol");
    assert.equal(picker.dataset.effort, "true");
    await React.act(async () => picker.querySelector("button").dispatchEvent(new window.Event("click", { bubbles: true })));
    const keep = [...workspace.querySelectorAll("button")].find((button) => button.textContent.trim() === "Keep investigating");
    assert.ok(keep);
    await React.act(async () => keep.dispatchEvent(new window.Event("click", { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls.keep, [{ id: 1, modelChoice: "claude-sonnet", modelEffort: null }]);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }

  detail.investigation.last_model_choice = null;
  const freshContainer = document.createElement("div");
  document.body.append(freshContainer);
  const freshRoot = createRoot(freshContainer);
  await React.act(async () => freshRoot.render(h(Route.component)));
  try {
    const picker = freshContainer.querySelector("#investigation-workspace .model-picker-stub");
    assert.equal(picker?.dataset.value, "claude-haiku", "a file with no prior choice starts on the Models default");
  } finally {
    await React.act(async () => freshRoot.unmount());
    freshContainer.remove();
  }
});
