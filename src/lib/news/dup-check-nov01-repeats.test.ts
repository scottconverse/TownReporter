import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDupPairs,
  parseSameStoryReply,
  printedPairKey,
  type SameStoryPromptData,
} from "./dup-check.ts";

/*
 * Nov 1 2026, dev run 107 on the Oct 31 copy (findings G01-DUP-1, G01-DUP-2).
 *
 * G01-DUP-1: lead 974 "OUR Center tightens residency proof to 60 days ..."
 * filed NEW. Published lead 261 had the same rule on Sept. 25. Published leads
 * are left out of the lead matcher on purpose, and the printed story's own
 * headline ("OUR Center pages list different Community Market visit
 * frequencies") shares no words with 974. So no check ever compared them.
 *
 * G01-DUP-2: lead 984 (Parkway Food Hall Nov. 21 chili cook-off) was held as
 * the same story as L975 (Inn Between Nov. 5 chili cook-off). The finder's own
 * sentence said the event is "distinct".
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const ourCenterPrinted = {
  slug: "our-center-pages-list-different-community-market-visit-frequencies",
  headline: "OUR Center pages list different Community Market visit frequencies",
  dek: null,
  topic: null,
  published_at: daysAgo(37),
};

describe("G01-DUP-1: a repeat of a published lead reaches the pair check", () => {
  it("pairs the candidate with the printed story through the published lead's headline", () => {
    const { pairs } = collectDupPairs({
      candidates: [{
        headline: "OUR Center tightens residency proof to 60 days for St. Vrain Valley assistance",
        why: "The residency requirement for financial assistance was cut from 90 days to 60 days.",
      }],
      existing: [],
      printed: [{
        ...ourCenterPrinted,
        lead_headline: "OUR Center publishes service access requirements, including 60-day St. Vrain residency rule",
        lead_why: "A concrete eligibility rule for a Longmont safety-net provider.",
        lead_created_at: daysAgo(37),
      }],
    });
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].kind, "printed");
    assert.equal(pairs[0].key, printedPairKey(0, ourCenterPrinted.slug));
    assert.equal(pairs[0].target, ourCenterPrinted.slug);
    assert.match(pairs[0].otherHeadline, /60-day St\. Vrain residency rule/);
  });

  it("makes no pair when the printed story has no lead to compare", () => {
    const { pairs } = collectDupPairs({
      candidates: [{ headline: "OUR Center tightens residency proof to 60 days for St. Vrain Valley assistance" }],
      existing: [],
      printed: [ourCenterPrinted],
    });
    assert.equal(pairs.length, 0);
  });

  it("does not use a published lead older than the match window", () => {
    const { pairs } = collectDupPairs({
      candidates: [{ headline: "OUR Center tightens residency proof to 60 days for St. Vrain Valley assistance" }],
      existing: [],
      printed: [{
        ...ourCenterPrinted,
        published_at: daysAgo(200),
        lead_headline: "OUR Center publishes service access requirements, including 60-day St. Vrain residency rule",
        lead_created_at: daysAgo(200),
      }],
    });
    assert.equal(pairs.length, 0);
  });
});

describe("G01-DUP-2: the finder's own sentence can say 'not the same'", () => {
  const data: SameStoryPromptData = {
    items: [{ n: 1, headline: "Parkway Food Hall hosts Nov. 21 chili cook-off", why: "" }],
    leads: [{ ref: "L975", id: 975, headline: "Inn Between chili cook-off Nov. 5 at Bootstrap Brewery", why: "" }],
    printed: [],
  };

  it("drops a ref whose sentence says the events are distinct", () => {
    const parsed = parseSameStoryReply(JSON.stringify([{
      n: 1,
      same_as: "L975",
      why: "Both are chili cook-offs at a brewery — L975's Inn Between fundraiser at Bootstrap Brewery is the nearest story, though this parks event is a distinct food-hall festival with its own date and tickets.",
    }]), data);
    assert.equal(parsed.size, 0);
  });

  for (const why of [
    "Different event: a food-hall festival, not the Inn Between fundraiser.",
    "Not the same story; this one is on Nov. 21.",
    "A separate cook-off with its own date.",
  ]) {
    it(`drops: ${why}`, () => {
      assert.equal(parseSameStoryReply(JSON.stringify([{ n: 1, same_as: "L975", why }]), data).size, 0);
    });
  }

  it("keeps a yes that only mentions different wording", () => {
    const why = "Same vote, different wording in the headline.";
    assert.equal(parseSameStoryReply(JSON.stringify([{ n: 1, same_as: "L975", why }]), data).size, 1);
  });

  it("keeps a ref whose sentence says they are the same", () => {
    const parsed = parseSameStoryReply(JSON.stringify([{
      n: 1,
      same_as: "L975",
      why: "Same Inn Between chili cook-off, same Nov. 5 date and brewery.",
    }]), data);
    assert.deepEqual(parsed.get(0), {
      kind: "lead",
      leadId: 975,
      why: "Same Inn Between chili cook-off, same Nov. 5 date and brewery.",
    });
  });
});
