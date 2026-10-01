/*
  B7R, item 3: `useDeskMutation` and its `after` follow-up, mounted and pressed.

  WHAT THIS PROVES. The mutation's own answer used to be the whole of what the
  helper knew: `void optionsRef.current.after?.(...)` let the press settle --
  the button re-enabled, the success toast appeared -- while the follow-up was
  still running, and a follow-up that threw became an unhandled promise that
  nothing reported. The Sources screen is where it was measured: accepting a
  source and filing it under sections is one press, `after` does the filing,
  and the press was already over while the filing was still in flight.

  THE ORDER IS THE DECISION, and it is here as a test: success is announced
  after the whole action finishes, not after the first half of it. A toast that
  says the source was accepted while the filing is still running is claiming an
  outcome nobody has yet.

  This is the real `useDeskMutation`, the real `deskToast` and the real
  `@tanstack/react-query`, mounted in the in-process DOM
  (`scripts/dom-harness.mjs`). The mutation stays `pending` through an async
  `onSuccess` because react-query awaits it before dispatching "success" -- that
  is the platform behaviour this fix leans on, so the test leans on the real
  library rather than a stand-in.

  Only `sonner` is stubbed, exactly as `scripts/fb5-desk-action.test.mjs` does
  it: what this file needs from sonner is what the desk ASKED it to show. The
  bar that appears is proved in `scripts/fb5-desk-toast.test.mjs`.

  THE MUTATIONS THAT MATTER. Putting `void` back in front of the `after` call
  fails "the press stays pending until the follow-up finishes" and "the success
  toast waits for the follow-up"; dropping the `after` rejection handler fails
  "a follow-up that fails is reported, not swallowed".
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl, stubUrl, transpileToUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");

/*
  An unhandled rejection is one of the two failures this unit is about, so it is
  caught and asserted rather than left to crash the run: before the fix the
  `after` rejection had nowhere to go, and the assertion below is what says so.
*/
const unhandled = [];
process.on("unhandledRejection", (reason) => {
  unhandled.push(reason);
});

/* ---------------------------------------------------------------- the stub */

const sonnerUrl = stubUrl(`
export const shown = [];
let n = 0;
function record(message, data) {
  const id = "toast-" + (++n);
  shown.push({ id, message, data });
  return id;
}
function toast(message, data) { return record(message, data); }
toast.success = (message, data) => record(message, data);
toast.error = (message, data) => record(message, data);
toast.warning = (message, data) => record(message, data);
toast.dismiss = () => {};
export { toast };
export function __reset() { shown.length = 0; n = 0; }
`);
const sonner = await import(sonnerUrl);

/* -------------------------------------------------- the modules under test */

/*
  The real react-query, and the same instance the transpiled module gets: both
  resolve the bare specifier from this repository's node_modules.
*/
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

const deskToastUrl = await moduleUrl("src/components/desk-toast.ts", { sonner: sonnerUrl });
const deskActionUrl = await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": deskToastUrl,
});
const deskAction = await import(deskActionUrl);

const probe = await import(
  transpileToUrl(
    `
import { createElement as h } from "react";
import { useDeskMutation } from "@/components/desk-action";
export function Probe({ mutationFn, after, done, failedLead }) {
  const mutation = useDeskMutation({
    mutationFn,
    pending: "Saving…",
    done: done ?? (() => "Source accepted."),
    failedLead,
    after,
  });
  return h("button", {
    type: "button",
    disabled: mutation.isPending,
    "data-pending": String(mutation.isPending),
    onClick: () => mutation.mutate({ id: 7 }),
  }, mutation.isPending ? "Saving…" : "Accept");
}
`,
    "b7r-probe.tsx",
    { "@/components/desk-action": deskActionUrl },
  )
);

/* --------------------------------------------------------------- the rigs */

/** A promise the test resolves by hand, so "still pending" can be observed. */
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
  unhandled.length = 0;
});

async function mount(element, client) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(element);
  });
  const page = {
    container,
    async click() {
      const node = container.querySelector("button");
      assert.ok(node, "expected the button to draw");
      await React.act(async () => {
        node.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => {
        root.unmount();
      });
      container.remove();
      /*
        A settled mutation keeps a five-minute garbage-collection timer of its
        own, and `client.clear()` does not touch it -- it empties the cache
        without destroying the mutations in it, so the process sits on that
        timer long after the last assertion. `destroy()` on each mutation is
        what clears it; `clear()` then drops the rest.
      */
      for (const mutation of client.getMutationCache().getAll()) mutation.destroy();
      client.clear();
    },
  };
  live.push(page);
  return page;
}

/**
 * Wait for the desk to reach the state under test.
 *
 * A fixed number of ticks is not enough to be sure: the mutation's own promise
 * chain, react-query's notify batch and the re-render are three separate hops,
 * and a loaded machine can deliver them across more than one timer. Waiting FOR
 * the state is what keeps this file from failing on a busy CI runner -- it only
 * ever fails for a real reason, and it fails naming what it waited for.
 */
async function until(condition, what) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** A tick and a flush, for the assertions that nothing has happened yet. */
async function settle() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const pending = (page) => page.container.querySelector("button").getAttribute("data-pending");
const label = (page) => page.container.querySelector("button").textContent.trim();

/** The sentence a recorded toast shows, glyph and all. */
function toastText(record) {
  return typeof record.message === "string"
    ? record.message
    : renderToStaticMarkup(record.message).replace(/<[^>]+>/g, "");
}

/** Every toast is `toast.success` with a tone class; the class is the tone. */
const toneOf = (record) => (/desk-toast-err/.test(record.data.className) ? "err" : "ok");

/** The provider, the client, and the element that mounts the hook under it. */
function probeElement(props) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return {
    client,
    element: React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(probe.Probe, props),
    ),
  };
}

/* ------------------------------------------------------------------- tests */

test("the press stays pending until the follow-up finishes", async () => {
  const after = deferred();
  const events = [];
  const { client, element } = probeElement({
    mutationFn: async () => {
      events.push("work");
      return { ok: true };
    },
    after: async () => {
      events.push("after:start");
      await after.promise;
      events.push("after:end");
    },
  });
  const page = await mount(element, client);

  await page.click();
  /*
    Both halves at once: the follow-up has started AND the press is still
    drawn as running. Waiting for the event alone would read the attribute
    before React had flushed the render that carries it.
  */
  await until(
    () => events.includes("after:start") && pending(page) === "true",
    "the follow-up to start while the press is still pending",
  );
  assert.deepEqual(events, ["work", "after:start"], "the follow-up runs once the answer is in");
  assert.equal(pending(page), "true", "the press is not finished while the follow-up is running");
  assert.equal(label(page), "Saving…");

  after.resolve();
  await until(() => pending(page) === "false", "the press to finish");
  assert.deepEqual(events, ["work", "after:start", "after:end"]);
  assert.equal(label(page), "Accept");
});

test("the success toast waits for the follow-up", async () => {
  const after = deferred();
  const { client, element } = probeElement({
    mutationFn: async () => ({ ok: true }),
    done: () => "Accepted and filed under City Council.",
    after: () => after.promise,
  });
  const page = await mount(element, client);

  await page.click();
  await settle();
  assert.deepEqual(sonner.shown, [], "nothing is claimed while the follow-up is still running");

  after.resolve();
  await until(() => sonner.shown.length === 1, "the done toast");
  assert.equal(toastText(sonner.shown[0]), "Accepted and filed under City Council.");
  assert.equal(toneOf(sonner.shown[0]), "ok");
});

test("a follow-up that fails is reported, not swallowed", async () => {
  const { client, element } = probeElement({
    mutationFn: async () => ({ ok: true }),
    done: () => "Accepted.",
    failedLead: "Could not change that source. ",
    after: async () => {
      throw new Error("The sections did not save.");
    },
  });
  const page = await mount(element, client);

  await page.click();
  await until(() => sonner.shown.length === 1, "the failure toast");
  // A tick more, so a rejection left unhandled would have been delivered.
  await settle();
  assert.deepEqual(unhandled, [], `a follow-up rejection was left unhandled: ${unhandled[0]}`);
  assert.equal(sonner.shown.length, 1, "the follow-up's failure is the press's failure");
  assert.equal(toneOf(sonner.shown[0]), "err");
  assert.match(toastText(sonner.shown[0]), /^! /, "and it carries the desk's failure mark");
  assert.match(toastText(sonner.shown[0]), /Could not change that source\. /);
  assert.match(toastText(sonner.shown[0]), /The sections did not save\./);
  await until(() => pending(page) === "false", "the press to finish");
});

test("the follow-up does not run when the desk refused the press", async () => {
  let ran = 0;
  const { client, element } = probeElement({
    mutationFn: async () => ({ ok: false, error: "Only the owner can accept sources." }),
    done: () => "Accepted.",
    after: async () => {
      ran += 1;
    },
  });
  const page = await mount(element, client);

  await page.click();
  await until(() => sonner.shown.length === 1, "the refusal toast");
  assert.equal(ran, 0, "a refused press changed nothing, so there is nothing to follow up");
  assert.equal(toneOf(sonner.shown[0]), "err");
});

test("the module under test is the real one", () => {
  assert.equal(typeof deskAction.useDeskMutation, "function");
});
