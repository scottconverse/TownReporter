import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDraftCompletionReceipt, draftCompletionStage, parseDraftCompletionReceipt } from "./draft-completion.ts";

describe("draft completion receipts", () => {
  it("records the final draft separately from the writer checkpoint", () => {
    const receipt = buildDraftCompletionReceipt({
      checkpointDraftId: 98,
      finalDraftId: 99,
      citationStatus: "repaired",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "matched" }] },
    });
    assert.equal(receipt.checkpointDraftId, 98);
    assert.equal(receipt.finalDraftId, 99);
    assert.equal(receipt.draftId, 99);
    assert.equal(receipt.quality.reviewRequired, false);
    assert.equal(draftCompletionStage(JSON.stringify(receipt)), "Done");
  });

  it("keeps a completed job truthful when checks need review", () => {
    const receipt = buildDraftCompletionReceipt({
      finalDraftId: 99,
      citationStatus: "review-required",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "unresolved" }] },
    });
    assert.deepEqual(receipt.quality.reviewReasons, ["citations-missing", "names-unresolved"]);
    assert.equal(draftCompletionStage(receipt), "Draft saved — review required");
  });

  it("reads legacy batch completion metadata", () => {
    const parsed = parseDraftCompletionReceipt({ draftId: 27, evidenceCheckIncomplete: true });
    assert.equal(parsed?.finalDraftId, 27);
    assert.equal(parsed?.quality.reviewRequired, true);
  });

  it("adds a review reason when the style audit still has something to fix", () => {
    const receipt = buildDraftCompletionReceipt({
      finalDraftId: 99,
      citationStatus: "complete",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "matched" }] },
      styleAudit: { status: "open", fixCount: 2, reviewCount: 1, rounds: 2 },
    });
    assert.deepEqual(receipt.quality.reviewReasons, ["style-audit-open"]);
    assert.equal(receipt.quality.reviewRequired, true);
    assert.equal(receipt.quality.styleAudit?.fixCount, 2);
    assert.equal(draftCompletionStage(receipt), "Draft saved — review required");
  });

  it("leaves a repaired draft reading Done", () => {
    const receipt = buildDraftCompletionReceipt({
      finalDraftId: 99,
      citationStatus: "complete",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "matched" }] },
      styleAudit: { status: "repaired", fixCount: 0, reviewCount: 3, rounds: 1 },
    });
    assert.deepEqual(receipt.quality.reviewReasons, []);
    assert.equal(receipt.quality.reviewRequired, false);
    assert.equal(draftCompletionStage(receipt), "Done");
  });

  it("round-trips the style summary through the job receipt", () => {
    const receipt = buildDraftCompletionReceipt({
      finalDraftId: 99,
      citationStatus: "complete",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "matched" }] },
      styleAudit: { status: "provider-failed", fixCount: 1, reviewCount: 0, rounds: 1 },
    });
    const parsed = parseDraftCompletionReceipt(JSON.stringify(receipt));
    assert.deepEqual(parsed?.quality.styleAudit, {
      status: "provider-failed",
      fixCount: 1,
      reviewCount: 0,
      rounds: 1,
    });
    assert.equal(parsed?.quality.reviewRequired, true);
  });

  it("does not print Done for a row whose summary says problems are open", () => {
    const parsed = parseDraftCompletionReceipt({
      draftId: 27,
      quality: { styleAudit: { status: "open", fixCount: 1 }, reviewRequired: false },
    });
    assert.equal(parsed?.quality.reviewRequired, true);
    assert.deepEqual(parsed?.quality.reviewReasons, ["style-audit-open"]);
  });

  it("drops a style summary it does not understand instead of guessing", () => {
    const parsed = parseDraftCompletionReceipt({
      draftId: 27,
      quality: { styleAudit: { status: "polished", fixCount: 4 }, reviewRequired: false },
    });
    assert.equal(parsed?.quality.styleAudit, undefined);
    assert.equal(parsed?.quality.reviewRequired, false);
  });

  it("carries no style summary for a receipt written before the audit existed", () => {
    const receipt = buildDraftCompletionReceipt({
      finalDraftId: 99,
      citationStatus: "complete",
      evidenceCheckIncomplete: false,
      nameCheck: { complete: true, rows: [{ status: "matched" }] },
    });
    assert.equal("styleAudit" in receipt.quality, false);
  });
});
