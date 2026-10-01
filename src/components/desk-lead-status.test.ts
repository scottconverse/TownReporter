import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { patchLeadsData, shiftTabCounts, statusIn } from "./desk-lead-status.ts";

/**
 * The optimistic row, as a pure rule (unit FB6, item 2).
 *
 * README "Interactions & behavior", State: "optimistic Held/Killed with Undo
 * until the server confirms". Two things have to be true the instant an editor
 * presses Hold, and neither of them is React's business:
 *
 *   - the lead reads Held in EVERY list the screen is holding, not just the one
 *     the press happened on. Today holds `listLeads()` as a bare array; the
 *     Queue holds a windowed page `{rows, total, counts}` under the same
 *     `["leads"]` prefix. One cache patched, the other not, is the same row
 *     saying two things on two screens.
 *   - the Queue's tab COUNTS move with it. A lead that leaves "Open" while the
 *     Open pill still counts it is the defect the owner reported (7a) one line
 *     up from the row.
 *
 * The `optimistic`/`rollback` pair itself is exercised against a real React
 * tree and a real query client in `scripts/fb6-optimistic-rollback.test.mjs`;
 * this file is the arithmetic under it.
 *
 * THE MUTATIONS THAT MATTER. Returning `data` unpatched fails every case in the
 * first describe; dropping the counts branch fails "moves the tab numbers";
 * counting `new` out of `open` instead of out of the lead's previous tab fails
 * the Undo cases.
 */

const page = (rows: { id: number; status: string }[], counts: Record<string, number>) => ({
  rows,
  total: rows.length,
  counts,
});

describe("patching one lead's status into a cached list", () => {
  it("moves the lead and leaves every other row alone", () => {
    const rows = [
      { id: 1, headline: "A", status: "new" },
      { id: 2, headline: "B", status: "new" },
    ];
    const out = patchLeadsData(rows, 2, "held", "new") as typeof rows;
    assert.equal(out[0]!.status, "new");
    assert.equal(out[1]!.status, "held");
    assert.equal(out[1]!.headline, "B", "the row is moved, not replaced");
  });

  it("patches Today's bare array and the Queue's windowed page the same way", () => {
    const array = patchLeadsData([{ id: 7, status: "new" }], 7, "killed", "new");
    assert.deepEqual(array, [{ id: 7, status: "killed" }]);

    const windowed = patchLeadsData(
      page([{ id: 7, status: "new" }], { open: 1, held: 0, killed: 0, all: 1 }),
      7,
      "killed",
      "new",
    ) as { rows: { status: string }[] };
    assert.equal(windowed.rows[0]!.status, "killed");
  });

  it("returns a shape it does not recognise untouched", () => {
    // A cache under the `["leads"]` prefix that is neither shape has no opinion
    // about a status, and inventing rows in it would be worse than doing nothing.
    assert.deepEqual(patchLeadsData({ nope: 1 }, 1, "held", "new"), { nope: 1 });
    assert.deepEqual(patchLeadsData(null, 1, "held", "new"), null);
    assert.deepEqual(patchLeadsData(undefined, 1, "held", "new"), undefined);
    assert.equal(patchLeadsData("leads", 1, "held", "new"), "leads");
  });

  it("does not invent a row for a lead the cache has never held", () => {
    const rows = [{ id: 1, status: "new" }];
    assert.deepEqual(patchLeadsData(rows, 99, "held", undefined), rows);
  });
});

describe("the Queue's tab numbers move with the row", () => {
  const counts = { open: 3, held: 1, killed: 2, all: 6 };

  it("takes a held lead out of Open and into Held", () => {
    const out = patchLeadsData(
      page([{ id: 1, status: "new" }], counts),
      1,
      "held",
      "new",
    ) as { counts: typeof counts };
    assert.equal(out.counts.open, 2);
    assert.equal(out.counts.held, 2);
    assert.equal(out.counts.killed, 2, "no other tab moves");
    assert.equal(out.counts.all, 6, "All is every lead the newsroom holds");
  });

  it("is what the owner could see was wrong (7a): a held lead is not open work", () => {
    /*
      The report: "Held leads appear under the Open filter/count on Today/Queue
      -- they must not." `openLeads` no longer counts them, and this is the same
      rule applied a moment early, so the count is right during the optimistic
      window too rather than only after the refetch.
    */
    const out = patchLeadsData(page([{ id: 1, status: "new" }], counts), 1, "held", "new") as {
      counts: typeof counts;
    };
    assert.equal(out.counts.open, 3 - 1);
  });

  it("brings an Undo back OUT of the tab the lead was actually in", () => {
    const fromHeld = patchLeadsData(
      page([{ id: 1, status: "held" }], counts),
      1,
      "new",
      "held",
    ) as { counts: typeof counts };
    assert.equal(fromHeld.counts.held, 0);
    assert.equal(fromHeld.counts.open, 4);

    const fromKilled = patchLeadsData(
      page([{ id: 1, status: "killed" }], counts),
      1,
      "new",
      "killed",
    ) as { counts: typeof counts };
    assert.equal(fromKilled.counts.killed, 1);
    assert.equal(fromKilled.counts.open, 4);
  });

  it("does not move a count when nothing changed", () => {
    // Pressing Hold twice, or an Undo on a lead that was never moved.
    const out = patchLeadsData(page([{ id: 1, status: "held" }], counts), 1, "held", "held") as {
      counts: typeof counts;
    };
    assert.deepEqual(out.counts, counts);
  });

  it("never counts below zero on a page whose counts have gone stale", () => {
    // The page was fetched before the press; its counts can already be short.
    const stale = { open: 0, held: 0, killed: 0, all: 0 };
    const out = patchLeadsData(page([{ id: 1, status: "new" }], stale), 1, "held", "new") as {
      counts: typeof stale;
    };
    assert.equal(out.counts.open, 0);
    assert.equal(out.counts.held, 1);
  });
});

describe("shiftTabCounts", () => {
  it("moves one between two tabs and leaves the rest", () => {
    assert.deepEqual(shiftTabCounts({ open: 2, held: 1, killed: 0, all: 3 }, "open", "held"), {
      open: 1,
      held: 2,
      killed: 0,
      all: 3,
    });
  });

  it("ignores a tab this page does not carry", () => {
    /*
      `printed` (the Queue's "≈ Printed" tab) is a duplicate match against the
      paper rather than a status, so it is not one of the four numbers this
      page holds -- and a move that named it must not invent or drop a count.
      The cast is the point of the case: the type says those are the only keys,
      and this asks what happens if a cached page ever carries one that is not.
    */
    assert.deepEqual(
      shiftTabCounts({ open: 2 }, "printed" as "open", "open"),
      { open: 3 },
    );
  });
});

describe("statusIn", () => {
  it("reads a lead's status out of either cached shape", () => {
    assert.equal(statusIn([{ id: 4, status: "held" }], 4), "held");
    assert.equal(statusIn(page([{ id: 4, status: "killed" }], {}), 4), "killed");
    assert.equal(statusIn([{ id: 4, status: "held" }], 5), undefined);
    assert.equal(statusIn({}, 4), undefined);
  });
});
