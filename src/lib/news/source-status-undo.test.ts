import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sourceStatusUndoTo } from "./source-status-undo.ts";

/*
  FB7, item 1: "confirm + undo for Sources Remove and Delete pack"
  (FB0-REPORT.md Table B: "Remove … SILENT FAIL + NO UNDO + no confirm",
  Scan: "Delete pack … SILENT FAIL + NO UNDO + no confirm").

  The pending state and the failure sentence on both of these were already
  fixed by batch 5 -- what was missing was the way back and the second press.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

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

describe("the button carries the press and the row carries its old status", () => {
  const source = read("../../routes/desk.sources.tsx");

  it("asks twice before removing, and says what the second press does", () => {
    assert.match(source, /function RemoveAction\(/, "one two-step control for every Remove on the screen");
    assert.match(source, /"Yes, remove"/);
    assert.match(source, /onAsk=\{\(\) => onConfirmRemove\(s\.id\)\}/);
    assert.match(source, /onConfirm=\{\(\) => \{/, "and the second press is what calls the desk");
  });

  it("passes the row's own status, so the Undo has a target", () => {
    // Without `from` there is no way back: the mutation knows the new status
    // and has no memory of the old one.
    const withFrom = source.match(/onStatus\(s\.id, "rejected", s\.status\)/g) ?? [];
    assert.ok(withFrom.length >= 2, `every Remove carries the old status, found ${withFrom.length}`);
  });

  it("draws the way back on the done toast", () => {
    assert.match(source, /const back = sourceStatusUndoTo\(input\);/);
    assert.match(source, /label: "Undo"/);
  });
});

describe("Delete pack asks twice and can be put back", () => {
  const scan = read("../../routes/desk.scan.tsx");

  it("does not delete on the first press", () => {
    assert.match(scan, /setConfirmDelete\(true\)/, "the first press only arms");
    assert.match(scan, /"Yes, delete the pack"/, "and says so on the second");
    assert.match(scan, />\s*Keep\s*</, "with a way not to");
  });

  it("remembers the pack before it goes, so the Undo can rebuild it", () => {
    assert.match(
      scan,
      /lastDeletedPack\.current = \{ name: p\.name, sourceIds: \[\.\.\.p\.sourceIds\] \};/,
      "the name and the ids are read from the pack, not from the list after the press",
    );
    assert.match(scan, /saveScanSourcePackFn\(\{ data: \{ name: pack\.name, sourceIds: pack\.sourceIds \} \}\)/);
  });
});
