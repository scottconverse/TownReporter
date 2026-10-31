import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { inlineModule, moduleUrl, pageImports, realModule } from "./article-page-render.mjs";

/*
  The archive's Save control is text until it is pressed, then a filled check.
  This renders the real `SaveStory` from reader-controls.tsx with the real
  reader context and presses the button, so the assertion covers the state
  change a reader gets -- not merely the class name written in the source.
*/

const { window } = parseHTML("<!doctype html><html><body></body></html>");
Object.defineProperty(window, "location", {
  value: new URL("http://localhost/"),
  configurable: true,
});
globalThis.window = window;
globalThis.document = window.document;
for (const name of [
  "HTMLElement",
  "HTMLIFrameElement",
  "Node",
  "Element",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  if (window[name] !== undefined) globalThis[name] = window[name];
}
try {
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
} catch {
  // Node's navigator is sufficient for React DOM.
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;

const readerContextUrl = await realModule("../src/components/reader-context.ts");
const dialogStub = inlineModule(`export function NativeDialog() { return null; }`);
const routerStub = inlineModule(`
  import { createElement } from "react";
  export function Link({ to, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
`);
const paperContextStub = inlineModule(`
  export function usePaper() { return { name: "The Paper", city: "Longmont" }; }
  export function usePaperDateFormatters() { return { formatShortDate: () => "September 1, 2026" }; }
`);
const beaconStub = inlineModule(`export function sendTrustEvent() {}`);
const sectionsStub = inlineModule(
  `export function usePublicSections() { return { sections: [] }; }`,
);
const sectionTypesStub = inlineModule(`export function isMiscTopic() { return false; }`);
const dekStub = inlineModule(`export function dekOrFallback(dek, body) { return dek || body; }`);
const readerStub = inlineModule(`
  export function normalizeReaderSize(size) { return size === 23 ? 23 : 19; }
  export function readMinutes() { return 4; }
  export function readerStorageKey(name, city) { return name + ":" + city; }
`);
const appearanceStub = inlineModule(`
  export function readReaderMode() { return "light"; }
  export function readStoredReaderMode() { return undefined; }
`);
const appearanceContextStub = inlineModule(`
  export function useAppearance() { return { appearance: { reader: "light" }, refreshReader() {} }; }
  export function useHydrated() { return true; }
`);

const controlsUrl = moduleUrl(
  await readFile(new URL("../src/components/reader-controls.tsx", import.meta.url), "utf8"),
  "reader-controls.tsx",
  {
    ...pageImports,
    "@/components/dialog": dialogStub,
    "@/components/read-beacon-send": beaconStub,
    "@/components/reader-context": readerContextUrl,
    "@/lib/use-sections": sectionsStub,
    "@/lib/news/section-types": sectionTypesStub,
    "@/lib/news/dek-fallback": dekStub,
    "@/lib/reader": readerStub,
    "@/lib/appearance": appearanceStub,
    "@/lib/appearance-context": appearanceContextStub,
    "@/lib/paper-context-state": paperContextStub,
    "@tanstack/react-router": routerStub,
  },
);
const { SaveStory } = await import(controlsUrl);
const { ReaderContext, readerDefaults } = await import(readerContextUrl);

function Harness() {
  const [state, setState] = React.useState({ ...readerDefaults, ready: true });
  return React.createElement(
    ReaderContext.Provider,
    {
      value: {
        ...state,
        update(value) {
          setState((current) => ({ ...current, ...value }));
        },
        notify() {},
      },
    },
    React.createElement(SaveStory, {
      archive: true,
      story: { slug: "archive-story", headline: "A story in the archive" },
    }),
  );
}

test("the archive Save button changes label and state when pressed", async () => {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(Harness));
  });

  let button = container.querySelector("button");
  assert.ok(button, "the archive control renders a button");
  assert.equal(button.textContent.trim(), "Save");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.getAttribute("data-state"), "save");
  assert.equal(button.getAttribute("aria-label"), "Save story: A story in the archive");
  assert.equal(button.querySelector("svg"), null);

  await act(async () => {
    button.click();
  });

  button = container.querySelector("button");
  assert.equal(button.textContent.trim(), "");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.getAttribute("data-state"), "saved");
  assert.equal(button.getAttribute("aria-label"), "Remove saved story: A story in the archive");
  assert.match(button.getAttribute("class") || "", /is-saved/);
  assert.match(button.querySelector("svg")?.getAttribute("class") || "", /lucide-check/);

  await act(async () => root.unmount());
  container.remove();
});
