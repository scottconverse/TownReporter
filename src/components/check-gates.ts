import { createElement } from "react";
import type { CheckChip } from "../lib/news/check-gates.ts";

/**
 * The publish bar's gate chips, on both workbenches (unit U9).
 *
 * A chip that says a check did not run is drawn in the quiet dashed outline the
 * desk home already uses for it, so "not run" cannot be read as a pass from
 * across the room; a chip that names work still to do keeps the loud one. The
 * page decides what each chip says (`lib/news/check-gates.ts`) and this only
 * draws it, which is what makes the words on the bar testable without a server
 * -- the same split `BeforeYouCanPublish` uses, and written without JSX for the
 * same reason (`node --experimental-strip-types` reads these tests).
 */
const TONE_CLASS: Record<CheckChip["tone"], string> = {
  ok: "",
  warn: " is-todo",
  quiet: " is-quiet",
};

export function CheckGates(props: { gates: CheckChip[]; label: string }) {
  return createElement(
    "ul",
    { className: "astra-gates", "aria-label": props.label },
    ...props.gates.map((gate) =>
      createElement("li", { key: gate.text, className: `astra-gate${TONE_CLASS[gate.tone]}` }, gate.text),
    ),
  );
}
