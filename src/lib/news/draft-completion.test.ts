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
});
