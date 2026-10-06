import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindStoryClaimsToEvidence, type DocumentRead } from "./civic-reporting-run.server.ts";
import type { PackageClaim, PackageSource, PackageStory } from "./civic-reporting.ts";

const MEMO_URL = "https://longmontcolorado.gov/wp-content/uploads/2026/09/Council-Communication-9-29-26.pdf";
const SLIDES_URL = "https://longmontcolorado.gov/wp-content/uploads/2026/09/2027_Budget-Presentation-9-29-26smaller.pdf";

// Compact verbatim excerpts from request 12's saved all-documents.json:
// D1, page 3, Ongoing Budget Adjustments.
const MEMO_PAGE_3 = [
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
].join("\n");

// Compact verbatim layout excerpt from request 12's saved all-documents.json:
// D3, page 27, General Fund Changes. The column labels intentionally precede rows.
const SLIDE_27_LAYOUT = [
  "GENERAL FUND CHANGES",
  "UPDATED",
  "PROPOSED",
  "BUDGET",
  "PROPOSED",
  "CHANGES",
  "ORIGINAL",
  "PROPOSED",
  "BUDGET",
  "$ 126,988,855($ 511,000)$ 127,499,855Revenues",
  "132,532,296( 1,183,625)133,715,921Expenses",
  "5,543,441( 672,625)6,216,066Use of Fund Balance",
  "Revenue Changes",
  "o $511,000 reduction in ongoing property taxes",
  "Expense Changes",
  "o $15,330 reduction for Human Services Agency funding",
  "o $495,670 reduction for budget “savings” adjustment",
  "o $672,625 reduction for one-time transfer to Public Improvement Fund",
  "27",
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

const memoDocument: DocumentRead = {
  url: MEMO_URL,
  title: "Council-Communication-9-29-26.pdf",
  ok: true,
  text: MEMO_PAGE_3.replace(/\s+/g, " ").trim(),
  reason: "",
  pages: [{
    page: 3,
    text: MEMO_PAGE_3.replace(/\s+/g, " ").trim(),
    layoutText: MEMO_PAGE_3,
  }],
};
const slideDocument: DocumentRead = {
  url: SLIDES_URL,
  title: "2027_Budget-Presentation-9-29-26smaller.pdf",
  ok: true,
  text: SLIDE_27_LAYOUT.replace(/\s+/g, " ").trim(),
  reason: "",
  pages: [{
    page: 27,
    text: SLIDE_27_LAYOUT.replace(/\s+/g, " ").trim(),
    layoutText: SLIDE_27_LAYOUT,
  }],
};

function packageFor(claim: PackageClaim, source: PackageSource): PackageStory {
  return {
    id: "replay-a-budget-binding",
    headline: "Revised 2027 budget",
    draft: claim.text,
    plainBrief: "",
    cannotSay: "",
    readinessTier: 2,
    claims: [claim],
    sources: [source],
  };
}

function bind(claim: PackageClaim, source: PackageSource, documents: DocumentRead[]) {
  return bindStoryClaimsToEvidence(
    packageFor(claim, source),
    EMPTY_RECONCILIATION,
    EMPTY_RECORD,
    documents,
  );
}

describe("request 12 replay-a exact document binding", () => {
  it("binds replay-a C3's anaphoric $29,698,908 property-tax sentence to the memo section", () => {
    const result = bind(
      {
        id: "C3",
        item: "General Fund — Ongoing Budget Adjustments",
        text: "Preliminary property tax certifications from the county came in $511,000 lower than originally anticipated, requiring a $511,000 decrease in ongoing General Fund property tax revenue and bringing ongoing property tax to $29,698,908.",
        status: "VERIFIED",
        sourceIds: ["S1"],
        nextCheck: "",
      },
      {
        id: "S1",
        title: memoDocument.title,
        tier: "A",
        url: MEMO_URL,
        locator: "p. 3, Ongoing Budget Adjustments",
        offlineReference: "",
      },
      [memoDocument],
    );

    assert.equal(result.claims[0]!.status, "VERIFIED", result.claims[0]!.nextCheck);
    assert.equal(result.claims[0]!.sourceIds.length, 1);
    assert.equal(result.sources.find((source) => source.id === result.claims[0]!.sourceIds[0])?.locator, "p. 3, Ongoing Budget Adjustments");
  });

  it("binds replay-a C7 to the exact Expense Changes child section after the slide's uppercase column labels", () => {
    const result = bind(
      {
        id: "C7",
        item: "General Fund Changes",
        text: "The Sept. 29 presentation lists the $495,670 as a reduction for a budget \"savings\" adjustment with no department line items named.",
        status: "VERIFIED",
        sourceIds: ["S2"],
        nextCheck: "",
      },
      {
        id: "S2",
        title: slideDocument.title,
        tier: "A",
        url: SLIDES_URL,
        locator: "page 27, General Fund Changes — Expense Changes",
        offlineReference: "",
      },
      [slideDocument],
    );

    assert.equal(result.claims[0]!.status, "VERIFIED", result.claims[0]!.nextCheck);
    assert.equal(result.claims[0]!.sourceIds.length, 1);
    assert.equal(result.sources.find((source) => source.id === result.claims[0]!.sourceIds[0])?.locator, "p. 27, Expense Changes");
  });

  it("does not let the General Fund Changes parent section borrow the $495,670 Expense Changes row", () => {
    const result = bind(
      {
        id: "C7",
        item: "General Fund Changes",
        text: "The Sept. 29 presentation lists the $495,670 as a reduction for a budget \"savings\" adjustment with no department line items named.",
        status: "VERIFIED",
        sourceIds: ["S2"],
        nextCheck: "",
      },
      {
        id: "S2",
        title: slideDocument.title,
        tier: "A",
        url: SLIDES_URL,
        locator: "page 27, General Fund Changes",
        offlineReference: "",
      },
      [slideDocument],
    );

    assert.equal(result.claims[0]!.status, "UNVERIFIED");
    assert.match(result.claims[0]!.nextCheck, /dollar figure is not in this item's own record/i);
  });

  it("keeps the wrong-subject $511,000 Human Services claim unverified", () => {
    const result = bind(
      {
        id: "wrong-subject",
        item: "Human Services Agency funding",
        text: "Human Services Agency funding fell by $511,000.",
        status: "VERIFIED",
        sourceIds: ["S1"],
        nextCheck: "",
      },
      {
        id: "S1",
        title: memoDocument.title,
        tier: "A",
        url: MEMO_URL,
        locator: "p. 3, Ongoing Budget Adjustments",
        offlineReference: "",
      },
      [memoDocument],
    );

    assert.equal(result.claims[0]!.status, "UNVERIFIED", result.claims[0]!.nextCheck);
    assert.match(result.claims[0]!.nextCheck, /not near the claim's named item/i);
  });
});

it("binds the actual General Fund table's spaced currency and implicit-dollar expense cells", () => {
  const result = bind({
    id: "C20", item: "General Fund Changes",
    text: "The General Fund Changes table shows a $511,000 revenue reduction and a $1,183,625 expense reduction.",
    status: "VERIFIED", sourceIds: ["table"], nextCheck: "",
  }, { id: "table", title: slideDocument.title, tier: "A", url: SLIDES_URL,
    locator: "p. 27, GENERAL FUND CHANGES", offlineReference: "" }, [slideDocument]);
  assert.equal(result.claims[0]!.status, "VERIFIED", result.claims[0]!.nextCheck);
});

it("does not turn a parenthesized expense reduction into an increase", () => {
  const result = bind({
    id: "opposite-direction", item: "General Fund expenses",
    text: "General Fund expenses increased by $1,183,625.",
    status: "VERIFIED", sourceIds: ["table"], nextCheck: "",
  }, { id: "table", title: slideDocument.title, tier: "A", url: SLIDES_URL,
    locator: "p. 27, GENERAL FUND CHANGES", offlineReference: "" }, [slideDocument]);
  assert.equal(result.claims[0]!.status, "UNVERIFIED", result.claims[0]!.nextCheck);
  const tableClaim = bind({
    id: "table-opposite-direction", item: "General Fund Changes",
    text: "The General Fund Changes table shows expenses increased by $1,183,625.",
    status: "VERIFIED", sourceIds: ["table"], nextCheck: "",
  }, { id: "table", title: slideDocument.title, tier: "A", url: SLIDES_URL,
    locator: "p. 27, GENERAL FUND CHANGES", offlineReference: "" }, [slideDocument]);
  assert.equal(tableClaim.claims[0]!.status, "UNVERIFIED", tableClaim.claims[0]!.nextCheck);
  assert.match(tableClaim.claims[0]!.nextCheck, /parenthesized reduction/);
});

it("binds the actual Public Improvement Fund table cells without treating population figures as dollars", () => {
  const layout = [
    "PUBLIC IMPROVEMENT FUND CHANGES", "UPDATED", "PROPOSED", "BUDGET", "PROPOSED", "CHANGES", "ORIGINAL", "PROPOSED", "BUDGET",
    "$ 10,720,663($ 672,625)$ 11,393,288Revenues",
    "11,388,343( 1,646,233)13,034,576Expenses",
    "667,680( 973,608)1,641,288Use of Fund Balance",
    "Revenue Changes", "o $672,625 reduction in transfers from General Fund",
    "Expense Changes", "o $1,646,233 reduction in expense set aside for TRP131 1st and Main Transit Facility", "28",
  ].join("\n");
  const document = { ...slideDocument, text: layout, pages: [{ page: 28, text: layout, layoutText: layout }] };
  const source: PackageSource = { id: "table", title: document.title, tier: "A", url: SLIDES_URL,
    locator: "p. 28, PUBLIC IMPROVEMENT FUND CHANGES", offlineReference: "" };
  const claim: PackageClaim = { id: "C21", item: "Public Improvement Fund Changes",
    text: "The Public Improvement Fund Changes table shows a $672,625 revenue reduction and a $1,646,233 expense reduction, with a $973,608 reduction in use of fund balance.",
    status: "VERIFIED", sourceIds: ["table"], nextCheck: "" };
  assert.equal(bind(claim, source, [document]).claims[0]!.status, "VERIFIED");
  const projectClaim = { ...claim, id: "C8", text: "The Public Improvement Fund changes include a $672,625 reduction in transfers from the General Fund and a $1,646,233 expense reduction for TRP131 1st and Main Transit Facility." };
  const projectHeld = bind(projectClaim, source, [document]);
  assert.equal(projectHeld.claims[0]!.status, "UNVERIFIED", "a parent fund table must not turn a fund total into support for an identified project");
  assert.match(projectHeld.claims[0]!.nextCheck, /does not identify project TRP131/);
  const populationLayout = "PUBLIC IMPROVEMENT FUND CHANGES\nThe Public Improvement Fund serves 973,608 residents.\nRevenue Changes\nNo dollar amount is specified.";
  const population = { ...document, pages: [{ page: 28, text: populationLayout, layoutText: populationLayout }] };
  const unsupported = bind({ ...claim, text: "The Public Improvement Fund reduction is $973,608." }, source, [population]);
  assert.equal(unsupported.claims[0]!.status, "UNVERIFIED", "a comma-grouped population count is not currency evidence");
});


describe("request 15 actual budget-calendar slide", () => {
 const calendar: DocumentRead = {"url":"https://longmontcolorado.gov/wp-content/uploads/2026/09/2027_Budget-Presentation-9-29-26smaller.pdf","title":"2027_Budget-Presentation-9-29-26smaller.pdf","ok":true,"text":"BUDGET MEETINGS September 1 – Regular Meeting • Presentation of the 2027 Proposed Budget and the 2027-2031 Capital Improvement Program • CIP overview and projects September 8 – Regular Meeting • Employee compensation and benefits • LDDA budgets September 15 – Study Session • 2027 budget summary • General Fund budget summary • Public Safety Fund budget summary • One-time expenses • Financial policies September 22 – Regular Meeting • Transportation funding • Utilities budget summaries September 29 – Study Session • NextLight budget summary • Airport budget summary • First public hearing October 6 – Regular Meeting • Final direction from Council • Second public hearing • First reading of mill levy ordinances October 20 – Regular Meeting • Second reading of mill levy ordinances November 17 - Regular Meeting • First reading ordinances for budget adoption and appropriation and UBCIS changes December 1 - Regular Meeting • Second reading ordinances for budget adoption and appropriation and UBCIS changes and associated resolutions 31","reason":"","pages":[{"page":31,"layoutText":"BUDGET MEETINGS\nSeptember 1 – Regular Meeting\n• Presentation of the 2027 Proposed\nBudget and the 2027-2031 Capital\nImprovement Program\n• CIP overview and projects\nSeptember 8 – Regular Meeting\n• Employee compensation and\nbenefits\n• LDDA budgets\nSeptember 15 – Study Session\n• 2027 budget summary\n• General Fund budget summary\n• Public Safety Fund budget\nsummary\n• One-time expenses\n• Financial policies\nSeptember 22 – Regular Meeting\n• Transportation funding\n• Utilities budget summaries\nSeptember 29 – Study Session\n• NextLight budget summary\n• Airport budget summary\n• First public hearing\nOctober 6 – Regular Meeting\n• Final direction from Council\n• Second public hearing\n• First reading of mill levy\nordinances\nOctober 20 – Regular Meeting\n• Second reading of mill levy\nordinances\nNovember 17 - Regular Meeting\n• First reading ordinances for\nbudget adoption and\nappropriation and UBCIS\nchanges\nDecember 1 - Regular Meeting\n• Second reading ordinances for\nbudget adoption and\nappropriation and UBCIS\nchanges and associated\nresolutions\n31","text":"BUDGET MEETINGS September 1 – Regular Meeting • Presentation of the 2027 Proposed Budget and the 2027-2031 Capital Improvement Program • CIP overview and projects September 8 – Regular Meeting • Employee compensation and benefits • LDDA budgets September 15 – Study Session • 2027 budget summary • General Fund budget summary • Public Safety Fund budget summary • One-time expenses • Financial policies September 22 – Regular Meeting • Transportation funding • Utilities budget summaries September 29 – Study Session • NextLight budget summary • Airport budget summary • First public hearing October 6 – Regular Meeting • Final direction from Council • Second public hearing • First reading of mill levy ordinances October 20 – Regular Meeting • Second reading of mill levy ordinances November 17 - Regular Meeting • First reading ordinances for budget adoption and appropriation and UBCIS changes December 1 - Regular Meeting • Second reading ordinances for budget adoption and appropriation and UBCIS changes and associated resolutions 31"}]};
 const source: PackageSource = {"id":"s3-c11-1","title":"2027 Proposed Budget Presentation, September 29, 2026","tier":"A","url":"https://longmontcolorado.gov/wp-content/uploads/2026/09/2027_Budget-Presentation-9-29-26smaller.pdf","locator":"p. 31, BUDGET MEETINGS","offlineReference":""};
 const claim: PackageClaim = {"id":"c11","text":"The Sept. 29 budget presentation's budget-meetings slide lists October 6 as final direction from Council, the second public hearing, and first reading of mill levy ordinances.","status":"VERIFIED","sourceIds":["s3-c11-1"],"nextCheck":"","item":"2027 Proposed Budget Presentation and First Public Hearing"};
 it("retains the dated schedule below wrapped bullet text",()=> {assert.equal(bind(claim,source,[calendar]).claims[0].status,"VERIFIED");});
 it("does not lend October 6 hearing roles to the October 20 entry",()=> {const wrong={...claim,text:claim.text.replace("October 6","October 20")}; assert.equal(bind(wrong,source,[calendar]).claims[0].status,"UNVERIFIED");});
 it("does not let the actual calendar verify an unlisted October 7 hearing",()=> {const wrong={...claim,text:claim.text.replace("October 6","October 7")}; assert.equal(bind(wrong,source,[calendar]).claims[0].status,"UNVERIFIED");});
});
