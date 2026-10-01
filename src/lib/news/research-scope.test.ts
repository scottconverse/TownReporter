import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PAPER, SEED_SOURCES } from "../paper.ts";
import { queriesForRef, primarySourceQueries } from "./extract.ts";
import {
  NO_RESEARCH_SCOPE,
  cityOfficialHost,
  officialSiteHost,
  researchScopeOf,
  scopedQuery,
  type ResearchScope,
} from "./research-scope.ts";
import { remainingStrategies, strategiesForFrontier, strategyKeyForQuery } from "./strategies.ts";

/*
  The research queries used to be scoped by a built-in default (`city =
  "Longmont"`) and one of them was hard-wired to `site:longmontcolorado.gov`, so
  a paper set up for another city searched for the shipped paper's town. These
  cases pin the three answers that matter: another city gets its own town and
  its own official site, a paper that has answered nothing gets neither, and the
  shipped paper behaves exactly as it did -- through its configuration.
*/
const SHIPPED = researchScopeOf({ city: PAPER.city, state: PAPER.state, seedSources: SEED_SOURCES });
const OTHER: ResearchScope = researchScopeOf({
  city: "Riverbend",
  state: "Oregon",
  seedSources: [
    { url: "https://www.riverbend.gov/", kind: "official" },
    { url: "https://www.riverbendleader.com/", kind: "news" },
  ],
});

/** Nothing in a set of queries may name the shipped paper's town. */
function assertNoBuiltInTown(queries: string[]) {
  assert.ok(queries.length > 0, "there must be queries to check");
  assert.equal(
    queries.some((q) => /longmont/i.test(q)),
    false,
    `no query may name the shipped paper's town: ${JSON.stringify(queries)}`,
  );
}

describe("research scope", () => {
  it("names the configured city and the configured official site, not the shipped ones", () => {
    const company = strategiesForFrontier("company", "Acme Holdings LLC", OTHER);
    assertNoBuiltInTown(company.map((s) => s.query));
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" Riverbend`));
    assert.ok(company.some((s) => /site:riverbend\.gov\b/.test(s.query)), "the paper's own official site");
    assert.ok(company.some((s) => s.key === "registered-agent" && / Oregon/.test(s.query)));
    // A neighbouring state's business registry is not this paper's.
    assert.equal(company.some((s) => s.key === "state-corporate"), false);
  });

  it("scopes every research query helper, not just the strategies", () => {
    assertNoBuiltInTown(queriesForRef({ kind: "company", value: "Acme Holdings LLC" }, OTHER));
    assertNoBuiltInTown(queriesForRef({ kind: "person", value: "Jane Smith" }, OTHER));
    assertNoBuiltInTown(queriesForRef({ kind: "parcel", value: "1313200001" }, OTHER));
    assertNoBuiltInTown(queriesForRef({ kind: "legislation", value: "Ordinance 2026-47" }, OTHER));
    assertNoBuiltInTown(primarySourceQueries("Water plant contract", ["Acme Holdings"], OTHER));
    assert.ok(
      queriesForRef({ kind: "company", value: "Acme Holdings LLC" }, OTHER).some((q) =>
        q.includes("Riverbend"),
      ),
    );
    assert.ok(
      primarySourceQueries("Water plant contract", ["Acme Holdings"], OTHER).some((q) =>
        q.includes("Riverbend"),
      ),
    );
  });

  it("writes no town and no site: operator for a paper that has configured neither", () => {
    const company = strategiesForFrontier("company", "Acme Holdings LLC", NO_RESEARCH_SCOPE);
    assertNoBuiltInTown(company.map((s) => s.query));
    assert.equal(company.some((s) => /site:/.test(s.query)), false, "no host to name");
    assert.equal(company.some((s) => /Colorado|Oregon/.test(s.query)), false, "no state to name");
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC"`), "the query is still written, just unscoped");
    assert.equal(
      company.some((s) => /\s$|\s{2}/.test(s.query)),
      false,
      "a query with nothing to add must not carry a dangling space",
    );
    // Remaining strategies are the same list, minus the two that need a place.
    const keys = remainingStrategies("company", "Acme Holdings LLC", ["exact-name"], NO_RESEARCH_SCOPE);
    assert.ok(keys.some((s) => s.key === "historical-archive"));
    assert.equal(keys.some((s) => s.key === "site-gov"), false);
    assert.equal(strategyKeyForQuery("company", "Acme Holdings LLC", `"Acme Holdings LLC"`, NO_RESEARCH_SCOPE), "exact-name");
  });

  it("keeps the shipped paper's queries exactly as they were, through its configuration", () => {
    const company = strategiesForFrontier("company", "Acme Holdings LLC", SHIPPED);
    assert.deepEqual(
      company.map((s) => s.key),
      [
        "exact-name",
        "stripped-suffix",
        "registered-agent",
        "owner-officer",
        "address",
        "state-corporate",
        "parcel",
        "contract",
        "site-gov",
        "historical-archive",
      ],
    );
    assert.equal(
      officialSiteHost(SHIPPED.city, SEED_SOURCES),
      "longmontcolorado.gov",
      "the shipped watch list still identifies the shipped city's own site",
    );
    assert.equal(
      officialSiteHost(SHIPPED.city, SEED_SOURCES, SHIPPED.state),
      "longmontcolorado.gov",
      "and it identifies the same site with the newsroom's state in hand",
    );
    // The shipped watch list files bouldercounty.gov (Boulder County) and
    // longmont.primegov.com (the vendor's portal) as official. Neither is the
    // city, however the list is ordered.
    assert.equal(
      officialSiteHost(SHIPPED.city, [...SEED_SOURCES].reverse(), SHIPPED.state),
      "longmontcolorado.gov",
      "the county and the portal do not become the city's site from the other end of the list",
    );
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" Longmont`));
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" site:longmontcolorado.gov`));
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" site:sos.state.co.us`));
    assert.ok(
      queriesForRef({ kind: "company", value: "Acme Holdings LLC" }, SHIPPED).some((q) =>
        q.includes(`"Acme Holdings LLC" Longmont`),
      ),
    );
  });

  it("takes the official host from the CITY's own government address, not the first official row", () => {
    assert.equal(officialSiteHost("Longmont", []), null);
    assert.equal(officialSiteHost("Longmont", [{ url: "https://news.example.test/", kind: "news" }]), null);
    assert.equal(officialSiteHost("Longmont", [{ url: "https://www.youtube.com/@SomeCity", kind: "youtube" }]), null);
    assert.equal(
      officialSiteHost("Longmont", [
        { url: "not a url", kind: "official" },
        { url: "https://www.longmontcolorado.gov/", kind: "official" },
        { url: "https://second.longmontcolorado.gov/", kind: "official" },
      ]),
      "longmontcolorado.gov",
      "the first host carrying the city's name, in watch-list order",
    );
  });

  it("refuses a publisher, a county or a state standing in for the city", () => {
    /*
      The live watch list, in the order an editor would meet it: the local
      paper filed official, the county, the state, the school district, the
      vendor portal -- and the city's own site last. Only the last one is the
      city, and the two bugs this replaces each picked one of the others.
    */
    const liveWatchList = [
      { url: "https://www.timescall.com/", kind: "official" },
      { url: "https://bouldercounty.gov/", kind: "official" },
      { url: "https://www.colorado.gov/", kind: "official" },
      { url: "https://www.svvsd.org/", kind: "official" },
      { url: "https://longmont.primegov.com/public/portal", kind: "official" },
      { url: "https://www.longmontcolorado.gov/", kind: "official" },
    ];
    assert.equal(officialSiteHost("Longmont", liveWatchList), "longmontcolorado.gov");
    // The same list under another city's name is nobody's official site here.
    assert.equal(officialSiteHost("Riverbend", liveWatchList), null);
    assert.equal(
      researchScopeOf({ city: "Riverbend", state: "Oregon", seedSources: liveWatchList }).officialHost,
      null,
    );
    const riverbend = strategiesForFrontier("company", "Acme Holdings LLC", {
      city: "Riverbend",
      state: "Oregon",
      officialHost: officialSiteHost("Riverbend", liveWatchList),
    });
    assert.equal(
      riverbend.some((s) => s.query.includes("site:")),
      false,
      "no identifiable city site means no site: operator, never someone else's",
    );
  });

  it("matches the city's own label, never a substring of a neighbouring jurisdiction", () => {
    /*
      Boulder County's host carries the city's name, and a substring rule takes
      the county for the city -- the failure ENG-3 was meant to fix, still live
      in the host pick one layer below it. The city's name has to BE the label
      the host is registered under.
    */
    assert.equal(
      cityOfficialHost("Boulder", ["bouldercounty.gov", "bouldercolorado.gov"]),
      "bouldercolorado.gov",
      "the county is listed first and is still not the city",
    );
    assert.equal(cityOfficialHost("Boulder", ["bouldercounty.gov"]), null);
    // A label that merely starts with the city's name is somebody else's.
    assert.equal(cityOfficialHost("Longmont", ["notlongmont-news.us"]), null);
    // Nor is the city's name a subdomain of somebody else's host.
    assert.equal(cityOfficialHost("Longmont", ["longmontcolorado.gov.evil.us"]), null);
    assert.equal(cityOfficialHost("Longmont", ["longmontcolorado.gov"]), "longmontcolorado.gov");
  });

  it("prefers the plain city label over a state-qualified one, whatever the order", () => {
    assert.equal(cityOfficialHost("Boulder", ["bouldercolorado.gov", "boulder.gov"]), "boulder.gov");
    assert.equal(cityOfficialHost("Boulder", ["boulder.gov", "bouldercolorado.gov"]), "boulder.gov");
  });

  it("settles the one ambiguous label -- `co` -- with the newsroom's own state", () => {
    // `boulderco.gov` is Boulder, Colorado and it is also Boulder County.
    assert.equal(cityOfficialHost("Boulder", ["boulderco.gov"], "Colorado"), "boulderco.gov");
    assert.equal(cityOfficialHost("Boulder", ["boulderco.gov"], "CO"), "boulderco.gov");
    // Everywhere else the county reading is the only one left standing.
    assert.equal(cityOfficialHost("Boulder", ["boulderco.gov"], "Oregon"), null);
    assert.equal(cityOfficialHost("Boulder", ["boulderco.gov"]), null, "no state, no answer");
    // The unambiguous spellings need no state, and a state that is not this
    // city's state does not qualify it.
    assert.equal(cityOfficialHost("Boulder", ["bouldercolorado.gov"]), "bouldercolorado.gov");
    assert.equal(cityOfficialHost("Boulder", ["bouldercolorado.gov"], "Colorado"), "bouldercolorado.gov");
    assert.equal(cityOfficialHost("Boulder", ["bouldercolorado.gov"], "Oregon"), null);
    assert.equal(cityOfficialHost("Boulder", ["boulderor.gov"], "Oregon"), "boulderor.gov");
    assert.equal(cityOfficialHost("Boulder", ["boulderor.gov"], "Colorado"), null);
  });

  it("joins a multi-word city the way a host joins it, and does not guess at short or abbreviated names", () => {
    assert.equal(officialSiteHost("Palo Alto", [{ url: "https://paloalto.gov/", kind: "official" }]), "paloalto.gov");
    assert.equal(
      officialSiteHost("Longmont", [{ url: "https://ci.longmont.co.us/", kind: "official" }]),
      "ci.longmont.co.us",
      "the older .us city address is still the city's own",
    );
    // A three-letter town name cannot identify a host (ada.gov is not a town),
    // and a site that abbreviates its city's name is not recognised from it.
    assert.equal(officialSiteHost("Ada", [{ url: "https://ada.gov/", kind: "official" }]), null);
    assert.equal(officialSiteHost("Fort Collins", [{ url: "https://www.fcgov.com/", kind: "official" }]), null);
  });

  it("reads a hyphenated label as the city's name, not as a different host", () => {
    /*
      A DNS label cannot carry the space in "St. Louis" or the comma in a
      written-out state, so hosts join the parts with a hyphen: `stlouis-mo.gov`,
      `salem-or.gov`, `salem-oregon.gov`. The hyphen is punctuation the label had
      to lose, not part of the name, and reading it as part of the name refused
      the city's own site -- no `site:` operator at all for those papers.
    */
    assert.equal(cityOfficialHost("St. Louis", ["stlouis-mo.gov"], "Missouri"), "stlouis-mo.gov");
    assert.equal(cityOfficialHost("Salem", ["salem-or.gov"], "Oregon"), "salem-or.gov");
    assert.equal(cityOfficialHost("Salem", ["salem-oregon.gov"], "Oregon"), "salem-oregon.gov");
    // The state's name or code still has to be the newsroom's own.
    assert.equal(cityOfficialHost("Salem", ["salem-or.gov"], "Colorado"), null);
    assert.equal(cityOfficialHost("Salem", ["salem-oregon.gov"], "Colorado"), null);
    assert.equal(cityOfficialHost("St. Louis", ["stlouis-mo.gov"]), null, "no state, no two-letter answer");
    // A hyphen cannot manufacture a match out of a neighbouring jurisdiction.
    assert.equal(cityOfficialHost("Longmont", ["not-longmont-news.us"]), null);
    assert.equal(cityOfficialHost("Longmont", ["longmont-county.gov"]), null);
    // The plain name still beats a state-qualified one.
    assert.equal(
      cityOfficialHost("St. Louis", ["stlouis-mo.gov", "st-louis.gov"], "Missouri"),
      "st-louis.gov",
    );
  });

  it("will not read a neighbouring state's `.us` address as this paper's city", () => {
    /*
      `boulder.ny.us` is registered under New York's own `ny.us`, and its
      registrable label is `boulder`. The city's name being there is the whole
      disguise: a Colorado paper that took it would write
      `site:boulder.ny.us` into every research query -- a different Boulder's
      government address, presented as its own.
    */
    assert.equal(cityOfficialHost("Boulder", ["boulder.ny.us"], "Colorado"), null);
    assert.equal(cityOfficialHost("Boulder", ["boulder.ny.us"], "CO"), null);
    // The same address in its own state is the city's own, and so is a
    // newsroom that has not said what state it is in.
    assert.equal(cityOfficialHost("Boulder", ["boulder.ny.us"], "New York"), "boulder.ny.us");
    assert.equal(cityOfficialHost("Boulder", ["boulder.ny.us"]), "boulder.ny.us");
    // Longmont's older city address is still the city's own in Colorado, and a
    // state name spelled out ("Colorado"/"CO") reads the same either way.
    assert.equal(officialSiteHost("Longmont", [{ url: "https://ci.longmont.co.us/", kind: "official" }], "CO"), "ci.longmont.co.us");
    assert.equal(officialSiteHost("Longmont", [{ url: "https://ci.longmont.co.us/", kind: "official" }], "Colorado"), "ci.longmont.co.us");
    assert.equal(officialSiteHost("Longmont", [{ url: "https://ci.longmont.co.us/", kind: "official" }], "Oregon"), null);
    // A state-scoped `.us` beside the right one does not veto it.
    assert.equal(
      cityOfficialHost("Longmont", ["longmont.or.us", "ci.longmont.co.us"], "CO"),
      "ci.longmont.co.us",
    );
  });

  it("defaults to nothing at all when the configuration answers nothing", () => {
    const bare = researchScopeOf({ city: "", state: "", seedSources: [] });
    assert.deepEqual(bare, NO_RESEARCH_SCOPE);
    assert.equal(bare.officialHost, null);
    assert.equal(scopedQuery([`"Acme"`, bare.city, "press release"]), `"Acme" press release`);
  });
});
