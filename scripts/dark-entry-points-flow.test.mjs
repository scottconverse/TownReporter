// guards: Today can hand a tip into the start dialog and a completed run can reopen its own file
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  React,
  createRoot,
  h,
  file,
  detail,
  Route,
} from "./dark-file-model-flow.harness.mjs";

function installStorage(values = []) {
  const kept = new Map(values);
  const storage = {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = storage;
  return {
    storage,
    restore() {
      if (previous === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = previous;
    },
  };
}

test("a Today tip handoff opens the start dialog without making a question", async () => {
  const handoff = installStorage([
    ["townreporter.dark.prefill", JSON.stringify({ tip: "Read the meeting minutes." })],
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(dialog.dataset.tip, "Read the meeting minutes.");
    assert.equal(dialog.dataset.question, "");
    assert.equal(handoff.storage.getItem("townreporter.dark.prefill"), null);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    handoff.restore();
  }
});

test("a completed run handoff opens that file instead of the newest file", async () => {
  const requested = { ...file, id: 2, title: "The completed run's file", updated_at: "2026-10-08T09:00:00Z" };
  const requestedDetail = {
    ...detail,
    investigation: { ...detail.investigation, ...requested },
  };
  globalThis.__darkFlow.fixtures.investigations = [file, requested];
  globalThis.__darkFlow.fixtures.details = { [file.id]: detail, [requested.id]: requestedDetail };
  const handoff = installStorage([["townreporter.dark.openId", String(requested.id)]]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    assert.equal(
      container.querySelector("#investigation-workspace .astra-question")?.textContent,
      requested.title,
    );
    assert.equal(handoff.storage.getItem("townreporter.dark.openId"), null);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    handoff.restore();
    globalThis.__darkFlow.fixtures.investigations = [file];
    globalThis.__darkFlow.fixtures.details = undefined;
  }
});
