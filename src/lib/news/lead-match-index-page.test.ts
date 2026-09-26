import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findMatchingLead, isIndexPageUrl, matchStrength, type MatchCandidateLead } from "./lead-match.ts";

/*
 * Unit AK item 3 (2026-09-26): a section/list/index page is weak evidence that
 * two leads are the same story.
 *
 * Real case: leads 218 (held, Loomiller stabbing) and 209 (killed, "juvenile
 * altercation") both cited the Daily Camera's crime index page, not an
 * article. The matcher treated that shared index URL as "same source" and
 * linked them as possible duplicates of each other, which is not evidence
 * about the stories at all -- an index page carries every crime in the county.
 *
 * The rule is deliberately a closed, enumerated list of URL shapes (a site
 * root, a feed, a path that ENDS at a section word such as /news or
 * /local-news, or a section container such as /category/... followed by one
 * short dateless slug) rather than a general "looks short" heuristic: the
 * matcher must never demote a URL it cannot classify, so every URL not named
 * here keeps counting as a shared source, exactly as before this unit.
 *
 * Every example below is a URL that appears in this repo's sources table,
 * seed sources, or existing tests (see src/lib/paper.ts SEED_SOURCES,
 * src/lib/news/extract.test.ts, src/lib/news/report.test.ts).
 */

describe("isIndexPageUrl: index, section and listing pages are not articles", () => {
  it("treats a site root as an index", () => {
    for (const url of [
      "https://www.longmontcolorado.gov/",
      "https://bouldercounty.gov/",
      "https://mynextlight.com/",
      "https://www.svvsd.org/",
      "https://www.dailycamera.com/",
      "https://longmontcolorado.gov",
      "https://timescall.com/",
    ]) {
      assert.equal(isIndexPageUrl(url), true, `${url} should be a site root`);
    }
  });

  it("treats the crime and section fronts the two leads shared as indexes", () => {
    // The 218/209 pair: both cited the crime index page rather than an
    // article.
    for (const url of [
      "https://www.timescall.com/news/crime-public-safety/",
      "https://timescall.com/news/crime-public-safety",
      "https://www.dailycamera.com/news/crime-public-safety/",
      "https://www.dailycamera.com/news",
      "https://longmontcolorado.gov/news/",
      "https://www.longmontleader.com/local-news",
      "https://www.timescall.com/sports/high-school-sports/",
      "https://www.longmontcolorado.gov/events/",
      "https://longmontcolorado.gov/meetings",
      "https://www.timescall.com/category/longmont/",
      "https://www.timescall.com/tag/carbon-valley/",
      "https://www.timescall.com/author/jane-doe",
    ]) {
      assert.equal(isIndexPageUrl(url), true, `${url} should be an index/section page`);
    }
  });

  it("treats a feed as an index", () => {
    for (const url of [
      "https://www.reddit.com/r/longmont/.rss",
      "https://www.reddit.com/r/longmont/hot/.rss",
      "https://93.184.216.34/feed.xml",
      "https://www.youtube.com/feeds/videos.xml",
      "https://longmontcolorado.gov/feed",
    ]) {
      assert.equal(isIndexPageUrl(url), true, `${url} should be a feed`);
    }
  });

  it("keeps every article, document, agenda and portal page the sources table holds", () => {
    for (const url of [
      // Real articles, in the shape the local papers publish.
      "https://www.dailycamera.com/2026/08/28/boulder-county-rail-tax-vote/",
      "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/",
      "https://www.longmontleader.com/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123",
      "https://longmontcolorado.gov/news/2026-midyear-longmont-progress-updates",
      // Seed sources from src/lib/paper.ts that are records, not indexes.
      "https://www.longmontcolorado.gov/government/city-council",
      "https://longmontcolorado.gov/city-clerk/",
      "https://www.longmontcolorado.gov/departments/departments-n-z/planning-and-development-services",
      "https://longmontcolorado.gov/city-clerk/election-information/",
      "https://longmont.primegov.com/public/portal",
      "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=1",
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
      // Agenda and meeting pages the matcher's own tests share.
      "https://longmontleader.com/agenda/sept-council",
      "https://primegov.example.com/longmont/portal",
      "https://longmont.primegov.com/portal/meeting/12345",
      "https://bouldercounty.gov/agenda/sept-5",
      "https://example.org/agenda",
      "https://longmontcitycouncil.org/meetings/2026-09-15/",
      // Documents.
      "https://longmontcolorado.gov/agendas/2026-08-25-packet.pdf",
      "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf",
      "https://longmontcolorado.gov/water/water-quality-report.html",
    ]) {
      assert.equal(isIndexPageUrl(url), false, `${url} is not an index page`);
    }
  });
});

describe("findMatchingLead: an index page shared by two leads is not a shared source", () => {
  // Both leads cite the crime index page, exactly as 218 and 209 did, and
  // their headlines overlap the way two different crime stories on one index
  // page do.
  const CRIME_INDEX = "https://www.dailycamera.com/news/crime-public-safety/";
  const openAltercation: MatchCandidateLead = {
    id: 209,
    status: "killed",
    headline: "Police investigate juvenile altercation at Longmont park",
    source_urls: [CRIME_INDEX],
  };

  it("does not match two different crime stories that only share the index page", () => {
    const candidate = {
      headline: "Man arrested in Loomiller Park stabbing, police say",
      source_urls: [CRIME_INDEX],
    };
    assert.equal(findMatchingLead(candidate, [openAltercation]), null);
    assert.equal(matchStrength(candidate, openAltercation), null);
  });

  it("still matches when the same story is also cited to its own article URL", () => {
    const article = "https://www.dailycamera.com/2026/09/24/loomiller-park-stabbing/";
    const candidate = {
      headline:
        "Man arrested in stabbing at Loomiller Park, police say the victim is expected to recover",
      source_urls: [CRIME_INDEX, article],
    };
    const killed: MatchCandidateLead = {
      id: 218,
      status: "killed",
      headline: "Longmont police arrest a man in a Loomiller Park stabbing",
      source_urls: [article],
    };
    assert.equal(findMatchingLead(candidate, [killed]), 218);
  });
});
