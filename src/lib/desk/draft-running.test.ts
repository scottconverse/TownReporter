import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { showDraftRunning } from "./draft-running.ts";

/**
 * TMA-6: a killed lead's writer panel said "A draft is running" behind the
 * "Before you continue" box, while the press's call was still open and no job
 * existed. The text now waits for the server's answer.
 *
 * THE MUTATION THAT MATTERS. Showing the text on `waiting` alone (the old
 * display) fails "says nothing while the press's call is still open".
 */
describe("the draft-running text (TMA-6)", () => {
  it("says nothing while the press's call is still open", () => {
    assert.equal(showDraftRunning({ waiting: true, awaitingAck: true }), false);
  });

  it("says it once the server has answered with a job", () => {
    assert.equal(showDraftRunning({ waiting: true, awaitingAck: false }), true);
  });

  it("says nothing when no draft is waiting", () => {
    assert.equal(showDraftRunning({ waiting: false, awaitingAck: false }), false);
  });
});
