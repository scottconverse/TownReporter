import assert from "node:assert/strict";
import test from "node:test";
import { splitDeskJobs } from "./desk-job-groups.ts";

test("running and queued are disjoint groups whose counts match their rows", () => {
  const groups = splitDeskJobs([
    { id: 1, status: "running" },
    { id: 2, status: "queued" },
    { id: 3, status: "failed" },
    { id: 4, status: "queued" },
  ]);
  assert.deepEqual(groups.running.map((job) => job.id), [1]);
  assert.deepEqual(groups.queued.map((job) => job.id), [2, 4]);
});
