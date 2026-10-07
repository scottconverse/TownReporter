/**
 * The phase-0 `ChoiceCard`, for tests to pass as `Choice`.
 *
 * `ChoiceCard` lives in `dialog.tsx`, a `.tsx` file, and `node
 * --experimental-strip-types` cannot load one -- so a `.ts` test that imported
 * the real component could not render a dialog body at all. The bodies take the
 * choice component as a prop precisely so that this is possible (see
 * `ChoiceRender` in `editor-dialog-bodies.ts`).
 *
 * This is a DOUBLE OF THE MARKUP, not a second implementation: same
 * `role="radio"`, same `aria-checked={selected === true}` (so `aria-checked` is
 * "false" and never absent), same `.astra-choice-card` / `.astra-choice-mark` /
 * `.astra-choice-text` / `.astra-choice-note` classes, same `.on` suffix. If
 * the real card's markup drifts, the assertions here keep passing -- which is
 * why `scripts/astra-dialog.test.mjs` holds the REAL `dialog.tsx` (it can,
 * via `typescript.transpileModule` and a `data:` URL) and the browser pass
 * renders the shipped dialog, which passes the real card in. The gap is named
 * in the unit's report; it is not closed here.
 */
import { createElement, type ReactNode } from "react";
import type { ChoiceRender, ModelPickerRender } from "./editor-dialog-bodies.ts";

export const ChoiceDouble: ChoiceRender = ({
  label,
  note,
  selected,
  onSelect,
}): ReactNode =>
  createElement(
    "button",
    {
      type: "button",
      role: "radio",
      "aria-checked": selected === true,
      className: "astra-choice-card" + (selected ? " on" : ""),
      onClick: onSelect,
    },
    createElement("span", { className: "astra-choice-mark", "aria-hidden": "true" }),
    createElement(
      "span",
      { className: "astra-choice-text" },
      createElement("b", null, label),
      note ? createElement("span", { className: "astra-choice-note" }, note) : null,
    ),
  );

/** Minimal renderer double for dialog body tests; production supplies ModelPicker. */
export const ModelPickerDouble: ModelPickerRender = ({ label, value, effort }): ReactNode =>
  createElement(
    "div",
    { className: "test-model-picker" },
    createElement("label", null, label),
    createElement(
      "select",
      { "aria-label": "Model", value, readOnly: true },
      createElement("option", { value }, value === "auto" ? "Automatic (Recommended)" : value),
    ),
    createElement(
      "select",
      { "aria-label": "Effort", value: effort ?? "high", readOnly: true },
      createElement("option", { value: effort ?? "high" }, effort ?? "high"),
    ),
  );
