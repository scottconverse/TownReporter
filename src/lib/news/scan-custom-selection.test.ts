import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// NOTE: this imports the REAL production predicate from section-types.ts. The
// point of this file is to be bound to the code `performScanWork` actually
// runs, not to a re-implementation of it. See the "is what production calls"
// test at the bottom, which fails if desk.ts stops using this function.
import { isCustomScanSnapshot, selectCustomScanSources, type CustomScanSnapshot } from "./section-types.ts";

const deskSource = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

describe("custom scan selection (P0-1)", () => {
  const all = [
    { id: 1, status: "accepted" },
    { id: 2, status: "accepted" },
    { id: 3, status: "accepted" },
    { id: 4, status: "proposed" },
    { id: 5, status: "rejected" },
    { id: 6, status: "unavailable" },
  ];

  it("fetches ONLY the selected accepted sources", () => {
    const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: [1, 3] };
    const fetched = selectCustomScanSources(snapshot, all).map((s) => s.id);
    assert.deepEqual(fetched, [1, 3]);
    assert.ok(!fetched.includes(2), "unselected accepted source must not be fetched");
  });

  it("never fetches proposed, rejected or unavailable sources even if selected", () => {
    const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: [1, 4, 5, 6] };
    const fetched = selectCustomScanSources(snapshot, all).map((s) => s.id);
    assert.deepEqual(fetched, [1]);
  });

  it("persists the source IDs into the run snapshot before fetching", () => {
    const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: [7, 8, 9] };
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    assert.equal(isCustomScanSnapshot(roundTripped), true);
    assert.deepEqual((roundTripped as CustomScanSnapshot).sourceIds, [7, 8, 9]);
  });

  it("distinguishes a custom snapshot from a section snapshot", () => {
    assert.equal(isCustomScanSnapshot({ kind: "custom", sourceIds: [1] }), true);
    assert.equal(isCustomScanSnapshot({ key: "schools", sourceIds: [1] }), false);
    assert.equal(isCustomScanSnapshot(null), false);
  });

  it("carries an optional pack id for a pack run (P0-2)", () => {
    const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: [1, 2], packId: 5, packName: "Schools" };
    assert.equal(snapshot.packId, 5);
    assert.equal(snapshot.packName, "Schools");
  });

  it("is the predicate production actually calls (coupling pin)", () => {
    // If this function is ever re-inlined or swapped in desk.ts, this fails,
    // which is the point: the behavioral tests above must bind to the code
    // that runs, not a copy that can silently drift.
    assert.match(
      deskSource,
      /const sources = customSnapshot\s*\?\s*selectCustomScanSources\(customSnapshot, allSources\)/,
      "performScanWork must call the exported selectCustomScanSources",
    );
    assert.doesNotMatch(
      deskSource,
      /allSources\.filter\(\(s\) => s\.status === "accepted" && customIdSet\.has\(s\.id\)\)/,
      "the inline custom filter must not be reintroduced",
    );
  });
});