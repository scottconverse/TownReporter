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
  leadHoursBefore,
  namedSubjects,
  nthWeekday,
  primarySourceQueries,
  primarySourceScore,
  queriesForRef,
  structureSnapshot,
} from "./extract.ts";

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
    const qs = queriesForRef({ kind: "company", value: "Front Range Municipal Solutions LLC" });
    assert.ok(qs.some((q) => /press release/i.test(q)));
    assert.ok(qs.some((q) => /registered agent/i.test(q)));
    assert.ok(qs.some((q) => /campaign contribution/i.test(q)));
  });
});

describe("namedSubjects and primary sources", () => {
  it("pulls Ursa Major from a sentence-case headline", () => {
    const names = namedSubjects("Ursa Major opens new Longmont manufacturing facility");
    assert.ok(names.some((n) => /ursa major/i.test(n)));
  });

  it("ranks the company's own press release above a news homepage", () => {
    const pr =
      "https://ursamajor.com/media/press-release/ursa-major-opens-new-longmont-manufacturing-facility/";
    const listing = "https://www.longmontleader.com/";
    const subjects = ["Ursa Major"];
    assert.ok(primarySourceScore(pr, subjects) > primarySourceScore(listing, subjects));
    assert.ok(primarySourceQueries("Ursa Major opens plant", subjects).some((q) => /press release/i.test(q)));
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
