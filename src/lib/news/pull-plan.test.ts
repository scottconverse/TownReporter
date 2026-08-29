import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  docCandidateHosts,
  docIndexPages,
  isOnSubject,
  pullQueries,
  siteOwnDocLinks,
} from "./pull-plan.ts";

/** The exact to-do line that returned three California school-district PDFs. */
const REAL_LINE =
  "Get the district board's adopted resolution and the certified ballot title text — those are the two documents that settle rate, boundary, sunset and debt. Then the board packet and minutes for the August 2026 meeting (and the prior meeting where the question was likely first discussed), the district's enabling statute SB 21-238 and its boundary map, any intergovernmental agreement between the district and RTD.";

describe("pullQueries", () => {
  it("splits the line that broke the pull into several short searches", () => {
    const qs = pullQueries(REAL_LINE, ["Front Range Passenger Rail District"], "Longmont");
    assert.ok(qs.length > 1, "one run-on line must not stay one query");
    for (const q of qs) assert.ok(q.length <= 200, `query too long: ${q}`);
  });

  it("anchors every query to the subject and the city", () => {
    const qs = pullQueries(REAL_LINE, ["Front Range Passenger Rail District"], "Longmont");
    for (const q of qs) {
      assert.match(q, /Front Range Passenger Rail District Longmont/);
    }
  });

  it("still returns a query when there is no subject to anchor to", () => {
    const qs = pullQueries("Get the adopted resolution", [], "Longmont");
    assert.equal(qs.length, 1);
    assert.match(qs[0]!, /Longmont/);
  });

  it("drops scaffolding words so the query is searchable", () => {
    const qs = pullQueries("Get the two documents that settle the rate", [], "Longmont");
    assert.doesNotMatch(qs[0]!, /\bthe\b/);
    assert.match(qs[0]!, /rate/);
  });

  it("never returns more than the cap", () => {
    assert.ok(pullQueries(REAL_LINE, ["X District"], "Longmont", 2).length <= 2);
  });
});

describe("docCandidateHosts", () => {
  it("puts the story's own hosts ahead of fresh search hits", () => {
    const hosts = docCandidateHosts(
      ["https://www.timescall.com/a", "https://ratpd.gov/news/", "https://www.timescall.com/b"],
      ["https://www.frprdistrict.com/about-the-district"],
    );
    assert.equal(hosts[0], "www.frprdistrict.com");
    assert.equal(hosts.filter((h) => h === "www.timescall.com").length, 1);
  });

  it("prefers .gov within a group", () => {
    const hosts = docCandidateHosts(["https://www.timescall.com/a", "https://ratpd.gov/news/"], []);
    assert.equal(hosts[0], "ratpd.gov");
  });

  it("does not let a .gov search hit outrank the body named in the story", () => {
    // The state legislature has no meetings page; the district does.
    const hosts = docCandidateHosts(
      ["https://www.leg.colorado.gov/bills/SB26-172"],
      ["https://www.frprdistrict.com/about-the-district"],
    );
    assert.equal(hosts[0], "www.frprdistrict.com");
  });

  it("ignores entries that are not URLs", () => {
    assert.deepEqual(docCandidateHosts(["not a url"], []), []);
  });
});

describe("docIndexPages", () => {
  it("builds meetings-style pages for the top hosts only", () => {
    const pages = docIndexPages([
      "ratpd.gov",
      "frprdistrict.com",
      "leg.colorado.gov",
      "timescall.com",
    ]);
    assert.ok(pages.includes("https://ratpd.gov/meetings"));
    assert.ok(pages.includes("https://frprdistrict.com/meetings"));
    // Only the top three hosts are read; this runs inside a reporter's click.
    assert.equal(pages.some((p) => p.includes("timescall.com")), false);
  });
});

describe("isOnSubject", () => {
  const subjects = ["Front Range Passenger Rail District"];

  it("rejects the California parcel-tax resolution that got through before", () => {
    const text =
      "RESOLUTION OF THE BOARD OF EDUCATION OF THE SAN CARLOS SCHOOL DISTRICT, " +
      "COUNTY OF SAN MATEO, STATE OF CALIFORNIA, ORDERING AN EDUCATION PARCEL TAX ELECTION";
    assert.equal(isOnSubject(text, subjects, "Longmont", "Colorado"), false);
  });

  it("accepts a document that names the city", () => {
    assert.equal(isOnSubject("A resolution of the City of Longmont", subjects, "Longmont"), true);
  });

  it("accepts a document that names the subject but not the city", () => {
    const text = "The Front Range Passenger Rail District board adopted the referral.";
    assert.equal(isOnSubject(text, subjects, "Longmont", "Colorado"), true);
  });

  it("survives the broken spacing PDF extraction produces", () => {
    const text = "the\n  FRONT   RANGE\tPassenger  Rail\nDistrict board";
    assert.equal(isOnSubject(text, subjects, "Longmont"), true);
  });

  it("rejects empty text", () => {
    assert.equal(isOnSubject("   ", subjects, "Longmont"), false);
  });

  it("does not reject everything when there is nothing to anchor on", () => {
    assert.equal(isOnSubject("some text", [], "", ""), true);
  });
});

describe("siteOwnDocLinks", () => {
  const page = "https://www.frprdistrict.com/board-meetings";

  it("drops the Wix build bundles that were kept as documents", () => {
    const bundle = `https://siteassets.parastorage.com/pages/pages/thunderbolt?${"a=1&".repeat(120)}`;
    assert.deepEqual(siteOwnDocLinks([bundle], page), []);
  });

  it("keeps a page on the body's own site, www or not", () => {
    const links = ["https://frprdistrict.com/agendas/2026-08", "https://www.frprdistrict.com/minutes"];
    assert.deepEqual(siteOwnDocLinks(links, page), links);
  });

  it("keeps a PDF hosted anywhere", () => {
    const pdf = "https://assets.example.com/packets/2026-08-board-packet.pdf";
    assert.deepEqual(siteOwnDocLinks([pdf], page), [pdf]);
  });

  it("drops an off-site page that is not a PDF", () => {
    assert.deepEqual(siteOwnDocLinks(["https://www.denverpost.com/2026/01/22/rail/"], page), []);
  });

  it("returns nothing when the page URL is not a URL", () => {
    assert.deepEqual(siteOwnDocLinks(["https://frprdistrict.com/a"], "not a url"), []);
  });
});
