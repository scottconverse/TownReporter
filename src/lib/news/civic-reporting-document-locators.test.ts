import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindStoryClaimsToEvidence, type DocumentRead } from "./civic-reporting-run.server.ts";
import type { PackageStory } from "./civic-reporting.ts";

const D4_URL = "https://longmontcolorado.gov/finance/budget-office/2027-budget-documents/";
const D4_TITLE = "2027 Budget Documents - City of Longmont";
const OCTOBER_6 = "October 6 – Regular Meeting";
const OCTOBER_20 = "October 20 –  Regular Meeting";

// Exact October 6–20 slice from request 11's saved D4 HTML extraction:
// .townreporter/reporting/request-11/document-4.txt and document-digest.txt.
const D4_SCHEDULE_SLICE = [
  OCTOBER_6,
  "",
  "Final direction from Council",
  "",
  "Second public hearing",
  "",
  "First reading of mill levy ordinances and Ordinance updating UBCIS Fund",
  "",
  OCTOBER_20,
  "",
  "Second reading of mill levy ordinances and Ordinance updating UBCIS Fund",
  "",
  "November 17 – Regular Meeting",
  "",
  "First reading budget adoption and appropriation ordinances",
].join("\n");

const EMPTY_RECONCILIATION = {
  actions: [],
  contradictions: [],
  warmOnly: [],
  coldOnly: [],
  voteMismatches: [],
  matched: 0,
} as never;
const EMPTY_RECORD = {
  segments: [],
  identity: { videoId: "", videoUrl: "" },
} as never;

function documentRead(text: string, pages?: DocumentRead["pages"]): DocumentRead {
  return {
    url: D4_URL,
    title: D4_TITLE,
    ok: true,
    text,
    reason: "",
    ...(pages === undefined ? {} : { pages }),
  };
}

function story(locator: string, quote = "Second public hearing"): PackageStory {
  return {
    id: "request-11-d4-calendar",
    headline: "Longmont's proposed budget schedule",
    draft: "The October 6 council calendar includes a second public hearing.",
    plainBrief: "",
    cannotSay: "",
    readinessTier: 2,
    claims: [{
      id: "C1",
      item: "October 6 Regular Meeting",
      text: "The October 6 budget schedule includes \"" + quote + "\" and first reading of mill levy ordinances.",
      status: "VERIFIED",
      sourceIds: ["D4"],
      nextCheck: "",
    }],
    sources: [{
      id: "D4",
      title: D4_TITLE,
      tier: "A",
      url: D4_URL,
      locator,
      offlineReference: "",
    }],
  };
}

function bind(locator: string, document: DocumentRead, quote?: string) {
  return bindStoryClaimsToEvidence(
    story(locator, quote),
    EMPTY_RECONCILIATION,
    EMPTY_RECORD,
    [document],
  );
}

const noPagesCases: Array<[string, DocumentRead["pages"]]> = [
  ["pages omitted", undefined],
  ["an explicit null page", [{ page: null, text: D4_SCHEDULE_SLICE }]],
];

describe("request 11 D4 unpaginated calendar locator binding", () => {
  for (const [description, pages] of noPagesCases) {
    it("binds the exact October 6 section and its matching quote when " + description, () => {
      const result = bind(
        "Section: " + OCTOBER_6,
        documentRead(D4_SCHEDULE_SLICE, pages),
      );
      const claim = result.claims[0]!;

      assert.equal(claim.status, "VERIFIED");
      assert.equal(claim.sourceIds.length, 1);
      const preciseSource = result.sources.find((source) => source.id === claim.sourceIds[0]);
      assert.ok(preciseSource);
      assert.equal(preciseSource.url, D4_URL);
      assert.equal(preciseSource.locator, "Section: " + OCTOBER_6);
      assert.doesNotMatch(preciseSource.locator, /\bp(?:age)?\.?\s*\d/i, "HTML must not receive an invented PDF page");
    });
  }

  it("does not verify a quote found only in the generated source title, not the cited body", () => {
    const result = bind(
      "Section: " + OCTOBER_6,
      documentRead(D4_SCHEDULE_SLICE),
      "2027 Budget Documents",
    );

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
    assert.match(result.claims[0]!.nextCheck, /quotation unverified/i);
  });

  it("does not let the October 20 section verify the October 6 schedule claim", () => {
    const result = bind(
      "Section: " + OCTOBER_20,
      documentRead(D4_SCHEDULE_SLICE),
    );

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
    assert.match(result.claims[0]!.nextCheck, /quotation unverified|date is not in this item's own record/i);
  });

  it("keeps the combined October 6 and October 20 locator held", () => {
    const combined = "Section: " + OCTOBER_6 + "; " + OCTOBER_20;
    const result = bind(combined, documentRead(D4_SCHEDULE_SLICE));

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
    assert.equal(result.sources.find((source) => source.id === "D4")?.locator, combined);
    assert.ok(!result.sources.some((source) => /^Section: October 6 – Regular Meeting$/.test(source.locator)));
  });
});