// guards: a newer investigation must not be stranded behind an older file
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, file, detail, Route } from "./dark-file-model-flow.harness.mjs";

function fileDetail(row) {
  return {
    investigation: { ...row, ordinary_explanation: "", scope_json: '{"scope":"city"}', budget: 5, hops: 0, last_model_choice: "codex-sol", pause_reason: null },
    artifacts: [], claims: [], hypotheses: [], searches: [], frontier: [], deadEnds: [], anomalies: [], entities: [], signals: [], sourceCaptures: [], investigationFollowUps: [], captureCounts: { captures: 0, readable: 0, unreadable: 0 },
  };
}

test("the newest file opens and the empty desk hides its rail", async () => {
  const older = { ...file, id: 1, title: "Older open file", status: "open", updated_at: "2026-10-07T10:00:00Z" };
  const newest = { ...file, id: 2, title: "Newest running file", status: "investigating", updated_at: "2026-10-08T12:00:00Z" };
  globalThis.__darkFlow.fixtures.investigations = [older, newest];
  globalThis.__darkFlow.fixtures.details = { 1: fileDetail(older), 2: fileDetail(newest) };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const workspace = container.querySelector("#investigation-workspace");
    assert.ok(workspace, "a file should open after the list loads");
    assert.equal(workspace.querySelector(".astra-question")?.textContent, newest.title);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }

  globalThis.__darkFlow.fixtures.investigations = [];
  globalThis.__darkFlow.fixtures.details = {};
  const emptyContainer = document.createElement("div");
  document.body.append(emptyContainer);
  const emptyRoot = createRoot(emptyContainer);
  await React.act(async () => emptyRoot.render(h(Route.component)));
  try {
    assert.equal(emptyContainer.querySelector(".astra-piles")?.hidden, true, "the rail should be hidden when there are no files");
    const empty = emptyContainer.querySelector('[aria-label="No investigations"]');
    assert.ok(empty, "the work area should explain that the desk has no investigations");
    assert.equal(empty.querySelectorAll("button").length, 2, "the empty state should offer a primary start action and a signals check");
  } finally {
    await React.act(async () => emptyRoot.unmount());
    emptyContainer.remove();
  }
});

// guards: a slow or failed investigation read could leave the editor with a blank, misleading desk
test("the file area explains loading and offers a safe retry after a failed list read", async () => {
  const fixtures = globalThis.__darkFlow.fixtures;
  fixtures.investigations = undefined;
  fixtures.pending = { investigations: true };
  fixtures.errors = {};
  const loading = document.createElement("div"); document.body.append(loading);
  const loadingRoot = createRoot(loading);
  await React.act(async () => loadingRoot.render(h(Route.component)));
  try {
    assert.ok(loading.querySelector(".list-skeleton"));
    assert.match(loading.textContent, /Loading the file…/);
    assert.doesNotMatch(loading.textContent, /Open files\s*0/);
  } finally { await React.act(async () => loadingRoot.unmount()); loading.remove(); }

  fixtures.pending = {};
  fixtures.errors = { investigations: new Error("Internal Server Error 503") };
  const failed = document.createElement("div"); document.body.append(failed);
  const failedRoot = createRoot(failed);
  await React.act(async () => failedRoot.render(h(Route.component)));
  try {
    assert.match(failed.textContent, /Could not load Dark Desk/);
    assert.match(failed.textContent, /The page could not be read/);
    assert.ok([...failed.querySelectorAll("a")].some((link) => link.textContent === "Open Server health" && link.getAttribute("href") === "/desk/ops"));
    const retry = [...failed.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    assert.ok(retry);
    await React.act(async () => retry.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(globalThis.__darkFlow.calls.refetch, 1);
    assert.doesNotMatch(failed.textContent, /\["investigations"\]|Internal Server Error/);
  } finally { await React.act(async () => failedRoot.unmount()); failed.remove(); }
});

// guards: a failed activity read could be mistaken for a genuinely empty log
test("an activity read failure names the problem and can be retried", async () => {
  globalThis.__darkFlow.calls.refetch = 0;
  const fixtures = globalThis.__darkFlow.fixtures;
  fixtures.investigations = [file];
  fixtures.detail = detail;
  fixtures.details = { [file.id]: detail };
  fixtures.pending = {};
  fixtures.errors = { "investigation-activity": new Error("Internal Server Error 503") };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const activity = container.querySelector(".astra-pair > div");
    assert.match(activity?.textContent ?? "", /Could not load the activity/);
    assert.doesNotMatch(activity?.textContent ?? "", /No activity recorded yet/);
    const retry = [...(activity?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Try again");
    assert.ok(retry);
    await React.act(async () => retry.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(globalThis.__darkFlow.calls.refetch, 1);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});
