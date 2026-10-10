import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard, jobCardState } from "./job-card-render.harness.mjs";
const NOW = Date.parse("2026-09-26T12:00:00.000Z");
// Epoch milliseconds, because that is what `JobProgressView` carries: the server
// maps every timestamp through `ms()`, so the card's clock arithmetic never
// parses a date string. A fixture of ISO strings would be a shape no screen
// ever holds -- and would quietly test `NaN` comparisons.
const at = (secondsAgo) => NOW - secondsAgo * 1000;

test("the progress card shows the automatic JSON retry while keeping Sol selected", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(render({ job: job({ model: "Codex Sol 6.1 (balanced)", step: "Retrying the draft once — reply with JSON only" }) }));
    assert.match(await page.locator("body").innerText(), /Retrying the draft once.*JSON only/);
    assert.match(await page.locator("body").innerText(), /Codex Sol 6\.1 \(balanced\)/);
  } finally { await browser.close(); }
});

/** A running draft job, one stage in, as `jobProgressView` would shape it. */
function job(over = {}) {
  return {
    id: 41,
    leadId: 7,
    kind: "draft",
    status: "running",
    title: "Drafting story",
    model: "Codex Sol 6.1",
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
  const html = render({ job: job({ pct: null, step: "Waiting on Codex Sol 6.1 · 42s" }) });
  assert.match(html, /job-card-fill indeterminate/);
  assert.match(html, /Now: Waiting on Codex Sol 6\.1 · 42s/);
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

/*
  ... AND ONCE, ON THE SURFACE THE EDITOR IS READING.

  FB1 unit 3 made the rail's Running box a real compact JobCard, which brought
  the durable "Model switch: ..." sentence into the nav as well as the card on
  the page under it. An editor on the story workspace then read the same
  sentence twice at the same moment -- which is what
  scripts/story-quota-failover-e2e.mjs's `getByText` met as a strict-mode
  violation. `failoverNote={false}` is the rail saying it is the summary.
*/
test("the rail's summary draws no model-switch line, and the page's card still does", () => {
  const switched = job({ failoverNote: "Codex hit its usage limit" });
  assert.doesNotMatch(render({ job: switched, compact: true, failoverNote: false }), /Model switch/);
  // The rest of the compact card is untouched: suppressing the sentence must
  // not be done by suppressing the card.
  assert.match(render({ job: switched, compact: true, failoverNote: false }), /Drafting story/);
  assert.match(render({ job: switched, compact: true }), /Model switch: Codex hit its usage limit/);
});

/*
  FB1, unit 4: THE SCAN'S CARD.

  The kind the owner was actually complaining about. Before FB1 a scan had no
  stage list seeded at claim, no step, no percentage and no heartbeat, so this
  card could only ever draw its indeterminate segment with an empty chip row --
  and on the Scan screen there was no card at all, only the sentence "Fetching
  accepted sources, then one pass for leads. Stay on this page."

  These two tests render what the scan worker now reports: a counted step inside
  its own slice of the bar, the four scan arrivals, and the stall state when the
  worker goes quiet.
*/
const scanJob = (over = {}) =>
  job({
    id: 77,
    leadId: 0,
    kind: "scan",
    title: "Scanning the watch list",
    headline: null,
    model: "DeepSeek v4.1 Flash",
    stages: [
      "Checking for meeting material",
      "Reading the sources",
      "Reading the sources with a model",
      "Filing the leads",
    ],
    stageIndex: 1,
    pct: 43,
    step: "Reading sources — 6 of 8",
    doneText: "The scan is done",
    openLabel: "Open the scan",
    canRetry: false,
    ...over,
  });

test("a running scan shows its live count on a determinate bar", () => {
  const html = render({ job: scanJob() });
  assert.match(html, /Scanning the watch list/);
  assert.match(html, /Now: Reading sources — 6 of 8/);
  // The count is a real percentage of the scan, so the bar is determinate.
  assert.match(html, /class="job-card-fill" style="width:43%"/);
  assert.doesNotMatch(html, /indeterminate/);
  // The chips the report found unreachable for this kind: eight of the eleven
  // kinds were seeded with no list at all, so no scan ever lit one.
  assert.match(html, /job-card-chip done">✓ Checking for meeting material/);
  assert.match(html, /job-card-chip cur">Reading the sources/);
  assert.match(html, /job-card-chip">Filing the leads/);
  assert.match(html, />Cancel</);
  assert.doesNotMatch(html, />Retry</);
});

test("a scan whose worker has gone quiet offers the stall box and Cancel", () => {
  const html = render({ job: scanJob({ beatAt: at(74), step: "Reading sources — 6 of 8" }) });
  assert.match(html, /job-card state-stalled/);
  assert.match(html, /No activity for 1:14\./);
  assert.match(html, />Keep waiting</);
  assert.match(html, />Cancel</);
});

test("a scan that failed with the editor's reason offers no phantom Retry", () => {
  const html = render({
    job: scanJob({ status: "failed", error: "Cancelled by the editor", endedAt: at(3) }),
    onRetry: undefined,
    onRetryNext: undefined,
  });
  assert.match(html, /job-card state-failed/);
  assert.match(html, /Cancelled by the editor/);
  // `canRetry` is false for every kind whose request is not the row itself, and
  // a scan is one of them -- so a failed scan gets the honest reason and no
  // button that would re-run something the editor did not ask for.
  assert.doesNotMatch(html, />Retry/);
});

/*
  FB1b, items 1 and 4: THE HEAD, AT RAIL WIDTH.

  What the coordinator saw in the nav after FB1: the box drew the job's name and
  then the card drew it AGAIN, the title wrapped to three lines inside a 190px
  column and collided with the clock, and the model line ran into the title
  ("Scanning the watch listDeepSeek v4.1 Flash · 16%").

  The markup fixes are what a render test can hold: one title, title and model
  as separate elements on their own lines, the clock outside the title's box,
  and the class hooks the compact CSS keys on. The geometry itself is checked in
  a browser -- `scripts/fb1/fb1-scan-shots.mjs` measures the title's scrollWidth
  against its clientWidth at 390px -- because "it ellipsised instead of
  wrapping" is not a property of the HTML.
*/
test("a compact card draws the title once, on its own line, with the model under it", () => {
  const html = render({ job: scanJob(), compact: true });
  // ONE title. The rail used to draw the job's name as its own bold line and
  // then hand the same job to the card, whose first line is its name again.
  assert.equal((html.match(/Scanning the watch list/g) ?? []).length, 1);
  // The title and the model are separate elements, not two inline children of
  // one span -- which is what ran them together with nothing between them.
  assert.match(html, /<b class="job-card-title">Scanning the watch list<\/b>/);
  assert.match(html, /<span class="job-card-model">DeepSeek v4\.1 Flash · 43%<\/span>/);
  // ...and they live in the wrapper the compact CSS bounds.
  assert.match(html, /<span class="job-card-id-text">/);
  // The clock is a sibling of the title column, not a child of it: in a flex
  // row the two competed for the same line and the clock lost.
  const head = html.slice(html.indexOf("job-card-head"), html.indexOf("job-card-track"));
  assert.ok(
    head.indexOf("job-card-id-text") < head.indexOf("job-card-elapsed"),
    "the clock is its own column in the head",
  );
  assert.match(head, /<b class="job-card-elapsed">\d+:\d\d<\/b>/);
});

test("a compact card can be titled by its caller, and still only once", () => {
  /*
    The rail's case: three rows of ~190px, and a story job's own title is the
    kind's name -- the same words for every draft. It passes the story's
    headline instead, and the card still draws exactly one title.
  */
  const html = render({
    job: job({ headline: "Council votes on the water contract" }),
    compact: true,
    title: "Council votes on the water contract",
  });
  assert.equal((html.match(/Council votes on the water contract/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Drafting story/);
});

test("the full card still wraps its title over as many lines as it needs", () => {
  // The single-line rule is COMPACT-only. A full-width card in a column has the
  // room and a headline is not something to cut off.
  const html = render({ job: scanJob() });
  assert.doesNotMatch(html, /job-card compact/);
  assert.match(html, /<b class="job-card-title">Scanning the watch list<\/b>/);
});
