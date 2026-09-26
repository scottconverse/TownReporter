import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  The JobCard's four states, rendered from the real component
  (src/components/JobCard.tsx) with the server's own view shape.

  WHY A RENDER TEST AND NOT A BROWSER. Everything the design asks the card to
  prove is a property of the markup: the chip row and which chip is current, a
  determinate bar at 42% versus an indeterminate one, the stall box appearing at
  60s of quiet and NOT at 59s, "Cancelled by the editor" as the reason line, the
  Open button carrying the href the SERVER chose, and Retry being absent when
  the row cannot honour a retry (`canRetry` false). None of that needs a model,
  a provider, a router or a session -- so the test runs against the component
  and a frozen clock, which is what makes the 59/60 boundary testable at all.

  The clock (`now`) is a prop precisely so this file can be deterministic: the
  card's stall rule is `now - beatAt >= 60s`, and a test that waited 60 real
  seconds to observe it would be a test nobody runs.

  Stubs, as in lead-badge-render.test.mjs: React is the real module, and
  `@/lib/news/job-progress` and `@tanstack/react-query` are replaced with
  minimal in-memory modules. job-progress.ts reaches the database, the desk
  session and the provider toolchain at its top level; none of that is what
  this test is about, and the card only needs the TYPES from it (erased).
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

const REACT_URL = import.meta.resolve("react");
const inlineModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source.replaceAll('"react"', JSON.stringify(REACT_URL))).toString("base64")}`;

const jobProgressStub = inlineModule(`
  export async function cancelStoryJob() { throw new Error("not used in a render test"); }
  export async function listStoryJobProgress() { return []; }
  export async function retryStoryJob() { throw new Error("not used in a render test"); }
`);

// Only the names have to exist: renderToStaticMarkup never runs a query or a
// mutation, and the card's hooks are not called because the test renders the
// pure `JobCard`, not the `DeskJobCard` wrapper that owns them.
const reactQueryStub = inlineModule(`
  export function useQuery() { return { data: undefined, state: { data: undefined } }; }
  export function useMutation() { return { mutate() {}, isPending: false, error: null, data: null }; }
  export function useQueryClient() { return { invalidateQueries() {} }; }
`);

/*
  The card's state rule and its data hook live in `job-card-state.ts`, beside
  the card, because eslint's react-refresh rule warns about a module that
  exports both a component and a plain function. The split is also what this
  test has to follow: `JobCard.tsx` imports it by a RELATIVE specifier, which a
  data: URL cannot resolve, so the module is transpiled and mapped by name the
  same way the bare specifiers are.
*/
const jobCardStateModule = moduleUrl(
  await readFile(new URL("../src/components/job-card-state.ts", import.meta.url), "utf8"),
  "job-card-state.ts",
  {
    "@/lib/news/job-progress": jobProgressStub,
    "@tanstack/react-query": reactQueryStub,
  },
);

const JobCardModule = moduleUrl(
  await readFile(new URL("../src/components/JobCard.tsx", import.meta.url), "utf8"),
  "JobCard.tsx",
  {
    // React is the real module (the card is a React component, not a React
    // stand-in): only the specifier has to be resolved for a data: URL, which
    // has no node_modules to resolve it against.
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    react: REACT_URL,
    "@/lib/news/job-progress": jobProgressStub,
    "@tanstack/react-query": reactQueryStub,
    "./job-card-state": jobCardStateModule,
  },
);
const { JobCard } = await import(JobCardModule);
const { jobCardState } = await import(jobCardStateModule);

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
// Epoch milliseconds, because that is what `JobProgressView` carries: the server
// maps every timestamp through `ms()`, so the card's clock arithmetic never
// parses a date string. A fixture of ISO strings would be a shape no screen
// ever holds -- and would quietly test `NaN` comparisons.
const at = (secondsAgo) => NOW - secondsAgo * 1000;

/** A running draft job, one stage in, as `jobProgressView` would shape it. */
function job(over = {}) {
  return {
    id: 41,
    leadId: 7,
    kind: "draft",
    status: "running",
    title: "Drafting story",
    model: "Codex Sol",
    stages: ["Planning the reporting", "Writing the draft", "Checking the draft against the evidence"],
    stageIndex: 1,
    pct: 42,
    step: "Writing the draft",
    startedAt: NOW - 75_000,
    endedAt: null,
    beatAt: at(2),
    error: null,
    resultHref: "/desk/story/7",
    resultDraftId: null,
    doneText: "Your draft is ready",
    openLabel: "Open the draft",
    failoverNote: "",
    cancelRequested: false,
    canRetry: true,
    ...over,
  };
}

/*
  No-op handlers by default, exactly as `DeskJobCard` supplies them: the card
  renders an action button only when somebody is listening, so a test that
  passed none would be asserting on a card nobody can act on.
*/
const render = (props) =>
  renderToStaticMarkup(
    createElement(JobCard, {
      now: NOW,
      onCancel: () => {},
      onOpen: () => {},
      onView: () => {},
      onRetry: () => {},
      onRetryNext: () => {},
      ...props,
    }),
  );

test("a running job shows the chip row, the current stage, the bar and Cancel", () => {
  const html = render({ job: job() });
  assert.match(html, /job-card state-running/);
  assert.match(html, /Planning the reporting/);
  assert.match(html, /Writing the draft/);
  // The chip that is DONE is ticked, and the current one is the current one --
  // a row where every chip looked the same would not tell the editor where the
  // job had got to.
  assert.match(html, /job-card-chip done">✓ Planning the reporting/);
  assert.match(html, /job-card-chip cur">Writing the draft/);
  assert.match(html, /job-card-chip">Checking the draft against the evidence/);
  // 42% is a real percentage, so the bar is determinate and says so.
  assert.match(html, /class="job-card-fill" style="width:42%"/);
  assert.doesNotMatch(html, /indeterminate/);
  assert.match(html, /Now: Writing the draft/);
  assert.match(html, /Last activity 0:02 ago/);
  assert.match(html, />Cancel</);
  assert.doesNotMatch(html, /Keep waiting/);
});

test("a job with no percentage draws the indeterminate bar", () => {
  const html = render({ job: job({ pct: null, step: "Waiting on Codex Sol · 42s" }) });
  assert.match(html, /job-card-fill indeterminate/);
  assert.match(html, /Now: Waiting on Codex Sol · 42s/);
});

test("the stall box appears at 60s of quiet and not at 59s", () => {
  const quiet59 = render({ job: job({ beatAt: at(59) }) });
  assert.doesNotMatch(quiet59, /Keep waiting/);
  assert.match(quiet59, /state-running/);
  assert.match(quiet59, /Last activity 0:59 ago/);

  const quiet60 = render({ job: job({ beatAt: at(60) }) });
  assert.match(quiet60, /state-stalled/);
  assert.match(quiet60, /No activity for 1:00\. The model may be slow, or it may have stalled\./);
  assert.match(quiet60, />Keep waiting</);
  assert.match(quiet60, />Retry on next model</);
  // The design's stalled card still offers Cancel and still shows where the
  // job got to; a stall is not a failure and the editor has not lost anything.
  assert.match(quiet60, />Cancel</);
  assert.match(quiet60, /Now: Writing the draft/);
});

test("a job that never reported is not stalled, however long it has been", () => {
  // Null `beat_at` is "no evidence", not "very quiet": a queued job, or one
  // whose worker has not reached its first boundary, must not be offered a
  // retry it does not need.
  const html = render({ job: job({ beatAt: null, startedAt: NOW - 900_000 }) });
  assert.doesNotMatch(html, /Keep waiting/);
  assert.match(html, /state-running/);
});

test("a cancelled-and-still-running job says so, and drops the Cancel button", () => {
  const html = render({ job: job({ cancelRequested: true }) });
  assert.match(html, /Cancelling — the worker stops at its next step\./);
  assert.doesNotMatch(html, />Cancel</);
});

test("a done job ticks every chip, fills the bar, and offers the server's href", () => {
  const html = render({
    job: job({
      status: "completed",
      stageIndex: 2,
      pct: null,
      endedAt: NOW,
      resultHref: "/desk/story/draft/12",
    }),
  });
  assert.match(html, /job-card state-done/);
  assert.match(html, /Your draft is ready/);
  assert.match(html, /class="job-card-fill" style="width:100%"/);
  assert.match(html, /✓ Checking the draft against the evidence/);
  assert.match(html, /Open the draft/);
  assert.doesNotMatch(html, />Retry</);
  assert.doesNotMatch(html, />Cancel</);
});

test("a failed job leads with the model's own reason, not a stack trace", () => {
  const html = render({
    job: job({
      status: "failed",
      endedAt: NOW,
      step: "Writing the draft",
      pct: 42,
      error: "Codex API error 429: usage limit reached; resets 11:30pm (America/Denver).",
    }),
  });
  assert.match(html, /job-card state-failed/);
  assert.match(html, /Codex API error 429: usage limit reached; resets 11:30pm \(America\/Denver\)\./);
  assert.match(html, />Retry</);
  assert.match(html, />Retry on another model</);
  // The last thing the worker was doing is not the failure line, so it must not
  // be printed as though it were still happening.
  assert.doesNotMatch(html, /Now: Writing the draft/);
});

test("a cancelled job shows the editor's own reason with Retry beside it", () => {
  const html = render({
    job: job({ status: "failed", endedAt: NOW, error: "Cancelled by the editor" }),
  });
  assert.match(html, /Cancelled by the editor/);
  assert.match(html, />Retry</);
  assert.match(html, />Retry on another model</);
});

test("a row that cannot honour a retry gets no Retry button", () => {
  // The gate is the server's `canRetry`: a kind whose request is not stored with
  // the job must not offer a button that would run something else.
  const html = render({
    job: job({ status: "failed", endedAt: NOW, error: "Provider unavailable", canRetry: false }),
  });
  assert.doesNotMatch(html, />Retry</);
  assert.match(html, /Provider unavailable/);
});

test("a compact card drops the chip row and keeps the state", () => {
  const html = render({ job: job(), compact: true });
  assert.match(html, /job-card compact state-running/);
  assert.doesNotMatch(html, /job-card-chip/);
  assert.match(html, /Now: Writing the draft/);
  assert.match(html, />Cancel</);
});

test("queued is a running job that has not started yet", () => {
  assert.equal(jobCardState({ status: "queued" }), "running");
  assert.equal(jobCardState({ status: "running" }), "running");
  assert.equal(jobCardState({ status: "completed" }), "done");
  assert.equal(jobCardState({ status: "failed" }), "failed");
  const html = render({
    job: job({ status: "queued", startedAt: null, beatAt: null, pct: null, stageIndex: 0, step: "Waiting to start…" }),
  });
  assert.match(html, /Now: Waiting to start…/);
  assert.match(html, /0:00/);
});

test("a model switch on the way past is reported, not hidden", () => {
  const html = render({ job: job({ failoverNote: "Codex hit its usage limit" }) });
  assert.match(html, /Model switch: Codex hit its usage limit/);
});
