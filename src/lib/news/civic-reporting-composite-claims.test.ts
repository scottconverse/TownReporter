import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindStoryClaimsToEvidence, type DocumentRead } from "./civic-reporting-run.server.ts";
import type { PackageClaim, PackageSource, PackageStory } from "./civic-reporting.ts";

const MEMO_URL = "https://longmontcolorado.gov/wp-content/uploads/2026/09/Council-Communication-9-29-26.pdf";
const MEMO_TITLE = "City Council Communication, Sept. 29, 2026 — 2027 Proposed Budget Presentation and First Public Hearing";

// Compact verbatim excerpts from request 14's retained all-documents.json,
// D1, page 3. The fixture is inline so this regression never reads local data.
const PAGE_3 = [
  "SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET",
  "Several changes have been made to the Proposed 2027 Budget since it was first presented to Council on",
  "September 1st. In total, these changes affected two funds, resulting in a net decrease of $1,183,625 in",
  "projected revenues and a $2,829,858 reduction in expenses. Following these changes, the revised total",
  "budget for 2027 is $544,645,951.",
  "GENERAL FUND",
  "Ongoing Budget Adjustments",
  "As mentioned previously, preliminary property tax certifications from the county came in $511,000 lower",
  "than originally anticipated. As a result, the General Fund needs to be adjusted to reflect a $511,000",
  "decrease in ongoing property tax revenue. This brings the new ongoing property tax amount to",
  "$29,698,908. Since the Human Services Agencies funding is based on 3% of budgeted tax revenue, the",
  "decrease in property tax results in a $15,330 decrease, bringing the 2027 proposed budget for Human",
  "Service Agency funding to $2,947,545. To balance the ongoing property tax reduction, staff is proposing",
  "to budget a “savings” of $495,670 in the non-departmental budget service. After the first of the year the",
  "City Manager and finance staff will begin meeting with departments to start the zero-based budgeting",
  "process. As part of those meetings staff will be identifying department line items where the savings for",
  "2027 will come from. Budget adjustments will be made to reduce the department budgets to offset this",
  "negative budget adjustment in the non-departmental budget service.",
  "One- Time Budget Adjustments",
  "The proposed General Fund budget includes a one-time transfer of $672,625 to the Public Improvement",
  "Fund for costs associated with the 1st and Main Transit Hub. These funds are instead needed in 2026",
  "and are therefore being removed from the proposed 2027 budget. An ordinance will come to council in",
  "October to appropriate this amount in 2026.",
  "These changes bring the General Fund 2027 proposed budget to $132,532,296.",
  "PUBLIC IMPROVEMENT FUND",
  "The above one-time transfer of $672,625 from the General Fund also needs to be removed as revenue",
  "from the Public Improvement Fund. In addition, the 2027 proposed budget included $1,646,233 set",
  "aside for CIP project TRP131, 1st and Main Transit Station Area Improvements. These funds are needed",
  "in 2026 to begin construction prior to year end and are therefore being removed from the proposed",
  "2027 budget. These funds will be included in the appropriation ordinance that will come to council in",
  "October.",
  "These changes bring the Public Improvement Fund 2027 proposed budget to $11,388,343.",
].join("\n");

const SOURCE_LOCATOR = "p.3, \"Summary of Changes to the Proposed 2027 Budget\" — General Fund \"Ongoing Budget Adjustments\" and \"One-Time Budget Adjustments\"; Public Improvement Fund section";

const memoDocument: DocumentRead = {
  url: MEMO_URL,
  title: MEMO_TITLE,
  ok: true,
  text: PAGE_3.replace(/\s+/g, " ").trim(),
  reason: "",
  pages: [{
    page: 3,
    text: PAGE_3.replace(/\s+/g, " ").trim(),
    layoutText: PAGE_3,
  }],
};

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

function packageFor(claim: PackageClaim): PackageStory {
  const source: PackageSource = {
    id: "S1",
    title: MEMO_TITLE,
    tier: "A",
    url: MEMO_URL,
    locator: SOURCE_LOCATOR,
    offlineReference: "",
  };
  return {
    id: "request-14-composite-claim-binding",
    headline: "Revised 2027 budget proposal",
    draft: claim.text,
    plainBrief: "",
    cannotSay: "",
    readinessTier: 2,
    claims: [claim],
    sources: [source],
  };
}

function bind(claim: PackageClaim) {
  return bindStoryClaimsToEvidence(packageFor(claim), EMPTY_RECONCILIATION, EMPTY_RECORD, [memoDocument]);
}

const actualClaims: Array<{ claim: PackageClaim; locator: string }> = [
  {
    claim: {
      id: "C4",
      text: "Preliminary property tax certifications from the county came in $511,000 lower than originally anticipated, and the memo states this brings the new ongoing property tax amount to $29,698,908.",
      item: "Ongoing property tax reduction and revised ongoing property tax amount",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    },
    locator: "p. 3, Ongoing Budget Adjustments",
  },
  {
    claim: {
      id: "C5",
      text: "To balance the ongoing property tax reduction, staff propose budgeting a \"savings\" of $495,670 in the non-departmental budget service, with department line items to be identified after the first of the year through zero-based budgeting.",
      item: "Proposed $495,670 non-departmental savings entry",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    },
    locator: "p. 3, Ongoing Budget Adjustments",
  },
  {
    claim: {
      id: "C7",
      text: "The proposed General Fund budget included a one-time transfer of $672,625 to the Public Improvement Fund for costs associated with the 1st and Main Transit Hub, which the memo says is instead needed in 2026 and is being removed from the proposed 2027 budget.",
      item: "One-time General Fund transfer removal",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    },
    locator: "p. 3, One- Time Budget Adjustments",
  },
  {
    claim: {
      id: "C9",
      text: "The 2027 proposed budget included $1,646,233 set aside for CIP project TRP131, 1st and Main Transit Station Area Improvements, which the memo says is needed in 2026 to begin construction prior to year end and is being removed from the proposed 2027 budget.",
      item: "TRP131 set-aside removal",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    },
    locator: "p. 3, PUBLIC IMPROVEMENT FUND",
  },
  {
    claim: {
      id: "C12",
      text: "The Sept. 29 memo states the changes affected two funds, resulting in a net decrease of $1,183,625 in projected revenues and a $2,829,858 reduction in expenses, and that the revised total budget for 2027 is $544,645,951.",
      item: "Revised total budget and net changes",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    },
    locator: "p. 3, SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET",
  },
];

describe("request 14 composite source claims bind to their one supporting child section", () => {
  for (const { claim, locator } of actualClaims) {
    it(claim.id + " binds to its single exact page 3 child section", () => {
      const result = bind(claim);
      const boundClaim = result.claims[0]!;

      assert.equal(boundClaim.status, "VERIFIED", boundClaim.nextCheck);
      assert.equal(boundClaim.sourceIds.length, 1);
      const source = result.sources.find((row) => row.id === boundClaim.sourceIds[0]);
      assert.ok(source);
      assert.equal(source.locator, locator);
    });
  }

  it("keeps C13 held because its General Fund and Public Improvement Fund totals span two child sections", () => {
    const result = bind({
      id: "C13",
      text: "The memo states these changes bring the General Fund 2027 proposed budget to $132,532,296 and the Public Improvement Fund 2027 proposed budget to $11,388,343.",
      item: "Revised General Fund and Public Improvement Fund totals",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    });

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
  });

  it("keeps a wrong-subject Human Services $511,000 claim held", () => {
    const result = bind({
      id: "wrong-hsa-amount",
      text: "Human Services Agency funding decreased by $511,000.",
      item: "Human Services Agency funding reduction",
      status: "VERIFIED",
      sourceIds: ["S1"],
      nextCheck: "",
    });

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
  });
});