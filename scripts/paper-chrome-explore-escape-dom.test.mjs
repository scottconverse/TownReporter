/*
  F12: Escape closes the open "Explore the publication" menu and leaves focus on
  the button that opened it.

  The walk pressed Esc while focus was on the toggle and the menu stayed open.
  `Masthead` in `src/components/paper-chrome.tsx` now listens on `document` while
  the menu is open. This test mounts the REAL component in the in-process DOM
  from `scripts/dom-harness.mjs`, presses the toggle, presses Esc, and checks
  both the closed state and that the toggle's own `focus()` was called.

  Blind spot: linkedom has no default action and no `KeyboardEvent`, so the
  keydown is a plain `Event` with `key` filled in, and focus is observed by
  watching the node's `focus` method rather than `document.activeElement`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");

const routerUrl = stubUrl(`
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
const location = { pathname: "/", search: {}, href: "/" };
export function useRouterState(options) {
  const state = { location };
  return options && options.select ? options.select(state) : state;
}
export function Link({ to, search, params, children, ...rest }) {
  return createElement("a", { href: String(to ?? "#"), ...rest }, children);
}
`);

const chromeBitsUrl = stubUrl(`
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
export function DarkModeButton() { return createElement("button", { type: "button" }, "Appearance"); }
export function ReadingButton() { return createElement("button", { type: "button" }, "Text size"); }
export function ReaderProvider({ children }) { return children; }
export function ReaderDialog({ children }) { return createElement("div", null, children); }
export function CopyButton() { return null; }
export const NAV_ID = "section-nav";
export function SectionNav({ menuOpen }) {
  return createElement("nav", { id: NAV_ID, "data-open": String(menuOpen) });
}
export function useReader() { return { saved: [], ready: true }; }
`);

const sharedUrl = stubUrl(`
export const APP_VERSION = "0.0.0-test";
export function usePaper() {
  return { name: "The Longmont Paper", city: "Longmont", state: "Colorado", location: "Longmont, Colorado" };
}
export function usePaperDateFormatters() {
  return { formatShortDate: () => "Sep 1, 2026", formatDayStamp: () => "Sep 1, 2026" };
}
export function usePublicSections() { return { sections: [] }; }
export function SignedIn({ children }) { return children; }
export function SignedOut({ children }) { return children; }
export function UserButton() { return null; }
export function useCurrentUserState() { return { user: null }; }
export function deskClaimState() { return null; }
export function createEditorCopy() { return {}; }
export function isMiscTopic() { return false; }
export const utilityBillAnalyzerUrl = "/utilities";
export function clearerViewSentence() { return ""; }
export function useQuery() { return { data: undefined, isError: false, refetch() {} }; }
`);

const imports = {
  "@tanstack/react-router": routerUrl,
  "@tanstack/react-query": sharedUrl,
  "@/lib/paper-context-state": sharedUrl,
  "@/lib/version": sharedUrl,
  "@/lib/auth/gates": sharedUrl,
  "@/lib/auth/use-current-user": sharedUrl,
  "@/lib/news/claim": sharedUrl,
  "@/lib/news/desk-copy": sharedUrl,
  "@/lib/use-sections": sharedUrl,
  "@/lib/news/section-types": sharedUrl,
  "@/lib/paper-identity": sharedUrl,
  "@/lib/paper-phrases": sharedUrl,
  "./reader-controls": chromeBitsUrl,
  "./section-nav": chromeBitsUrl,
  "./reader-context": chromeBitsUrl,
};

const { Masthead } = await import(await moduleUrl("src/components/paper-chrome.tsx", imports));

const live = [];
test.afterEach(async () => {
  for (const unmount of live.splice(0)) await unmount();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Masthead));
  });
  live.push(async () => {
    await React.act(async () => root.unmount());
    container.remove();
  });
  const toggle = [...container.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes("Explore the publication"),
  );
  assert.ok(toggle, "the masthead draws the Explore toggle");
  return { container, toggle };
}

async function press(node) {
  await React.act(async () => {
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

async function keydown(key) {
  const event = new window.Event("keydown", { bubbles: true });
  Object.defineProperty(event, "key", { value: key });
  await React.act(async () => {
    document.dispatchEvent(event);
  });
}

test("Escape closes the open menu and returns focus to the toggle", async () => {
  const { toggle } = await mount();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  await press(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "the toggle opened the menu");

  let focused = 0;
  toggle.focus = () => {
    focused += 1;
  };

  await keydown("Escape");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "Escape closed the menu");
  assert.equal(focused, 1, "focus went back to the menu button");
});

test("another key leaves the open menu alone", async () => {
  const { toggle } = await mount();
  await press(toggle);
  let focused = 0;
  toggle.focus = () => {
    focused += 1;
  };

  await keydown("Tab");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(focused, 0);
});

test("Escape after the menu is closed does not reopen or refocus", async () => {
  const { toggle } = await mount();
  let focused = 0;
  toggle.focus = () => {
    focused += 1;
  };

  await keydown("Escape");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(focused, 0, "the listener is only installed while the menu is open");
});
