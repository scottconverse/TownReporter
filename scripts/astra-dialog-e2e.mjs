#!/usr/bin/env node
/**
 * The shared dialog really opens, traps focus and closes on Escape.
 *
 * `src/components/dialog.tsx` is the one dialog the redesign asks for, and the
 * whole reason it is built on Radix rather than copied from the design
 * package's `desk/Dialog.jsx` is the three things the reference component
 * cannot do: trap focus, lock the page behind it, and hand focus back to the
 * control that opened it. Those are behavior, not markup, so nothing that
 * reads the source can prove them -- and this repository has no DOM test
 * environment (no jsdom, no happy-dom, no @testing-library), so there is no
 * unit-test route to them either.
 *
 * Hence a browser. The dialog is mounted by this script into a real page from
 * the running dev server, using the app's own module graph: the script asks
 * Vite for the transformed `dialog.tsx`, reads the exact React URL out of it,
 * and imports the component, React and React DOM from that same graph. That
 * matters more than it looks -- a second copy of React would make `useState`
 * throw, and importing `/node_modules/.vite/deps/react.js` without the hash
 * Vite appended would be a second copy.
 *
 * It mounts the component into the public front page rather than onto a desk
 * screen, because **no screen uses the dialog yet**: moving the desk's
 * existing dialogs onto it is phase 2 of the redesign, and adding a screen to
 * host this test would be exactly the new-screen change phase 0 is not
 * allowed to make. Nothing in the app is touched; the harness element and the
 * trigger button are created by this script and removed when it is done.
 *
 *   DIALOG_BASE_URL=http://127.0.0.1:8080 node scripts/astra-dialog-e2e.mjs
 */
import { chromium } from "playwright";

import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.DIALOG_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");

const done = [];
const step = (name, detail) => {
  done.push(name);
  console.log(`  ok    ${name}${detail ? ` -- ${detail}` : ""}`);
};

function fail(message) {
  console.error(`  FAIL  ${message}`);
  process.exit(1);
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(30_000);

console.log(`astra dialog: ${base}`);

await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
// The first `body > *` is a `<script>`, which never becomes "visible" -- wait
// for the page itself, so the stylesheet is in and the app's module graph is up.
await page.waitForFunction(() => document.querySelector("main, #root, header, footer") !== null);

// ── Mount the component, using the dev server's own module graph ────────────
const mountError = await page.evaluate(async () => {
  try {
    const source = await (await fetch("/src/components/dialog.tsx")).text();
    const reactUrl = source.match(
      /"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/,
    )?.[1];
    if (!reactUrl) return "the dev server did not serve /src/components/dialog.tsx with a react dep URL";

    // Vite serves these pre-bundled CJS deps as interop shims whose only export
    // is `default`; the real functions hang off that, not off the namespace.
    const reactMod = await import(reactUrl);
    const React = typeof reactMod.createElement === "function" ? reactMod : reactMod.default;
    const ReactDOM = (await import("/@id/react-dom/client")).default;
    const mod = await import("/src/components/dialog.tsx");
    if (typeof mod.Dialog !== "function") return "dialog.tsx does not export a Dialog function";
    if (typeof mod.ChoiceCard !== "function") return "dialog.tsx does not export a ChoiceCard function";
    if (typeof ReactDOM?.createRoot !== "function") return "/@id/react-dom/client has no createRoot";

    const host = document.createElement("div");
    host.id = "ba-dialog-host";
    const trigger = document.createElement("button");
    trigger.id = "ba-dialog-trigger";
    trigger.textContent = "open the dialog";
    document.body.append(trigger, host);

    const root = ReactDOM.createRoot(host);
    const h = (open) =>
      root.render(
        React.createElement(
          mod.Dialog,
          {
            open,
            onClose: () => {
              window.__baDialog.closed += 1;
              h(false);
            },
            title: "File this story?",
            subtitle: "The desk will publish it under your name.",
            footNote: "You can pull it back for an hour after filing.",
            primaryLabel: "File it",
            onPrimary: () => {},
            altLabel: "Save as draft",
            onAlt: () => {},
            cancelLabel: "Keep editing",
          },
          React.createElement(
            "div",
            { role: "radiogroup", "aria-label": "Where it goes" },
            React.createElement(mod.ChoiceCard, {
              label: "Front page",
              note: "Above the fold until tomorrow morning.",
              selected: true,
              onSelect: () => {},
            }),
            React.createElement(mod.ChoiceCard, {
              label: "The section",
              note: "With the rest of today's reporting.",
              selected: false,
              onSelect: () => {},
            }),
          ),
        ),
      );

    window.__baDialog = { closed: 0, setOpen: (v) => h(v) };
    h(false);
    return null;
  } catch (error) {
    return String(error && error.message ? error.message : error);
  }
});
if (mountError) fail(`could not mount the dialog in the page: ${mountError}`);
step("the dialog component mounts from the dev server's module graph");

// ── It opens ───────────────────────────────────────────────────────────────
await page.evaluate(() => {
  document.getElementById("ba-dialog-trigger").focus();
  window.__baDialog.setOpen(true);
});
await page.waitForSelector('[role="dialog"]', { state: "visible" });
const opened = await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"]');
  const title = el.querySelector("h2");
  const style = getComputedStyle(el);
  const trigger = document.getElementById("ba-dialog-trigger");
  return {
    role: el.getAttribute("role"),
    labelled: el.getAttribute("aria-labelledby") === title?.id,
    title: title?.textContent?.trim(),
    // Radix's modal behavior is `aria-hidden` on everything else in the body
    // (plus a FocusScope), not an `aria-modal` attribute -- so this is what
    // "modal" looks like here. The trigger stands in for the rest of the page.
    pageHidden: trigger.getAttribute("aria-hidden"),
    width: style.width,
    border: style.borderTopWidth,
    radius: style.borderTopLeftRadius,
    background: style.backgroundColor,
    color: style.color,
    buttons: [...el.querySelectorAll("button")].map((b) => b.textContent.trim()),
  };
});
if (opened.role !== "dialog") fail(`the open dialog has role="${opened.role}"`);
if (opened.pageHidden !== "true") {
  fail("the page behind the dialog is still exposed to assistive tech -- the dialog is not modal");
}
if (opened.title !== "File this story?") fail(`the dialog title renders as "${opened.title}"`);
if (!opened.labelled) fail("the dialog is not labelled by its own title");
for (const label of ["✕", "Keep editing", "Save as draft", "File it"]) {
  if (!opened.buttons.includes(label)) fail(`the footer is missing its "${label}" action`);
}
if (opened.width !== "820px") fail(`the panel is ${opened.width} wide, not the design's 820px`);
if (opened.border !== "2px") fail(`the panel border is ${opened.border}, not 2px`);
if (opened.radius !== "0px") fail(`the panel has a ${opened.radius} corner radius`);
step("clicking opens it, with the design's 820px panel and its four actions");

// The palette has to survive the portal: `document.body` is outside the desk
// shell, so `desk-ltr astra-modal-layer` is what puts the desk's tokens on
// this layer at all. Read from the desk's dark, which is the theme the editor
// actually works in.
const dark = await page.evaluate(() => {
  // Read in the same task as the write, on purpose: after hydration
  // `src/lib/appearance-context.ts` owns this attribute and re-stamps it from
  // the app's own state, so an attribute set and then awaited would be reverted
  // out from under the measurement. Computed style forces a synchronous
  // restyle, so there is nothing to wait for.
  const before = document.documentElement.getAttribute("data-appearance");
  document.documentElement.setAttribute("data-appearance", "desk-dark");
  const style = getComputedStyle(document.querySelector(".astra-modal"));
  const scrim = getComputedStyle(document.querySelector(".astra-modal-scrim"));
  const backdrop = document.querySelector(".desk-ltr.astra-modal-layer");
  const out = {
    matched: backdrop.matches(':root[data-appearance="desk-dark"] .desk-ltr.astra-modal-layer'),
    background: style.backgroundColor,
    color: style.color,
    layerBackground: getComputedStyle(backdrop).backgroundColor,
    scrim: scrim.backgroundColor,
  };
  if (before === null) document.documentElement.removeAttribute("data-appearance");
  else document.documentElement.setAttribute("data-appearance", before);
  return out;
});
if (!dark.matched) fail("the dark palette rule does not reach the portaled layer");
if (dark.background !== "rgb(27, 25, 22)") {
  fail(`the dialog panel is ${dark.background} in dark mode, not the desk's warm black #1b1916`);
}
if (dark.color !== "rgb(232, 230, 225)") {
  fail(`the dialog text is ${dark.color} in dark mode, not #e8e6e1`);
}
if (dark.layerBackground !== "rgba(0, 0, 0, 0)") {
  fail(`the portal layer paints ${dark.layerBackground} -- it should be transparent, the scrim paints the dimming`);
}
step("in dark mode the portaled panel is the desk's warm black on #e8e6e1", dark.scrim);

// ── It traps focus ─────────────────────────────────────────────────────────
// Real key presses, one at a time, so each Tab is answered by the browser the
// way a keyboard user's would be -- Radix's FocusScope works by intercepting
// the focus as it arrives at the edges of the dialog.
const focusables = await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"]');
  return [...el.querySelectorAll("button, [href], input, select, textarea, [tabindex]")].filter(
    (n) => n.tabIndex >= 0 && !n.disabled,
  ).length;
});
if (focusables < 4) fail(`only ${focusables} focusable controls inside the dialog; the trap is not being exercised`);

const stopAt = () =>
  page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    if (!el) return "gone";
    if (!el.contains(document.activeElement)) return "outside";
    const all = [...el.querySelectorAll("button, [href], input, select, textarea, [tabindex]")].filter(
      (n) => n.tabIndex >= 0 && !n.disabled,
    );
    return all.indexOf(document.activeElement);
  });

const stops = [];
for (let i = 0; i < focusables + 1; i += 1) {
  await page.keyboard.press("Tab");
  const at = await stopAt();
  if (at === "outside") fail(`Tab press ${i + 1} moved focus outside the dialog`);
  if (at === "gone") fail(`Tab press ${i + 1} closed the dialog`);
  stops.push(at);
}
const distinct = new Set(stops);
if (distinct.size < focusables) {
  fail(`Tab visited only ${distinct.size} of the dialog's ${focusables} controls (${stops.join(",")})`);
}
if (stops[stops.length - 1] !== stops[0]) {
  fail(`Tab did not wrap back to the first control (started ${stops[0]}, ended ${stops[stops.length - 1]})`);
}
await page.keyboard.press("Shift+Tab");
const back = await stopAt();
if (back === "outside" || back === "gone") fail("Shift+Tab moved focus outside the dialog");
if (back !== stops[stops.length - 2]) {
  fail(`Shift+Tab did not step back to the previous control (${back} vs ${stops[stops.length - 2]})`);
}
step(`Tab cycles the dialog's ${focusables} controls and wraps, and Shift+Tab steps back (${stops.join(",")})`);

// ── It locks the page behind it ────────────────────────────────────────────
const locked = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  return { overflow: body.overflow, position: body.position, inline: document.body.style.overflow };
});
if (!locked.overflow.includes("hidden") && !locked.position.includes("fixed")) {
  fail(`the page behind the dialog is still scrollable (body overflow: ${locked.overflow})`);
}
step(`the page behind it does not scroll (body overflow: ${locked.overflow})`);

// ── It closes on Escape, and gives focus back ──────────────────────────────
await page.keyboard.press("Escape");
await page.waitForSelector('[role="dialog"]', { state: "detached" });
// Radix tears the modal down in a `setTimeout(..., 0)` -- the FocusScope's
// unmount dispatch and the scroll-lock removal both land there -- and focus
// return happens inside that teardown, not at the moment the content leaves the
// DOM. So let one macrotask pass: the same tick a keyboard user's next keypress
// would arrive after, not a wait for the thing being asserted.
await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
const after = await page.evaluate(() => ({
  closed: window.__baDialog.closed,
  focus: document.activeElement?.id || document.activeElement?.tagName,
  portal: document.querySelectorAll(".desk-ltr.astra-modal-layer").length,
  bodyOverflow: getComputedStyle(document.body).overflow,
  pageHidden: document.getElementById("ba-dialog-trigger").getAttribute("aria-hidden"),
}));if (after.closed !== 1) fail(`Escape called onClose ${after.closed} times, expected once`);
if (after.focus !== "ba-dialog-trigger") {
  fail(`focus went to "${after.focus}" after closing, not back to the control that opened it`);
}
if (after.portal !== 0) fail(`${after.portal} portal wrappers were left behind in the body`);
if (after.bodyOverflow.includes("hidden")) fail("the page is still scroll-locked after the dialog closed");
if (after.pageHidden !== null) fail("the page behind the dialog is still hidden from assistive tech after it closed");
step("Escape closes it, returns focus to its trigger, and unlocks the page");

await page.evaluate(() => {
  document.getElementById("ba-dialog-host")?.remove();
  document.getElementById("ba-dialog-trigger")?.remove();
});
await browser.close();
console.log(`astra dialog: ${done.length} checks passed`);
