import { describe, it } from "node:test";
import assert from "node:assert/strict";

const deskPath = new URL("./desk.ts", import.meta.url);

/**
 * M-3 condition 3: the meetings coverage line must reach the PERSISTED
 * scan_runs.summary. Before the fix, desk.ts appended only editor_summary and
 * resurfaced sentences, so the coverage line never landed in summary.
 *
 * Keep the source landmarks explicit and assert they exist before slicing:
 * an absent marker must fail this test, never produce an empty block that can
 * pass vacuously. The summary calculation and scan_runs write are checked
 * separately so both folding and persistence remain covered.
 */
describe("M-3 scan_runs carries the meetings coverage line", () => {
  it("folds meetingAwareness.coverageLine into the persisted summary", async () => {
    const { readFileSync } = await import("node:fs");
    const desk = readFileSync(deskPath, "utf8");
    const coverageStart = desk.indexOf(
      'const meetingCoverageLine = meetingAwareness?.coverageLine ?? "";',
    );
    assert.notEqual(coverageStart, -1, "desk.ts must derive the persisted meeting coverage line");
    const scanRunUpdateStart = desk.indexOf("update scan_runs", coverageStart);
    assert.ok(scanRunUpdateStart > coverageStart, "the coverage line must precede the scan_runs write");
    const updateEnd = desk.indexOf("where id = ${runId}", scanRunUpdateStart);
    assert.ok(updateEnd > scanRunUpdateStart, "the scan_runs update must have a run-id fence");
    const summaryBlock = desk.slice(coverageStart, scanRunUpdateStart);
    const persistedRunUpdate = desk.slice(scanRunUpdateStart, updateEnd);
    assert.match(
      summaryBlock,
      /meetingAwareness\?\.coverageLine/,
      "desk.ts must read meetingAwareness?.coverageLine when building summary",
    );
    assert.match(
      summaryBlock,
      /summary = summary \? `\$\{summary\} \$\{meetingCoverageLine\}`\.slice\(0, 1200\) : meetingCoverageLine;/,
      "the coverage line must be appended to summary with the existing 1200-char slice pattern",
    );
    assert.match(
      persistedRunUpdate,
      /summary = \$\{summary\}/,
      "the coverage-enriched summary must be written to scan_runs.summary",
    );
  });
});
