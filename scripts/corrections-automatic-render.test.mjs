import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  correctionMarkUrl,
  correctionOriginUrl,
  inlineModule,
  moduleUrl,
  pageImports,
  renderArticle,
} from "./article-page-render.mjs";

/*
  The reader-facing mark on a correction a machine wrote.

  The page used to list two different things as if they were one: a correction
  an editor decided on, and the row `routine-notice-worker.server.ts` appends
  by itself when a routine edition changes after it printed. The mark has to
  appear in BOTH places a correction prints -- the public feed at
  `/corrections` and the story it corrects, under "Corrections &
  accountability" -- and it has to be the same words in both, because a reader
  who meets the row on the story after meeting it on the feed must not be told
  two different things about who wrote it. So both routes are rendered here,
  from the real modules.

  The two imports that are deliberately REAL are `@/lib/news/correction-origin`
  (which rows are automatic, and what the label says) and
  `@/components/correction-origin-mark` (where the chip goes). A test that
  stubbed either could not tell whether a page labels the row or not.

  The article page's stubs -- twenty-odd of them, the router, the query, the
  chrome -- come from scripts/article-page-render.mjs, shared with
  scripts/ai-disclosure-render.test.mjs rather than copied, so the page gaining
  an import is fixed in one place.

  What is NOT proved here: that the worker writes the marker. That is the other
  half and it runs against a real database --
  src/lib/news/routine-notice-automation.test.ts asserts the row the worker
  appends opens with the same constant the pages read.
*/
const { ROUTINE_EDITION_UPDATE_LABEL, ROUTINE_EDITION_UPDATE_PREFIX, correctionIsAutomatic } =
  await import(correctionOriginUrl);

/* --- the public feed: src/routes/corrections.tsx, rendered for real --------- */

/* The rows the feed is showing. `useQuery` is the seam. */
const reactQueryStub = inlineModule(`
  let rows = [];
  export function __setRows(next) { rows = next; }
  export function useQuery() { return { data: rows, isPending: false, isError: false }; }
`);

const reactRouterStub = inlineModule(`
  export function createFileRoute(path) {
    return (options) => ({ options, useSearch: () => ({}) });
  }
  export function Link({ to, children, ...rest }) { return "a"; }
`);

const paperShellStub = inlineModule(`export function PaperShell({ children }) { return children; }`);
const correctionFormStub = inlineModule(`export function CorrectionForm() { return null; }`);
const publicStub = inlineModule(`export async function listPublicCorrections() { return []; }`);
const paperContextStub = inlineModule(`
  export function usePaperDateFormatters() { return { formatShortDate: () => "September 1, 2026" }; }
`);
const paperIdentityStub = inlineModule(`
  export const DEFAULT_PAPER_IDENTITY = { name: "The Paper", city: "Longmont" };
`);

const routeImports = {
  ...pageImports,
  "@tanstack/react-router": reactRouterStub,
  "@tanstack/react-query": reactQueryStub,
  "@/components/correction-origin-mark": correctionMarkUrl,
  "@/components/paper-chrome": paperShellStub,
  "@/components/correction-form": correctionFormStub,
  "@/lib/news/public": publicStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/paper-identity": paperIdentityStub,
  "@/lib/news/correction-origin": correctionOriginUrl,
};

const feedRoute = await import(
  moduleUrl(
    await readFile(new URL("../src/routes/corrections.tsx", import.meta.url), "utf8"),
    "corrections.tsx",
    routeImports,
  )
);
const { __setRows } = await import(reactQueryStub);

/**
 * A correction row from the feed: exactly the columns `listPublicCorrections`
 * selects and no extra field, so nothing a page renders can come from a flag
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

function renderFeed(rows) {
  __setRows(rows);
  return renderToStaticMarkup(createElement(feedRoute.Route.options.component));
}

/** How many times `text` appears in `html`, as whole occurrences. */
const countOf = (html, text) => html.split(text).length - 1;

/* --- the story page: src/routes/articles.$slug.tsx, rendered for real ------- */

/** A correction as the story page gets it: `getPublishedArticle` maps to {date, body}. */
const storyCorrection = (body) => ({ date: "2026-09-01T12:00:00.000Z", body });

/* --------------------------------------------------------------------------- */

test("the public feed labels a machine correction and leaves an editor's alone", () => {
  const html = renderFeed([routineRow()]);
  assert.match(
    html,
    new RegExp(ROUTINE_EDITION_UPDATE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "a machine-appended correction must say so on the public corrections page",
  );
  // The row still prints, and still prints its own words: the label is added,
  // not a replacement for the correction.
  assert.match(html, /Routine notices for September 8/);
  assert.match(html, /The concert start time moved to 7:30 pm\./);

  const editorsOnly = renderFeed([editorRow()]);
  assert.doesNotMatch(
    editorsOnly,
    new RegExp(ROUTINE_EDITION_UPDATE_LABEL),
    "an editor's correction must not be labelled automatic",
  );
  assert.match(editorsOnly, /We have corrected the story\./);
});

test("the feed tells the two kinds apart in one list, in the order the query returned them", () => {
  const html = renderFeed([routineRow(), editorRow()]);
  const labelAt = html.indexOf(ROUTINE_EDITION_UPDATE_LABEL);
  const routineBodyAt = html.indexOf("The concert start time moved to 7:30 pm.");
  const editorBodyAt = html.indexOf("We have corrected the story.");
  assert.ok(labelAt >= 0, "the label renders");
  assert.ok(
    labelAt < routineBodyAt && routineBodyAt < editorBodyAt,
    "the label belongs to the routine row above it, not to the editor row below",
  );
  assert.equal(countOf(html, ROUTINE_EDITION_UPDATE_LABEL), 1, "exactly one row in this list is automatic");
});

test("the story page labels a machine correction, and only that one", () => {
  const machine = renderArticle({
    corrections: [
      storyCorrection("The vote was 6-1, not unanimous. We have corrected the story."),
      storyCorrection(`${ROUTINE_EDITION_UPDATE_PREFIX}\n\nThe concert start time moved to 7:30 pm.`),
    ],
  });
  assert.equal(
    countOf(machine, ROUTINE_EDITION_UPDATE_LABEL),
    1,
    "one of the two corrections on this story was written by a machine, so it wears one chip",
  );
  const labelAt = machine.indexOf(ROUTINE_EDITION_UPDATE_LABEL);
  const routineBodyAt = machine.indexOf("The concert start time moved to 7:30 pm.");
  assert.ok(
    labelAt >= 0 && labelAt < routineBodyAt,
    "the chip sits with the machine's correction, above its words",
  );
  // The section is the article's own, and both corrections still print.
  assert.match(machine, /Corrections &amp; accountability/);
  assert.match(machine, /We have corrected the story\./);

  const editorOnly = renderArticle({
    corrections: [storyCorrection("The vote was 6-1, not unanimous. We have corrected the story.")],
  });
  assert.doesNotMatch(
    editorOnly,
    new RegExp(ROUTINE_EDITION_UPDATE_LABEL),
    "a story whose only correction is an editor's must carry no chip at all",
  );
});

test("both pages print the same label, from the same module", () => {
  const body = `${ROUTINE_EDITION_UPDATE_PREFIX}\n\nThe concert start time moved to 7:30 pm.`;
  const feed = renderFeed([routineRow()]);
  const story = renderArticle({ corrections: [storyCorrection(body)] });
  for (const [page, html] of [["the feed", feed], ["the story", story]]) {
    assert.ok(
      html.includes(`>${ROUTINE_EDITION_UPDATE_LABEL}<`),
      `${page} must print the shared label as its own element's own text`,
    );
  }
  assert.equal(ROUTINE_EDITION_UPDATE_LABEL, "Automatic routine-notice update");
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
});
