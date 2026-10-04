import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeScanRunSummary } from "./desk-copy.ts";

/**
 * M-3 condition 3: the meetings coverage line must reach the PERSISTED
 * scan_runs.summary.
 *
 * This started as a source-text pin over desk.ts. Scan quality round 2 moved
 * the assembly into `composeScanRunSummary` (desk-copy.ts) so the folding is a
 * behavior this repo can test directly: desk.ts now hands the model's
 * paragraph, the desk's own sentences and `meetingAwareness?.coverageLine` to
 * that one function and writes its return value into scan_runs.summary. These
 * cases fail if the coverage folding is removed, which is the pin's intent
 * without measuring the shape of the caller's source.
 *
 * Round 2 also made the counts (the decisions sentence) outrank the model's
 * paragraph: on the 2026-10-03 dev scan the paragraph ran to the 1200-char
 * budget and erased every count behind it. The third case below holds that.
 */
describe("M-3 scan_runs carries the meetings coverage line", () => {
  it("folds the coverage line into the summary when there is no paragraph", () => {
    const coverage = "Meetings: 3 found, 2 captured, 1 failed.";
    const summary = composeScanRunSummary({
      editorSummary: "",
      meetingCoverageLine: coverage,
    });
    assert.equal(summary, coverage);
  });

  it("folds the coverage line in alongside the model's paragraph", () => {
    const parsed = composeScanRunSummary({
      editorSummary: "Two council items moved forward today.",
      meetingCoverageLine: "Meetings: 3 found, 2 captured, 1 failed.",
    });
    assert.match(parsed, /Meetings: 3 found, 2 captured, 1 failed\./);
    assert.match(parsed, /Two council items moved forward today\./);
  });

  it("keeps the counts and the coverage line when the paragraph runs long", () => {
    const decisions = "This scan left out 3 standing pages; stamped 8 repeats onto stories already in the paper.";
    const coverage = "Meetings: 3 found, 2 captured, 1 failed.";
    const paragraph = "The scan read a great deal of routine material this morning. ".repeat(40);
    const parsed = composeScanRunSummary({
      editorSummary: paragraph,
      decisionsSentence: decisions,
      meetingCoverageLine: coverage,
      summaryLimit: 1200,
    });
    assert.ok(parsed.length <= 1200, "the summary must fit the column");
    // The receipt survives; the paragraph is what gives way.
    assert.match(parsed, /left out 3 standing pages/);
    assert.ok(parsed.includes(coverage), "the coverage line must not be trimmed away");
    assert.ok(parsed.length < paragraph.length, "the paragraph must have been trimmed");
  });

  it("returns the paragraph unchanged when the desk has nothing to add", () => {
    const parsed = composeScanRunSummary({
      editorSummary: "  Nothing crossed the filing bar.  ",
    });
    assert.equal(parsed, "Nothing crossed the filing bar.");
  });
});
