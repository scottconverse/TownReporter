/*
  DHE1-2 (Release H, walk H): the Dark Desk's "Digging model" and the "Model for
  page watches" picker are DIFFERENT jobs. A Digging pick must not move the
  page-watch picker, and a page-watch pick must not move Digging.

  WHAT IS REAL. `PageWatchPanel` from src/components/page-watch-panel.tsx, and
  the real `ModelPicker` (through the picker render harness). Only the data
  hooks are stubbed, so the panel mounts with no watch open.

  WHAT IS HELD THE WAY DESK.DARK.TSX HOLDS IT. One Digging `model` state that
  the "Start a file" dialog's picker reads and writes. Walk H's route also
  handed that state to the panel (`modelDefault`, `onModelPick`); the test
  still hands it over, so a panel that follows it again fails here.
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

test("DHE1-2: a Digging pick does not move the page-watch picker, and back", () => {
  availabilityStub.__setAvailability(Object.fromEntries(["codex-luna", "auto", "local-model"].map((id) => [id, true])));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(h(DarkPageAndDialog)));
  const modelSelect = (surface) => container.querySelector(`[data-surface="${surface}"] select`);
  try {
    assert.equal(modelSelect("dialog").value, "codex-luna", "the dialog starts on the Digging model");
    const watchStart = modelSelect("page").value;

    changeSelect(modelSelect("dialog"), "local-model");
    assert.equal(modelSelect("dialog").value, "local-model", "the Digging pick shows in the dialog");
    assert.equal(modelSelect("page").value, watchStart, "the page-watch picker keeps its own value");

    changeSelect(modelSelect("page"), "codex-luna");
    assert.equal(modelSelect("page").value, "codex-luna", "a page-watch pick shows in its own picker");
    assert.equal(modelSelect("dialog").value, "local-model", "and does not move the Digging model");
  } finally {
    act(() => root.unmount());
  }
});
