import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asStoryForm,
  allocateLaneQueries,
  briefChallengeQuery,
  challengeLooksSubstantive,
  chooseStoryForm,
  collapseRepeatedParagraphs,
  describeSourceUrl,
  isIndexUrl,
  linkOutletInBody,
  looksLikeArticleUrl,
  looksLikeRewrite,
  mergeProvenanceItem,
  parseFindings,
  preferStoryUrls,
  provenanceFromUrls,
  resolvePublicFindings,
  stripAiFiller,
  stripReporterNotebook,
  type ProvenanceItem,
} from "./report.ts";
import type { LeadRow } from "./types.ts";
import { describeTextChanges, retrieveRelevantChunks } from "./retrieve.ts";
import { rankWorthItems } from "./worth-a-look.ts";

describe("describeSourceUrl", () => {
  it("does not replace a document URL with the organization's homepage label", () => {
    const d = describeSourceUrl(
      "https://www.longmontcolorado.gov/government/agendas/2026-08-25-packet.pdf",
    );
    assert.match(d.title, /packet/i);
    assert.match(d.organization, /longmontcolorado\.gov/);
    assert.notEqual(d.title.toLowerCase(), "longmontcolorado.gov");
  });

  it("uses the host only when the path is a homepage", () => {
    const d = describeSourceUrl("https://www.longmontcolorado.gov/");
    assert.equal(d.title, "longmontcolorado.gov");
  });
});

describe("story credit URLs", () => {
  const HOME = "https://www.longmontleader.com/";
  const INDEX = "https://www.longmontleader.com/local-news";
  const STORY =
    "https://www.longmontleader.com/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123";
  const HEADLINE = "Why Longmont Can't Simply Ban Noisy Airplanes at Vance Brand Airport";

  it("treats a homepage and /local-news as indexes, not stories", () => {
    assert.equal(isIndexUrl(HOME), true);
    assert.equal(isIndexUrl(INDEX), true);
    assert.equal(isIndexUrl(STORY), false);
    assert.equal(looksLikeArticleUrl(STORY), true);
    assert.equal(looksLikeArticleUrl(HOME), false);
  });

  it("promotes the originating article over the Leader homepage", () => {
    const used = preferStoryUrls([HOME, INDEX], [STORY], HEADLINE);
    assert.equal(used[0], STORY);
    assert.ok(used.includes(HOME) || used.includes(INDEX));
  });

  it("turns the first Longmont Leader mention into a story link, not a homepage", () => {
    const body = "The Longmont Leader reported that the city cannot simply ban noisy planes.";
    const out = linkOutletInBody(body, [STORY]);
    assert.match(out, /\[Longmont Leader\]\(https:\/\/www\.longmontleader\.com\/local-news\/why-longmont/);
    assert.doesNotMatch(out, /\]\(https:\/\/www\.longmontleader\.com\/\)/);
  });

  it("does not nest a link inside an existing markdown credit", () => {
    const body = `The [Longmont Leader](${STORY}) reported that the city cannot simply ban noisy planes.`;
    const out = linkOutletInBody(body, [STORY]);
    assert.equal(out, body);
  });
});

describe("collapseRepeatedParagraphs", () => {
  it("drops consecutive restatements of the August 31 construction announcement", () => {
    const body = [
      "The city announced construction begins August 31 on Group 2 water lines.",
      "According to the city, construction will begin August 31 on Group 2 water lines.",
      "Construction is scheduled to start August 31 on Group 2 water lines.",
      "Residents along Hover Street will see lane closures for six weeks.",
    ].join("\n\n");
    const out = collapseRepeatedParagraphs(body);
    assert.match(out, /Hover Street/);
    const paras = out.split(/\n{2,}/);
    assert.ok(paras.length <= 3, `expected some collapse, got ${paras.length}: ${out}`);
  });

  it("keeps a richer paragraph that shares the short paragraph's vocabulary", () => {
    const body = [
      "Council approved the Acme contract Tuesday.",
      "Council approved the Acme contract Tuesday for $2.4 million, covering three water projects through 2028 after rejecting the lower bidder on technical grounds.",
    ].join("\n\n");
    const out = collapseRepeatedParagraphs(body);
    assert.match(out, /\$2\.4 million/);
    assert.match(out, /2028/);
    assert.match(out, /lower bidder/);
  });
});

describe("stripAiFiller", () => {
  it("removes empty initiative-underscores paragraphs", () => {
    const out = stripAiFiller(
      "Council awarded the contract.\n\nThis initiative underscores the city's commitment to excellence.",
    );
    assert.match(out, /awarded the contract/);
    assert.doesNotMatch(out, /initiative underscores/);
  });

  it("keeps a sentence that starts like filler but contains actual reporting", () => {
    const out = stripAiFiller(
      "This development marks the first time Longmont has split a $2.4 million water contract across two fiscal years.",
    );
    assert.match(out, /\$2\.4 million/);
  });
});

describe("stripReporterNotebook", () => {
  it("drops a Next checks closer that is reporter homework, not the story", () => {
    const out = stripReporterNotebook(
      [
        "Ursa Major said it will expand the Berthoud campus.",
        "Next checks are the full Leader open and IPO stories, Ursa Major’s own release and any SEC/SPAC filing, Longmont planning or ED files on the site, and Berthoud notices on the expansion.",
      ].join("\n\n"),
    );
    assert.match(out, /Berthoud campus/);
    assert.doesNotMatch(out, /Next checks/);
    assert.doesNotMatch(out, /SEC\/SPAC/);
  });

  it("drops a solid/not-solid scorecard paragraph", () => {
    const out = stripReporterNotebook(
      [
        "Ursa Major said it will expand the Berthoud campus.",
        "**What is solid from local headlines:** a Longmont facility opening reported Aug. 21. **What is not solid yet:** address and operations detail.",
      ].join("\n\n"),
    );
    assert.match(out, /Berthoud campus/);
    assert.doesNotMatch(out, /What is solid/);
    assert.doesNotMatch(out, /not solid yet/);
  });

  it("cuts trailers even when they share a graf or use single newlines", () => {
    const out = stripReporterNotebook(
      "City incentives do not show up in the snippets reviewed.\n**What is solid from local headlines:** a Longmont facility opening reported Aug. 21.\nNext checks are the full Leader open and IPO stories, Ursa Major’s own release and any SEC/SPAC filing.",
    );
    assert.match(out, /City incentives/);
    assert.doesNotMatch(out, /What is solid/);
    assert.doesNotMatch(out, /Next checks/);
    assert.doesNotMatch(out, /SEC\/SPAC/);
  });
});

describe("looksLikeRewrite", () => {
  it("flags a draft that mostly copies the announcing source verbatim", () => {
    const src =
      "The City of Longmont announced that construction on the Group 2 waterline replacement will begin August 31. Work starts August 31.";
    const body =
      "The City of Longmont announced that construction on the Group 2 waterline replacement will begin August 31. Work starts August 31. Officials said construction on the Group 2 waterline replacement will begin August 31.";
    assert.equal(looksLikeRewrite(body, src), true);
  });

  it("does not flag reporting that adds locations and cost", () => {
    const src = "Construction begins August 31.";
    const body =
      "Longmont will shut parts of Hover Street starting August 31 as crews replace Group 2 water lines, a phase city documents describe as the stretch between 9th and 17th. The packet lists the contract at $2.4 million. What the announcement does not say is which hydrants go offline.";
    assert.equal(looksLikeRewrite(body, src), false);
  });

  it("does not treat grounded factual vocabulary as a rewrite", () => {
    const src =
      "Council approved the Acme Holdings water contract Tuesday for $2.4 million.";
    const body =
      "Longmont City Council voted Tuesday to award Acme Holdings a $2.4 million water contract. The award covers three projects through 2028. The packet does not name the neighborhoods that lose water during construction.";
    assert.equal(looksLikeRewrite(body, src), false);
  });
});

describe("asStoryForm", () => {
  it("maps civic-brief to brief and defaults to reported", () => {
    assert.equal(asStoryForm("civic-brief"), "brief");
    assert.equal(asStoryForm("explainer"), "explainer");
    assert.equal(asStoryForm("nope"), "reported");
  });
});

describe("provenance merge", () => {
  it("keeps the exact document URL", () => {
    const url = "https://longmontcolorado.gov/water/group-2-notice.html";
    const items = provenanceFromUrls([url]);
    assert.equal(items[0]!.url, url);
    assert.match(items[0]!.title, /group 2/i);
  });

  it("does not let blank capture metadata overwrite a reported title, org, date, or role", () => {
    const url = "https://longmontcolorado.gov/water/group-2-staff-report.pdf";
    const items = provenanceFromUrls(
      [url],
      [
        {
          url,
          title: "Group 2 staff report",
          organization: "City of Longmont",
          document_date: "2026-08-12",
          role: "attachment",
        },
        {
          url,
          title: "",
          organization: "",
          document_date: "",
          captured_at: "2026-08-25T12:00:00.000Z",
          version_id: 7,
          version_count: 3,
          disappeared: false,
        },
      ],
    );
    assert.equal(items[0]!.title, "Group 2 staff report");
    assert.equal(items[0]!.organization, "City of Longmont");
    assert.equal(items[0]!.document_date, "2026-08-12");
    assert.equal(items[0]!.role, "attachment");
    assert.equal(items[0]!.captured_at, "2026-08-25T12:00:00.000Z");
    assert.equal(items[0]!.version_id, 7);
    assert.equal(items[0]!.version_count, 3);
  });

  it("does not let the model mint a provenance URL we did not fetch", () => {
    const used = "https://longmontcolorado.gov/water/group-2-notice.html";
    const invented = "https://invented.example/press-release";
    const items = provenanceFromUrls(
      [used],
      [{ url: invented, title: "A press release the model dreamed", role: "primary" }],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]!.url, used);
    assert.ok(!items.some((i) => i.url === invented));
  });

  it("lets forensic disappearance win while keeping the reported title", () => {
    const base: ProvenanceItem = {
      title: "August water report",
      organization: "City of Longmont",
      document_date: "2026-08-01",
      url: "https://longmontcolorado.gov/water/report.pdf",
      captured_at: null,
      version_id: null,
      version_count: null,
      disappeared: false,
      role: "source",
    };
    const merged = mergeProvenanceItem(base, {
      url: base.url,
      disappeared: true,
      captured_at: "2026-08-20T00:00:00.000Z",
      version_id: 4,
    });
    assert.equal(merged.title, "August water report");
    assert.equal(merged.disappeared, true);
    assert.equal(merged.version_id, 4);
  });
});

describe("What TownReporter found", () => {
  const prov: ProvenanceItem[] = [
    {
      title: "Packet",
      organization: "longmontcolorado.gov",
      document_date: "",
      url: "https://longmontcolorado.gov/packet.pdf",
      captured_at: "2026-08-25T12:00:00.000Z",
      version_id: 11,
      version_count: 2,
      capture_event_id: 21,
      disappeared: false,
      role: "followed",
    },
  ];

  it("publishes a finding bound to a captured version", () => {
    const findings = parseFindings({
      text: "The packet lists the Group 2 contract at $2.4 million.",
      source_urls: ["https://longmontcolorado.gov/packet.pdf"],
      artifact_version_ids: [11],
      locators: ["page:60"],
    });
    const pub = resolvePublicFindings(findings, prov);
    assert.equal(pub.length, 1);
    assert.match(pub[0]!.text, /\$2\.4 million/);
  });

  it("does not render the public module for a URL with no capture binding", () => {
    const findings = parseFindings({
      text: "The packet lists the Group 2 contract at $2.4 million.",
      source_urls: ["https://longmontcolorado.gov/packet.pdf"],
    });
    const pub = resolvePublicFindings(findings, prov);
    assert.equal(pub.length, 0);
  });

  it("does not render the public module for an unbound model assertion", () => {
    const findings = parseFindings({
      text: "A source said the mayor privately promised the vendor the award.",
      source_urls: [],
      artifact_version_ids: [],
    });
    const pub = resolvePublicFindings(findings, prov);
    assert.equal(pub.length, 0);
  });
});

describe("four reporting lanes", () => {
  it("spends a four-search budget as one query per lane, not four context searches", () => {
    const allocated = allocateLaneQueries(
      {
        context: [
          "CTX-1 Group 2 prior schedule Longmont",
          "CTX-2 Group 2 2025 contract Longmont",
          "CTX-3 Group 2 earlier phase Longmont",
          "CTX-4 Group 2 council history Longmont",
        ],
        stakeholders: ["STK-1 Group 2 Hover Street residents Longmont"],
        contradiction: ["CTR-1 Group 2 delay valve shortage Longmont"],
        gaps: ["GAP-1 Group 2 contract amount Longmont"],
      },
      4,
    );
    assert.equal(allocated.length, 4);
    assert.deepEqual(
      allocated.map((a) => a.lane),
      ["context", "stakeholders", "contradiction", "gaps"],
    );
    assert.match(allocated[0]!.query, /^CTX-1/);
    assert.match(allocated[1]!.query, /^STK-1/);
    assert.match(allocated[2]!.query, /^CTR-1/);
    assert.match(allocated[3]!.query, /^GAP-1/);
    assert.equal(allocated.filter((a) => a.lane === "context").length, 1);
  });

  it("gives leftover explainer budget to remaining high-value searches after each lane has one", () => {
    const allocated = allocateLaneQueries(
      {
        context: ["CTX-1 prior Longmont", "CTX-2 earlier Longmont"],
        stakeholders: ["STK-1 residents Longmont"],
        contradiction: ["CTR-1 delay Longmont"],
        gaps: ["GAP-1 cost Longmont"],
      },
      6,
    );
    assert.equal(allocated.length, 5);
    assert.equal(allocated.filter((a) => a.lane === "context").length, 2);
    assert.equal(allocated[4]!.query, "CTX-2 earlier Longmont");
  });
});

describe("brief challenge", () => {
  const lead: LeadRow = {
    id: 9,
    headline: "Park closure begins Monday",
    why: "City announcement",
    topic: "planning",
    status: "new",
    source_urls: "[]",
    evidence: "",
    newsworthiness: 6,
    created_at: new Date().toISOString(),
  };

  it("promotes a brief when the challenge finds money and remediation", () => {
    assert.equal(
      challengeLooksSubstantive(
        "The park is closing because a $3.7 million remediation project begins Monday.",
      ),
      true,
    );
    const q = briefChallengeQuery(lead, {
      form: "brief",
      lanes: { contradiction: ["Sunset Park remediation cost Longmont"] },
    });
    assert.match(q, /Sunset Park remediation/);
    assert.equal(
      chooseStoryForm({
        candidate: "brief",
        challengePromoted: true,
        body: "Sunset Park closes Monday for a $3.7 million remediation project.",
        extraDocs: 2,
      }),
      "reported",
    );
  });

  it("keeps a genuine small item a brief", () => {
    assert.equal(
      challengeLooksSubstantive(
        "The Longmont Public Library closes two hours early Friday for scheduled maintenance.",
      ),
      false,
    );
    assert.equal(
      chooseStoryForm({
        candidate: "brief",
        written: "brief",
        challengePromoted: false,
        body: "The library closes two hours early Friday for scheduled maintenance.",
        extraDocs: 0,
      }),
      "brief",
    );
  });
});

describe("large-document retrieval", () => {
  it("pulls cost, amendment and contradiction from deep pages, not only the prefix", () => {
    const pages = Array.from({ length: 200 }, (_, i) => {
      const page = i + 1;
      if (page === 1) {
        return { page, text: "City announcement: Group 2 construction begins August 31." };
      }
      if (page === 60) {
        return { page, text: "Staff report: the Group 2 contract is $4.1 million." };
      }
      if (page === 140) {
        return {
          page,
          text: "Amendment 3 shifts the completion date from June 2027 to March 2028.",
        };
      }
      if (page === 180) {
        return {
          page,
          text: "Staff now says work was delayed from June because of a valve shortage.",
        };
      }
      return { page, text: `Routine appendix filler for page ${page}.` };
    });
    const chunks = retrieveRelevantChunks(
      [
        {
          url: "https://longmontcolorado.gov/packet.pdf",
          title: "Council packet",
          text: pages.map((p) => p.text).join("\n\n"),
          pages,
        },
      ],
      ["cost", "contract", "amendment", "delay", "valve", "Group 2"],
    );
    const blob = chunks.map((c) => c.excerpt).join("\n");
    assert.match(blob, /\$4\.1 million/);
    assert.match(blob, /Amendment 3/);
    assert.match(blob, /valve shortage/);
    assert.ok(
      chunks.some((c) => c.page_number === 60 || c.page_number === 140 || c.page_number === 180),
    );
  });

  it("finds the vote in a long meeting tape instead of the hold music", () => {
    const hold = Array.from({ length: 120 }, (_, i) => `[${i}:00] Hey, hey, hey. Heat. Heat. I love you.`).join("\n");
    const vote = `[4:59:47] And that carries 4 to 2 with council member Christ and council member Prito in opposition and Mayor Prom not voting.
[5:00:02] Okay, I'm going to skip it all. We're going to the end.`;
    const chunks = retrieveRelevantChunks(
      [
        {
          url: "https://www.youtube.com/watch?v=7OdoRvfRArI",
          title: "City Council Regular Session - 08/25/2026",
          text: `YouTube transcript from More → Show transcript\n${hold}\n${vote}`,
        },
      ],
      ["skip it all", "Christ", "4 to 2", "vote"],
    );
    const blob = chunks.map((c) => c.excerpt).join("\n");
    assert.match(blob, /skip it all/i);
    assert.match(blob, /Christ/);
    assert.doesNotMatch(chunks[0]?.excerpt ?? "", /^\[0:00\] Hey, hey, hey/);
  });
});

describe("describeTextChanges", () => {
  it("reports added and removed sentences", () => {
    const d = describeTextChanges(
      "Construction begins August 31. The contract is $2 million.",
      "Construction begins August 31. The contract is $2.4 million after amendment.",
    );
    assert.ok(d.removed.some((s) => /\$2 million/.test(s)));
    assert.ok(d.added.some((s) => /\$2\.4 million/.test(s)));
  });
});

describe("rankWorthItems", () => {
  it("surfaces a missing water report ahead of a low-priority lead", () => {
    const ranked = rankWorthItems({
      anomalies: [
        {
          kind: "missing-cadence",
          summary: "Expected water report has not appeared",
          url: "https://longmontcolorado.gov/water/water-quality-report.html",
          details:
            "This report has posted monthly between the 4th and 8th for the last 11 months. No August report has been located as of Aug. 12.",
        },
      ],
      leads: [
        {
          id: 9,
          headline: "Routine newsletter",
          why: "City sent a newsletter",
          evidence: "",
          newsworthiness: 3,
          source_urls: "[]",
        },
      ],
    });
    assert.ok(ranked.length >= 1);
    assert.match(ranked[0]!.title, /water report/i);
    assert.match(ranked[0]!.question, /delayed|renamed|cancelled/i);
    assert.ok(ranked[0]!.seed.includes("August"));
  });

  it("keeps a reopened exhausted lead", () => {
    const ranked = rankWorthItems({
      frontier: [
        {
          label: "Acme Holdings LLC",
          kind: "company",
          why: "Named on a new contract",
          status: "reopened",
          closed_reason: "No filings found in August",
        },
      ],
    });
    assert.equal(ranked[0]!.kind, "reopened");
    assert.match(ranked[0]!.why, /parked/i);
  });

  it("surfaces an open promise that never came back", () => {
    const ranked = rankWorthItems({
      promises: [
        {
          who_promised: "Public Works",
          what: "File the Group 2 construction notice",
          when_due: "August 2026",
          source_cite: "July 14 council minutes",
          status: "open",
        },
      ],
    });
    assert.equal(ranked[0]!.kind, "promise");
    assert.match(ranked[0]!.question, /agenda|dropped/i);
  });

  it("keeps unknown and future frontier kinds eligible", () => {
    const ranked = rankWorthItems({
      frontier: [
        {
          label: "Riverstone Consultants",
          kind: "consultant",
          why: "Named in the staff report as the traffic study vendor",
          status: "open",
          closed_reason: null,
        },
        {
          label: "Unexplained wire 4411",
          kind: "future-kind-we-have-never-seen",
          why: "Appears in a disbursement log with no matching agenda item",
          status: "open",
          closed_reason: null,
        },
      ],
      anomalies: [
        {
          kind: "disappeared",
          summary: "Expected water report taken down",
          url: "https://longmontcolorado.gov/water/report.html",
          details: "Was present last month.",
        },
      ],
    });
    assert.ok(ranked.some((r) => r.kind === "consultant"));
    assert.ok(ranked.some((r) => r.kind === "future-kind-we-have-never-seen"));
    assert.equal(ranked[0]!.kind, "disappeared");
  });
});

describe("linkOutletInBody misattribution", () => {
  /**
   * The rail-tax story linked "the Longmont Times-Call reported Thursday" to
   * the paper's high-school sports section, and ended with "Read the original:
   * uchealth.org" — a hospital press release with nothing to do with it.
   */
  it("does not link a paper's name to one of its section fronts", () => {
    const body = "The Longmont Times-Call reported Thursday that the board acted.";
    const out = linkOutletInBody(body, ["https://www.timescall.com/sports/high-school-sports/"]);
    assert.equal(out, body);
  });

  it("still links the paper's name to a real article", () => {
    const url = "https://www.timescall.com/2026/08/28/front-range-rail-sales-tax-ballot/";
    const out = linkOutletInBody("The Longmont Times-Call reported Thursday.", [url]);
    assert.ok(out.includes(`](${url})`));
  });

  it("does not append a read-the-original line for an unrecognised host", () => {
    const body = "The board referred a sales tax.";
    const out = linkOutletInBody(body, [
      "https://www.uchealth.org/newsroom/longs-peak-hospital-expansion-halfway/",
    ]);
    assert.doesNotMatch(out, /Read the original/);
  });

  /**
   * "The original" is a claim about where the story came from, and nothing
   * checked it. A 2026 story about a house explosion ended with "Read the
   * original: Longmont Times-Call" pointing at a 2022 gas-main closure item
   * that a search had swept into the source list.
   */
  it("does not credit a source the story never mentions", () => {
    const body = "A home exploded on 15th Avenue on Aug. 8.";
    const stale = "https://www.timescall.com/2022/06/10/closure-of-hover-and-17th-for-gas-main-repair/";
    const out = linkOutletInBody(body, [stale]);
    assert.equal(out, body);
    assert.doesNotMatch(out, /Read the original/);
  });

  it("still links an outlet the prose does name", () => {
    const url = "https://www.dailycamera.com/2026/08/28/boulder-county-rail-tax-vote/";
    const out = linkOutletInBody("The Daily Camera reported the vote.", [url]);
    assert.match(out, /\[Daily Camera\]\(/);
  });
});

describe("provenance titles", () => {
  const URL_ = "https://www.longmontleader.com/local-news/church-commits-40k-for-san-lazaro";

  /**
   * A fetch that returns the site's own hostname as the page title produced a
   * provenance row reading "www.longmontleader.com" above "longmontleader.com",
   * between two rows naming real headlines. It looked like a rendering fault.
   */
  it("replaces a title that is only the hostname", () => {
    const [item] = provenanceFromUrls([URL_], [{ url: URL_, title: "www.longmontleader.com" }]);
    assert.notEqual(item!.title.toLowerCase(), "www.longmontleader.com");
    assert.match(item!.title, /Church Commits/i);
  });

  it("keeps a real headline exactly as fetched", () => {
    const title = "Church commits $40,000 toward resident purchase";
    const [item] = provenanceFromUrls([URL_], [{ url: URL_, title }]);
    assert.equal(item!.title, title);
  });

  it("still fills a missing title from the path", () => {
    const [item] = provenanceFromUrls([URL_]);
    assert.match(item!.title, /Church Commits/i);
  });
});
