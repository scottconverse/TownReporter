/*
  Auditor finding F12: the first-run time zone box was pre-filled
  America/Denver (the shipped Longmont constant) beside an America/New_York
  example. The pure rule behind the fix: keep a zone this runtime accepts,
  answer UTC for anything else. The browser call itself is not tested here --
  it reads the machine the test runs on -- but the function it delegates to
  is exactly what is pinned below.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { browserTimeZone, resolveDefaultTimeZone } from "./timezone.ts";

describe("resolveDefaultTimeZone", () => {
  it("keeps a valid IANA zone", () => {
    assert.equal(resolveDefaultTimeZone("America/New_York"), "America/New_York");
    assert.equal(resolveDefaultTimeZone("Europe/London"), "Europe/London");
    assert.equal(resolveDefaultTimeZone("UTC"), "UTC");
  });

  it("trims before deciding, so a padded zone is still the zone", () => {
    assert.equal(resolveDefaultTimeZone("  America/Chicago  "), "America/Chicago");
  });

  it("answers UTC for a zone this runtime does not know", () => {
    assert.equal(resolveDefaultTimeZone("Mars/Olympus_Mons"), "UTC");
    assert.equal(resolveDefaultTimeZone("America/Not_A_City"), "UTC");
  });

  it("answers UTC for nothing at all -- never a guessed region", () => {
    assert.equal(resolveDefaultTimeZone(""), "UTC");
    assert.equal(resolveDefaultTimeZone("   "), "UTC");
    assert.equal(resolveDefaultTimeZone(null), "UTC");
    assert.equal(resolveDefaultTimeZone(undefined), "UTC");
  });
});

describe("browserTimeZone", () => {
  it("always answers a zone this runtime accepts (never the shipped default)", () => {
    // Under node this is the runner's zone or UTC, depending on the machine.
    // Either way it must survive its own validator, and it must never be the
    // hard-coded Longmont constant by construction.
    const zone = browserTimeZone();
    assert.equal(resolveDefaultTimeZone(zone), zone);
    assert.notEqual(zone, "");
  });
});
