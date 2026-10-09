// guards: an editor could start an AI follow-up without the question the file is about
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, file, detail, Route } from "./dark-file-model-flow.harness.mjs";

test("starting an AI follow-up opens it with the file question", async () => {
  const fixtures = globalThis.__darkFlow.fixtures;
  fixtures.detail = undefined;
  fixtures.details = {};
  fixtures.pending = { investigation: true };
  const loadingContainer = document.createElement("div"); document.body.append(loadingContainer);
  const loadingRoot = createRoot(loadingContainer);
  await React.act(async () => loadingRoot.render(h(Route.component)));
  try {
    const loadingStart = [...loadingContainer.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start an AI follow-up");
    assert.ok(!loadingStart || loadingStart.disabled);
    assert.doesNotMatch(loadingContainer.textContent, /File 1/);
  } finally { await React.act(async () => loadingRoot.unmount()); loadingContainer.remove(); }

  fixtures.detail = detail;
  fixtures.pending = {};
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const start = [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start an AI follow-up");
    assert.ok(start);
    await React.act(async () => start.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.match(container.querySelector('[role="dialog"][aria-label="New AI follow-up"]')?.textContent ?? "", new RegExp(file.title));
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});

// guards: a notice from one file could mislead an editor about another file
test("file action notices clear when the editor opens another file", async () => {
  const first = { ...file, id: 1, title: "First file", updated_at: "2026-10-08T12:00:00Z" };
  const second = { ...file, id: 2, title: "Second file", updated_at: "2026-10-08T11:00:00Z" };
  const firstDetail = { ...detail, investigation: { ...detail.investigation, ...first }, artifacts: [{ id: 8, title: "Public record", url: "https://example.test/record" }], brief: { supports: ["A saved finding"], contradictions: [] } };
  globalThis.__darkFlow.fixtures.investigations = [first, second];
  globalThis.__darkFlow.fixtures.details = { 1: firstDetail, 2: { ...detail, investigation: { ...detail.investigation, ...second } } };
  globalThis.__darkFlow.fixtures.pending = {};
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  const press = async (name, within = container) => {
    const button = [...within.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === name);
    assert.ok(button, `missing ${name}`);
    await React.act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  };
  try {
    const actions = container.querySelector('[aria-label="File decisions"]');
    assert.deepEqual([...actions.querySelectorAll("button")].map((button) => button.textContent.trim()), [
      "Keep investigating", "Start an AI follow-up", "Wait and watch", "Send to the queue", "Close: no finding",
    ]);
    const challenge = [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === "Challenge the case");
    assert.equal(challenge?.dataset.tone, "ghost");
    await press("Start an AI follow-up");
    await press("Start follow-up", container.querySelector('[aria-label="New AI follow-up"]'));
    assert.match(container.textContent, /AI follow-up started/);
    await press("Wait and watch");
    await press("Start watching", container.querySelector('[role="dialog"]'));
    assert.match(container.textContent, /Watching 1 page/);
    await press("Challenge the case");
    assert.match(container.textContent, /Challenging the case/);
    const row = [...container.querySelectorAll(".astra-file-open")].find((button) => button.textContent.includes("Second file"));
    assert.ok(row);
    await React.act(async () => row.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(container.querySelector(".astra-question")?.textContent, "Second file");
    assert.doesNotMatch(container.textContent, /AI follow-up started|Watching 1 page|Challenging the case/);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});
