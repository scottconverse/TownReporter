import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KILL_TOAST_MS } from "./fast-kill.ts";
import {
  addRecentlyKilled,
  mergeRecentlyKilled,
  recentlyKilledActive,
  recentlyKilledForTab,
  removeRecentlyKilled,
} from "./recent-kill.ts";

type Row = { id: number; status: string; headline: string };

const row = (id: number, headline = `Lead ${id}`): Row => ({ id, status: "new", headline });

describe("the killed row's own Undo line", () => {
  it("records a kill at the press and removes it when Undo is pressed", () => {
    const started = addRecentlyKilled(new Map(), row(7), 2, "new", 1_000);
    assert.equal(started.get(7)?.row.headline, "Lead 7");
    assert.equal(started.get(7)?.restore, "new");
    assert.equal(recentlyKilledActive(started.get(7), 1_000 + KILL_TOAST_MS - 1), true);
    assert.equal(recentlyKilledActive(started.get(7), 1_000 + KILL_TOAST_MS), false);

    const undone = removeRecentlyKilled(started, 7);
    assert.equal(undone.has(7), false);
  });

  it("keeps a killed row in the Open page while the message is alive, then lets it leave", () => {
    const before: Row[] = [row(1), row(2), row(3), row(4)];
    const recent = addRecentlyKilled(new Map(), before[1]!, 1, "new", 10_000);
    const optimisticOpenPage = [before[0]!, before[2]!, before[3]!];

    assert.deepEqual(
      mergeRecentlyKilled(optimisticOpenPage, recent, 10_000 + KILL_TOAST_MS - 1).map((r) => r.id),
      [1, 2, 3, 4],
      "the row stays where it was for the strip's eight seconds",
    );
    assert.deepEqual(
      mergeRecentlyKilled(optimisticOpenPage, recent, 10_000 + KILL_TOAST_MS).map((r) => r.id),
      [1, 3, 4],
      "after the deadline the row leaves the Open page as it did before",
    );
  });

  it("restores a bulk kill in the original row order", () => {
    const before: Row[] = [row(1), row(2), row(3), row(4), row(5)];
    let recent = addRecentlyKilled(new Map(), before[1]!, 1, "new", 20_000);
    recent = addRecentlyKilled(recent, before[3]!, 3, "new", 20_000);

    assert.deepEqual(
      mergeRecentlyKilled([before[0]!, before[2]!, before[4]!], recent, 20_001).map((r) => r.id),
      [1, 2, 3, 4, 5],
    );
  });

  it("keeps held kills on the Held tab and open or drafted kills on Open", () => {
    let recent = addRecentlyKilled(new Map(), row(1), 0, "new", 1_000);
    recent = addRecentlyKilled(recent, row(2), 1, "drafted", 1_000);
    recent = addRecentlyKilled(recent, row(3), 2, "held", 1_000);

    assert.deepEqual([...recentlyKilledForTab(recent, "open").keys()], [1, 2]);
    assert.deepEqual([...recentlyKilledForTab(recent, "held").keys()], [3]);
  });

  it("does not duplicate a row that is still in the current page", () => {
    const rows = [row(1), row(2), row(3)];
    const recent = addRecentlyKilled(new Map(), rows[1]!, 1, "held", 30_000);
    assert.deepEqual(mergeRecentlyKilled(rows, recent, 30_001).map((r) => r.id), [1, 2, 3]);
    assert.equal(recent.get(2)?.restore, "held");
  });
});
