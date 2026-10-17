import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { headlineForDesk } from "./desk-copy.ts";

/*
  TNB-5: lead 459 showed "(2026-09-30T06:45:38Z)" at the end of its headline on
  the story page. The stamp is shown as the Mountain-time date, or dropped when
  the headline already names that day. The stored headline is not changed.
*/
describe("TNB-5: a raw UTC stamp at the end of a headline reads as a desk date", () => {
  it("shows the Mountain-time date in place of the raw stamp", () => {
    assert.equal(
      headlineForDesk("Council takes up water rates (2026-09-30T06:45:38Z)"),
      "Council takes up water rates (Sept. 30, 2026)",
    );
  });

  it("uses the Mountain day, not the UTC day, for a late-evening stamp", () => {
    assert.equal(
      headlineForDesk("Parks board meets (2026-10-01T03:00:00Z)"),
      "Parks board meets (Sept. 30, 2026)",
    );
  });

  it("drops the stamp when the headline already names the day", () => {
    assert.equal(
      headlineForDesk("Council meets Sept. 30 (2026-09-30T06:45:38Z)"),
      "Council meets Sept. 30",
    );
  });

  it("leaves a headline with no stamp alone", () => {
    assert.equal(headlineForDesk("Council takes up water rates"), "Council takes up water rates");
  });
});
