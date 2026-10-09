// guards: the editor can open and close Settings above the rail and file
import assert from "node:assert/strict";
import { test } from "node:test";
import { React, createRoot, h, window, file, detail, Route } from "./dark-file-model-flow.harness.mjs";

test("Settings opens above the rail and closes from the work area", async () => {
  globalThis.__darkFlow.fixtures.investigations = [file];
  globalThis.__darkFlow.fixtures["worth-a-look"] = [];
  globalThis.__darkFlow.fixtures.details = { [file.id]: { ...detail, investigation: file } };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(h(Route.component)));
  try {
    const settings = container.querySelector("#dark-settings");
    const railAndFile = container.querySelector(".astra-split-deep");
    assert.ok(settings && railAndFile);
    assert.equal(settings.parentElement, railAndFile.parentElement);
    const siblings = [...settings.parentElement.children];
    assert.ok(siblings.indexOf(settings) < siblings.indexOf(railAndFile));
    assert.equal(settings.hidden, true);
    await React.act(async () => container.querySelector(".astra-head-acts button")?.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(settings.hidden, false);
    await React.act(async () => settings.querySelector("button")?.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(settings.hidden, true);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
