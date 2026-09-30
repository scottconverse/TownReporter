import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PAPER, SEED_SOURCES } from "../paper.ts";
import { queriesForRef, primarySourceQueries } from "./extract.ts";
import {
  NO_RESEARCH_SCOPE,
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
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" Longmont`));
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" site:longmontcolorado.gov`));
    assert.ok(company.some((s) => s.query === `"Acme Holdings LLC" site:sos.state.co.us`));
    assert.ok(
      queriesForRef({ kind: "company", value: "Acme Holdings LLC" }, SHIPPED).some((q) =>
        q.includes(`"Acme Holdings LLC" Longmont`),
      ),
    );
  });

  it("takes the official host from the first source an editor marked official", () => {
    assert.equal(officialSiteHost([]), null);
    assert.equal(officialSiteHost([{ url: "https://news.example.test/", kind: "news" }]), null);
    assert.equal(officialSiteHost([{ url: "https://www.youtube.com/@SomeCity", kind: "youtube" }]), null);
    assert.equal(
      officialSiteHost([
        { url: "not a url", kind: "official" },
        { url: "https://www.example.gov/", kind: "official" },
        { url: "https://second.example.gov/", kind: "official" },
      ]),
      "example.gov",
    );
  });

  it("defaults to nothing at all when the configuration answers nothing", () => {
    const bare = researchScopeOf({ city: "", state: "", seedSources: [] });
    assert.deepEqual(bare, NO_RESEARCH_SCOPE);
    assert.equal(bare.officialHost, null);
    assert.equal(scopedQuery([`"Acme"`, bare.city, "press release"]), `"Acme" press release`);
  });
});
