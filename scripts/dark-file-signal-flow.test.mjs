// guards: opening a signal must not fill the file with a model-written question or explanation
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, calls, Route } from "./dark-file-model-flow.harness.mjs";

test("a signal opens the file dialog with only its tip", async () => {
  calls.draft.length = 0;
  globalThis.__darkFlow.fixtures.investigations = [];
  globalThis.__darkFlow.fixtures.investigations = [];
  globalThis.__darkFlow.fixtures["worth-a-look"] = [{
    id: "signal:notice",
    kind: "notice",
    title: "A notice may be missing",
    happened: "The latest listing could not be found.",
    why: "The page may have changed.",
    evidence: "A saved listing link returned no result.",
    source_url: "https://example.test/notices",
    question: "Was a notice removed?",
    seed: "Check the saved notice page for a listing.",
    priority: 1,
  }];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const row = container.querySelector(".astra-signal-open");
    assert.ok(row, "the signal should be available in the rail");
    await React.act(async () => row.dispatchEvent(new window.Event("click", { bubbles: true })));
    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog, "choosing a signal should open the Start-a-file dialog");
    assert.equal(dialog.dataset.question, "");
    assert.equal(dialog.dataset.tip, "Check the saved notice page for a listing.");
    assert.equal(dialog.dataset.explanation, "");
    assert.deepEqual(calls.draft, [], "opening a signal should not ask an AI to draft its question");
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
