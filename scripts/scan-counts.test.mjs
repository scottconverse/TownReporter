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
    sourceCap: 2,
    lastScan: { sources_fetched: 1, leads_created: 4 },
  });
  const values = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(values["Sources selected"], "3");
  assert.equal(values["Fetch cap"], "2");
  assert.equal(values["Sources actually read"], "1");
  assert.equal(values["Leads filed"], "4");
});
