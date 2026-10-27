import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftPillText } from "./draft-pills.ts";

describe("the Drafts pills", () => {
  it("show no count before the list has loaded", () => {
    assert.equal(draftPillText("All", undefined, "all"), "All");
    assert.equal(draftPillText("All", null, "all"), "All");
  });
  it("show the count once it is known, including a real zero", () => {
    assert.equal(draftPillText("All", { all: 1 }, "all"), "All · 1");
    assert.equal(draftPillText("Ready", { all: 1, ready: 0 }, "ready"), "Ready · 0");
  });
  it("show no count for a key the list did not count", () => {
    assert.equal(draftPillText("Ready", { all: 1 }, "ready"), "Ready");
  });
});
