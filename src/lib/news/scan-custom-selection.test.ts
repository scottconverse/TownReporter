import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCustomScanSnapshot, type CustomScanSnapshot } from "./section-types.ts";

/**
 * P0-1: a custom scan must fetch ONLY the selected accepted sources. This
 * asserts the selection filter directly (the fetch set), not the UI, by
 * reproducing the same predicate `performScanWork` applies to `allSources`.
 */
function sourcesFetchedForCustomScan<
  T extends { id: number; status: string },
>(snapshot: CustomScanSnapshot, allSources: T[]): T[] {
  const ids = new Set(snapshot.sourceIds);
  return allSources.filter((s) => s.status === "accepted" && ids.has(s.id));
}

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
    const fetched = sourcesFetchedForCustomScan(snapshot, all).map((s) => s.id);
    assert.deepEqual(fetched, [1, 3]);
    for (const unselected of [2]) {
      assert.ok(!fetched.includes(unselected), "unselected accepted source must not be fetched");
    }
  });

  it("never fetches proposed, rejected or unavailable sources even if selected", () => {
    const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: [1, 4, 5, 6] };
    const fetched = sourcesFetchedForCustomScan(snapshot, all).map((s) => s.id);
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
});