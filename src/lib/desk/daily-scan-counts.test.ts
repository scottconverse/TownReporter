import assert from "node:assert/strict";
import test from "node:test";
import { dailyScanCounts } from "./daily-scan-counts.ts";

test("saved daily settings and the latest run receipt are named and counted separately", () => {
  const rows = dailyScanCounts({
    selectedSourceIds: [1, 2, 3],
    sourceCap: 12,
    everyDaySourceCount: 8,
    lastScan: { id: 44, execution_origin: "manual", sources_selected: 212, sources_fetched: 58, leads_created: 4 },
  });
  assert.deepEqual(rows.map(({ label, value }) => [label, value]), [
    ["Saved daily sources selected", "3"],
    ["Saved daily priority set", "8"],
    ["Saved daily source cap", "12"],
    ["Latest scan · run 44 · manual", "58 of 212 sources read"],
    ["Leads filed · run 44", "4"],
  ]);
});
