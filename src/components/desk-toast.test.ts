import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_SIGNED_OUT_REASON,
  DESK_TOO_SLOW_REASON,
  DESK_UNREACHABLE_REASON,
  deskErrorReason,
} from "./desk-toast.ts";

/**
 * The words on a failed press (unit FB5, item M8).
 *
 * `deskErrorReason` carried `error.message` through verbatim, on the reasoning
 * that the desk's server functions already answer in sentences an editor can
 * read. They do -- but the failures that happen most often are not the desk
 * answering at all. They are the desk not being up, the connection dropping,
 * and the request being cut off, and for each of those the browser's own text
 * ("Failed to fetch") names nothing the editor can act on and says nothing
 * about whether their press landed.
 *
 * THE MUTATION THAT MATTERS. Returning `raw` instead of the mapped sentence --
 * the shape this function had before -- fails every case in the first
 * describe.
 */

describe("a press that failed on the way to the desk", () => {
  it("says the desk could not be reached, and that nothing changed", () => {
    for (const raw of [
      "TypeError: Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "Network request failed",
    ]) {
      assert.equal(deskErrorReason(new Error(raw)), DESK_UNREACHABLE_REASON, raw);
    }
    assert.match(DESK_UNREACHABLE_REASON, /Nothing was changed/);
  });

  it("says the press may have finished, so reload before pressing again", () => {
    assert.equal(deskErrorReason(new Error("The operation was aborted.")), DESK_TOO_SLOW_REASON);
    assert.equal(deskErrorReason("request timed out"), DESK_TOO_SLOW_REASON);
    assert.equal(deskErrorReason(new Error("Timeout")), DESK_TOO_SLOW_REASON);
    assert.match(DESK_TOO_SLOW_REASON, /reload before pressing again/);
  });

  it("says the editor is signed out or not allowed", () => {
    assert.equal(deskErrorReason(new Error("HTTP 401")), DESK_SIGNED_OUT_REASON);
    assert.equal(deskErrorReason(new Error("Unauthorized")), DESK_SIGNED_OUT_REASON);
    assert.equal(deskErrorReason(new Error("Forbidden")), DESK_SIGNED_OUT_REASON);
    assert.match(DESK_SIGNED_OUT_REASON, /Sign in again/);
  });
});

describe("a press the desk did answer", () => {
  it("carries the desk's own sentence through untouched", () => {
    const own = "This story has no section yet. Pick one and publish again.";
    assert.equal(deskErrorReason(new Error(own)), own);
    assert.equal(deskErrorReason(own), own);
  });

  it("turns a schema dump into a sentence, naming the press", () => {
    const dump = JSON.stringify({
      issues: [{ code: "too_big", maximum: 180, path: ["title"], message: "Too big" }],
    });
    const said = deskErrorReason(new Error(dump), "save the headline");
    assert.match(said, /could not save the headline/);
    assert.doesNotMatch(said, /too_big|"path"|[{}[\]]|maximum/, "the dump was printed at the editor");
  });

  it("turns a bare 500 into a sentence, naming the press", () => {
    const said = deskErrorReason(new Error("Internal Server Error: status code 500"), "publish");
    assert.match(said, /^The desk could not publish just now\./);
    assert.match(said, /Try again/);
  });

  it("still names a thrown value that is not an Error", () => {
    assert.equal(deskErrorReason({ message: "the queue is full" }), "the queue is full");
    assert.equal(deskErrorReason(null), "the desk gave no reason");
    assert.equal(deskErrorReason(new Error("   ")), "the desk gave no reason");
  });

  it("keeps a real refusal ahead of the mapped sentence", () => {
    /*
      `deskActionFailure` composes the caller's lead with this sentence, and the
      composition is asserted where that function lives -- it is alias-importing
      and so cannot be loaded here. See `scripts/fb5-desk-action.test.mjs`,
      "keeps the caller's lead in front of the mapped sentence".
    */
    assert.match(DESK_UNREACHABLE_REASON, /could not be reached/);
  });
});
