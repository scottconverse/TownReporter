import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_NOT_ACCEPTED_REASON,
  DESK_SIGNED_OUT_REASON,
  DESK_TOO_SLOW_REASON,
  DESK_UNREACHABLE_REASON,
  deskErrorHasMessage,
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
    assert.equal(deskErrorReason({ message: "The queue is full." }), "The queue is full.");
    assert.equal(deskErrorReason(null), "the desk gave no reason");
    assert.equal(deskErrorReason(new Error("   ")), "the desk gave no reason");
  });

  /*
    F05 of the 2026-11-19 walk: a guard's raw reason ("blocked by walker") was
    printed after "Could not change that lead. " on the Queue and "Could not
    start the scan. " on Server. It is not a sentence and it is not the desk's,
    so the editor gets plain words and the raw text goes to the console.
  */
  it("turns a raw exception fragment into plain words and logs the raw text", () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      assert.equal(deskErrorReason(new Error("blocked by walker")), DESK_NOT_ACCEPTED_REASON);
      assert.equal(deskErrorReason("blocked by walker"), DESK_NOT_ACCEPTED_REASON);
      assert.equal(deskErrorReason(new Error("Cannot destructure property 'ok' of undefined")), DESK_NOT_ACCEPTED_REASON);
    } finally {
      console.error = original;
    }
    assert.equal(logged.length, 3, "the raw text was not kept for the console");
    assert.match(String(logged[0]?.[1]), /blocked by walker/);
  });

  /*
    The other half of F05: the first cut of the fix hid every message without a
    final period, which is most of what the server says to an editor. A real
    refusal keeps its own words, with a full stop or without.
  */
  it("carries a real refusal through, with or without a full stop", () => {
    for (const own of [
      "Lead not found",
      "Investigation not found",
      "Codex usage limit reached",
      "Empty model response",
      "No voice file",
      "Links to look at must start with http:// or https://",
      "The queue is full.",
    ]) {
      assert.equal(deskErrorReason(new Error(own)), own, own);
      assert.equal(deskErrorReason(own), own, own);
    }
  });

  it("turns code and runtime errors into plain words", () => {
    const original = console.error;
    console.error = () => {};
    try {
      for (const raw of [
        "blocked by walker",
        "Cannot destructure property 'ok' of undefined",
        "SEARCH_BLOCKED",
        "x is not a function",
      ]) {
        assert.equal(deskErrorReason(new Error(raw)), DESK_NOT_ACCEPTED_REASON, raw);
      }
    } finally {
      console.error = original;
    }
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

describe("an error that carries no message", () => {
  it("is reported as carrying none, so the caller can show its own sentence", () => {
    for (const empty of [undefined, null, "", "   ", new Error(""), new Error("  "), {}]) {
      assert.equal(deskErrorHasMessage(empty), false, String(empty));
    }
  });

  it("is reported as carrying one when there is text to read", () => {
    for (const carrying of [new Error("That row is gone."), "That row is gone.", "blocked by walker"]) {
      assert.equal(deskErrorHasMessage(carrying), true, String(carrying));
    }
  });
});
