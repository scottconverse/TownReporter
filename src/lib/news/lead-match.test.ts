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
