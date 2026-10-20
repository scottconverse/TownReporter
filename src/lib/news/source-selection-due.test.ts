import { it } from "node:test";
import assert from "node:assert/strict";
import { selectRotation } from "./adaptive-source-selection.ts";
import { scheduledScanCoverage } from "./scan-source-coverage.ts";
import { scanSourceCoverageReason } from "./desk-copy.ts";
import { yieldScore } from "./source-yield.ts";

/* Dynamic sources unit 5 (D169), spec 5e and 10a.3. */

const now = Date.parse("2026-10-20T08:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const src = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  url: `https://s${id}.example.test/`,
  title: `Source ${id}`,
  status: "accepted",
  last_ok_at: hoursAgo(24),
  last_fetched_at: hoursAgo(24),
  ...extra,
});

it("reads starved sources first, then due sources by score, and defers the ones not yet due", () => {
  const rotation = selectRotation({
    nowMs: now,
    budget: 10,
    sources: [
      src(1, { next_due_at: hoursAgo(-12) }), // not due for 12 hours
      src(2, { next_due_at: hoursAgo(10), yield_score: 0.1 }),
      src(3, { next_due_at: hoursAgo(10), yield_score: 0.9 }),
      src(4, { last_ok_at: hoursAgo(24 * 8), next_due_at: hoursAgo(-48) }), // starved beats not-due
      src(5, { next_due_at: hoursAgo(-12) }), // not due, but the editor selected it
      src(6, { next_due_at: hoursAgo(-12) }), // not due, but high priority
    ],
    preferences: [
      { sourceId: 5, selected: true },
      { sourceId: 6, highPriority: true },
    ],
  });
  assert.deepEqual(
    rotation.read.map((r) => [r.sourceId, r.reason]),
    [
      [5, "editor-selected"],
      [6, "high-priority"],
      [4, "longest-waiting"],
      [3, "due-by-yield"],
      [2, "due-by-yield"],
    ],
  );
  assert.deepEqual(rotation.deferred, [{ sourceId: 1, reason: "not-due" }]);
});

it("tells the editor a skipped source was not due yet", () => {
  const [entry] = scheduledScanCoverage(
    [{ id: 1, title: "Agendas", url: "https://s1.example.test/", kind: "page", tier: "B", last_ok_at: null, retry_after_note: null }],
    [],
    [{ sourceId: 1, reason: "not-due" }],
  );
  assert.equal(entry!.reasonCode, "not-due");
  assert.equal(scanSourceCoverageReason(entry!), "Not due yet. This source is read on its own schedule.");
});

it("scores a source only after 3 reads", () => {
  const row = { source_id: 1, reads_90: 4, leads_per_read: 0.5, published_per_read: 0.25, bad_source_kills_90: 1 };
  assert.equal(yieldScore({ ...row, reads_90: 2 }), null);
  assert.equal(yieldScore(row), 0.7 * 0.5 + 0.9 * 0.25 - 1 / 4);
});
