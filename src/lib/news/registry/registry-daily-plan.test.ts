import { test } from "node:test";
import assert from "node:assert/strict";
import { planDailySourceRotation } from "../daily-scan.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function src(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://city.example.gov/source-${id}`,
    title: `Source ${id}`,
    kind: "official",
    tier: "A",
    status: "accepted",
    ...over,
  };
}

test("every registry source is pinned into the scan even beyond the rotating budget", () => {
  const facts = Array.from({ length: 15 }, (_, index) =>
    src(index + 1, { last_ok_at: ago(index + 1) }),
  );
  const plan = planDailySourceRotation({
    facts,
    selectedSourceIds: [],
    cap: 2,
    // Recently read, so the oldest-first fill would not choose them on its own.
    registrySourceIds: [1, 2],
    nowMs: NOW,
  });
  assert.ok(plan.sourceIds.includes(1), "registry source 1 is read");
  assert.ok(plan.sourceIds.includes(2), "registry source 2 is read");
  assert.equal(plan.registryCount, 2);
  assert.ok(plan.sourceIds.length > plan.budget, "the registry rides on top of the budget");
});

test("a parked registry source is not forced, and is not counted as pinned", () => {
  const plan = planDailySourceRotation({
    facts: [src(1, { retry_after: new Date(NOW + 3_600_000).toISOString() })],
    selectedSourceIds: [],
    cap: 2,
    registrySourceIds: [1],
    nowMs: NOW,
  });
  assert.equal(plan.sourceIds.includes(1), false);
  assert.equal(plan.registryCount, 0);
  assert.ok(plan.deferredIds.includes(1));
});
