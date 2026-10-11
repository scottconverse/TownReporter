import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
window.confirm = () => true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
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
  export function clear() { document.querySelectorAll("[data-test-toast]").forEach((node) => node.remove()); }
  export function deskToast(text,options={}) {
    sent.push({text,options});
    const card = document.createElement("div");
    card.dataset.testToast = "";
    card.append(document.createTextNode(text));
    if (options.undo) {
      const button = document.createElement("button");
      button.textContent = options.undo.label;
      button.addEventListener("click", () => { void options.undo.run(); });
      card.append(button);
    }
    document.getElementById("root").append(card);
  }
`);
const fastKill = stub("export const KILL_TOAST_MS = 15000;");
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

test("Compare kill warns, repeats with the exact override, records duplicate reason, and offers Undo", async (t) => {
  sent.length = 0;
  clear();
  const root = createRoot(document.getElementById("root"));
  const state = { status: "new", reason: "" };
  const overrides = [];
  const current = lead(31, "Current garage repair lead", state.status);
  const prior = lead(30, "Earlier garage repair lead", "published");
  const onKillThis = async (override) => {
    overrides.push(override ?? []);
    if (!override?.length) {
      return {
        ok: false,
        error: "This lead has a written draft. Changing its status will keep the saved draft.",
        warning: { key: "lead-status-drafted", sentence: "This lead has a written draft. Changing its status will keep the saved draft." },
      };
    }
    state.status = "killed";
    state.reason = "Duplicate of Earlier garage repair lead";
    return { ok: true, undo: async () => { state.status = "new"; } };
  };
  t.after(async () => { await React.act(async () => root.unmount()); });
  await render(root, React.createElement(LeadComparePanel, {
    current,
    prior,
    onKillThis,
    formatDate: (value) => value ?? "today",
  }));
  await click([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Same story")));
  assert.match(document.body.textContent, /written draft/i);
  await click([...document.querySelectorAll("button")].find((button) => button.textContent === "Kill anyway"));
  assert.deepEqual(overrides, [[], ["lead-status-drafted"]]);
  assert.equal(state.status, "killed");
  assert.equal(state.reason, "Duplicate of Earlier garage repair lead");
  assert.match(sent[1].text, /Killed as a duplicate of Earlier garage repair lead/);
  assert.equal(sent[1].options.undo.label, "Undo");
  await click([...document.querySelectorAll("button")].find((button) => button.textContent === "Undo"));
  assert.equal(state.status, "new");
});

test("Compare move-to-New repeats its warning and changes a killed lead's state", async (t) => {
  clear();
  const root = createRoot(document.getElementById("root"));
  const state = { status: "killed", linked: true };
  const overrides = [];
  t.after(async () => { await React.act(async () => root.unmount()); });
  await render(root, React.createElement(LeadComparePanel, {
    current: lead(41, "School open house lead", state.status),
    prior: lead(40, "Earlier school event", "new"),
    onNotADuplicate: async (override) => {
      overrides.push(override ?? []);
      if (!override?.length) {
        return { ok: false, error: "A saved draft will remain.", warning: { key: "lead-duplicate-new-drafted", sentence: "A saved draft will remain." } };
      }
      state.status = "new";
      state.linked = false;
      return { ok: true };
    },
    formatDate: (value) => value ?? "today",
  }));
  await click([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Not a duplicate")));
  await click([...document.querySelectorAll("button")].find((button) => button.textContent === "Move to New anyway"));
  assert.deepEqual(overrides, [[], ["lead-duplicate-new-drafted"]]);
  assert.deepEqual(state, { status: "new", linked: false });
  assert.match(document.body.textContent, /Moved to New: School open house lead/);
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
