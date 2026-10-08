// guards: a newer investigation must not be stranded behind an older file
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, file, Route } from "./dark-file-model-flow.harness.mjs";

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
