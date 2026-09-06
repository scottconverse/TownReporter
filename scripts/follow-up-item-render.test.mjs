import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the real FollowUpItem component (src/components/follow-up-item.tsx)
// -- the Follow-ups object's rail/list item (Direction A stage 1, see
// docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md). Same pattern as
// lead-badge-render.test.mjs: everything the component imports besides
// React is stubbed with a minimal in-memory module so this exercises the
// real markup without a router or a live server.
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

function inlineModule(source) {
  const REACT_URL = import.meta.resolve("react");
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
  export function InkButton({ children, onClick, disabled }) {
    return createElement("button", { type: "button", onClick, disabled }, children);
  }
`);

// Reimplements the two pure functions from src/lib/news/desk-copy.ts (the
// real logic under test lives there and has its own direct unit test,
// scripts/follow-up-due-label.test.mjs) -- inlined here the same way the
// other render tests stub formatAge/formatShortDate, because desk-copy.ts's
// relative imports ("./preflight.ts" etc.) cannot resolve from a data: URL
// module.
const deskCopyStub = inlineModule(`
  export function followUpDueLabel(dueOn, today = new Date()) {
    if (!dueOn) return "";
    const due = new Date(dueOn + "T00:00:00");
    if (Number.isNaN(due.getTime())) return "";
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86400000);
    if (diffDays < 0) {
      const days = Math.abs(diffDays);
      return "Overdue " + days + " day" + (days === 1 ? "" : "s");
    }
    if (diffDays === 0) return "due today";
    const formatted = due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return "due " + formatted;
  }
  export function followUpIsOverdue(dueOn, today = new Date()) {
    return followUpDueLabel(dueOn, today).startsWith("Overdue");
  }
`);

const { FollowUpItem } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/follow-up-item.tsx", import.meta.url), "utf8"),
    "follow-up-item.tsx",
    {
      "@tanstack/react-router": reactRouterStub,
      "@/components/desk-chrome": deskChromeStub,
      "@/lib/news/desk-copy": deskCopyStub,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

const TODAY = new Date("2026-09-06T12:00:00");

function baseItem(overrides = {}) {
  return {
    id: 1,
    lead_id: 42,
    article_id: null,
    who: "City Manager's office",
    what: "cause report on the 15th Avenue explosion",
    due_on: null,
    status: "open",
    nudged_at: null,
    answered_at: null,
    reply_text: null,
    created_at: TODAY.toISOString(),
    lead_headline: "Three weeks after a gas explosion, no cause finding",
    ...overrides,
  };
}

test("an overdue follow-up states 'Overdue N days' in words, styled with text-warn", () => {
  const html = renderToStaticMarkup(createElement(FollowUpItem, { item: baseItem({ due_on: "2026-09-03" }) }));
  assert.match(html, /Overdue 3 days/);
  assert.match(html, /class="text-warn"/);
});

test("a follow-up due today reads 'due today'", () => {
  const html = renderToStaticMarkup(createElement(FollowUpItem, { item: baseItem({ due_on: "2026-09-06" }) }));
  assert.match(html, />due today</);
  assert.doesNotMatch(html, /text-warn/);
});

test("a follow-up due later shows the weekday and date", () => {
  const html = renderToStaticMarkup(createElement(FollowUpItem, { item: baseItem({ due_on: "2026-09-09" }) }));
  assert.match(html, /due Wed, Sep 9/);
});

test("who, what and the linked story render; the story link points at the lead's story page", () => {
  const html = renderToStaticMarkup(createElement(FollowUpItem, { item: baseItem() }));
  assert.match(html, /City Manager&#x27;s office/);
  assert.match(html, /cause report on the 15th Avenue explosion/);
  assert.match(html, /href="\/desk\/story\/\$leadId"/);
  assert.match(html, /Three weeks after a gas explosion, no cause finding/);
});

test("an answered follow-up shows the reply instead of the action row", () => {
  const html = renderToStaticMarkup(
    createElement(FollowUpItem, { item: baseItem({ status: "answered", reply_text: "It was a severed line." }) }),
  );
  assert.match(html, /Answered: It was a severed line\./);
  assert.doesNotMatch(html, /Record reply/);
});

test("a dropped follow-up shows 'Dropped.'", () => {
  const html = renderToStaticMarkup(createElement(FollowUpItem, { item: baseItem({ status: "dropped" }) }));
  assert.match(html, /Dropped\./);
});
