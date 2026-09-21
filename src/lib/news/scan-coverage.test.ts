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
});

describe("scan run writes coverage accounting (P0-3)", () => {
  it("writes the accounting columns on success", () => {
    const block = desk.slice(desk.indexOf("const commitResults"), desk.indexOf("await deps.beforeScheduledCommit"));
    assert.match(block, /sources_selected = \$\{sources\.length\}/);
    assert.match(block, /sources_analyzed = \$\{analyzedSourceCount\}/);
    assert.match(block, /model_batches_used = \$\{batches\.length\}/);
    assert.match(block, /model_batches_failed = \$\{batchesFailed\}/);
    assert.match(block, /failed_sources = \$\{JSON\.stringify\(failedSources\)/);
  });

  it("writes the accounting columns on total batch failure", () => {
    const block = desk.slice(desk.indexOf("if (!batchResults.length)"), desk.indexOf("const merged = mergeScanBatchResults"));
    assert.match(block, /model_batches_failed = \$\{batchesFailed\}/);
    assert.match(block, /error = \$\{error\}/);
  });

  /*
    The outage record must be written on BOTH commit paths.

    The first version of this fix gated the write on `!deps.scheduledCommit`, so
    only the manual path recorded a failed run. A SCHEDULED scan in which every
    model batch failed threw before anything was persisted: no counts, no
    coverage line, no error row, and the desk could not distinguish "ran and
    everything failed" from "never ran". The assertion below is the one that
    fails if that gate comes back.
  */
  it("records a total batch failure on the scheduled path too, not only manual", () => {
    const block = desk.slice(desk.indexOf("if (!batchResults.length)"), desk.indexOf("const merged = mergeScanBatchResults"));
    /*
      The property: the failure record is written on BOTH paths. The bug was a
      guard of the shape `if (!deps.scheduledCommit) <write>`, which skipped the
      write entirely for a scheduled run. So assert the branch AND its else --
      any guard that writes on only one path loses the else and fails here.

      This assertion is deliberately structural rather than a text match on the
      old bug: an earlier version of this test matched a shape the mutation did
      not produce and passed against the reintroduced bug (verified by
      reintroducing the guard). That is the test theater this suite exists to
      prevent, so the check below binds to the two-branch structure itself.
    */
    const branch = /if \(deps\.scheduledCommit\) \{([\s\S]*?)\} else \{([\s\S]*?)\n {4}\}/.exec(block);
    assert.ok(branch, "the outage write must branch on scheduledCommit with an else");
    assert.match(branch[1], /deps\.scheduledCommit\(recordFailedRun\)/, "scheduled path commits through its transaction");
    assert.match(branch[2], /recordFailedRun\(sql\)/, "manual path writes directly");
    assert.doesNotMatch(
      block,
      /if \(!deps\.scheduledCommit\)/,
      "the write must not be gated on the ABSENCE of a scheduled commit",
    );
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
    assert.match(desk, /for \(const batch of batches\)/);
  });
});
