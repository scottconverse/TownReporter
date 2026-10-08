// guards: unrelated stories can be linked as duplicates.
import { it } from "node:test";
import assert from "node:assert/strict";
import { confirmBeforeKillingDuplicate } from "./duplicate-review.ts";
import { matchStrength } from "./lead-match.ts";

it("does not link different subjects on the same amount", () => {
  assert.equal(matchStrength(
    { headline: "Mira Novak Receives $12 Million for a City Park", topic: "parks" },
    { headline: "Mira Novak Receives $12 Million for a New Housing Project", topic: "housing" },
    { city: "", state: "", county: "Boulder County" },
  ), null);
});

it("still matches the 2027 budget follow-up to the earlier budget lead", () => {
  assert.notEqual(matchStrength(
    {
      headline: "Longmont's Proposed 2027 Budget: $547.5M Operating Plan, With Modifications Hinged to Nov. 3 Tax Votes",
      source_urls: ["https://longmontcolorado.gov/wp-content/uploads/2026/09/BudgetPresentationCityManager_updated.pdf"],
    },
    {
      headline: "Longmont begins review of proposed $547.5 million 2027 operating budget",
      source_urls: ["https://longmontcolorado.gov/wp-content/uploads/2026/09/BudgetPresentationCityManager_updated.pdf"],
    },
    { city: "Longmont", state: "Colorado", county: "Boulder" },
  ), null);
});

it("requires confirmation before killing a duplicate", () => {
  let kills = 0;
  assert.equal(confirmBeforeKillingDuplicate(() => false, "Confirm?", () => kills++), false);
  assert.equal(kills, 0);
  assert.equal(confirmBeforeKillingDuplicate(() => true, "Confirm?", () => kills++), true);
  assert.equal(kills, 1);
});
