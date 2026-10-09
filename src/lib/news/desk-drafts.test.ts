import assert from "node:assert/strict";
import test from "node:test";
import {
  deskDraftAction,
  deskDraftElapsed,
  deskDraftFilterCounts,
  deskDraftMatchesFilter,
  deskDraftState,
  type DeskDraftFacts,
} from "./desk-drafts.ts";

const quiet: DeskDraftFacts = {
  job_status: null,
  job_stage: null,
  job_started_at: null,
  job_updated_at: null,
  evidence_required: false,
  evidence_decision: null,
  imported_text: false,
  names_unresolved: 0,
  has_body: true,
  headline: "Council delays the vote",
  model_headline: "Council delays the vote",
  headline_source: "model",
};

test("a plain draft with no memo is Ready in both its chip and its desk key", () => {
  const state = deskDraftState({ ...quiet, story_readiness: null });
  assert.equal(state.key, "ready");
  assert.equal(state.label, "✓ Ready");
});

test("a job still writing prints its own stage text and how long it has been at it", () => {
  const state = deskDraftState(
    { ...quiet, job_status: "running", job_stage: "Researching the editorial", job_started_at: "2026-09-26T10:00:00.000Z" },
    deskDraftElapsed("2026-09-26T10:00:00.000Z", Date.parse("2026-09-26T10:02:18.000Z")),
  );
  assert.equal(state.key, "running");
  assert.equal(state.label, "Researching the editorial · 2:18");
  assert.equal(state.running, true);
  assert.equal(deskDraftAction(state), "Watch");
});

test("a queued job with no stage yet still prints words, never an empty chip", () => {
  const state = deskDraftState({ ...quiet, job_status: "queued", job_stage: "" });
  assert.equal(state.key, "running");
  assert.equal(state.label, "Working…");
  assert.equal(deskDraftState({ ...quiet, job_status: "queued" }).label, "Working…");
});

test("a failed job outranks every other fact about the row", () => {
  // The row also has an unresolved name and unreviewed evidence; the editor
  // needs to know the writing stopped before either of those.
  const state = deskDraftState({
    ...quiet,
    job_status: "failed",
    names_unresolved: 2,
    evidence_required: true,
  });
  assert.equal(state.key, "failed");
  assert.equal(state.label, "Draft failed");
  assert.equal(state.needsYou, false, "a failure is its own state, not the Needs you filter");
  assert.equal(deskDraftAction(state), "Retry");
});

test("an unresolved name counts in words, singular and plural", () => {
  const one = deskDraftState({ ...quiet, names_unresolved: 1 });
  assert.equal(one.label, "! 1 name to review");
  assert.equal(one.needsYou, true);
  assert.equal(deskDraftState({ ...quiet, names_unresolved: 3 }).label, "! 3 names to review");
});

test("evidence to check is a state of its own, and a decision clears it", () => {
  const waiting = deskDraftState({ ...quiet, evidence_required: true });
  assert.equal(waiting.key, "evidence");
  assert.equal(waiting.label, "! Evidence to check");
  assert.equal(waiting.needsYou, true);
  const decided = deskDraftState({ ...quiet, evidence_required: true, evidence_decision: "keep" });
  assert.equal(decided.needsYou, false);
  assert.equal(decided.label, "Ready to check");
});

test("a name to review outranks evidence, because a person is named", () => {
  const state = deskDraftState({ ...quiet, names_unresolved: 1, evidence_required: true });
  assert.equal(state.key, "names");
});

test("an imported paste is its own draft, and never claims ready-to-check", () => {
  const state = deskDraftState({ ...quiet, imported_text: true });
  assert.equal(state.key, "imported");
  assert.equal(state.label, "Imported");
  assert.equal(deskDraftAction(state), "Continue");
});

test("a headline the editor wrote makes it their draft", () => {
  const renamed = deskDraftState({
    ...quiet,
    headline: "Council puts the vote off again",
    model_headline: "Council delays the vote",
    headline_source: "model",
  });
  assert.equal(renamed.key, "yours");
  assert.equal(renamed.label, "Your draft");
  assert.equal(renamed.yours, true);
  const flagged = deskDraftState({ ...quiet, headline_source: "editor" });
  assert.equal(flagged.yours, true);
  // A row from before 0.6.67 has no model headline and reads 'model', so the
  // desk must not claim the editor wrote it.
  assert.equal(
    deskDraftState({ ...quiet, model_headline: null, headline_source: "model" }).yours,
    false,
  );
});

test("a lead filed by hand has a draft row and no prose, so it never reads ready", () => {
  // `fileLead` writes the draft row with body = '' the moment the lead is
  // filed. Before this branch the row fell through to "Ready to check", so
  // Today counted it on the Publish step and in Tonight's edition while the
  // nav -- which counts leads whose status is `drafted` -- said zero.
  const filed = deskDraftState({ ...quiet, has_body: false });
  assert.equal(filed.key, "empty");
  assert.equal(filed.label, "Nothing written yet");
  assert.equal(filed.needsYou, false, "an unwritten lead is not the editor's to fix");
  assert.equal(filed.running, false);
  assert.equal(deskDraftAction(filed), "Start story");
  // A redraft that has not written anything yet is still a job to watch.
  assert.equal(deskDraftState({ ...quiet, has_body: false, job_status: "queued" }).key, "running");
  assert.equal(
    deskDraftState({ ...quiet, has_body: false, job_status: "failed" }).key,
    "failed",
  );
});

test("the ready row does not promise publishability, which it cannot see", () => {
  const state = deskDraftState(quiet);
  assert.equal(state.key, "ready");
  assert.equal(state.label, "Ready to check");
  assert.equal(deskDraftAction(state), "Review");
});

test("elapsed time is printed the way the desk prints it", () => {
  const now = Date.parse("2026-09-26T10:00:52.000Z");
  assert.equal(deskDraftElapsed("2026-09-26T10:00:00.000Z", now), "0:52");
  assert.equal(deskDraftElapsed("2026-09-26T09:58:34.000Z", now), "2:18");
  assert.equal(deskDraftElapsed("2026-09-26T08:56:43.000Z", now), "1:04:09");
  // A clock that ran backwards, or a row with no start, prints no time rather
  // than a negative or a NaN on the screen.
  assert.equal(deskDraftElapsed("2026-09-26T10:05:00.000Z", now), "0:00");
  assert.equal(deskDraftElapsed(null, now), "");
  assert.equal(deskDraftElapsed("not a date", now), "");
});

test("filter counts overlap on purpose, and each one is what the filter shows", () => {
  const states = [
    deskDraftState({ ...quiet, job_status: "running" }),
    deskDraftState({ ...quiet, job_status: "failed" }),
    deskDraftState({ ...quiet, names_unresolved: 1 }),
    deskDraftState({ ...quiet, headline_source: "editor" }),
    deskDraftState(quiet),
    // An unwritten lead is on the list and in nothing else: it is work the
    // desk has not started, so it belongs to no filter that means "act now".
    deskDraftState({ ...quiet, has_body: false }),
  ];
  const counts = deskDraftFilterCounts(states);
  assert.deepEqual(counts, { all: 6, running: 1, "needs-you": 1, yours: 1, failed: 1 });
  for (const [filter, n] of Object.entries(counts)) {
    assert.equal(
      states.filter((s) => deskDraftMatchesFilter(s, filter as keyof typeof counts)).length,
      n,
      `the ${filter} count must equal what the ${filter} filter shows`,
    );
  }
});
