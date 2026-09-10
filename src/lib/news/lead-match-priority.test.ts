import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatchingLead, matchStrength } from "./lead-match.ts";

test("a possible earlier match cannot hide an exact killed repeat", () => {
  const source_urls = ["https://example.org/road-work"];
  const candidate = {
    headline:
      "Left turns at CO 119 and Hover Street set to close about a year for bridge construction",
    source_urls,
  };
  const possible = {
    id: 40,
    status: "killed",
    headline: "All left turns at CO 119 and Hover to close for about a year during bridge work",
    source_urls,
  };
  const exact = { ...candidate, id: 57, status: "killed" };
  assert.equal(matchStrength(candidate, possible), "possible");
  assert.equal(matchStrength(candidate, exact), "strong");
  assert.equal(findMatchingLead(candidate, [possible, exact]), 57);
  assert.equal(findMatchingLead(candidate, [exact, possible]), 57);
});

test("without a strong match, a killed match retains priority over an open possible match", () => {
  const source_urls = ["https://example.org/agenda"];
  const candidate = {
    headline:
      "Boulder County commissioners hold closed-door executive session on jail expansion, Sept. 5",
    source_urls,
  };
  const earlier = {
    headline:
      "Boulder County commissioners hold closed-door executive session on staff pay raises, Sept. 5",
    source_urls,
  };
  assert.equal(matchStrength(candidate, earlier), "possible");
  assert.equal(
    findMatchingLead(candidate, [
      { ...earlier, id: 2, status: "held" },
      { ...earlier, id: 1, status: "killed" },
    ]),
    1,
  );
});
