import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeZeroLeadSummary,
  editorError,
  editorFetchError,
  editorKindLabel,
  editorPauseReason,
  editorScanError,
  editorStatus,
  flakyFailureCopy,
  headlineFromUrl,
  investigationStopKind,
  kindFromSourceUrl,
  looksLikeInternalSummary,
  nearDuplicate,
  openLeads,
  plainEditorText,
  plainFinding,
  progressLine,
  scanCountsLine,
  scanZeroWhy,
  sourceErrorKind,
  sourceLineFromUrl,
  titlesOverlap,
  workingLeads,
  workingQueueEmptyCopy,
  worthItemOnDesk,
  worthTitle,
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

  it("does not dump Research failed as the editor message", () => {
    const msg = editorError("Research failed");
    assert.ok(msg);
    assert.doesNotMatch(msg!, /^Research failed$/i);
    assert.match(msg!, /still on the file/i);
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

  it("keeps published leads off the working queue and open pile", () => {
    const rows = [
      { status: "new" },
      { status: "drafted" },
      { status: "held" },
      { status: "killed" },
      { status: "published" },
      { status: "published" },
    ];
    assert.equal(workingLeads(rows).length, 4);
    assert.equal(openLeads(rows).length, 3);
    assert.ok(workingLeads(rows).every((l) => l.status !== "published"));
    assert.ok(openLeads(rows).every((l) => l.status !== "published" && l.status !== "killed"));
  });

  it("does not say run the first scan after a timed-out writing pass", () => {
    const copy = workingQueueEmptyCopy({
      publishedCount: 5,
      lastScan: { leads_created: 0, sources_fetched: 34, error: "xAI request timed out" },
    });
    assert.match(copy, /nothing open/i);
    assert.match(copy, /5 already on the paper/i);
    assert.match(copy, /34 sources/i);
    assert.match(copy, /timed out/i);
    assert.doesNotMatch(copy, /first scan/i);
    assert.doesNotMatch(copy, /xAI/i);
  });

  it("translates fetch failures into editor English", () => {
    assert.equal(editorFetchError("Fetch failed (404)"), "That page is gone or empty.");
    assert.equal(editorFetchError("That host could not be resolved"), "That address could not be found.");
    assert.equal(editorFetchError("Fetch failed (429)"), "The site asked us to slow down.");
    assert.doesNotMatch(editorFetchError("Fetch failed (403)") ?? "", /403/);
  });

  it("names social fetch failures the way the wire should", () => {
    assert.match(
      editorFetchError("Fetch failed (400)", "https://www.facebook.com/longmontcolorado") ?? "",
      /Facebook refused the request \(400\)/,
    );
    assert.match(
      editorFetchError("Fetch failed (403)", "https://x.com/longmontgov") ?? "",
      /X refused the request \(403\)/,
    );
    assert.equal(sourceErrorKind({ url: "https://www.facebook.com/x", tier: "C", kind: "signal" }), "flaky");
    assert.equal(sourceErrorKind({ url: "https://www.longmontcolorado.gov/council", tier: "A", kind: "official" }), "official");
    assert.match(flakyFailureCopy(8), /8 social & discovery sources didn't answer/);
  });

  it("translates a scan timeout into editor English, not Dark Desk copy", () => {
    const msg = editorScanError("xAI request timed out");
    assert.ok(msg);
    assert.match(msg, /writing pass timed out/i);
    assert.match(msg, /no new leads/i);
    assert.doesNotMatch(msg, /xAI/);
    assert.doesNotMatch(msg, /Keep digging/);
  });

  it("classifies Dark Desk stops without a new column", () => {
    assert.equal(
      investigationStopKind({
        status: "paused",
        pause_reason: "Hop budget 5 reached with 19 frontier item(s) still open.",
      }),
      "round",
    );
    assert.equal(
      investigationStopKind({ status: "paused", pause_reason: "xAI API error 403" }),
      "error",
    );
    assert.equal(investigationStopKind({ status: "open", pause_reason: null }), null);
  });

  it("thickens thin worth-a-look titles and leaves real ones alone", () => {
    assert.match(
      worthTitle({
        title: "Meeting",
        happened: "The DDA calendar gained a one-item special meeting for Thursday: a downtown parking garage land swap.",
        why: "A special meeting posted with the minimum 72 hours of notice usually means a deadline.",
      }),
      /DDA calendar/i,
    );
    assert.equal(
      worthTitle({ title: "July special-meeting minutes are gone from the clerk portal", happened: "x", why: "y" }),
      "July special-meeting minutes are gone from the clerk portal",
    );
  });

  it("says filed nothing on a zero-lead scan", () => {
    assert.equal(scanCountsLine({ sources_fetched: 41, leads_created: 0, sources_proposed: 0 }), "41 fetched · filed nothing");
    assert.match(
      scanZeroWhy({ leads_created: 0, sources_fetched: 41, summary: "Nothing crossed the filing bar.", error: null }) ?? "",
      /filing bar/,
    );
    assert.match(composeZeroLeadSummary({ fetched: 41, changed: 2 }), /Nothing crossed the filing bar/);
    assert.match(composeZeroLeadSummary({ fetched: 41, changed: 2 }), /39 pages matched/);
  });

  it("flags a queue lead that covers a printed piece", () => {
    const dup = nearDuplicate(
      { headline: "Neighbors' traffic study missing from Bohn Farm staff report", topic: "development" },
      [
        {
          slug: "bohn-farm-rezoning",
          headline: "Bohn Farm rezoning heads to planning board with staff blessing",
          topic: "development",
          published_at: "2026-08-19T12:00:00Z",
        },
      ],
    );
    assert.ok(dup);
    assert.equal(dup!.slug, "bohn-farm-rezoning");
  });

  it("marks a YouTube watch URL as youtube kind", () => {
    assert.equal(kindFromSourceUrl("https://www.youtube.com/user/cityoflongmont"), "youtube");
    assert.equal(kindFromSourceUrl("https://www.longmontcolorado.gov/council"), "official");
  });
});

