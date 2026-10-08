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
    assert.equal(loadingStart?.disabled, true);
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
    assert.equal(container.querySelector('[role="dialog"][aria-label="New AI follow-up"]')?.textContent, file.title);
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});
