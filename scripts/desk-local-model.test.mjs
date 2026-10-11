import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileToUrl } from "./dom-harness.mjs";
const helper = transpileToUrl(
  await readFile(new URL("../src/lib/news/desk-local-model.ts", import.meta.url), "utf8"),
  "desk-local-model.ts",
);
const component = transpileToUrl(
  await readFile(new URL("../src/components/desk-local-model.tsx", import.meta.url), "utf8"),
  "desk-local-model.tsx",
  { "@/lib/news/desk-local-model": helper },
);
const { DeskLocalModelBox } = await import(component);
const choice = {
  override: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
  storedPick: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
  notice: null,
  catalog: { servers: [], defaultModel: null, checkedAt: 0 },
};
describe("the Models page local model box", () => {
  it("lets editors read the actual model and cost with no change controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(DeskLocalModelBox, {
        isOwner: false,
        choice,
        pending: false,
        onUseLoaded: () => assert.fail("editor cannot save"),
      }),
    );
    assert.match(html, /Only the owner can change this\./);
    assert.match(html, /deepseek-v4.1-flash:cloud on Ollama Cloud/);
    assert.match(html, /not this computer, spends credits/);
    assert.doesNotMatch(html, /<input/);
  });
  it("offers the owner both plain choices without sending a request on render", () => {
    const html = renderToStaticMarkup(
      React.createElement(DeskLocalModelBox, {
        isOwner: true,
        choice,
        pending: false,
        onUseLoaded: () => assert.fail("render must not save"),
      }),
    );
    assert.equal((html.match(/type="radio"/g) || []).length, 2);
    assert.match(html, /Use whatever model is loaded \(recommended\)/);
    assert.match(html, /Always use one model/);
    assert.match(html, /Press Use this one/);
  });
});

it("the story selector offers the saved sentinel first even with no server, without a cloud fallback", async () => {
  const { LocalModelSelect, availabilityStub } = await import("./model-picker-render.harness.mjs");
  availabilityStub.__setRole("owner");
  availabilityStub.__setLocalChoice({
    override: null,
    storedPick: { baseUrl: "*", id: "*" },
    source: "loaded",
    notice: null,
    catalog: {
      servers: [],
      defaultModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
      checkedAt: 0,
    },
  });
  const html = renderToStaticMarkup(React.createElement(LocalModelSelect, { scope: "story" }));
  assert.match(
    html,
    /<option value="\* \*" selected="">Use whatever model is loaded \(recommended\)<\/option>/,
  );
  assert.doesNotMatch(html, /deepseek-v4.1-flash/);
});
