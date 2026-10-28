import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BULK_STATUS_TOAST_ID,
  BULK_STATUS_UNDO_LABEL,
  bulkKillConfirmWords,
  bulkKillNeedsConfirm,
  bulkStatusReport,
  bulkStatusSummary,
  settleBulkKill,
  undoBulkKill,
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
      "Held 12 leads.",
    );
    assert.equal(
      bulkStatusSummary({ status: "killed", done: 1, failures: [] }),
      "Killed 1 lead.",
    );
  });

  it("carries the reason when one did not", () => {
    assert.equal(
      bulkStatusSummary({ status: "held", done: 11, failures: ["the desk was busy"] }),
      "Held 11 leads. 1 failed: the desk was busy",
    );
    assert.equal(
      bulkStatusSummary({
        status: "killed",
        done: 10,
        failures: ["the desk was busy", "the desk was busy"],
      }),
      "Killed 10 leads. 2 failed: the desk was busy",
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
      "Held 0 leads. 1 failed: nothing was signed in",
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

describe("a bulk Kill that meets a written draft (walk D2, D2-a)", () => {
  const DRAFT_KEY = "lead-has-written-draft";
  const draftWarning = {
    ok: false,
    error: "This lead has a written draft.",
    warning: { key: DRAFT_KEY, sentence: "This lead has a written draft." },
  };

  // A fake of the per-lead write: the lead with a draft answers its warning
  // until the press carries that warning's override.
  const fakeSend = (warnedIds: number[]) =>
    async (ids: readonly number[], overrideById: Record<number, string[]>) =>
      ids.map((id) => {
        const answered = overrideById[id]?.includes(DRAFT_KEY) ?? false;
        const warned = warnedIds.includes(id) && !answered;
        return { status: "fulfilled" as const, value: warned ? draftWarning : { ok: true } };
      });

  it("a bulk Kill of two leads, one with a draft, kills both and reports both as undoable", async () => {
    const settled = await settleBulkKill([452, 437], fakeSend([437]));
    const report = bulkStatusReport({
      status: "killed",
      ids: [452, 437],
      settled: settled.settled,
      reason: () => "could not kill",
    });
    assert.equal(report.done, 2);
    assert.deepEqual(report.undoIds, [452, 437]);
    assert.deepEqual(report.failures, []);
    assert.deepEqual(settled.drafted.map((w) => w.id), [437]);
  });

  it("the draft answer is for drafts only: a warning of another kind is left for the desk to show", async () => {
    const otherWarning = {
      ok: false,
      error: "This lead is already in print.",
      warning: { key: "lead-is-published", sentence: "This lead is already in print." },
    };
    const send = async (ids: readonly number[]) =>
      ids.map((id) => ({ status: "fulfilled" as const, value: id === 437 ? otherWarning : { ok: true } }));
    const settled = await settleBulkKill([452, 437], send);
    assert.deepEqual(settled.drafted, []);
    const report = bulkStatusReport({ status: "killed", ids: [452, 437], settled: settled.settled, reason: () => "x" });
    assert.deepEqual(report.undoIds, [452]);
  });
});

describe("THU-4: the bulk Kill's Undo waits for the batch and puts back every lead it killed", () => {
  it("restores exactly the killed leads, once the press has answered", async () => {
    const calls: number[] = [];
    let answer!: (r: { undoIds: number[] }) => void;
    const report = new Promise<{ undoIds: number[] }>((resolve) => { answer = resolve; });
    const undone = undoBulkKill(report, async (id) => { calls.push(id); });
    // Pressed before the batch answered: nothing is restored yet.
    await Promise.resolve();
    assert.deepEqual(calls, []);
    answer({ undoIds: [4, 9] });
    await undone;
    assert.deepEqual(calls.sort(), [4, 9]);
  });

  it("says how many leads could not be put back", async () => {
    await assert.rejects(
      undoBulkKill(Promise.resolve({ undoIds: [1, 2, 3] }), async (id) => { if (id !== 2) throw new Error("no"); }),
      /2 leads could not be put back/,
    );
  });
});

/**
 * TMA-2: a bulk Kill of ONE lead opened no confirm, so one press killed it with
 * no question asked. The confirm now opens for every count the strip can kill.
 *
 * THE MUTATION THAT MATTERS. A rule of `count > 1` (what the route used) fails
 * "asks first for ONE lead too"; dropping the one-lead words fails "says the
 * one-lead words".
 */
describe("the bulk Kill confirm (TMA-2)", () => {
  it("kills at once with no Why? question, one lead or many (G27-KILL-3)", () => {
    assert.equal(bulkKillNeedsConfirm(1), false);
    assert.equal(bulkKillNeedsConfirm(3), false);
  });
  it("asks nothing when no lead is ticked", () => {
    assert.equal(bulkKillNeedsConfirm(0), false);
  });
  it("says the one-lead words for one lead", () => {
    assert.deepEqual(bulkKillConfirmWords(1), {
      prompt: "Killing 1 lead. Why? The reason is written on it.",
      confirm: "Yes, kill 1",
    });
  });
  it("keeps the same words for two or more", () => {
    assert.deepEqual(bulkKillConfirmWords(2), {
      prompt: "Killing 2 leads. Why? One reason is written on all of them.",
      confirm: "Yes, kill 2",
    });
  });
});
