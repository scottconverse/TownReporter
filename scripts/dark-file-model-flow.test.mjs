// guards: a file's chosen model could be silently replaced when the editor keeps investigating
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, calls, detail, Route } from "./dark-file-model-flow.harness.mjs";

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
    // The file runs with the effort the shared page shows after the pick: the model's default (DHE1-2).
    assert.deepEqual(calls.keep, [{ id: 1, modelChoice: "claude-sonnet", modelEffort: "medium", modelChoiceExplicit: true }]);
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


test("Retry sends the file picker's model to a stopped round", async () => {
  calls.retry.length = 0;
  globalThis.__darkFlow.fixtures.jobs = [{
    id: 486,
    kind: "dark",
    subjectId: 1,
    status: "failed",
    error: "Cancelled by the editor",
    stageIndex: 0,
    step: "",
    doneText: "Could not finish",
    cancelRequested: false,
  }];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const workspace = container.querySelector("#investigation-workspace");
    const deepSeek = [...workspace.querySelectorAll("button")]
      .find((button) => button.textContent === "Choose DeepSeek");
    assert.ok(deepSeek);
    await React.act(async () => deepSeek.dispatchEvent(new window.Event("click", { bubbles: true })));
    const retry = [...workspace.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Retry");
    assert.ok(retry);
    await React.act(async () => retry.dispatchEvent(new window.Event("click", { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls.retry, [{
      jobId: 486,
      nextModel: false,
      modelChoice: "deepseek-flash",
      modelEffort: "none",
      modelChoiceExplicit: true,
    }]);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    delete globalThis.__darkFlow.fixtures.jobs;
  }
});


test("Keep investigating starts on the picker model after a stopped job settles", async () => {
  calls.keep.length = 0;
  detail.investigation.status = "investigating";
  detail.darkJob = { id: 486, status: "failed", stage: "Cancelled", error: "Cancelled by the editor" };
  globalThis.__darkFlow.fixtures.jobs = [{
    id: 486,
    kind: "dark",
    subjectId: 1,
    status: "failed",
    error: "Cancelled by the editor",
    stageIndex: 0,
    step: "",
    doneText: "Could not finish",
    cancelRequested: false,
  }];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const workspace = container.querySelector("#investigation-workspace");
    const deepSeek = [...workspace.querySelectorAll("button")]
      .find((button) => button.textContent === "Choose DeepSeek");
    assert.ok(deepSeek);
    await React.act(async () => deepSeek.dispatchEvent(new window.Event("click", { bubbles: true })));
    const keep = [...workspace.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Keep investigating");
    assert.ok(keep, [...workspace.querySelectorAll("button")].map((button) => button.textContent).join(" | "));
    assert.equal(keep.disabled, false, "a settled stopped job must not leave Keep disabled");
    await React.act(async () => keep.dispatchEvent(new window.Event("click", { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls.keep, [{
      id: 1,
      modelChoice: "deepseek-flash",
      modelEffort: "none",
      modelChoiceExplicit: true,
    }]);
  } finally {
    detail.investigation.status = "open";
    delete detail.darkJob;
    await React.act(async () => root.unmount());
    container.remove();
    delete globalThis.__darkFlow.fixtures.jobs;
  }
});
