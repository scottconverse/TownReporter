// guards: the Daily scan panel printed one scan's cap as the priority set and
// read the read and filed rows from whatever scan ran last (FB19).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dailyScanCounts } from "./daily-scan-counts.ts";

const sample = {
  selectedSourceIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  sourceCap: 12,
  everyDaySourceCount: 3,
  timezone: "America/Denver",
};

const pairs = (rows: { label: string; value: string }[]) =>
  rows.map((row) => [row.label, row.value]);

describe("Daily scan counts (FB19)", () => {
  it("prints the priority set and the fetch cap as separate rows, and names the daily run it read", () => {
    const rows = dailyScanCounts({
      ...sample,
      lastScan: {
        sources_fetched: 58,
        leads_created: 3,
        startedAt: "2026-10-14T12:00:00.000Z",
        finishedAt: "2026-10-14T12:20:00.000Z",
      },
    });
    assert.deepEqual(pairs(rows), [
      ["Sources selected", "9"],
      ["Priority set", "3"],
      ["Fetch cap", "12"],
      ["Sources read (daily scan, Oct 14, 6:00 a.m.)", "58"],
      ["Leads filed (daily scan, Oct 14, 6:00 a.m.)", "3"],
    ]);
  });

  it("says a daily run still going is running, and reads its numbers so far", () => {
    const rows = dailyScanCounts({
      ...sample,
      lastScan: { sources_fetched: 40, leads_created: 1, startedAt: "2026-10-14T12:00:00.000Z", finishedAt: null },
    });
    assert.deepEqual(pairs(rows).slice(3), [
      ["Sources read (daily scan, running)", "40"],
      ["Leads filed (daily scan, running)", "1"],
    ]);
  });

  it("says no daily run is recorded instead of borrowing another scan's numbers", () => {
    const rows = dailyScanCounts({ ...sample, lastScan: null });
    assert.deepEqual(pairs(rows).slice(3), [
      ["Sources read (no daily run recorded)", "Not recorded"],
      ["Leads filed (no daily run recorded)", "Not recorded"],
    ]);
  });

  it("keeps every row, with no value, when there is no policy at all", () => {
    const rows = dailyScanCounts(null);
    assert.deepEqual(pairs(rows), [
      ["Sources selected", "Not available"],
      ["Priority set", "Not available"],
      ["Fetch cap", "Not available"],
      ["Sources read (no daily run recorded)", "Not recorded"],
      ["Leads filed (no daily run recorded)", "Not recorded"],
    ]);
  });
});
