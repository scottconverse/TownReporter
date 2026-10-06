import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { observationForTouch } from "./source-observations.server.ts";

/*
  The one place that decides WHICH dated observation a scan attempt leaves
  behind. desk.ts calls this at each of its three touch sites (a clean read, a
  refusal, a parked row) and trusts its answer, so the vocabulary is pinned here
  rather than at the call sites.

  The distinctions that matter and used to be invisible on the screen:
    - a clean read that changed nothing is "quiet", NOT "changed" (the hash
      comparison is the caller fact, passed in as changedByHash);
    - a site asking us to wait is "asked-to-wait", NOT a failure;
    - a page that returned with nothing to read is an "extraction-failure",
      NOT a "retrieval-error" (they send the editor to different fixes).
*/

describe("observationForTouch", () => {
  it("calls a clean read that changed nothing quiet", () => {
    const v = observationForTouch({ outcome: "read", changedByHash: false });
    assert.equal(v.kind, "quiet");
  });

  it("calls a clean read with a new hash changed", () => {
    const v = observationForTouch({ outcome: "read", changedByHash: true });
    assert.equal(v.kind, "changed");
  });

  it("treats a request to wait as asked-to-wait, not a failure", () => {
    const v = observationForTouch({ outcome: "wait", retry_after_note: "Come back in an hour." });
    assert.equal(v.kind, "asked-to-wait");
    assert.equal(v.note, "Come back in an hour.");
  });

  it("treats a refusal as blocked", () => {
    const v = observationForTouch({ outcome: "blocked", last_error: "403 forbidden" });
    assert.equal(v.kind, "blocked");
  });

  it("splits an ordinary failure into extraction vs retrieval by the message", () => {
    const extraction = observationForTouch({ outcome: "failed", last_error: "page had almost no text" });
    assert.equal(extraction.kind, "extraction-failure");
    const retrieval = observationForTouch({ outcome: "failed", last_error: "connection reset" });
    assert.equal(retrieval.kind, "retrieval-error");
  });

  it("treats a skipped pass as asked-to-wait", () => {
    const v = observationForTouch({ outcome: "skipped" });
    assert.equal(v.kind, "asked-to-wait");
  });
});
