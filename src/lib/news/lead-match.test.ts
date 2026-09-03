import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findMatchingLead,
  normalizeSourceUrl,
  extractAnchors,
  sharedAnchorCount,
  type MatchCandidateLead,
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
