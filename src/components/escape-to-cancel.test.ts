import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { attachEscapeToCancel } from "./escape-to-cancel.ts";

/**
 * Escape on an open inline confirmation (unit DLG-2).
 *
 * Escape does what the confirmation's Keep button does: it calls the cancel
 * callback once and never confirms. While the confirmation is open the press
 * stops at the window, so a More panel or dialog around it is not also closed.
 *
 * WHAT THIS FILE CANNOT SEE: the hook that calls this (`useEscapeToCancel`)
 * is a one-line effect that mounts this listener only while a confirmation is
 * open. The DOM setup here does not render React, so the four screens that use
 * the hook are not walked here; they are walked in the browser.
 *
 * linkedom does not model the capture phase: it runs listeners from the target
 * outward, so it cannot show the window listener running first. The enclosing-
 * menu test therefore checks the stop flag (`cancelBubble`), and the browser
 * walk checks the order.
 *
 * THE MUTATIONS THAT MATTER. Calling `onCancel` for any other key fails the
 * "other keys" test; removing `stopPropagation` fails the enclosing-menu test;
 * removing the detach fails the "after detach" test.
 */

/** A closed `<details>` with a button inside, as the confirmation sits in a More panel. */
function page() {
  return parseHTML(
    '<html><body><details open><summary>More</summary><button id="delete">Delete</button></details></body></html>',
  );
}

/** A keydown with the given key, dispatched on `target` from the page's own Event class. */
function press(
  dom: ReturnType<typeof page>,
  target: EventTarget,
  key: string,
  bubbles = false,
) {
  const event = new dom.window.Event("keydown", { bubbles, cancelable: true });
  Object.assign(event, { key });
  target.dispatchEvent(event);
  return event;
}

describe("Escape on an open inline confirmation", () => {
  it("calls the cancel callback once and never confirms", () => {
    const dom = page();
    let cancelled = 0;
    attachEscapeToCancel(dom.window, () => {
      cancelled += 1;
    });
    const event = press(dom, dom.window, "Escape");
    assert.equal(cancelled, 1);
    assert.equal(event.defaultPrevented, true);
  });

  it("leaves every other key alone", () => {
    const dom = page();
    let cancelled = 0;
    attachEscapeToCancel(dom.window, () => {
      cancelled += 1;
    });
    for (const key of ["Enter", "a", "Tab", "Backspace"]) {
      press(dom, dom.window, key);
    }
    assert.equal(cancelled, 0);
  });

  it("stops the press so an enclosing menu does not also close", () => {
    const dom = page();
    let cancelled = 0;
    attachEscapeToCancel(dom.window, () => {
      cancelled += 1;
    });
    const button = dom.document.getElementById("delete");
    assert.ok(button, "the test page has the confirmation's button");
    const event = press(dom, button, "Escape", true);
    assert.equal(cancelled, 1);
    assert.equal(event.cancelBubble, true);
  });

  it("does nothing after the listener is detached", () => {
    const dom = page();
    let cancelled = 0;
    const detach = attachEscapeToCancel(dom.window, () => {
      cancelled += 1;
    });
    detach();
    press(dom, dom.window, "Escape");
    assert.equal(cancelled, 0);
  });

  it("closes only the first of two open confirmations on one press", () => {
    const dom = page();
    const closed: string[] = [];
    attachEscapeToCancel(dom.window, () => closed.push("kill"));
    attachEscapeToCancel(dom.window, () => closed.push("delete"));
    press(dom, dom.window, "Escape");
    assert.deepEqual(closed, ["kill"]);
  });
});
