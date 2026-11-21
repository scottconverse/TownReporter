/*
  The registry desk's review controls, Verify form and Needs checking list,
  mounted and used (spec 24, Phase 3, job C).

  WHAT THIS PROVES.
  Change list: buttons show only on a waiting row ("pending" or "needs-editor");
  a stale row says what the field says now and what the proposal expected and
  does not offer Accept and apply; a row with no live target offers only Accept
  without applying and Reject; a decided row shows reviewer, time, applied time
  (or "Not applied") and note, with no buttons; the note goes to the server;
  each refusal message is shown as the server said it; the list is refreshed
  after an answer; focus moves to the status line.
  Verify form: an empty basis and a bad link are refused on screen and never
  reach the server; a good form is sent, clears, and the new latest check shows;
  a server refusal shows in a status line; history shows the latest, the older
  ones newest first, the legacy date with its label, "Changed since verified"
  and "Not verified yet.".
  Needs checking: rows with reasons and an open button; the empty state.
  Desk page: the route (desk.registry.tsx) is rendered with its own imports
  stubbed, so the filter that can empty the list is the page's own code. A
  refresh that fails after an answer never replaces the answer; a thrown call
  still refreshes the list; a field's error sits outside its label and is linked
  to its control; two quick clicks send one call.

  The server functions are stubs that record their calls (what the page ASKED
  the server to do is measured here; what the server does is in
  registry-review.server.test.ts and registry-verify.server.test.ts). React,
  react-query and the components are real, in the in-process DOM.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

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
export function InkButton({ children, onClick, disabled, pending, pendingLabel, type, ariaLabel }) {
  return h("button", { type: type || "button", disabled: Boolean(disabled || pending), onClick, "aria-label": ariaLabel },
    pending && pendingLabel ? pendingLabel : children);
}
export function DeskShell({ children }) { return h("div", null, children); }
export function SecHead({ title, sub }) { return h("div", { "data-sec": title }, h("h2", null, title), sub ? h("p", null, sub) : null); }
`);
const reviewServerUrl = stubUrl(`
export async function acceptRegistryChange({ data }) {
  globalThis.__rv.calls.push(["accept", data]);
  return globalThis.__rv.review(data);
}
export async function rejectRegistryChange({ data }) {
  globalThis.__rv.calls.push(["reject", data]);
  return globalThis.__rv.review(data);
}
`);
const verifyServerUrl = stubUrl(`
export async function readRegistryVerification({ data }) {
  globalThis.__rv.calls.push(["read", data]);
  return globalThis.__rv.verification;
}
export async function recordRegistryVerification({ data }) {
  globalThis.__rv.calls.push(["record", data]);
  return globalThis.__rv.record(data);
}
export async function listRegistryNeedsChecking() {
  globalThis.__rv.calls.push(["needs-checking"]);
  return globalThis.__rv.needsChecking;
}
`);
const paperUrl = stubUrl(`
const at = (v) => (v ? "on " + String(v).slice(0, 10) : "");
export function usePaperDateFormatters() {
  return { formatListDateTime: at, formatShortDate: at };
}
`);
const methodsUrl = await moduleUrl("src/lib/news/registry/registry-verify-methods.ts");
const sentenceUrl = await moduleUrl("src/lib/news/registry/registry-sentence.ts");
const imports = {
  "@/components/desk-chrome": chromeUrl,
  "@/lib/news/registry/registry-review": reviewServerUrl,
  "@/lib/news/registry/registry-verify": verifyServerUrl,
  "@/lib/news/registry/registry-verify-methods": methodsUrl,
  "@/lib/news/registry/registry-sentence": sentenceUrl,
  "@/lib/paper-context-state": paperUrl,
  "@/lib/news/list-window": await moduleUrl("src/lib/news/list-window.ts"),
  "@/lib/news/registry/registry-proposal-facts": await moduleUrl(
    "src/lib/news/registry/registry-proposal-facts.ts",
  ),
  "@/lib/news/registry/registry-entry-copy": await moduleUrl(
    "src/lib/news/registry/registry-entry-copy.ts",
  ),
};
// The desk page's cards are real here: they are plain markup and the page's
// data decides what they say (scripts/registry-human-desk-dom.test.mjs covers
// their contents).
imports["@/components/registry-entry-card"] = await moduleUrl(
  "src/components/registry-entry-card.tsx",
  imports,
);
const changeReviewUrl = await moduleUrl("src/components/registry-change-review.tsx", imports);
const { RegistryChangeReviewList } = await import(changeReviewUrl);
const { RegistryVerificationPanel } = await import(
  await moduleUrl("src/components/registry-verification-panel.tsx", imports)
);
const { RegistryNeedsChecking } = await import(
  await moduleUrl("src/components/registry-needs-checking.tsx", imports)
);

/* The desk page (desk.registry.tsx): its own imports are stubbed, its own code is real. */
const deskStubs = {
  "@tanstack/react-router": stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
export function createFileRoute() {
  return (options) => ({ ...options, useSearch: () => globalThis.__desk.search });
}
export function Link({ to, className, children }) {
  return h("a", { href: to, className }, children);
}
`),
  "@/components/states": stubUrl(`
export function ScreenError() { return null; }
export function ListSkeleton() { return null; }
`),
  "@/components/registry-import-panel": stubUrl("export function RegistryImportPanel() { return null; }\n"),
  "@/components/registry-export-panel": stubUrl("export function RegistryExportPanel() { return null; }\n"),
  "@/components/registry-entry-editor": stubUrl("export function RegistryEntryEditor() { return null; }\n"),
  // Scott, Nov 20 2026: the desk page now opens one entry's own page; the
  // component is stubbed here because its own read is not what this file tests.
  "@/components/registry-entry-panel": stubUrl("export function RegistryEntryPanel() { return null; }\n"),
  "@/components/registry-needs-checking": stubUrl("export function RegistryNeedsChecking() { return null; }\n"),
  "@/lib/news/registry/registry-desk": stubUrl(`
export async function listRegistryDesk() { return globalThis.__desk.data; }
`),
  "@/lib/news/registry/registry-desk-write": stubUrl(`
const refuse = async () => { throw new Error("dom fixture: the desk writes are not used here"); };
export const addRegistryEntry = refuse;
export const loadStarterList = refuse;
export const publishRegistryEntry = refuse;
export const takeDownRegistryEntry = refuse;
export const updateRegistryEntry = refuse;
`),
  "@/lib/news/registry/registry-entry-fields": stubUrl("export {};\n"),
  // The Freshness panel's plain-words reader; the real one is registry-recheck.ts.
  "@/lib/news/registry/registry-recheck": stubUrl(`
export function recheckResultWords(result) {
  return { same: "the facts still match", changed: "the facts changed", source_gone: "the source page is gone" }[result] ?? "the result was not recorded";
}
`),
  // F09 (Nov 19 2026): desk.registry.tsx now also imports isWebAddress, so the
  // stub carries it too -- the same test as the real one in desk-copy.ts.
  "@/lib/news/desk-copy": stubUrl(`
export function evidenceTierLabel(tier) { return String(tier ?? ""); }
export function isWebAddress(url) { return /^https?:\\/\\//i.test(String(url ?? "").trim()); }
`),
};
const deskPageUrl = await moduleUrl("src/routes/desk.registry.tsx", {
  ...imports,
  ...deskStubs,
  "@/components/registry-change-review": changeReviewUrl,
  "@/lib/news/registry/starter-list": await moduleUrl("src/lib/news/registry/starter-list.ts"),
});
const { Route } = await import(deskPageUrl);
const DeskPage = Route.component;

const change = (over = {}) => ({
  id: 1,
  reviewState: "pending",
  entityType: "service",
  entityId: 7,
  entityName: "Food Pantry",
  fieldName: "description",
  beforeValue: "Groceries",
  afterValue: "Groceries and diapers",
  currentValue: "Groceries",
  targetLive: true,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  appliedAt: null,
  ...over,
});

const verification = (over = {}) => ({
  latest: null,
  history: [],
  legacy: null,
  changedFacts: [],
  ...over,
});
const check = (id, over = {}) => ({
  id,
  method: "phone",
  basis: "Called the front desk",
  sourceUrl: null,
  checkedAt: "2026-11-10T12:00:00Z",
  checkedBy: "Pat Editor",
  ...over,
});

const desk = (changes = []) => ({
  changes,
  waiting: [],
  published: [],
  categories: [],
  publishedCount: 0,
  starterLoaded: true,
  imports: [],
  directoryNames: [],
  sources: [],
});

function setup() {
  globalThis.__desk = { search: {}, data: desk([]) };
  globalThis.__rv = {
    calls: [],
    review: async () => ({ ok: true, state: "accepted", applied: true, message: "Accepted and applied." }),
    verification: verification(),
    record: async () => ({ ok: true, verificationId: 1, message: "Verification recorded." }),
    needsChecking: [],
  };
}

const props = (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))];

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters, ...rest) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return invalidate(filters, ...rest);
  };
  const root = createRoot(container);
  await React.act(async () =>
    root.render(React.createElement(QueryClientProvider, { client }, element)),
  );
  const api = {
    container,
    invalidated,
    client,
    text: () => container.textContent.replace(/\s+/g, " "),
    buttons: (scope = container) => [...scope.querySelectorAll("button")].map((b) => b.textContent),
    button: (scope, label) => [...scope.querySelectorAll("button")].find((b) => b.textContent === label),
    async settle() {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async press(button) {
      await React.act(async () => {
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      await api.settle();
    },
    async type(scope, name, value) {
      const node = scope.querySelector(`[name="${name}"]`);
      await React.act(async () => props(node).onChange({ target: { value } }));
    },
    async submit(scope = container) {
      const form = scope.querySelector("form");
      await React.act(async () => props(form).onSubmit({ preventDefault() {} }));
      await api.settle();
    },
    async close() {
      await React.act(async () => root.unmount());
      client.clear();
      container.remove();
    },
  };
  await api.settle();
  return api;
}

const list = (changes) =>
  React.createElement(RegistryChangeReviewList, {
    changes,
    formatTime: (v) => String(v).slice(0, 10),
    renderSummary: (c) => React.createElement("div", { className: "summary" }, `Change ${c.id}`),
  });
const rows = (page) => [...page.container.querySelectorAll("li")];
const focusedAs = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return "the body";
  return `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || el.textContent || "").slice(0, 40)}"`;
};

/* ---- Change list ---- */

test("a waiting row has the note box and three buttons; pending and needs-editor alike", async (t) => {
  setup();
  const page = await mount(list([change({ id: 1 }), change({ id: 2, reviewState: "needs-editor" })]));
  t.after(() => page.close());
  for (const row of rows(page)) {
    assert.deepEqual(page.buttons(row), ["Accept and apply", "Accept without applying", "Reject"]);
    assert.ok(row.querySelector('textarea[name="note"]'));
    assert.match(row.textContent, /Note \(optional, up to 1000 characters\)/);
    assert.equal(row.querySelector('[data-testid="stale-notice"]'), null);
    assert.equal(row.querySelector('[data-testid="no-target-notice"]'), null);
  }
});

test("an accepted or rejected row has no buttons and shows reviewer, time, applied time and note", async (t) => {
  setup();
  const page = await mount(
    list([
      change({
        id: 1,
        reviewState: "accepted",
        reviewedBy: "Pat Editor",
        reviewedAt: "2026-11-12T09:00:00Z",
        appliedAt: "2026-11-12T09:00:00Z",
        reviewNote: "Checked by phone.",
      }),
      change({
        id: 2,
        reviewState: "rejected",
        reviewedBy: "Sam Editor",
        reviewedAt: "2026-11-13T09:00:00Z",
        reviewNote: null,
      }),
    ]),
  );
  t.after(() => page.close());
  const [accepted, rejected] = rows(page);
  assert.equal(accepted.querySelectorAll("button").length, 0);
  assert.equal(accepted.querySelector("textarea"), null);
  const acceptedText = accepted.textContent.replace(/\s+/g, " ");
  assert.match(acceptedText, /Accepted by Pat Editor on 2026-11-12\./);
  assert.match(acceptedText, /Applied to the entry on 2026-11-12\./);
  assert.match(acceptedText, /Note: Checked by phone\./);
  assert.equal(rejected.querySelectorAll("button").length, 0);
  const rejectedText = rejected.textContent.replace(/\s+/g, " ");
  assert.match(rejectedText, /Rejected by Sam Editor on 2026-11-13\./);
  assert.match(rejectedText, /Not applied\./);
  assert.doesNotMatch(rejectedText, /Note:/);
});

test("a stale row says what the field says now and hides Accept and apply", async (t) => {
  setup();
  const page = await mount(list([change({ currentValue: "Groceries and clothing" })]));
  t.after(() => page.close());
  const row = rows(page)[0];
  assert.equal(
    row.querySelector('[data-testid="stale-notice"]').textContent.replace(/\s+/g, " "),
    "This field now says Groceries and clothing. The proposal expected Groceries.",
  );
  assert.deepEqual(page.buttons(row), ["Accept without applying", "Reject"]);
});

test("a stale row whose field is now empty says so in words", async (t) => {
  setup();
  const page = await mount(list([change({ currentValue: null })]));
  t.after(() => page.close());
  assert.match(
    rows(page)[0].querySelector('[data-testid="stale-notice"]').textContent,
    /This field now says nothing recorded\. The proposal expected Groceries\./,
  );
});

test("a proposal with no live target says so and offers only Accept without applying and Reject", async (t) => {
  setup();
  const page = await mount(list([change({ targetLive: false, currentValue: null, entityId: null })]));
  t.after(() => page.close());
  const row = rows(page)[0];
  assert.match(
    row.querySelector('[data-testid="no-target-notice"]').textContent,
    /does not point at one live row/,
  );
  assert.deepEqual(page.buttons(row), ["Accept without applying", "Reject"]);
});

test("a date that ends in p.m. and a value that ends in a period each print one period", async (t) => {
  setup();
  const page = await mount(
    React.createElement(RegistryChangeReviewList, {
      changes: [
        change({
          id: 1,
          reviewState: "accepted",
          reviewedBy: "Pat Editor",
          reviewedAt: "2026-11-18T17:04:00Z",
          appliedAt: "2026-11-18T17:04:00Z",
        }),
        change({
          id: 2,
          currentValue: "Changed again by hand.",
          beforeValue: "Free checkups, edited by hand.",
        }),
      ],
      emptyText: "none",
      formatTime: () => "Nov. 18, 5:04 p.m.",
      renderSummary: (c) => React.createElement("div", { className: "summary" }, `Change ${c.id}`),
    }),
  );
  t.after(() => page.close());
  const [decided, stale] = rows(page);
  const lines = [...decided.querySelectorAll('[data-testid="resolved-details"] p')].map((p) => p.textContent);
  assert.deepEqual(lines, [
    "Accepted by Pat Editor on Nov. 18, 5:04 p.m.",
    "Applied to the entry on Nov. 18, 5:04 p.m.",
  ]);
  assert.equal(
    stale.querySelector('[data-testid="stale-notice"]').textContent.replace(/\s+/g, " "),
    "This field now says Changed again by hand. The proposal expected Free checkups, edited by hand.",
  );
  assert.doesNotMatch(page.text(), /\.\./, "no doubled period anywhere in the list");
});

test("each button sends the right call, with an empty note sent as null", async (t) => {
  setup();
  const page = await mount(list([change({ id: 5 })]));
  t.after(() => page.close());
  const row = () => rows(page)[0];
  await page.type(row(), "note", "Checked by phone");
  await page.press(page.button(row(), "Accept and apply"));
  await page.press(page.button(row(), "Accept without applying"));
  await page.press(page.button(row(), "Reject"));
  await page.type(row(), "note", "   ");
  await page.press(page.button(row(), "Reject"));
  assert.deepEqual(globalThis.__rv.calls, [
    ["accept", { changeId: 5, apply: true, note: "Checked by phone" }],
    ["accept", { changeId: 5, apply: false, note: "Checked by phone" }],
    ["reject", { changeId: 5, note: "Checked by phone" }],
    ["reject", { changeId: 5, note: null }],
  ]);
});

test("a success is said in a status line, focus moves to it, and the lists are refreshed", async (t) => {
  setup();
  const page = await mount(list([change()]));
  t.after(() => page.close());
  await page.press(page.button(rows(page)[0], "Accept and apply"));
  const status = page.container.querySelector('[data-testid="review-status"]');
  assert.equal(status.textContent, "Accepted and applied.");
  assert.equal(status.getAttribute("role"), "status");
  assert.ok(document.activeElement === status, `focus should be on the status line; it is on ${focusedAs()}`);
  assert.ok(page.invalidated.includes('["registry-desk"]'), "the registry desk list is refreshed");
});

for (const [reason, message] of [
  [
    "stale",
    'This entry changed after the proposal was made. It now says "X"; the proposal would change it to "Y". Nothing was changed. Reject the proposal, or accept it without applying.',
  ],
  ["resolved", "This proposal was already accepted by Pat Editor on 2026-11-12. Nothing was changed."],
  [
    "no-target",
    "This proposal does not point at one live row. Reject it, or accept it without applying and edit the entry yourself.",
  ],
]) {
  test(`a "${reason}" refusal is shown as the server said it, as an alert with focus`, async (t) => {
    setup();
    globalThis.__rv.review = async () => ({ ok: false, reason, message });
    const page = await mount(list([change()]));
    t.after(() => page.close());
    await page.press(page.button(rows(page)[0], "Accept and apply"));
    const status = page.container.querySelector('[data-testid="review-status"]');
    assert.equal(status.textContent, message);
    assert.equal(status.getAttribute("role"), "alert");
    assert.ok(document.activeElement === status, `focus should be on the status line; it is on ${focusedAs()}`);
  });
}

test("a thrown error says nothing was changed and the buttons work again", async (t) => {
  setup();
  globalThis.__rv.review = async () => {
    throw new Error("The server is not reachable. Nothing was changed.");
  };
  const page = await mount(list([change()]));
  t.after(() => page.close());
  await page.press(page.button(rows(page)[0], "Reject"));
  assert.equal(
    page.container.querySelector('[data-testid="review-status"]').textContent,
    "The server is not reachable. Nothing was changed.",
  );
  assert.equal(page.button(rows(page)[0], "Reject").disabled, false);
});

test("a thrown error still invalidates the desk list, once", async (t) => {
  setup();
  globalThis.__rv.review = async () => {
    throw new Error("The server is not reachable. Nothing was changed.");
  };
  const page = await mount(list([change()]));
  t.after(() => page.close());
  await page.press(page.button(rows(page)[0], "Reject"));
  assert.equal(page.invalidated.filter((key) => key === '["registry-desk"]').length, 1);
});

test("a refresh that fails after an answer leaves the answer in the status line", async (t) => {
  setup();
  const page = await mount(list([change()]));
  t.after(() => page.close());
  page.client.invalidateQueries = async () => {
    throw new Error("refetch failed");
  };
  await page.press(page.button(rows(page)[0], "Accept and apply"));
  const status = page.container.querySelector('[data-testid="review-status"]');
  assert.match(status.textContent, /^Accepted and applied\. /);
  assert.match(status.textContent, /The list could not be refreshed\. Reload the page\./);
  assert.equal(status.getAttribute("role"), "status");
});

test("two clicks on one review button before the first answer send one call", async (t) => {
  setup();
  const page = await mount(list([change({ id: 6 })]));
  t.after(() => page.close());
  const button = page.button(rows(page)[0], "Reject");
  await React.act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await page.settle();
  assert.deepEqual(globalThis.__rv.calls, [["reject", { changeId: 6, note: null }]]);
});

test("filtered to waiting, the only row accepted: the list empties and the status line stays, with focus", async (t) => {
  setup();
  globalThis.__desk.search = { state: "pending" };
  globalThis.__desk.data = desk([change({ id: 4 })]);
  globalThis.__rv.review = async () => {
    // What the server now holds: the row is accepted, so the Waiting filter hides it.
    globalThis.__desk.data = desk([
      change({
        id: 4,
        reviewState: "accepted",
        reviewedBy: "Pat Editor",
        reviewedAt: "2026-11-18T12:00:00Z",
        appliedAt: "2026-11-18T12:00:00Z",
      }),
    ]);
    return { ok: true, state: "accepted", applied: true, message: "Accepted and applied." };
  };
  const page = await mount(React.createElement(DeskPage));
  t.after(() => page.close());
  assert.equal(rows(page).length, 1);
  await page.press(page.button(rows(page)[0], "Accept and apply"));
  assert.equal(rows(page).length, 0, "the refreshed list is empty");
  assert.match(page.text(), /No change is/);
  const status = page.container.querySelector('[data-testid="review-status"]');
  assert.ok(status, "the status line is still on the page");
  assert.equal(status.textContent, "Accepted and applied.");
  assert.ok(document.activeElement === status, `focus should be on the status line; it is on ${focusedAs()}`);
});

test("Detected changes never claims nothing was applied; each row says what happened to it", async (t) => {
  // The scan now applies and publishes by itself (Scott's ask, Nov 20), so a
  // list-wide "nothing here has been applied" would be false as soon as the
  // scan publishes one entry, and the applied row may be filtered out of the
  // list anyway. The section's line is the same at all times; the row says
  // whether it was applied.
  const detectedSub = (page) => page.container.querySelector('[data-sec="Detected changes"] p')?.textContent;
  setup();
  globalThis.__desk.data = desk([change({ id: 5 })]);
  const none = await mount(React.createElement(DeskPage));
  t.after(() => none.close());
  const noneSub = detectedSub(none);
  assert.ok(noneSub, "the section has a line under its heading");
  assert.doesNotMatch(noneSub, /nothing here has been applied/i);
  assert.match(noneSub, /A change waiting for an editor has not been applied to the directory/);
  assert.equal(none.container.querySelector('[data-testid="resolved-details"]'), null, "a waiting row says it is waiting, not that it was applied");

  setup();
  globalThis.__desk.data = desk([
    change({ id: 5 }),
    change({
      id: 6,
      reviewState: "accepted",
      reviewedBy: "Pat Editor",
      reviewedAt: "2026-11-18T12:00:00Z",
      appliedAt: "2026-11-18T12:00:00Z",
    }),
  ]);
  const applied = await mount(React.createElement(DeskPage));
  t.after(() => applied.close());
  assert.equal(detectedSub(applied), noneSub, "the line does not change with the list");
  assert.match(applied.text(), /Applied to the entry on .*2026-11-18/);
});

/* ---- Verify form and history ---- */

const panel = () => React.createElement(RegistryVerificationPanel, { serviceId: 7 });
const field = (page, name) => page.container.querySelector(`[name="${name}"]`);
const statusLine = (page) => page.container.querySelector('[data-testid="verification-status"]');

test("with no verification the panel says Not verified yet. and lists the six methods in plain words", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  assert.deepEqual(globalThis.__rv.calls[0], ["read", { serviceId: 7 }]);
  assert.match(page.text(), /Not verified yet\./);
  assert.equal(page.container.querySelector('[data-testid="legacy-date"]'), null);
  assert.equal(page.container.querySelector('[data-testid="changed-facts"]'), null);
  const options = [...field(page, "method").querySelectorAll("option")].map((o) => o.textContent);
  assert.deepEqual(options, [
    "Choose one…",
    "By phone",
    "On its website",
    "In person",
    "By email",
    "From a document",
    "Confirmed by the organization",
  ]);
  assert.deepEqual(page.buttons(), ["Record verification"]);
});

test("history shows the latest, older checks newest first, and the legacy date with its label", async (t) => {
  setup();
  const newest = check(3, {
    method: "visit",
    basis: "Went to the hall",
    sourceUrl: "https://example.org/hall",
    checkedAt: "2026-11-10T12:00:00Z",
  });
  const middle = check(2, {
    method: "email",
    basis: "Replied to our email",
    checkedAt: "2026-09-01T12:00:00Z",
    checkedBy: "Sam Editor",
  });
  const oldest = check(1, { method: "website", basis: "Read the site", checkedAt: "2026-05-01T12:00:00Z" });
  globalThis.__rv.verification = verification({
    latest: newest,
    history: [newest, middle, oldest],
    legacy: { at: "2026-01-15T00:00:00Z", method: "editor", by: "Pat Editor" },
  });
  const page = await mount(panel());
  t.after(() => page.close());
  const records = [...page.container.querySelectorAll('[data-testid="verification-record"]')].map((r) =>
    r.textContent.replace(/\s+/g, " "),
  );
  assert.equal(records.length, 3);
  assert.match(records[0], /on 2026-11-10, in person, by Pat Editor/);
  assert.match(records[0], /Basis: Went to the hall/);
  assert.match(records[0], /Source: https:\/\/example\.org\/hall/);
  assert.match(records[1], /on 2026-09-01, by email, by Sam Editor/);
  assert.match(records[2], /on 2026-05-01, on its website/);
  assert.equal(
    page.container.querySelector('[data-testid="legacy-date"]').textContent,
    "Legacy date (set by saves, not a check): on 2026-01-15",
  );
  assert.doesNotMatch(page.text(), /Not verified yet\./);
  const link = page.container.querySelector("a");
  assert.equal(link.getAttribute("href"), "https://example.org/hall");
});

test("a legacy date with no check still says Not verified yet.", async (t) => {
  setup();
  globalThis.__rv.verification = verification({
    legacy: { at: "2026-01-15T00:00:00Z", method: "editor", by: null },
  });
  const page = await mount(panel());
  t.after(() => page.close());
  assert.match(page.text(), /Not verified yet\./);
  assert.match(page.text(), /Legacy date \(set by saves, not a check\): on 2026-01-15/);
});

test("changed facts are listed in one line", async (t) => {
  setup();
  const latest = check(1);
  globalThis.__rv.verification = verification({
    latest,
    history: [latest],
    changedFacts: ["phones", "hours"],
  });
  const page = await mount(panel());
  t.after(() => page.close());
  assert.equal(
    page.container.querySelector('[data-testid="changed-facts"]').textContent,
    "Changed since verified: phones, hours",
  );
});

test("an empty basis and a bad link are refused on screen and never reach the server", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "method", "phone");
  await page.type(page.container, "basis", "   ");
  await page.type(page.container, "sourceUrl", "ftp://example.org/x");
  await page.submit();
  const alerts = [...page.container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
  assert.ok(alerts.includes("Say what you checked. This is required."));
  assert.ok(alerts.includes("The link must start with http:// or https://."));
  assert.equal(globalThis.__rv.calls.filter((c) => c[0] === "record").length, 0);
  assert.ok(document.activeElement === statusLine(page), `focus should be on the status line; it is on ${focusedAs()}`);
  assert.equal(props(field(page, "basis")).value, "   ", "what the editor typed is kept");
});

test("no method is refused on screen", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "basis", "Called");
  await page.submit();
  assert.match(page.text(), /Choose how you checked this entry\./);
  assert.equal(globalThis.__rv.calls.filter((c) => c[0] === "record").length, 0);
});

test("a good form is sent, clears, shows the new latest check, and focus moves to the status line", async (t) => {
  setup();
  globalThis.__rv.record = async (data) => {
    const added = check(9, {
      method: data.method,
      basis: data.basis,
      sourceUrl: data.sourceUrl,
      checkedAt: "2026-11-18T12:00:00Z",
    });
    globalThis.__rv.verification = verification({ latest: added, history: [added] });
    return { ok: true, verificationId: 9, message: "Verification recorded." };
  };
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "method", "organization");
  await page.type(page.container, "basis", "The director confirmed the hours");
  await page.type(page.container, "sourceUrl", " https://example.org/hours ");
  await page.submit();
  assert.deepEqual(
    globalThis.__rv.calls.filter((c) => c[0] === "record"),
    [
      [
        "record",
        {
          serviceId: 7,
          method: "organization",
          basis: "The director confirmed the hours",
          sourceUrl: "https://example.org/hours",
        },
      ],
    ],
  );
  assert.equal(statusLine(page).textContent, "Verification recorded.");
  assert.ok(document.activeElement === statusLine(page), `focus should be on the status line; it is on ${focusedAs()}`);
  assert.equal(props(field(page, "basis")).value, "");
  assert.equal(props(field(page, "method")).value, "");
  assert.equal(props(field(page, "sourceUrl")).value, "");
  assert.match(page.text(), /on 2026-11-18, confirmed by the organization, by Pat Editor/);
  assert.match(page.text(), /Basis: The director confirmed the hours/);
  assert.doesNotMatch(page.text(), /Not verified yet\./);
  assert.ok(page.invalidated.includes('["registry-needs-checking"]'), "Needs checking is refreshed");
});

test("an empty source link is sent as null", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "method", "phone");
  await page.type(page.container, "basis", "Called");
  await page.submit();
  assert.equal(globalThis.__rv.calls.find((c) => c[0] === "record")[1].sourceUrl, null);
});

test("the server's refusal is shown under its field and in the status line; the form keeps its values", async (t) => {
  setup();
  globalThis.__rv.record = async () => ({
    ok: false,
    problems: { sourceUrl: "That link is not a web address." },
  });
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "method", "phone");
  await page.type(page.container, "basis", "Called");
  await page.type(page.container, "sourceUrl", "https://example.org");
  await page.submit();
  assert.ok(
    [...page.container.querySelectorAll('[role="alert"]')].some(
      (a) => a.textContent === "That link is not a web address.",
    ),
  );
  assert.match(statusLine(page).textContent, /Nothing was recorded/);
  assert.equal(statusLine(page).getAttribute("role"), "alert");
  assert.equal(props(field(page, "basis")).value, "Called");
});

test("a thrown error says nothing was changed", async (t) => {
  setup();
  globalThis.__rv.record = async () => {
    throw new Error("That entry could not be found. Nothing was changed.");
  };
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "method", "phone");
  await page.type(page.container, "basis", "Called");
  await page.submit();
  assert.equal(statusLine(page).textContent, "That entry could not be found. Nothing was changed.");
});

test("a refresh that fails after a recorded check leaves the success in the status line", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  page.client.invalidateQueries = async () => {
    throw new Error("refetch failed");
  };
  await page.type(page.container, "method", "phone");
  await page.type(page.container, "basis", "Called");
  await page.submit();
  const status = statusLine(page);
  assert.match(status.textContent, /^Verification recorded\. /);
  assert.match(status.textContent, /The list could not be refreshed\. Reload the page\./);
  assert.equal(status.getAttribute("role"), "status");
  assert.doesNotMatch(page.text(), /refetch failed/);
});

test("each field's error sits outside its label and is linked to its control", async (t) => {
  setup();
  const page = await mount(panel());
  t.after(() => page.close());
  await page.type(page.container, "basis", "   ");
  await page.type(page.container, "sourceUrl", "ftp://example.org/x");
  await page.submit();
  const labelOf = (control) =>
    [...page.container.querySelectorAll("label")].find(
      (l) =>
        l.getAttribute("for") === control.id ||
        [...l.querySelectorAll("select, textarea, input")].includes(control),
    );
  for (const [name, message] of [
    ["method", "Choose how you checked this entry."],
    ["basis", "Say what you checked. This is required."],
    ["sourceUrl", "The link must start with http:// or https://."],
  ]) {
    const control = field(page, name);
    const label = labelOf(control);
    assert.ok(label, `${name} has a label`);
    // A boolean, not the element: a failing assert would try to print the DOM node.
    assert.equal(label.querySelector('[role="alert"]') !== null, false, `${name}: the error is not inside its label`);
    assert.doesNotMatch(label.textContent, /Choose how|Say what|The link must/);
    const describedBy = control.getAttribute("aria-describedby");
    assert.ok(describedBy, `${name}: the control points at its error`);
    const error = document.getElementById(describedBy);
    assert.ok(error, `${name}: aria-describedby names an element that exists`);
    assert.equal(error.textContent, message);
    assert.equal(error.getAttribute("role"), "alert");
  }
});

/* ---- Needs checking ---- */

test("Needs checking lists each entry with its reasons and opens it in the editor", async (t) => {
  setup();
  globalThis.__rv.needsChecking = [
    {
      serviceId: 7,
      serviceName: "Food Pantry",
      organizationName: "Helping Hands",
      lastCheckedAt: null,
      reasons: ["Never verified"],
    },
    {
      serviceId: 8,
      serviceName: "Rent Help",
      organizationName: "Helping Hands",
      lastCheckedAt: "2026-02-01T00:00:00Z",
      reasons: ["Last verified more than 180 days ago", "Changed since verified: hours"],
    },
  ];
  const opened = [];
  const page = await mount(React.createElement(RegistryNeedsChecking, { onOpen: (id) => opened.push(id) }));
  t.after(() => page.close());
  const items = [...page.container.querySelectorAll("li")];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Helping Hands — Food Pantry/);
  assert.match(items[0].textContent, /Never verified/);
  assert.doesNotMatch(items[0].textContent, /Last checked/);
  assert.match(items[1].textContent, /Last verified more than 180 days ago/);
  assert.match(items[1].textContent, /Changed since verified: hours/);
  assert.match(items[1].textContent, /Last checked on 2026-02-01\./);
  await page.press(page.button(items[1], "Open in the editor"));
  assert.deepEqual(opened, [8]);
});

test("Needs checking says so when every published entry is current", async (t) => {
  setup();
  const page = await mount(React.createElement(RegistryNeedsChecking, { onOpen() {} }));
  t.after(() => page.close());
  assert.match(page.text(), /Every published entry has a current verification\./);
  assert.equal(page.container.querySelectorAll("li").length, 0);
});

test("Needs checking draws only the rows the page asks for and reports the full count", async (t) => {
  setup();
  globalThis.__rv.needsChecking = Array.from({ length: 30 }, (_, i) => ({
    serviceId: i + 1,
    serviceName: `Service ${i + 1}`,
    organizationName: "Helping Hands",
    lastCheckedAt: null,
    reasons: ["Never verified"],
  }));
  let footTotal = null;
  const page = await mount(
    React.createElement(RegistryNeedsChecking, {
      onOpen() {},
      limit: 25,
      renderFoot: (total) => {
        footTotal = total;
        return null;
      },
    }),
  );
  t.after(() => page.close());
  assert.equal(page.container.querySelectorAll("li").length, 25);
  assert.equal(footTotal, 30);
});

/* ---- Freshness panel and Source gone list (Scott, Nov 20 2026) ---- */

const freshness = (over = {}) => ({
  published: 12,
  recheckedLast30Days: 9,
  changed: 2,
  sourceGone: 1,
  oldestUnchecked: {
    serviceId: 41,
    organizationName: "Helping Hands",
    serviceName: "Food Pantry",
    robotCheckedAt: null,
    robotCheckResult: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  rechecked: [
    {
      serviceId: 42,
      organizationName: "Helping Hands",
      serviceName: "Rent Help",
      robotCheckedAt: "2026-11-18T00:00:00Z",
      robotCheckResult: "same",
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
  changedEntries: [
    {
      serviceId: 43,
      organizationName: "Our Center",
      serviceName: "Hot Lunch",
      robotCheckedAt: "2026-11-17T00:00:00Z",
      robotCheckResult: "changed",
      createdAt: "2026-01-03T00:00:00Z",
    },
  ],
  sourceGoneEntries: [
    {
      serviceId: 44,
      organizationName: "Old Mission",
      serviceName: "Night Shelter",
      robotCheckedAt: "2026-11-19T00:00:00Z",
      robotCheckResult: "source_gone",
      createdAt: "2026-01-04T00:00:00Z",
    },
  ],
  ...over,
});

test("the Freshness panel comes first and every number links to its own list", async (t) => {
  setup();
  globalThis.__desk.data = { ...desk([]), freshness: freshness() };
  const page = await mount(React.createElement(DeskPage));
  t.after(() => page.close());

  const panel = page.container.querySelector("#registry-freshness");
  assert.ok(panel, "the Freshness panel is on the page");
  assert.equal(
    page.container.querySelector(".src-sec"),
    panel,
    "the panel is the first section under the page title",
  );
  const text = panel.textContent.replace(/\s+/g, " ");
  assert.match(text, /12 published/);
  assert.match(text, /9 rechecked in the last 30 days/);
  assert.match(text, /2 changed/);
  assert.match(text, /1 source gone/);
  // Each number is a link to a list that exists on this page.
  for (const id of [
    "registry-published",
    "registry-fresh-rechecked",
    "registry-fresh-changed",
    "registry-fresh-gone",
  ]) {
    const link = panel.querySelector(`a[href="#${id}"]`);
    assert.ok(link, `a link to #${id}`);
    assert.ok(page.container.querySelector(`#${id}`), `the target #${id} exists`);
  }
  assert.match(text, /Oldest unchecked entry: Helping Hands — Food Pantry/);
});

test("Source gone is its own list right after Auto-published", async (t) => {
  setup();
  globalThis.__desk.data = { ...desk([]), freshness: freshness() };
  const page = await mount(React.createElement(DeskPage));
  t.after(() => page.close());

  const sections = [...page.container.querySelectorAll(".src-sec")];
  const auto = sections.findIndex((section) => /Auto-published/.test(section.textContent));
  const gone = sections.findIndex((section) => section.id === "registry-fresh-gone");
  assert.ok(auto >= 0 && gone === auto + 1, "Source gone follows Auto-published");
  const text = sections[gone].textContent.replace(/\s+/g, " ");
  assert.match(text, /Old Mission — Night Shelter/);
  assert.match(text, /Taken down after the source page was found gone/);
});
