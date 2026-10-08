// guards: editors could mistake worker bookkeeping for reported activity.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as activityCopy from "./desk-copy.ts";

describe("Dark Desk activity wording", () => {
  it("turns saved events into timed findings and failures without worker terms", () => {
    assert.equal(typeof activityCopy.buildInvestigationActivity, "function");
    const lines = activityCopy.buildInvestigationActivity([
      { id: "search-1", at: "2026-10-07T19:02:00.000Z", kind: "search", resultsJson: '["a","b"]', query: "private search text", stage: "planning hop 1 — ok" },
      { id: "claim-1", at: "2026-10-07T19:04:00.000Z", kind: "finding", body: "The filing was posted on September 19." },
      { id: "stop-1", at: "2026-10-07T19:05:00.000Z", kind: "run-stop", failed: true, failureReason: "API Error: model call failed during synthesis with frontier entries" },
    ]);
    assert.ok(lines.some((line) => line.tone === "finding"));
    assert.ok(lines.some((line) => line.tone === "failure"));
    assert.ok(lines.every((line) => /^\d{1,2}:\d{2}$/.test(line.time)));
    assert.match(lines.find((line) => line.id === "stop-1")?.text ?? "", /^Could not finish:/);
    assert.doesNotMatch(lines.map((line) => line.text).join(" "), /\bhop\b|synthesis|— ok|frontier|entries|model call/i);
  });
});
