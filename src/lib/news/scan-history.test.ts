import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Import the REAL paging helpers that desk.scan.tsx uses. The point of this
// file is to be bound to the production code, not to re-implement it.
import { pageOffset, nextWindowSize, isHistoryExhausted, accumulateScanPages } from "./scan-history.ts";

const scanRouteSource = readFileSync(new URL("../../routes/desk.scan.tsx", import.meta.url), "utf8");

describe("scan history paging (P0-4, >50 runs)", () => {
  it("requests successive offsets instead of one growing window", () => {
    assert.equal(pageOffset(1, 12), 0);
    assert.equal(pageOffset(2, 12), 12);
    assert.equal(pageOffset(5, 12), 48);
    assert.equal(pageOffset(6, 12), 60, "the 6th page must start past row 50");
  });

  it("keeps each request at a bounded page size", () => {
    assert.equal(nextWindowSize(12), 12);
    assert.equal(nextWindowSize(50), 50);
  });

  it("reaches row 51 with 51 runs and marks history exhausted", () => {
    const total = 51;
    const rows = Array.from({ length: total }, (_, i) => ({ id: total - i })); // newest first
    // Walk pages exactly as the component would.
    let loaded: { id: number }[] = [];
    let page = 1;
    while (!isHistoryExhausted(loaded.length, total)) {
      const offset = pageOffset(page, 12);
      const slice = rows.slice(offset, offset + 12);
      loaded = accumulateScanPages(loaded, slice);
      page += 1;
      assert.ok(page < 100, "paging must terminate");
    }
    assert.equal(loaded.length, total, "all 51 rows must be reachable");
    assert.ok(loaded.some((r) => r.id === 1), "row 51 (oldest) must be reachable");
    assert.equal(isHistoryExhausted(loaded.length, total), true, "control must disappear");
  });

  it("retains already-loaded rows when a later page arrives", () => {
    const first = [{ id: 5 }, { id: 4 }];
    const second = [{ id: 3 }, { id: 2 }];
    const merged = accumulateScanPages(first, second);
    assert.deepEqual(merged.map((r) => r.id), [5, 4, 3, 2], "loaded rows retained and appended");
  });

  it("dedupes a row that appears in two overlapping pages", () => {
    const merged = accumulateScanPages([{ id: 5 }, { id: 4 }], [{ id: 4 }, { id: 3 }]);
    assert.deepEqual(merged.map((r) => r.id), [5, 4, 3]);
  });

  it("is the paging code production actually uses (coupling pin)", () => {
    assert.match(scanRouteSource, /pageOffset\(/, "the Scan page must use pageOffset");
    assert.match(scanRouteSource, /isHistoryExhausted\(/, "the Scan page must use isHistoryExhausted");
    assert.match(scanRouteSource, /accumulateScanPages\(/, "the Scan page must accumulate, not replace");
  });
});

/*
  A same-id row is not "already correct" -- it is "already present, and its
  latest values win". The Scan page refetches every 2 seconds while a run is in
  flight and merges each response with accumulateScanPages. Dropping same-id rows
  meant the updated row never reached the screen: the Run button stayed enabled,
  no busy indicator appeared, and the run looked dead until the app was restarted.

  These assert the update path, not the shape, so they fail against the
  drop-on-seen implementation.
*/
describe("scan history refresh (a running scan must be able to change on screen)", () => {
  it("takes the newer values when the same run is refetched", () => {
    type Row = { id: number; finished_at: string | null; error: string | null; leads: number };
    const running: Row[] = [{ id: 47, finished_at: null, error: null, leads: 0 }];
    const finished: Row[] = [{ id: 47, finished_at: "2026-09-22T20:00:00Z", error: null, leads: 9 }];
    const merged = accumulateScanPages(running, finished);
    assert.equal(merged.length, 1, "the same run must not be duplicated");
    assert.equal(merged[0].finished_at, "2026-09-22T20:00:00Z", "the newer row must win");
    assert.equal(merged[0].leads, 9, "newer counts must reach the screen");
  });

  it("lets a run go from error-free to failed on refresh", () => {
    type Row = { id: number; finished_at: string | null; error: string | null };
    const running: Row[] = [{ id: 47, finished_at: null, error: null }];
    const failed: Row[] = [{ id: 47, finished_at: "2026-09-22T20:00:00Z", error: "provider refused" }];
    const merged = accumulateScanPages(running, failed);
    assert.equal(merged[0].error, "provider refused", "a failure must be able to appear");
  });

  it("keeps the list newest-first after an in-place update", () => {
    const existing = [{ id: 47, finished_at: null }, { id: 46, finished_at: "x" }, { id: 45, finished_at: "y" }];
    const incoming = [{ id: 47, finished_at: "now" }, { id: 46, finished_at: "x" }];
    const merged = accumulateScanPages(existing, incoming);
    assert.deepEqual(merged.map((r) => r.id), [47, 46, 45], "order must stay newest-first");
    assert.equal(merged[0].finished_at, "now");
  });

  it("still dedupes across overlapping pages while taking the newer row", () => {
    const first = [{ id: 5, v: 1 }, { id: 4, v: 1 }];
    const second = [{ id: 4, v: 2 }, { id: 3, v: 1 }];
    const merged = accumulateScanPages(first, second);
    assert.deepEqual(merged.map((r) => r.id), [5, 4, 3], "no duplicates");
    assert.equal(merged.find((r) => r.id === 4)!.v, 2, "overlap must take the newer copy");
  });
});
