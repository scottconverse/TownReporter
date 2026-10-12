/*
  DHE1-2 (Release H, walk G): the Dark Desk's page-watch picker and the "Start a
  file" dialog's picker are views over ONE dark model.

  WHAT IS REAL. `PageWatchPanel` from src/components/page-watch-panel.tsx, and
  the real `ModelPicker` (through the picker render harness). Only the data
  hooks are stubbed, so the panel mounts with no watch open.

  WHAT IS HELD THE WAY DESK.DARK.TSX HOLDS IT. One `model` state. The panel gets
  `modelDefault={model}` and `onModelPick={setModel}`; the dialog's picker gets
  `value={model}` and `onChange={setModel}`.

  THE CLAIM. Change the page-watch picker and the dialog's picker shows it at
  once. Change the dialog's picker and the page-watch picker shows it at once.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { installDom, stubUrl } from "./dom-harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";
import { ModelPicker, availabilityStub, modelPickerUrl } from "./model-picker-render.harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { createElement: h, useState } = React;

const { PageWatchPanel } = await import(
  await screenModuleUrl(
    "src/components/page-watch-panel.tsx",
    {
      useQuery: `()=>({data:undefined,isPending:false,isError:false})`,
      useMutation: `()=>({mutate(){},isPending:false})`,
      useQueryClient: `()=>({invalidateQueries(){}})`,
    },
    [],
    { imports: { "./model-picker": modelPickerUrl, "./desk-chrome": stubUrl("export const InkButton=()=>null;") } },
  ),
);

/* The page's model state and the dialog's picker, wired as desk.dark.tsx wires them. */
function DarkPageAndDialog() {
  const [model, setModel] = useState("codex-luna");
  return h(
    "div",
    null,
    h(
      "section",
      { "data-surface": "dialog" },
      h(ModelPicker, {
        scope: "dark",
        label: "Start a file model",
        layout: "stacked",
        value: model,
        effort: null,
        onChange: setModel,
        onEffortChange: () => {},
      }),
    ),
    h(
      "section",
      { "data-surface": "page" },
      h(PageWatchPanel, { files: [], onOpenFile: () => {}, modelDefault: model, onModelPick: setModel }),
    ),
  );
}

/* Drive a change the way React would: call the element's own onChange. */
function changeSelect(element, value) {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
  act(() => {
    element[propsKey].onChange({ target: { value } });
  });
}

test("DHE1-2: a model picked in the page-watch picker shows in the dialog's picker, and back", () => {
  availabilityStub.__setAvailability(Object.fromEntries(["codex-luna", "auto", "local-model"].map((id) => [id, true])));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(h(DarkPageAndDialog)));
  const modelSelect = (surface) => container.querySelector(`[data-surface="${surface}"] select`);
  try {
    assert.equal(modelSelect("dialog").value, "codex-luna", "the dialog starts on the shared model");
    assert.equal(modelSelect("page").value, "codex-luna", "the page-watch picker starts on the same model");

    changeSelect(modelSelect("page"), "local-model");
    assert.equal(modelSelect("dialog").value, "local-model", "a page-watch pick shows in the dialog");

    changeSelect(modelSelect("dialog"), "auto");
    assert.equal(modelSelect("page").value, "auto", "a dialog pick shows in the page-watch picker");
  } finally {
    act(() => root.unmount());
  }
});
