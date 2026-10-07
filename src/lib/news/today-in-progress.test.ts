// guards: a published story could be presented as unfinished work on Today.
import { it } from "node:test";
import assert from "node:assert/strict";
import { todayInProgressJobs } from "./today-in-progress.ts";

it("leaves published stories out of Today’s unfinished story list", () => {
  const rows = [
    { leadId: 461, kind: "draft", headline: "RTD Opens Feedback", status: "completed" },
    { leadId: 462, kind: "draft", headline: "Council Sets a Hearing", status: "completed" },
    { leadId: 463, kind: "scan", headline: null, status: "running" },
  ];

  assert.deepEqual(
    todayInProgressJobs(rows, new Set([461])).map((row) => row.leadId),
    [462],
  );
});
