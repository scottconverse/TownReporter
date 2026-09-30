import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  The public corrections page, rendered from the real route.

  The page listed two different things as if they were one: a correction an
  editor decided on, and the row `routine-notice-worker.server.ts` appends by
  itself when a routine edition changes after it printed. Unit U14 marks the
  second. This test renders `src/routes/corrections.tsx` -- the real module,
  with its non-page imports stubbed the way `scripts/ai-disclosure-render.test.mjs`
  stubs an article page -- and reads the markup a reader gets.

  The one import that is deliberately REAL is `@/lib/news/correction-origin`,
  because it is the whole subject: the route has to read the label and the
  marker from there rather than spell them out, or the page and the worker
  that writes the text can disagree without anything failing. A test that
  stubbed it could not tell.

  What is NOT proved here: that the worker writes the marker. That is the
  other half and it runs against a real database --
  `src/lib/news/routine-notice-automation.test.ts` asserts the row the worker
  appends opens with the same constant this page reads.
*/
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
  const rewritten = source.replaceAll('"react"', JSON.stringify(import.meta.resolve("react")));
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
}

const REACT = import.meta.resolve("react");
const JSX = import.meta.resolve("react/jsx-runtime");

/* The real marker module: pure, imports nothing, so it loads as it is. One
   URL, imported twice -- once by this file and once by the route -- so the
   two sides of the assertion are the same module instance. */
const correctionOriginUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/correction-origin.ts", import.meta.url), "utf8"),
  "correction-origin.ts",
  { react: REACT },
);
const { ROUTINE_EDITION_UPDATE_LABEL, ROUTINE_EDITION_UPDATE_PREFIX, correctionIsAutomatic } =
  await import(correctionOriginUrl);

/* The rows the page is showing. `useQuery` is the seam. */
const reactQueryStub = inlineModule(`
  let rows = [];
  export function __setRows(next) { rows = next; }
  export function useQuery() { return { data: rows, isPending: false, isError: false }; }
`);

const reactRouterStub = inlineModule(`
  export function createFileRoute(path) {
    return (options) => ({ options, useSearch: () => ({}) });
  }
  export function Link({ to, children, ...rest }) {
    return "a";
  }
`);

const paperShellStub = inlineModule(`
  export function PaperShell({ children }) { return children; }
`);
const correctionFormStub = inlineModule(`
  export function CorrectionForm() { return null; }
`);
const publicStub = inlineModule(`
  export async function listPublicCorrections() { return []; }
`);
const paperContextStub = inlineModule(`
  export function usePaperDateFormatters() { return { formatShortDate: () => "September 1, 2026" }; }
`);
const paperIdentityStub = inlineModule(`
  export const DEFAULT_PAPER_IDENTITY = { name: "The Paper", city: "Longmont" };
`);

const routeImports = {
  react: REACT,
  "react/jsx-runtime": JSX,
  "@tanstack/react-router": reactRouterStub,
  "@tanstack/react-query": reactQueryStub,
  "@/components/paper-chrome": paperShellStub,
  "@/components/correction-form": correctionFormStub,
  "@/lib/news/public": publicStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/paper-identity": paperIdentityStub,
  "@/lib/news/correction-origin": correctionOriginUrl,
};

const route = await import(
  moduleUrl(
    await readFile(new URL("../src/routes/corrections.tsx", import.meta.url), "utf8"),
    "corrections.tsx",
    routeImports,
  )
);
const { __setRows } = await import(reactQueryStub);

/**
 * An editor's correction: exactly the columns `listPublicCorrections` selects
 * and no extra field, so nothing the route renders below can come from a flag
 * this file invented. Whatever tells the two rows apart has to be in the body.
 */
function editorRow(overrides = {}) {
  return {
    id: 1,
    body: "The vote was 6-1, not unanimous. We have corrected the story.",
    created_at: "2026-09-01T12:00:00.000Z",
    headline: "Council approves the plan",
    slug: "council-approves-the-plan",
    ...overrides,
  };
}

/** The row the routine-notice worker appends, marker and all. */
function routineRow(overrides = {}) {
  return editorRow({
    id: 2,
    body: `${ROUTINE_EDITION_UPDATE_PREFIX}\n\nThe concert start time moved to 7:30 pm.`,
    headline: "Routine notices for September 8",
    slug: "routine-news-2026-09-08-1",
    ...overrides,
  });
}

function render(rows) {
  __setRows(rows);
  return renderToStaticMarkup(createElement(route.Route.options.component));
}

test("a correction the routine-notice worker wrote is labelled automatic, and an editor's is not", () => {
  const html = render([routineRow()]);
  assert.match(
    html,
    new RegExp(ROUTINE_EDITION_UPDATE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "a machine-appended correction must say so on the public corrections page",
  );
  // The row still prints, and still prints its own words: the label is added,
  // not a replacement for the correction.
  assert.match(html, /Routine notices for September 8/);
  assert.match(html, /The concert start time moved to 7:30 pm\./);

  const editorsOnly = render([editorRow()]);
  assert.doesNotMatch(
    editorsOnly,
    new RegExp(ROUTINE_EDITION_UPDATE_LABEL),
    "an editor's correction must not be labelled automatic",
  );
  assert.match(editorsOnly, /We have corrected the story\./);
});

test("the two kinds are told apart in one list, in the order the query returned them", () => {
  const html = render([routineRow(), editorRow()]);
  const labelAt = html.indexOf(ROUTINE_EDITION_UPDATE_LABEL);
  const routineBodyAt = html.indexOf("The concert start time moved to 7:30 pm.");
  const editorBodyAt = html.indexOf("We have corrected the story.");
  assert.ok(labelAt >= 0, "the label renders");
  assert.ok(
    labelAt < routineBodyAt && routineBodyAt < editorBodyAt,
    "the label belongs to the routine row above it, not to the editor row below",
  );
  assert.equal(
    html.split(ROUTINE_EDITION_UPDATE_LABEL).length - 1,
    1,
    "exactly one row in this list is automatic",
  );
});

test("the detector reads the marker the worker writes, and nothing else", () => {
  assert.equal(correctionIsAutomatic(`${ROUTINE_EDITION_UPDATE_PREFIX}\n\nbody`), true);
  assert.equal(correctionIsAutomatic("The vote was 6-1, not unanimous."), false);
  assert.equal(
    correctionIsAutomatic("A reader asked about the routine edition update: it was 6-1."),
    false,
    "the marker is the row's opening, not any mention of the words",
  );
  assert.equal(correctionIsAutomatic(""), false);
  // The literal has to be the one the worker writes; if it is ever changed,
  // this is the assertion that says the change was deliberate.
  assert.equal(ROUTINE_EDITION_UPDATE_PREFIX, "Routine edition update:");
  assert.equal(ROUTINE_EDITION_UPDATE_LABEL, "Automatic routine-notice update");
});
