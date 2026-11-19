/*
  F06 of the 2026-11-19 walk: focus, in a real document.

  The rule is small (`useConfirmFocus`, src/components/confirm-focus.ts), but it
  is about the DOM and about a trigger that is REMOVED and put back -- neither of
  which a pure test can see. So this mounts the hook in the in-process DOM,
  opens a confirm the way a press does, closes it with the safe button, and reads
  where the keyboard actually is.

  THE MUTATION THAT MATTERS: focusing nothing on open (what the desk did) leaves
  `document.activeElement` on the body; that fails both tests.
*/
import assert from "node:assert/strict";
import { test } from "node:test";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

/* The DOM has to exist before react-dom/client is imported. */
const window = installDom();
/*
  linkedom parses and dispatches but does not move `document.activeElement` when
  `focus()` is called (it has no layout to focus against). The desk's rule is
  observed THROUGH that property, so the test supplies the one thing a real
  browser has: focus lands on the element, and the document knows it.
*/
let activeElement = null;
Object.defineProperty(window.document, "activeElement", {
  get: () => activeElement ?? window.document.body,
  configurable: true,
});
/* Passing the element as an argument keeps `this` where it belongs; the rule
   only objects to copying it into a variable. */
const rememberFocus = (element) => {
  activeElement = element;
};
window.HTMLElement.prototype.focus = function focus() {
  if (this.disabled) return;
  rememberFocus(this);
};
window.HTMLElement.prototype.blur = function blur() {
  if (activeElement === this) activeElement = null;
};
const React = await import("react");
const { createRoot } = await import("react-dom/client");

const focusUrl = await moduleUrl("src/components/confirm-focus.ts", {});
const harness = stubUrl(`
import { createElement as h, useState } from ${JSON.stringify(import.meta.resolve("react"))};
import { useConfirmFocus } from ${JSON.stringify(focusUrl)};

export function Harness() {
  const [open, setOpen] = useState(false);
  useConfirmFocus(open, { trigger: "demo-delete", safe: "demo-keep" });
  if (!open) {
    return h("button", {
      type: "button",
      "data-focus-key": "demo-delete",
      onClick: () => setOpen(true),
    }, "Delete");
  }
  return h("span", null,
    h("button", { type: "button", onClick: () => {} }, "Yes, delete"),
    h("button", {
      type: "button",
      "data-focus-key": "demo-keep",
      onClick: () => setOpen(false),
    }, "Keep"),
  );
}
`);
const { Harness } = await import(harness);

const focusedKey = () => document.activeElement?.getAttribute("data-focus-key") ?? null;

test("an inline confirm moves the keyboard, and gives it back", async (t) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  t.after(async () => {
    await React.act(async () => root.unmount());
    container.remove();
  });

  const trigger = container.querySelector('[data-focus-key="demo-delete"]');
  assert.ok(trigger, "the trigger was not drawn");
  await React.act(async () => trigger.focus());
  assert.equal(focusedKey(), "demo-delete");

  await React.act(async () => trigger.click());
  assert.equal(focusedKey(), "demo-keep", "opening the question left focus on the page, not on Keep");

  const keep = container.querySelector('[data-focus-key="demo-keep"]');
  await React.act(async () => keep.click());
  assert.equal(
    focusedKey(),
    "demo-delete",
    "closing the question did not put the keyboard back on the button that opened it",
  );
});
