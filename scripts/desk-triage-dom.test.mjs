/*
  N4 of the batch-7 re-audit: the KEYS, on a real listener, in a real document.

  `src/components/desk-triage.test.ts` pins the rule (`triageAction`,
  `isInteractiveTarget`, `triageOverlayOpen`) as pure functions, which is where
  every decision in it lives. What a pure test cannot see is the WIRING the
  audit actually complained about: the hook bound to `window` with no stand-down
  for a focused control, and no dialog check at all on either screen. So this
  mounts the real `useTriageKeys` in the in-process DOM, presses real keys at a
  real element, and reads what the screen was told.

  THE MUTATIONS THAT MATTER: dropping `triageOverlayOpen()` from the hook's
  `triageAction` call fails "stands down while a dialog is open"; dropping
  `isInteractiveTarget` from `triageAction` fails "leaves Enter on a button to
  the button".
*/
import assert from "node:assert/strict";
import { test } from "node:test";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

/* The DOM has to exist before react-dom/client is imported. */
const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");

const triageUrl = await moduleUrl("src/components/desk-triage.ts", {});
const harness = stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
import { useTriageKeys } from ${JSON.stringify(triageUrl)};

export function Harness({ log }) {
  useTriageKeys((action) => log.push(action.kind));
  return h("div", null, h("button", { id: "row" }, "Hold"));
}
`);
const { Harness } = await import(harness);

/** A keystroke at `target`, shaped the way a browser delivers one. */
function press(target, key) {
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  target.dispatchEvent(event);
  return event;
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const log = [];
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness, { log })));
  return {
    container,
    log,
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

test("the triage keys, bound for real", async (t) => {
  const page = await mount();
  t.after(async () => {
    await page.close();
  });

  await t.test("answers a keystroke aimed at the page", () => {
    press(window, "j");
    assert.deepEqual(page.log, ["move"], "the list did not hear a plain J");
  });

  await t.test("leaves Enter on a focused button to the button", () => {
    // The audit's own input: `triageAction({key:"Enter", target:{tagName:"BUTTON"}})`
    // returned `{kind:"open"}`, so the press was cancelled and the editor was
    // navigated to the cursor lead's story instead of pressing the control.
    const button = page.container.querySelector("button");
    const enter = press(button, "Enter");
    assert.deepEqual(page.log, ["move"], "Enter on a button was claimed by the list");
    assert.equal(enter.defaultPrevented, false, "the button's own press was cancelled");

    const x = press(button, "x");
    assert.deepEqual(page.log, ["move"], "X was claimed on a button");
    assert.equal(x.defaultPrevented, false);
  });

  await t.test("stands down while a dialog is over the list", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    try {
      press(window, "j");
      press(window, "x");
      press(window, "Enter");
      assert.deepEqual(page.log, ["move"], "a key was claimed with a dialog open");
    } finally {
      dialog.remove();
    }
    // ... and the keys come back the moment it closes.
    press(window, "x");
    assert.deepEqual(page.log, ["move", "kill"], "the keys did not come back");
  });

  await t.test("stands down while one of the desk's menus is open", async () => {
    const menu = document.createElement("details");
    menu.setAttribute("open", "");
    menu.innerHTML = "<summary>More</summary><button>Kill</button>";
    document.body.append(menu);
    try {
      press(window, "h");
      assert.deepEqual(page.log, ["move", "kill"], "a key was claimed with a menu open");
      // A SHUT menu is not standing over anything.
      menu.removeAttribute("open");
      press(window, "h");
      assert.deepEqual(page.log, ["move", "kill", "hold"], "a shut menu blocked the keys");
    } finally {
      menu.remove();
    }
  });
});
