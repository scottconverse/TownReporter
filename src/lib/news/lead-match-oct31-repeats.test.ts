import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findMatchingLead, pairMatches, type MatchCandidateLead } from "./lead-match.ts";

/*
 * Oct 31 2026, dev run 107 (PR 358 at 81238c8c): lead 975 filed NEW although
 * lead 267 (killed Sept. 25) is the same Nov. 5 chili cook-off. The old
 * headline also carries "225 people housed", so the two headlines' subject
 * words were not contained one in the other and the near-duplicate rule
 * refused the pair before it looked at the shared date and names. The cite is
 * the nonprofit's home page, an index URL, so no shared-source route applied.
 */
const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder County" };

const KILLED_267: MatchCandidateLead = {
  id: 267,
  status: "killed",
  headline: "The Inn Between reports 225 people housed in 2025, sets Nov. 5 chili fundraiser at Bootstrap Brewery",
  source_urls: [
    "https://www.theinnbetween.org/",
    "https://www.theinnbetween.org/_files/ugd/87dc0f_dde8b018fdd7432d8d6eb6631881bf51.pdf",
  ],
};

describe("Oct 31 repeat: one event inside a two-part headline", () => {
  it("matches the same dated event at the same named place when the old headline also carries another fact", () => {
    const candidate = {
      headline: "The Inn Between lists a Nov. 5 chili cook-off fundraiser at Bootstrap Brewery",
      source_urls: ["https://www.theinnbetween.org/"],
    };
    assert.equal(findMatchingLead(candidate, [KILLED_267], PLACE), 267);
  });

  it("control: the same names and date with no shared subject word stay apart", () => {
    assert.equal(
      pairMatches(
        "The Inn Between sets Nov. 5 board election at Bootstrap Brewery",
        ["https://www.theinnbetween.org/board"],
        KILLED_267.headline,
        KILLED_267.source_urls,
        PLACE,
      ),
      false,
    );
  });
});
