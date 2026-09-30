import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyClaimKind,
  detectMissingCadence,
  detectPatternAnomalies,
  dropListingUrls,
  diffExcerpt,
  extractMeetingInstant,
  extractReferences,
  heuristicPlan,
  junkQueryReason,
  leadHoursBefore,
  namedSubjects,
  nthWeekday,
  primarySourceQueries,
  primarySourceScore,
  queriesForRef,
  structureSnapshot,
} from "./extract.ts";
import { PAPER, SEED_SOURCES } from "../paper.ts";
import { researchScopeOf } from "./research-scope.ts";

/*
  The research helpers are scoped to the paper's own configuration
  (./research-scope.ts) instead of defaulting to a built-in town. These cases
  describe the SHIPPED paper -- its city, its state and the host of its first
  official source -- so what they assert is the shipped configuration, read the
  same way production reads it, and not a constant inside the helper.
*/
const SHIPPED = researchScopeOf({ city: PAPER.city, state: PAPER.state, seedSources: SEED_SOURCES });

describe("extractReferences", () => {
  it("pulls companies, contracts, RFPs, URLs, and 'pursuant to' phrases", () => {
    const text = `
      Staff recommends award to Front Range Municipal Solutions LLC
      under contract #C-2024-118 pursuant to agreement dated March 3, 2023.
      See attachment https://www.longmontcolorado.gov/rfp/FRMS-09.pdf
      RFP 2024-09. Parcel 1313200001. Ordinance 2024-15.
    `;
    const refs = extractReferences(text);
    const kinds = new Set(refs.map((r) => r.kind));
    assert.ok(refs.some((r) => /Front Range Municipal Solutions LLC/i.test(r.value)));
    assert.ok(kinds.has("contract"));
    assert.ok(kinds.has("rfp"));
    assert.ok(kinds.has("url"));
    assert.ok(kinds.has("parcel"));
    assert.ok(kinds.has("legislation"));
    assert.ok(kinds.has("reference"));
  });
});

describe("queriesForRef", () => {
  it("turns a company into press-release, agent and contribution searches", () => {
    const qs = queriesForRef({ kind: "company", value: "Front Range Municipal Solutions LLC" }, SHIPPED);
    assert.ok(qs.some((q) => /press release/i.test(q)));
    assert.ok(qs.some((q) => /registered agent/i.test(q)));
    assert.ok(qs.some((q) => /campaign contribution/i.test(q)));
  });
});

/*
  Unit U25, B2 — the junk the dig searched with on 2026-09-30, held to its own
  strings.

  Every query below was run against a real provider during the Kid City USA
  stand-in walkthrough, and the results were captured and read: `"ints" RFP
  Longmont` returned Outlook and Microsoft pages, `"SITION" RFP Longmont`
  returned a Chinese Q&A site and a Cadillac forum, and `"under that name in our
  state" Longmont` returned Merriam-Webster, Under Armour and a Paducah sports
  bar. The two sources are fixed here rather than only filtered downstream.

  THE MUTATION THAT MATTERS. Reverting `CONTRACT_RE`'s `\bpo\b` to a bare `po`
  fails "does not split a word that merely starts with po" -- it captures the
  tail of "points", "position" and "popular" and turns each into a contract
  number -- and restoring `under` to `DATED_RE` fails the "reference" case that
  produced the whole "under" epidemic.
*/
describe("junk queries and the words they came out of", () => {
  it("does not split a word that merely starts with po", () => {
    const refs = extractReferences(
      "The points of the position are popular with the Portuguese delegation, per Pollock.",
    );
    const contracts = refs.filter((r) => r.kind === "contract").map((r) => r.value);
    assert.deepEqual(contracts, [], `mid-word fragments became contract numbers: ${contracts.join(", ")}`);
    // A real purchase-order number still reads as one.
    const po = extractReferences("Purchase order #PO-44821 was signed.");
    assert.ok(po.some((r) => r.kind === "contract" && r.value === "PO-44821"));
  });

  /**
   * The same trap, chosen so only the regex ANCHOR can save it: the fragment
   * `lice` is a whole word in its own right further down the same page, so the
   * whole-word rule lets it through and the `\bpo\b` fix is the only guard.
   */
  it("does not take the tail of a word whose tail is itself a word", () => {
    const refs = extractReferences(
      "The police log is public. Treatment for lice is common. A policy review follows.",
    );
    const contracts = refs.filter((r) => r.kind === "contract").map((r) => r.value);
    assert.deepEqual(contracts, [], `a substring of a longer word became a contract: ${contracts.join(", ")}`);
  });

  it("does not read the preposition 'under' as a document reference", () => {
    const refs = extractReferences(
      "UNDER Definition & Meaning - Merriam-Webster — https://merriam-webster.com/dictionary/under",
    );
    assert.deepEqual(refs.filter((r) => r.kind === "reference"), []);
    // The citation phrases the pattern is for still match.
    const kept = extractReferences("Filed pursuant to agreement dated March 3, 2023.");
    assert.ok(kept.some((r) => r.kind === "reference"), "a real citation phrase stopped matching");
  });

  it("refuses a value that only appears inside a longer word", () => {
    const refs = extractReferences("The composition of the packet is under review.");
    assert.ok(
      !refs.some((r) => /^sition$/i.test(r.value)),
      "a capture starting mid-word survived the whole-word rule",
    );
  });

  it("names a reason for every junk query the walkthrough ran", () => {
    const junk = [
      '"SITION" RFP Longmont',
      '"ints" RFP Longmont',
      '"after" Longmont contract',
      '"rtuguese" Longmont contract',
      '"under that name in our state" Longmont',
      '"Under - Paducah, KY 42001 - Menu, Reviews, Hours &amp; Contact — https://restaurantjump" Longmont',
      '"UNDER Definition &amp; Meaning - Merriam-Webster — https://merriam-webster" Longmont',
      '"$1900" Longmont',
    ];
    for (const query of junk) {
      const reason = junkQueryReason(query);
      assert.ok(reason, `this query would still have been sent to a provider: ${query}`);
      assert.ok(reason.length > 8, `the reason is not a sentence: ${reason}`);
    }
  });

  it("keeps the queries the desk writes itself", () => {
    for (const query of [
      '"Kid City USA" Longmont press release OR announcement OR newsroom',
      'site:longmontcolorado.gov Kid City USA Longmont agenda OR minutes',
      '"Longmont\'s Kid City USA daycare" Longmont after:2026-07-02 before:2026-10-01',
      '"Kid City USA Enterprises" "registered agent" Colorado',
      '"1941 Terry Street" assessor Longmont',
    ]) {
      assert.equal(junkQueryReason(query), null, `a usable query was refused: ${query}`);
    }
  });

  it("never derives a fallback query from a captured page", () => {
    /*
      The fallback reads the lead's own words; this is the pack it must NOT be
      reading -- captured page text, with titles and URLs in it. Every search
      it could invent from here is one the walkthrough actually ran.
    */
    const capturedPages = [
      "Over/Under | Sports Bar | Paducah, KY — https://overunderpaducah.com/",
      "See https://underarmour.com/en-us?msockid=334c7b9deb666c2b08da6c79ea156deb for the store",
      "UNDER Definition & Meaning | Dictionary.com — https://dictionary.com/browse/under",
    ].join("\n");
    const plan = heuristicPlan(capturedPages, new Set(), SHIPPED);
    for (const query of plan.searches) {
      assert.equal(junkQueryReason(query), null, `the fallback invented a junk query: ${query}`);
      assert.ok(!/https?:|&amp;| — /.test(query), `a scraped page became a search: ${query}`);
    }
  });
});

describe("namedSubjects and primary sources", () => {
  it("pulls Ursa Major from a sentence-case headline", () => {
    const names = namedSubjects("Ursa Major opens new Longmont manufacturing facility", SHIPPED);
    assert.ok(names.some((n) => /ursa major/i.test(n)));
  });

  it("ranks the company's own press release above a news homepage", () => {
    const pr =
      "https://ursamajor.com/media/press-release/ursa-major-opens-new-longmont-manufacturing-facility/";
    const listing = "https://www.longmontleader.com/";
    const subjects = ["Ursa Major"];
    assert.ok(primarySourceScore(pr, subjects) > primarySourceScore(listing, subjects));
    assert.ok(primarySourceQueries("Ursa Major opens plant", subjects, SHIPPED).some((q) => /press release/i.test(q)));
  });
});

describe("detectMissingCadence", () => {
  it("flags a monthly report that did not appear", () => {
    const last = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-08-20T00:00:00Z");
    const missing = detectMissingCadence(
      [
        {
          key: "water-quality",
          at: last,
          title: "Water Quality Report",
          url: "https://www.longmontcolorado.gov/water",
        },
      ],
      now,
      30,
      7,
    );
    assert.equal(missing.length, 1);
    assert.ok(missing[0]!.daysLate > 20);
  });
});

describe("diffExcerpt", () => {
  it("describes added and removed wording", () => {
    const d = diffExcerpt("staff recommended denial of the annexation", "staff recommended approval of the annexation");
    assert.match(d, /Removed:.*denial/i);
    assert.match(d, /Added:.*approval/i);
  });
});

describe("classifyClaimKind", () => {
  it("keeps FACT and defaults unknown", () => {
    assert.equal(classifyClaimKind("fact"), "FACT");
    assert.equal(classifyClaimKind("maybe"), "UNKNOWN");
  });
});

describe("detectPatternAnomalies", () => {
  it("flags omitted attachments and a shifted nth-weekday", () => {
    const previous = structureSnapshot("Water Quality Report", "Appendix C included", ["a.pdf", "b.pdf", "c.pdf"]);
    const current = structureSnapshot("Water Quality Report", "Short update", ["a.pdf"]);
    const found = detectPatternAnomalies({
      previous,
      current,
      usualNthWeekday: "2-Tuesday",
      observedAt: new Date("2026-08-05T00:00:00Z"),
      usualAttachmentCount: 3,
    });
    assert.ok(found.some((a) => a.kind === "attachment-omitted"));
    assert.ok(found.some((a) => a.kind === "cadence-shifted"));
    assert.equal(nthWeekday(new Date("2026-08-11T18:00:00Z")), "2-Tuesday");
  });

  it("flags a packet posted much later than the learned 72-hour lead", () => {
    const current = structureSnapshot("City Council agenda August 25, 2026", "Agenda", ["a.pdf"]);
    const found = detectPatternAnomalies({
      previous: null,
      current,
      usualLeadHours: 72,
      currentLeadHours: 12,
    });
    assert.ok(found.some((a) => a.kind === "late"));
  });
});

describe("extractMeetingInstant", () => {
  it("parses a civic meeting date and lead window", () => {
    const meeting = extractMeetingInstant("City Council agenda for August 25, 2026");
    assert.ok(meeting);
    const lead = leadHoursBefore(new Date("2026-08-22T00:00:00Z"), meeting!);
    assert.ok(lead != null && lead >= 70 && lead <= 80);
  });
});

describe("dropListingUrls", () => {
  const watched = [
    "https://www.timescall.com/news/crime-public-safety/",
    "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=1",
  ];

  it("drops the watch-list pages a lead was spotted through", () => {
    const kept = dropListingUrls(
      [
        "https://www.timescall.com/news/crime-public-safety/",
        "https://leg.colorado.gov/bills/SB21-238",
      ],
      watched,
    );
    assert.deepEqual(kept, ["https://leg.colorado.gov/bills/SB21-238"]);
  });

  it("matches a watched page across www and a trailing slash", () => {
    const kept = dropListingUrls(
      ["https://timescall.com/news/crime-public-safety", "https://example.gov/a.pdf"],
      watched,
    );
    assert.deepEqual(kept, ["https://example.gov/a.pdf"]);
  });

  it("keeps a different meeting on the same portal", () => {
    const url = "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=2";
    assert.deepEqual(dropListingUrls([url, "https://example.gov/a"], watched), [
      url,
      "https://example.gov/a",
    ]);
  });

  it("drops homepages, tag and author archives", () => {
    const kept = dropListingUrls([
      "https://www.timescall.com/",
      "https://www.timescall.com/tag/carbon-valley/",
      "https://www.timescall.com/author/jane-doe",
      "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/",
    ]);
    assert.deepEqual(kept, [
      "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/",
    ]);
  });

  it("keeps records that merely look like index pages", () => {
    const urls = [
      "https://ratpd.gov/meetings/",
      "https://longmontcolorado.gov/city-clerk/election-information/",
      "https://example.gov/packet.pdf",
    ];
    assert.deepEqual(dropListingUrls(urls), urls);
  });

  it("returns the input rather than an empty source list", () => {
    const urls = ["https://www.timescall.com/"];
    assert.deepEqual(dropListingUrls(urls, watched), urls);
  });
});

describe("dropListingUrls section fronts", () => {
  // The real watch list shape: publishers are watched at their homepage.
  const watched = ["https://www.timescall.com/", "https://www.longmontcolorado.gov/"];

  it("drops a section front on a watched publisher", () => {
    const kept = dropListingUrls(
      [
        "https://www.timescall.com/sports/high-school-sports/",
        "https://www.timescall.com/news/crime-public-safety/",
        "https://leg.colorado.gov/bills/SB21-238",
      ],
      watched,
    );
    assert.deepEqual(kept, ["https://leg.colorado.gov/bills/SB21-238"]);
  });

  it("keeps a dated article on that same publisher", () => {
    const url = "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/";
    assert.deepEqual(dropListingUrls([url], watched), [url]);
  });

  it("keeps a long headline slug with no date in it", () => {
    const url = "https://www.timescall.com/longmont-council-takes-next-step-toward-rail-tax";
    assert.deepEqual(dropListingUrls([url], watched), [url]);
  });

  it("keeps a .gov section page — that is the record index", () => {
    const urls = [
      "https://www.longmontcolorado.gov/city-clerk/election-information/",
      "https://www.longmontcolorado.gov/government/city-council",
    ];
    assert.deepEqual(dropListingUrls(urls, watched), urls);
  });

  it("keeps the same shape on a host we do not watch", () => {
    const url = "https://www.frprdistrict.com/about-the-district";
    assert.deepEqual(dropListingUrls([url], watched), [url]);
  });
});
