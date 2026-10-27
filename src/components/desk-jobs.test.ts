import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { jobIdsDrawnOutside, navRunningRows } from "./desk-jobs.ts";

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

/**
 * G24-D1-2: Drafts, Server operations, Dark Desk and the story page draw their
 * own card for a job. The box leaves that one job out and keeps the others.
 */
describe("the nav's Running box leaves out a job the page already draws", () => {
  const open = [
    { id: 335, kind: "draft" },
    { id: 336, kind: "scan" },
    { id: 337, kind: "ocr" },
    { id: 338, kind: "draft" },
  ];

  it("skips the job the page draws and still shows the other running jobs", () => {
    assert.deepEqual(navRunningRows(open, "/desk/drafts", new Set([335])).map((j) => j.id), [336, 337, 338]);
  });

  it("fills the three rows from the jobs the page is not drawing", () => {
    assert.deepEqual(navRunningRows(open, "/desk/ops", new Set([336, 337])).map((j) => j.id), [335, 338]);
  });

  it("a page that draws no card leaves the box as it was", () => {
    assert.deepEqual(navRunningRows(open, "/desk/queue").map((j) => j.id), [335, 336, 337]);
  });

  it("reads the page's own cards from the document and ignores the nav's", () => {
    const { document } = parseHTML(`
      <aside><div class="astra-running">
        <div class="job-card compact" data-job-id="335"></div>
        <div class="job-card compact" data-job-id="336"></div>
      </div></aside>
      <main>
        <div class="job-card" data-job-id="335"></div>
        <div class="job-card"></div>
      </main>`);
    const drawn = jobIdsDrawnOutside(document as never);
    assert.deepEqual([...drawn], ["335"]);
    /* The ids in the document are text; the query's ids are numbers. */
    assert.deepEqual(navRunningRows(open, "/desk/drafts", drawn).map((j) => j.id), [336, 337, 338]);
  });
});
