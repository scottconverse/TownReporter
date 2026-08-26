import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asStoryForm,
  collapseRepeatedParagraphs,
  describeSourceUrl,
  looksLikeRewrite,
  provenanceFromUrls,
  stripAiFiller,
} from "./report.ts";
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
    assert.ok(paras.length <= 2, `expected collapse, got ${paras.length}: ${out}`);
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

describe("looksLikeRewrite", () => {
  it("flags a draft that mostly echoes the announcing source", () => {
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
});

describe("asStoryForm", () => {
  it("maps civic-brief to brief and defaults to reported", () => {
    assert.equal(asStoryForm("civic-brief"), "brief");
    assert.equal(asStoryForm("explainer"), "explainer");
    assert.equal(asStoryForm("nope"), "reported");
  });
});

describe("provenanceFromUrls", () => {
  it("keeps the exact document URL", () => {
    const url = "https://longmontcolorado.gov/water/group-2-notice.html";
    const items = provenanceFromUrls([url]);
    assert.equal(items[0]!.url, url);
    assert.match(items[0]!.title, /group 2/i);
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
});
