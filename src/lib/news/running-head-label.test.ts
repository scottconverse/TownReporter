import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runningBoxRows, runningHeadLabel } from "./running-head-label.ts";

/*
  D1 (Oct 24 walk): on Today the nav's "Running · 1" box listed the same draft
  twice -- once as the box's own row and once as Today's "Running now" card.
  The box keeps its count and gives its rows to the page there; everywhere else
  the box is the only place an open job is drawn, so it keeps them.

  The rule is a pure decision over a pathname and rows, so it is checked here
  rather than in a browser: the failure was one job drawn twice, and that is a
  question about which surface owns the row, not about markup.
*/

/** The minimum a row has to be to be counted and drawn: `id` keys the card. */
type Row = { id: number };

const jobs: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe("which rows the nav Running box draws", () => {
  it("draws no rows on Today, where the page already draws each job once", () => {
    assert.deepEqual(runningBoxRows("/desk", jobs), []);
    assert.deepEqual(runningBoxRows("/desk/", jobs), [], "a trailing slash is still Today");
  });

  it("draws the job on every other screen, where the box is the only place", () => {
    assert.deepEqual(runningBoxRows("/desk/drafts", jobs), jobs.slice(0, 3));
    assert.deepEqual(runningBoxRows("/desk/queue", jobs), jobs.slice(0, 3));
    // A story page is not Today, even though its path starts the same way.
    assert.deepEqual(runningBoxRows("/desk/story/462", jobs), jobs.slice(0, 3));
  });

  it("keeps the box's three-row limit", () => {
    assert.equal(runningBoxRows("/desk/queue", jobs).length, 3);
  });

  it("still counts every open job in the heading", () => {
    /*
      The heading is what the box keeps on Today: "one row per job" is about
      rows, not about losing the count.
    */
    assert.equal(runningHeadLabel([{ status: "running" }, { status: "queued" }]), "Running · 1 · 1 queued");
  });
});
