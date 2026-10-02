import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  docCandidateHosts,
  docIndexPages,
  isOfficialDocHost,
  isOfficialHost,
  isOnSubject,
  pullQueries,
  siteOwnDocLinks,
} from "./pull-plan.ts";
import { officialDomains, officialDomainsEvery } from "./absence-gate.ts";

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

/*
  Point 2, and the ranking that was already here.

  What the new rule changes in the cases below: a commercial host is no longer
  a candidate at all, so the two cases that ranked `www.frprdistrict.com` (the
  rail district's own Wix site) now say so out loud by listing it as a source
  the paper has registered. What stays true: the story's own body still leads
  the state legislature, `.gov` still leads within a group, and non-URLs are
  still ignored.
*/

describe("docCandidateHosts", () => {
  it("puts the story's own hosts ahead of fresh search hits", () => {
    const hosts = docCandidateHosts(
      ["https://www.timescall.com/a", "https://ratpd.gov/news/", "https://www.timescall.com/b"],
      ["https://www.frprdistrict.com/about-the-district"],
      ["frprdistrict.com"],
    );
    assert.equal(hosts[0], "www.frprdistrict.com");
    assert.equal(hosts.filter((h) => h === "www.timescall.com").length, 0, "the press is not the body");
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
      ["frprdistrict.com"],
    );
    assert.equal(hosts[0], "www.frprdistrict.com");
  });

  it("ignores entries that are not URLs", () => {
    assert.deepEqual(docCandidateHosts(["not a url"], []), []);
  });

  it("never guesses a page on the three hosts the live pull reported", () => {
    // Story lead 406: "13 provider or page failures", nine of them these.
    const live = ["https://en.m.wikipedia.org/wiki/Longmont", "https://m.imdb.com/title/tt1", "https://whitepalmapts.com/"];
    assert.deepEqual(docCandidateHosts(live, [], []), []);
    assert.deepEqual(docIndexPages(docCandidateHosts(live, [], [])), []);
  });

  it("keeps government hosts, including .co.us town sites", () => {
    const hosts = docCandidateHosts(
      [
        "https://www.longmontcolorado.gov/records",
        "https://longmont.co.us/meetings",
        "https://www.bouldercounty.gov/agendas",
        "https://www.leg.colorado.gov/bills/SB26-172",
        "https://www.army.mil/packet",
      ],
      [],
    );
    assert.deepEqual(hosts.sort(), [
      "longmont.co.us",
      "www.army.mil",
      "www.bouldercounty.gov",
      "www.leg.colorado.gov",
      "www.longmontcolorado.gov",
    ].sort());
  });

  it("keeps a registered source host even when it is not a government address", () => {
    const hosts = docCandidateHosts(
      ["https://frprdistrict.com/board-meetings"],
      [],
      ["frprdistrict.com"],
    );
    assert.deepEqual(hosts, ["frprdistrict.com"]);
  });
});

/*
  PULL1b finding 1. `.us` is not government-only, so `isOfficialHost` accepted
  `zoom.us`, and a Pull then guessed `/meetings` and `/board-meetings` on a
  commercial host -- exactly the unsolicited fetch the PULL1 change exists to
  stop. The town and county sites the paper actually covers are still `.us`;
  they are the ones with the `<locality>.<state>.us` shape.
*/
describe("a .us address is official only when it is governmental", () => {
  it("rejects the commercial hosts plain `.us` let through", () => {
    for (const host of ["zoom.us", "bit.us", "example.us"]) {
      assert.equal(isOfficialHost(host), false, `${host} is not a government body`);
    }
  });

  it("accepts the town, county and federal shapes the paper covers", () => {
    for (const host of ["longmont.co.us", "ci.boulder.co.us", "www.larimer.co.us", "usgs.fed.us"]) {
      assert.equal(isOfficialHost(host), true, `${host} is a government address`);
    }
  });

  it("still accepts the paper's registered host, government or not", () => {
    assert.equal(isOfficialHost("zoom.us"), false);
    assert.equal(isOfficialDocHost("zoom.us", []), false);
    assert.equal(isOfficialDocHost("zoom.us", ["zoom.us"]), true);
  });

  it("never guesses a page on a commercial .us host", () => {
    assert.deepEqual(docCandidateHosts(["https://zoom.us/meetings"], [], []), []);
    assert.deepEqual(docIndexPages(["zoom.us"]), []);
  });

  it("leaves .gov, .gov.<cc> and .mil exactly as they were", () => {
    for (const host of ["longmontcolorado.gov", "abs.gov.au", "www.army.mil"]) {
      assert.equal(isOfficialHost(host), true, host);
    }
  });

  it("still rejects the three hosts the live pull reported", () => {
    for (const host of ["en.m.wikipedia.org", "m.imdb.com", "whitepalmapts.com"]) {
      assert.equal(isOfficialHost(host), false, host);
    }
  });
});

/*
  PULL1b finding 2. `officialDomains` ends in `.slice(0, 4)` -- it is the
  claims-of-absence gate's list, and the gate may legitimately want a short one.
  Pull used it as the complete registered set, so on a newsroom with more than
  four Tier A sources the fifth and later hosts were ineligible for index-page
  discovery even though the operator had registered them.
*/
describe("every registered host reaches Pull, while the gate keeps its short list", () => {
  const tierA = [
    "https://one.example.com",
    "https://two.example.com",
    "https://three.example.com",
    "https://four.example.com",
    "https://five.example.com",
    "https://six.example.com",
  ];

  it("hands Pull all six registered hosts", () => {
    assert.deepEqual(officialDomainsEvery("Longmont", tierA, tierA), [
      "one.example.com",
      "two.example.com",
      "three.example.com",
      "four.example.com",
      "five.example.com",
      "six.example.com",
    ]);
  });

  it("keeps the gate's own list capped at four, exactly as before", () => {
    assert.deepEqual(officialDomains("Longmont", tierA, tierA), [
      "one.example.com",
      "two.example.com",
      "three.example.com",
      "four.example.com",
    ]);
  });

  it("makes a story URL on the sixth Tier A host eligible", () => {
    const story = ["https://six.example.com/story"];
    assert.deepEqual(docCandidateHosts([], story, officialDomainsEvery("Longmont", tierA, tierA)), [
      "six.example.com",
    ]);
    // The capped list is why it was dropped: the defect, pinned.
    assert.deepEqual(docCandidateHosts([], story, officialDomains("Longmont", tierA, tierA)), []);
  });

  it("is the uncapped list the Pull context actually builds", () => {
    // The defect the bot found was at the call site, not in the helper.
    const source = readFileSync(new URL("./pull.server.ts", import.meta.url), "utf8");
    assert.match(source, /const officialHosts = officialDomainsEvery\(/);
    assert.doesNotMatch(source, /const officialHosts = officialDomains\(/);
  });

  it("still reads only three hosts' pages, the separate fetch cap", () => {
    const hosts = officialDomainsEvery("Longmont", tierA, tierA);
    const pages = docIndexPages(hosts, 3, hosts);
    const read = new Set(pages.map((p) => new URL(p).hostname));
    assert.equal(read.size, 3);
  });
});

describe("docIndexPages", () => {
  it("builds meetings-style pages for the top hosts only", () => {
    const pages = docIndexPages(
      ["ratpd.gov", "frprdistrict.com", "leg.colorado.gov", "timescall.com"],
      3,
      ["frprdistrict.com"],
    );
    assert.ok(pages.includes("https://ratpd.gov/meetings"));
    assert.ok(pages.includes("https://frprdistrict.com/meetings"));
    // Only the top three hosts are read; this runs inside a reporter's click.
    assert.equal(pages.some((p) => p.includes("timescall.com")), false);
  });

  it("guesses nothing at all when no host is official", () => {
    assert.deepEqual(docIndexPages(["en.m.wikipedia.org", "m.imdb.com", "whitepalmapts.com"]), []);
  });

  it("filters a commercial host even when a caller passes one in", () => {
    assert.deepEqual(docIndexPages(["timescall.com"]), []);
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
