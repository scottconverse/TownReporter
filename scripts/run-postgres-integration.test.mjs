import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPassingIntegrationSummary, parseTapSummary } from "./run-postgres-integration.mjs";

test("runner accepts a real nonzero TAP pass summary", () => {
  const summary = parseTapSummary("# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# todo 0\n");
  assert.deepEqual(summary, { tests: 2, pass: 2, fail: 0, skipped: 0, todo: 0 });
  assert.equal(assertPassingIntegrationSummary(summary), summary);
});

test("runner rejects empty, all-skipped, failed, and missing TAP summaries", () => {
  for (const output of [
    "# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# todo 0\n",
    "# tests 2\n# pass 0\n# fail 0\n# skipped 2\n# todo 0\n",
    "# tests 2\n# pass 1\n# fail 1\n# skipped 0\n# todo 0\n",
    "TAP version 13\n",
  ]) {
    assert.throws(() => assertPassingIntegrationSummary(parseTapSummary(output)));
  }
});

test("runner uses late isolation preload and executes the entire discovered set by default", async () => {
  const source = await readFile(new URL("./run-postgres-integration.mjs", import.meta.url), "utf8");
  assert.match(source, /postgresTestFiles\(root\)/);
  assert.match(source, /--import.*test-environment-guard/);
  assert.match(source, /--import.*postgres-integration-opt-in/);
  assert.match(source, /selected = process\.argv\.slice\(2\)\.length \? process\.argv\.slice\(2\) : discovered/);
  assert.match(source, /assertPassingIntegrationSummary/);
});
