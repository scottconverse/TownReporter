import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
window.confirm = () => true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const stub = (source) => transpileToUrl(source, "stub.tsx");

const paperStub = stub(`
  export const PAPER = { timezone: "America/Denver" };
  export const TOPICS = [];
  export function formatClockTime() { return "2:10 p.m."; }
  export function formatListDateTime() { return "Oct. 8, 2:10 p.m."; }
  export function parseUrlList(raw) { try { const parsed = JSON.parse(raw || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
`);
const copy = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": stub("export const looksLikeProviderAuthFailure=()=>false; export const providerAuthTarget=()=>\"\";"),
  "./lead-match.ts": stub("export const distinguishingOverlap=()=>({subjects:0,names:0});"),
  "../paper.ts": paperStub,
});
const chrome = stub(`
  import React from "react";
  export const Chip = ({s}) => React.createElement("span", null, s);
  export const InkButton = ({children,onClick,disabled,ariaLabel}) => React.createElement("button", {onClick,disabled,"aria-label":ariaLabel}, children);
`);
const states = stub(`import React from "react"; export const Notice=({kind,children})=>React.createElement("div",{"data-kind":kind},children);`);
const router = stub(`import React from "react"; export const Link=({children,...props})=>React.createElement("a",props,children);`);
const compareConfirm = stub(`export function confirmBeforeKillingDuplicate(confirm,message,press){if(confirm(message)) press();}`);
const toastStub = stub(`
  export const sent=[];
  export function clear() { sent.length=0; document.querySelectorAll("[data-test-toast]").forEach((node) => node.remove()); }
  export function deskToast(text,options={}) {
    sent.push({text,options});
    const card = document.createElement("div");
    card.dataset.testToast = "";
    card.dataset.toastId = String(options.id ?? "");
    card.append(document.createTextNode(text));
    const action = options.action ?? options.undo;
    if (action) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.addEventListener("click", () => { button.__deskRun = Promise.resolve(action.run()); });
      card.append(button);
    }
    document.getElementById("root").append(card);
  }
  export function deskErrorReason(error) { return error instanceof Error ? error.message : String(error ?? "The action failed."); }
  export function dismissDeskToast(id) { document.querySelectorAll("[data-test-toast]").forEach(node => { if (node.dataset.toastId === String(id)) node.remove(); }); }
`);
const fastKill = stub("export const KILL_TOAST_MS = 15000;");
const refusedAnswer = await moduleUrl("src/lib/news/refused-answer.ts");
const deskActionUrl = await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": toastStub,
  "@/lib/news/refused-answer": refusedAnswer,
});
const { useDeskMutation } = await import(deskActionUrl);
const panelUrl = await moduleUrl("src/components/desk-lead-compare.tsx", {
  "@/components/desk-chrome": chrome,
  "@/components/states": states,
  "@/components/fast-kill": fastKill,
  "@tanstack/react-router": router,
  "@/lib/paper": paperStub,
  "@/lib/news/duplicate-review": compareConfirm,
  "@/lib/news/desk-copy": copy,
  "@/components/desk-toast": toastStub,
});
const { LeadComparePanel, KilledLeadRecord } = await import(panelUrl);
const { sent, clear } = await import(toastStub);

function lead(id, headline, status) {
  return { id, headline, status, why: "A source record says this happened.", source_urls: "[]" };
}

async function render(root, node) {
  await React.act(async () => root.render(node));
}

async function click(button) {
  assert.ok(button, "the named press is visible");
  await React.act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickToast(label) {
  const button = [...document.querySelectorAll("[data-test-toast] button")].find((item) => item.textContent === label);
  assert.ok(button, `the shared toast action ${label} is visible`);
  await React.act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await button.__deskRun;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("Compare Kill uses the shared warning retry and success Undo", async (t) => {
  clear();
  const root = createRoot(document.getElementById("root"));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  const state = { status: "new", reason: "" };
  const overrides = [];
  const key = "lead-status-drafted";
  const sentence = "This lead has a written draft. Changing its status will keep the saved draft.";
  function Fixture() {
    const kill = useDeskMutation({
      mutationFn: async (input) => {
        overrides.push(input.override ?? []);
        if (!input.override?.includes(key)) return { ok: false, error: sentence, warning: { key, sentence } };
        state.status = "killed";
        state.reason = input.killReason;
        return { ok: true };
      },
      warningAction: "Kill",
      pending: "Saving…",
      done: () => "The lead moved to Killed.",
      undo: (_result, input) => ({ label: "Undo", run: async () => { state.status = input.restore; } }),
      duration: () => 15000,
      after: async () => {},
    });
    return React.createElement(LeadComparePanel, {
      current: lead(31, "Current garage repair lead", state.status),
      prior: lead(30, "Earlier garage repair lead", "published"),
      onKillThis: (override) => kill.mutateAsync({ id: 31, status: "killed", killReason: "Duplicate of Earlier garage repair lead", restore: "new", override }),
      formatDate: (value) => value ?? "today",
    });
  }
  t.after(async () => { await React.act(async () => root.unmount()); client.clear(); });
  await render(root, React.createElement(QueryClientProvider, { client }, React.createElement(Fixture)));
  await click([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Same story")));
  assert.deepEqual(overrides, [[]]);
  assert.doesNotMatch(document.querySelector(".lead-compare").textContent, /written draft/i);
  assert.match(document.querySelector(".lead-compare").textContent, /Nothing was saved yet/, "a held press must say in the panel that nothing moved");
  assert.equal(sent.length, 1, "the panel must not create a second warning action");
  assert.equal(sent[0].text, sentence);
  assert.equal(sent[0].options.action.label, "Kill anyway");
  await clickToast("Kill anyway");
  assert.deepEqual(overrides, [[], [key]]);
  assert.equal(state.status, "killed");
  assert.equal(state.reason, "Duplicate of Earlier garage repair lead");
  assert.equal(sent.at(-1).text, "The lead moved to Killed.");
  assert.equal(sent.at(-1).options.undo.label, "Undo");
  assert.equal(sent.at(-1).options.duration, 15000);
  await clickToast("Undo");
  assert.equal(state.status, "new");
});

test("Compare Move to New uses the shared warning retry and updates a killed lead", async (t) => {
  clear();
  const root = createRoot(document.getElementById("root"));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  const state = { status: "killed", linked: true };
  const overrides = [];
  const key = "lead-duplicate-new-drafted";
  const sentence = "A saved draft will remain.";
  function Fixture() {
    const move = useDeskMutation({
      mutationFn: async (input) => {
        overrides.push(input.override ?? []);
        if (!input.override?.includes(key)) return { ok: false, error: sentence, warning: { key, sentence } };
        state.status = "new";
        state.linked = false;
        return { ok: true };
      },
      warningAction: "Move to New",
      pending: "Moving to New…",
      done: (_result, input) => input.override?.length ? `Moved to New: ${input.headline}` : "",
      after: async () => {},
    });
    return React.createElement(LeadComparePanel, {
      current: lead(41, "School open house lead", state.status),
      prior: lead(40, "Earlier school event", "new"),
      onNotADuplicate: (override) => move.mutateAsync({ id: 41, action: "not-a-duplicate", headline: "School open house lead", override }),
      formatDate: (value) => value ?? "today",
    });
  }
  t.after(async () => { await React.act(async () => root.unmount()); client.clear(); });
  await render(root, React.createElement(QueryClientProvider, { client }, React.createElement(Fixture)));
  await click([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Not a duplicate")));
  assert.deepEqual(overrides, [[]]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, sentence);
  assert.equal(sent[0].options.action.label, "Move to New anyway");
  await clickToast("Move to New anyway");
  assert.deepEqual(overrides, [[], [key]]);
  assert.deepEqual(state, { status: "new", linked: false });
  assert.equal(sent.at(-1).text, "Moved to New: School open house lead");
  assert.equal(sent.at(-1).options.tone, "ok");
  assert.equal(sent.filter((toast) => toast.options.tone === "warn").length, 1);
  client.clear();
});

test("reopened Story shows its title while retaining the kill history", async (t) => {
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(async () => root.unmount()); });
  await render(root, React.createElement(KilledLeadRecord, {
    lead: { ...lead(51, "The reopened council records lead", "new"), killed_at: "2026-10-10T12:00:00Z", kill_reason: "No longer a duplicate" },
    reopened: true,
    formatDate: () => "Oct. 10",
  }));
  assert.equal(document.querySelector("h2")?.textContent, "The reopened council records lead");
  assert.match(document.body.textContent, /reopened|undone/i);
});
