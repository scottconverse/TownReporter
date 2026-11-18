/*
  The registry import panel, mounted and pressed (spec 24, Phase 2).

  WHAT THIS PROVES. Import cannot be pressed until a Preview of exactly this
  file and this directory name has come back good; changing either clears the
  preview; a file with problems lists them and never reaches the import call;
  and the results screen shows the counts the server returned. While an import
  runs, the file and name inputs are disabled and a double press sends one
  import; a thrown import error says it may or may not have finished, and the
  desk lists are refreshed after every import outcome.

  The server functions are stubs that record their calls (what the panel ASKED
  the server to do is what this file measures; what the server does with it is
  in registry-desk-write.server.test.ts). `@tanstack/react-query` and the panel
  are the real ones, in the in-process DOM (scripts/dom-harness.mjs). linkedom
  has no default action, so inputs are driven by calling their React `onChange`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

const chromeUrl = stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
export function InkButton({ children, onClick, disabled, pending, pendingLabel }) {
  return h("button", { type: "button", disabled: Boolean(disabled || pending), onClick },
    pending && pendingLabel ? pendingLabel : children);
}
`);

/* The stubs read their next answer from globalThis.__import, set per test. */
const writeUrl = stubUrl(`
export async function previewHsdsImport({ data }) {
  globalThis.__import.calls.push(["preview", data]);
  return globalThis.__import.preview(data);
}
export async function runHsdsImport({ data }) {
  globalThis.__import.calls.push(["import", data]);
  return globalThis.__import.run(data);
}
`);

const panelUrl = await moduleUrl("src/components/registry-import-panel.tsx", {
  "@/components/desk-chrome": chromeUrl,
  "@/lib/news/registry/registry-desk-write": writeUrl,
});
const { RegistryImportPanel } = await import(panelUrl);

const counts = (inserted, unchanged, changed, alreadyPending) => ({
  inserted,
  unchanged,
  changed,
  alreadyPending,
});
const summary = {
  tables: {
    taxonomies: counts(1, 0, 0, 0),
    organizations: counts(2, 3, 1, 0),
    services: counts(4, 0, 0, 2),
    locations: counts(0, 0, 0, 0),
  },
  conflicts: [
    {
      entity_type: "organization",
      entity_id: 5,
      hsds_id: "org-9",
      field_name: "name",
      before_value: "Old Name",
      after_value: "New Name",
    },
  ],
};
const goodPreview = (existingRows) => ({
  ok: true,
  directoryName: "county-211",
  existingRows,
  looksLikeNewDirectory: existingRows === 0,
  summary,
});

function setup() {
  globalThis.__import = {
    calls: [],
    preview: async () => goodPreview(0),
    run: async (data) => ({ ok: true, directoryName: data.directoryName, importId: 1, summary }),
  };
}

async function mount(names = ["county-211", "Other"]) {
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  // Every invalidateQueries call the panel makes, as the JSON of its query key.
  const invalidated = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters, ...rest) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return invalidate(filters, ...rest);
  };
  const root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(RegistryImportPanel, { directoryNames: names }),
      ),
    ),
  );
  const props = (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))];
  const api = {
    container,
    invalidated,
    text: () => container.textContent.replace(/\s+/g, " "),
    button: (label) => [...container.querySelectorAll("button")].find((b) => b.textContent === label),
    fileInput: () => container.querySelector('input[type="file"]'),
    nameInput: () => container.querySelector('input:not([type="file"])'),
    /* Let queued TanStack notifications and React work run to the end. */
    async settle() {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async pickFile(file) {
      const input = container.querySelector('input[type="file"]');
      await React.act(async () => {
        await props(input).onChange({ target: { files: file ? [file] : [] } });
      });
    },
    async typeName(value) {
      const input = container.querySelector('input:not([type="file"])');
      await React.act(async () => props(input).onChange({ target: { value } }));
    },
    async press(label) {
      const button = api.button(label);
      await React.act(async () => {
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      client.clear();
      container.remove();
    },
  };
  return api;
}

const jsonFile = (text, name = "bundle.json", size = text.length) => ({
  name,
  size,
  text: async () => text,
});

const importCalls = () => globalThis.__import.calls.filter((c) => c[0] === "import").length;

test("Import waits for a good preview of this file and this name", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  assert.match(page.text(), /A JSON file in the HSDS bundle shape\. Other formats are not read\./);
  assert.match(page.text(), /Importing does not publish anything\./);
  assert.match(page.text(), /how a repeat import finds the same rows/);
  assert.equal(page.container.querySelectorAll("datalist option").length, 2);
  assert.equal(page.button("Preview").disabled, true, "Preview needs a file and a name");
  assert.equal(page.button("Import").disabled, true);

  await page.pickFile(jsonFile('{"organizations":[]}'));
  assert.equal(page.button("Preview").disabled, true, "still no name");
  await page.typeName("county-211");
  assert.equal(page.button("Preview").disabled, false);
  assert.equal(page.button("Import").disabled, true, "no preview yet");

  await page.press("Import");
  assert.equal(globalThis.__import.calls.length, 0, "a disabled Import reached the server");

  await page.press("Preview");
  assert.deepEqual(
    globalThis.__import.calls.map((c) => c[0]),
    ["preview"],
  );
  assert.deepEqual(globalThis.__import.calls[0][1], {
    json: '{"organizations":[]}',
    directoryName: "county-211",
  });
  assert.match(page.text(), /This looks like a new directory/);
  assert.match(page.text(), /Organizations/);
  assert.match(page.text(), /Old Name/);
  assert.match(page.text(), /New Name/);
  assert.equal(page.button("Import").disabled, false, "a good preview enables Import");

  await page.press("Import");
  assert.deepEqual(
    globalThis.__import.calls.map((c) => c[0]),
    ["preview", "import"],
  );
  assert.match(page.text(), /Imported county-211\. Nothing was published\./);
  assert.equal(page.button("Import").disabled, true, "Import is spent until a new preview");
});

test("a repeat directory says how many rows match earlier imports", async (t) => {
  setup();
  globalThis.__import.preview = async () => goodPreview(12);
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  assert.match(page.text(), /12 rows match earlier imports of this directory/);
});

test("changing the file or the name clears the preview", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  assert.equal(page.button("Import").disabled, false);

  await page.pickFile(jsonFile('{"organizations":[1]}', "other.json"));
  assert.equal(page.button("Import").disabled, true, "a new file kept the old preview");
  assert.doesNotMatch(page.text(), /Preview of county-211/);

  await page.typeName("county-211");
  await page.press("Preview");
  assert.equal(page.button("Import").disabled, false);
  await page.typeName("county-211 b");
  assert.equal(page.button("Import").disabled, true, "a new name kept the old preview");
  assert.doesNotMatch(page.text(), /Preview of county-211/);
  assert.equal(importCalls(), 0);
});

test("a file with problems lists them and never reaches the import call", async (t) => {
  setup();
  globalThis.__import.preview = async () => ({
    ok: false,
    problems: ["organizations[1].services[0]: name is missing"],
  });
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  assert.match(page.text(), /organizations\[1\]\.services\[0\]: name is missing/);
  assert.match(page.text(), /Nothing was imported\./);
  assert.ok(page.container.querySelector('[role="alert"]'));
  assert.equal(page.button("Import").disabled, true);
  await page.press("Import");
  assert.equal(importCalls(), 0);
});

test("a file over 8 MB or not JSON is refused before upload", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}", "big.json", 8 * 1024 * 1024 + 1));
  assert.match(page.text(), /larger than 8 MB/);
  await page.typeName("county-211");
  assert.equal(page.button("Preview").disabled, true, "an oversize file was accepted");

  await page.pickFile(jsonFile("a,b", "list.csv"));
  assert.match(page.text(), /not a JSON file/);
  assert.equal(page.button("Preview").disabled, true);
  assert.equal(globalThis.__import.calls.length, 0);
});

test("the results show the counts the server returned", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.press("Import");
  const results = page.container.querySelector('[aria-label="Import results"]');
  assert.ok(results, "no results panel");
  const rows = [...results.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.children].map((cell) => cell.textContent),
  );
  assert.deepEqual(rows, [
    ["Categories", "1", "0", "0", "0"],
    ["Organizations", "2", "3", "1", "0"],
    ["Services", "4", "0", "0", "2"],
  ]);
  assert.match(results.textContent, /1 difference from what is stored/);
});

test("an import the server refuses shows its problems and says nothing was imported", async (t) => {
  setup();
  globalThis.__import.run = async () => ({ ok: false, problems: ["directory name: taken"] });
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.press("Import");
  assert.match(page.text(), /directory name: taken/);
  assert.match(page.text(), /Nothing was imported\./);
  assert.equal(page.container.querySelector('[aria-label="Import results"]'), null);
});

test("a server error says nothing was imported", async (t) => {
  setup();
  globalThis.__import.preview = async () => {
    throw new Error("The server is down.");
  };
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  assert.match(page.text(), /The server is down\. Nothing was imported\./);
  assert.equal(page.button("Import").disabled, true);
});

test("while an import runs, the file and the name inputs are disabled", async (t) => {
  setup();
  let finish;
  globalThis.__import.run = (data) =>
    new Promise((resolve) => {
      finish = () => resolve({ ok: true, directoryName: data.directoryName, importId: 1, summary });
    });
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.press("Import");
  await page.settle();
  assert.equal(page.fileInput().hasAttribute("disabled"), true, "the file input stayed enabled");
  assert.equal(page.nameInput().hasAttribute("disabled"), true, "the name input stayed enabled");

  await React.act(async () => finish());
  await page.settle();
  assert.equal(page.fileInput().hasAttribute("disabled"), false);
  assert.equal(page.nameInput().hasAttribute("disabled"), false);
  assert.match(page.text(), /Imported county-211\. Nothing was published\./);
  assert.ok(page.invalidated.includes('["registry-desk"]'), "the desk lists were not refreshed");
});

test("a server refusal also refreshes the desk lists", async (t) => {
  setup();
  globalThis.__import.run = async () => ({ ok: false, problems: ["directory name: taken"] });
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.press("Import");
  assert.match(page.text(), /directory name: taken/);
  assert.ok(page.invalidated.includes('["registry-desk"]'), "the desk lists were not refreshed");
});

test("an import that throws says it may or may not have finished, and clears the preview", async (t) => {
  setup();
  globalThis.__import.run = async () => {
    throw new Error("The connection dropped.");
  };
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.press("Import");
  await page.settle();
  assert.match(page.text(), /The connection dropped\./);
  assert.match(page.text(), /may or may not have finished/);
  assert.match(page.text(), /Check the Imports list below before trying again/);
  assert.doesNotMatch(page.text(), /Nothing was imported/, "an unknown outcome was called a failure");
  assert.equal(page.button("Import").disabled, true, "Import stayed enabled after an unknown outcome");
  assert.ok(page.invalidated.includes('["registry-desk"]'), "the desk lists were not refreshed");
});

test("a double click on Import sends one import", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  const button = page.button("Import");
  // Both clicks land before React has rendered the pending state.
  await React.act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await page.settle();
  assert.equal(importCalls(), 1, "a double click sent the import more than once");
});

test("a preview that comes back after the name or the file changed is ignored", async (t) => {
  setup();
  let answer;
  globalThis.__import.preview = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  const page = await mount();
  t.after(() => page.close());
  await page.pickFile(jsonFile("{}"));
  await page.typeName("county-211");
  await page.press("Preview");
  await page.typeName("county-211 b");
  await React.act(async () => answer(goodPreview(0)));
  assert.doesNotMatch(page.text(), /Preview of county-211/);
  assert.equal(page.button("Import").disabled, true, "a late preview enabled Import");

  await page.typeName("county-211");
  await page.press("Preview");
  await page.pickFile(jsonFile('{"organizations":[1]}', "other.json"));
  await React.act(async () => answer(goodPreview(0)));
  assert.doesNotMatch(page.text(), /Preview of county-211/);
  assert.equal(page.button("Import").disabled, true, "a late preview for a replaced file enabled Import");
  assert.equal(importCalls(), 0);
});

test("a name typed while the file is still being read keeps the file", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  let release;
  const slow = {
    name: "bundle.json",
    size: 2,
    text: () =>
      new Promise((resolve) => {
        release = () => resolve('{"organizations":[]}');
      }),
  };
  await page.pickFile(slow);
  await page.typeName("county-211");
  await React.act(async () => release());
  assert.equal(page.button("Preview").disabled, false, "the name edit dropped the file");
  await page.press("Preview");
  assert.deepEqual(globalThis.__import.calls[0][1], {
    json: '{"organizations":[]}',
    directoryName: "county-211",
  });
});

test("a second file pick wins over a file that is still being read", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  let releaseFirst;
  const first = {
    name: "first.json",
    size: 2,
    text: () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve('{"first":true}');
      }),
  };
  await page.pickFile(first);
  await page.pickFile(jsonFile('{"second":true}', "second.json"));
  await React.act(async () => releaseFirst());
  await page.typeName("county-211");
  await page.press("Preview");
  assert.deepEqual(globalThis.__import.calls[0][1], {
    json: '{"second":true}',
    directoryName: "county-211",
  });
});
