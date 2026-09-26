import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  LIMITS,
  addSourceInput,
  artifactIdInput,
  bulkSourceInput,
  claimEmail,
  claimToken,
  cleanOrRaw,
  correctionInput,
  darkCountyInput,
  darkOpenInput,
  darkRunInput,
  darkSignalInput,
  darkStepInput,
  draftBatchGetInput,
  draftBatchStartInput,
  draftEditInput,
  draftHistoryInput,
  draftLeadInput,
  draftMeetingReviewInput,
  editorialDraftInput,
  editorialStartInput,
  editorialText,
  evidenceCompareInput,
  evidenceUrl,
  fileLeadInput,
  followUpCreateInput,
  followUpReplyInput,
  followUpsInput,
  idOnlyInput,
  jobIdInput,
  leadIdInput,
  leadStatusInput,
  legalBackupInput,
  legalCaseId,
  legalRemovalInput,
  legalSelectionInput,
  meetingArticleReviewInput,
  opsAction,
  outletInput,
  packDeleteInput,
  packRenameInput,
  packSaveInput,
  publicSlug,
  publicTopic,
  pullTodoInput,
  redditTipInput,
  reportingNotesInput,
  routineAutomationInput,
  routineCaptureInput,
  routineCheckRunInput,
  routineChecksListInput,
  routinePolicyInput,
  rowId,
  runScanInput,
  sectionConfigInput,
  slugInput,
  sourceStatusInput,
  storyDocumentDownloadInput,
  storyDocumentListInput,
  trashId,
  writeStoryInput,
} from "./request-input.ts";

/**
 * The 0.6.63 sweep, as a table.
 *
 * WHAT THIS FILE IS FOR. Unit K did this for publish, auth, paper settings and
 * connections; this is the other 82 `.validator()` calls in `src/` that were
 * `(x: T) => x` -- an annotation, not a check. Every one of those functions now
 * calls a schema in `request-input.ts`. This file drives that schema with a
 * real payload and with at least one payload that must not reach the handler.
 *
 * WHY THE SCHEMA AND NOT THE SERVER FUNCTION. Two thirds of these functions
 * live in modules that open a database at import time, and `node
 * --experimental-strip-types` cannot load them (see `request-input.test.ts`).
 * So this tests the decision the `.validator()` makes, exactly as
 * `provider-settings-input.ts` and Unit K's own test do. What that leaves open
 * -- that the file on disk actually calls these schemas -- is closed by the
 * wiring test at the bottom of this file, which reads the source and refuses a
 * `.validator()` that is still a cast.
 *
 * WHAT THE FIRST RUN OF THIS FILE SAID, before any validator was replaced --
 * the sweep's RED, quoted from the run:
 *
 *   ✖ every swept .validator() calls the schema, not a cast
 *     AssertionError [ERR_ASSERTION]: desk.ts:167 is still a cast: .validator((input: { url: string; title: string; kind: string; tier: string }) => input)
 *   ℹ tests 102   ℹ suites 3   ℹ pass 76   ℹ fail 26
 *
 * All 15 wiring cases failed, one line per file. Eleven table cases failed too,
 * all of them the `.catch("")` / `cleanOrRaw` rows, because the first version of
 * this file asserted a throw where those boundaries deliberately answer text
 * instead; they are marked `bound` below and assert the ceiling instead. That
 * distinction is the whole reason those rows are separate.
 *
 * Every bound below is read from `LIMITS` rather than repeated, so a change to
 * a ceiling moves the test with it.
 *
 * The `file.ts:line` on each row is where that `.validator()` was BEFORE the
 * sweep -- the inventory this unit started from, so the row and the inventory
 * line up. Some files moved down a few lines when an import was added, so a
 * label here is not a current position; the wiring test prints the current one
 * when it fails.
 */

type Bad = { why: string; value: unknown };
type Row = {
  /** `file.ts:function`, so a failure names the function, not just the schema. */
  fn: string;
  run: (raw: unknown) => unknown;
  /** A real payload: accepted, and returned exactly as it went in. */
  valid: unknown;
  /**
   * Set only where the schema deliberately normalises an accepted shape -- the
   * bare id that `darkSignalInput` folds into `{ id }`, which is what its
   * handler reads. `valid` is still the shape the app sends.
   */
  out?: unknown;
  bad: Bad[];
  /**
   * `bound` rows do not throw: their store answers a friendly refusal
   * ("Choose between one and five leads.") where a 500 would be worse. The
   * ceiling still has to hold, so the test checks that instead.
   */
  bound?: boolean;
};

const x = (n: number) => "x".repeat(n);

const rows: Row[] = [
  /* claim.ts */
  {
    fn: "claim.ts:29 claimDesk",
    bound: true,
    run: claimToken.parse.bind(claimToken),
    valid: "5f0c2a1b4e",
    bad: [
      { why: "oversize token", value: x(LIMITS.evidenceToken + 1) },
      { why: "not text", value: 7 },
    ],
  },
  {
    fn: "claim.ts:68 leaveEditor",
    bound: true,
    run: claimEmail.parse.bind(claimEmail),
    valid: "editor@example.test",
    bad: [{ why: "oversize address", value: `${x(LIMITS.email + 1)}@example.test` }],
  },
  {
    fn: "claim.ts:100 inviteEditor",
    bound: true,
    run: claimEmail.parse.bind(claimEmail),
    valid: "editor@example.test",
    bad: [{ why: "not text", value: { email: "editor@example.test" } }],
  },
  {
    fn: "claim.ts:113 inviteState",
    bound: true,
    run: claimToken.parse.bind(claimToken),
    valid: "invite-token-42",
    bad: [{ why: "oversize token", value: x(LIMITS.evidenceToken + 1) }],
  },
  {
    fn: "claim.ts:118 acceptEditorInvite",
    bound: true,
    run: claimToken.parse.bind(claimToken),
    valid: "invite-token-42",
    bad: [{ why: "not text", value: [] }],
  },

  /* desk.ts */
  {
    fn: "desk.ts:167 addSource",
    run: addSourceInput.parse.bind(addSourceInput),
    valid: {
      url: "https://longmontcitycouncil.org/agendas",
      title: "City Council agendas",
      kind: "council",
      tier: "primary",
    },
    bad: [
      { why: "oversize url", value: { url: x(LIMITS.url + 1), title: "t", kind: "k", tier: "p" } },
      { why: "oversize title", value: { url: "https://a.test/", title: x(LIMITS.sourceTitle + 1), kind: "k", tier: "p" } },
      { why: "missing tier", value: { url: "https://a.test/", title: "t", kind: "k" } },
    ],
  },
  {
    fn: "desk.ts:187 addSourcesBulk",
    run: bulkSourceInput.parse.bind(bulkSourceInput),
    valid: { text: "City Council | https://longmontcitycouncil.org/" },
    bad: [{ why: "oversize paste", value: { text: x(LIMITS.bulkSourceText + 1) } }],
  },
  {
    fn: "desk.ts:220 setSourceStatus",
    run: sourceStatusInput.parse.bind(sourceStatusInput),
    valid: { id: 42, status: "accepted" },
    bad: [
      { why: "negative id", value: { id: -1, status: "accepted" } },
      { why: "unknown status", value: { id: 42, status: "maybe" } },
      { why: "id as text", value: { id: "42", status: "accepted" } },
    ],
  },
  {
    fn: "desk.ts:338 fileLead",
    run: fileLeadInput.parse.bind(fileLeadInput),
    valid: {
      headline: "Council approves the 2027 budget on a 5-2 vote",
      why: "The two no votes both named the same line item.",
      topic: "council",
      url: "https://longmontcitycouncil.org/2026-09-22",
    },
    bad: [
      { why: "oversize headline", value: { headline: x(LIMITS.leadHeadline + 1), why: "w", topic: "council" } },
      { why: "oversize why", value: { headline: "h", why: x(LIMITS.leadWhy + 1), topic: "council" } },
    ],
  },
  {
    fn: "desk.ts:368 getLead",
    run: rowId.parse.bind(rowId),
    valid: 42,
    bad: [
      { why: "negative id", value: -42 },
      { why: "non-integer", value: 1.5 },
      { why: "id past the 4-byte column", value: 3_000_000_000 },
    ],
  },
  {
    fn: "desk.ts:586 saveScanSourcePackFn",
    run: packSaveInput.parse.bind(packSaveInput),
    valid: { name: "Council and planning", sourceIds: [1, 2, 3], packId: 7 },
    bad: [
      { why: "oversize name", value: { name: x(LIMITS.packName + 1), sourceIds: [1] } },
      { why: "too many sources", value: { name: "p", sourceIds: Array.from({ length: LIMITS.packSources + 1 }, (_, i) => i + 1) } },
      { why: "id as text", value: { name: "p", sourceIds: ["1"] } },
    ],
  },
  {
    fn: "desk.ts:603 renameScanSourcePackFn",
    run: packRenameInput.parse.bind(packRenameInput),
    valid: { packId: 7, name: "Council and planning" },
    bad: [{ why: "negative packId", value: { packId: -7, name: "p" } }],
  },
  {
    fn: "desk.ts:617 deleteScanSourcePackFn",
    run: packDeleteInput.parse.bind(packDeleteInput),
    valid: { packId: 7 },
    bad: [{ why: "no packId", value: {} }],
  },
  {
    fn: "desk.ts:625 runScan",
    run: runScanInput.parse.bind(runScanInput),
    valid: { modelChoice: "claude", modelEffort: "high", customSourceIds: [1, 2], packId: 7 },
    bad: [
      { why: "oversize modelChoice", value: { modelChoice: x(LIMITS.modelId + 1) } },
      { why: "unknown effort", value: { modelEffort: "turbo" } },
      { why: "too many custom sources", value: { customSourceIds: Array.from({ length: LIMITS.packSources + 1 }, (_, i) => i + 1) } },
      { why: "negative packId", value: { packId: -7 } },
    ],
  },
  {
    fn: "desk.ts:625 runScan (a no-arg call is a real call)",
    run: runScanInput.parse.bind(runScanInput),
    valid: {},
    bad: [{ why: "not an object", value: "scan" }],
  },
  {
    fn: "desk.ts:1880 draftLead (bare id)",
    run: draftLeadInput.parse.bind(draftLeadInput),
    valid: 42,
    bad: [{ why: "negative id", value: -1 }],
  },
  {
    fn: "desk.ts:1880 draftLead (form)",
    run: draftLeadInput.parse.bind(draftLeadInput),
    valid: { leadId: 42, modelChoice: "claude", modelEffort: null, researchScope: "public" },
    bad: [
      { why: "unknown researchScope", value: { leadId: 42, researchScope: "everything" } },
      { why: "id as text", value: { leadId: "42" } },
    ],
  },
  {
    fn: "desk.ts:1934 writeStoryFromInput",
    run: writeStoryInput.parse.bind(writeStoryInput),
    valid: {
      text: "The council met on Tuesday and approved the budget.",
      documentIds: ["doc-1", "doc-2"],
      modelChoice: "claude",
      researchScope: "supplied",
      sectionKey: "council",
    },
    bad: [
      { why: "oversize text", value: { text: x(LIMITS.storyText + 1) } },
      { why: "too many documents", value: { text: "t", documentIds: Array.from({ length: LIMITS.documentIds + 1 }, () => "doc") } },
      { why: "not an object", value: "a story" },
    ],
  },
  {
    fn: "desk.ts:1959 saveReportingNotes",
    run: reportingNotesInput.parse.bind(reportingNotesInput),
    valid: {
      leadId: 42,
      add: "Checked the agenda packet.",
      toggle: 0,
      scratch: "Budget vote 5-2.",
      storyDirection: "Lead with the split.",
      researchScope: "public",
      todos: [{ t: "Confirm the vote", done: false, src: "you", q: "budget vote", queries: [{ query: "longmont budget vote", hit: true }] }],
    },
    bad: [
      { why: "oversize scratch", value: { leadId: 42, scratch: x(LIMITS.scratch + 1) } },
      { why: "oversize direction", value: { leadId: 42, storyDirection: x(LIMITS.storyDirection + 1) } },
      { why: "negative leadId", value: { leadId: -42 } },
      { why: "unknown todo source", value: { leadId: 42, todos: [{ t: "x", done: false, src: "ghost" }] } },
    ],
  },
  {
    fn: "desk.ts:2011 pullTodo",
    run: pullTodoInput.parse.bind(pullTodoInput),
    valid: { leadId: 42, query: "council budget vote", index: 1 },
    bad: [
      { why: "oversize query", value: { leadId: 42, query: x(LIMITS.pullQuery + 1) } },
      { why: "negative index", value: { leadId: 42, query: "q", index: -1 } },
    ],
  },
  {
    fn: "desk.ts:2065 listPullJobs",
    run: leadIdInput.parse.bind(leadIdInput),
    valid: { leadId: 42 },
    bad: [{ why: "id as text", value: { leadId: "42" } }],
  },
  {
    fn: "desk.ts:2117 stopPullJob",
    run: jobIdInput.parse.bind(jobIdInput),
    valid: { jobId: 9 },
    bad: [{ why: "zero id", value: { jobId: 0 } }],
  },
  {
    fn: "desk.ts:2135 continuePullJob",
    run: jobIdInput.parse.bind(jobIdInput),
    valid: { jobId: 9 },
    bad: [{ why: "negative id", value: { jobId: -9 } }],
  },
  {
    fn: "desk.ts:2200 saveDraft",
    // Keyed by the lead (`draft-edit.server.ts:5`), not the draft id: the story
    // editor saves through `saveDraftForEditor`.
    run: draftEditInput.parse.bind(draftEditInput),
    valid: { leadId: 5, headline: "The budget passes", dek: "Two no votes.", body: "The council met.", topic: "council" },
    bad: [
      { why: "oversize headline", value: { leadId: 5, headline: x(LIMITS.draftHeadline + 1), dek: "d", body: "b", topic: "council" } },
      { why: "oversize dek", value: { leadId: 5, headline: "h", dek: x(LIMITS.draftDek + 1), body: "b", topic: "council" } },
      { why: "draft id where the lead id goes", value: { draftId: 5, headline: "h", dek: "d", body: "b", topic: "council" } },
      { why: "unknown evidence decision", value: { leadId: 5, headline: "h", dek: "d", body: "b", topic: "council", evidenceDecision: "maybe" } },
      { why: "oversize evidence token", value: { leadId: 5, headline: "h", dek: "d", body: "b", topic: "council", evidenceToken: x(LIMITS.draftEvidenceToken + 1) } },
    ],
  },
  {
    fn: "desk.ts:2208 setLeadStatus",
    run: leadStatusInput.parse.bind(leadStatusInput),
    valid: { id: 42, status: "held" },
    bad: [{ why: "unknown status", value: { id: 42, status: "archived" } }],
  },
  {
    fn: "desk.ts:2236 listFollowUps",
    run: followUpsInput.parse.bind(followUpsInput),
    valid: { status: "open", limit: 50 },
    bad: [
      { why: "unknown status", value: { status: "closed" } },
      { why: "negative limit", value: { limit: -50 } },
    ],
  },
  {
    fn: "desk.ts:2252 createFollowUp",
    run: followUpCreateInput.parse.bind(followUpCreateInput),
    valid: { leadId: 42, articleId: null, who: "City clerk", what: "Ask for the vote tally.", dueOn: "2026-09-30" },
    bad: [
      { why: "oversize what", value: { who: "w", what: x(LIMITS.followUpWhat + 1) } },
      { why: "negative leadId", value: { leadId: -42, who: "w", what: "w" } },
    ],
  },
  {
    fn: "desk.ts:2265 recordFollowUpReply",
    run: followUpReplyInput.parse.bind(followUpReplyInput),
    valid: { id: 9, replyText: "The clerk sent the tally.", repliedOn: null },
    bad: [{ why: "oversize reply", value: { id: 9, replyText: x(LIMITS.followUpReply + 1) } }],
  },
  {
    fn: "desk.ts:2270 nudgeFollowUp",
    run: idOnlyInput.parse.bind(idOnlyInput),
    valid: { id: 9 },
    bad: [{ why: "id as text", value: { id: "9" } }],
  },
  {
    fn: "desk.ts:2275 dropFollowUp",
    run: idOnlyInput.parse.bind(idOnlyInput),
    valid: { id: 9 },
    bad: [{ why: "negative id", value: { id: -9 } }],
  },
  {
    fn: "desk.ts:2333 confirmDraftTopic",
    run: rowId.parse.bind(rowId),
    valid: 42,
    bad: [{ why: "negative id", value: -42 }],
  },
  {
    fn: "desk.ts:2510 overrideNamedOutlet",
    run: outletInput.parse.bind(outletInput),
    valid: { leadId: 42, outlet: "Longmont Leader" },
    bad: [{ why: "oversize outlet", value: { leadId: 42, outlet: x(LIMITS.outlet + 1) } }],
  },
  {
    fn: "desk.ts:2770 addCorrection",
    run: correctionInput.parse.bind(correctionInput),
    valid: { articleSlug: "the-budget-passes", body: "The vote was 5-2, not 6-1.", meetingReviewId: 3 },
    bad: [
      { why: "oversize body", value: { articleSlug: "s", body: x(LIMITS.correctionBody + 1) } },
      { why: "negative review id", value: { articleSlug: "s", body: "b", meetingReviewId: -3 } },
    ],
  },
  {
    fn: "desk.ts:2791 resolveMeetingArticleReview",
    run: meetingArticleReviewInput.parse.bind(meetingArticleReviewInput),
    valid: { reviewId: 3, resolution: "still-accurate", acceptedArtifactId: 8, note: "Read the transcript.", confirmedSegmentIndices: [0, 1, 2] },
    bad: [
      { why: "unknown resolution", value: { reviewId: 3, resolution: "maybe", acceptedArtifactId: 8, note: "n", confirmedSegmentIndices: [] } },
      { why: "too many segments", value: { reviewId: 3, resolution: "still-accurate", acceptedArtifactId: 8, note: "n", confirmedSegmentIndices: Array.from({ length: LIMITS.segmentIndexes + 1 }, (_, i) => i) } },
      { why: "negative segment", value: { reviewId: 3, resolution: "still-accurate", acceptedArtifactId: 8, note: "n", confirmedSegmentIndices: [-1] } },
    ],
  },
  {
    fn: "desk.ts:2814 resolveDraftMeetingReview",
    run: draftMeetingReviewInput.parse.bind(draftMeetingReviewInput),
    valid: { leadId: 42, draftId: 5, evidenceToken: "sha256:abc", acceptedArtifactId: 8, confirmedSegmentIndexes: [0], note: "Checked." },
    bad: [
      // The real token is a serialized draft row, not a hash -- see `LIMITS.draftEvidenceToken`.
      { why: "oversize evidence token", value: { leadId: 42, draftId: 5, evidenceToken: x(LIMITS.draftEvidenceToken + 1), acceptedArtifactId: 8, confirmedSegmentIndexes: [], note: "n" } },
      { why: "negative draftId", value: { leadId: 42, draftId: -5, evidenceToken: "t", acceptedArtifactId: 8, confirmedSegmentIndexes: [], note: "n" } },
    ],
  },
  {
    fn: "desk.ts:2845 listDraftHistory",
    run: rowId.parse.bind(rowId),
    valid: 42,
    bad: [{ why: "id as text", value: "42" }],
  },
  {
    fn: "desk.ts:2893 getDraftHistoryItem",
    run: draftHistoryInput.parse.bind(draftHistoryInput),
    valid: { leadId: 42, draftId: 5 },
    bad: [{ why: "no draftId", value: { leadId: 42 } }],
  },
  {
    fn: "desk.ts:3042 deleteLead",
    run: rowId.parse.bind(rowId),
    valid: 42,
    bad: [{ why: "zero id", value: 0 }],
  },
  {
    fn: "desk.ts:3094 deleteArticle",
    run: slugInput.parse.bind(slugInput),
    valid: "the-budget-passes",
    bad: [{ why: "oversize slug", value: x(LIMITS.slug + 1) }],
  },

  /* dark.ts */
  {
    fn: "dark.ts:1004 getInvestigation",
    run: rowId.parse.bind(rowId),
    valid: 12,
    bad: [{ why: "id as text", value: "12" }],
  },
  {
    fn: "dark.ts:1280 getArtifact",
    run: rowId.parse.bind(rowId),
    valid: 12,
    bad: [{ why: "negative id", value: -12 }],
  },
  {
    fn: "dark.ts:1376 getArtifactOcrJob (the one row that coerced)",
    run: artifactIdInput.parse.bind(artifactIdInput),
    valid: 12,
    bad: [
      { why: "not a number at all", value: "not-an-id" },
      { why: "negative id", value: -12 },
    ],
  },
  {
    fn: "dark.ts:2039 runDarkDesk",
    run: darkRunInput.parse.bind(darkRunInput),
    valid: { paste: "Who signed the 2019 annexation agreement?", investigationId: 12, modelChoice: "claude" },
    bad: [
      { why: "oversize paste", value: { paste: x(LIMITS.darkPaste + 1) } },
      { why: "negative investigationId", value: { paste: "p", investigationId: -12 } },
    ],
  },
  {
    fn: "dark.ts:2067 openDarkInvestigation",
    run: darkOpenInput.parse.bind(darkOpenInput),
    valid: { paste: "The 2019 annexation agreement.", title: "Annexation" },
    bad: [{ why: "oversize title", value: { paste: "p", title: x(LIMITS.leadHeadline + 1) } }],
  },
  {
    fn: "dark.ts:2217 continueInvestigation (bare id)",
    run: darkStepInput.parse.bind(darkStepInput),
    valid: 12,
    bad: [{ why: "negative id", value: -12 }],
  },
  {
    fn: "dark.ts:2217 continueInvestigation (form)",
    run: darkStepInput.parse.bind(darkStepInput),
    valid: { id: 12, modelChoice: "claude", modelEffort: "high" },
    bad: [{ why: "oversize modelChoice", value: { id: 12, modelChoice: x(LIMITS.modelId + 1) } }],
  },
  {
    fn: "dark.ts:3617 refreshBrief (bare id)",
    run: darkStepInput.parse.bind(darkStepInput),
    valid: 12,
    bad: [{ why: "id as text", value: "12" }],
  },
  {
    fn: "dark.ts:2875 sendDarkSignalToQueue (bare id)",
    run: darkSignalInput.parse.bind(darkSignalInput),
    valid: 12,
    out: { id: 12 },
    bad: [{ why: "negative id", value: -12 }],
  },
  {
    fn: "dark.ts:2875 sendDarkSignalToQueue (form)",
    run: darkSignalInput.parse.bind(darkSignalInput),
    valid: { id: 12, asTip: true },
    bad: [{ why: "asTip as text", value: { id: 12, asTip: "yes" } }],
  },
  {
    fn: "dark.ts:3014 queueInvestigation (bare id)",
    run: darkSignalInput.parse.bind(darkSignalInput),
    valid: 12,
    out: { id: 12 },
    bad: [{ why: "id as text", value: "12" }],
  },
  {
    fn: "dark.ts:3025 parkInvestigation",
    run: rowId.parse.bind(rowId),
    valid: 12,
    bad: [{ why: "id past the 4-byte column", value: 3_000_000_000 }],
  },
  {
    fn: "dark.ts:3042 reopenParkedInvestigation",
    run: rowId.parse.bind(rowId),
    valid: 12,
    bad: [{ why: "non-integer", value: 1.5 }],
  },
  {
    fn: "dark.ts:3232 fileRedditTip",
    run: redditTipInput.parse.bind(redditTipInput),
    valid: { url: "https://reddit.com/r/longmont/1abc", title: "Anyone know about the annexation?", excerpt: "Saw it in the packet.", author: "u/local" },
    bad: [
      { why: "oversize excerpt", value: { url: "https://a.test/", title: "t", excerpt: x(LIMITS.redditExcerpt + 1) } },
      { why: "oversize title", value: { url: "https://a.test/", title: x(LIMITS.redditTitle + 1) } },
    ],
  },
  {
    fn: "dark.ts:3323 saveDarkCounty",
    run: darkCountyInput.parse.bind(darkCountyInput),
    valid: { county: "Boulder" },
    bad: [{ why: "oversize county", value: { county: x(LIMITS.county + 1) } }],
  },

  /* evidence.ts */
  {
    fn: "evidence.ts:433 getPublicEvidence",
    run: rowId.parse.bind(rowId),
    valid: 3,
    bad: [{ why: "negative id", value: -3 }],
  },
  {
    fn: "evidence.ts:437 listPublicHistory",
    run: evidenceUrl.parse.bind(evidenceUrl),
    valid: "https://longmontcitycouncil.org/2026-09-22",
    bad: [{ why: "oversize url", value: x(LIMITS.url + 1) }],
  },
  {
    fn: "evidence.ts:441 listPublicVersionsForUrl",
    run: evidenceUrl.parse.bind(evidenceUrl),
    valid: "https://longmontcitycouncil.org/2026-09-22",
    bad: [{ why: "not text", value: 7 }],
  },
  {
    fn: "evidence.ts:445 comparePublicEvidence",
    run: evidenceCompareInput.parse.bind(evidenceCompareInput),
    valid: { url: "https://a.test/", a: 1, b: 2 },
    bad: [{ why: "negative id", value: { a: -1, b: 2 } }],
  },

  /* legal-removal.ts */
  {
    fn: "legal-removal.ts:29 legalPreview",
    run: legalSelectionInput.parse.bind(legalSelectionInput),
    valid: { articleIds: [1], draftIds: [2], memoryIds: [3], auditIds: [4], trashIds: [5], reviewedLegacy: true, reviewedEvidence: true },
    bad: [
      { why: "too many articles", value: { articleIds: Array.from({ length: LIMITS.caseRefList + 1 }, (_, i) => i + 1), draftIds: [], memoryIds: [], auditIds: [], trashIds: [], reviewedLegacy: true, reviewedEvidence: true } },
      { why: "id as text", value: { articleIds: ["1"], draftIds: [], memoryIds: [], auditIds: [], trashIds: [], reviewedLegacy: true, reviewedEvidence: true } },
    ],
  },
  {
    fn: "legal-removal.ts:33 legalConfirm",
    run: legalRemovalInput.parse.bind(legalRemovalInput),
    valid: {
      selection: { articleIds: [1], draftIds: [], memoryIds: [], auditIds: [], trashIds: [], reviewedLegacy: true, reviewedEvidence: true },
      fingerprint: "sha256:8f14e45fceea167a5a36dedd4bea2543",
      policy: "destroy",
      caseRef: "REF-2026-0914",
    },
    bad: [
      { why: "unknown policy", value: { selection: { articleIds: [], draftIds: [], memoryIds: [], auditIds: [], trashIds: [], reviewedLegacy: true, reviewedEvidence: true }, fingerprint: "f", policy: "shred", caseRef: "r" } },
      { why: "oversize caseRef", value: { selection: { articleIds: [], draftIds: [], memoryIds: [], auditIds: [], trashIds: [], reviewedLegacy: true, reviewedEvidence: true }, fingerprint: "f", policy: "retain", caseRef: x(LIMITS.caseRef + 1) } },
    ],
  },
  {
    fn: "legal-removal.ts:40 legalCase",
    bound: true,
    run: legalCaseId.parse.bind(legalCaseId),
    valid: "REF-2026-0914",
    bad: [{ why: "oversize case ref", value: x(LIMITS.caseRef + 1) }],
  },
  {
    fn: "legal-removal.ts:44 legalRetainedCopy",
    bound: true,
    run: legalCaseId.parse.bind(legalCaseId),
    valid: "REF-2026-0914",
    bad: [{ why: "not text", value: 42 }],
  },
  {
    fn: "legal-removal.ts:48 legalBackupAction",
    run: legalBackupInput.parse.bind(legalBackupInput),
    valid: { caseId: "REF-2026-0914", identifier: "nightly-2026-09-24", confirmId: 9 },
    bad: [
      { why: "oversize identifier", value: { caseId: "r", identifier: x(LIMITS.backupIdentifier + 1) } },
      { why: "negative confirmId", value: { caseId: "r", confirmId: -9 } },
    ],
  },

  /* opinion.ts */
  {
    fn: "opinion.ts:55 getFailedEditorialMaterial",
    run: rowId.parse.bind(rowId),
    valid: 4,
    bad: [{ why: "negative id", value: -4 }],
  },
  {
    fn: "opinion.ts:125 getEditorial",
    run: rowId.parse.bind(rowId),
    valid: 5,
    bad: [{ why: "id as text", value: "5" }],
  },
  {
    fn: "opinion.ts:161 startEditorial",
    run: editorialStartInput.parse.bind(editorialStartInput),
    valid: { subject: "The 2027 budget", askedFor: "800 words on the split", articleSlug: "the-budget-passes", modelChoice: "claude", modelEffort: null, documentIds: ["doc-1"], retryRequestId: 4 },
    bad: [
      { why: "oversize subject", value: { subject: x(LIMITS.storyText + 1) } },
      { why: "negative retryRequestId", value: { subject: "s", retryRequestId: -4 } },
      { why: "too many documents", value: { subject: "s", documentIds: Array.from({ length: LIMITS.documentIds + 1 }, () => "doc") } },
    ],
  },
  {
    fn: "opinion.ts:207 getEditorialDraft",
    run: rowId.parse.bind(rowId),
    valid: 5,
    bad: [{ why: "zero id", value: 0 }],
  },
  {
    fn: "opinion.ts:230 saveEditorialDraft",
    run: editorialDraftInput.parse.bind(editorialDraftInput),
    valid: { draftId: 5, headline: "The budget passes", dek: "Two no votes.", body: "The council met.", topic: "opinion", evidenceDecision: "keep", evidenceToken: "sha256:abc" },
    bad: [
      { why: "oversize dek", value: { draftId: 5, headline: "h", dek: x(LIMITS.draftDek + 1), body: "b", topic: "opinion" } },
      { why: "oversize headline", value: { draftId: 5, headline: x(LIMITS.draftHeadline + 1), dek: "d", body: "b", topic: "opinion" } },
    ],
  },
  {
    fn: "opinion.ts:312 deleteEditorial",
    run: rowId.parse.bind(rowId),
    valid: 5,
    bad: [{ why: "id past the 4-byte column", value: 3_000_000_000 }],
  },
  {
    fn: "opinion.ts:370 fileWrittenEditorial",
    run: editorialText.parse.bind(editorialText),
    valid: "The council met on Tuesday.",
    bad: [
      { why: "oversize text", value: x(LIMITS.editorialBody + 1) },
      { why: "not text", value: { text: "t" } },
    ],
  },
  {
    fn: "opinion.ts:453 discardEditorialRequest",
    run: rowId.parse.bind(rowId),
    valid: 4,
    bad: [{ why: "negative id", value: -4 }],
  },

  /* public.ts */
  {
    fn: "public.ts:78 getPublishedArticle",
    run: publicSlug.parse.bind(publicSlug),
    valid: "the-budget-passes",
    bad: [{ why: "oversize slug", value: x(LIMITS.slug + 1) }],
  },
  {
    fn: "public.ts:116 listPublishedByTopic",
    run: publicTopic.parse.bind(publicTopic),
    valid: "council",
    bad: [{ why: "oversize topic", value: x(LIMITS.topic + 1) }],
  },

  /* sections.ts */
  {
    fn: "sections.ts:39 applySections",
    run: sectionConfigInput.parse.bind(sectionConfigInput),
    valid: {
      revision: 0,
      sections: [
        { key: "council", name: "City Council", visible: true, brief: "What the council did.", instructions: "Name the vote.", replacementKey: null, sourceIds: [1, 2] },
      ],
    },
    bad: [
      { why: "too many sections", value: { revision: 1, sections: Array.from({ length: LIMITS.sectionCount + 1 }, (_, i) => ({ key: `s${i}`, name: "n", visible: true, brief: "b", instructions: "i", replacementKey: null, sourceIds: [] })) } },
      { why: "oversize brief", value: { revision: 1, sections: [{ key: "k", name: "n", visible: true, brief: x(LIMITS.sectionBrief + 1), instructions: "i", replacementKey: null, sourceIds: [] }] } },
      { why: "negative revision", value: { revision: -1, sections: [] } },
    ],
  },

  /* story-document-api.ts */
  {
    fn: "story-document-api.ts:25 listStoryDocuments",
    run: storyDocumentListInput.parse.bind(storyDocumentListInput),
    valid: { leadId: 42 },
    bad: [{ why: "id as text", value: { leadId: "42" } }],
  },
  {
    fn: "story-document-api.ts:44 downloadStoryDocument",
    run: storyDocumentDownloadInput.parse.bind(storyDocumentDownloadInput),
    valid: { id: "doc-1", extracted: true },
    bad: [
      { why: "oversize id", value: { id: x(LIMITS.modelId + 1) } },
      { why: "negative id", value: { id: -1 } },
    ],
  },

  /* trash.ts */
  {
    fn: "trash.ts:122 restoreTrashItem",
    run: trashId.parse.bind(trashId),
    valid: 42,
    bad: [{ why: "id as text", value: "42" }],
  },
  {
    fn: "trash.ts:179 purgeTrashItem",
    run: trashId.parse.bind(trashId),
    valid: 42,
    bad: [{ why: "negative id", value: -42 }],
  },

  /* the six delegated rows: bounded, never thrown */
  {
    fn: "draft-batch.ts:112 startDraftBatch",
    run: cleanOrRaw(draftBatchStartInput),
    valid: { runtime: "claude", items: [{ leadId: 42, researchScope: "public" }] },
    bound: true,
    bad: [{ why: "oversize runtime", value: { runtime: x(LIMITS.modelId + 1), items: [{ leadId: 42 }] } }],
  },
  {
    fn: "draft-batch.ts:140 getDraftBatch",
    bound: true,
    run: cleanOrRaw(draftBatchGetInput),
    valid: { batchId: 7 },
    bad: [{ why: "batchId as text", value: { batchId: "7" } }],
  },
  {
    fn: "routine-notice-checks.ts:93 checkRoutineNoticeSource",
    run: cleanOrRaw(routineCheckRunInput),
    valid: { sourceId: 3, sourceUrl: "https://longmontcitycouncil.org/agendas" },
    bound: true,
    bad: [{ why: "oversize sourceUrl", value: { sourceId: 3, sourceUrl: x(LIMITS.sourceUrl + 1) } }],
  },
  {
    fn: "routine-notice-checks.ts:107 getRoutineNoticeChecks",
    bound: true,
    run: cleanOrRaw(routineChecksListInput),
    valid: { sourceId: 3, formatKey: "agenda" },
    bad: [{ why: "sourceId as text", value: { sourceId: "3" } }],
  },
  {
    fn: "routine-notice-checks.ts:124 getRoutineNoticeCapturedText",
    bound: true,
    run: cleanOrRaw(routineCaptureInput),
    valid: { checkId: 11 },
    bad: [{ why: "negative checkId", value: { checkId: -11 } }],
  },
  {
    fn: "routine-notice-policy.ts:384 saveRoutineNoticePolicy",
    run: cleanOrRaw(routinePolicyInput),
    valid: { expectedRevision: 2, paused: false, approvals: [{ sourceId: 3, sourceUrl: "https://a.test/", formatKey: "agenda" }] },
    bound: true,
    bad: [{ why: "oversize sourceUrl", value: { expectedRevision: 2, paused: false, approvals: [{ sourceId: 3, sourceUrl: x(LIMITS.sourceUrl + 1), formatKey: "agenda" }] } }],
  },
  {
    fn: "routine-notice-automation.ts:396 saveRoutineNoticeAutomation",
    run: cleanOrRaw(routineAutomationInput),
    valid: { expectedRevision: 2, enabled: true, timezone: "America/Denver", localTime: "06:30", sections: { agenda: "council" }, sources: [] },
    bound: true,
    bad: [{ why: "oversize timezone", value: { expectedRevision: 2, enabled: true, timezone: x(LIMITS.timezone + 1), localTime: "06:30", sections: {}, sources: [] } }],
  },

  /* ops/dashboard.ts */
  {
    fn: "dashboard.ts:42 runOpsAction",
    bound: true,
    run: opsAction.parse.bind(opsAction),
    valid: "rebuild-search-index",
    bad: [{ why: "oversize action", value: x(LIMITS.opsActionId + 1) }],
  },
];

describe("the 0.6.63 sweep bounds every validator it replaced", () => {
  for (const row of rows) {
    it(`${row.fn} takes a real payload and refuses a bounded one`, () => {
      // Accepted, and returned exactly as it went in: no trimming, no
      // rewriting, no dropped field, for input the app can actually produce.
      assert.deepEqual(row.run(row.valid), row.out ?? row.valid, `${row.fn} changed a valid payload`);

      for (const bad of row.bad) {
        if (row.bound) {
          // These rows answer friendly text from their store, so the boundary
          // may not throw: what it must do is not carry the oversize value.
          let out: unknown;
          assert.doesNotThrow(() => {
            out = row.run(bad.value);
          }, `${row.fn} threw on ${bad.why}`);
          assert.ok(
            JSON.stringify(out).length < 10_000,
            `${row.fn} carried ${bad.why} (${JSON.stringify(out).length} chars) past the boundary`,
          );
          // A text boundary that answers text must not answer something else:
          // `7` used to reach `String(7)` and become a token lookup of "7".
          if (typeof row.valid === "string") {
            assert.equal(typeof out, "string", `${row.fn} answered ${typeof out} for ${bad.why}`);
          }
        } else {
          assert.throws(() => row.run(bad.value), z.ZodError, `${row.fn} accepted ${bad.why}`);
        }
      }
    });
  }
});

describe("what a schema drops and what it keeps", () => {
  it("drops a key the function does not read, so it cannot ride along", () => {
    const parsed = addSourceInput.parse({
      url: "https://a.test/",
      title: "t",
      kind: "council",
      tier: "primary",
      newsroomId: 2,
    });
    assert.deepEqual(parsed, { url: "https://a.test/", title: "t", kind: "council", tier: "primary" });
  });

  it("keeps a key the stored shape already has, because the list is the editor's own", () => {
    const parsed = reportingNotesInput.parse({
      leadId: 42,
      todos: [{ t: "Confirm the vote", done: true, src: "you", fromTomorrowsBuild: "kept" }],
    });
    assert.deepEqual((parsed as { todos: unknown[] }).todos, [
      { t: "Confirm the vote", done: true, src: "you", fromTomorrowsBuild: "kept" },
    ]);
  });
});

/**
 * The bound that broke the desk, 2026-09-25. `evidenceReviewToken` is not a
 * hash: it is `JSON.stringify` of the draft row, so an ordinary draft's token
 * is kilobytes, and one carrying a full-length body is megabytes. When
 * `draftEditInput` bounded it like a marker, `saveDraft` refused the desk's
 * own token and the editor's keep-evidence click was lost. These are the
 * shapes the two editors actually put on the wire.
 */
describe("the draft evidence token is a serialized row, and clears its bound", () => {
  const rowToken = (body: string, research: string) =>
    JSON.stringify([5, "The budget passes", "Two no votes.", "council", body, "", "{}", "", "", research, []]);

  it("accepts one of the length the walks actually produced", () => {
    // 7,947 chars measured from the corrections walk's own postgres fixture:
    // a 65-char body next to ~7.9 KB of provenance and research columns, so
    // the research column is where nearly all of the token's size lives.
    const token = rowToken(x(65), x(7_800));
    assert.ok(token.length > LIMITS.evidenceToken, "fixture is too small to be the regression");
    assert.ok(draftEditInput.safeParse({ leadId: 5, headline: "h", dek: "d", body: "b", topic: "council", evidenceToken: token }).success);
    assert.ok(draftMeetingReviewInput.safeParse({ leadId: 5, draftId: 5, evidenceToken: token, acceptedArtifactId: 8, confirmedSegmentIndexes: [], note: "n" }).success);
    assert.ok(editorialDraftInput.safeParse({ draftId: 5, headline: "h", dek: "d", body: "b", topic: "opinion", evidenceToken: token }).success);
  });

  it("accepts a token wrapping a body at the ceiling this same payload allows", () => {
    const token = rowToken(x(LIMITS.storyText), "{}");
    assert.ok(token.length > LIMITS.storyText, "fixture is too small to be the regression");
    assert.ok(draftEditInput.safeParse({ leadId: 5, headline: "h", dek: "d", body: x(LIMITS.storyText), topic: "council", evidenceToken: token }).success);
  });

  it("still refuses one past the bound", () => {
    const token = x(LIMITS.draftEvidenceToken + 1);
    assert.ok(!draftEditInput.safeParse({ leadId: 5, headline: "h", dek: "d", body: "b", topic: "council", evidenceToken: token }).success);
    assert.ok(!editorialDraftInput.safeParse({ draftId: 5, headline: "h", dek: "d", body: "b", topic: "opinion", evidenceToken: token }).success);
  });
});

/**
 * The wiring. Every assertion above is about a schema; this one is about the
 * `.validator()` calls that are supposed to reach it, read from the files
 * themselves. Without it, the table would stay green while a function quietly
 * kept its cast.
 */
describe("every swept .validator() calls the schema, not a cast", () => {
  const files = [
    "claim.ts",
    "dark.ts",
    "desk.ts",
    "evidence.ts",
    "legal-removal.ts",
    "opinion.ts",
    "public.ts",
    "sections.ts",
    "story-document-api.ts",
    "trash.ts",
    "draft-batch.ts",
    "routine-notice-checks.ts",
    "routine-notice-automation.ts",
    "routine-notice-policy.ts",
    // A different directory, same sweep.
    "../ops/dashboard.ts",
  ];

  /**
   * The schemas a swept validator is allowed to call.
   *
   * `importStructureInput` and `importStoriesInput` joined in 0.6.63 with the
   * import review. Both are the same kind of thing as every name beside them --
   * strict `z.object`s in `request-input.ts` with real ceilings (`importText`,
   * `importStories`) -- and `desk.ts` calls both in the shape the rest use:
   * `.validator((input: unknown) => importStructureInput.parse(input))`. The
   * list, not the call, was what lagged: the sweep was red on lane 2's own HEAD
   * with both names absent from its copy of the same regex. Adding them admits
   * two schema calls and nothing else; a bare cast still fails below.
   *
   * The same story again in 0.6.67, three names at once. `cleanPublishRequest`
   * replaced `cleanPublishId` on the publish button so the request can carry
   * the section the editor saw, and it checks rather than casts: the id goes
   * through `cleanPublishId` (a positive 32-bit integer or null) and the
   * section is clipped to `LIMITS.topic`. `updateArticleHeadlineInput` and
   * `suggestHeadlinesInput` are the editor's headline edit and the three
   * suggestions, both strict `z.object`s in the same file as the rest. The
   * calls are right; the list had not heard of them.
   *
   * 0.6.70 brings two more names, and the two lanes met on this line. Unit AM
   * adds `correctionWordingInput`, the editor's two lines for a correction note.
   * Unit AK adds `leadDuplicateResolutionInput`, the Compare view's
   * duplicate-resolution press: a strict `z.object` of a row id and an action
   * enum in `request-input.ts`, called from `desk.ts:2441` the same way as every
   * name beside it. Both are strict `z.object`s with real ceilings; both are
   * added here as names, not the check relaxed, because the calls were always
   * the right shape. The lead one is worth a note of its own: it was ALREADY
   * missing from this list at 13b04db0 -- `git show 13b04db0:src/lib/news/desk.ts`
   * has the call at line 2441 and this regex had never heard of it -- so the
   * sweep was red on the news lane before either unit touched anything.
   */
  const SWEPT =
    /(?:addSourceInput|bulkSourceInput|sourceStatusInput|fileLeadInput|packSaveInput|packRenameInput|packDeleteInput|runScanInput|draftLeadInput|writeStoryInput|reportingNotesInput|pullTodoInput|leadIdInput|jobIdInput|leadStatusInput|leadDuplicateResolutionInput|followUpsInput|followUpCreateInput|followUpReplyInput|idOnlyInput|outletInput|correctionInput|correctionWordingInput|meetingArticleReviewInput|draftMeetingReviewInput|draftEditInput|draftHistoryInput|slugInput|artifactIdInput|darkRunInput|darkOpenInput|darkStepInput|darkSignalInput|redditTipInput|darkCountyInput|evidenceUrl|evidenceCompareInput|legalSelectionInput|legalRemovalInput|legalCaseId|legalBackupInput|editorialStartInput|editorialDraftInput|editorialText|publicSlug|publicTopic|sectionConfigInput|storyDocumentListInput|storyDocumentDownloadInput|trashId|rowId|claimToken|claimEmail|cleanOrRaw|cleanPublishId|cleanPublishRequest|updateArticleHeadlineInput|suggestHeadlinesInput|importStructureInput|importStoriesInput|opsAction)/;

  /**
   * Kept as they were, by design: each does real work a schema would have to
   * reimplement, or cannot be checked without the route it belongs to.
   */
  const KEPT: { where: string; why: string; matches: RegExp }[] = [
    { where: "dark.ts artifactOcrRequest", why: "the OCR route's own normaliser", matches: /artifactOcrRequest/ },
    { where: "desk.ts listScans", why: "clamps limit and offset", matches: /Math\.min\(/ },
    { where: "dark.ts saveDarkDials", why: "validateResearchPreferences", matches: /validateResearchPreferences/ },
    { where: "opinion.ts opinionModelChoice", why: "allow-list with a fallback", matches: /opinionModelChoice/ },
    { where: "public.ts:147 search", why: "already slices to 80", matches: /\.trim\(\)\.slice\(0, 80\)/ },
    { where: "story-document-api.ts:5 uploadStoryDocument", why: "a FormData body", matches: /FormData/ },
  ];
  const kept = (call: string) => KEPT.some((entry) => entry.matches.test(call));

  /** Every `.validator(...)` call text in a file, with its line number. */
  function validatorCalls(text: string): { line: number; call: string }[] {
    const calls: { line: number; call: string }[] = [];
    const marker = ".validator(";
    for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
      let depth = 0;
      let end = at + marker.length - 1;
      for (; end < text.length; end += 1) {
        const ch = text[end];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      calls.push({ line: text.slice(0, at).split("\n").length, call: text.slice(at, end + 1) });
    }
    return calls;
  }

  for (const file of files) {
    it(`${file} has no cast-only validator left`, () => {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      const calls = validatorCalls(text);
      assert.ok(calls.length > 0, `${file} has no .validator() at all -- did the file move?`);
      for (const { line, call } of calls) {
        assert.ok(
          SWEPT.test(call) || kept(call),
          `${file}:${line} is still a cast: ${call.replace(/\s+/g, " ").slice(0, 90)}`,
        );
      }
    });
  }

  it("did not quietly sweep the one FormData row or the four hand checks", () => {
    const desk = readFileSync(new URL("desk.ts", import.meta.url), "utf8");
    assert.ok(/Math\.min\(/.test(desk), "listScans lost its clamp");
    const dark = readFileSync(new URL("dark.ts", import.meta.url), "utf8");
    for (const name of ["artifactOcrRequest", "validateResearchPreferences"]) {
      assert.ok(dark.includes(name), `dark.ts lost ${name}`);
    }
  });
});
