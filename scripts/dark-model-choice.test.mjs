/*
  DHE1-2: the Dark Desk's "Digging model" and effort are ONE state. The page's
  dials panel, the open file's "Digging model for this file" picker and the
  "Start a file" dialog (its `shared` prop) all read one model and one effort.

  WHAT IS REAL. The state is `useDarkModelChoice` from
  `src/components/dark-model-choice.ts`, the hook the Dark Desk route calls. It
  is mounted with react-dom/client in the in-process DOM from
  `scripts/dom-harness.mjs`, next to THREE pickers wired the way the route
  wires them: the dials panel, the open file's picker, and the dialog's shared
  picker (`darkFileWithShared` is the real function the dialog draws with).

  WHAT IS STUBBED. The real `ModelPicker` needs a query client and the server
  functions behind its option list; its stand-in is a select pair that reports
  the props it is given. A change is driven by calling the element's own React
  `onChange`, because linkedom has no default action for a select.

  THE CLAIM. Pick a model or an effort in any one of the three, and the other
  two show the same model and the same effort at once. The dialog's Start press
  sends the model and effort the page shows.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { installDom, moduleUrl, noJobModelAssignmentUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
const { useDarkModelChoice } = await import(
  await moduleUrl("src/components/dark-model-choice.ts", {
    "@/components/use-job-model-assignment": noJobModelAssignmentUrl,
    "@/lib/news/model-choice": await moduleUrl("src/lib/news/model-choice.ts"),
    "@/lib/news/provider-registry": await moduleUrl("src/lib/news/provider-registry.ts"),
  })
);
const { darkFileWithShared, darkFileInitial } = await import(
  await moduleUrl("src/components/dialogs/editor-dialog-forms.ts", {
    "@/components/use-job-model-assignment": noJobModelAssignmentUrl,
  })
);
const { createElement: h } = React;
const runs = [];

/*
  The stand-in for ModelPicker: a select pair that reports the props it is
  given. It is local, so it shares this file's React instance.
*/
function ModelPicker(props) {
  return h("div", { "data-stub-picker": props.label },
    h("select", {
      "aria-label": props.label,
      value: props.value,
      onChange: (event) => props.onChange(event.target.value),
    },
      h("option", { value: "auto" }, "Automatic"),
      h("option", { value: "codex-sol-6-1" }, "Codex Sol 6.1"),
    ),
    h("select", {
      "aria-label": "Thinking effort",
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
  The Dark Desk's shape: the page's dials panel, the open file's picker, and
  the "Start a file" dialog's shared picker, all over the page's one state.
*/
function DarkDeskControls() {
  const dark = useDarkModelChoice();
  runs.push({ model: dark.model, effort: dark.effort });
  const dialogState = darkFileWithShared(darkFileInitial(), { model: dark.model, effort: dark.effort });
  const picker = (surface, label, value, onChange, effort, onEffortChange) =>
    h(
      "section",
      { "data-surface": surface },
      h(ModelPicker, { scope: "dark", label, value, onChange, effort, onEffortChange }),
    );
  return h("div", null,
    picker("dials", "Digging model", dark.model, dark.pick, dark.effort, dark.setEffort),
    picker("file", "Digging model for this file", dark.model, dark.pick, dark.effort, dark.setEffort),
    picker("dialog", "Digging model", dialogState.model, dark.pick, dialogState.effort, dark.setEffort),
  );
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

/* Read the two selects a picker renders: [model, effort]. */
function selectsOf(container, surface) {
  const section = container.querySelector(`[data-surface="${surface}"]`);
  const [model, effort] = section.querySelectorAll("select");
  return { model: model.value, effort: effort.value };
}

/* Drive a change the way React would: call the element's own onChange. */
async function changeSelect(element, value) {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
  await React.act(async () => {
    element[propsKey].onChange({ target: { value } });
  });
}

function selectIn(container, surface, index) {
  return container.querySelectorAll(`[data-surface="${surface}"] select`)[index];
}

test("the page, the open file and the dialog start on one model and one effort", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(DarkDeskControls)));
  assert.deepEqual(selectsOf(container, "dials"), selectsOf(container, "file"));
  assert.deepEqual(selectsOf(container, "dialog"), selectsOf(container, "dials"));
  assert.equal(selectsOf(container, "dials").model, "auto");
  await React.act(async () => root.unmount());
});

test("a model picked in the dialog shows on the page and on the open file, with its effort", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(DarkDeskControls)));
  await changeSelect(selectIn(container, "dialog", 0), "codex-sol-6-1");
  assert.equal(selectsOf(container, "dials").model, "codex-sol-6-1");
  assert.deepEqual(selectsOf(container, "file"), selectsOf(container, "dialog"));
  assert.deepEqual(selectsOf(container, "dials"), selectsOf(container, "dialog"));
  assert.deepEqual(runs.at(-1), { model: "codex-sol-6-1", effort: runs.at(-1).effort });
  await React.act(async () => root.unmount());
});

test("an effort picked on the open file shows in the dialog and on the page", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(DarkDeskControls)));
  await changeSelect(selectIn(container, "file", 1), "low");
  assert.equal(selectsOf(container, "dialog").effort, "low");
  assert.equal(selectsOf(container, "dials").effort, "low");
  assert.equal(runs.at(-1).effort, "low");
  await React.act(async () => root.unmount());
});

test("an effort picked in the dialog is the effort the page shows", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(DarkDeskControls)));
  await changeSelect(selectIn(container, "dialog", 1), "high");
  assert.equal(selectsOf(container, "dials").effort, "high");
  assert.equal(selectsOf(container, "file").effort, "high");
  assert.deepEqual(selectsOf(container, "dialog"), selectsOf(container, "dials"));
  await React.act(async () => root.unmount());
});
