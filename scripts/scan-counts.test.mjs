// guards: editors could mistake a source fetch limit for the number of leads filed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
const { dailyScanRows } = await import(
  await moduleUrl("src/lib/desk/ops-rows.ts", {
    "../news/local-models.ts": stubUrl("export const pickLoadedLocalModel=()=>null;"),
    "../news/trash-store.ts": stubUrl("export const TRASH_DAYS=30;"),
    "../ops/health.ts": stubUrl('export const formatAgo=()=>"";'),
  })
);
test("scan counts distinguish selection and fetch limits from recorded results", () => {
  const rows = dailyScanRows({
    enabled: true,
    localTime: "06:00",
    selectedSourceIds: [1, 2, 3],
    everyDaySourceCount: 1,
    sourceCap: 2,
    lastScan: {
      sources_fetched: 1,
      leads_created: 4,
      startedAt: "2026-10-14T12:00:00.000Z",
      finishedAt: "2026-10-14T12:20:00.000Z",
    },
  });
  const values = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(values["Sources selected"], "3");
  assert.equal(values["Priority set"], "1");
  assert.equal(values["Fetch cap"], "2");
  assert.equal(values["Sources read (daily scan, Oct 14, 6:00 a.m.)"], "1");
  assert.equal(values["Leads filed (daily scan, Oct 14, 6:00 a.m.)"], "4");
});
