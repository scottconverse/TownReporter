import { describe, it } from "node:test";
import assert from "node:assert/strict";

const deskPath = new URL("./desk.ts", import.meta.url);

/**
 * M-3 condition 3: the meetings coverage line must reach the PERSISTED
 * scan_runs.summary. Before the fix, desk.ts appended only editor_summary and
 * resurfaced sentences, so the coverage line never landed in summary.
 *
 * This test reads the exact UPDATE statement text and asserts the meeting
 * coverage line is folded into the summary expression. It fails on the
 * pre-fix source and passes after the one-line fix.
 */
describe("M-3 scan_runs carries the meetings coverage line", () => {
  it("folds meetingAwareness.coverageLine into the persisted summary", async () => {
    const { readFileSync } = await import("node:fs");
    const desk = readFileSync(deskPath, "utf8");
    const block = desk.slice(
      desk.indexOf("let summary = String(data.editor_summary"),
      desk.indexOf("await deps.beforeScheduledCommit"),
    );
    assert.match(
      block,
      /meetingAwareness\?\.coverageLine/,
      "desk.ts must read meetingAwareness?.coverageLine when building summary",
    );
    assert.match(
      block,
      /summary = summary \? `\$\{summary\} \$\{meetingCoverageLine\}`\.slice\(0, 1200\) : meetingCoverageLine;/,
      "the coverage line must be appended to summary with the existing 1200-char slice pattern",
    );
  });
});
