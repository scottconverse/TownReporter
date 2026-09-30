import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BULK_STATUS_TOAST_ID,
  BULK_STATUS_UNDO_LABEL,
  bulkStatusReport,
  bulkStatusSummary,
} from "./queue-bulk.ts";

/**
 * One sentence for a bulk press on the Queue (unit FB5, item M7).
 *
 * The bulk strip ran `setStatus.mutate` once per selected lead, so twelve leads
 * meant twelve toasts into a three-toast stack and a partial failure that
 * scrolled off behind the successes. The press now reports the whole batch
 * once, and the sentence below is the whole report.
 *
 * THE MUTATIONS THAT MATTER. Counting every settled call as a success (dropping
 * the `rejected` and `{ok:false}` branches) fails "counts only the leads that
 * took"; returning every id as undoable fails "offers the way back for the
 * leads that took, and no others".
 */

const ok = (value: unknown = { ok: true }): PromiseSettledResult<unknown> => ({
  status: "fulfilled",
  value,
});
const bad = (reason: unknown): PromiseSettledResult<unknown> => ({ status: "rejected", reason });
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

describe("the sentence a bulk press shows", () => {
  it("says how many landed", () => {
    assert.equal(
      bulkStatusSummary({ status: "held", done: 12, failures: [] }),
      "Held 12.",
    );
    assert.equal(
      bulkStatusSummary({ status: "killed", done: 1, failures: [] }),
      "Killed 1.",
    );
  });

  it("carries the reason when one did not", () => {
    assert.equal(
      bulkStatusSummary({ status: "held", done: 11, failures: ["the desk was busy"] }),
      "Held 11. 1 failed: the desk was busy",
    );
    assert.equal(
      bulkStatusSummary({
        status: "killed",
        done: 10,
        failures: ["the desk was busy", "the desk was busy"],
      }),
      "Killed 10. 2 failed: the desk was busy",
    );
  });

  it("still names the press when nothing landed", () => {
    /*
      `done: 0` is the case the audit measured as silent -- every row stayed put
      and the editor was told nothing. The verb is the press they made, and the
      count and the reason are what they act on.
    */
    assert.equal(
      bulkStatusSummary({ status: "held", done: 0, failures: ["nothing was signed in"] }),
      "Held 0. 1 failed: nothing was signed in",
    );
  });
});

describe("reading a settled batch", () => {
  it("counts only the leads that took", () => {
    const report = bulkStatusReport({
      status: "held",
      ids: [1, 2, 3],
      settled: [ok(), bad(new Error("Failed to fetch")), ok()],
      reason,
    });
    assert.equal(report.done, 2);
    assert.deepEqual(report.failures, ["Failed to fetch"]);
  });

  it("counts a refusal the server answered with as a failure", () => {
    const report = bulkStatusReport({
      status: "killed",
      ids: [7],
      settled: [ok({ ok: false, error: "That lead is already printed." })],
      reason,
    });
    assert.equal(report.done, 0);
    assert.deepEqual(report.failures, ["That lead is already printed."]);
  });

  it("offers the way back for the leads that took, and no others", () => {
    const report = bulkStatusReport({
      status: "held",
      ids: [1, 2, 3, 4],
      settled: [ok(), bad(new Error("nope")), ok({ ok: false, error: "refused" }), ok()],
      reason,
    });
    assert.deepEqual(report.undoIds, [1, 4], "an Undo would restore a lead that was never held");
    assert.deepEqual(report.failures, ["nope", "refused"]);
  });

  it("says something when the batch ran short", () => {
    // A missing settled entry is not a success; it is a lead nobody heard back
    // about, and it must not be counted or made undoable.
    const report = bulkStatusReport({ status: "held", ids: [1, 2], settled: [ok()], reason });
    assert.equal(report.done, 1);
    assert.equal(report.failures.length, 1);
    assert.deepEqual(report.undoIds, [1]);
  });
});

describe("one toast per bulk press", () => {
  it("raises every summary under one id, so a second press updates the first", () => {
    assert.equal(typeof BULK_STATUS_TOAST_ID, "string");
    assert.ok(BULK_STATUS_TOAST_ID.length > 0);
    // The id is the same for Hold and for Kill on purpose: they act on the same
    // selection, and two summaries that disagree about it is the defect.
    assert.equal(BULK_STATUS_UNDO_LABEL, "Undo");
  });
});
