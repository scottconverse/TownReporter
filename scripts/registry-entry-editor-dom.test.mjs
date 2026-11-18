/*
  The registry entry editor, mounted and used (spec 24, Phase 2, job C1).

  WHAT THIS PROVES. The editor loads one entry's detail and shows the service,
  the organization and each contact in their own group; a group whose row other
  entries use says so, with their names, in a visible notice; editing a field
  and pressing that group's save sends the server function exactly the fields
  on screen; problems the server returns show under their field as alerts and
  say nothing was saved; a thrown error says nothing was saved; a new contact
  is sent with no contact id and the scope chosen; and the desk lists and the
  detail are refreshed after a save.

  The server functions are stubs that record their calls (what the editor ASKED
  the server to do is what this file measures; what the server does with it is
  in registry-entry-editor.server.test.ts). `@tanstack/react-query`, the editor
  and the field rules are the real ones, in the in-process DOM
  (scripts/dom-harness.mjs). linkedom has no default action, so inputs are
  driven by calling their React handlers.
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
`);

/* The stubs read their next answer from globalThis.__editor, set per test. */
const serverUrl = stubUrl(`
export async function readRegistryEntryDetail({ data }) {
  globalThis.__editor.calls.push(["read", data]);
  return globalThis.__editor.detail;
}
export async function saveRegistryServiceDetails({ data }) {
  globalThis.__editor.calls.push(["service", data]);
  return globalThis.__editor.save(data);
}
export async function saveRegistryOrganizationDetails({ data }) {
  globalThis.__editor.calls.push(["organization", data]);
  return globalThis.__editor.save(data);
}
export async function saveRegistryContact({ data }) {
  globalThis.__editor.calls.push(["contact", data]);
  return globalThis.__editor.save(data);
}
export async function saveRegistryRow({ data }) {
  globalThis.__editor.calls.push(["row", data]);
  return globalThis.__editor.save(data);
}
export async function removeRegistryRow({ data }) {
  globalThis.__editor.calls.push(["remove", data]);
  return globalThis.__editor.remove(data);
}
export async function restoreRegistryRow({ data }) {
  globalThis.__editor.calls.push(["restore", data]);
  return globalThis.__editor.remove(data);
}
`);
const fieldsUrl = await moduleUrl("src/lib/news/registry/registry-entry-editor-fields.ts");
const editorUrl = await moduleUrl("src/components/registry-entry-editor.tsx", {
  "@/components/desk-chrome": chromeUrl,
  "@/lib/news/registry/registry-entry-editor": serverUrl,
  "@/lib/news/registry/registry-entry-editor-fields": fieldsUrl,
});
const { RegistryEntryEditor } = await import(editorUrl);

const sibling = { serviceId: 8, name: "Helping Hands — Clothing Closet" };
const sibling2 = { serviceId: 9, name: "Helping Hands — Rent Help" };
const makeDetail = () => ({
  service: {
    id: 7,
    published: true,
    name: "Food Pantry",
    description: "Groceries",
    url: "https://example.org/pantry",
    fees: "Free",
    applicationProcess: "Walk in",
    crisis: false,
  },
  organization: {
    id: 3,
    name: "Helping Hands",
    alternateName: "",
    description: "",
    email: "old@example.org",
    website: "",
    legalStatus: "",
    sharedWith: [sibling, sibling2],
  },
  contacts: [
    {
      id: 11,
      scope: "service",
      locationName: null,
      name: "Pantry desk",
      role: "",
      department: "",
      phone: "555-0100",
      phoneExtension: "",
      email: "",
      website: "",
      sharedWith: [],
    },
    {
      id: 12,
      scope: "location",
      locationName: "Main Hall",
      name: "Hall office",
      role: "",
      department: "",
      phone: "555-0111",
      phoneExtension: "",
      email: "",
      website: "",
      sharedWith: [sibling],
    },
  ],
  places: [
    {
      id: 21,
      locationId: 5,
      locationName: null,
      sharedWith: [],
      fields: {
        name: "Main Hall",
        address1: "1 Main St",
        address2: "",
        city: "Longmont",
        stateProvince: "CO",
        postalCode: "80501",
        accessibilityNotes: "",
        transportationNotes: "",
      },
    },
  ],
  schedules: [
    {
      id: 31,
      locationId: null,
      locationName: null,
      sharedWith: [],
      fields: { days: "Monday", opensAt: "9:00", closesAt: "17:00", notes: "", byAppointment: false },
    },
  ],
  eligibilities: [],
  requiredDocuments: [
    {
      id: 41,
      locationId: null,
      locationName: null,
      sharedWith: [],
      fields: { document: "Photo ID", description: "", required: true },
    },
  ],
  languages: [
    {
      id: 51,
      locationId: null,
      locationName: null,
      sharedWith: [],
      fields: { language: "Spanish", note: "" },
    },
  ],
  accessibilities: [],
  linkablePlaces: [{ locationId: 6, name: "Annex, 3 Pine St" }],
  removed: [],
});

function setup() {
  globalThis.__editor = {
    calls: [],
    detail: makeDetail(),
    save: async () => ({ ok: true, serviceId: 7 }),
    remove: async () => ({ ok: true, serviceId: 7 }),
  };
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  const invalidated = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters, ...rest) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return invalidate(filters, ...rest);
  };
  let closed = 0;
  const root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(RegistryEntryEditor, { serviceId: 7, onClose: () => closed++ }),
      ),
    ),
  );
  const props = (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))];
  const api = {
    container,
    invalidated,
    closed: () => closed,
    text: () => container.textContent.replace(/\s+/g, " "),
    group: (title) => container.querySelector(`section[aria-label="${title}"]`),
    groupStarting: (title) =>
      [...container.querySelectorAll("section")].find((g) => g.getAttribute("aria-label").startsWith(title)),
    contactGroups: () =>
      [...container.querySelectorAll("section")].filter((g) => /\(.*contact/i.test(g.getAttribute("aria-label"))),
    button: (scope, label) =>
      [...scope.querySelectorAll("button")].find((b) => b.textContent === label),
    input: (scope, name) => scope.querySelector(`[name="${name}"]`),
    alerts: (scope = container) => [...scope.querySelectorAll('[role="alert"]')].map((a) => a.textContent),
    async settle() {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async type(scope, name, value) {
      const node = scope.querySelector(`[name="${name}"]`);
      await React.act(async () => props(node).onChange({ target: { value } }));
    },
    async check(scope, name, checked) {
      const node = scope.querySelector(`[name="${name}"]`);
      await React.act(async () => props(node).onChange({ target: { checked } }));
    },
    async submit(scope) {
      const form = scope.querySelector("form");
      await React.act(async () => props(form).onSubmit({ preventDefault() {} }));
      await api.settle();
    },
    /** Two submits of the same form in one tick, before React re-renders. */
    async submitTwice(scope) {
      const handler = props(scope.querySelector("form")).onSubmit;
      await React.act(async () => {
        handler({ preventDefault() {} });
        handler({ preventDefault() {} });
      });
      await api.settle();
    },
    async press(button) {
      await React.act(async () => {
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    /** Refetch the entry's detail, as the page does after a save elsewhere. */
    async refetch() {
      await React.act(async () => {
        await client.invalidateQueries({ queryKey: ["registry-entry-detail", 7] });
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

test("the editor shows the service, the organization and each contact in its own group", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  assert.deepEqual(globalThis.__editor.calls[0], ["read", { serviceId: 7 }]);
  assert.ok(page.group("Service details"));
  assert.ok(page.group("Organization details"));
  assert.equal(page.input(page.group("Service details"), "name").value, "Food Pantry");
  assert.equal(page.input(page.group("Service details"), "fees").value, "Free");
  assert.equal(page.input(page.group("Organization details"), "email").value, "old@example.org");
  assert.equal(page.contactGroups().length, 2);
  assert.ok(page.group("Add a contact"));
  assert.equal(page.button(page.container, "Close the details editor") !== undefined, true);
  await page.press(page.button(page.container, "Close the details editor"));
  assert.equal(page.closed(), 1);
});

test("a shared organization and a shared location contact say who else uses them", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const orgNotice = page.group("Organization details").querySelector('[data-testid="shared-notice"]');
  assert.ok(orgNotice, "the organization group has a notice");
  assert.equal(
    orgNotice.textContent,
    "This is shared with 2 other entries: Helping Hands — Clothing Closet; " +
      "Helping Hands — Rent Help. A change here changes them too.",
  );
  assert.equal(
    page.group("Service details").querySelector('[data-testid="shared-notice"]'),
    null,
    "the service's own group is not shared",
  );
  const [own, location] = page.contactGroups();
  assert.equal(own.querySelector('[data-testid="shared-notice"]'), null);
  assert.equal(
    location.querySelector('[data-testid="shared-notice"]').textContent,
    "This is shared with 1 other entry: Helping Hands — Clothing Closet. A change here changes them too.",
  );
  assert.match(location.getAttribute("aria-label"), /Main Hall/);
});

test("an organization shared with nothing shows no notice", async (t) => {
  setup();
  globalThis.__editor.detail.organization.sharedWith = [];
  const page = await mount();
  t.after(() => page.close());
  assert.equal(page.container.querySelectorAll('[data-testid="shared-notice"]').length, 1, "only the location contact");
});

test("saving the service sends only the fields the editor changed and says it was saved", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const group = page.group("Service details");
  await page.type(group, "name", "Food Pantry North");
  await page.type(group, "fees", "Five dollars");
  await page.type(group, "applicationProcess", "Call first");
  await page.check(group, "crisis", true);
  await page.submit(group);

  const call = globalThis.__editor.calls.find((c) => c[0] === "service");
  assert.deepEqual(call[1], {
    serviceId: 7,
    fields: {
      name: "Food Pantry North",
      fees: "Five dollars",
      applicationProcess: "Call first",
      crisis: true,
    },
  });
  const status = page.group("Service details").querySelector('[role="status"]');
  assert.equal(status.textContent, "Service details saved.");
  assert.ok(page.invalidated.includes('["registry-desk"]'), "the desk lists were not refreshed");
  assert.ok(page.invalidated.includes('["registry-entry-detail",7]'), "the detail was not refreshed");
});

test("saving the organization sends only the fields that changed", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const group = page.group("Organization details");
  await page.type(group, "email", "hello@example.org");
  await page.type(group, "legalStatus", "nonprofit");
  await page.submit(group);
  const call = globalThis.__editor.calls.find((c) => c[0] === "organization");
  assert.deepEqual(call[1], {
    serviceId: 7,
    fields: { email: "hello@example.org", legalStatus: "nonprofit" },
  });
  assert.match(page.group("Organization details").textContent, /Organization details saved\./);
});

test("a refetch refreshes a form with no unsaved edits, and keeps the editor's unsaved edits", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const service = () => page.group("Service details");
  // The stub returns a fresh copy of the entry, as the server would.
  const changeSavedEntry = (change) => {
    const next = JSON.parse(JSON.stringify(globalThis.__editor.detail));
    change(next);
    globalThis.__editor.detail = next;
  };

  // Someone else changes the fee. Nothing is unsaved here, so the form follows.
  changeSavedEntry((d) => {
    d.service.fees = "Five dollars";
  });
  await page.refetch();
  assert.equal(page.input(service(), "fees").value, "Five dollars", "an untouched form shows the saved value");

  // This editor types a name; meanwhile someone else changes the fee again.
  await page.type(service(), "name", "Food Pantry North");
  changeSavedEntry((d) => {
    d.service.fees = "Ten dollars";
  });
  await page.refetch();
  assert.equal(page.input(service(), "name").value, "Food Pantry North", "the unsaved name is kept");
  await page.submit(service());
  const call = globalThis.__editor.calls.filter((c) => c[0] === "service").at(-1);
  assert.deepEqual(call[1].fields, { name: "Food Pantry North" }, "the other editor's fee is not sent back");
});

test("pressing Add contact twice in one tick sends one contact", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const add = page.group("Add a contact");
  await page.type(add, "name", "Front desk");
  await page.type(add, "phone", "555-0123");
  await page.submitTwice(add);
  assert.equal(globalThis.__editor.calls.filter((c) => c[0] === "contact").length, 1, "two submits, one contact");
});

test("the long-text boxes have the same limit as the server", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  // The attribute is read as React writes it (maxLength); HTML attribute names
  // are case-insensitive in a browser, so this is the same attribute there.
  const limit = (group, name) => group.querySelector(`textarea[name="${name}"]`)?.getAttribute("maxLength");
  assert.equal(limit(page.group("Service details"), "description"), "2000");
  assert.equal(limit(page.group("Service details"), "applicationProcess"), "2000");
  assert.equal(limit(page.group("Organization details"), "description"), "2000");
});

test("problems the server returns show under their field as alerts and say nothing was saved", async (t) => {
  setup();
  globalThis.__editor.save = async () => ({
    ok: false,
    problems: {
      email: "The email address must look like name@example.org.",
      website: "The website must be a full web address starting with https:// or http://.",
    },
  });
  const page = await mount();
  t.after(() => page.close());
  const group = page.group("Organization details");
  await page.type(group, "email", "nope");
  await page.submit(group);

  const alerts = page.alerts(group);
  assert.ok(alerts.some((a) => /Nothing was saved/.test(a)), "no plain 'nothing was saved' alert");
  assert.ok(alerts.includes("The email address must look like name@example.org."));
  assert.ok(alerts.some((a) => /full web address/.test(a)));
  const emailLabel = page.input(group, "email").parentElement;
  assert.match(emailLabel.textContent, /must look like name@example\.org/, "the problem is under its own field");
  assert.equal(group.querySelector('[role="status"]'), null, "a refusal was called a save");
  assert.deepEqual(page.alerts(page.group("Service details")), [], "another group shows nothing");
});

test("a server error says nothing was saved", async (t) => {
  setup();
  globalThis.__editor.save = async () => {
    throw new Error("The connection dropped.");
  };
  const page = await mount();
  t.after(() => page.close());
  const group = page.group("Service details");
  await page.submit(group);
  assert.deepEqual(page.alerts(group), ["The connection dropped. Nothing was saved."]);
});

test("changing a contact sends its id and only its changed field; adding one sends no id and the chosen scope", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());

  const [own] = page.contactGroups();
  await page.type(own, "phoneExtension", "14");
  await page.submit(own);
  const changed = globalThis.__editor.calls.find((c) => c[0] === "contact");
  assert.deepEqual(changed[1], {
    serviceId: 7,
    contactId: 11,
    scope: "service",
    fields: { phoneExtension: "14" },
  });
  assert.match(own.textContent, /Contact saved\./);

  const add = page.group("Add a contact");
  assert.equal(add.querySelector('[data-testid="shared-notice"]'), null, "a service contact is not shared");
  await page.type(add, "name", "Front desk");
  await page.type(add, "phone", "555-0123");
  const select = add.querySelector('[name="scope"]');
  await React.act(async () =>
    select[Object.keys(select).find((k) => k.startsWith("__reactProps"))].onChange({
      target: { value: "organization" },
    }),
  );
  assert.match(
    add.querySelector('[data-testid="shared-notice"]').textContent,
    /This is shared with 2 other entries: Helping Hands — Clothing Closet; Helping Hands — Rent Help\. A change here changes them too\./,
    "choosing the organization shows who shares it",
  );
  await page.submit(add);
  const added = globalThis.__editor.calls.filter((c) => c[0] === "contact")[1];
  assert.deepEqual(added[1], {
    serviceId: 7,
    contactId: null,
    scope: "organization",
    fields: { name: "Front desk", phone: "555-0123" },
  });
  assert.match(add.textContent, /Contact added\./);
  assert.equal(page.input(add, "name").value, "", "the add form is empty for the next contact");
});

test("an entry that cannot be loaded says so and changes nothing", async (t) => {
  setup();
  globalThis.__editor.detail = undefined;
  const failing = stubUrl(`
export async function readRegistryEntryDetail() { throw new Error("That entry is not in this newsroom."); }
export const saveRegistryServiceDetails = readRegistryEntryDetail;
export const saveRegistryOrganizationDetails = readRegistryEntryDetail;
export const saveRegistryContact = readRegistryEntryDetail;
export const saveRegistryRow = readRegistryEntryDetail;
export const removeRegistryRow = readRegistryEntryDetail;
export const restoreRegistryRow = readRegistryEntryDetail;
`);
  const failUrl = await moduleUrl("src/components/registry-entry-editor.tsx", {
    "@/components/desk-chrome": chromeUrl,
    "@/lib/news/registry/registry-entry-editor": failing,
    "@/lib/news/registry/registry-entry-editor-fields": fieldsUrl,
  });
  const { RegistryEntryEditor: Failing } = await import(failUrl);
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(Failing, { serviceId: 7, onClose() {} }),
      ),
    ),
  );
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  const alert = container.querySelector('[role="alert"]');
  assert.match(alert.textContent, /not in this newsroom\. Nothing was changed\./);
  assert.equal(container.querySelectorAll("form").length, 0);
});

/* ---- Job C2: places, hours, documents, languages, removal ---- */

const REMOVE_WORDS =
  "Remove this language from the entry? It stops showing on the public page right away. " +
  "You can bring it back from the Removed list.";

test("the other groups show their rows, and each row's form is filled from the entry", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const place = page.groupStarting("Place: ");
  assert.equal(page.input(place, "city").value, "Longmont");
  assert.equal(page.input(page.groupStarting("Hours: "), "days").value, "Monday");
  assert.equal(page.input(page.groupStarting("Required document: "), "document").value, "Photo ID");
  assert.equal(page.input(page.groupStarting("Required document: "), "required").checked, true);
  assert.equal(page.input(page.groupStarting("Language: "), "language").value, "Spanish");
  for (const title of [
    "Add a new place",
    "Link a place this organization already has",
    "Add hours",
    "Add who can use this service",
    "Add a required document",
    "Add a language",
    "Add an accessibility note",
    "Removed from this entry",
  ]) {
    assert.ok(page.group(title), title);
  }
  assert.match(page.group("Removed from this entry").textContent, /Nothing has been removed from this entry\./);
});

test("saving a language sends its row id and only the field that changed", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const group = () => page.groupStarting("Language: ");
  await page.type(group(), "note", "Tuesdays only");
  await page.submit(group());
  const call = globalThis.__editor.calls.find((c) => c[0] === "row");
  assert.deepEqual(call[1], {
    serviceId: 7,
    kind: "language",
    rowId: 51,
    locationId: null,
    fields: { note: "Tuesdays only" },
  });
  assert.match(group().textContent, /Saved\./);
  assert.ok(page.invalidated.includes('["registry-entry-detail",7]'));
});

test("adding hours sends no row id, the chosen place and only the boxes that were filled", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const add = page.group("Add hours");
  const select = add.querySelector('select[name="locationId"]');
  assert.deepEqual([...select.querySelectorAll("option")].map((o) => o.textContent), [
    "At the service as a whole",
    "At Main Hall",
  ]);
  await React.act(async () => select[Object.keys(select).find((k) => k.startsWith("__reactProps"))].onChange({ target: { value: "5" } }));
  await page.type(add, "days", "Friday");
  await page.check(add, "byAppointment", true);
  await page.submit(add);
  const call = globalThis.__editor.calls.find((c) => c[0] === "row");
  assert.deepEqual(call[1], {
    serviceId: 7,
    kind: "schedule",
    rowId: null,
    locationId: 5,
    fields: { days: "Friday", byAppointment: true },
  });
  assert.match(add.textContent, /Hours added\./);
  assert.equal(page.input(add, "days").value, "", "the add form is empty for the next one");
});

test("a new required document starts with 'required' ticked and sends only what was typed", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const add = page.group("Add a required document");
  assert.equal(page.input(add, "required").checked, true);
  await page.type(add, "document", "Lease");
  await page.submit(add);
  assert.deepEqual(globalThis.__editor.calls.find((c) => c[0] === "row")[1].fields, { document: "Lease" });
});

test("problems on a row show under their box as alerts and say nothing was saved", async (t) => {
  setup();
  globalThis.__editor.save = async () => ({
    ok: false,
    problems: { language: "Enter the language.", form: "Enter something." },
  });
  const page = await mount();
  t.after(() => page.close());
  const add = page.group("Add a language");
  await page.submit(add);
  const alerts = page.alerts(add);
  assert.ok(alerts.includes("Enter the language."));
  assert.ok(alerts.some((a) => /Nothing was saved/.test(a)));
  assert.doesNotMatch(add.textContent, /Language added\./);
});

test("linking an existing place sends its id", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const link = page.group("Link a place this organization already has");
  await page.submit(link);
  assert.deepEqual(globalThis.__editor.calls.find((c) => c[0] === "row")[1], {
    serviceId: 7,
    kind: "location",
    rowId: null,
    locationId: 6,
    fields: {},
  });
  assert.match(link.textContent, /Place linked\./);
});

test("Remove asks first, in plain words, and Keep it sends nothing", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const group = () => page.groupStarting("Language: ");
  assert.equal(group().querySelector('[data-testid="remove-confirm"]'), null, "no question until Remove is pressed");
  await page.press(page.button(group(), "Remove"));
  const confirm = group().querySelector('[data-testid="remove-confirm"]');
  assert.ok(page.text().includes(REMOVE_WORDS), "the sentence says what happens");
  assert.equal(globalThis.__editor.calls.filter((c) => c[0] === "remove").length, 0);
  await page.press(page.button(confirm, "Keep it"));
  assert.equal(group().querySelector('[data-testid="remove-confirm"]'), null);
  assert.equal(globalThis.__editor.calls.filter((c) => c[0] === "remove").length, 0, "nothing was sent");
});

test("a shared row says who else uses it before the removal is confirmed", async (t) => {
  setup();
  globalThis.__editor.detail.places[0].sharedWith = [sibling];
  const page = await mount();
  t.after(() => page.close());
  const group = () => page.groupStarting("Place: ");
  await page.press(page.button(group(), "Remove"));
  const notice = group().querySelector('[data-testid="remove-shared-notice"]');
  assert.equal(
    notice.textContent,
    "This is shared with 1 other entry: Helping Hands — Clothing Closet. A change here changes them too.",
  );
  assert.match(group().querySelector('[data-testid="remove-confirm"]').textContent, /Remove this place from the entry\?/);
});

test("confirming a removal sends the kind and row id once, refreshes, and says where it went", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const group = () => page.groupStarting("Hours: ");
  await page.press(page.button(group(), "Remove"));
  const yes = page.button(group().querySelector('[data-testid="remove-confirm"]'), "Yes, remove");
  await React.act(async () => {
    yes.dispatchEvent(new window.Event("click", { bubbles: true }));
    yes.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await page.settle();
  const calls = globalThis.__editor.calls.filter((c) => c[0] === "remove");
  assert.equal(calls.length, 1, "two presses, one removal");
  assert.deepEqual(calls[0][1], { serviceId: 7, kind: "schedule", rowId: 31 });
  assert.ok(page.invalidated.includes('["registry-entry-detail",7]'));
  assert.ok(page.invalidated.includes('["registry-desk"]'));
  const status = [...page.group("Removed from this entry").querySelectorAll('[role="status"]')].map((n) => n.textContent);
  assert.deepEqual(status, ["Removed. It is in the Removed list below, and Restore brings it back."]);
});

test("a contact is removed the same way, with its own words", async (t) => {
  setup();
  const page = await mount();
  t.after(() => page.close());
  const [own] = page.contactGroups();
  await page.press(page.button(own, "Remove"));
  assert.match(own.querySelector('[data-testid="remove-confirm"]').textContent, /Remove this contact from the entry\?/);
  await page.press(page.button(own.querySelector('[data-testid="remove-confirm"]'), "Yes, remove"));
  await page.settle();
  assert.deepEqual(globalThis.__editor.calls.find((c) => c[0] === "remove")[1], { serviceId: 7, kind: "contact", rowId: 11 });
  assert.equal(page.button(page.group("Add a contact"), "Remove"), undefined, "the add form has no Remove");
});

test("a removal that fails says nothing was removed and keeps the question open", async (t) => {
  setup();
  globalThis.__editor.remove = async () => {
    throw new Error("The connection dropped.");
  };
  const page = await mount();
  t.after(() => page.close());
  const group = () => page.groupStarting("Language: ");
  await page.press(page.button(group(), "Remove"));
  await page.press(page.button(group().querySelector('[data-testid="remove-confirm"]'), "Yes, remove"));
  await page.settle();
  assert.deepEqual(page.alerts(group()), ["The connection dropped. Nothing was removed."]);
  assert.ok(group().querySelector('[data-testid="remove-confirm"]'), "the question stays so it can be tried again");
});

test("the Removed list shows each removed row, with who else uses it, and Restore sends its kind and id", async (t) => {
  setup();
  globalThis.__editor.detail.removed = [
    { kind: "language", id: 52, label: "Vietnamese", sharedWith: [] },
    { kind: "contact", id: 13, label: "Old desk, phone 555-0000", sharedWith: [sibling] },
  ];
  const page = await mount();
  t.after(() => page.close());
  const list = page.group("Removed from this entry");
  const items = [...list.querySelectorAll('[data-testid="removed-item"]')];
  assert.deepEqual(items.map((i) => i.querySelector("p:last-of-type").textContent), [
    "Language: Vietnamese",
    "Contact: Old desk, phone 555-0000",
  ]);
  assert.equal(items[0].querySelectorAll('[data-testid="shared-notice"]').length, 0);
  assert.equal(items[1].querySelectorAll('[data-testid="shared-notice"]').length, 1, "the shared notice shows before a shared row is restored");
  assert.match(list.textContent, /Nothing is deleted: Restore puts a row back\./);

  await page.press(page.button(items[1], "Restore"));
  await page.settle();
  assert.deepEqual(globalThis.__editor.calls.find((c) => c[0] === "restore")[1], { serviceId: 7, kind: "contact", rowId: 13 });
  const status = [...list.querySelectorAll('[role="status"]')].map((n) => n.textContent);
  assert.deepEqual(status, ["Restored. It is back in the entry as it was before it was removed."]);
  assert.ok(page.invalidated.includes('["registry-entry-detail",7]'));
});

test("a restore that fails says nothing was restored", async (t) => {
  setup();
  globalThis.__editor.detail.removed = [{ kind: "language", id: 52, label: "Vietnamese", sharedWith: [] }];
  globalThis.__editor.remove = async () => {
    throw new Error("The connection dropped.");
  };
  const page = await mount();
  t.after(() => page.close());
  const item = page.container.querySelector('[data-testid="removed-item"]');
  await page.press(page.button(item, "Restore"));
  await page.settle();
  assert.deepEqual(page.alerts(item), ["The connection dropped. Nothing was restored."]);
});
