import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blockedDigBannerText,
  composeZeroLeadSummary,
  editorError,
  editorDraftError,
  editorFetchError,
  editorKindLabel,
  editorPauseReason,
  editorScanError,
  editorStatus,
  flakyFailureCopy,
  headlineFromUrl,
  humanFrontierLabel,
  investigationStopKind,
  kindFromSourceUrl,
  tierFromKind,
  topicFromText,
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
  collapsePrintedDuplicates,
  draftHasLanded,
  workingLeads,
  workingQueueEmptyCopy,
  worthItemOnDesk,
  worthTitle,
  recordKindFromUrl,
  excerptForEditor,
  deskTakenLoginCopy,
  createEditorCopy,
  inviteMessage,
  resurfacedSummarySentence,
  resolveDraftJobState,
  recoveringDraftCopy,
  DRAFT_JOB_STALE_AFTER_SECONDS,
} from "./desk-copy.ts";
import { STALE_RUNNING_SECONDS } from "./jobs.ts";
import { presentWorthItem, rankWorthItems } from "./worth-a-look.ts";

const PDF =
  "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/2022-048-rst-td3-transportation-extension-o.100pct.pdf";

describe("resurfacedSummarySentence (QA-1: a merge is never invisible)", () => {
  it("names the first discarded candidate's headline so a merge is reviewable", () => {
    const sentence = resurfacedSummarySentence({
      resurfacedKilled: 1,
      resurfacedOpen: 0,
      firstDiscardedHeadline: "Council votes on $250,000 library roof repair contract at Sept. 10 meeting",
    });
    assert.match(sentence, /^1 lead matched a story you already killed/);
    assert.match(sentence, /— e\.g\. 'Council votes on \$250,000 library roof repair contract at Sept\. 10 meeting'\.$/);
  });

  it("says nothing extra with no headline (back-compat: the field is optional)", () => {
    const sentence = resurfacedSummarySentence({ resurfacedKilled: 2, resurfacedOpen: 1 });
    assert.equal(
      sentence,
      "2 leads matched stories you already killed and were stamped, not refiled; 1 matched an open lead.",
    );
  });

  it("returns empty when nothing resurfaced, even with a headline present", () => {
    assert.equal(
      resurfacedSummarySentence({ resurfacedKilled: 0, resurfacedOpen: 0, firstDiscardedHeadline: "x" }),
      "",
    );
  });

  it("truncates a very long discarded headline rather than blowing out the summary", () => {
    const long = "A".repeat(400);
    const sentence = resurfacedSummarySentence({
      resurfacedKilled: 0,
      resurfacedOpen: 1,
      firstDiscardedHeadline: long,
    });
    assert.ok(sentence.length < 200);
  });

  // QA-1 round 3: matchStrength's "possible" tier files a lead linked to an
  // existing one instead of stamping or discarding it -- the summary sentence
  // must say so, and, when it does, also say how many more were filed with no
  // match at all so the editor gets the full breakdown in one place.
  describe("QA-1 round 3: possible-match and filed-new counts", () => {
    it("adds a bit for possibleMatched, singular", () => {
      const sentence = resurfacedSummarySentence({ resurfacedKilled: 0, resurfacedOpen: 0, possibleMatched: 1 });
      assert.equal(sentence, "1 filed and marked maybe-same-as an existing lead.");
    });

    it("adds a bit for possibleMatched, plural", () => {
      const sentence = resurfacedSummarySentence({ resurfacedKilled: 0, resurfacedOpen: 0, possibleMatched: 3 });
      assert.equal(sentence, "3 filed and marked maybe-same-as existing leads.");
    });

    it("combines strong, possible, and filedNew bits in one sentence", () => {
      const sentence = resurfacedSummarySentence({
        resurfacedKilled: 1,
        resurfacedOpen: 0,
        possibleMatched: 2,
        filedNew: 4,
        firstDiscardedHeadline: "Council votes on $250,000 library roof repair contract at Sept. 10 meeting",
      });
      assert.match(sentence, /^1 lead matched a story you already killed and was stamped, not refiled; /);
      assert.match(sentence, /2 filed and marked maybe-same-as existing leads/);
      assert.match(sentence, /4 filed as new/);
      assert.match(sentence, /— e\.g\. 'Council votes on \$250,000 library roof repair contract at Sept\. 10 meeting'\.$/);
    });

    it("stays silent when nothing resurfaced or possibly-matched, even if filedNew is set -- an ordinary scan is not worth a sentence", () => {
      const sentence = resurfacedSummarySentence({ resurfacedKilled: 0, resurfacedOpen: 0, filedNew: 5 });
      assert.equal(sentence, "");
    });

    it("omitting possibleMatched/filedNew entirely reproduces the exact pre-round-3 output (back-compat)", () => {
      const sentence = resurfacedSummarySentence({ resurfacedKilled: 2, resurfacedOpen: 1 });
      assert.equal(
        sentence,
        "2 leads matched stories you already killed and were stamped, not refiled; 1 matched an open lead.",
      );
    });
  });
});

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

  it("does not dump a setCookie crash as editor copy", () => {
    const msg = editorError(
      "Cannot destructure property 'setCookie' of '(intermediate value)' as it is undefined.",
    );
    assert.ok(msg);
    assert.match(msg!, /Start digging again/i);
    assert.doesNotMatch(msg!, /setCookie/);
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
    assert.equal(editorStatus("mystery-status"), "On the desk");
  });

  it("strips engine tokens from still-unopened labels", () => {
    assert.equal(humanFrontierLabel("frontier: Costco rebate cap"), "Costco rebate cap");
    assert.equal(humanFrontierLabel("hop: packet PDF"), "packet PDF");
    assert.doesNotMatch(humanFrontierLabel("frontier: next hop"), /frontier/i);
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

  it("does not say 'that is normal' when the batch was mostly blocked (Dark Desk F6)", () => {
    const raw =
      "Hop budget 5 reached with 65 frontier item(s) still open. Budget pauses work; evidence exhaustion would close it.";
    const normal = editorPauseReason(raw, { total: 10, ok: 8 });
    assert.match(normal!, /that is normal/i);

    const mostlyBlocked = editorPauseReason(raw, { total: 10, ok: 3 });
    assert.ok(mostlyBlocked);
    assert.doesNotMatch(mostlyBlocked!, /that is normal/i);
    assert.match(mostlyBlocked!, /7 of 10/);
    assert.match(mostlyBlocked!, /blocks, paywalls, or empty pages/i);
    assert.match(mostlyBlocked!, /Keep digging/);
  });

  it("defaults to the normal reassurance when no capture stats are given", () => {
    const raw = "Hop budget 5 reached with 12 frontier item(s) still open.";
    const msg = editorPauseReason(raw);
    assert.match(msg!, /that is normal/i);
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

  it("names how long the desk actually waited when the provider reports it", () => {
    const msg = editorScanError("Claude Code request timed out after 150s, 0 bytes out");
    assert.ok(msg);
    assert.match(msg, /writing pass timed out after 150s/i);
    assert.match(msg, /no new leads/i);
    assert.doesNotMatch(msg, /Claude Code/);
  });

  it("falls back to the sourceless sentence when no duration is reported", () => {
    const msg = editorScanError("xAI request timed out");
    assert.ok(msg);
    assert.equal(
      msg,
      "The writing pass timed out after the sources were fetched. No new leads were filed. Run the scan again.",
    );
  });

  it("translates a draft timeout into editor English, not Dark Desk copy", () => {
    const msg = editorDraftError("xAI request timed out");
    assert.ok(msg);
    assert.match(msg!, /did not finish in time/i);
    assert.match(msg!, /Draft with AI again/i);
    assert.doesNotMatch(msg!, /xAI/);
    assert.doesNotMatch(msg!, /Keep digging/);
    assert.doesNotMatch(msg!, /scan/i);
    const gateway = editorDraftError("504");
    assert.match(gateway!, /Draft with AI again/i);
    const cookie = editorDraftError(
      "Cannot destructure property 'setCookie' of '(intermediate value)' as it is undefined.",
    );
    assert.match(cookie!, /Sign-in hiccup/i);
    assert.doesNotMatch(cookie!, /setCookie/);
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
    assert.equal(dup!.headline, "Bohn Farm rezoning heads to planning board with staff blessing");
  });

  it("does not flag a killed lead as covering an unrelated printed piece on city/month furniture alone (real case 2026-09-02)", () => {
    const printed = [
      {
        slug: "permit-counter-dark-wednesdays",
        headline: "Longmont's permit counter goes dark Wednesday mornings starting Sept. 2",
        topic: "civic",
        published_at: "2026-08-30T12:00:00Z",
      },
    ];
    assert.equal(
      nearDuplicate(
        { headline: "Deadline: Longmont's 2026 Community Satisfaction Survey closes Sept. 7", topic: "civic-survey" },
        printed,
      ),
      null,
    );
    assert.equal(
      nearDuplicate(
        {
          headline:
            "Council books two executive sessions in eight days — Sept. 22 and Sept. 29 — with packets already posted",
          topic: "council",
        },
        printed,
      ),
      null,
    );
  });

  it("still flags a killed lead that really is the printed story reworded, same topic and real proper nouns", () => {
    const printed = [
      {
        slug: "svvsd-bond-vote",
        headline: "SVVSD board approves Boulder bond measure for November ballot",
        topic: "schools",
        published_at: "2026-08-28T12:00:00Z",
      },
    ];
    const dup = nearDuplicate(
      { headline: "Boulder bond measure headed to voters after SVVSD board approval", topic: "schools" },
      printed,
    );
    assert.ok(dup);
    assert.equal(dup!.slug, "svvsd-bond-vote");
  });

  it("marks a YouTube watch URL as youtube kind", () => {
    assert.equal(kindFromSourceUrl("https://www.youtube.com/user/cityoflongmont"), "youtube");
    assert.equal(kindFromSourceUrl("https://www.longmontcolorado.gov/council"), "official");
    assert.equal(kindFromSourceUrl("https://www.timescall.com/2026/08/01/story/"), "news");
    assert.equal(kindFromSourceUrl("https://x.com/longmont"), "social");
    assert.equal(tierFromKind("official"), "A");
    assert.equal(tierFromKind("news"), "B");
    assert.equal(tierFromKind("social"), "C");
    assert.equal(topicFromText("St. Vrain Valley Schools board packet"), "schools");
    assert.equal(topicFromText("NextLight fiber upgrade"), "utilities");
  });

  it("collapses the Longmont quiet-zone pair, keeping the longer body", () => {
    const kept = collapsePrintedDuplicates([
      {
        headline: "Group 2 railroad quiet-zone work set to start Aug. 31",
        body: "short",
        slug: "quiet-work",
      },
      {
        headline: "Group 2 railroad quiet-zone improvements set to begin Aug. 31",
        body: "the longer printed version with more of the packet",
        slug: "quiet-improvements",
      },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.slug, "quiet-improvements");
  });

  it("collapses the community-survey pair", () => {
    const kept = collapsePrintedDuplicates([
      { headline: "Longmont's 2026 community satisfaction survey closes Sept. 7", body: "aaaa" },
      { headline: "2026 community satisfaction survey open through September 7", body: "bb" },
    ]);
    assert.equal(kept.length, 1);
    assert.match(kept[0]!.headline, /closes Sept/i);
  });

  it("does not collapse Airport Vision with the Boulder County joint session", () => {
    const kept = collapsePrintedDuplicates([
      { headline: "Council books six-hour Airport Vision session Sept. 26 at 375 Airport Road" },
      { headline: "Longmont council set for joint session with Boulder County on Sept. 21" },
    ]);
    assert.equal(kept.length, 2);
  });

  it("treats a first body as landed even when the HTTP click already died", () => {
    assert.equal(
      draftHasLanded({
        hadBodyAtStart: false,
        bodyAtStart: "",
        startedAt: Date.now() - 60_000,
        draft: { body: "Council meets Tuesday.", updated_at: new Date().toISOString() },
      }),
      true,
    );
    assert.equal(
      draftHasLanded({
        hadBodyAtStart: false,
        startedAt: Date.now(),
        draft: { body: "", updated_at: new Date().toISOString() },
      }),
      false,
    );
  });

  it("treats a redraft as landed when the body changed, not by waiting out a timer", () => {
    const startedAt = Date.parse("2026-08-27T02:00:00.000Z");
    assert.equal(
      draftHasLanded({
        hadBodyAtStart: true,
        bodyAtStart: "old brief",
        startedAt,
        draft: { body: "Council meets Tuesday at 7.", updated_at: "2026-08-27T01:00:00.000Z" },
      }),
      true,
    );
    assert.equal(
      draftHasLanded({
        hadBodyAtStart: true,
        bodyAtStart: "old brief",
        startedAt,
        draft: { body: "old brief", updated_at: "2026-08-27T01:00:00.000Z" },
      }),
      false,
    );
    assert.equal(
      draftHasLanded({
        hadBodyAtStart: true,
        bodyAtStart: "old brief",
        startedAt,
        draft: { body: "old brief", updated_at: "2026-08-27T02:00:10.000Z" },
      }),
      true,
    );
  });

  it("keeps its duplicated stale window in lockstep with jobs.ts", () => {
    // desk-copy.ts cannot import jobs.ts (it opens a real DB connection at
    // module load and this file ships to the browser), so the reclaim window
    // is duplicated here. This is the tripwire if the two ever drift apart.
    assert.equal(DRAFT_JOB_STALE_AFTER_SECONDS, STALE_RUNNING_SECONDS);
  });

  it("resolveDraftJobState: fresh-running reads as drafting", () => {
    assert.equal(
      resolveDraftJobState({ status: "running", updated_at: new Date().toISOString() }),
      "drafting",
    );
  });

  it("resolveDraftJobState: a queued job also reads as drafting", () => {
    assert.equal(
      resolveDraftJobState({ status: "queued", updated_at: new Date().toISOString() }),
      "drafting",
    );
  });

  it("resolveDraftJobState: a cold heartbeat on a running job reads as recovering, never as a failure prompting a re-click", () => {
    const now = Date.now();
    const staleUpdatedAt = new Date(now - (STALE_RUNNING_SECONDS + 5) * 1000).toISOString();
    assert.equal(
      resolveDraftJobState({ status: "running", updated_at: staleUpdatedAt }, now),
      "recovering",
    );
  });

  it("resolveDraftJobState: a heartbeat just inside the window still reads as drafting", () => {
    const now = Date.now();
    const freshUpdatedAt = new Date(now - (STALE_RUNNING_SECONDS - 5) * 1000).toISOString();
    assert.equal(
      resolveDraftJobState({ status: "running", updated_at: freshUpdatedAt }, now),
      "drafting",
    );
  });

  it("resolveDraftJobState: a failed job reads as failed (the only state where retry is the right advice)", () => {
    assert.equal(
      resolveDraftJobState({ status: "failed", updated_at: new Date().toISOString() }),
      "failed",
    );
  });

  it("resolveDraftJobState: a completed job reads as done", () => {
    assert.equal(
      resolveDraftJobState({ status: "completed", updated_at: new Date().toISOString() }),
      "done",
    );
  });

  it("resolveDraftJobState: no job at all reads as idle", () => {
    assert.equal(resolveDraftJobState(null), "idle");
    assert.equal(resolveDraftJobState(undefined), "idle");
  });

  it("recoveringDraftCopy never tells the editor to click Draft with AI again", () => {
    const copy = recoveringDraftCopy();
    assert.doesNotMatch(copy, /click draft with ai/i);
    assert.match(copy, /restart/i);
    assert.match(copy, /nothing was lost/i);
  });

  it("tells a claimed desk the paper is open and create is gone", () => {
    const copy = deskTakenLoginCopy();
    assert.match(copy.title, /sign-in/i);
    assert.match(copy.body, /already has an editor/i);
    assert.match(copy.body, /paper/i);
    assert.doesNotMatch(copy.body, /Create editor/i);
    assert.match(copy.unknownEmail, /already claimed/i);
    assert.doesNotMatch(copy.unknownEmail, /Create editor/i);
  });

  /*
    The confirmation used to say "Really leave? The paper stays. Anyone can
    Create editor and own the desk." -- an accurate sentence about the
    mechanism that did not say what is lost. An audit walked it: the newsroom
    goes to the next stranger who opens the sign-in page, and the previous
    owner cannot get it back. So the assertions moved from naming the mechanism
    to naming the consequence.
  */
  it("names the paper Create editor CTA, and says what giving up the desk costs", () => {
    const copy = createEditorCopy();
    assert.equal(copy.paper, "Create editor");
    assert.equal(copy.leave, "Give up the desk");
    assert.match(copy.confirm, /archive/i);
    assert.match(copy.confirm, /cannot take it back/i);
    assert.match(copy.confirm, /type your email/i);
    assert.doesNotMatch(
      copy.confirm,
      /paper stays/i,
      "reassurance about the paper buried the part that matters",
    );
  });
});


describe("a lapsed provider login is a sign-in problem, not a retry", () => {
  // 2026-09-02, live desk, job 41: preflight passed, the saved Claude token
  // expired before the call, and the editor was told to click again.
  const live =
    "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";

  it("tells the editor to sign in to Claude Code, and names the browser login as separate", () => {
    const msg = editorDraftError(live);
    assert.ok(msg);
    assert.match(msg!, /Claude Code on this machine needs you to sign in again/);
    assert.match(msg!, /claude\.ai login in the browser is a separate login/);
    assert.match(msg!, /Clicking again before that will fail the same way/);
    assert.doesNotMatch(msg!, /did not finish/i);
    assert.doesNotMatch(msg!, /Draft with AI again/);
  });

  it("does the same for a scan, in scan words", () => {
    const msg = editorScanError(live);
    assert.ok(msg);
    assert.match(msg!, /sign in again/);
    assert.match(msg!, /run the scan again/);
    assert.doesNotMatch(msg!, /did not finish/i);
  });

  it("points at Codex when Codex is the one signed out", () => {
    const msg = editorDraftError("Codex CLI: not logged in. Run codex login.");
    assert.match(msg!, /Codex on this machine needs you to sign in again/);
    assert.doesNotMatch(msg!, /claude\.ai/);
  });

  it("still calls a timeout a timeout even when the text mentions auth", () => {
    const msg = editorDraftError("Claude Code request timed out after 150s, 0 bytes out — waiting for auth");
    assert.match(msg!, /did not finish in time/i);
  });

  it("does the same for a mid-round Dark Desk failure, not 'Keep digging'", () => {
    const msg = editorError(live);
    assert.ok(msg);
    assert.match(msg!, /sign in again/);
    assert.doesNotMatch(msg!, /Keep digging to continue/);
  });

  it("still calls a Dark Desk timeout a timeout even when the text mentions auth", () => {
    const msg = editorError("Claude Code request timed out after 150s, 0 bytes out — waiting for auth");
    assert.ok(msg);
    assert.match(msg!, /timed out|timeout/i);
    assert.doesNotMatch(msg!, /sign in again/);
  });
});

describe("the Server page tells a point-and-click operator what its buttons do", () => {
  /*
   * 2026-09-02 operator feedback: "No clue at all from the screen what
   * Paper setup Save, Invite an editor, or Give up the desk actually do.
   * Does it warn you? Where does the invited person put this code?" These
   * are source-shape checks -- there is no request whose response is "the
   * words on the Server page" -- reading desk.ops.tsx directly is the
   * check. No database needed, so it always runs.
   */
  const ops = readFileSync(new URL("../../routes/desk.ops.tsx", import.meta.url), "utf8");
  // JSX text wraps across source lines the way the paragraphs above are
  // written; the browser collapses that whitespace when it renders, so the
  // check does the same rather than requiring every phrase to fall on one
  // physical line.
  const flatten = (s: string) => s.replace(/\s+/g, " ");

  it("Paper setup explains what Save writes, and answers the watch-list question truthfully", () => {
    const block = flatten(
      ops.slice(ops.indexOf("function PaperSetup("), ops.indexOf("function InviteAnEditor(")),
    );
    for (const phrase of [
      "writes every field",
      "kicker",
      "welcome article",
      "Published stories are not touched",
      "no undo",
      "Sources page",
    ]) {
      assert.ok(block.includes(phrase), `Paper setup no longer says "${phrase}"`);
    }
  });

  it("Invite an editor says up front that nothing gets emailed", () => {
    const block = flatten(
      ops.slice(ops.indexOf("function InviteAnEditor("), ops.indexOf("function GiveUpTheDesk(")),
    );
    assert.ok(
      block.includes("does not send email"),
      "the invite form no longer warns that TownReporter sends nothing",
    );
  });

  it("Invite an editor says what happens once the person has the link", () => {
    const block = flatten(
      ops.slice(ops.indexOf("function InviteAnEditor("), ops.indexOf("function GiveUpTheDesk(")),
    );
    assert.ok(
      block.includes("What happens next"),
      "the post-mint copy no longer says what happens once they click the link",
    );
    assert.ok(
      block.includes("Copy message") && block.includes("Copy link"),
      "the minted-link panel lost one of its copy buttons",
    );
  });

  it("Give up the desk shows the consequence in the sub line, before the first click", () => {
    const block = flatten(ops.slice(ops.indexOf("function GiveUpTheDesk(")));
    for (const phrase of ["Dark Desk files", "no way back", "type your email address"]) {
      assert.ok(block.includes(phrase), `Give up the desk sub line no longer says "${phrase}"`);
    }
  });
});

describe("inviteMessage() builds the message the owner sends themselves", () => {
  it("fills in the paper name, the invited address and the real link", () => {
    const msg = inviteMessage({
      paperName: "Testerville Ledger",
      email: "someone@example.org",
      link: "https://paper.example/login?invite=abc123",
      ownerEmail: "owner@example.org",
    });
    assert.match(msg, /Testerville Ledger/);
    assert.match(msg, /someone@example\.org/);
    assert.match(msg, /https:\/\/paper\.example\/login\?invite=abc123/);
    assert.match(msg, /works once/);
    assert.match(msg, /expires in seven days/);
    assert.match(msg, /create account/i);
    assert.match(msg, /no code to type/i);
    assert.match(msg, /owner@example\.org/);
  });

  it("falls back to 'the owner' when there is no owner email on file", () => {
    const msg = inviteMessage({
      paperName: "Testerville Ledger",
      email: "someone@example.org",
      link: "https://paper.example/login?invite=abc123",
      ownerEmail: "",
    });
    assert.match(msg, /ask the owner for a new one/);
  });

  it("falls back to 'the owner' when ownerEmail is missing entirely", () => {
    const msg = inviteMessage({
      paperName: "Testerville Ledger",
      email: "someone@example.org",
      link: "https://paper.example/login?invite=abc123",
    });
    assert.match(msg, /ask the owner for a new one/);
  });
});

describe("blockedDigBannerText (Dark Desk F6)", () => {
  it("names rate-limiting as the cause and suggests a next move", () => {
    const text = blockedDigBannerText({
      total: 10,
      ok: 2,
      blocked: 7,
      empty: 1,
      dominantReason: "rate-limited",
    });
    assert.match(text, /8 of 10/);
    assert.match(text, /rate-limited \(429/i);
    assert.match(text, /not evidence there is nothing here/i);
    assert.match(text, /Keep digging/);
  });

  it("names an app-shell page when empty captures dominate", () => {
    const text = blockedDigBannerText({
      total: 6,
      ok: 1,
      blocked: 0,
      empty: 5,
      dominantReason: "empty",
    });
    assert.match(text, /app-shell/i);
  });
});
