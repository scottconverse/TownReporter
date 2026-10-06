import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  freshnessOf,
  selectRotation,
  unmarkedQuietInstitutions,
  type SourcePreference,
} from "./adaptive-source-selection.ts";
import type { SourceHealthFacts } from "./source-inventory.ts";

/*
  THE DAILY ROTATION, pure. What is pinned here is the shape of the answer the
  scheduled pass gives when the accepted pool (201 rows) is larger than the
  budget: the editor's own picks come first, a parked row is deferred rather
  than deleted, the longest-waiting source goes next so nothing starves, and the
  freshness the caller can truthfully print is derived from the same counts.

  THE MUTATIONS this defends against:
   - sort `rest` by anything but longest-waiting and "nothing starves" fails;
   - drop a parked row instead of deferring it and "never a deletion" fails;
   - let a high-priority row jump an editor-selected one and "editor control is
     absolute" fails.
*/

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

function src(over: Partial<SourceHealthFacts> & { id: number }): SourceHealthFacts {
  return {
    url: `https://city.example.gov/source-${over.id}`,
    title: `Source ${over.id}`,
    kind: "official",
    tier: "A",
    status: "accepted",
    ...over,
  };
}

function ago(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

describe("adaptive rotation: editor control comes first", () => {
  it("reads the editor's selected sources before anything else, in their order", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(60) }), src({ id: 2, last_ok_at: ago(1) }), src({ id: 3 })],
      preferences: [
        { sourceId: 2, selected: true },
        { sourceId: 3, selected: true },
      ],
      budget: 2,
      nowMs: NOW,
    });
    assert.deepEqual(
      rotation.read.map((r) => r.sourceId),
      [2, 3],
    );
    assert.ok(rotation.read.every((r) => r.reason === "editor-selected"));
  });

  it("lets a high-priority source outrank an ordinary watch but not a selection", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(30) }), src({ id: 2, last_ok_at: ago(1) }), src({ id: 3, last_ok_at: ago(2) })],
      preferences: [
        { sourceId: 2, highPriority: true },
        { sourceId: 3, selected: true },
      ],
      budget: 3,
      nowMs: NOW,
    });
    assert.deepEqual(
      rotation.read.map((r) => r.sourceId),
      [3, 2, 1],
    );
  });
});

describe("adaptive rotation: deferral is not deletion, and retry is honoured", () => {
  it("defers a parked source with its reason instead of dropping it", () => {
    const rotation = selectRotation({
      sources: [
        src({ id: 1, retry_after: new Date(NOW + 3_600_000).toISOString() }),
        src({ id: 2, blocked_at: "2026-10-04T00:00:00Z" }),
        src({ id: 3, last_ok_at: ago(5) }),
      ],
      budget: 5,
      nowMs: NOW,
    });
    assert.deepEqual(
      rotation.read.map((r) => r.sourceId),
      [3],
    );
    const deferred = new Map(rotation.deferred.map((d) => [d.sourceId, d.reason]));
    assert.equal(deferred.get(1), "parked");
    assert.equal(deferred.get(2), "blocked");
  });

  it("counts the whole pool even though the budget is smaller, so coverage can be told", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(9) }), src({ id: 2, last_ok_at: ago(8) }), src({ id: 3, last_ok_at: ago(7) })],
      budget: 1,
      nowMs: NOW,
    });
    assert.equal(rotation.poolSize, 3);
    assert.equal(rotation.read.length, 1);
    assert.equal(rotation.deferred.length, 2);
    assert.ok(rotation.deferred.every((d) => d.reason === "over-budget"));
  });
});

describe("adaptive rotation: nothing starves", () => {
  it("reads the longest-waiting source first among equals", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(1) }), src({ id: 2, last_ok_at: ago(40) }), src({ id: 3, last_ok_at: ago(20) })],
      budget: 3,
      nowMs: NOW,
    });
    assert.deepEqual(
      rotation.read.map((r) => r.sourceId),
      [2, 3, 1],
    );
    assert.equal(rotation.read[0].reason, "longest-waiting");
  });

  it("reads a never-checked source before one that read yesterday", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(1) }), src({ id: 2 })],
      budget: 2,
      nowMs: NOW,
    });
    assert.equal(rotation.read[0].sourceId, 2);
    assert.equal(rotation.read[0].reason, "never-checked");
  });

  it("is deterministic: the same input twice gives the same order", () => {
    const sources = Array.from({ length: 30 }, (_, i) => src({ id: i + 1, last_ok_at: ago(i) }));
    const a = selectRotation({ sources, budget: 12, nowMs: NOW });
    const b = selectRotation({ sources: [...sources].reverse(), budget: 12, nowMs: NOW });
    assert.deepEqual(a.read.map((r) => r.sourceId), b.read.map((r) => r.sourceId));
  });
});
describe("adaptive rotation: freshness is stated honestly", () => {

  it("reads the stalest source and reports the gap the budget leaves", () => {
    const sources = [
      src({ id: 1, last_ok_at: ago(1) }),
      src({ id: 2, last_ok_at: ago(2) }),
      src({ id: 3, last_ok_at: ago(2) }),
      src({ id: 4, last_ok_at: ago(50) }),
    ];
    const rotation = selectRotation({ sources, budget: 2, nowMs: NOW });
    // The longest-waiting source is read first, so a 50-day-old row is never
    // the one skipped while a fresh row is spent on.
    assert.deepEqual(
      rotation.read.map((r) => r.sourceId),
      [4, 2],
    );
    const fresh = freshnessOf(rotation, sources, NOW);
    assert.equal(fresh.poolSize, 4);
    assert.equal(fresh.readCount, 2);
    assert.equal(fresh.fullPassDays, 2);
    // The stalest source the budget did NOT reach is id 3, two days old.
    assert.equal(fresh.stalestDeferredDays, 2);
  });

  it("names the coverage gap as a list, never a silence", () => {
    const sources = [src({ id: 1, last_ok_at: ago(1) }), src({ id: 2, last_ok_at: ago(2) })];
    const rotation = selectRotation({ sources, budget: 1, nowMs: NOW });
    const fresh = freshnessOf(rotation, sources, NOW);
    assert.deepEqual(fresh.deferredIds, [1]);
  });
});

describe("adaptive rotation: essential quiet institutions are surfaced", () => {
  it("names quiet watch sources with no priority flag", () => {
    const sources = [
      src({ id: 1, url: "https://x.gov/rss.xml", last_ok_at: ago(9) }),
      src({ id: 2, url: "https://x.gov/council/agenda", last_ok_at: ago(9) }),
      src({ id: 3, url: "https://x.gov/budget.pdf", last_ok_at: ago(9) }),
    ];
    const prefs: SourcePreference[] = [{ sourceId: 2, highPriority: true }];
    assert.deepEqual(unmarkedQuietInstitutions(sources, prefs, NOW), [1]);
  });
});

/*
  THE DEADLINE REGRESSION. `isDue` used to read `source.urgency`, a field the
  health row does not define, so `SourcePreference.urgency` was dead and a
  source the editor put a deadline on never sorted as due. These pin the real
  behaviour: a preference deadline that has passed sorts ahead of a
  longer-waiting source, one still in the future does not, and a source with no
  deadline never claims to be due.
*/
describe("adaptive rotation: an editor's deadline is honoured", () => {
  it("reads a past-due source ahead of a much older source with no deadline", () => {
    const rotation = selectRotation({
      sources: [
        src({ id: 1, last_ok_at: ago(80) }), // oldest, no deadline
        src({ id: 2, last_ok_at: ago(1) }), // fresh, but due now
      ],
      preferences: [{ sourceId: 2, urgency: new Date(NOW - 60_000).toISOString() }],
      budget: 1,
      nowMs: NOW,
    });
    assert.equal(rotation.read[0].sourceId, 2);
    assert.equal(rotation.read[0].reason, "due-now");
  });

  it("does not treat a FUTURE deadline as due", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(80) }), src({ id: 2, last_ok_at: ago(1) })],
      preferences: [{ sourceId: 2, urgency: new Date(NOW + 3_600_000).toISOString() }],
      budget: 1,
      nowMs: NOW,
    });
    // The future deadline is not due, so the longest-waiting source still wins.
    assert.equal(rotation.read[0].sourceId, 1);
    assert.equal(rotation.read[0].reason, "longest-waiting");
  });

  it("never calls a source due without a deadline", () => {
    const rotation = selectRotation({
      sources: [src({ id: 1, last_ok_at: ago(3) })],
      budget: 1,
      nowMs: NOW,
    });
    assert.notEqual(rotation.read[0].reason, "due-now");
  });
});
