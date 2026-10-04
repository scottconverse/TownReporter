import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sourceStatusUndoTo } from "./source-status-undo.ts";

/*
  FB7, item 1: "confirm + undo for Sources Remove and Delete pack"
  (FB0-REPORT.md Table B: "Remove … SILENT FAIL + NO UNDO + no confirm",
  Scan: "Delete pack … SILENT FAIL + NO UNDO + no confirm").

  The pending state and the failure sentence on both of these were already
  fixed by batch 5 -- what was missing was the way back and the second press.
*/

describe("Removing a source offers exactly one way back", () => {
  it("puts the row back in the status it was in", () => {
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: "accepted" }), "accepted");
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: "paused" }), "paused");
  });

  it("offers nothing for Pause or Accept", () => {
    // Each already has its own inverse drawn on the same row -- Resume, and
    // Remove itself. An Undo beside those is two buttons for one press.
    assert.equal(sourceStatusUndoTo({ status: "paused", from: "accepted" }), null);
    assert.equal(sourceStatusUndoTo({ status: "accepted", from: "rejected" }), null);
  });

  it("offers nothing when the row was already removed", () => {
    // Removing twice is the same state twice; there is nothing to take back
    // to, and an Undo that "restores" a removal would be a no-op the editor
    // reads as a fix.
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: "rejected" }), null);
  });

  it("refuses to guess a status it was not told", () => {
    // The call site carries the row's old status. A missing or unrecognised
    // one gets no Undo rather than a guessed "accepted" -- putting a source
    // back as something the editor never chose is worse than no button.
    assert.equal(sourceStatusUndoTo({ status: "rejected" }), null);
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: null }), null);
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: "proposed" }), null);
    assert.equal(sourceStatusUndoTo({ status: "rejected", from: "" }), null);
  });
});
