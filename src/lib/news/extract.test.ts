import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyClaimKind,
  detectMissingCadence,
  detectPatternAnomalies,
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
