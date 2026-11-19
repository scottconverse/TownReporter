/*
  F08 (Nov 19 walk): the Published screen's nav link to `#beat-memory` pointed
  at nothing. Beat memory is drawn in a CLOSED `<details>` at the foot of the
  list, so a link to the anchor left the editor at a shut box -- the walk called
  the link dead.

  The screen answers the hash in two places, and this test presses both:

    1. the router's own location (the "#beat-memory" link inside the app), read
       through `useLocation({select: location => location.hash})`;
    2. the browser's own `hashchange`, because a direct navigation to
       `…/desk/published#beat-memory` never passes through the router.

  The rest of the screen is stubbed by the shared harness: this is about the
  panel opening, not about the table.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");

const screen = await screenModule("src/routes/desk.published.tsx", {
  DeskShell: `({children}) => h("div", {}, children)`,
  Link: `({children}) => h("span", {}, children)`,
  // The screen reads the hash through the router's selector. The harness's
  // default `useLocation` returns `{hash:""}` whatever it is handed, so it has
  // to answer the selector for the router-driven half of the fix to be seen.
  useLocation: `(options) => {
    const location = { hash: globalThis.publishedHash || "" };
    return options && typeof options.select === "function" ? options.select(location) : location;
  }`,
});

/** The beat memory panel, as the screen draws it. */
const panel = () => document.querySelector("details.beat-memory");
const isOpen = () => Boolean(panel() && panel().hasAttribute("open"));

async function mount(t) {
  globalThis.screenData = {
    "my-desk": { role: "editor" },
    "published-desk": { rows: [], total: 0, counts: {} },
    memory: [{ id: 1, entity: "City Council", last_angle: "Budget", updated_at: "2026-11-01" }],
    "view-stats": { stories: [] },
  };
  globalThis.publishedHash = "";
  window.location.hash = "";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const draw = async () => {
    await act(async () => root.render(h(screen.Route.component)));
  };
  await draw();
  return { root, draw };
}

test("the Beat memory link opens the panel it names", async (t) => {
  const page = await mount(t);
  assert.ok(panel(), "the beat memory panel must be on the Published screen");
  assert.equal(isOpen(), false, "the panel starts closed");

  await t.test("the router's #beat-memory hash opens it", async () => {
    globalThis.publishedHash = "#beat-memory";
    await page.draw();
    assert.equal(isOpen(), true, "arriving with #beat-memory left the panel shut");
  });
});

test("a browser navigation to #beat-memory opens the panel without the router", async () => {
  // A fresh mount with no router hash: the browser's own event is the only
  // signal, exactly as it is for a typed URL or a Bookmark.
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  globalThis.screenData = {
    "my-desk": { role: "editor" },
    "published-desk": { rows: [], total: 0, counts: {} },
    memory: [],
    "view-stats": { stories: [] },
  };
  globalThis.publishedHash = "";
  window.location.hash = "";
  try {
    await act(async () => root.render(h(screen.Route.component)));
    assert.equal(isOpen(), false, "the panel starts closed");

    window.location.hash = "#beat-memory";
    await act(async () => {
      window.dispatchEvent(new window.Event("hashchange"));
    });
    assert.equal(isOpen(), true, "a hashchange to #beat-memory left the panel shut");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.location.hash = "";
  }
});
