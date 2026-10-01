import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beatsForSource,
  candidateLabel,
  hostOf,
  isRefusedHost,
  JOURNALISM,
  NOT_OFFICIAL,
  OFFICIAL_RECORD,
  rankCandidates,
  siblingCandidates,
  sitemapCandidates,
  titleFromUrl,
  type ReplacementCandidate,
} from "./source-replacements.ts";

/*
  FINDING A REPLACEMENT, THE FREE TIER (SH0-8).

  The rules pinned here are the two the owner's addendum turns on, plus the
  beat resolution the whole feature rests on:

    - a beat is a SECTION, and the owner-written one wins;
    - the paper's OWN record ranks first and reads "Official record", with the
      host passed in and never guessed from a town name;
    - a host the newsroom has legally dropped is never offered.

  THE MUTATION. Delete the `isRefusedHost` call from `rankCandidates` and the
  "legally dropped host is never offered" cases below stop passing -- which is
  the one way this module could quietly undo a legal decision.
*/

const NEWSROOM_SECTIONS = [
  { key: "planning", name: "Planning" },
  { key: "council", name: "Council" },
  { key: "budget", name: "Budget" },
  { key: "schools", name: "Schools" },
];

describe("beatsForSource", () => {
  it("prefers the sections the owner filed the source under, and keeps both", () => {
    // A source in two sections is a source the editor wants candidates for in
    // both -- not one winner.
    assert.deepEqual(
      beatsForSource({ sections: ["planning", "budget"], title: "City of Example" }),
      ["planning", "budget"],
    );
  });

  it("falls back to the recorded guess only when nobody filed it", () => {
    assert.deepEqual(beatsForSource({ sections: [], proposedSection: "council", title: "x" }), [
      "council",
    ]);
    assert.deepEqual(beatsForSource({ proposedSection: "council" }), ["council"]);
  });

  it("falls back to the title, matched against the newsroom's OWN sections", () => {
    assert.deepEqual(
      beatsForSource({ title: "Example County Planning Commission", knownSections: NEWSROOM_SECTIONS }),
      ["planning"],
    );
    assert.deepEqual(
      beatsForSource({
        title: "Riverbend Valley Schools board agenda",
        knownSections: NEWSROOM_SECTIONS,
      }),
      ["schools"],
    );
  });

  it("says nothing rather than inventing a beat", () => {
    // Empty is a real answer: "we cannot tell what this was for" is a sentence
    // the editor can act on.
    assert.deepEqual(beatsForSource({ title: "Some site", knownSections: NEWSROOM_SECTIONS }), []);
    assert.deepEqual(beatsForSource({}), []);
    assert.deepEqual(beatsForSource({ title: null, sections: null }), []);
  });

  it("ignores blank entries rather than passing them through as beats", () => {
    assert.deepEqual(beatsForSource({ sections: ["", "  "], proposedSection: "  " }), []);
    assert.deepEqual(beatsForSource({ sections: ["planning", "", "planning"] }), ["planning"]);
  });

  it("needs the section name to be a whole word of at least five characters", () => {
    // "News" and "Arts" are under the floor on purpose: they are real section
    // names and also words that turn up in half the titles on a watch list, so
    // matching on them would manufacture a beat for almost every source.
    const sections = [
      { key: "news", name: "News" },
      { key: "arts", name: "Arts" },
      { key: "planning", name: "Planning" },
    ];
    assert.deepEqual(
      beatsForSource({ title: "The News Gazette covers Planning", knownSections: sections }),
      ["planning"],
    );
    // ...and a section name inside a longer word is not a match.
    assert.deepEqual(
      beatsForSource({ title: "Plannington Township", knownSections: sections }),
      [],
    );
  });
});

describe("siblingCandidates", () => {
  const watch = [
    { id: 1, url: "https://broken.test/feed", title: "Broken", kind: "news", sections: ["planning"] },
    { id: 2, url: "https://sibling.test/rss", title: "Sibling", kind: "news", sections: ["planning"] },
    { id: 3, url: "https://council.test/rss", title: "Council", kind: "official", sections: ["council"] },
    { id: 4, url: "https://both.test/rss", title: "Both", kind: "news", sections: ["planning", "budget"] },
  ];

  it("offers the other sources on the beat, and never the source itself", () => {
    const found = siblingCandidates(watch, { sourceId: 1, beats: ["planning"] });
    assert.deepEqual(
      found.map((c) => c.url),
      ["https://sibling.test/rss", "https://both.test/rss"],
    );
    assert.ok(!found.some((c) => c.url.includes("broken.test")));
  });

  it("names the shared beat on each candidate, not the whole query", () => {
    const found = siblingCandidates(watch, { sourceId: 3, beats: ["planning", "budget"] });
    assert.deepEqual(
      found.map((c) => c.beats),
      [["planning"], ["planning"], ["planning", "budget"]],
    );
  });

  it("returns nothing when no other source shares the beat", () => {
    // Which is the panel's "Planning has only this one source" -- a fact about
    // the newsroom, not a failure.
    assert.deepEqual(siblingCandidates(watch, { sourceId: 1, beats: ["schools"] }), []);
    assert.deepEqual(siblingCandidates(watch, { sourceId: 1, beats: [] }), []);
  });
});

describe("sitemapCandidates", () => {
  const LOCS = [
    "https://city.test/",
    "https://city.test/about",
    "https://city.test/council/agenda-2026-10-07",
    "https://city.test/planning/minutes-2026-09-16",
    "https://city.test/budget/2027-adopted-budget.pdf",
    "https://city.test/parks/dog-park-hours",
  ];

  it("keeps the public record and drops the ordinary pages", () => {
    const found = sitemapCandidates(LOCS, { beats: [] });
    assert.deepEqual(
      found.map((c) => c.url),
      [
        "https://city.test/council/agenda-2026-10-07",
        "https://city.test/planning/minutes-2026-09-16",
        "https://city.test/budget/2027-adopted-budget.pdf",
      ],
    );
  });

  it("also keeps a page that answers the beat even when it is not a document", () => {
    const locs = [...LOCS, "https://city.test/planning/2027-development-map"];
    const found = sitemapCandidates(locs, { beats: ["planning"] });
    const map = found.find((c) => c.url.endsWith("2027-development-map"));
    assert.ok(map, "a Planning page is a candidate for a Planning beat");
    assert.deepEqual(map!.beats, ["planning"]);
  });

  it("gives each candidate a readable name", () => {
    const found = sitemapCandidates(LOCS, { beats: [] });
    assert.equal(found[0]!.title, "Agenda 2026 10 07");
    assert.equal(found[2]!.title, "2027 adopted budget");
  });

  it("ignores anything that is not an http address", () => {
    assert.deepEqual(sitemapCandidates(["mailto:clerk@city.test", "not a url"], {}), []);
  });
});

describe("candidateLabel", () => {
  it("calls the newsroom's OWN host the official record", () => {
    assert.equal(candidateLabel({ url: "https://example.test/rss" }, "example.test"), OFFICIAL_RECORD);
    assert.equal(candidateLabel({ url: "https://www.example.test/rss" }, "www.example.test"), OFFICIAL_RECORD);
    assert.equal(candidateLabel({ url: "https://data.example.test/x" }, "example.test"), OFFICIAL_RECORD);
  });

  it("calls any .gov or .us address the official record", () => {
    assert.equal(candidateLabel({ url: "https://somewhere.gov/agenda" }), OFFICIAL_RECORD);
    assert.equal(candidateLabel({ url: "https://somewhere.ny.us/agenda" }), OFFICIAL_RECORD);
  });

  it("calls a news row Journalism and the rest what it is", () => {
    assert.equal(candidateLabel({ url: "https://paper.test/rss", kind: "news" }), JOURNALISM);
    assert.equal(candidateLabel({ url: "https://blog.test/rss" }), NOT_OFFICIAL);
    assert.equal(candidateLabel({ url: "https://blog.test/rss", kind: "discovered" }), NOT_OFFICIAL);
  });

  it("never claims a judgement it cannot support", () => {
    // A .com city site that is NOT this paper's own host is not labelled
    // official on the strength of its name.
    assert.equal(candidateLabel({ url: "https://fcgov.com/rss" }, "example.test"), NOT_OFFICIAL);
  });
});

describe("rankCandidates", () => {
  const OFFICIAL = "https://example.gov/agenda";

  it("puts the paper's own record first and reads it as the official record", () => {
    const ranked = rankCandidates(
      [
        { url: "https://blog.test/rss", via: "sitemap" },
        { url: "https://paper.test/rss", kind: "news", via: "sibling" },
        { url: OFFICIAL, via: "sitemap" },
      ],
      { officialHost: "example.gov" },
    );
    assert.equal(ranked[0]!.url, OFFICIAL);
    assert.equal(ranked[0]!.label, OFFICIAL_RECORD);
    assert.equal(ranked[0]!.rank, 0);
    assert.deepEqual(
      ranked.map((c) => c.label),
      [OFFICIAL_RECORD, JOURNALISM, NOT_OFFICIAL],
    );
  });

  it("orders official before journalism before everything else, keeping the caller's order inside a label", () => {
    const ranked = rankCandidates(
      [
        { url: "https://a.test/1", kind: "news", via: "sibling" },
        { url: "https://b.test/2", via: "sitemap" },
        { url: "https://c.test/3", kind: "news", via: "sibling" },
        { url: "https://d.gov/4", via: "sitemap" },
      ],
      {},
    );
    assert.deepEqual(
      ranked.map((c) => c.url),
      ["https://d.gov/4", "https://a.test/1", "https://c.test/3", "https://b.test/2"],
    );
  });

  it("never offers a host the newsroom has legally dropped", () => {
    const ranked = rankCandidates(
      [
        { url: "https://dropped.test/rss", kind: "news", via: "sibling" },
        { url: "https://data.dropped.test/rss", kind: "news", via: "sibling" },
        { url: "https://kept.test/rss", kind: "news", via: "sibling" },
      ],
      { droppedHosts: ["dropped.test"] },
    );
    assert.deepEqual(
      ranked.map((c) => c.url),
      ["https://kept.test/rss"],
    );
  });

  it("refuses a dropped host even when it is the paper's own", () => {
    // The legal decision outranks the ranking: a dropped host is not offered
    // at any rank.
    const ranked = rankCandidates([{ url: OFFICIAL, via: "sitemap" }], {
      officialHost: "example.gov",
      droppedHosts: ["example.gov"],
    });
    assert.deepEqual(ranked, []);
  });

  it("deduplicates by address, keeping the first", () => {
    const ranked = rankCandidates([
      { url: "https://a.test/1", kind: "news", via: "sibling" },
      { url: "https://a.test/1", via: "sitemap" },
    ]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.via, "sibling");
  });

  it("drops anything without a usable http address", () => {
    const ranked = rankCandidates([
      { url: "mailto:a@b.test", via: "sitemap" },
      { url: "", via: "sitemap" },
      { url: "https://ok.test/1", via: "sitemap" },
    ]);
    assert.deepEqual(
      ranked.map((c) => c.url),
      ["https://ok.test/1"],
    );
  });

  it("an empty candidate list is an empty answer, not an error", () => {
    assert.deepEqual(rankCandidates([], {}), []);
    assert.deepEqual(rankCandidates([], { officialHost: "example.gov", droppedHosts: ["x.test"] }), []);
  });
});

describe("the small helpers", () => {
  it("hostOf strips www, lower-cases, and refuses non-http", () => {
    assert.equal(hostOf("https://WWW.Example.Test/a"), "example.test");
    assert.equal(hostOf("ftp://example.test/a"), null);
    assert.equal(hostOf("not a url"), null);
  });

  it("isRefusedHost matches the host and its subdomains, not its neighbours", () => {
    assert.equal(isRefusedHost("dropped.test", ["dropped.test"]), true);
    assert.equal(isRefusedHost("data.dropped.test", ["dropped.test"]), true);
    assert.equal(isRefusedHost("https://dropped.test/x", ["dropped.test"]), true);
    assert.equal(isRefusedHost("notdropped.test", ["dropped.test"]), false);
    assert.equal(isRefusedHost("dropped.test", []), false);
    assert.equal(isRefusedHost("dropped.test", null), false);
  });

  it("titleFromUrl says nothing for a bare host", () => {
    assert.equal(titleFromUrl("https://example.test/"), null);
    assert.equal(titleFromUrl("https://example.test"), null);
  });

  it("a candidate carries the beat and the way it was found", () => {
    const candidate: ReplacementCandidate = {
      url: "https://city.test/planning/minutes-1",
      via: "sitemap",
      beats: ["planning"],
    };
    assert.equal(candidate.via, "sitemap");
  });
});
