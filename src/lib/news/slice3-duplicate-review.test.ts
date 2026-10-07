// guards: an unrelated story could be linked or killed as a duplicate.
import { it } from "node:test";
import assert from "node:assert/strict";
import { confirmBeforeKillingDuplicate } from "./duplicate-review.ts";
import { explainPairMatch, pairMatchRoute, pairMatches } from "./lead-match.ts";

it("keeps weak duplicate matches grounded in the story and confirms a kill", () => {
  const place = { city: "", state: "", county: "Boulder County" };
  const falseLinks = [
    {
      current: {
        id: 435,
        headline: "Longmont's Proposed 2027 Budget: $547.5M Operating Plan, With Modifications Hinged to Nov. 3 Tax Votes",
        urls: ["https://longmontcolorado.gov/wp-content/uploads/2026/09/BudgetPresentationCityManager_updated.pdf"],
        topic: "budget",
      },
      prior: {
        id: 332,
        headline: "St. Vrain Valley Schools Opens 2027–28 School Choice Window Dec. 1–15",
        urls: ["https://www.svvsd.org/"],
        topic: "schools",
      },
    },
    {
      current: {
        id: 128,
        headline: "Boulder County fire restrictions reportedly lifted",
        urls: ["https://www.timescall.com/", "https://bouldercounty.gov/"],
        topic: "infrastructure",
      },
      prior: {
        id: 126,
        headline: "Boulder County permit applicants are reportedly receiving phishing emails",
        urls: ["https://www.timescall.com/", "https://bouldercounty.gov/"],
        topic: "planning",
      },
    },
    {
      current: {
        id: 129,
        headline: "Authorities reportedly investigating more than a mile of cut fencing on Boulder County open space",
        urls: ["https://www.timescall.com/", "https://www.longmontleader.com/local-news", "https://bouldercounty.gov/"],
        topic: "infrastructure",
      },
      prior: {
        id: 126,
        headline: "Boulder County permit applicants are reportedly receiving phishing emails",
        urls: ["https://www.timescall.com/", "https://bouldercounty.gov/"],
        topic: "planning",
      },
    },
  ];

  for (const { current, prior } of falseLinks) {
    const sections = { candidateTopic: current.topic, leadTopic: prior.topic };
    assert.equal(pairMatches(current.headline, current.urls, prior.headline, prior.urls, place, sections), false);
    assert.equal(pairMatchRoute(current.headline, current.urls, prior.headline, prior.urls, place, sections), null);
  }

  const amountOnlyCurrent = "Mira Novak Receives $12 Million for a City Park";
  const amountOnlyPrior = "Mira Novak Receives $12 Million for a New Housing Project";
  assert.equal(
    pairMatchRoute(amountOnlyCurrent, [], amountOnlyPrior, [], place, {
      candidateTopic: "parks",
      leadTopic: "housing",
    }),
    null,
  );

  const realRepeatCurrent = "Longmont Library Closed Oct. 6 for All-Staff Training Day";
  const realRepeatPrior = "Longmont Library Closed All Day Oct. 6 for Staff Training";
  const realRepeatUrls = ["https://longmontcolorado.gov/news/?feed=rss2"];
  const sections = { candidateTopic: "arts-culture", leadTopic: "arts-culture" };
  const explanation = explainPairMatch(
    realRepeatCurrent,
    realRepeatUrls,
    realRepeatPrior,
    realRepeatUrls,
    place,
    sections,
  );
  assert.equal(
    pairMatches(realRepeatCurrent, realRepeatUrls, realRepeatPrior, realRepeatUrls, place, sections),
    true,
  );
  assert.equal(explanation?.route, "headline-only");
  assert.ok(explanation?.sharedName);
  assert.ok(explanation?.reason);

  let killCalls = 0;
  assert.equal(
    confirmBeforeKillingDuplicate(() => false, "Confirm?", () => {
      killCalls += 1;
    }),
    false,
  );
  assert.equal(killCalls, 0);
  assert.equal(
    confirmBeforeKillingDuplicate(() => true, "Confirm?", () => {
      killCalls += 1;
    }),
    true,
  );
  assert.equal(killCalls, 1);
});
