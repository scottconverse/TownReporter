import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findMatchingLead,
  matchStrength,
  normalizeSourceUrl,
  extractAnchors,
  properNounStoplist,
  sharedAnchorCount,
  type MatchCandidateLead,
  type NewsroomPlace,
} from "./lead-match.ts";

describe("normalizeSourceUrl", () => {
  it("strips scheme, www, trailing slash, query and fragment", () => {
    assert.equal(
      normalizeSourceUrl("https://www.LongmontLeader.com/council-agenda/?utm=x#top"),
      "longmontleader.com/council-agenda",
    );
    assert.equal(normalizeSourceUrl("http://longmontleader.com/council-agenda"), "longmontleader.com/council-agenda");
  });
});

describe("findMatchingLead", () => {
  const killedClosedSessions: MatchCandidateLead = {
    id: 101,
    status: "killed",
    headline: "Longmont council has two closed-door executive sessions on the books for late September",
    source_urls: ["https://longmontleader.com/agenda/sept-council"],
  };

  it("matches the live case: a slightly reworded repeat of a killed lead, same source", () => {
    const candidate = {
      headline: "Two closed executive sessions are on the books for Longmont city council in late September",
      source_urls: ["https://www.longmontleader.com/agenda/sept-council/"],
    };
    assert.equal(findMatchingLead(candidate, [killedClosedSessions]), 101);
  });

  it("matches the live case with no shared URL but a near-identical headline", () => {
    const candidate = {
      headline: "Longmont city council books two closed-door executive sessions for late September",
      source_urls: ["https://someotherportal.example.com/notice/9981"],
    };
    assert.equal(findMatchingLead(candidate, [killedClosedSessions]), 101);
  });

  it("does not match on the same source URL alone when the story is different", () => {
    const candidate = {
      headline: "Longmont council approves new bike lane funding on Main Street",
      source_urls: ["https://longmontleader.com/agenda/sept-council"],
    };
    assert.equal(findMatchingLead(candidate, [killedClosedSessions]), null);
  });

  it("does not match on headline similarity alone below the URL-less threshold", () => {
    const candidate = {
      // Overlaps on "council", "closed", "session(s)", "september" but is a
      // different specific claim (single session, different framing).
      headline: "Longmont council adds one closed session in September for a personnel matter",
      source_urls: ["https://unrelated-portal.example.com/x"],
    };
    assert.equal(findMatchingLead(candidate, [killedClosedSessions]), null);
  });

  it("never matches a published lead, even with an identical headline and URL", () => {
    const published: MatchCandidateLead = {
      ...killedClosedSessions,
      id: 202,
      status: "published",
    };
    const candidate = {
      headline: killedClosedSessions.headline,
      source_urls: killedClosedSessions.source_urls,
    };
    assert.equal(findMatchingLead(candidate, [published]), null);
  });

  it("matches an open lead (new/held/drafted), not only killed", () => {
    for (const status of ["new", "held", "drafted"]) {
      const lead: MatchCandidateLead = { ...killedClosedSessions, id: 303, status };
      const candidate = {
        headline: killedClosedSessions.headline,
        source_urls: killedClosedSessions.source_urls,
      };
      assert.equal(findMatchingLead(candidate, [lead]), 303, `status ${status} should match`);
    }
  });

  it("skips a candidate lead outside the lookback window when created_at is provided", () => {
    const old: MatchCandidateLead = {
      ...killedClosedSessions,
      id: 404,
      created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const candidate = {
      headline: killedClosedSessions.headline,
      source_urls: killedClosedSessions.source_urls,
    };
    assert.equal(findMatchingLead(candidate, [old]), null);
  });

  it("still matches within the lookback window when created_at is provided", () => {
    const recent: MatchCandidateLead = {
      ...killedClosedSessions,
      id: 505,
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const candidate = {
      headline: killedClosedSessions.headline,
      source_urls: killedClosedSessions.source_urls,
    };
    assert.equal(findMatchingLead(candidate, [recent]), 505);
  });

  it("returns null for an empty candidate headline", () => {
    assert.equal(findMatchingLead({ headline: "", source_urls: [] }, [killedClosedSessions]), null);
  });

  it("returns null against an empty existing list", () => {
    assert.equal(
      findMatchingLead({ headline: killedClosedSessions.headline, source_urls: [] }, []),
      null,
    );
  });

  it("returns the first matching lead when more than one existing lead matches", () => {
    const first: MatchCandidateLead = { ...killedClosedSessions, id: 1 };
    const second: MatchCandidateLead = { ...killedClosedSessions, id: 2 };
    const candidate = {
      headline: killedClosedSessions.headline,
      source_urls: killedClosedSessions.source_urls,
    };
    assert.equal(findMatchingLead(candidate, [first, second]), 1);
  });
});

describe("findMatchingLead: anchor path (real case 2026-09-02)", () => {
  const draftedClosedSessions: MatchCandidateLead = {
    id: 601,
    status: "drafted",
    headline: "Longmont council has two closed-door executive sessions on the books for late September",
    source_urls: ["https://primegov.example.com/longmont/meeting/executive-sessions"],
  };

  it("matches the live case: specific dates in a same-source rewrite of a vague drafted headline", () => {
    const candidate = {
      headline:
        "Council books two executive sessions in eight days — Sept. 22 and Sept. 29 — with packets already posted",
      source_urls: ["https://primegov.example.com/longmont/meeting/executive-sessions"],
    };
    assert.equal(findMatchingLead(candidate, [draftedClosedSessions]), 601);
  });

  it("does not match same portal URL, different anchors: cancelled golf board vs continued licensing authority", () => {
    const golfBoard: MatchCandidateLead = {
      id: 701,
      status: "new",
      headline: "Golf Course Advisory Board cancelled Aug. 24",
      source_urls: ["https://primegov.example.com/longmont/portal"],
    };
    const candidate = {
      headline: "Local Licensing Authority continued to a date TBD",
      source_urls: ["https://primegov.example.com/longmont/portal"],
    };
    assert.equal(findMatchingLead(candidate, [golfBoard]), null);
  });

  it("does not match on one shared anchor alone: same date, otherwise unrelated stories", () => {
    const parksMeeting: MatchCandidateLead = {
      id: 801,
      status: "new",
      headline: "Parks Advisory Board meets Sept. 22 to review trail funding",
      source_urls: ["https://primegov.example.com/longmont/portal"],
    };
    const candidate = {
      headline: "Water board reviews rate study Sept. 22 ahead of budget season",
      source_urls: ["https://primegov.example.com/longmont/portal"],
    };
    assert.equal(findMatchingLead(candidate, [parksMeeting]), null);
  });

  it("QA-1 (2026-09-02): does not match two different agenda items that share a URL, a date, and a dollar figure", () => {
    // Real collision risk on a PrimeGov-style portal: two unrelated agenda
    // items on the same night's meeting, published under one page URL,
    // naming the same round dollar figure and the same meeting date. Before
    // the CONTENT_STOPLIST fix this cleared the anchor bar (shared URL +
    // shared date + shared amount = 2 anchors) and silently discarded the
    // library-roof-repair candidate as a "resurfaced" park-irrigation lead.
    const parkIrrigation: MatchCandidateLead = {
      id: 901,
      status: "held",
      headline: "Council approves $250,000 park irrigation contract at Sept. 10 meeting",
      source_urls: ["https://primegov.example.com/longmont/agenda/2026-09-10"],
    };
    const candidate = {
      headline: "Council votes on $250,000 library roof repair contract at Sept. 10 meeting",
      source_urls: ["https://primegov.example.com/longmont/agenda/2026-09-10"],
    };
    assert.equal(findMatchingLead(candidate, [parkIrrigation]), null);
  });
});

/**
 * U26 (2026-09-30). The owner's Queue, in their words: a lead about the U.S.
 * Supreme Court hearing Boulder County's climate suit "was chipped 'Looks
 * already printed: Boulder County Proclaims Hispanic and Latinx Heritage
 * Month, Listing Longmont's Oct. 24 Day of the Dead Celebration'. They share
 * nothing but 'Boulder County', an October date, and probably the county
 * homepage as a source."
 *
 * What made the region itself count as evidence was the old hard-coded
 * stoplist, which named only Longmont, city, council and Colorado: any other
 * jurisdiction in the paper's coverage ("Boulder", "County", "Weld", "State")
 * was read as a proper noun, and a capitalised place name is exactly what
 * extractAnchors counts. "Boulder" + "County" is two anchors -- by
 * ANCHOR_MATCH_MIN_SHARED, the same evidence as a shared meeting date plus a
 * shared dollar figure -- so a shared region, a shared month and one civic
 * word were enough. These pairs are all that shape: same place, same month,
 * different story. Restoring the Longmont-only stoplist makes them match
 * again.
 *
 * U26b: the place is now passed in, so every pair here is checked under the
 * newsroom these headlines came from -- Longmont, Colorado, Boulder County,
 * which is the production paper's own configuration.
 */
const LONGMONT: NewsroomPlace = { city: "Longmont", state: "Colorado", county: "Boulder" };

describe("U26 (2026-09-30): a place and a month are not a subject", () => {
  /** The county's own document index -- the kind of page two sightings out of
   * one county are both filed against. It is deliberately NOT an index page
   * by isIndexPageUrl (that function's own tests keep it as a shared source),
   * so these pairs get every chance the URL path can give them. */
  const COUNTY_PAGE = ["https://bouldercounty.gov/agendas/"];

  function check(candidate: string, existing: string, urls: string[] = COUNTY_PAGE) {
    const lead: MatchCandidateLead = { id: 900, status: "new", headline: existing, source_urls: urls };
    assert.equal(
      findMatchingLead({ headline: candidate, source_urls: urls }, [lead], LONGMONT),
      null,
      `findMatchingLead filed ${JSON.stringify(candidate)} as a repeat of ${JSON.stringify(existing)}`,
    );
    assert.equal(
      matchStrength(
        { headline: candidate, source_urls: urls },
        { headline: existing, source_urls: urls },
        LONGMONT,
      ),
      null,
      `matchStrength called ${JSON.stringify(candidate)} the same story as ${JSON.stringify(existing)}`,
    );
  }

  it("the owner's exact pair: two Boulder County stories that share a place and a month", () => {
    check(
      "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5",
      "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day of the Dead Celebration",
    );
  });

  it("the same pair on the county homepage, which is not evidence of a shared story", () => {
    // The source both leads most plausibly cited in production. A site home
    // is an index page (isIndexPageUrl), so it never was shared-URL evidence
    // -- this locks that in next to the pair it mattered for.
    check(
      "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5",
      "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day of the Dead Celebration",
      ["https://bouldercounty.gov/"],
    );
  });

  it("two county items that share a place, a month, and the word 'commissioners'", () => {
    check(
      "Boulder County commissioners approve climate suit funding Oct. 5",
      "Boulder County commissioners proclaim Hispanic Heritage Month Oct. 24",
    );
  });

  it("two county items that share a place, a month, and the word 'officials'", () => {
    check(
      "Boulder County officials open new trailhead near Longmont Oct. 5",
      "Boulder County officials seek volunteers for Longmont cleanup Oct. 24",
    );
  });

  it("two county items that share a place, a month, and the word 'leaders'", () => {
    check(
      "Boulder County leaders debate oil and gas rules Oct. 5",
      "Boulder County leaders celebrate Longmont artists Oct. 24",
    );
  });

  it("two county items that share a place, a month, and the word 'residents'", () => {
    check(
      "Boulder County asks residents about climate plan Oct. 5",
      "Boulder County thanks residents for heritage month Oct. 24",
    );
  });

  it("the paper's own place names are not anchors: Boulder, County, Longmont, Colorado", () => {
    const anchors = extractAnchors(
      "Boulder County, Listing Longmont's Colorado Day of the Dead Celebration",
      LONGMONT,
    );
    for (const place of ["boulder", "county", "longmont", "longmont's", "colorado"]) {
      assert.ok(!anchors.has(`noun:${place}`), `"${place}" is the paper's own region, not a fact about a story`);
    }
    // ...while a name that is not the newsroom's own region still is one.
    assert.ok(
      extractAnchors("Boulder County hears ExxonMobil climate suit Oct. 5", LONGMONT).has(
        "noun:exxonmobil",
      ),
    );
  });
});

/**
 * U26b (2026-09-30): the place words belong to the NEWSROOM, not to the
 * software.
 *
 * The U26 fix above read the shipped constants (PAPER.city/state and a
 * PAPER_COUNTY constant added for it), which is right for Longmont and wrong
 * for every other paper: a desk set up for Riverbend, Oregon would have
 * treated Longmont, Boulder and Colorado as its own furniture and Riverbend
 * and Oregon as facts about a story -- exactly the shape of the bug U26 was
 * fixing, just moved to a different newsroom. ENG-3 (U13/U13b/U13c) removed
 * that class of default from the desk's searches; the matcher now takes the
 * paper's place as a parameter (`getPaperPlace` on the server, the paper
 * identity on the client) and reads no global at all.
 *
 * An unconfigured paper gets the generic civic vocabulary and nothing else --
 * no country, no state, no town is guessed for it.
 */
describe("U26b: the place words are the newsroom's, never the shipped paper's", () => {
  const RIVERBEND: NewsroomPlace = { city: "Riverbend", state: "Oregon" };

  it("a paper set up for Riverbend, Oregon gets its own words and none of Longmont's", () => {
    const furniture = properNounStoplist(RIVERBEND);
    for (const own of ["riverbend", "oregon"]) {
      assert.ok(furniture.has(own), `"${own}" is this paper's own place and must not be an anchor`);
    }
    for (const other of ["longmont", "boulder", "colorado"]) {
      assert.ok(
        !furniture.has(other),
        `"${other}" belongs to a different newsroom and must not be treated as this paper's furniture`,
      );
    }
    // The same thing one level down, where it actually decides a match.
    const anchors = extractAnchors("Riverbend council meets Sept. 22 to review the Longmont contract", RIVERBEND);
    assert.ok(!anchors.has("noun:riverbend"), "Riverbend is this paper's own town, not a fact about a story");
    assert.ok(!anchors.has("noun:oregon"));
    assert.ok(anchors.has("noun:longmont"), "a neighbouring newsroom's town IS a name in this paper's headlines");
  });

  it("an unconfigured paper gets the civic words only -- no state, no town, no county is guessed", () => {
    const furniture = properNounStoplist();
    assert.ok(furniture.has("county"), "the generic civic vocabulary is always there");
    assert.ok(furniture.has("september"));
    for (const guessed of ["longmont", "boulder", "colorado", "riverbend"]) {
      assert.ok(!furniture.has(guessed), `nothing may invent "${guessed}" for a paper that named no place`);
    }
    // No place, no region furniture anywhere in the path...
    assert.ok(extractAnchors("Riverbend council meets Sept. 22").has("noun:riverbend"));
    // ...and the generic half still holds the owner's pair apart on its own:
    // "County" is one anchor against ANCHOR_MATCH_MIN_SHARED's two.
    const owner = "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5";
    const printed =
      "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day of the Dead Celebration";
    assert.equal(
      matchStrength({ headline: owner, source_urls: [] }, { headline: printed, source_urls: [] }),
      null,
    );
  });

  it("Longmont's own configuration still gives the owner's pair no match", () => {
    const owner = "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5";
    const printed =
      "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's Oct. 24 Day of the Dead Celebration";
    assert.equal(
      matchStrength(
        { headline: owner, source_urls: ["https://bouldercounty.gov/agendas/"] },
        { headline: printed, source_urls: ["https://bouldercounty.gov/agendas/"] },
        LONGMONT,
      ),
      null,
    );
    // A newsroom place is furniture, not a gag order: the paper's OWN real
    // duplicate still matches under that same configuration.
    assert.notEqual(
      matchStrength(
        {
          headline:
            "Two closed executive sessions are on the books for Longmont city council in late September",
          source_urls: ["https://www.longmontleader.com/agenda/sept-council/"],
        },
        {
          headline:
            "Longmont council has two closed-door executive sessions on the books for late September",
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
        LONGMONT,
      ),
      null,
    );
  });
});

describe("findMatchingLead: QA-1 round 2 adversarial set (2026-09-02)", () => {
  // All 13 pairs from
  // artifacts/gate-townreporter-2026-09-02/artifacts/reverify/qa1-matcher.mjs
  // (qa1-matcher-output.txt), plus two extra positives probing the round-2
  // fix (content-token overlap + universal sharesContentWord). Every
  // candidate/existing pair here shares the same source URL unless noted.
  const SAME_URL = ["https://longmont.primegov.com/portal/meeting/12345"];

  function existingLead(id: number, headline: string, sourceUrls: string[] = SAME_URL): MatchCandidateLead {
    return { id, status: "drafted", headline, source_urls: sourceUrls };
  }

  function expectMatch(candidateHeadline: string, existing: MatchCandidateLead, shouldMatch: boolean, msg: string) {
    const candidate = { headline: candidateHeadline, source_urls: SAME_URL };
    const result = findMatchingLead(candidate, [existing]);
    if (shouldMatch) {
      assert.equal(result, existing.id, msg);
    } else {
      assert.equal(result, null, msg);
    }
  }

  it("1. NO-MATCH: library roof vs park irrigation (canonical QA-1 negative)", () => {
    expectMatch(
      "Council votes on $250,000 library roof repair contract at Sept. 10 meeting",
      existingLead(1, "Council approves $250,000 park irrigation contract at Sept. 10 meeting"),
      false,
      "different subjects sharing a date and an amount must not merge",
    );
  });

  it("2. NO-MATCH: police overtime vs fire truck", () => {
    expectMatch(
      "Council approves $180,000 police overtime contract at Sept. 12 meeting",
      existingLead(2, "Council approves $180,000 fire truck contract at Sept. 12 meeting"),
      false,
      "'police overtime' vs 'fire truck' share nothing but furniture",
    );
  });

  it("3. NO-MATCH: water rates vs sewer bond", () => {
    expectMatch(
      "Council votes on $2 million water rates contract at Sept. 15 meeting",
      existingLead(3, "Council votes on $2 million sewer bond contract at Sept. 15 meeting"),
      false,
      "'million' is generic magnitude, not a subject word",
    );
  });

  it("4. NO-MATCH: generic-only shared words (contract/meeting/council)", () => {
    expectMatch(
      "Council approves contract at Tuesday's meeting on $75,000 item",
      existingLead(4, "Council approves contract at Tuesday's meeting on $75,000 item, unrelated matter"),
      false,
      "no distinguishing content word in common",
    );
  });

  it("5. MATCH: live 0.6.2 executive-sessions pair", () => {
    expectMatch(
      "Council books two executive sessions in eight days — Sept. 22 and Sept. 29 — with packets already posted",
      existingLead(5, "Longmont council has two closed-door executive sessions on the books for late September"),
      true,
      "the real same-story match this matcher exists for must still fire",
    );
  });

  it("6. MATCH: plural/singular variant session/sessions", () => {
    expectMatch(
      "Council schedules an executive session for Sept. 22 on the $500,000 land deal",
      existingLead(6, "Longmont council books executive sessions covering the $500,000 land deal, late September"),
      true,
      "session/sessions is a plural variant of the same subject",
    );
  });

  it("7. MATCH: possessive variant library's", () => {
    expectMatch(
      "Council approves the library's $300,000 roof contract at the Sept. 8 meeting",
      existingLead(7, "Longmont council OKs $300,000 contract for the library's roof, Sept. 8 session"),
      true,
      "possessive 's does not block the shared subject word",
    );
  });

  it("8. NO-MATCH: shared word is only 'contract' (generic)", () => {
    expectMatch(
      "Council approves $410,000 street paving contract at Sept. 9 meeting",
      existingLead(8, "Council approves $410,000 broadband contract at Sept. 9 meeting"),
      false,
      "'contract' alone is furniture, not a subject match",
    );
  });

  it("9. NO-MATCH: shared word is only 'meeting' (generic, and 'grant' is furniture too)", () => {
    expectMatch(
      "Board approves $95,000 grant for youth meeting programs on Oct. 4",
      existingLead(9, "Board approves $95,000 grant for senior meeting services on Oct. 4"),
      false,
      "'grant'/'meeting' are generic; youth vs senior programs are different subjects",
    );
  });

  it("10. NO-MATCH: different amount, same date, same URL, different subject", () => {
    expectMatch(
      "Council debates $50,000 sign ordinance on Sept. 20",
      existingLead(10, "Council debates $75,000 noise ordinance on Sept. 20"),
      false,
      "below the anchor bar (only the date matches) and no shared subject word",
    );
  });

  it("11. NO-MATCH: same date + same proper-noun anchor but different subject entirely", () => {
    expectMatch(
      "Planning board reviews Twin Peaks rezoning application on Sept. 18",
      existingLead(11, "Planning board reviews Twin Peaks parking variance on Sept. 18"),
      false,
      "shared place name 'Twin Peaks' is not itself proof of a shared subject",
    );
  });

  it("12. MATCH: genuinely same rezoning story reworded", () => {
    expectMatch(
      "Twin Peaks rezoning heads to council Sept. 18 after planning board review",
      existingLead(12, "Planning board reviews Twin Peaks rezoning application on Sept. 18"),
      true,
      "'rezoning' is a real shared subject word beyond the shared place name",
    );
  });

  it("13. MATCH: different meeting date entirely, same subject wording (falls to headline overlap)", () => {
    expectMatch(
      "Council approves $250,000 library roof repair contract at Sept. 10 meeting",
      existingLead(13, "Council approves $250,000 library roof repair contract at Oct. 22 meeting"),
      true,
      "near-identical subject wording ('library roof repair') carries path 1 even though the date differs",
    );
  });

  it("extra positive: plural/singular subject noun ('playground'/'playgrounds'), not just furniture", () => {
    expectMatch(
      "Council approves $60,000 for new playgrounds at Roosevelt Park",
      existingLead(14, "Council approves $60,000 playground upgrade at Roosevelt Park"),
      true,
      "stemming folds 'playgrounds' and 'playground' onto the same content token",
    );
  });

  it("extra positive (documented limitation): a typo does not fool the matcher into a false merge, and also does not itself prove a match", () => {
    // "libary" (typo) vs "library" -- this matcher has no fuzzy/edit-distance
    // matching, only exact-token overlap after stemming, so a headline whose
    // *only* shared subject word is misspelled will not match on that word
    // alone. Documented limitation, not a bug: silently fuzzy-matching
    // typos risks the opposite failure (QA-1) of merging unrelated stories
    // that happen to be a couple of letters apart. This pair also shares
    // "roof" and "repair" un-typo'd, which is what actually carries the
    // match here.
    expectMatch(
      "Council approves $300,000 libary roof repair contract at Sept. 8 meeting",
      existingLead(15, "Council approves $300,000 library roof repair contract at Sept. 8 meeting"),
      true,
      "matches via the untouched 'roof'/'repair' words plus the shared date/amount anchors, not via the typo'd word",
    );
  });
});

describe("extractAnchors / sharedAnchorCount", () => {
  it("normalises Sept. 22, Sep 22, 9/22, and September 22 to the same date anchor", () => {
    const canonical = "date:09-22";
    assert.ok(extractAnchors("Meeting set for Sept. 22").has(canonical));
    assert.ok(extractAnchors("Meeting set for Sep 22").has(canonical));
    assert.ok(extractAnchors("Meeting set for 9/22").has(canonical));
    assert.ok(extractAnchors("Meeting set for September 22").has(canonical));
  });

  it("credits a bare month mention once per distinct specific date it covers on the other side", () => {
    const bareMonth = extractAnchors("Two closed-door sessions on the books for late September");
    const twoDates = extractAnchors("Council books two sessions -- Sept. 22 and Sept. 29");
    assert.equal(sharedAnchorCount(bareMonth, twoDates), 2);
  });
});

/**
 * GauntletGate QA-1, round 3 (2026-09-02): findMatchingLead's binary
 * discard-or-not decision merged 6 different-story pairs and missed 1 real
 * duplicate (see artifacts/gate-townreporter-2026-09-02/artifacts/reverify/
 * qa1-matcher-output-round3.txt). matchStrength replaces the binary decision
 * with "strong" (stamp) / "possible" (file, linked) / null (nothing) -- see
 * its doc comment in lead-match.ts for the exact rule. These tests re-run
 * every round-3 false merge and every round-2 negative through matchStrength
 * and require none of them to ever come back "strong".
 */
describe("matchStrength", () => {
  const SAME_URL = ["https://longmont.primegov.com/portal/meeting/12345"];

  function existingLead(headline: string, sourceUrls: string[] = SAME_URL): MatchCandidateLead {
    return { id: 1, status: "drafted", headline, source_urls: sourceUrls };
  }

  describe("all 6 round-3 false merges are 'possible', never 'strong'", () => {
    const cases: [string, string, string][] = [
      [
        "NEG-4: Boulder County closed-door executive session, different agenda topic",
        "Boulder County commissioners hold closed-door executive session on jail expansion, Sept. 5",
        "Boulder County commissioners hold closed-door executive session on staff pay raises, Sept. 5",
      ],
      [
        "NEG-5: same amount+date city budget lines, different department",
        "Council approves $3.2 million streetlight replacement budget for 2027",
        "Council approves $3.2 million sidewalk snow removal budget for 2027",
      ],
      [
        "NEG-7: SVVSD broadband expansion, east county vs west county",
        "SVVSD approves $850,000 broadband expansion for rural east county schools",
        "SVVSD approves $850,000 broadband expansion for rural west county schools",
      ],
      [
        "NEG-8: fire district bid review, ambulance vs brush truck",
        "Fire district board reviews $95,000 ambulance replacement bid, Sept. 19",
        "Fire district board reviews $95,000 brush truck replacement bid, Sept. 19",
      ],
      [
        "NEG-9: Boulder County Main Street roundabout vs bike corral",
        "Boulder County transportation board debates Main Street roundabout design",
        "Boulder County transportation board debates Main Street bike corral placement",
      ],
      [
        "NEG-10: Longmont school board transportation vs technology contract",
        "Longmont school board approves $2.1 million transportation contract for bus routes serving 3,000 students",
        "Longmont school board approves $2.1 million technology contract for laptops serving 3,000 students",
      ],
    ];

    for (const [name, candidateHeadline, existingHeadline] of cases) {
      it(`${name}`, () => {
        const result = matchStrength(
          { headline: candidateHeadline, source_urls: SAME_URL },
          existingLead(existingHeadline),
        );
        assert.equal(result, "possible", `expected "possible", got ${result}`);
      });
    }
  });

  it("the round-3 missed duplicate (raise/hike synonym swap) is a documented limitation: findMatchingLead's own coarse gate never flagged it, so matchStrength (which only grades pairs that gate already flagged) returns null here -- fixing the coarse gate is out of scope for this round, but it must never silently become 'strong'", () => {
    const result = matchStrength(
      { headline: "Council votes to raise water rates by 8% starting January", source_urls: SAME_URL },
      existingLead("Council approves 8% water rate hike effective January"),
    );
    assert.notEqual(result, "strong");
  });

  it("the live 0.6.2 rewrite pair is a genuine same-story rewrite, but is deliberately 'possible', not 'strong' -- its content-token overlap is far below the 0.85 bar (see matchStrength's doc comment)", () => {
    const result = matchStrength(
      {
        headline:
          "Council books two executive sessions in eight days — Sept. 22 and Sept. 29 — with packets already posted",
        source_urls: SAME_URL,
      },
      existingLead("Longmont council has two closed-door executive sessions on the books for late September"),
    );
    assert.equal(result, "possible");
  });

  it("a near-identical repeat with only the meeting date changed is 'strong'", () => {
    const result = matchStrength(
      {
        headline: "Council approves $410,000 emergency generator replacement contract, Sept. 9 meeting",
        source_urls: SAME_URL,
      },
      existingLead("Council approves $410,000 emergency generator replacement contract, Oct. 14 meeting"),
    );
    assert.equal(result, "strong");
  });

  it("a near-identical repeat differing only in a plural/singular subject word is 'strong'", () => {
    const result = matchStrength(
      { headline: "Council approves new bike lane on Ken Pratt Boulevard", source_urls: SAME_URL },
      existingLead("Council approves new bike lanes on Ken Pratt Boulevard, Sept. 14"),
    );
    assert.equal(result, "strong");
  });

  describe("all 8 round-2 negatives are 'possible' or null, never 'strong'", () => {
    const cases: [string, string, string][] = [
      [
        "1: library roof vs park irrigation (canonical QA-1 negative)",
        "Council votes on $250,000 library roof repair contract at Sept. 10 meeting",
        "Council approves $250,000 park irrigation contract at Sept. 10 meeting",
      ],
      [
        "2: police overtime vs fire truck",
        "Council approves $180,000 police overtime contract at Sept. 12 meeting",
        "Council approves $180,000 fire truck contract at Sept. 12 meeting",
      ],
      [
        "3: water rates vs sewer bond",
        "Council votes on $2 million water rates contract at Sept. 15 meeting",
        "Council votes on $2 million sewer bond contract at Sept. 15 meeting",
      ],
      [
        "4: generic-only shared words (contract/meeting/council)",
        "Council approves contract at Tuesday's meeting on $75,000 item",
        "Council approves contract at Tuesday's meeting on $75,000 item, unrelated matter",
      ],
      [
        "8: shared word is only 'contract' (generic)",
        "Council approves $410,000 street paving contract at Sept. 9 meeting",
        "Council approves $410,000 broadband contract at Sept. 9 meeting",
      ],
      [
        "9: shared words are only 'grant'/'meeting' (generic)",
        "Board approves $95,000 grant for youth meeting programs on Oct. 4",
        "Board approves $95,000 grant for senior meeting services on Oct. 4",
      ],
      [
        "10: different amount, same date, same URL, different subject",
        "Council debates $50,000 sign ordinance on Sept. 20",
        "Council debates $75,000 noise ordinance on Sept. 20",
      ],
      [
        "11: same date + same proper-noun anchor but different subject entirely",
        "Planning board reviews Twin Peaks rezoning application on Sept. 18",
        "Planning board reviews Twin Peaks parking variance on Sept. 18",
      ],
    ];

    for (const [name, candidateHeadline, existingHeadline] of cases) {
      it(`${name}`, () => {
        const result = matchStrength(
          { headline: candidateHeadline, source_urls: SAME_URL },
          existingLead(existingHeadline),
        );
        assert.notEqual(result, "strong", `must never be "strong", got ${result}`);
      });
    }
  });

  it("returns null for a pair the coarse matcher (pairMatches, shared with findMatchingLead) would never flag as a match at all", () => {
    const result = matchStrength(
      { headline: "Council approves new bike lane funding on Main Street", source_urls: SAME_URL },
      existingLead("Longmont council has two closed-door executive sessions on the books for late September"),
    );
    assert.equal(result, null);
  });

  it("returns null when either headline is empty", () => {
    assert.equal(matchStrength({ headline: "", source_urls: SAME_URL }, existingLead("Anything at all here")), null);
    assert.equal(matchStrength({ headline: "Anything at all here", source_urls: SAME_URL }, existingLead("")), null);
  });
});
