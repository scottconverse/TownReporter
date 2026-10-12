import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { ModelPicker, availabilityStub } from "./model-picker-render.harness.mjs";

const { __setConnections, __setConnectionsPending, __setLocalChoice } = availabilityStub;

const geminiKeyConnection = {
  id: "gemini-key",
  name: "Gemini Pro (API key)",
  modelId: "gemini-pro-fixture",
  enabled: true,
};
const local = { baseUrl: "http://127.0.0.1:11434", id: "deepseek-v4.1-flash:cloud" };
const catalog = (loaded) => ({
  servers: [
    {
      kind: "ollama",
      baseUrl: local.baseUrl,
      reachable: true,
      status: "running",
      models: [{ id: local.id, loaded, cloud: true }],
    },
  ],
  defaultModel: local,
  checkedAt: 1,
});

function renderPicker(props) {
  availabilityStub.__setAvailability({});
  const html = renderToStaticMarkup(
    createElement(ModelPicker, { value: "auto", onChange() {}, scope: "opinion", ...props }),
  );
  return parseHTML(html).document;
}

test("DHE1-1: while saved API connections are loading, the writing model list says so instead of silently dropping the Gemini key line", () => {
  __setConnections([geminiKeyConnection]);
  __setConnectionsPending(true);
  try {
    const doc = renderPicker({});
    const loading = [...doc.querySelectorAll("select option")].find((option) =>
      /Saved API connections.*loading/.test(option.textContent),
    );
    assert.ok(loading, "the pending connections query shows a loading option in the list");
    assert.equal(loading.hasAttribute("disabled"), true, "the loading line is not a choosable model");
  } finally {
    __setConnectionsPending(false);
  }
});

test("DHE1-1: once saved API connections arrive, the Opinion list carries the Gemini key line and no loading line", () => {
  __setConnections([geminiKeyConnection]);
  __setConnectionsPending(false);
  const doc = renderPicker({});
  const gemini = doc.querySelector('select option[value="custom:gemini-key"]');
  assert.ok(gemini, "the saved Gemini key connection is a listed option");
  assert.equal(
    [...doc.querySelectorAll("select option")].some((option) => /loading/.test(option.textContent)),
    false,
  );
});

test("DHE1-11: the Local option is named by its model, and the backend status is printed once beside the picker", () => {
  __setConnections([]);
  __setConnectionsPending(false);
  __setLocalChoice({ override: local, catalog: catalog(false) });
  const doc = renderPicker({ value: "local-model" });
  const localOption = doc.querySelector('select option[value="local-model"]');
  assert.equal(localOption.textContent, local.id, "the option label is the model name");
  assert.doesNotMatch(localOption.textContent, /spends credits|not checked/, "the option list carries no backend status");
  const status = [...doc.querySelectorAll("span.model-picker-help")].map((span) => span.textContent);
  assert.ok(
    status.includes("Local model — deepseek-v4.1-flash:cloud · cloud · spends credits"),
    "the backend status sits beside the picker",
  );
});

test("DHE1-11: with no backend checked yet, the status still says so, once, beside the picker", () => {
  __setConnections([]);
  __setConnectionsPending(false);
  __setLocalChoice({ override: null, catalog: { servers: [], defaultModel: null, checkedAt: 1 } });
  const doc = renderPicker({ value: "local-model" });
  const localOption = doc.querySelector('select option[value="local-model"]');
  assert.equal(localOption.textContent, "Local model", "the option label falls back to the plain name");
  assert.equal(
    [...doc.querySelectorAll("span.model-picker-help")].some((span) => span.textContent === "Local model — backend not checked yet"),
    true,
    "the not-checked status sits beside the picker",
  );
});
