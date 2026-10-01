/*
  FB5: the shared press→pending→done/failed helper, mounted and pressed.

  WHY A MOUNT RATHER THAN A STRING. A string render answers what a component
  looks like at rest; it cannot answer what this unit is about -- does the button
  disable itself and change its label in the same paint as the press, does the
  failure carry the server's own words, does the Undo the toast offers actually
  run. Those are presses, so this file mounts the real `useDeskAction` in an
  in-process DOM and presses it. The pure half of the same module (the
  sentences, the refusal reader, the ⌘S predicate) is asserted here too, off the
  same import, so nothing about the helper is left to the browser.

  The DOM is `scripts/dom-harness.mjs` -- the shim `scripts/bh2-dialogs.test.mjs`
  installs by hand (linkedom plus the globals `react-dom/client` wants), factored
  out when this became the second file to need it.

  TWO THINGS ARE STUBS, and neither is the thing under test:

    1. `sonner`. A real `Toaster` needs a browser's layout, and what this file
       needs from sonner is *what the desk asked it to show* -- the sentence, the
       tone, the Undo, the dismissal. The stub records every call, so `deskToast`
       is exercised for real and its request is asserted.
       `scripts/fb5-desk-toast.test.mjs` is the other half: the same calls, with
       the REAL sonner mounted, so the bar that appears is proved rather than
       assumed.
    2. `@tanstack/react-query`. `useDeskAction` never calls `useMutation`; the
       import only has to resolve.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { installDom, moduleUrl, stubUrl, transpileToUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");

/* ---------------------------------------------------------------- the stubs */

/*
  Sonner is stubbed here, and that is the difference between this file and
  `scripts/fb5-desk-toast.test.mjs`: that one mounts the real Toaster to prove
  a bar appears, and this one replaces it to record what the desk ASKED it to
  show -- the sentence, the tone, and the Undo -- so a press's whole outcome can
  be asserted without a browser's layout.
*/
const sonnerUrl = stubUrl(`
export const shown = [];
export const dismissed = [];
let n = 0;
function record(kind, message, data) {
  const id = "toast-" + (++n);
  shown.push({ id, kind, message, data });
  return id;
}
function toast(message, data) { return record("default", message, data); }
toast.success = (message, data) => record("success", message, data);
toast.error = (message, data) => record("error", message, data);
toast.warning = (message, data) => record("warning", message, data);
toast.dismiss = (id) => { dismissed.push(id); };
export { toast };
export function __reset() { shown.length = 0; dismissed.length = 0; n = 0; }
`);
const sonner = await import(sonnerUrl);

const reactQueryUrl = stubUrl(`
export function useMutation() { throw new Error("useDeskAction must not reach for react-query"); }
`);

/* -------------------------------------------------- the real shared modules */

const deskToastUrl = await moduleUrl("src/components/desk-toast.ts", { sonner: sonnerUrl });
const deskActionUrl = await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": deskToastUrl,
  "@tanstack/react-query": reactQueryUrl,
});
const deskAction = await import(deskActionUrl);

/* ---------------------------------------------------------------- the probe */

/*
  A plain button on the shared helper -- the shape every converted press site
  has. It draws exactly what the unit promises: the disabled attribute, the
  pending label, and the reason as text for the test to read.
*/
const probe = await import(
  transpileToUrl(
    `
import { createElement as h } from "react";
import { useDeskAction } from "@/components/desk-action";
export function Probe({ work, copy }) {
  const action = useDeskAction(copy);
  return h("div", null,
    h("button", {
      type: "button",
      onClick: () => { void action.run(work); },
      disabled: action.isPending,
      "data-phase": action.phase,
    }, action.isPending ? action.pendingLabel : "Delete pack"),
    h("p", { "data-problem": "1" }, action.problem ?? ""));
}
`,
    "probe.tsx",
    { "@/components/desk-action": deskActionUrl },
  )
);

/* --------------------------------------------------------------- the helpers */

/** A promise the test resolves by hand, so "pending" can be observed. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const live = [];
test.afterEach(async () => {
  for (const page of live.splice(0)) await page.close();
  sonner.__reset();
});

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(element);
  });
  const page = {
    container,
    async click(node) {
      assert.ok(node, "expected a control to press");
      await React.act(async () => {
        node.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
  live.push(page);
  return page;
}

async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const button = (page) => page.container.querySelector("button");
const label = (page) => (button(page).textContent ?? "").trim();
const phase = (page) => button(page).getAttribute("data-phase");
const problem = (page) => page.container.querySelector("[data-problem]").textContent;

/** The sentence a recorded toast shows, glyph and all. */
function toastText(record) {
  return typeof record.message === "string"
    ? record.message
    : renderToStaticMarkup(record.message).replace(/<[^>]+>/g, "");
}

/* ------------------------------------------------------------------- tests */

test("idle: the button is pressable, says its own word, and nothing has been said", async () => {
  const work = deferred();
  const page = await mount(
    React.createElement(probe.Probe, {
      work: () => work.promise,
      copy: { pending: "Deleting…", done: () => "Pack deleted." },
    }),
  );
  assert.equal(phase(page), "idle");
  assert.equal(button(page).disabled, false);
  assert.equal(label(page), "Delete pack");
  assert.deepEqual(sonner.shown, [], "an untouched button says nothing");
});

test("pending: the press disables the button and draws the pending label before the work answers", async () => {
  const work = deferred();
  const page = await mount(
    React.createElement(probe.Probe, {
      work: () => work.promise,
      copy: { pending: "Deleting…", done: () => "Pack deleted." },
    }),
  );
  await page.click(button(page));
  /*
    The point of the unit: the state lands in the SAME paint as the press. The
    work is still unresolved here, so a button that only changed after the
    answer would still read "Delete pack" and be pressable a second time.
  */
  assert.equal(phase(page), "pending");
  assert.equal(button(page).disabled, true);
  assert.equal(label(page), "Deleting…");
  assert.deepEqual(sonner.shown, [], "nothing is claimed until the work answers");

  work.resolve({ ok: true });
  await settle();
  assert.equal(phase(page), "done");
  assert.equal(button(page).disabled, false);
  assert.equal(label(page), "Delete pack");
  assert.equal(sonner.shown.length, 1, "one press, one toast");
  assert.equal(sonner.shown[0].kind, "success");
  assert.equal(toastText(sonner.shown[0]), "Pack deleted.");
});

test("done: the toast carries the specific outcome, and an undo when the press is reversible", async () => {
  const undone = [];
  const page = await mount(
    React.createElement(probe.Probe, {
      work: async () => ({ ok: true, name: "City Hall" }),
      copy: {
        pending: "Renaming…",
        done: (result) => `Pack renamed to “${result.name}”.`,
        undo: () => ({ label: "Undo", run: () => undone.push("ran") }),
      },
    }),
  );
  await page.click(button(page));
  await settle();
  assert.equal(sonner.shown.length, 1);
  assert.equal(toastText(sonner.shown[0]), "Pack renamed to “City Hall”.");

  const action = sonner.shown[0].data.action;
  assert.ok(action, "a reversible press puts its way back on the toast");
  assert.equal(action.label, "Undo");
  let prevented = false;
  action.onClick({ preventDefault: () => (prevented = true) });
  await settle();
  assert.deepEqual(undone, ["ran"], "the Undo press runs the undo");
  assert.equal(prevented, true, "the toast is dismissed by hand once the undo answers");
  assert.deepEqual(sonner.dismissed, [sonner.shown[0].id]);
});

test("failed: the toast carries the real reason, not a generic apology", async () => {
  const page = await mount(
    React.createElement(probe.Probe, {
      work: async () => {
        throw new Error("The desk lost the connection to the database.");
      },
      copy: { pending: "Deleting…", done: () => "Pack deleted.", failedLead: "Could not delete that pack. " },
    }),
  );
  await page.click(button(page));
  await settle();
  assert.equal(phase(page), "failed");
  assert.equal(sonner.shown.length, 1);
  assert.equal(sonner.shown[0].kind, "error", "a failure is not the accent colour");
  assert.match(toastText(sonner.shown[0]), /The desk lost the connection to the database\./);
  assert.match(toastText(sonner.shown[0]), /^! /, "and it carries the desk's failure mark");
  assert.match(problem(page), /The desk lost the connection to the database\./);
});

test("failed: an answer that refuses is reported too, not waved through as a success", async () => {
  const page = await mount(
    React.createElement(probe.Probe, {
      work: async () => ({ ok: false, error: "Only the owner can configure newspaper sections." }),
      copy: { pending: "Saving…", done: () => "Saved." },
    }),
  );
  await page.click(button(page));
  await settle();
  assert.equal(phase(page), "failed", "the desk refused, so the press did not succeed");
  assert.equal(sonner.shown.length, 1);
  assert.equal(sonner.shown[0].kind, "error");
  assert.match(toastText(sonner.shown[0]), /Only the owner can configure newspaper sections\./);
});

test("a second press in the same tick is ignored, not spent twice", async () => {
  let runs = 0;
  const work = deferred();
  const page = await mount(
    React.createElement(probe.Probe, {
      work: () => {
        runs += 1;
        return work.promise;
      },
      copy: { pending: "Deleting…", done: () => "Pack deleted." },
    }),
  );
  /*
    Both presses inside ONE act scope, so React has not re-rendered between
    them and the button is still enabled for the second: this is the case the
    `disabled` attribute cannot cover, and the one the hook's own lock is for.
    A slow round that spent twice would be a real cost -- models, fetches.
  */
  await React.act(async () => {
    const node = button(page);
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  assert.equal(runs, 1, "the lock holds before React has had a chance to disable the button");
  work.resolve({ ok: true });
  await settle();
  assert.equal(sonner.shown.length, 1, "one press, one toast -- the second said nothing");
});

test("the module under test is the real one, and exports the plain save key", () => {
  assert.equal(typeof deskAction.useDeskAction, "function");
  assert.equal(typeof deskAction.useDeskMutation, "function");
  assert.equal(deskAction.isSaveShortcut({ key: "s", metaKey: true }), true);
});

/* ------------------------------------------------- the pure half, in full */

test("deskActionDone reads the outcome from the result and the way back from the copy", () => {
  const copy = {
    done: (result) => `Pack renamed to “${result.name}”.`,
    undo: () => ({ label: "Undo", run: () => undefined }),
  };
  const settled = deskAction.deskActionDone({ name: "City Hall" }, undefined, copy);
  assert.equal(settled.message, "Pack renamed to “City Hall”.");
  assert.equal(settled.undo.label, "Undo");

  const noUndo = deskAction.deskActionDone({ name: "City Hall" }, undefined, {
    done: copy.done,
  });
  assert.equal(noUndo.undo, null, "a press with nothing to take back offers nothing");
});

test("deskActionFailure always ends with the real reason, whatever leads it", () => {
  assert.equal(
    deskAction.deskActionFailure(new Error("the desk said no"), {
      failedLead: "Could not hold that lead. ",
    }),
    "Could not hold that lead. the desk said no",
  );
  assert.equal(
    deskAction.deskActionFailure(new Error("the desk said no"), {}),
    "the desk said no",
    "with no lead the sentence is the reason alone, and never an apology",
  );
  assert.equal(
    deskAction.deskActionFailure({}, {}),
    "the desk gave no reason",
    "a failure that arrives with nothing to say still says something",
  );
});

test("deskAnswerFailure reads a refusal out of the answer, because most server functions answer rather than throw", () => {
  assert.equal(
    deskAction.deskAnswerFailure({ ok: false, error: "Only the owner can do that." }),
    "Only the owner can do that.",
  );
  assert.equal(deskAction.deskAnswerFailure({ ok: true }), null);
  assert.equal(deskAction.deskAnswerFailure({ ok: true, count: 3 }), null);
  assert.equal(deskAction.deskAnswerFailure(undefined), null);
  assert.equal(deskAction.deskAnswerFailure(null), null);
  assert.equal(deskAction.deskAnswerFailure("a bare string answer"), null);
  assert.equal(
    deskAction.deskAnswerFailure({ ok: false }),
    "The desk refused that press and said nothing about why.",
  );
});

test("isSaveShortcut is ⌘S and Ctrl+S, and nothing else", () => {
  const key = (over) => ({ key: "s", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(deskAction.isSaveShortcut(key({ metaKey: true })), true);
  assert.equal(deskAction.isSaveShortcut(key({ ctrlKey: true })), true);
  assert.equal(deskAction.isSaveShortcut(key({ ctrlKey: true, shiftKey: true })), false, "Shift+Ctrl+S is the browser's");
  assert.equal(deskAction.isSaveShortcut(key({ metaKey: true, altKey: true })), false);
  assert.equal(deskAction.isSaveShortcut(key({})), false, "a bare S is the Queue's Start story, not this");
  assert.equal(deskAction.isSaveShortcut({ ...key({ metaKey: true }), key: "k" }), false);
  assert.equal(deskAction.isSaveShortcut({ ...key({ metaKey: true }), key: "S" }), true, "caps lock is not a decision");
});

/*
  M9 of the batch-6 pre-merge audit. A bound global key has to be fussier than
  the badge that promised it: a held key fires the event dozens of times a
  second, an IME mid-composition is building a character rather than pressing a
  shortcut, a keystroke something nearer the editor already handled is not this
  press, and a dialog owns the keyboard while it is open.

  THE MUTATIONS THAT MATTER. Dropping any of the three event guards fails
  "ignores the presses that are not the editor asking to save"; passing
  `dialogOpen: false` unconditionally in `deskShouldSave` fails "leaves the key
  to an open dialog".
*/
test("ignores the presses that are not the editor asking to save", () => {
  const key = (over) => ({ key: "s", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(
    deskAction.isSaveShortcut(key({ metaKey: true, repeat: true })),
    false,
    "a held key fires this event dozens of times a second",
  );
  assert.equal(
    deskAction.isSaveShortcut(key({ metaKey: true, isComposing: true })),
    false,
    "mid-IME that s is part of a character",
  );
  assert.equal(
    deskAction.isSaveShortcut(key({ metaKey: true, defaultPrevented: true })),
    false,
    "something closer to the keystroke already claimed it",
  );
  // Absent means "not a repeat": a caller synthesising a press need not spell it out.
  assert.equal(deskAction.isSaveShortcut(key({ metaKey: true })), true);
});

test("leaves the key to an open dialog, and asks about both ways one is drawn", () => {
  const key = { key: "s", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(deskAction.deskShouldSave(key, true), false);
  assert.equal(deskAction.deskShouldSave(key, false), true);
  assert.match(deskAction.DESK_DIALOG_OPEN_SELECTOR, /dialog\[open\]/);
  assert.match(deskAction.DESK_DIALOG_OPEN_SELECTOR, /\[role=dialog\]\[data-state=open\]/);
});

test("reads the open dialog off the document, through that one selector", () => {
  const seen = [];
  const stub = (hit) => ({
    querySelector(selector) {
      seen.push(selector);
      return hit ? {} : null;
    },
  });
  assert.equal(deskAction.deskDialogOpen(stub(true)), true);
  assert.equal(deskAction.deskDialogOpen(stub(false)), false);
  assert.ok(seen.length > 0 && seen.every((s) => s === deskAction.DESK_DIALOG_OPEN_SELECTOR));
  // No document at all (a server render, or a test) is not an open dialog.
  assert.equal(deskAction.deskDialogOpen(null), false);
});

test("keeps the caller's lead in front of the mapped sentence", () => {
  /*
    M8's composition, and the reason `failedLead` may only be words placed
    BEFORE the reason: the mapping still runs, so a press that failed on the
    transport gets the desk's sentence after the caller's lead rather than the
    browser's. The sentences themselves are pinned in
    `src/components/desk-toast.test.ts`.
  */
  assert.equal(
    deskAction.deskActionFailure(new Error("Failed to fetch"), {
      failedLead: "Could not hold that lead. ",
    }),
    "Could not hold that lead. The desk could not be reached. Check that it is running and your connection. Nothing was changed.",
  );
  assert.equal(
    deskAction.deskActionFailure(new Error("Internal Server Error: status code 500"), {
      failedLead: "",
      what: "publish",
    }).startsWith("The desk could not publish just now."),
    true,
    "a bare 500 is not a sentence; `editorActionError` is where it becomes one",
  );
});
