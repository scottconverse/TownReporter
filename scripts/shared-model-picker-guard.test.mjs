import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { LocalModelSelect, ModelPicker, availabilityStub, registry } from "./model-picker-render.harness.mjs";

const pickerScopes = ["story", "scan", "follow-up", "opinion", "dark", "ocr", "forced"];

const fullSharedList = [
  ...new Map(
    pickerScopes
      .flatMap((scope) => registry.providersFor(scope))
      .map((entry) => [entry.id, entry]),
  ).values(),
];

function renderedChoices(scope) {
  availabilityStub.__setAvailability(
    Object.fromEntries(registry.PICKER_PROVIDER_IDS.map((id) => [id, true])),
  );
  const html = renderToStaticMarkup(
    createElement(ModelPicker, {
      scope,
      value: "auto",
      onChange() {},
      effort: null,
      onEffortChange() {},
    }),
  );
  const { document } = parseHTML(html);
  assert.equal(
    document.querySelector('[data-model-picker="shared"]')?.getAttribute("data-model-picker"),
    "shared",
    `${scope} must render the shared ModelPicker component`,
  );
  const select = document.querySelector('.model-picker select[aria-describedby]');
  assert.ok(select, `${scope} must render a model choice using the shared picker`);
  assert.ok(
    [...document.querySelectorAll("label")].some((label) => label.textContent.trim() === "Thinking effort"),
    `${scope} must keep the shared effort control`,
  );
  return [...select.querySelectorAll("option")].map((option) => ({
    value: option.getAttribute("value"),
    label: option.textContent.trim(),
  }));
}

test("all rendered AI model pickers use the shared full option list", () => {
  const expected = [
    { value: "auto", label: "Automatic" },
    ...fullSharedList.map((entry) => ({ value: entry.id, label: entry.label })),
  ];

  for (const scope of pickerScopes) {
    const choices = renderedChoices(scope);
    assert.deepEqual(
      choices.map(({ value }) => value),
      expected.map(({ value }) => value),
      `${scope} must offer the complete shared model list`,
    );
    assert.deepEqual(
      choices.map(({ label }) => label.replace(/\s+[—·]\s+.*$/, "")),
      expected.map(({ label }) => label),
      `${scope} must use the shared model names`,
    );
  }
});

test("daily scan and other local-model selectors share Use whatever is loaded and the full catalog", () => {
  const catalog = {
    servers: [
      {
        kind: "lmstudio",
        baseUrl: "http://127.0.0.1:1234/v1",
        reachable: true,
        models: [
          { id: "halo/qwen3.8:27b-q6_K", loaded: true, thinking: false, vision: false, cloud: false, contextLength: null },
        ],
      },
      {
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        reachable: true,
        models: [
          { id: "deepseek-v4.1-flash:cloud", loaded: true, thinking: false, vision: false, cloud: true, contextLength: 128_000 },
        ],
      },
    ],
    defaultModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "halo/qwen3.8:27b-q6_K" },
    checkedAt: 1,
  };
  availabilityStub.__setRole("owner");
  availabilityStub.__setLocalChoice({
    override: null,
    storedPick: { baseUrl: "*", id: "*" },
    source: "loaded",
    notice: null,
    catalog,
  });

  let shared;
  for (const scope of pickerScopes) {
    const html = renderToStaticMarkup(createElement(LocalModelSelect, { scope }));
    const { document } = parseHTML(html);
    const select = document.querySelector(".local-model-picker select");
    assert.ok(select, `${scope} must render the shared local model selector`);
    const choices = [...select.querySelectorAll("option")].map((option) => ({
      value: option.getAttribute("value"),
      label: option.textContent.trim(),
    }));
    assert.ok(
      choices.some(({ value, label }) => value === "* *" && label === "Use whatever model is loaded (recommended)"),
      `${scope} must preserve the loaded-model choice`,
    );
    assert.ok(choices.some(({ value }) => value?.includes("halo/qwen3.8:27b-q6_K")));
    assert.ok(choices.some(({ value }) => value?.includes("deepseek-v4.1-flash:cloud")));
    if (!shared) shared = choices;
    else assert.deepEqual(choices, shared, `${scope} must show the same full local catalog`);
  }

  availabilityStub.__setLocalChoice({
    override: null,
    storedPick: null,
    source: "stored",
    notice: null,
    catalog: { servers: [], defaultModel: null, checkedAt: 0 },
  });
});
