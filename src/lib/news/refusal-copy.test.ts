import { test } from "node:test";
import assert from "node:assert/strict";
import { editorFetchError, scanSourceCoverageReason } from "./desk-copy.ts";
import {
  manualScanCoverage,
  updateScanCoverageEntry,
  parseScanSourceCoverage,
} from "./scan-source-coverage.ts";
import { BLOCKED_AFTER_RENDER_MESSAGE } from "./refusal-routes.ts";

test("desk copy preserves browser refusal and scan history keeps the route or gap", () => {
  assert.equal(
    editorFetchError(BLOCKED_AFTER_RENDER_MESSAGE, "https://1.1.1.1/news"),
    BLOCKED_AFTER_RENDER_MESSAGE,
  );
  const initial = manualScanCoverage(
    [{ id: 1, title: "Public source", url: "https://1.1.1.1/news" }],
    1,
  );
  for (const reason of ["Read through a browser.", "Read through its feed."]) {
    const saved = updateScanCoverageEntry(initial, 1, {
      status: "read",
      reason,
      readAt: "2026-10-10T10:00:00Z",
    });
    const [row] = parseScanSourceCoverage(JSON.stringify(saved));
    assert.equal(scanSourceCoverageReason(row), reason);
  }
  const saved = updateScanCoverageEntry(initial, 1, {
    status: "blocked",
    reasonCode: "blocked-after-render",
    reason: BLOCKED_AFTER_RENDER_MESSAGE,
  });
  const [row] = parseScanSourceCoverage(JSON.stringify(saved));
  assert.equal(row.reasonCode, "blocked-after-render");
  assert.equal(scanSourceCoverageReason(row), BLOCKED_AFTER_RENDER_MESSAGE);
});
