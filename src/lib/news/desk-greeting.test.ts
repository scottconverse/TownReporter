import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deskGreeting } from "./desk-greeting.ts";

/**
 * TXA-1 (D280): the front page's greeting reads the paper's clock. The fixed
 * instants below are Denver time in October (UTC-6).
 */
describe("D280: the greeting follows the paper's own hour", () => {
  it("says good morning at 9:00 AM", () => {
    assert.equal(
      deskGreeting(Date.parse("2026-10-24T15:00:00Z"), "America/Denver"),
      "Good morning. Here’s today’s paper.",
    );
  });

  it("says good afternoon at 2:00 PM", () => {
    assert.equal(
      deskGreeting(Date.parse("2026-10-24T20:00:00Z"), "America/Denver"),
      "Good afternoon. Here’s today’s paper.",
    );
  });

  it("says good evening at 7:00 PM", () => {
    assert.equal(
      deskGreeting(Date.parse("2026-10-25T01:00:00Z"), "America/Denver"),
      "Good evening. Here’s today’s paper.",
    );
  });

  it("says good evening at 2:00 AM", () => {
    assert.equal(
      deskGreeting(Date.parse("2026-10-24T08:00:00Z"), "America/Denver"),
      "Good evening. Here’s today’s paper.",
    );
  });

  it("does not throw on a bad time zone name", () => {
    // The fallback is the browser's own hour, so only the shape is asserted.
    assert.match(
      deskGreeting(Date.parse("2026-10-24T15:00:00Z"), "Not/AZone"),
      /^Good (morning|afternoon|evening)\. Here’s today’s paper\.$/,
    );
  });
});
