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
export function InkButton({ children, onClick, disabled, pending, pendingLabel, type }) {
  return h("button", { type: type || "button", disabled: Boolean(disabled || pending), onClick },
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
});

function setup() {
  globalThis.__editor = {
    calls: [],
    detail: makeDetail(),
    save: async () => ({ ok: true, serviceId: 7 }),
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
    async press(button) {
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

test("saving the service sends exactly the fields on screen and says it was saved", async (t) => {
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
      description: "Groceries",
      url: "https://example.org/pantry",
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

test("saving the organization sends its fields", async (t) => {
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
    fields: {
      name: "Helping Hands",
      alternateName: "",
      description: "",
      email: "hello@example.org",
      website: "",
      legalStatus: "nonprofit",
    },
  });
  assert.match(page.group("Organization details").textContent, /Organization details saved\./);
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

test("changing a contact sends its id; adding one sends no id and the chosen scope", async (t) => {
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
    fields: {
      name: "Pantry desk",
      role: "",
      department: "",
      phone: "555-0100",
      phoneExtension: "14",
      email: "",
      website: "",
    },
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
    fields: {
      name: "Front desk",
      role: "",
      department: "",
      phone: "555-0123",
      phoneExtension: "",
      email: "",
      website: "",
    },
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
