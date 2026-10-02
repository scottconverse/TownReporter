import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEARCH_COOLDOWN_MAX_MS,
  SEARCH_COOLDOWN_MS,
  clearSearchCooldown,
  clearSearchCooldowns,
  cooldownMsFor,
  cooldownRemainingMs,
  cooldownSkipNote,
  isCoolingDown,
  parseRetryAfter,
  setSearchCooldownClock,
  startSearchCooldown,
} from "./search-cooldown.ts";

/*
  Point 4, as pure fixtures. The clock is injected, so "ten minutes later" is a
  number rather than a sleep.
*/

let now = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  clearSearchCooldowns();
  setSearchCooldownClock(() => now);
});

afterEach(() => {
  clearSearchCooldowns();
  setSearchCooldownClock(null);
});

describe("the cooldown after a provider blocks", () => {
  it("starts at ten minutes by default and stops", () => {
    startSearchCooldown("searchExa");
    assert.equal(cooldownRemainingMs("searchExa"), SEARCH_COOLDOWN_MS);
    assert.equal(isCoolingDown("searchExa"), true);
    now += SEARCH_COOLDOWN_MS + 1;
    assert.equal(isCoolingDown("searchExa"), false);
  });

  it("leaves the other providers alone", () => {
    startSearchCooldown("searchExa");
    assert.equal(isCoolingDown("searchDdg"), false);
  });

  it("honours a Retry-After the provider sent", () => {
    startSearchCooldown("searchExa", { retryAfterMs: 20 * 60_000 });
    now += 18 * 60_000;
    assert.equal(isCoolingDown("searchExa"), true, "still inside the provider's own window");
    now += 3 * 60_000;
    assert.equal(isCoolingDown("searchExa"), false);
  });

  it("caps a Retry-After at half an hour", () => {
    assert.equal(cooldownMsFor(90 * 60_000), SEARCH_COOLDOWN_MAX_MS);
    startSearchCooldown("searchExa", { retryAfterMs: 90 * 60_000 });
    now += SEARCH_COOLDOWN_MAX_MS - 1;
    assert.equal(isCoolingDown("searchExa"), true);
    now += 2;
    assert.equal(isCoolingDown("searchExa"), false);
  });

  it("a provider that answers again clears its own cooldown", () => {
    startSearchCooldown("searchExa");
    clearSearchCooldown("searchExa");
    assert.equal(isCoolingDown("searchExa"), false);
  });

  it("says how long ago the provider was blocked, for the run line", () => {
    startSearchCooldown("searchExa");
    assert.equal(cooldownSkipNote("searchExa"), "blocked just now");
    now += 3 * 60_000 + 30_000;
    assert.equal(cooldownSkipNote("searchExa"), "blocked 3 minutes ago");
    now += SEARCH_COOLDOWN_MS;
    assert.equal(cooldownSkipNote("searchExa"), null, "a note for a provider that is not cooling");
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    assert.equal(parseRetryAfter("120"), 120_000);
  });

  it("reads an HTTP date", () => {
    const at = new Date(now + 90_000).toUTCString();
    assert.equal(parseRetryAfter(at), 90_000);
  });

  it("returns null rather than inventing a cooldown", () => {
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter(""), null);
    assert.equal(parseRetryAfter("soon-ish"), null);
  });
});
