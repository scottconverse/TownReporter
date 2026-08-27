import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatShortDate } from "./paper.ts";

describe("Longmont dates", () => {
  it("prints the masthead in America/Denver, not UTC", () => {
    // 8:10pm Wednesday MDT is already Thursday in UTC.
    assert.equal(formatDate("2026-08-27T02:10:00.000Z"), "Wednesday, August 26, 2026");
  });

  it("keeps short dates and datetimes on Mountain Time", () => {
    assert.equal(formatShortDate("2026-08-27T02:10:00.000Z"), "Aug 26, 2026");
    assert.match(formatDateTime("2026-08-27T02:10:00.000Z"), /Aug 26, 2026, 8:10 PM/);
  });
});
