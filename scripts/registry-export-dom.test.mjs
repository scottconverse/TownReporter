/*
  The registry export panel, mounted and pressed (spec 24, Phase 4, job C).

  WHAT THIS PROVES. Each directory has a "Download directory file" button; pressing
  it asks the server for that directory, hands the returned text to the browser as
  a file (an object URL that is revoked afterward), and says "Downloaded <file
  name>.". A refusal or a thrown error says "The file could not be made. Nothing
  was changed." and downloads nothing. The status line takes focus.

  The server function is a stub that records its calls; what the server puts in
  the file is measured in registry-export.server.test.ts. The panel and
  `@tanstack`-free React are the real ones, in the in-process DOM
  (scripts/dom-harness.mjs).
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");

/* linkedom does not move focus; record it, as registry-review-dom.test.mjs does. */
let focused = null;
const takeFocus = (element) => {
  focused = element;
};
window.HTMLElement.prototype.focus = function focus() {
  takeFocus(this);
};
Object.defineProperty(document, "activeElement", {
  configurable: true,
  get: () => (focused && focused.isConnected ? focused : document.body),
});

const chromeUrl = stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
export function InkButton({ children, onClick, disabled, pending, pendingLabel, ariaLabel }) {
  return h("button", { type: "button", disabled: Boolean(disabled || pending), onClick, "aria-label": ariaLabel },
    pending && pendingLabel ? pendingLabel : children);
}
`);
const writeUrl = stubUrl(`
export async function exportRegistryDirectory({ data }) {
  globalThis.__export.calls.push(data);
  return globalThis.__export.answer(data);
}
`);
const panelUrl = await moduleUrl("src/components/registry-export-panel.tsx", {
  "@/components/desk-chrome": chromeUrl,
  "@/lib/news/registry/registry-desk-write": writeUrl,
});
const { RegistryExportPanel } = await import(panelUrl);

function setup(answer) {
  globalThis.__export = { calls: [], answer };
  const saved = { blobs: [], revoked: [], downloads: [] };
  globalThis.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type;
    }
  };
  globalThis.URL.createObjectURL = (blob) => {
    saved.blobs.push(blob);
    return `blob:test/${saved.blobs.length}`;
  };
  globalThis.URL.revokeObjectURL = (url) => saved.revoked.push(url);
  // linkedom has no default action for a click on a link: record the download.
  const create = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const node = create(tag, ...rest);
    if (String(tag).toLowerCase() === "a") {
      node.click = () => saved.downloads.push({ href: node.href ?? node.getAttribute("href"), name: node.download ?? node.getAttribute("download") });
    }
    return node;
  };
  return saved;
}

async function mount(names = ["county-211", "Other"]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () =>
    root.render(React.createElement(RegistryExportPanel, { directoryNames: names })),
  );
  return {
    container,
    text: () => container.textContent.replace(/\s+/g, " "),
    buttons: () => [...container.querySelectorAll("button")],
    status: () => container.querySelector('[data-testid="export-status"]'),
    async press(index) {
      await React.act(async () => {
        container.querySelectorAll("button")[index].dispatchEvent(
          new window.Event("click", { bubbles: true }),
        );
      });
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

test("a directory file is downloaded and the status says so", async (t) => {
  const saved = setup(async (data) => ({
    ok: true,
    directoryName: data.directoryName,
    fileName: "directory-county-211-2026-11-18.json",
    json: '{"organizations":[]}\n',
  }));
  const page = await mount();
  t.after(() => page.close());

  assert.equal(page.buttons().length, 2, "one button per directory");
  assert.deepEqual(
    page.buttons().map((b) => b.textContent),
    ["Download directory file", "Download directory file"],
  );
  await page.press(0);

  assert.deepEqual(globalThis.__export.calls, [{ directoryName: "county-211" }]);
  assert.equal(saved.blobs.length, 1);
  assert.deepEqual(saved.blobs[0].parts, ['{"organizations":[]}\n']);
  assert.equal(saved.blobs[0].type, "application/json");
  assert.equal(saved.downloads.length, 1);
  assert.equal(saved.downloads[0].name, "directory-county-211-2026-11-18.json");
  assert.deepEqual(saved.revoked, [], "the object URL is not revoked in the click's own tick");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(saved.revoked, ["blob:test/1"], "the object URL is let go afterward");
  assert.equal(page.status().textContent, "Downloaded directory-county-211-2026-11-18.json.");
  assert.equal(page.status().getAttribute("role"), "status");
  assert.ok(page.status().className.includes("text-base"));
  assert.ok(document.activeElement === page.status(), "focus goes to the status line");
});

test("a refusal says the file could not be made and downloads nothing", async (t) => {
  const saved = setup(async () => ({ ok: false, message: "That directory is not in this newsroom." }));
  const page = await mount();
  t.after(() => page.close());
  await page.press(1);
  assert.equal(page.status().textContent, "The file could not be made. Nothing was changed.");
  assert.equal(page.status().getAttribute("role"), "alert");
  assert.equal(saved.blobs.length, 0);
  assert.equal(saved.downloads.length, 0);
  assert.ok(document.activeElement === page.status(), "focus goes to the status line");
});

test("a thrown error says the same and leaves the button usable", async (t) => {
  const saved = setup(async () => {
    throw new Error("network down");
  });
  const page = await mount();
  t.after(() => page.close());
  await page.press(0);
  assert.equal(page.status().textContent, "The file could not be made. Nothing was changed.");
  assert.equal(saved.downloads.length, 0);
  assert.equal(page.buttons()[0].disabled, false);
});

test("a desk with no directory says there is nothing to download", async (t) => {
  setup(async () => ({ ok: false, message: "" }));
  const page = await mount([]);
  t.after(() => page.close());
  assert.equal(page.buttons().length, 0);
  assert.match(page.text(), /nothing to download/);
});
