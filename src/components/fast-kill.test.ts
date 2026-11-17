import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KILL_TOAST_MS, leadStatusToastName, leadToastId, UNDONE_TOAST_ID } from "./fast-kill.ts";
import { DESK_TOAST_SMALL_MS } from "./desk-toast.ts";

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
    assert.equal(KILL_TOAST_MS, 3_000);
    // The small kill strip is chosen by this length; the two must stay equal.
    assert.equal(DESK_TOAST_SMALL_MS, KILL_TOAST_MS);
  });
});
