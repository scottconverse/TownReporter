import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  editorError,
  editorKindLabel,
  editorPauseReason,
  editorStatus,
  headlineFromUrl,
  looksLikeInternalSummary,
  plainEditorText,
  plainFinding,
  progressLine,
  sourceLineFromUrl,
  titlesOverlap,
  worthItemOnDesk,
  recordKindFromUrl,
  excerptForEditor,
} from "./desk-copy.ts";
import { presentWorthItem, rankWorthItems } from "./worth-a-look.ts";

const PDF =
  "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf";

describe("editor copy", () => {
  it("turns a raw PDF URL into a human headline", () => {
    const title = headlineFromUrl(PDF);
    assert.match(title, /transportation extension/i);
    assert.doesNotMatch(title, /^https?:/i);
    assert.doesNotMatch(title, /100pct|o\.100/i);
    assert.match(sourceLineFromUrl(PDF), /Boulder County/);
  });

  it("translates API 403 into an editor error, not a dump", () => {
    const msg = editorError("xAI API error 403");
    assert.ok(msg);
    assert.doesNotMatch(msg!, /xAI API error 403/);
    assert.match(msg!, /unavailable|Keep digging/i);
  });

  it("does not show a TypeError as editor copy", () => {
    const msg = editorError("Cannot read properties of undefined (reading 'ok')");
    assert.ok(msg);
    assert.doesNotMatch(msg!, /Cannot read properties/i);
    assert.match(msg!, /Keep digging/i);
  });

  it("labels investigation status in English", () => {
    assert.equal(editorStatus("investigating"), "Looking now");
    assert.equal(editorStatus("paused"), "Stopped — more to read");
    assert.equal(editorKindLabel("reopened"), "Showed up again");
  });

  it("explains a stop after a round without hop or frontier", () => {
    const msg = editorPauseReason(
      "Hop budget 5 reached with 65 frontier item(s) still open. Budget pauses work; evidence exhaustion would close it.",
    );
    assert.ok(msg);
    assert.match(msg!, /65 pages, names, or documents/);
    assert.match(msg!, /Keep digging/);
    assert.match(msg!, /not an error/i);
    assert.doesNotMatch(msg!, /frontier/i);
    assert.doesNotMatch(msg!, /\bhop\b/i);
    assert.doesNotMatch(msg!, /budget/i);
  });

  it("does not treat a heuristic hop dump as a reader-facing summary", () => {
    assert.equal(looksLikeInternalSummary("Heuristic hop: 3 searches, 4 fetches, 14 frontier items."), true);
    assert.equal(looksLikeInternalSummary("Opened from Dark Desk."), true);
    assert.equal(looksLikeInternalSummary("The city moved the transportation extension from 2024 into 2026."), false);
  });

  it("progresses from started to rounds without hop or frontier", () => {
    const start = progressLine({
      running: true,
      status: "investigating",
      hops: 0,
      budget: 5,
      artifacts: 0,
      searches: 0,
      claims: 0,
    });
    assert.match(start, /Searching records/);
    const mid = progressLine({
      running: true,
      status: "investigating",
      hops: 2,
      budget: 5,
      artifacts: 4,
      searches: 3,
      claims: 1,
    });
    assert.match(mid, /Round 2 of 5/);
    assert.doesNotMatch(mid, /\bhop\b/i);
    assert.doesNotMatch(mid, /frontier/i);
    const paused = progressLine({
      running: false,
      status: "paused",
      hops: 5,
      budget: 5,
      artifacts: 4,
      searches: 3,
      claims: 0,
    });
    assert.match(paused, /more still to open/i);
    assert.doesNotMatch(paused, /\bhop\b/i);
  });

  it("translates engine dumps into English", () => {
    const run = plainEditorText("Hops 5. Artifacts 34. Open frontier 149.");
    assert.match(run, /5 rounds/);
    assert.match(run, /34 records/);
    assert.match(run, /149 things still to open/);
    assert.doesNotMatch(run, /frontier|artifacts|\bhops?\b/i);
    const finding = plainFinding("Document changed: https://youtube.com/@CityofLongmont");
    assert.match(finding, /YouTube|different/i);
    assert.doesNotMatch(finding, /Document changed/i);
  });
});

describe("Worth a Look presentation", () => {
  it("renders a human-readable title instead of a raw URL", () => {
    const ranked = rankWorthItems({
      frontier: [
        {
          label: PDF,
          kind: "url",
          why: "Attachment/document link on https://bouldercounty.gov/government/budget-and-finance/impuesto-sobre-las-ventas-y-uso",
          status: "reopened",
          closed_reason: "Reopened from resolved: materially new evidence. Prior: Fetched.",
        },
      ],
    });
    const card = presentWorthItem(ranked[0]!);
    assert.doesNotMatch(card.title, /^https?:/i);
    assert.doesNotMatch(card.title, /https?:/i);
    assert.match(card.title, /transportation extension/i);
    assert.equal(card.badge, "Showed up again");
    assert.doesNotMatch(card.why, /resolved|Prior: Fetched|frontier|Previously parked/i);
    assert.doesNotMatch(card.happened, /Previously parked|https?:/i);
    assert.match(card.happened, /Boulder County|encountered this again/i);
    assert.match(card.question, /new evidence|miss/i);
    assert.match(card.seed, /assets.bouldercounty.gov/);
  });

  it("moves a started card off To look at once an investigation exists", () => {
    assert.equal(
      titlesOverlap("Transportation Extension document", "Transportation Extension document"),
      true,
    );
    assert.equal(
      worthItemOnDesk(
        { id: "frontier:url:pdf", title: "Transportation Extension document" },
        [{ title: "Transportation Extension document" }],
      ),
      true,
    );
    assert.equal(
      worthItemOnDesk(
        { id: "x", title: "Water quality report overdue" },
        [{ title: "Transportation Extension document" }],
      ),
      false,
    );
    assert.equal(
      worthItemOnDesk({ id: "claimed", title: "Anything" }, [], ["claimed"]),
      true,
    );
  });

  it("labels a captured PDF as a document an editor can read", () => {
    assert.equal(
      recordKindFromUrl(
        "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf",
      ),
      "PDF",
    );
    assert.match(excerptForEditor("Council approved the contract Tuesday. ".repeat(20)), /…$/);
  });
});
