import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

describe("listScans honest history (P0-4)", () => {
  it("returns rows AND a true total in one response", () => {
    assert.match(desk, /select count\(\*\)::int as total from scan_runs/);
    assert.match(desk, /return \{ rows, total: count\?\.total \?\? rows\.length \}/);
  });

  it("bounds the history query with limit and offset instead of a hard 12", () => {
    const listScansBlock = desk.slice(desk.indexOf("export const listScans"), desk.indexOf("export const runScan"));
    assert.match(listScansBlock, /limit \$\{limit\} offset \$\{offset\}/);
    assert.doesNotMatch(listScansBlock, /limit 12/);
  });

  it("selects the coverage-accounting columns for every row", () => {
    for (const col of [
      "sources_selected",
      "sources_attempted",
      "sources_failed",
      "sources_analyzed",
      "model_batches_used",
      "model_batches_failed",
      "failed_sources",
    ]) {
      assert.ok(desk.includes(col), `listScans must select ${col}`);
    }
  });

  it("annotates every displayed open run through one batched latest-job lookup", () => {
    const listScansBlock = desk.slice(desk.indexOf("export const listScans"), desk.indexOf("export const runScan"));
    assert.match(
      listScansBlock,
      /annotateScanRowsWithStallStatus\(rows,\s*owned\(context\)\)/,
      "all displayed rows must receive their own stall status",
    );
    assert.doesNotMatch(listScansBlock, /latestJob\(/, "history must not issue one lookup per row");
  });
});

describe("scan run writes coverage accounting (P0-3)", () => {
  it("writes the accounting columns on success", () => {
    const block = desk.slice(desk.indexOf("const commitResults"), desk.indexOf("await deps.beforeScheduledCommit"));
    assert.match(block, /sources_selected = \$\{sources\.length\}/);
    assert.match(block, /sources_analyzed = \$\{analyzedSourceCount\}/);
    assert.match(block, /model_batches_used = \$\{batches\.length\}/);
    assert.match(block, /model_batches_failed = \$\{batchesFailed\}/);
    assert.match(block, /failed_sources = \$\{postgresText\(JSON\.stringify\(failedSources\)\)/);
  });

  it("writes the accounting columns on total batch failure", () => {
    const block = desk.slice(desk.indexOf("const recordFailedRun"), desk.indexOf("const merged = mergeScanBatchResults"));
    assert.match(block, /sources_analyzed = \$\{sourcesAnalyzed\}/);
    assert.match(block, /sources_failed = \$\{failedSources\.length\}/);
    assert.match(block, /model_batches_failed = \$\{batchesFailed\}/);
    assert.match(block, /error = \$\{postgresText\(failure\)\.slice\(0, 800\)\}/);
  });

  // Bug 17b: a failed scheduled pass completed its reservation before quota handling.
  it("routes scheduled failures through failure settlement with queued touches", () => {
    const block = desk.slice(desk.indexOf("if (!batchResults.length)"), desk.indexOf("const merged = mergeScanBatchResults"));
    assert.doesNotMatch(block, /await deps\.scheduledCommit/);
    const settlement = desk.slice(desk.indexOf("const settle = async"), desk.indexOf("// PerformDraftWorkDeps"));
    assert.match(settlement, /await writeQueuedSourceWrites\(receiptSql\)/);
    assert.match(settlement, /deps\.scheduledFailure\(failure, settle\)/);
    const daily = readFileSync(new URL("./daily-scan.server.ts", import.meta.url), "utf8");
    assert.match(daily, /scheduledFailure:[\s\S]*?finalizeDailyScanFailure\(job, msg, write\)/);
  });
  it("locks the current manual job claim before committing scan results", () => {
    const block = desk.slice(desk.indexOf("const commitResults"), desk.indexOf("let committed"));
    assert.match(block, /lockManualScanClaim\(writeSql, job\)/);
    assert.match(block, /finished_at is null[\s\S]*?for update/);
    assert.match(block, /refreshManualScanClaim\(writeSql, job\)/);
  });
});

describe("batched analysis replaces the single truncating pass (P0-5)", () => {
  it("no longer contains the 48000-char single-pass break", () => {
    assert.doesNotMatch(desk, /PAYLOAD_BUDGET = 48000/);
    assert.doesNotMatch(desk, /if \(next\.length > PAYLOAD_BUDGET\) break;/);
  });

  it("builds bounded batches and merges their results", () => {
    assert.match(desk, /buildScanBatches\(\{ sources: batchSources \}\)/);
    assert.match(desk, /mergeScanBatchResults\(batchResults\)/);
    /*
      FB1 changed the loop's shape: it is indexed now, because the batch number
      is what the card reports as a percentage ("Reading the sources with a
      model — batch 2 of 5"). The bounded-batch property this test exists for is
      unchanged -- one model call per batch, merged at the end -- and the pin
      follows the code rather than the other way round.
    */
    assert.match(desk, /for \(const \[batchIndex, batch\] of batches\.entries\(\)\)/);
  });
});
