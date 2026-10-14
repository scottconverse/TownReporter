// guards: Compare "Same story — kill this one" keeps its confirm, kills on yes, and says so when the confirm is closed (DHG-1)
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
/* An automated walk dismisses a native dialog; a person may press OK. */
let confirmAsked = 0;
let confirmAnswer = false;
window.confirm = () => { confirmAsked++; return confirmAnswer; };
globalThis.confirm = window.confirm;
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
  "./lead-match.ts": stub("export const distinguishingOverlap=()=>({subjects:0,names:0}); export const explainPairMatch=()=>null; export const sharesTightName=()=>false;"),
  "../paper.ts": paperStub,
});
const chrome = stub(`
  import React from "react";
  export const Chip = ({s}) => React.createElement("span", null, s);
  export const InkButton = ({children,onClick,disabled,ariaLabel}) => React.createElement("button", {onClick,disabled,"aria-label":ariaLabel}, children);
`);
const states = stub(`import React from "react"; export const Notice=({kind,children})=>React.createElement("div",{"data-kind":kind},children);`);
const router = stub(`import React from "react"; export const Link=({children,...props})=>React.createElement("a",props,children);`);
const panelUrl = await moduleUrl("src/components/desk-lead-compare.tsx", {
  "@/components/desk-chrome": chrome,
  "@/components/states": states,
  "@/components/fast-kill": stub("export const KILL_TOAST_MS = 15000;"),
  "@tanstack/react-router": router,
  "@/lib/paper": paperStub,
  "@/lib/news/desk-copy": copy,
  "@/lib/news/duplicate-review": await moduleUrl("src/lib/news/duplicate-review.ts"),
  "@/components/desk-toast": stub("export function deskToast(){}"),
});
const { LeadComparePanel } = await import(panelUrl);

const side = (id, headline, status) => ({ id, headline, status, why: "A source record says this happened.", source_urls: "[]" });

for (const [status, answer] of [["held", true], ["new", true], ["held", false]]) {
  test(`"Same story — kill this one" on a ${status} lead, confirm answered ${answer ? "OK" : "closed"}`, async () => {
    const root = createRoot(document.getElementById("root"));
    const kills = [];
    confirmAsked = 0;
    confirmAnswer = answer;
    try {
      await React.act(async () => root.render(React.createElement(LeadComparePanel, {
        current: side(458, "Housing and Human Services Advisory Board Sets Agency Funding Hearings", status),
        prior: side(12, "Housing and Human Service Advisory Board sets three agency funding hearings this month", "killed"),
        onKillThis: async () => { kills.push("kill"); return { ok: true }; },
        onNotADuplicate: async () => ({ ok: true }),
        formatDate: () => "Oct. 6, 2026",
      })));
      const press = [...document.querySelectorAll("button")].find((b) => /Same story — kill this one/.test(b.textContent));
      assert.ok(press, "the press is on screen by its own words");
      assert.equal(press.disabled, false);
      await React.act(async () => {
        press.dispatchEvent(new window.Event("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.equal(confirmAsked, 1, "the confirm is still asked (never remove a feature)");
      if (answer) {
        assert.deepEqual(kills, ["kill"], "OK sends the kill");
      } else {
        assert.deepEqual(kills, [], "a closed confirm sends nothing");
        assert.match(document.body.textContent, /Nothing was killed: the question was closed without a yes/, "the panel says why nothing changed");
      }
    } finally {
      await React.act(async () => root.unmount());
    }
  });
}
