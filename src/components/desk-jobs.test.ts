import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { navRunningRows } from "./desk-jobs.ts";

/**
 * D1: "Running · 1" with two rows for one job on /desk.
 *
 * Today draws each open job in its "Running now" section (with the story's
 * name, "Open your story" and "Cancel"). The nav's Running box drew the same
 * job again above it. The box's row selection is the one thing that decides
 * whether a page shows a job twice, so it is tested here as data.
 *
 * Mutation that matters: deleting the `/desk` branch in `navRunningRows` puts
 * the duplicate row back, and the first case fails.
 */
describe("the nav's Running box rows", () => {
  const open = [
    { id: 335, kind: "draft" },
    { id: 336, kind: "scan" },
  ];

  it("draws no job rows on Today, which draws every open job itself", () => {
    assert.deepEqual(navRunningRows(open, "/desk"), []);
    assert.deepEqual(navRunningRows(open, "/desk/"), []);
  });

  it("keeps the rows on every other desk page", () => {
    assert.deepEqual(navRunningRows(open, "/desk/queue"), open);
    assert.deepEqual(navRunningRows(open, "/desk/drafts"), open);
  });

  it("draws at most three rows, as the box always has", () => {
    const four = [1, 2, 3, 4].map((id) => ({ id, kind: "draft" }));
    assert.equal(navRunningRows(four, "/desk/story/462").length, 3);
  });
});
