import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runningBoxRows } from "./running-head-label.ts";

describe("the nav Running box rows", () => {
  const jobs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it("draws no rows on Today, which already draws each job as a Running now card", () => {
    assert.deepEqual(runningBoxRows("/desk", jobs), []);
    assert.deepEqual(runningBoxRows("/desk/", jobs), []);
  });

  it("keeps up to three rows on every other desk screen", () => {
    assert.deepEqual(runningBoxRows("/desk/drafts", jobs), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.deepEqual(runningBoxRows("/desk/queue", jobs.slice(0, 1)), [{ id: 1 }]);
  });
});
