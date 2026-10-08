// guards: latest-scan counts could keep showing the previous run after a scan finishes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshFinishedScanPolicy } from "./scan-policy-refresh.ts";

test("refreshes scan counts once when polling observes completion or failure", () => {
  const keys: string[][] = [];
  const cache = { invalidateQueries: ({ queryKey }: { queryKey: string[] }) => keys.push(queryKey) };
  const running = [{ id: 1, kind: "scan", status: "running" }];
  const done = [{ ...running[0]!, status: "completed" }];
  refreshFinishedScanPolicy(cache, [], running);
  refreshFinishedScanPolicy(cache, running, done);
  refreshFinishedScanPolicy(cache, done, done);
  refreshFinishedScanPolicy(cache, [], [{ id: 2, kind: "scan", status: "failed" }]);
  refreshFinishedScanPolicy(cache, [], [{ id: 3, kind: "story", status: "completed" }]);
  assert.deepEqual(keys, [["daily-scan-policy"], ["daily-scan-policy"]]);
});
