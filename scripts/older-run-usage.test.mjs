// guards: older investigations could show invented zero usage as recorded measurements.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
const { presentDarkRun } = await import(
  await moduleUrl("src/lib/news/dark-run-presentation.ts", {
    "./dark.ts": stubUrl(""),
    "./dark-run-budget.ts": stubUrl(""),
  })
);
test("older runs distinguish missing usage from a recorded zero", () => {
  for (const usage_totals_json of [null, "", "{}", "[]", "bad JSON"]) {
    assert.equal(presentDarkRun({ usage_totals_json }).usageRecorded, false);
  }
  assert.equal(
    presentDarkRun({
      usage_totals_json: '{"modelCalls":0,"searches":0,"documentReads":0,"elapsedMs":0}',
    }).usageRecorded,
    true,
  );
});
