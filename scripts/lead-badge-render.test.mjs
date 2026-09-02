import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real LeadRowView component (src/components/desk-leads.tsx) --
// specifically the "seen again ×N" resurfaced badge added for a killed lead
// the scanner rediscovered (see src/lib/news/lead-match.ts and the
// fileScanLeads loop in src/lib/news/desk.ts). Everything the real component
// imports besides React (router Link, desk-chrome chips/buttons, paper date
// formatting, the model picker, model-choice labels, Notice) is stubbed here
// with a minimal in-memory module, the same pattern model-picker-render.test.mjs
// uses, so this test exercises the real badge markup without a router, a
// paper context provider, or a live server.
function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const REACT_URL = import.meta.resolve("react");

function inlineModule(source) {
  const rewritten = source.replaceAll('"react"', JSON.stringify(REACT_URL));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

const reactRouterStub = inlineModule(`
  import { createElement } from "react";
  export function Link({ to, params, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
`);

const deskChromeStub = inlineModule(`
  import { createElement } from "react";
  export function InkButton({ children, onClick }) {
    return createElement("button", { type: "button", onClick }, children);
  }
  export function Score({ v }) {
    return createElement("span", { className: "score" }, String(v));
  }
  export function Chip({ s }) {
    return createElement("span", { className: "chip st-" + s }, s);
  }
  export function leadOrigin() {
    return "scan";
  }
`);

const paperStub = inlineModule(`
  export function formatAge() {
    return "2h ago";
  }
`);

const paperContextStub = inlineModule(`
  export function usePaperDateFormatters() {
    return { formatShortDate: () => "Sep 3" };
  }
`);

const modelPickerStub = inlineModule(`
  import { createElement } from "react";
  export function ModelPicker() {
    return createElement("div", { className: "model-picker-stub" });
  }
`);

const modelChoiceStub = inlineModule(`
  export function modelChoiceLabel() {
    return "Automatic";
  }
`);

const statesStub = inlineModule(`
  import { createElement } from "react";
  export function Notice({ children }) {
    return createElement("div", { className: "notice" }, children);
  }
`);

const { LeadRowView } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/desk-leads.tsx", import.meta.url), "utf8"),
    "desk-leads.tsx",
    {
      "@tanstack/react-router": reactRouterStub,
      "@/components/desk-chrome": deskChromeStub,
      "@/lib/paper": paperStub,
      "@/lib/paper-context": paperContextStub,
      "@/components/model-picker": modelPickerStub,
      "@/lib/news/model-choice": modelChoiceStub,
      "@/components/states": statesStub,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

function baseLead(overrides = {}) {
  return {
    id: 1,
    headline: "Longmont council has two closed-door executive sessions on the books",
    why: "Because it does",
    topic: "council",
    status: "killed",
    source_urls: "[]",
    evidence: null,
    newsworthiness: 8,
    created_at: new Date().toISOString(),
    resurfaced_count: 0,
    last_resurfaced_at: null,
    ...overrides,
  };
}

test("a lead with resurfaced_count > 0 shows the seen-again badge with its count and date", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({ resurfaced_count: 3, last_resurfaced_at: "2026-09-03T12:00:00.000Z" }),
    }),
  );
  assert.match(html, /seen again ×3/);
  assert.match(html, /Sep 3/);
  assert.match(html, /class="chip seen-again"/);
});

test("a lead with resurfaced_count of 0 shows no seen-again badge", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, { lead: baseLead({ resurfaced_count: 0, last_resurfaced_at: null }) }),
  );
  assert.doesNotMatch(html, /seen again/);
});

test("an open (non-killed) lead with a resurfaced stamp still shows the badge in its meta line", () => {
  const html = renderToStaticMarkup(
    createElement(LeadRowView, {
      lead: baseLead({
        status: "new",
        resurfaced_count: 1,
        last_resurfaced_at: "2026-09-01T00:00:00.000Z",
      }),
    }),
  );
  assert.match(html, /seen again ×1/);
});
