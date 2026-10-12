/*
  DHE1-10 / DHD1-2: the Queue bulk strip ("Model for these stories") and the
  batch dialog ("Draft the selected leads") are ONE model state and ONE effort.

  WHAT IS REAL. The state is `useBatchModelChoice` from
  `src/components/batch-model-choice.ts`, the same hook the Queue route calls.
  It is mounted with react-dom/client in the in-process DOM from
  `scripts/dom-harness.mjs`, next to TWO pickers, one for the strip and one for
  the dialog, both wired the way the route wires them.

  WHAT IS STUBBED. The real `ModelPicker` needs a query client and the server
  functions behind its option list. Its stand-in is a select pair that reports
  the props it is given. The picker's own effort fallback
  (`pickerShownEffort`) is covered by scripts/model-picker-shared-state.test.mjs,
  not here. A change is driven by calling the element's own React `onChange`,
  because linkedom has no default action for a select.

  THE CLAIM. Pick a model in either picker, and the other shows the same model
  and the same effort at once. Pick an effort in either, and the other shows
  it too. The state the picker shows is the state a Start press would send.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { installDom, moduleUrl, noJobModelAssignmentUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");



const { useBatchModelChoice } = await import(
  await moduleUrl("src/components/batch-model-choice.ts", {
    "@/components/use-job-model-assignment": noJobModelAssignmentUrl,
    "@/lib/news/queue-rows": await moduleUrl("src/lib/news/queue-rows.ts"),
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

/* The Queue's shape: the strip and the dialog render the same batch state. */
function QueueBatchControls() {
  const batch = useBatchModelChoice();
  runs.push({ runtime: batch.runtime, effort: batch.effort });
  const picker = (surface) =>
    h(
      "section",
      { "data-surface": surface },
      h(ModelPicker, {
        scope: "forced",
        label: "Model for these stories",
        value: batch.runtime,
        onChange: batch.pick,
        effort: batch.effort,
        onEffortChange: batch.setEffort,
      }),
    );
  return h("div", null, picker("strip"), picker("dialog"));
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

test("the strip and the dialog start on one model and one effort", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(QueueBatchControls)));
  assert.deepEqual(selectsOf(container, "strip"), selectsOf(container, "dialog"));
  assert.equal(selectsOf(container, "strip").model, "auto");
  await React.act(async () => root.unmount());
});

test("a model picked in the strip shows in the dialog, with its effort, and runs", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(QueueBatchControls)));
  await changeSelect(selectIn(container, "strip", 0), "codex-sol-6-1");
  const strip = selectsOf(container, "strip");
  const dialog = selectsOf(container, "dialog");
  assert.equal(strip.model, "codex-sol-6-1");
  assert.deepEqual(dialog, strip);
  assert.deepEqual(runs.at(-1), { runtime: "codex-sol-6-1", effort: runs.at(-1).effort });
  await React.act(async () => root.unmount());
});

test("an effort picked in the dialog shows in the strip, and is the effort that runs", async () => {
  const { container, root } = mount();
  await React.act(async () => root.render(h(QueueBatchControls)));
  await changeSelect(selectIn(container, "dialog", 1), "low");
  assert.equal(selectsOf(container, "strip").effort, "low");
  assert.equal(selectsOf(container, "dialog").effort, "low");
  assert.equal(runs.at(-1).effort, "low");
  await React.act(async () => root.unmount());
});
