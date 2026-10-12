import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportingRunSummary } from "./reporting-run-summary.ts";

describe("reporting run handoff for editors", () => {
  it("explains a partial report with no saved recording and names the next action", () => {
    const summary = reportingRunSummary({
      runStatus: "PARTIAL",
      runNote:
        "Research scope is supplied-sources-only. no retained tape was scoped; warm 0 / cold 0 actions; warm and cold passes agreed; 1 saved story packet; coverage gate did not pass.",
      coverageComplete: false,
      actions: [],
      stories: [{}],
    });
    assert.match(summary.read, /No saved meeting transcript or recording was included/i);
    assert.match(summary.read, /used only links supplied .* no public search/i);
    assert.match(summary.established, /1 story draft was saved/);
    assert.match(summary.established, /No meeting actions were recorded/);
    assert.match(summary.stillToCheck, /coverage check did not pass/i);
    assert.match(summary.nextAction, /Start a follow-up run .* official recording or meeting packet/i);
    assert.doesNotMatch(JSON.stringify(summary), /warm|cold|full-pipeline|coverage gate/i);
  });

  it("summarizes retained transcript passages and preserves a successful review state", () => {
    const summary = reportingRunSummary({
      runStatus: "COMPLETE",
      runNote: "read 84 retained segments in 3 windows; warm 12 / cold 12 actions; coverage gate passed.",
      coverageComplete: true,
      actions: Array.from({ length: 12 }),
      stories: [{}],
    });
    assert.match(summary.read, /84 saved transcript passages across 3 parts/);
    assert.match(summary.established, /12 meeting actions were recorded/);
    assert.match(summary.stillToCheck, /coverage check passed/i);
    assert.equal(summary.tone, "ok");
  });
});
