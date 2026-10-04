/*
  FB5: `announceToDesk` draws the desk's toast, and speaks exactly once.

  WHAT THIS PROVES, AND WHAT IT DOES NOT. The Toaster here is the REAL sonner,
  mounted in the in-process DOM (`scripts/dom-harness.mjs`), and the modules
  under test are the real `desk-toast.ts`, `desk-toaster.tsx` and
  `desk-chrome-utils.ts`. So the question this file answers is the one the unit
  is named for: when a press announces its outcome, does a bar appear with the
  desk's own class on it, and is the sr-only region left alone so the editor's
  screen reader does not hear the sentence twice.

  What it cannot answer is what the bar LOOKS like: linkedom has no layout, no
  paint and no cascade, and sonner's own stylesheet is injected by script. The
  yellow fill, the `#111` text, the danger edge and the 14px floor are settled
  in `src/desk-astra.css` and are measured in a browser -- see the FB5 browser
  walk and its screenshots.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
/*
  The real sonner, imported here as well as by the transpiled modules: both
  resolve to the same file, so this is the same toast store the desk writes to,
  and `toast.dismiss()` between tests clears it rather than leaving one test's
  bar to be read by the next.
*/
const { toast } = await import("sonner");

/* -------------------------------------------------- the modules under test */

/*
  `sonner` is NOT stubbed here: the real one is imported straight from
  node_modules by the transpiled module, which is the point of the test.
*/
const deskToastUrl = await moduleUrl("src/components/desk-toast.ts");
const deskToasterUrl = await moduleUrl("src/components/desk-toaster.tsx", {
  "@/components/desk-toast": deskToastUrl,
});
const chromeUtilsUrl = await moduleUrl("src/components/desk-chrome-utils.ts", {
  "@/components/desk-toast": deskToastUrl,
});

const { deskToast, deskToastHostMounted, deskErrorReason } = await import(deskToastUrl);
const { DeskToaster } = await import(deskToasterUrl);
const { announceToDesk, announceOnly } = await import(chromeUtilsUrl);

/* --------------------------------------------------------------- the rigs */

/*
  The desk shell's own sr-only region, put in the document by hand: the real one
  is rendered by `DeskShell`, which this file does not mount (it needs the
  router, auth and a dozen contexts). Everything else about it is the shell's:
  the same id, the same role, the same politeness.
*/
function announcer() {
  let el = document.getElementById("desk-announcer");
  if (!el) {
    el = document.createElement("div");
    el.id = "desk-announcer";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.append(el);
  }
  return el;
}

/**
 * Let React commit and sonner's own subscriber settle.
 *
 * Sonner renders a toast one commit after the store is written, so a single
 * `act` is not enough; three passes plus a macrotask is what the store's
 * subscribe/unsubscribe cycle actually needs here (measured, not guessed).
 */
async function flush() {
  for (let pass = 0; pass < 3; pass += 1) {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Announce from inside `act`, so the store write and its commit are one step. */
async function say(text, tone) {
  await React.act(async () => {
    announceToDesk(text, tone);
  });
  await flush();
}

const live = [];
test.afterEach(async () => {
  for (const teardown of live.splice(0)) await teardown();
});

/** What the desk drew, read from the mount point rather than the whole document. */
function drawn(container) {
  const bars = [...container.querySelectorAll("[data-sonner-toast]")];
  return { bars, text: bars.map((bar) => (bar.textContent ?? "").trim()) };
}

/** Mount `<DeskToaster/>` (or nothing), call the body, then unmount. */
async function withDesk(body, { toaster = true } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(toaster ? React.createElement(DeskToaster) : null);
  });
  const scope = {
    container,
    toaster,
    ...drawn(container),
    /** Re-read after the store has settled. */
    redraw() {
      const now = drawn(container);
      this.bars = now.bars;
      this.text = now.text;
      return now;
    },
  };
  live.push(async () => {
    toast.dismiss();
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
    await flush();
  });
  await body(scope);
  await flush();
}

/* ------------------------------------------------------------------- tests */

test("a mounted host is what announceToDesk looks for", async () => {
  assert.equal(typeof deskToastHostMounted, "function");
  assert.equal(deskToastHostMounted(), false, "no host in this document yet");
  await withDesk(async () => {
    assert.equal(deskToastHostMounted(), true, "DeskToaster advertises the host attribute");
  });
});

test("announceToDesk shows a visible bar, with the desk's own class on it", async () => {
  await withDesk(async (scope) => {
    await say("The lead is on hold, off the Queue until you release it.");
    const { bars, text } = scope.redraw();
    assert.equal(bars.length, 1, "the announcement is drawn, not only spoken");
    assert.match(bars[0].className, /desk-toast/);
    assert.match(bars[0].className, /desk-toast-ok/, "a finished press gets the yellow bar");
    assert.match(text[0], /off the Queue until you release it/);
  });
});

test("a failure is drawn as a failure: the danger class, the mark, and the real reason", async () => {
  await withDesk(async (scope) => {
    await say("Could not change that lead. The desk lost the connection.", "err");
    const { bars, text } = scope.redraw();
    assert.equal(bars.length, 1);
    assert.match(bars[0].className, /desk-toast-err/);
    assert.match(
      text[0],
      /! Could not change that lead\. The desk lost the connection\./,
      "the kind is said in words before the reason, the way Notice says it",
    );
  });
});

test("with a host mounted the toast is the announcement, and the sr-only region is left alone", async () => {
  const region = announcer();
  region.textContent = "";

  await withDesk(async (scope) => {
    await say("Draft queued — it is writing now.");
    assert.equal(scope.redraw().bars.length, 1, "the bar is the announcement");
    assert.equal(
      region.textContent,
      "",
      "writing #desk-announcer as well would say the same sentence twice",
    );
  });
  region.textContent = "";
});

test("with no host the sentence still reaches a screen reader rather than going nowhere", async () => {
  const region = announcer();
  region.textContent = "";

  await withDesk(
    async (scope) => {
      await say("Draft queued — it is writing now.");
      assert.equal(scope.redraw().bars.length, 0, "nothing to draw with, so nothing is drawn");
      assert.equal(region.textContent, "Draft queued — it is writing now.");
    },
    { toaster: false },
  );
  region.textContent = "";
});

test("announceOnly speaks without drawing, for announcements that are not outcomes", async () => {
  const region = announcer();
  region.textContent = "";
  await withDesk(async (scope) => {
    await React.act(async () => {
      announceOnly("Selected: Longmont Senior Center to begin free meal pickups Oct. 2.");
    });
    await flush();
    assert.equal(scope.redraw().bars.length, 0, "a toast per arrow key would be noise, not feedback");
    assert.equal(region.textContent, "Selected: Longmont Senior Center to begin free meal pickups Oct. 2.");
  });
  region.textContent = "";
});

test("deskErrorReason never swallows a failure, however it arrives", () => {
  assert.equal(deskErrorReason(new Error("the server said no")), "the server said no");
  assert.equal(deskErrorReason("a bare string"), "a bare string");
  assert.equal(deskErrorReason({ message: "an object with a message" }), "an object with a message");
  assert.equal(deskErrorReason(new Error("   ")), "the desk gave no reason");
  assert.equal(deskErrorReason(null), "the desk gave no reason");
  assert.equal(deskErrorReason(undefined), "the desk gave no reason");
});

/*
  M8 of the batch-6 pre-merge audit, on the live path.

  The sentences themselves are pinned in `src/components/desk-toast.test.ts`,
  which can load `desk-toast.ts` directly. What only this file can prove is that
  the mapping survives the trip through the toast: a press that failed on the
  transport is DRAWN with the desk's sentence, not the browser's -- which is
  what the editor actually reads.
*/
test("a failure that never reached the desk is drawn with the desk's own sentence", async () => {
  await withDesk(async (scope) => {
    await say(deskErrorReason(new Error("TypeError: Failed to fetch")), "err");
    const { text } = scope.redraw();
    assert.equal(text.length, 1);
    assert.match(text[0], /The desk could not be reached/);
    assert.match(text[0], /Nothing was changed/);
    assert.doesNotMatch(text[0], /Failed to fetch/, "the browser's words reached the editor");
  });
});

/*
  M6 of the batch-6 pre-merge audit, on the element sonner actually builds.

  `src/components/desk-toaster.test.ts` pins the geometry as data; this pins
  that the mounted component hands it over. Sonner writes `data-y-position` and
  the `--offset-*` custom properties onto the positioned `<ol>` it creates, and
  it only creates that once there is a toast to put in it -- so the stack has to
  be drawn first.
*/
test("the mounted stack is bottom-left, lifted clear of the bottom bars", async () => {
  await withDesk(async (scope) => {
    await say("Held 12.");
    const { bars } = scope.redraw();
    assert.equal(bars.length, 1, "no stack was drawn to measure");

    const stack = scope.container.querySelector("[data-sonner-toaster]");
    assert.ok(stack, "sonner built no positioned host");
    assert.equal(stack.getAttribute("data-y-position"), "bottom");
    assert.equal(stack.getAttribute("data-x-position"), "left");
    const style = stack.getAttribute("style") ?? "";
    const bottom = /--offset-bottom:\s*(\d+)px/.exec(style);
    assert.ok(bottom, `no bottom offset on the stack: ${style}`);
    assert.ok(
      Number(bottom[1]) >= 88,
      `the stack sits ${bottom[1]}px off the bottom, under the publish bar`,
    );
    assert.match(style, /--offset-left:\s*calc\(var\(--desk-nav-w/);
  });
});

/*
  The phone half. The edge is sonner's `data-y-position`, and that attribute
  comes from the `position` prop, so it is the prop that has to change -- an
  earlier cut moved the box with a `≤700px` stylesheet rule and left the
  attribute saying bottom, which laid the card out bottom-anchored and put it
  at y=28px, over the header it was meant to clear. The frame is stubbed here
  because `matchMedia` is what `DeskToaster` reads at mount.
*/
test("on a phone the mounted stack hangs from the top, at the same clear height", async () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({
    matches: query === "(max-width: 700px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    await withDesk(async (scope) => {
      await say("Killed 2.");
      const stack = scope.container.querySelector("[data-sonner-toaster]");
      assert.ok(stack, "sonner built no positioned host");
      assert.equal(stack.getAttribute("data-y-position"), "top");
      assert.equal(stack.getAttribute("data-x-position"), "left");
      const style = stack.getAttribute("style") ?? "";
      const top = /--offset-top:\s*(\d+)px/.exec(style);
      assert.ok(top, `no top offset on the stack: ${style}`);
      assert.ok(Number(top[1]) >= 88, `the stack hangs ${top[1]}px from the top, under the header`);
    });
  } finally {
    globalThis.matchMedia = original;
  }
});

test("deskToast is callable with no host at all and does not throw", () => {
  assert.doesNotThrow(() => deskToast("Nowhere to draw this, but the call is safe."));
});
