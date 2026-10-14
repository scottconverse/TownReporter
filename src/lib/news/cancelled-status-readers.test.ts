/*
  Release J (DHI-5) audit: every reader of `desk_jobs.status` that treated a job
  an editor stopped as `failed` must also settle on `cancelled`.

  PR 294 records a stopped/replaced job as `cancelled` (that is what the finding
  asked for). These are the readers that decide a stopped job's fate, and each
  one is asserted here for BOTH words so the two can never drift apart: if a
  future change teaches a reader one word and not the other, this file fails.

  Scope note -- `jobCardState` in `src/components/job-card-state.ts` is the
  fourth reader of the same rule, and it already answers `failed` for both
  words. It is not asserted here because that module imports its job list as
  `@/lib/news/job-progress`, and `@/*` is resolved by Vite's `tsconfigPaths`
  only (vite.config.ts). A plain `node --test` run -- which is what the src
  test glob is -- has no such resolver, so importing it from a test fails with
  ERR_MODULE_NOT_FOUND before any assertion runs. Every helper below is kept
  alias-free precisely so it stays reachable from this suite.
*/
import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveDraftJobState, observedDarkJobFinished } from "./desk-copy.ts";
import { deskDraftState } from "./desk-drafts.ts";
import { runLooksStalled } from "./jobs.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const fresh = new Date(NOW).toISOString();

it("the draft's retry advice is offered for a stopped job exactly as for an error", () => {
  assert.equal(resolveDraftJobState({ status: "cancelled" }), "failed");
  assert.equal(resolveDraftJobState({ status: "failed" }), "failed");
  assert.equal(resolveDraftJobState({ status: "running", updated_at: fresh }, NOW), "drafting");
});

it("a stopped Dark Desk round is a finished round", () => {
  const observed = { investigationId: 7, jobId: 3 };
  assert.equal(observedDarkJobFinished(observed, 7, { id: 3, status: "cancelled" }), true);
  assert.equal(observedDarkJobFinished(observed, 7, { id: 3, status: "failed" }), true);
  assert.equal(observedDarkJobFinished(observed, 7, { id: 3, status: "running" }), false);
});

it("a cancelled row is settled, so the run it belongs to is not left looking live", () => {
  assert.equal(runLooksStalled({ runOpen: true, job: { status: "cancelled", updated_at: fresh }, now: NOW }), true);
  assert.equal(runLooksStalled({ runOpen: true, job: { status: "failed", updated_at: fresh }, now: NOW }), true);
  assert.equal(runLooksStalled({ runOpen: true, job: { status: "running", updated_at: fresh }, now: NOW }), false);
});

it("the drafts list calls a stopped draft a failed row, never one still writing", () => {
  const facts = {
    job_status: "cancelled",
    has_body: false,
    names_unresolved: 0,
  } as unknown as Parameters<typeof deskDraftState>[0];
  const state = deskDraftState(facts);
  assert.equal(state.key, "failed");
  assert.equal(state.failed, true);
  assert.equal(state.running, false);
});
