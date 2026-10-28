import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KILL_TOAST_MS, leadStatusToastName, leadToastId, UNDONE_TOAST_ID } from "./fast-kill.ts";

describe("TNB-3 — a Queue toast is named so that Undo replaces it", () => {
  it("a hold and a kill on one lead share the lead's card, so the Undo that answers either one replaces it", () => {
    assert.equal(leadStatusToastName({ id: 441, status: "held" }), leadToastId(441));
    assert.equal(leadStatusToastName({ id: 441, status: "killed" }), leadToastId(441));
    assert.equal(leadStatusToastName({ id: 441, status: "new" }), undefined, "other statuses stay unnamed, as before");
  });

  it("every 'Undone' card is raised under one name that no lead's card can take, so an Undone never swaps out a kill or hold card", () => {
    for (let id = 1; id <= 1000; id++) assert.notEqual(UNDONE_TOAST_ID, leadToastId(id), `lead ${id}`);
  });
});


describe("the kill Undo strip", () => {
  it("stays long enough to reach Undo without waiting on a reason question", () => {
    assert.equal(KILL_TOAST_MS, 8_000);
  });
});
