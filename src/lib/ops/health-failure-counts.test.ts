/*
  F25 (Nov 19 walk): the Server page said "Errors in 24 h 0" while a desk job
  had failed and a follow-up check could not run. The count is now failed desk
  jobs plus follow-ups that could not check -- and a one-shot model switch that
  still finished is its own line, not an error.

  These are the rows the collector draws, from the counts it found. The query
  that finds them is `checkJobs` in health.server.ts; the rule that turns those
  numbers into words is `failureCountChecks`, and that is what is pinned here,
  with no database (this file only imports the pure module).
*/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failureCountChecks } from "./health.ts";

const errors = (counts: Parameters<typeof failureCountChecks>[0]) =>
  failureCountChecks(counts).find((check) => check.id === "errors-24h")!;
const fallback = (counts: Parameters<typeof failureCountChecks>[0]) =>
  failureCountChecks(counts).find((check) => check.id === "fallback-24h");

describe("Errors in 24 h", () => {
  it("is ok at zero, with the sentence that says what was checked", () => {
    const row = errors({ failed24h: 0, followupFailed24h: 0, fallback24h: 0 });
    assert.equal(row.value, "0");
    assert.equal(row.state, "ok");
    assert.match(row.note ?? "", /No desk job has failed and no follow-up check has been missed/);
  });

  it("counts a failed desk job", () => {
    const row = errors({ failed24h: 1, followupFailed24h: 0, fallback24h: 0 });
    assert.equal(row.value, "1");
    assert.equal(row.state, "warn");
    assert.match(row.note ?? "", /1 desk job failed in the last 24 hours\./);
  });

  it("counts a follow-up check that could not run", () => {
    const row = errors({ failed24h: 0, followupFailed24h: 1, fallback24h: 0 });
    assert.equal(row.value, "1", "a follow-up error must not read 0");
    assert.equal(row.state, "warn");
    assert.match(row.note ?? "", /1 follow-up check could not run in the last 24 hours\./);
  });

  it("adds the two kinds together, and says both", () => {
    const row = errors({ failed24h: 2, followupFailed24h: 3, fallback24h: 0 });
    assert.equal(row.value, "5");
    assert.match(row.note ?? "", /2 desk jobs failed/);
    assert.match(row.note ?? "", /3 follow-up checks could not run/);
    assert.match(row.note ?? "", /Open the work queue or Follow-ups/);
  });

  it("does not count a model switch that still finished", () => {
    const counts = { failed24h: 0, followupFailed24h: 0, fallback24h: 4 };
    assert.equal(errors(counts).value, "0", "a finished fallback is not an error");
    assert.equal(errors(counts).state, "ok");
  });
});

describe("Model switch", () => {
  it("is left off the page when nothing fell back", () => {
    assert.equal(fallback({ failed24h: 0, followupFailed24h: 0, fallback24h: 0 }), undefined);
  });

  it("is its own ok row, named as a fallback and not an error", () => {
    const row = fallback({ failed24h: 0, followupFailed24h: 0, fallback24h: 1 });
    assert.ok(row, "a fallback must be shown");
    assert.equal(row.id, "fallback-24h");
    assert.equal(row.label, "Model switch");
    assert.equal(row.state, "ok", "a job that finished on another model is not a fault");
    assert.equal(row.value, "fell back to another model: 1");
    assert.match(row.note ?? "", /not an error; the work was done/);
  });

  it("is drawn beside a real error, each counted once", () => {
    const counts = { failed24h: 1, followupFailed24h: 0, fallback24h: 2 };
    const rows = failureCountChecks(counts);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.value, "1");
    assert.equal(rows[1]!.value, "fell back to another model: 2");
  });
});
