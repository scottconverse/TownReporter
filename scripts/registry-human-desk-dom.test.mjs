/*
  The registry desk, drawn for a person (Scott, Nov 20 2026).

  WHAT THIS PROVES.
  Scott's complaint: "It doesn't have anywhere near the information it's
  supposed to. I looked at one of the needs approval, and it didn't have any
  data. It had the name of the site, no website URL, nothing." So:

  - every entry card shows the whole entry: organization, service, category,
    description, every phone, address with a map link, hours, website as a new
    tab, eligibility, fees, languages, and the source page with its capture
    date; a field the source did not state says "Not listed on the source page.",
    and an entry with no source page says "Not recorded." (it never claims a
    page listed nothing when there is no page);
  - a proposal says what kind of change it is, the old and new values side by
    side, the page's own sentence, the source link, the capture date and the
    entry it belongs to, with Accept / Reject / Edit;
  - a proposal stored with no data says "This proposal has no facts. Reject it."
    and offers only Reject;
  - clicking an entry opens that entry's own page, with its history and its
    sources;
  - the search box and the category filter narrow every list together;
  - each list is a collapsible block whose heading counts its rows;
  - long lists show 25 rows and "Show 25 more".

  React and react-query are real; the server functions are stubs that return
  the sample data this file states.
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
export function InkButton({ children, onClick, disabled, pending, pendingLabel, type, ariaLabel }) {
  return h("button", { type: type || "button", disabled: Boolean(disabled || pending), onClick, "aria-label": ariaLabel },
    pending && pendingLabel ? pendingLabel : children);
}
export function DeskShell({ children }) { return h("div", null, children); }
export function SecHead({ title, count, sub }) {
  return h("div", { "data-sec": title },
    h("h2", { className: "sec-title" }, title),
    count != null ? h("span", { className: "sec-count" }, String(count)) : null,
    sub ? h("p", { className: "sec-sub" }, sub) : null);
}
`);
const routerUrl = stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
export function createFileRoute() {
  return (options) => ({ ...options, useSearch: () => globalThis.__desk.search });
}
export function Link({ to, className, children }) {
  return h("a", { href: to, className }, children);
}
`);
const paperUrl = stubUrl(`
const at = (v) => (v ? "on " + String(v).slice(0, 10) : "");
export function usePaperDateFormatters() {
  return { formatListDateTime: at, formatShortDate: at };
}
`);
const reviewUrl = stubUrl(`
export async function acceptRegistryChange({ data }) {
  globalThis.__desk.calls.push(["accept", data]);
  return { ok: true, state: "accepted", applied: true, message: "Accepted and applied." };
}
export async function rejectRegistryChange({ data }) {
  globalThis.__desk.calls.push(["reject", data]);
  return { ok: true, state: "rejected", applied: false, message: "Rejected." };
}
`);
const deskUrl = stubUrl(`
export async function listRegistryDesk() { return globalThis.__desk.data; }
export async function readRegistryEntryPanel({ data }) {
  globalThis.__desk.calls.push(["panel", data]);
  return globalThis.__desk.panel;
}
`);
const writeUrl = stubUrl(`
const refuse = async () => { throw new Error("dom fixture: no desk writes here"); };
export const addRegistryEntry = refuse;
export const loadStarterList = refuse;
export const publishRegistryEntry = refuse;
export const takeDownRegistryEntry = refuse;
export const updateRegistryEntry = refuse;
`);
const imports = {
  "@tanstack/react-router": routerUrl,
  "@/components/desk-chrome": chromeUrl,
  "@/components/states": stubUrl(`
export function ScreenError() { return null; }
export function ListSkeleton() { return null; }
`),
  "@/components/registry-import-panel": stubUrl("export function RegistryImportPanel() { return null; }\n"),
  "@/components/registry-export-panel": stubUrl("export function RegistryExportPanel() { return null; }\n"),
  "@/components/registry-entry-editor": stubUrl("export function RegistryEntryEditor() { return null; }\n"),
  "@/components/registry-needs-checking": stubUrl("export function RegistryNeedsChecking() { return null; }\n"),
  "@/lib/news/registry/registry-desk": deskUrl,
  "@/lib/news/registry/registry-desk-write": writeUrl,
  "@/lib/news/registry/registry-entry-fields": stubUrl("export {};\n"),
  "@/lib/news/registry/registry-review": reviewUrl,
  "@/lib/news/registry/registry-sentence": await moduleUrl("src/lib/news/registry/registry-sentence.ts"),
  "@/lib/news/registry/registry-proposal-facts": await moduleUrl(
    "src/lib/news/registry/registry-proposal-facts.ts",
  ),
  "@/lib/news/registry/registry-recheck": stubUrl(`
export function recheckResultWords(result) {
  return { same: "the facts still match", changed: "the facts changed", source_gone: "the source page is gone" }[result] ?? "the result was not recorded";
}
`),
  "@/lib/news/desk-copy": stubUrl(`
export function evidenceTierLabel(tier) { return String(tier ?? ""); }
export function isWebAddress(url) { return /^https?:\\/\\//i.test(String(url ?? "").trim()); }
`),
  "@/lib/news/list-window": await moduleUrl("src/lib/news/list-window.ts"),
  "@/lib/news/registry/registry-entry-copy": await moduleUrl(
    "src/lib/news/registry/registry-entry-copy.ts",
  ),
  "@/lib/paper-context-state": paperUrl,
};
const cardUrl = await moduleUrl("src/components/registry-entry-card.tsx", imports);
imports["@/components/registry-entry-card"] = cardUrl;
const panelUrl = await moduleUrl("src/components/registry-entry-panel.tsx", imports);
const changeReviewUrl = await moduleUrl("src/components/registry-change-review.tsx", imports);
imports["@/components/registry-entry-panel"] = panelUrl;
imports["@/components/registry-change-review"] = changeReviewUrl;

const pageUrl = await moduleUrl("src/routes/desk.registry.tsx", {
  ...imports,
  "@/lib/news/registry/starter-list": await moduleUrl("src/lib/news/registry/starter-list.ts"),
});
const { Route } = await import(pageUrl);
const DeskPage = Route.component;

const FULL = {
  serviceId: 7,
  serviceHsdsId: "svc-7",
  organizationName: "Helping Hands",
  serviceName: "Food Pantry",
  categoryName: "Food",
  phone: "303-555-0101",
  phones: ["303-555-0101", "303-555-0102"],
  description: "Groceries and diapers for families.",
  address: "12 Main St, Boulder, CO 80302",
  hours: ["Monday to Friday: 9 to 5"],
  website: "https://helpinghands.test/pantry",
  eligibility: "Boulder County residents",
  fees: "Free",
  applicationProcess: "Walk in with an ID.",
  languages: ["English", "Spanish"],
  crisis: false,
  sourceTitle: "Boulder pantry list",
  sourceUrl: "https://boulder.test/pantries",
  sourceCapturedAt: "2026-11-18T12:00:00Z",
  robotCheckedAt: "2026-11-19T12:00:00Z",
  robotCheckResult: "same",
  published: true,
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-11-18T12:00:00Z",
};

const EMPTY = {
  ...FULL,
  serviceId: 8,
  serviceHsdsId: "svc-8",
  organizationName: "Old Mission",
  serviceName: "Night Shelter",
  categoryName: null,
  phone: null,
  phones: [],
  description: null,
  address: null,
  hours: [],
  website: null,
  eligibility: null,
  fees: null,
  applicationProcess: null,
  languages: [],
  sourceTitle: null,
  sourceUrl: null,
  sourceCapturedAt: null,
  published: false,
};

const proposal = (over = {}) => ({
  id: 1,
  reviewState: "pending",
  entityType: "service",
  entityId: 7,
  entityName: "Food Pantry",
  fieldName: "opens_at",
  beforeValue: "9 a.m.",
  afterValue: "10 a.m.",
  changeKind: "hours_change",
  summary: "The pantry opens an hour later now.",
  quote: "The pantry opens at 10 a.m. from now on.",
  evidenceTier: "B",
  sourceTitle: "Boulder pantry list",
  sourceUrl: "https://boulder.test/pantries",
  captureDate: "2026-11-18T12:00:00Z",
  serviceId: 7,
  servicePublished: true,
  scanRunId: 41,
  createdAt: "2026-11-18T13:00:00Z",
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  appliedAt: null,
  currentValue: "9 a.m.",
  targetLive: true,
  ...over,
});

const EMPTY_PROPOSAL = proposal({
  id: 2,
  entityId: null,
  entityName: "Mystery Site",
  fieldName: "name",
  beforeValue: null,
  afterValue: null,
  changeKind: "field_change",
  summary: null,
  quote: null,
  serviceId: null,
  servicePublished: false,
  currentValue: null,
  targetLive: false,
});

const freshness = {
  published: 1,
  recheckedLast30Days: 1,
  changed: 0,
  sourceGone: 0,
  oldestUnchecked: null,
  rechecked: [
    {
      serviceId: 7,
      organizationName: "Helping Hands",
      serviceName: "Food Pantry",
      robotCheckedAt: "2026-11-19T12:00:00Z",
      robotCheckResult: "same",
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
  changedEntries: [],
  sourceGoneEntries: [],
};

function desk(over = {}) {
  return {
    changes: [proposal(), EMPTY_PROPOSAL],
    waiting: [EMPTY],
    published: [FULL],
    autoPublished: [],
    categories: ["Food"],
    publishedCount: 1,
    starterLoaded: true,
    imports: [],
    directoryNames: [],
    sources: [],
    freshness,
    ...over,
  };
}

const panel = {
  entry: FULL,
  detail: {
    service: {
      id: 7,
      published: true,
      name: "Food Pantry",
      description: "Groceries and diapers for families.",
      url: "https://helpinghands.test/pantry",
      fees: "Free",
      applicationProcess: "Walk in with an ID.",
      crisis: false,
    },
    organization: {
      id: 3,
      name: "Helping Hands",
      alternateName: "",
      description: "",
      email: "",
      website: "",
      legalStatus: "",
      sharedWith: [],
    },
    contacts: [],
    places: [],
    schedules: [],
    unlinkedSchedules: [],
    eligibilities: [],
    requiredDocuments: [],
    languages: [],
    accessibilities: [],
    linkablePlaces: [],
    removed: [],
  },
  history: [
    {
      id: 1,
      source: "audit",
      action: "registry.service.autopublish",
      detail: "Auto-published a service from https://boulder.test/pantries.",
      at: "2026-11-18T12:00:00Z",
      by: "the scan",
    },
  ],
  sources: [
    {
      id: 5,
      title: "Boulder pantry list",
      url: "https://boulder.test/pantries",
      registryRole: "service",
      capturedAt: "2026-11-18T12:00:00Z",
      lastFetchedAt: "2026-11-18T12:00:00Z",
      lastError: null,
    },
  ],
};

function setup(data = desk()) {
  globalThis.__desk = { search: {}, data, panel, calls: [] };
}

const props = (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))];

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(DeskPage),
      ),
    ),
  );
  const api = {
    container,
    text: () => container.textContent.replace(/\s+/g, " "),
    cards: () => [...container.querySelectorAll('[data-testid="registry-entry-card"]')],
    card: (name) =>
      [...container.querySelectorAll('[data-testid="registry-entry-card"]')].find((card) =>
        card.textContent.includes(name),
      ),
    buttons: (scope = container) => [...scope.querySelectorAll("button")].map((b) => b.textContent),
    button: (scope, label) =>
      [...scope.querySelectorAll("button")].find((b) => b.textContent === label),
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
    async close() {
      await React.act(async () => root.unmount());
      client.clear();
      container.remove();
    },
  };
  await api.settle();
  return api;
}

test("every entry card shows the whole entry, and empty fields say so in words", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const full = page.card("Food Pantry");
  assert.ok(full, "the full entry is a card");
  const text = full.textContent.replace(/\s+/g, " ");
  for (const expected of [
    "Helping Hands",
    "Food Pantry",
    "Food",
    "Groceries and diapers for families.",
    "303-555-0101",
    "303-555-0102",
    "12 Main St, Boulder, CO 80302",
    "Monday to Friday: 9 to 5",
    "https://helpinghands.test/pantry",
    "Boulder County residents",
    "Free",
    "Walk in with an ID.",
    "English, Spanish",
    "Boulder pantry list",
    "captured on 2026-11-18",
  ]) {
    assert.ok(text.includes(expected), `the card says "${expected}"`);
  }

  const mapLink = [...full.querySelectorAll("a")].find((a) => a.href.includes("google.com/maps"));
  assert.ok(mapLink, "the address has a map link");
  assert.match(decodeURIComponent(mapLink.getAttribute("href")), /query=12 Main St, Boulder, CO 80302/);
  const site = [...full.querySelectorAll("a")].find((a) => a.textContent.includes("helpinghands.test"));
  assert.equal(site.getAttribute("target"), "_blank", "the website opens in a new tab");
  const source = [...full.querySelectorAll("a")].find((a) => a.textContent.includes("Boulder pantry list"));
  assert.equal(source.getAttribute("href"), "https://boulder.test/pantries");
  assert.equal(source.getAttribute("target"), "_blank");

  const empty = page.card("Night Shelter");
  const emptyText = empty.textContent.replace(/\s+/g, " ");
  assert.ok(emptyText.includes("Not recorded."), "an entry with no source page says its empty fields were not recorded");
  assert.ok(
    !emptyText.includes("Not listed on the source page."),
    "it never claims a source page listed nothing when there is no source page",
  );
  assert.ok(emptyText.includes("No category"), "an entry with no category says so");
  assert.doesNotMatch(emptyText, /^Old Mission — Night Shelter$/, "the card is more than a name");
});

test("an entry with a source page still says a missing field was not listed there", async (t) => {
  setup(desk({ published: [{ ...FULL, serviceId: 9, fees: null }], publishedCount: 1, waiting: [], changes: [] }));
  const page = await mount();
  t.after(() => page.close());

  const text = page.card("Food Pantry").textContent.replace(/\s+/g, " ");
  assert.ok(text.includes("Not listed on the source page."), "the source page exists and does not list the fee");
});

test("a proposal shows the kind, the old and new values, the page's sentence, the source and the entry", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const row = [...page.container.querySelectorAll("li")].find((li) =>
    li.textContent.includes("Hours change"),
  );
  assert.ok(row, "the hours proposal is on the page");
  const text = row.textContent.replace(/\s+/g, " ");
  assert.ok(text.includes("The entry says now"), "the old value is labelled");
  assert.ok(text.includes("9 a.m."), "the old value");
  assert.ok(text.includes("The page now says"), "the new value is labelled");
  assert.ok(text.includes("10 a.m."), "the new value");
  assert.ok(text.includes("The pantry opens at 10 a.m. from now on."), "the page's own sentence");
  assert.ok(text.includes("Boulder pantry list"), "the source title");
  assert.ok(text.includes("captured on 2026-11-18"), "the capture date");
  const publicLink = [...row.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/registry/7");
  assert.ok(publicLink, "a link to the public entry");
  assert.deepEqual(page.buttons(row), ["Accept and apply", "Accept without applying", "Reject", "Edit"]);
});

test("a proposal stored with no data says so and offers only Reject", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const row = [...page.container.querySelectorAll("li")].find((li) =>
    li.textContent.includes("Mystery Site"),
  );
  assert.ok(row, "the empty proposal is listed");
  assert.match(row.textContent, /This proposal has no facts\. Reject it\./);
  assert.deepEqual(page.buttons(row), ["Reject"]);
  await page.press(page.button(row, "Reject"));
  assert.deepEqual(globalThis.__desk.calls, [["reject", { changeId: 2, note: null }]]);
});

test("clicking an entry opens its own page with all its fields, sources and history", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  assert.equal(page.container.querySelector('[data-testid="registry-entry-panel"]'), null);
  const heading = page.button(page.card("Food Pantry"), "Helping Hands — Food Pantry");
  await page.press(heading);
  const view = page.container.querySelector('[data-testid="registry-entry-panel"]');
  assert.ok(view, "the entry's own page opens");
  const text = view.textContent.replace(/\s+/g, " ");
  assert.ok(text.includes("303-555-0102"), "every phone is on the page");
  assert.ok(text.includes("Boulder pantry list"), "its source is on the page");
  assert.ok(text.includes("Added to the registry on 2026-01-02."), "its history starts with when it was added");
  assert.ok(text.includes("Auto-published by the scan on 2026-11-18"), "its history lists the scan's action");
  assert.ok(text.includes("Rechecked by the robot on 2026-11-19"), "its history says when the robot rechecked it");
  assert.deepEqual(globalThis.__desk.calls[0], ["panel", { serviceId: 7 }]);
});

test("the search box and the category filter narrow every list together", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const search = page.container.querySelector('input[aria-label="Search the registry"]');
  await React.act(async () => props(search).onChange({ target: { value: "shelter" } }));
  await page.settle();
  assert.ok(page.text().includes("Night Shelter"), "the match stays");
  assert.ok(!page.text().includes("Food Pantry"), "the other entry is filtered out");

  await React.act(async () => props(search).onChange({ target: { value: "" } }));
  await page.settle();
  const filter = page.container.querySelector(".registry-filter-select");
  await React.act(async () => props(filter).onChange({ target: { value: "Food" } }));
  await page.settle();
  assert.ok(page.text().includes("Food Pantry"), "the Food entry stays");
  assert.ok(!page.text().includes("Night Shelter"), "the uncategorised entry is filtered out");
});

test("each list is collapsible and its heading counts the rows", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const waiting = [...page.container.querySelectorAll("details.src-sec")].find((d) =>
    d.querySelector("summary")?.textContent.includes("Entries waiting to be published"),
  );
  assert.ok(waiting, "the waiting list is a collapsible block");
  assert.ok(waiting.querySelector("summary").textContent.includes("1"), "the heading counts its rows");
  assert.ok(waiting.querySelector("summary .sec-sub"), "the heading keeps its plain explanation");
});

test("a long list shows 25 rows and Show 25 more", async (t) => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    ...FULL,
    serviceId: 100 + index,
    serviceName: `Pantry ${index + 1}`,
    publishedCount: 30,
  }));
  setup(desk({ published: many, publishedCount: 30, waiting: [], changes: [] }));
  const page = await mount();
  t.after(() => page.close());

  assert.equal(page.cards().length, 25, "the first page holds 25 cards");
  assert.ok(page.text().includes("Showing 25 of 30 published entries"));
  await page.press(page.button(page.container, "Show 25 more"));
  assert.equal(page.cards().length, 30, "the next page adds the rest");
  assert.ok(!page.button(page.container, "Show 25 more"));
});
