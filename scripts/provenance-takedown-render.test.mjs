import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * Unit U11b2, the reader-facing half of "remove the link too".
 *
 * WHAT THIS FILE IS FOR. The data-layer test (`src/lib/news/evidence-takedown.test.ts`)
 * proves the provenance row carries the two flags; this proves the card the
 * reader actually gets USES them. The owner's tick is about the reader's way
 * out of our site to the publisher, and a story page that still rendered
 * "Current source" as a link would hand back exactly the link the publisher
 * asked us to drop -- while the evidence page it links to says the link was
 * removed. Two surfaces disagreeing about one decision is the defect this
 * catches.
 *
 * WHY A SCRIPT TEST. `ProvenanceBlock` is a component, and the repository has
 * no DOM test environment for components (see `src/components/check-gates.test.ts`
 * and the notes in `scripts/bh2-dialogs.test.mjs`). This file follows the
 * pattern this folder already uses for a rendered string: transpile the .tsx
 * with TypeScript, resolve its two runtime imports by hand (`Link` from the
 * router and the paper's date formatters are contexts a string render cannot
 * stand up), and assert on the markup. `SourceCard` is the REAL component.
 *
 * THE MUTATION THAT MATTERS. Dropping `linkRemoved` from the "Current source"
 * condition in `src/components/provenance.tsx` -- so a taken-down capture with
 * the link removed renders the link anyway -- fails the third case below.
 */

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const react = import.meta.resolve("react");
const jsxRuntime = import.meta.resolve("react/jsx-runtime");
const transpile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
const stub = (body) => `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;

/* The card itself is real: only what it stands on is stubbed. */
const sourceCard = stub(
  transpile(await read("src/components/paper/source-card.tsx"), "source-card.tsx")
    .replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(jsxRuntime))
    .replaceAll(JSON.stringify("react"), JSON.stringify(react)),
);
/*
  `Link` renders as the anchor the browser would get, with the same
  `/evidence/:versionId` and `/evidence/compare?url=` addresses the router
  builds -- so "there is no link to the publisher" is a claim about the href
  the reader would follow, not about a placeholder element.
*/
const router = stub(
  `import { createElement } from ${JSON.stringify(react)};
export function Link({ to, params, search, children, className }) {
  const href =
    to === "/evidence/$versionId" ? "/evidence/" + params.versionId
    : to === "/evidence/compare" ? "/evidence/compare?url=" + encodeURIComponent(search?.url ?? "")
    : String(to);
  return createElement("a", { href, className }, children);
}`,
);
const paperContext = stub(
  `export function usePaperDateFormatters() {
  return { formatDateTime: (value) => String(value), formatShortDate: (value) => String(value) };
}`,
);

const provenance = await import(
  stub(
    transpile(await read("src/components/provenance.tsx"), "provenance.tsx")
      .replaceAll(JSON.stringify("@tanstack/react-router"), JSON.stringify(router))
      .replaceAll(JSON.stringify("@/lib/paper-context-state"), JSON.stringify(paperContext))
      .replaceAll(JSON.stringify("@/components/paper/source-card"), JSON.stringify(sourceCard))
      .replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(jsxRuntime))
      .replaceAll(JSON.stringify("react"), JSON.stringify(react)),
  )
);

const PUBLISHER = "https://publisher.example/story";
const item = (overrides = {}) => ({
  title: "Publisher's investigation",
  organization: "publisher.example",
  document_date: "",
  url: PUBLISHER,
  captured_at: "2026-09-01T10:00:00.000Z",
  version_id: 42,
  version_count: 2,
  capture_event_id: 7,
  disappeared: false,
  role: "source",
  ...overrides,
});

const render = (items) => renderToStaticMarkup(createElement(provenance.ProvenanceBlock, { items }));

test("an ordinary cited capture keeps its source link and its plain label", () => {
  const html = render([item()]);
  assert.match(html, /Current source/);
  assert.match(html, new RegExp(`href="${PUBLISHER}"`), "the reader can still reach the source");
  assert.match(html, /View captured version</);
  assert.doesNotMatch(html, /excerpt removed/, "nothing is labelled removed while it is not");
});

test("a taken-down capture that kept its link keeps the link, and says the excerpt went", () => {
  const html = render([item({ excerpt_removed: true, excerpt_removed_link_kept: true })]);
  assert.match(html, /Current source/);
  assert.match(html, new RegExp(`href="${PUBLISHER}"`), "the publisher's link is kept on purpose");
  assert.match(
    html,
    /View captured version \(excerpt removed\)/,
    "the captured-version link says what it opens",
  );
});

test("a taken-down capture with the link removed renders the source as plain text", () => {
  const html = render([item({ excerpt_removed: true, excerpt_removed_link_kept: false })]);
  assert.doesNotMatch(
    html,
    new RegExp(`href="${PUBLISHER}"`),
    "no link to the publisher may survive the ticked box",
  );
  assert.doesNotMatch(html, />\s*Current source\s*</, "and the link is not rendered as text either");
  assert.match(
    html,
    /Excerpt removed at the publisher’s request, and the link to the original with it/,
  );
  assert.match(html, new RegExp(PUBLISHER), "the address itself stays on the record");
  assert.match(html, /View captured version \(excerpt removed\)/);
});

test("a citation with no capture behind it is unchanged", () => {
  const html = render([item({ url: "", version_id: null, version_count: null })]);
  assert.match(html, /Named in the report we worked from/);
  assert.doesNotMatch(html, /View captured version/);
  assert.doesNotMatch(html, /Compare versions/);
});
