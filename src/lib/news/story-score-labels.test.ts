// guards: an editor could mistake the lead score for the reporting score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadScoreLabel } from "./desk-copy.ts";
import { readinessQuestion, reportingScoreLabel } from "./reporting-package-view.ts";

test("keeps lead, reporting, and print-readiness scores distinct", () => {
  assert.deepEqual([leadScoreLabel(0), reportingScoreLabel({ immediacy: 3, impact: 4, conflict: 4, novelty: 4, total: 15, whyItMatters: "x" }), readinessQuestion(3)], ["Lead score 0/20", "Reporting score 15/20", "Ready to print? Tier 3 -- ready for an editor read"]);
});
