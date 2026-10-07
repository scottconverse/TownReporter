// guards: an editor sees a failed reporting request as started and cannot learn why it ended.
import { it } from "node:test";
import assert from "node:assert/strict";
import { reportingRunState } from "./reporting-package-view.ts";

it("shows the failed request and its reason instead of a started message", () => {
  const view = reportingRunState({
    requestId: 1,
    status: "FAILED",
    error: "Codex request timed out.",
    finishedAt: "2026-10-07T12:15:13Z",
    modelLabel: "Codex Sol",
    assignment: "Report the council meeting",
  });
  assert.match(view.label, /fail|did not finish/i);
  assert.match(view.detail, /Codex.*timed out/i);
  assert.match(view.detail, /2026-10-07T12:15:13Z/);
  assert.match(view.detail, /Codex Sol/);
  assert.doesNotMatch(JSON.stringify(view), /reporting started/i);
});
