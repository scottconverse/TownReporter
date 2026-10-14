// guards: Cancel in "Start a file" must not leave the dialog's model pick on the open file's "Digging model for this file"
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, Route } from "./dark-file-model-flow.harness.mjs";

const press = async (scope, words) => {
  const button = [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === words);
  assert.ok(button, `a button reading "${words}" should be on screen`);
  await React.act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
};

test("Cancel in Start a file puts the Digging model back; a file that opens keeps the pick", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const digging = () => container.querySelector("#investigation-workspace .model-picker-stub");
    const before = digging()?.dataset.value;
    assert.ok(before, "the open file should show its Digging model for this file");

    await press(container, "+ Start a file");
    await press(container.querySelector('[role="dialog"]'), "Pick Claude Sonnet");
    assert.equal(digging().dataset.value, "claude-sonnet", "while the dialog is open its pick shows on the page");

    await press(container.querySelector('[role="dialog"]'), "Cancel");
    assert.equal(container.querySelector('[role="dialog"]'), null, "Cancel shuts the dialog");
    assert.equal(digging().dataset.value, before, "Cancel puts Digging model for this file back to what it was");

    await press(container, "+ Start a file");
    await press(container.querySelector('[role="dialog"]'), "Pick Claude Sonnet");
    await press(container.querySelector('[role="dialog"]'), "Open the file");
    assert.equal(container.querySelector('[role="dialog"]'), null, "the start press shuts the dialog");
    await press(container, "+ Start a file");
    assert.equal(container.querySelector('[role="dialog"]').dataset.model, "claude-sonnet", "the start press keeps the model picked in the dialog");
    await press(container.querySelector('[role="dialog"]'), "Cancel");
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
