/*
  DHE1-2: the Dark Desk "Start a file" dialog's "Digging model" and effort and
  the page's "Digging model" and effort are ONE state.

  WHAT IS REAL. `darkFileWithShared` from
  `src/components/dialogs/editor-dialog-forms.ts` is the function the dialog
  uses to decide what its picker shows. The page state is held the way
  `src/routes/desk.dark.tsx` holds it (`modelChoice` and `modelEffort`, with
  `onModelChoice` also resetting the effort to the model's default).

  WHAT IS STUBBED. The ModelPicker is a select pair that reports the props it
  is given. A change is driven through the element's own React `onChange`.

  THE CLAIM. Pick a model or an effort in the dialog, and the page panel shows
  it at once. Pick one in the page panel, and the dialog shows it at once.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
const { act } = React;

const { darkFileWithShared } = await import(
  await moduleUrl("src/components/dialogs/editor-dialog-forms.ts", {
    "@/lib/news/provider-registry": stubUrl(`
      export function defaultModelEffort(choice) {
        return choice === "codex-sol-6-1" ? "medium" : null;
      }
    `),
  })
);
const { createElement: h, useState } = React;

/* The stand-in for ModelPicker, as in batch-model-choice.test.mjs. */
function ModelPicker(props) {
  return h("div", { "data-stub-picker": props.label },
    h("select", {
      "aria-label": `${props.label} model`,
      value: props.value,
      onChange: (event) => props.onChange(event.target.value),
    },
      h("option", { value: "auto" }, "Automatic"),
      h("option", { value: "codex-sol-6-1" }, "Codex Sol 6.1"),
    ),
    h("select", {
      "aria-label": `${props.label} effort`,
      value: props.effort ?? "",
      onChange: (event) => props.onEffortChange(event.target.value || null),
    },
      h("option", { value: "" }, "Provider default"),
      h("option", { value: "low" }, "Low"),
      h("option", { value: "medium" }, "Medium"),
      h("option", { value: "high" }, "High"),
    ),
  );
}

/*
  The page and its dialog, wired as desk.dark.tsx wires them: one pair of
  state values, the dialog's view read through darkFileWithShared, and the
  dialog's own state never drawn.
*/
let lastPage = null;
function DarkPage() {
  const [modelChoice, setModelChoice] = useState("auto");
  const [modelEffort, setModelEffort] = useState(null);
  const shared = {
    model: modelChoice,
    effort: modelEffort,
    onModelChoice: (choice) => {
      setModelChoice(choice);
      setModelEffort(choice === "codex-sol-6-1" ? "medium" : null);
    },
    onModelEffort: setModelEffort,
  };
  const dialogView = darkFileWithShared({ model: "auto", effort: null }, shared);
  lastPage = { modelChoice, modelEffort };
  return h("div", null,
    h("section", { "data-surface": "dialog" },
      h(ModelPicker, {
        label: "Dialog digging model",
        value: dialogView.model,
        effort: dialogView.effort,
        onChange: shared.onModelChoice,
        onEffortChange: shared.onModelEffort,
      }),
    ),
    h("section", { "data-surface": "page" },
      h(ModelPicker, {
        label: "Page digging model",
        value: modelChoice,
        effort: modelEffort,
        onChange: shared.onModelChoice,
        onEffortChange: shared.onModelEffort,
      }),
    ),
  );
}

function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(h(DarkPage)));
  const select = (surface, name) =>
    container.querySelector(`[data-surface="${surface}"] select[aria-label="${name}"]`);
  return { container, root, select };
}

/* Drive a change the way React would: call the element's own onChange. */
function changeSelect(element, value) {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
  act(() => {
    element[propsKey].onChange({ target: { value } });
  });
}

test("DHE1-2: a model picked in the dialog shows in the page panel, and its effort too", () => {
  const { root, select } = mountPage();
  try {
    changeSelect(select("dialog", "Dialog digging model model"), "codex-sol-6-1");
    assert.equal(select("page", "Page digging model model").value, "codex-sol-6-1");
    assert.equal(select("page", "Page digging model effort").value, "medium");
    assert.equal(select("dialog", "Dialog digging model effort").value, "medium");
  } finally {
    act(() => root.unmount());
  }
});

test("DHE1-2: an effort picked in the page panel shows in the dialog at once", () => {
  const { root, select } = mountPage();
  try {
    changeSelect(select("page", "Page digging model effort"), "low");
    assert.equal(select("dialog", "Dialog digging model effort").value, "low");
    assert.equal(lastPage.modelEffort, "low");
  } finally {
    act(() => root.unmount());
  }
});
