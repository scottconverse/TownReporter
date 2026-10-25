import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { holdsFirstPaint } from "./first-paint.ts";

/**
 * D2: the Drafts count is on the first paint after a reload.
 *
 * The desk gate holds the first paint while the nav's count is pending, so the
 * shell mounts with the number. The reads below are the shapes TanStack Query
 * reports: `isPending` is true only before the first answer, and a failed read
 * is `isError` with `isPending` false.
 *
 * Mutation that matters: returning false while the count is pending lets the
 * shell mount without the number again (the first case fails), and treating a
 * failed count as pending holds the desk on its opening screen (the last case).
 */
describe("the desk gate's first paint", () => {
  it("is held while the Drafts count has not answered yet", () => {
    assert.equal(holdsFirstPaint({ isPending: true }), true);
  });

  it("is held by any read that has not answered, whatever the others say", () => {
    assert.equal(holdsFirstPaint({ isPending: false }, { isPending: true }), true);
  });

  it("is released once every read has answered with data", () => {
    assert.equal(holdsFirstPaint({ isPending: false }, { isPending: false }), false);
  });

  it("is released by a count that failed, so a broken count cannot hold the desk shut", () => {
    assert.equal(holdsFirstPaint({ isPending: false }), false);
  });
});
