import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { darkFilePickIsFinal, darkFileToOpen } from "./dark-rail.ts";

const oldList = [
  { id: 9, updated_at: "2026-10-27T12:00:00Z" },
  { id: 10, updated_at: "2026-10-28T12:00:00Z" },
];

describe("Dark Desk automatic file pick", () => {
  it("finalizes a requested file already in the list", () => {
    assert.equal(darkFilePickIsFinal(oldList, 9, false), true);
  });

  it("waits when a requested file may still arrive from the post-mount fetch", () => {
    // Reproduce the stale-list fallback: row 11 was just written, but the cache
    // still ends at 10, so choosing now would open the wrong file.
    assert.equal(darkFileToOpen(oldList, 9, 11), 9);
    assert.equal(darkFilePickIsFinal(oldList, 11, false), false);
  });

  it("falls back after a fresh list proves the requested file is absent", () => {
    assert.equal(darkFilePickIsFinal(oldList, 11, true), true);
    assert.equal(darkFileToOpen(oldList, 9, 11), 9);
  });

  it("waits for a post-mount list when the cache is empty", () => {
    assert.equal(darkFilePickIsFinal([], null, false), false);
    assert.equal(darkFilePickIsFinal([], null, true), true);
  });

  it("does not wait when no handoff file was requested", () => {
    assert.equal(darkFilePickIsFinal(oldList, null, false), true);
    assert.equal(darkFileToOpen(oldList, 99, null), 10);
  });
});
