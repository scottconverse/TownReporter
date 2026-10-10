import { checkSourceForEditor, fileLeadForEditor, startPullForEditor } from "./desk-policy-actions.server.ts";
import { scanDuplicateChat } from "./scan-duplicate-chat.ts";
import { DAILY_SCAN_TIME_BUDGET_MS, orderAcceptedSources, sourceBatches } from "./scan-supply.ts";
import {
  liveClaimsOwnReadiness,
  readinessWithUncheckedStory,
  savedStoryReadiness,
  type StoryReadiness,
} from "./story-readiness.ts";
import { loadMeetingTranscriptChoices } from "./meeting-transcript-choice.server.ts";
import {
  ensureNewsroomSources as ensureSeeds,
  insertProposedNewsroomSource,
  proposePassSources,
  saveAcceptedNewsroomSource,
} from "./source-seeds.server.ts";
import { selectCustomScanSources, selectedScanSources } from "./section-types.ts";
import { scanSourceExcerpt } from "./scan-source-excerpt.ts";
import { buildScanBatches, mergeScanBatchResults } from "./scan-batches.ts";
import { performReviewSuggestedSources } from "./suggested-sources.server.ts";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import {
  cleanSourceScanPreferenceInput,
  saveSourceScanPreferenceForEditor,
} from "./source-scan-preferences.server.ts";
import {
  finishScanCoverage,
  manualScanCoverage,
  parseScanSourceCoverage,
  updateScanCoverageEntry,
  type ScanSourceCoverageEntry,
} from "./scan-source-coverage.ts";
import { saveScanSourceCoverage } from "./scan-source-coverage.server.ts";
import { newsletterScanDocs, markNewsletterDocsScanned } from "./newsletter-scan.server.ts";
import { slugify, parseUrlList } from "@/lib/paper";
import { getPaperConfig, getPaperPlace, paperSetupWarning } from "./paper-settings";
import { assertHttpUrl, sha256 } from "./url-guard";
import { parseHttpUrl, parseSourceLines, sourceName } from "./source-lines.ts";
import { ingestUrl, ingestDocument, withRetry, IngestFetchError, BlockedAfterRenderError } from "./ingest";
import { createHostGate } from "./host-gate.ts";
import {
  BLOCKED_TRIES_PER_HOST_PER_DAY,
  classifyRefusal,
  dailyCapSentence,
  skipThisPass,
  touchAfterError,
  touchAfterFailure,
  touchAfterSkip,
  touchAfterSuccess,
  type SourceTouch,
} from "./fetch-politeness.ts";
import { writeSourceTouch } from "./source-touch-write.ts";
import {
  observationForTouch,
  recordObservation,
  type ObservationKind,
} from "./source-observations.server.ts";
import { checkRate, recordDeskRun, audit } from "./ops";
import { auditOverrides, checkOverride, type OverrideWarning } from "./override.ts";
import { AUTOMATIC_LADDER, scanSystem, grokChat, parseJsonBlock, probeProvider, providerBudget, type EffectiveProviderChoice, type LocalModelOverride } from "./ai";
import { unpackStoredDraft } from "./coerce-draft";
import { stripReporterNotebook } from "./strip-draft";
import {
  parseScanResult,
  previousScanNeedsReread,
  sanitizePublicUrls,
} from "./schema";
import { reportAndDraft } from "./report";
import { cleanListWindow, takeWindow } from "./list-window.ts";
import { cleanQueueWindow, queueCounts, queueNeedle, queueSelect } from "./queue-rows.ts";
import { cleanSourceWindow, selectSourceRows, sourceCounts } from "./source-rows.ts";
import { cityOfficialHost } from "./research-scope.ts";
import {
  beatsForSource,
  hostOf,
  rankCandidates,
  siblingCandidates,
} from "./source-replacements.ts";
import {
  DESK_DRAFT_FILTERS,
  deskDraftFilterCounts,
  deskDraftMatchesFilter,
  deskDraftState,
} from "./desk-drafts.ts";
import {
  PUBLISHED_FILTERS,
  publishedFilterCounts,
  publishedMatches,
  publishedNeedle,
  publishedWeekAgo,
} from "./published-rows.ts";
import { linkDraftToTranscript, loadDraftMeetingEvidence } from "./meeting-draft-transcript-link.ts";
import { TranscriptViewRefused, transcriptDownloadUrl } from "./meeting-transcript-view.ts";
import { cleanStoryArea } from "../story-area.ts";
import { findDuplicate } from "./import-review.ts";
import { recordDraftTranscriptRevisionReview } from "./meeting-draft-revision-review.ts";
import { loadMeetingPublishEvidence, recordMeetingPublishEvidence, staleCitationNotice } from "./meeting-publish-guard.ts";
import { lockMeetingsForDraftPublish } from "./meeting-revision-lock.ts";
import {
  listPublishedMeetingReviews as loadPublishedMeetingReviews,
  resolvePublishedMeetingReview,
  type PublishedMeetingReview,
} from "./meeting-article-revision.ts";
import { deriveFocusedUsedCitations, deriveUsedCitations } from "./meeting-draft-citations.ts";
import { meetingDraftSourceUrls } from "./meeting-draft-input.ts";
import { usesWholeMeetingWriter } from "./meeting-whole.ts";
import { draftSourceInputs, suppliedUrlsFromText } from "./draft-input.ts";
import {
  addSourceInput,
  artifactIdInput,
  bulkSourceInput,
  correctionInput,
  draftEditInput,
  draftHistoryInput,
  draftLeadInput,
  draftMeetingReviewInput,
  draftStyleFixInput,
  fileLeadInput,
  sourceCheckInput,
  aiFollowUpInput,
  aiFollowUpUpdateInput,
  followUpActionInput,
  followUpFindingsInput,
  followUpsInput,
  jobIdInput,
  leadIdInput,
  leadStatusInput,
  leadStatusRestoreInput,
  leadDuplicateResolutionInput,
  editLeadInput,
  meetingArticleReviewInput,
  outletInput,
  packDeleteInput,
  packRenameInput,
  packSaveInput,
  pasteDuplicateInput,
  importStoriesInput,
  importStructureInput,
  pullTodoInput,
  reportingNotesInput,
  rowId,
  runScanInput,
  acceptUnreviewedClaimsInput,
  acknowledgeUncheckedInput,
  slugInput,
  sourceStatusInput,
  suggestedSourceReviewInput,
  writeStoryInput,
  cleanPublishRequest,
  suggestHeadlinesInput,
  updateArticleHeadlineInput,
  correctionWordingInput,
  ledgerItemStatusInput,
  claimReviewedInput,
  rewriteFromLedgerInput,
  startReportingInput,
  reportingFollowUpInput,
  reportingObservationInput,
  leadReportingPackageInput,
  reportingRequestIdInput,
  reportingObservationsScopeInput,
  LIMITS,
} from "./request-input.ts";
import {
  evidenceNeedsReview,
  evidenceReviewToken,
  evidenceConfirmationMatches,
  mayInheritLeadSources,
} from "./draft-evidence.ts";
import {
  UNCHECKED_STORY_REASON,
  evidenceCheckCoversCurrentVersion,
  uncheckedStoryNeedsCheck,
} from "./unchecked-story-gate.ts";
import { webSearch } from "./search-web";
import { absenceClaims } from "./absence-gate";
import {
  applyTodoPatch,
  clipTodoText,
  editorNoteLines,
  keepHumanTodos,
  machineTodosFrom,
  packNotes,
  parseNotes,
  mergeCompletedReportingNotes,
  topicConfirmationFingerprint,
  TODO_DETAIL_MAX,
  uncheckedGateTodos,
  type NoteTodo,
} from "./notes";
import {
  cleanHeadline,
  headlineEditRecord,
  headlineForRedraft,
  headlineSuggestionPrompt,
  parseHeadlineSuggestions,
  sectionOverrideDetail,
  sectionOverridden,
} from "./headline-control.ts";
import {
  cleanCorrectionLine,
  correctionTemplate,
  correctionWordingPrompt,
  parseCorrectionWording,
} from "./correction-wording.ts";
import { provenanceFromUrls } from "./findings";
import type {
  ClaimEvidenceRow,
  FindingEvidenceRow,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";
import {
  namedOutlet,
  namedOutletNotice,
  unresolvedNamedOutlets,
  type NamedOutlet,
} from "./outlet-credit";
import {
  buildScanUserMessage,
  composeScanRunSummary,
  composeZeroLeadSummary,
  editorFetchError,
  kindFromSourceUrl,
  tierFromKind,
  resurfacedSummarySentence,
  scanDecisionsSentence,
} from "./desk-copy";
import { MATCH_LOOKBACK_DAYS, type MatchCandidateLead } from "./lead-match";
import { fileScanLeads, parseLeadSourceUrls } from "./lead-filing";
import {
  collectDupPairs,
  runDupCheck,
  DUP_CHECK_TIMEOUT_MS,
  type DupCheckOutcome,
  type DupCheckPrinted,
} from "./dup-check.ts";
import { postgresText, sanitizeJsonLeaves, storableText } from "./storable-text";
import {
  annotateScanRowsWithStallStatus,
  enqueueJob,
  countedStep,
  findOpenJob,
  kickJobs,
  latestJob,
  PROGRESS_WRITE_MIN_MS,
  progressReporterFor,
  runLooksStalled,
  spanPct,
  setJobFailoverNote,
  setJobModelChoice,
  setJobModelRuntime,
  setJobStage,
  throwIfJobCancelled,
  JobCancelledError,
  waitForModel,
  type DeskJob,
} from "./jobs";
import { newPullReceipt, parsePullReceipt, type PullRunView } from "./pull.server.ts";
import { providerFailureNotes } from "./pull-outcome.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership";
import {
  defaultMeetingTranscriptArtifactId,
  meetingArtifactIdFromDraftReceipt,
} from "./meeting-transcript-choice.ts";
import { effectiveStoryModelChoice, modelChoiceLabel, storyModelChoice } from "./model-choice.ts";
import { runScanChatWithFailover, scanCallTimeoutFor } from "./scan-model-run.ts";
import {
  runPinnedCallWithFailover,
  type PerformDraftWorkDeps,
} from "./desk-model-run.ts";
import { buildDraftCompletionReceipt } from "./draft-completion.ts";
import { repairDraftStyle } from "./draft-audit-repair.ts";
import { styleRepairCall } from "./draft-audit.server.ts";
import { styleAuditSummary, styleRecordFromRepair } from "./draft-audit-record.ts";
export type { PerformDraftWorkDeps };
import { readProviderOverrides } from "./provider-settings.ts";
import { applyJobLocalModelSnapshot, pinnedLocalModelForJob } from "./job-local-model.ts";
import {
  FORCED_FAILOVER_LADDER,
  isAutomaticRungId,
  modelEffort,
  type ModelEffort,
  type ProviderOverrides,
} from "./provider-registry.ts";
import {
  failoverNoteSentence,
  failoverReasonPhrase,
} from "./automatic-failover.ts";
import type { DraftGroundingRow } from "./draft-specifics.ts";
import type { DraftRow, LeadRow, MemoryRow, ScanRow, SourceRow } from "./types";

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

async function lockManualScanClaim(writeSql: Sql, job: DeskJob): Promise<boolean> {
  if (!job.claim_token) return false;
  const rows = await writeSql<{ id: number }>`
    select id from desk_jobs
    where id = ${job.id} and newsroom_id = ${job.newsroom_id} and kind = 'scan'
      and status = 'running' and claim_token = ${job.claim_token}
    for update
  `;
  return rows.length > 0;
}

async function refreshManualScanClaim(writeSql: Sql, job: DeskJob) {
  const rows = await writeSql<{ id: number }>`
    update desk_jobs set updated_at = clock_timestamp()
    where id = ${job.id} and newsroom_id = ${job.newsroom_id} and kind = 'scan'
      and status = 'running' and claim_token = ${job.claim_token}
    returning id
  `;
  if (!rows[0]) throw new Error("Scan job claim changed before its transaction finished.");
}

function effortFromJob(job: Pick<DeskJob, "model_choice" | "result_json">): ModelEffort | null {
  try {
    const value = JSON.parse(job.result_json || "{}") as { modelEffort?: unknown };
    return modelEffort(job.model_choice, value.modelEffort);
  } catch {
    return modelEffort(job.model_choice, null);
  }
}

/**
 * Both statements are `alter table ... add column if not exists`, so both take
 * ACCESS EXCLUSIVE on `drafts` and `leads` -- and this runs on `getLead`, a GET
 * handler, among others. While the nightly `pg_dump` held ACCESS SHARE, every
 * lead page waited here. `ensureSchemaOnce` runs them once per database
 * instead; see `paper-settings-read-lock.test.ts` and `questions/BP.md`.
 */
export async function ensureDeskDraftMemoSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "desk-draft-memo-columns", [
    "alter table drafts add column if not exists research_json text not null default '{}'",
    "alter table leads add column if not exists notes_json text not null default '{}'",
  ]);
}

export const bootstrapDesk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureSeeds(context.userId, owned(context));
    return { ok: true as const };
  });

/**
 * Every source the newsroom has, in the order the watch list draws them.
 *
 * Extracted from `listSources` by Unit CZ-long-lists so the Sources SCREEN's
 * window can narrow this list without a second copy of the SQL drifting from
 * it. The order is the rule and is the reason this is one read rather than
 * two: proposed first (they are a review queue, newest first within it), then
 * accepted, then paused, then rejected, and by id inside each group.
 */
async function querySourceRows(context: { userId: string; newsroomId: number }) {
  await ensureSeeds(context.userId, owned(context));
  const sql = await getSql();
  const rows = await sql<SourceRow>`
      select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error,
             last_read_method, last_read_outcome, last_read_route_url, newsletter_url,
             -- 0115 (SH0-1): the failure streak the two scan write sites keep, so
             -- the row can say "Keeps failing" rather than repeating the last
             -- reason for ever. last_ok_at is the only column in this schema
             -- that answers "when did this last READ" -- last_fetched_at moves
             -- on a failed attempt too.
             consecutive_failures, failure_streak_started_at, last_ok_at,
             -- SH-B: the wait or the block, and the plain sentence the row
             -- prints while it is parked -- "Asked us to come back at 3:40 PM —
             -- will retry then" when the site gave a time, "Was busy at
             -- 3:10 PM — trying again after 3:40 PM" when it did not and the
             -- wait is the desk's own. Read here because the Sources row is
             -- where the editor has to be able to see that the desk has not
             -- simply given up on a source they chose.
             retry_after, retry_after_note, blocked_at, blocked_attempts,
             -- 0097: why it was suggested, who suggested it, and where it came
             -- from. Null on every row that predates 0.6.70 = "not recorded".
             proposed_reason, proposed_by, proposed_scan_run_id, proposed_lead_id,
              proposed_section, reviewed_at, review_note,
              scan_preference.purpose as purpose_preference,
              scan_preference.cadence as scan_cadence,
              scan_preference.deadline::text as scan_deadline,
             -- 0.6.72: snapshots this source produced since the newest run
             -- started -- the drawn row's "2 new items". A source that was
             -- fetched and had not changed wrote none, which is the drawing's
             -- "No change"; last_error is its "Could not check". No new
             -- column: a snapshot is already written only when the hash moved.
             (select count(*) from snapshots sn
                where sn.source_id = sources.id
                  and sn.created_at >= coalesce(
                    (select max(started_at) from scan_runs where newsroom_id = ${owned(context)}),
                    '-infinity'::timestamptz))::int as new_since_last_pass
       from sources
       left join source_scan_preferences scan_preference
         on scan_preference.newsroom_id = sources.newsroom_id
        and scan_preference.source_id = sources.id
       where sources.newsroom_id = ${owned(context)}
      order by
        -- Paused sorts after accepted: it is still on the watch list, and the
        -- editor put it there deliberately, so it belongs with the rows they
        -- are reading rather than at the bottom with the rejected.
        case status
          when 'proposed' then 0
          when 'accepted' then 1
          when 'paused' then 2
          else 3
        end,
        -- Within the suggested rows, newest first: the list is a review queue,
        -- and the run that just finished is the one the editor is looking for.
        -- Every other status keeps the oldest-first order the watch list has
        -- always had.
        case when status = 'proposed' then id end desc,
        id asc
    `;
  return rows.map((row) => ({ ...row, title: sourceName(row.title) }));
}

/**
 * Every source, for the callers that need the whole list rather than a page:
 * the Today screen's rail, the scan settings dialog, the routine-notice
 * permissions dialog and the editor dialogs all ask "which sources are there".
 */
export const listSources = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => querySourceRows(context));

export const saveSourceScanPreference = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => cleanSourceScanPreferenceInput(raw))
  .handler(async ({ context, data }) => {
    if (data.invalidError) return { ok: false as const, error: data.invalidError };
    const sql = await getSql();
    return saveSourceScanPreferenceForEditor(sql, context, data);
  });

/** The read-only inventory screen, using the same facts and judgement as its CSV. */
export const getSourceInventory = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { buildInventory } = await import("./source-inventory.server.ts");
    const { rows } = await buildInventory(context.newsroomId);
    const unreadable = rows.filter(
      (row) => row.observation === "retrieval-error" || row.observation === "extraction-failure",
    ).length;
    const replacementCandidates = rows.filter(
      (row) => row.reviewStatus === "replacement-candidate",
    ).length;
    const duplicates = rows.filter((row) => row.duplicateOf).length;
    const neverChecked = rows.filter((row) => row.observation === "never-checked").length;
    return {
      rows: rows.slice(0, 500),
      total: rows.length,
      counts: { unreadable, replacementCandidates, duplicates, neverChecked },
    };
  });

/**
 * One page of the Sources screen (Unit CZ-long-lists).
 *
 * The watch list is the desk's longest list -- 1,588 suggested rows, some
 * 15,872px -- and the screen used to lay every one of them out. The window has
 * to be cut AFTER the tab and the search box, not in SQL: "Suggested" is a
 * status filter, but "Could not check" is a computed one (`status = 'accepted'
 * or 'paused'` AND `last_error is not null`), so a SQL limit would page the
 * unfiltered list and show rows the tab does not hold.
 *
 * `counts` is taken over every source rather than the page, because the pills
 * promise the size of the list and "Files up to" promises the size of the
 * watch list -- a page-scoped count would read 25 the moment a window
 * appeared.
 */
export const listSourcesPage = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => cleanSourceWindow(input))
  .handler(async ({ context, data }) => {
    const all = await querySourceRows(context);
    const matched = selectSourceRows(all, data);
    return { ...takeWindow(matched, data.offset, data.limit), counts: sourceCounts(all) };
  });

async function upsertSource(
  userId: string,
  url: string,
  title: string,
  kind: string,
  tier: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  return saveAcceptedNewsroomSource({
    userId,
    newsroomId,
    url,
    title,
    kind,
    tier,
  }) as Promise<(SourceRow & { alreadyExisted: boolean }) | null>;
}

export const addSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => addSourceInput.parse(input))
  .handler(async ({ context, data }) => {
    const parsed = parseHttpUrl(data.url);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    /*
      The label, verbatim -- including an empty one.

      The host name used to be substituted here, which made "no label" and "the
      label is the host" the same string by the time the row was written, so a
      re-add with no label renamed a source that already had a name. The name a
      first-time row needs is the write path's business (source-seeds.server.ts),
      where the row's own title is visible.
    */
    const kind = data.kind || kindFromSourceUrl(parsed.url);
    const source = await upsertSource(
      context.userId,
      parsed.url,
      data.title,
      kind,
      data.tier || tierFromKind(kind),
      owned(context),
    );
    if (!source) return { ok: false as const, error: "Could not save that source." };
    return { ok: true as const, source, added: source.alreadyExisted ? 0 : 1, alreadyExisted: source.alreadyExisted ? 1 : 0 };
  });

export const addSourcesBulk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => bulkSourceInput.parse(input))
  .handler(async ({ context, data }) => {
    const rows = parseSourceLines(data.text);
    if (rows.length === 0) {
      return {
        ok: false as const,
        error: "No URLs found. One per line, or Title | URL.",
        added: 0,
      };
    }
    let added = 0;
    let alreadyExisted = 0;
    const byTier = { A: 0, B: 0, C: 0 };
    for (const row of rows) {
      const source = await upsertSource(
        context.userId,
        row.url,
        row.title,
        row.kind,
        row.tier,
        owned(context),
      );
      if (source?.alreadyExisted) alreadyExisted += 1;
      else if (source) {
        added += 1;
        if (row.tier === "A" || row.tier === "B" || row.tier === "C") {
          byTier[row.tier] += 1;
        }
      }
    }
    return { ok: true as const, added, alreadyExisted, total: rows.length, byTier };
  });

/**
 * The free tier of "Find a replacement" (SH0-10): what the panel draws before
 * the editor spends anything.
 *
 * ONE READ, NO FETCHES, NO MODEL. The candidates are the other sources the
 * desk already watches on the same beat -- so this costs the newsroom a query
 * it is already paying for, and it cannot hammer a host that just refused us.
 * The beat is resolved by `beatsForSource`, the same function the AI tier seeds
 * its topic from, so the two halves of the panel cannot describe the source
 * differently.
 *
 * THE REFUSALS ARE THE RANKER'S, NOT A COPY. `rankCandidates` drops the
 * newsroom's legally dropped hosts and orders the paper's own record first; the
 * query below only gathers the rows to rank. The dropped hosts are read as URLs
 * because that is what the column holds.
 */
export async function performReplacementCandidates(
  context: { userId: string; newsroomId?: number },
  sourceId: number,
): Promise<{
  beats: string[];
  beatNames: string[];
  candidates: ReturnType<typeof rankCandidates>;
}> {
  const sql = await getSql();
  const newsroomId = owned(context);
  const [source] = await sql.query<{
    id: number;
    title: string | null;
    proposed_section: string | null;
  }>("select id,title,proposed_section from sources where id=$1 and newsroom_id=$2", [
    sourceId,
    newsroomId,
  ]);
  if (!source) return { beats: [], beatNames: [], candidates: [] };

  const filed = await sql.query<{ section_key: string }>(
    "select section_key from section_sources where newsroom_id=$1 and source_id=$2",
    [newsroomId, sourceId],
  );
  const sections = await sql.query<{ key: string; name: string }>(
    "select key,name from newsroom_sections where newsroom_id=$1 and visible=true order by position asc",
    [newsroomId],
  );
  const beats = beatsForSource({
    sections: filed.map((row) => row.section_key),
    proposedSection: source.proposed_section,
    title: source.title,
    knownSections: sections,
  });

  /*
    Every other accepted source with the sections it is filed under. One query
    with a left join, so a source filed under nothing still comes back -- it is
    simply never a sibling, and the panel is right to leave it out.
  */
  const peers = await sql.query<{
    id: number;
    url: string;
    title: string | null;
    kind: string | null;
    sections: string[] | null;
  }>(
    `select s.id, s.url, s.title, s.kind,
            coalesce(array_agg(ss.section_key) filter (where ss.section_key is not null), '{}') as sections
       from sources s
       left join section_sources ss on ss.newsroom_id = s.newsroom_id and ss.source_id = s.id
      where s.newsroom_id = $1 and s.status = 'accepted' and s.id <> $2
      group by s.id, s.url, s.title, s.kind
      order by s.id asc`,
    [newsroomId, sourceId],
  );
  const dropped = await sql.query<{ url: string }>(
    "select url from sources where newsroom_id=$1 and status='dropped'",
    [newsroomId],
  );
  const [place] = await sql.query<{ city: string | null; state: string | null }>(
    "select city,state from paper_settings where newsroom_id=$1",
    [newsroomId],
  );
  /*
    The paper's OWN official host, from the sources it already holds -- the
    city it is in decides which of them that is, never a name written here.
  */
  const officialHost = cityOfficialHost(
    place?.city ?? "",
    peers.filter((p) => p.kind === "official").map((p) => p.url),
    place?.state ?? "",
  );

  const siblings = siblingCandidates(
    peers.map((p) => ({
      id: p.id,
      url: p.url,
      title: p.title,
      kind: p.kind,
      sections: p.sections ?? [],
    })),
    { sourceId, beats },
  );
  const candidates = rankCandidates(siblings, {
    officialHost,
    droppedHosts: dropped.map((row) => hostOf(row.url) ?? ""),
  });
  const nameOf = new Map(sections.map((s) => [s.key, s.name]));
  return { beats, beatNames: beats.map((key) => nameOf.get(key) ?? key), candidates };
}

export const replacementCandidates = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((sourceId: unknown) => rowId.parse(sourceId))
  .handler(async ({ context, data: sourceId }) => performReplacementCandidates(context, sourceId));

export const setSourceStatus = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => sourceStatusInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    /*
      0.6.70: the reviewer's decision and its note are recorded here too.
      This is the one-at-a-time path still used from the watch list; the
      Suggested list uses `reviewSuggestedSources` below, which does the same
      two writes for a whole batch. A row that goes BACK to 'proposed' -- the
      desk's own un-decision -- clears the record, because "reviewed at" on a
      row that is waiting to be reviewed is a lie the next reader would read
      off a null check.
    */
    const decided = data.status === "accepted" || data.status === "rejected";
    /*
      SH0-1: the failure streak DIES with the status it was recorded under.

      A paused row must never read "Keeps failing" -- the desk has stopped
      trying, so the sentence would be false -- and a source the editor removed
      and put back is being judged afresh, not continuing a streak that a
      different decision interrupted. Clearing it here is what makes both of
      those true by construction rather than by a guard somewhere downstream.
    */
    await sql`
      update sources set
        status = ${data.status},
        reviewed_at = case when ${decided} then now() else null end,
        review_note = case when ${decided} then review_note else null end,
        consecutive_failures = 0,
        failure_streak_started_at = null
      where id = ${data.id} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const };
  });

/**
 * The review press for the Suggested sources list: one decision, many rows.
 *
 * The transaction itself -- what it checks, why the section link is owner-only
 * and why it bumps `section_config.revision` -- lives in
 * `suggested-sources.server.ts`, where a test can call it with a context.
 * `desk.ts` cannot be imported under plain `node --test` (it reaches
 * `@/lib/...`), and "a failure changes nothing" is a claim about the database.
 */
export const reviewSuggestedSources = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => suggestedSourceReviewInput.parse(input))
  .handler(async ({ context, data }) => performReviewSuggestedSources(context, data));

/**
 * Every lead the newsroom holds, in the Queue's own order.
 *
 * Extracted from `listLeads` by Unit CZ-long-lists so the Queue's window can
 * read the same rows: `listQueuePage` narrows this list and cuts a page out of
 * it, while the batch dialog and the Sources screen still want all of it. One
 * query with one order -- a second copy would be a second answer to "which
 * leads are there", and the two would drift.
 */
async function queryLeadRows(context: { newsroomId: number }) {
  const sql = await getSql();
  return sql<
    LeadRow & {
      article_slug: string | null;
      investigation_id: number | null;
      story_headline: string | null;
    }
  >`
    select l.id, l.scan_run_id, l.headline, l.why, l.topic, l.topic_unchosen, l.status, l.source_urls, l.evidence, l.notes_json,
           l.newsworthiness, l.created_at, l.investigation_id, a.slug as article_slug,
           -- "import" = read out of a report the editor pasted; null = not
           -- recorded. The Queue shows the Imported badge off this.
           l.origin,
           coalesce(a.headline, (select nullif(d.headline, '') from drafts d
             where d.lead_id=l.id and d.newsroom_id=l.newsroom_id
             order by d.updated_at desc,d.id desc limit 1)) as story_headline,
           l.resurfaced_count, l.last_resurfaced_at, l.last_resurfaced_scan_run_id,
           l.possible_duplicate_of, l.dup_kind, l.kill_reason, l.kill_reason_url, l.killed_at,
           -- U28: the duplicate check's verdict, so the row's "Looks already
           -- printed" chip can carry the model's own sentence and can be
           -- suppressed when the desk asked and the answer was no. All six
           -- travel together: a chip gated on one of them without the target
           -- slug beside it could not tell "not the same story" from "never
           -- asked" (see printedDupChip in ./desk-copy.ts).
           l.dup_ai_same, l.dup_ai_why, l.dup_ai_target,
           l.dup_ai_printed_same, l.dup_ai_printed_why, l.dup_ai_printed_slug,
           -- Unit AK item 5: the Compare view shows both leads side by side
           -- without a second round trip, so the prior lead's why, sources,
           -- dates and kill record travel with the row.
           case when prior.id is null then null else jsonb_build_object(
             'id', prior.id, 'headline', prior.headline, 'status', prior.status,
             'why', prior.why, 'source_urls', prior.source_urls,
             'created_at', prior.created_at,
             'kill_reason', prior.kill_reason, 'kill_reason_url', prior.kill_reason_url,
             'killed_at', prior.killed_at
           ) end as possible_duplicate
    from leads l
    left join articles a on a.lead_id = l.id and a.status = 'published'
    left join leads prior on prior.id = l.possible_duplicate_of
      and prior.newsroom_id = l.newsroom_id
    where l.newsroom_id = ${owned(context)}
    -- An editor who just filed a lead by hand sinks below the batch first.
    --
    -- fileLead, writeStoryFromInput and a Dark Desk promotion all leave
    -- newsworthiness at 0 (or whatever the editor typed), and a scan's own
    -- output routinely scores higher -- so an operator who pasted a link
    -- into "Write a story" watched it land at the bottom of the same
    -- minute's scan batch instead of at the top where the thing they just
    -- asked for belongs. Every lead a scan files carries that scan's
    -- scan_run_id; nothing an editor files by hand ever does. Leads with no
    -- scan_run_id sort as one group ahead of every scan-filed lead, in
    -- their own recency order; scan-filed leads keep exactly the ordering
    -- below among themselves.
    --
    -- Newest batch first, best story first WITHIN the batch.
    --
    -- Ordering on the raw timestamp alone put a 14-point "no minutes posted
    -- for any 2026 council session" below an 8-point flag-committee item:
    -- a scan writes all its leads inside the same second, so the tie was
    -- broken arbitrarily and newsworthiness never entered into it. For a
    -- queue whose entire job is "what should I work on next", the score has
    -- to lead. Truncating to the minute keeps one scan's output together
    -- instead of interleaving batches by millisecond.
    order by (l.scan_run_id is null) desc,
             date_trunc('minute', l.created_at) desc,
             l.newsworthiness desc,
             l.id desc
  `;
}

/**
 * Every lead, for the readers that genuinely need all of them: the batch
 * dialog's eligible pool, the Sources screen's kill-pattern gate, the import
 * screen and `findDuplicate`. The Queue SCREEN does not call this any more --
 * it calls `listQueuePage` below, which sends it 25 rows.
 */
export const listLeads = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => queryLeadRows(context));

/**
 * The Queue screen's window (Unit CZ-long-lists).
 *
 * The real desk holds 41 live leads -- well over a screen of scroll -- and the
 * screen drew every one. This returns the tab-and-search match, in the chosen
 * order, cut to the page the editor asked for, plus the true total and the tab
 * counts, so the pills can say "All · 41" while 25 rows are on screen.
 *
 * The narrowing runs HERE, before the cut, and lives in `queue-rows.ts` as a
 * named rule rather than inline in the route: a window cut before the filter
 * would page the unfiltered list and show the wrong rows.
 *
 * `printed` is read because the "≈ Printed" tab and each row's duplicate chip
 * are decided against the published list, the same `nearDuplicate` the client
 * used to run. The two reads are sequential, not `Promise.all`: the dev desk
 * runs one PGlite connection and the driver does not want two queries in
 * flight on it.
 */
export const listQueuePage = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => cleanQueueWindow(input))
  .handler(async ({ context, data }) => {
    const all = await queryLeadRows(context);
    const printed = await queryPublishedRows(context);
    // U26b: the "≈ Printed" tab and each row's chip are decided with this
    // newsroom's own place words, the same ones the matcher files leads with.
    const place = await getPaperPlace(owned(context));
    const matched = queueSelect(
      all,
      printed,
      {
        filter: data.filter,
        section: data.section,
        sort: data.sort,
        needle: queueNeedle(data.search),
      },
      place,
    );
    const { rows, total } = takeWindow(matched, data.offset, data.limit);
    return { rows, total, counts: queueCounts(all, printed, place) };
  });

/**
 * Insert a lead exactly the way `fileLead` always has, plus the draft row
 * `publishLead` reads its source_urls from (see the note below) — pulled out
 * so `writeStoryFromInput` can file the same shape without duplicating it.
 *
 * Exported for Unit BK's "Add a lead" dialog. That dialog files a lead and then
 * branches (score it, draft it, or leave it), so it needs the filing without
 * the rest of `fileLead`; the alternative was a second insert of the same two
 * rows in a new file, which is how the draft's `source_urls` would eventually
 * be forgotten again and a hand-added lead would publish with no sources.
 */
export async function insertLeadWithDraft(
  context: { userId: string; newsroomId?: number },
  input: {
    headline: string;
    why: string;
    topic: string;
    urls: string[];
    notesJson?: string;
    /**
     * The line readers see under the story, for a filing screen that knows who
     * wrote it (Unit BW3: the New story dialog's paste tab). Empty is every
     * other caller and every story the desk writes, which prints the paper's
     * own AI line (`ai-disclosure.tsx:33`).
     */
    disclosure?: string;
    /**
     * `drafts.research_json.importedText`: the body is an editor's paste, not
     * prose a model wrote. The evidence-review gate reads this flag to tell the
     * two apart (`draft-evidence.ts:36`), and the paste screens mark their
     * drafts with it (`import-stories.server.ts:432`). False is every other
     * caller, which is the column's own default ('{}', `desk.ts:200`).
     */
    importedText?: boolean;
    /**
     * `leads.origin`: how this lead entered the desk, for a filing screen that
     * knows. The Queue draws its Imported mark off this one word
     * (`desk-leads.tsx:516`), and a lead filed by a scanner or by hand carries
     * none (`0091_import_provenance.sql`: null = not recorded).
     *
     * Unit BW5: the one-story paste panel filed through the import path, which
     * wrote `origin = 'import'` (`import-stories.server.ts:402`, `IMPORT_ORIGIN`),
     * so its paste wore the Imported mark on the Queue row. The drawn New story
     * dialog's paste tab is the same act on a different screen and now says so
     * with the same word (see `fileLead`). Absent is every other caller.
     */
    origin?: string;
  },
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const sql = await getSql();
  const urlsJson = JSON.stringify(input.urls);
  const origin = input.origin ?? null;
  const rows = input.notesJson
    ? await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, origin, notes_json)
        values (
          ${context.userId}, ${owned(context)}, ${input.headline}, ${input.why}, ${input.topic},
          ${urlsJson}, ${input.why.slice(0, 400)}, 0, 'new', ${origin}, ${input.notesJson}
        )
        returning id
      `
    : await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, origin)
        values (
          ${context.userId}, ${owned(context)}, ${input.headline}, ${input.why}, ${input.topic},
          ${urlsJson}, ${input.why.slice(0, 400)}, 0, 'new', ${origin}
        )
        returning id
      `;
  const id = rows[0]?.id;
  if (!id) return { ok: false as const, error: "Could not file that lead." };
  /*
    Carry the source through to the draft.

    The lead stored the URL and the draft did not, and `publishLead` reads
    the DRAFT's source_urls. So a lead filed by hand with a source published
    an article with no sources section at all, on a paper whose front page
    promises "Sources shown." An audit filed it as UX-005, and it is the
    worst kind of defect this project can have: the reader is told the
    evidence is there, and it is not.
  */
  await sql`
    insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, disclosure_text, research_json)
    values (
      ${context.userId}, ${owned(context)}, ${id}, ${input.headline}, ${input.why.slice(0, 220)}, '', ${input.topic},
      ${urlsJson}, ${input.disclosure ?? ""},
      ${input.importedText ? JSON.stringify({ importedText: true }) : "{}"}
    )
  `;
  await audit(context.userId, "lead", `filed ${id}`, owned(context));
  return { ok: true as const, id };
}

export const fileLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => fileLeadInput.parse(input))
  .handler(({ context, data }) => fileLeadForEditor(context, data, (input) => insertLeadWithDraft(context, input)));

/**
 * Whether a story about to be filed looks like one the paper already has.
 *
 * Unit BW5. The one-story paste panel warned that the paste looked like one the
 * paper already had, with a link to the story, computed from the Queue's own loaded lists
 * (`findDuplicate`, `import-review.ts:322`, over `listLeads` + `listPublishedDesk`)
 * -- and the drawn dialog holds no such lists, so the warning went with the
 * panel. This is that lookup, asked by the dialog that needs it.
 *
 * Same rule, same words as every other duplicate warning on the desk: the
 * comparison is `titlesOverlap` inside `findDuplicate`, the same one behind the
 * Queue's own ≈ PRINTED flag, so a paste is judged by the rule every other
 * story on the desk is. Published is offered before the desk's own leads, which
 * "already in the paper" being the more useful fact.
 *
 * `excludeLeadId` is the lead this press has just filed. The old panel looked
 * the duplicate up BEFORE the add, from lists loaded before the click, so the
 * paste could not find itself; this is asked after the draft is saved, when the
 * paste's own lead is already on the desk, so the row it would match is named
 * and left out. Its own headline is the one it always matches, and it is never
 * a duplicate of itself.
 *
 * A warning and nothing else: nothing is merged, killed or renamed.
 */
export const findPasteDuplicate = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => pasteDuplicateInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    /*
      The two lists the Queue screen loads, narrowed to what the comparison
      reads. `listLeads` returns every lead of the newsroom with no status
      filter (`desk.ts:372`), and `listPublishedDesk` every published article
      (`desk.ts:4253`); these are the same rows with the same scope.
    */
    const published = await sql<{ slug: string; headline: string }>`
      select slug, headline from articles
      where newsroom_id = ${owned(context)} and status = ${"published"}
    `;
    const leads = await sql<{ id: number; headline: string }>`
      select id, headline from leads
      where newsroom_id = ${owned(context)} and id <> ${data.excludeLeadId ?? 0}
    `;
    return findDuplicate({ headline: data.headline }, { leads, published }) ?? null;
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    kickJobs();
    const sql = await getSql();
    await ensureDeskDraftMemoSchema();
    const leads = await sql<LeadRow>`
      select l.id, l.scan_run_id, l.headline, l.why, l.topic, l.topic_unchosen, l.status, l.source_urls, l.evidence, l.newsworthiness, l.created_at, l.investigation_id, l.notes_json,
             l.meeting_video_id,l.meeting_artifact_id,l.meeting_lead_purpose,
             l.origin,
             l.possible_duplicate_of, l.dup_kind, l.kill_reason, l.kill_reason_url, l.killed_at,
             -- U28: the duplicate check's verdict, so the story page's chip
             -- and its Compare view say the same thing the Queue row does.
             l.dup_ai_same, l.dup_ai_why, l.dup_ai_target,
             l.dup_ai_printed_same, l.dup_ai_printed_why, l.dup_ai_printed_slug,
             -- Unit AK item 5: the Compare view shows both leads side by side
             -- without a second round trip, so the prior lead's why, sources,
             -- dates and kill record travel with the row.
             case when prior.id is null then null else jsonb_build_object(
               'id', prior.id, 'headline', prior.headline, 'status', prior.status,
               'topic', prior.topic,
               'why', prior.why, 'source_urls', prior.source_urls,
               'created_at', prior.created_at,
               'kill_reason', prior.kill_reason, 'kill_reason_url', prior.kill_reason_url,
               'killed_at', prior.killed_at
             ) end as possible_duplicate
      from leads l
      left join leads prior on prior.id = l.possible_duplicate_of
        and prior.newsroom_id = l.newsroom_id
      where l.id = ${id} and l.newsroom_id = ${owned(context)} limit 1
    `;
    const lead = leads[0];
    if (!lead) return null;
    const meetingTranscriptChoices = lead.meeting_video_id && lead.meeting_lead_purpose === "transcript-story"
      ? await loadMeetingTranscriptChoices(sql, owned(context), lead.meeting_video_id)
      : [];
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json,
             model_headline, model_topic, headline_source
      from drafts where lead_id = ${id} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;

    const live = await sql<{
      id: number;
      slug: string;
      headline: string;
      dek: string;
      body: string;
      topic: string;
    }>`
      select id, slug, headline, dek, body, topic from articles
      where lead_id = ${id} and newsroom_id = ${owned(context)} and status = 'published'
      limit 1
    `;
    const evidenceToken = drafts[0] ? evidenceReviewToken(drafts[0]) : "";
    const draft = drafts[0] ? unpackStoredDraft({ ...drafts[0] }) : null;
    const draftMeetingEvidence = drafts[0]
      ? await loadDraftMeetingEvidence(sql, { newsroomId: owned(context), draftId: Number(drafts[0].id) })
      : null;
    const meetingPublishEvidence = drafts[0]
      ? await loadMeetingPublishEvidence(sql, { newsroomId: owned(context), draftId: Number(drafts[0].id) })
      : null;
    const meetingPublishNotice = meetingPublishEvidence?.notice ?? null;
    const meetingCitationNotice = meetingPublishEvidence?.stale.length
      ? staleCitationNotice(meetingPublishEvidence.stale)
      : null;
    /*
      WR1 phase 2: the whole-meeting accounting the story page's Meeting ledger
      panel shows -- the ledger (unread rows first), the checked claims (flagged
      first, each with its reviewed mark), the full meeting notes, and the run
      stats line. Null when this lead's draft predates the whole-meeting writer,
      and the panel hides itself rather than opening empty.
    */
    const meetingAccounting = drafts[0]
      ? await (await import("./meeting-ledger.server.ts")).loadMeetingAccounting(sql, {
          newsroomId: owned(context),
          leadId: id,
        })
      : null;
    if (draft?.body) draft.body = stripReporterNotebook(draft.body);
    let notes = parseNotes(lead.notes_json);
    if (!notes.todo.length && draft?.unanswered) {
      let lines: string[] = [];
      try {
        const parsed = JSON.parse(draft.unanswered) as unknown;
        if (Array.isArray(parsed)) lines = parsed.map(String);
      } catch {
        lines = [];
      }
      const seeded = machineTodosFrom(lines);
      if (seeded.length) {
        notes = { ...notes, todo: seeded };
        /*
          Serialize with the notes module own writer, not a raw JSON slice.

          JSON.stringify(notes).slice(0, 8000) cut the blob mid-structure:
          it could drop a rich importedReport a pasted report had written
          (the main import path deliberately keeps the WHOLE report, and the
          note columns 8000-char cap is exactly the truncation the reporting
          work exists to avoid -- report E02), and on the wrong boundary it
          left invalid JSON that parseNotes read back as an empty memo,
          silently losing the editor notes. packNotes is the one writer:
          it keeps valid JSON, sheds the rebuildable lists first, and never
          drops importedReport, the topic confirmation or the hold record.
        */
        const json = packNotes(notes);
        await sql`
          update leads set notes_json = ${json} where id = ${id} and newsroom_id = ${owned(context)}
        `;
        lead.notes_json = json;
      }
    }
    const job = await latestJob({ newsroomId: owned(context), kind: "draft", subjectId: id });
    const activeMeetingArtifactId =
      job?.status === "queued" || job?.status === "running"
        ? (() => {
            try {
              const receipt = JSON.parse(job.result_json || "{}") as {
                meetingArtifactId?: unknown;
              };
              return Number.isInteger(receipt.meetingArtifactId)
              ? Number(receipt.meetingArtifactId)
              : lead.meeting_artifact_id == null ? null : Number(lead.meeting_artifact_id);
            } catch {
              return null;
            }
          })()
        : null;
    /*
      "Documents opened for this draft" is model-authored (notes.opened, from
      the draft's own notebook) and carries no capture status of its own --
      it is just a url/title pair the model wrote down. Look each url up
      against what was actually captured so the notes pane can say when one
      of them was a scanned PDF read by OCR (or still needs it), the same
      words `describeExtractionMethod` gives everywhere else on the desk.
    */
    const openedUrls = [...new Set(notes.opened.map((o) => o.url).filter(Boolean))];
    const extractionByUrl: Record<string, string | null> = {};
    if (openedUrls.length) {
      const rows = await sql<{ url: string; extraction_method: string | null }>`
        select distinct on (url) url, extraction_method
        from artifacts
        where newsroom_id = ${owned(context)} and url = any(${openedUrls})
        order by url, id desc
      `;
      for (const r of rows) extractionByUrl[r.url] = r.extraction_method;
    }
    /*
      The section this exact draft version was confirmed under, if any.

      Compared here rather than in the browser so the client never has to know
      how the draft's identity is computed -- and so a stale tab cannot decide
      for itself that a confirmation still counts.
    */
    const topicConfirmed =
      evidenceToken &&
      evidenceConfirmationMatches(notes.topicConfirmation?.token, drafts[0]) &&
      notes.topicConfirmation?.topic === String(drafts[0]?.topic ?? "").trim()
        ? notes.topicConfirmation!.topic
        : null;
    /*
      HOW MANY claims an editor has already accepted for this exact draft
      version, or 0 (unit U24b).

      A COUNT rather than a boolean: the acceptance is for "these three", and a
      judgment the desk later downgrades to unreviewed -- because the capture
      behind it changed, or its binding moved -- raises the number the story
      must answer for WITHOUT moving the draft's fingerprint. Three accepted
      must not print four, so the page compares this against what is
      outstanding now, and `performPublish` does the same on the server.

      Read here for the same reason `topicConfirmed` is: the client never has to
      know how the draft's identity is computed, and a stale tab cannot decide
      for itself that an acceptance still counts after the story was edited.
    */
    const unreviewedClaimsAcceptedCount =
      evidenceToken &&
      evidenceConfirmationMatches(notes.unreviewedClaimsConfirmation?.token, drafts[0])
        ? notes.unreviewedClaimsConfirmation!.count
        : 0;
    /*
      Unit ZC: the zero-claims gate, decided the same way `performPublish` decides
      it. `blocked` reads the page's publish blocker; `acknowledged` lets the desk
      say the acknowledgement is recorded. Both come from the draft's own memo --
      `evidenceCheckCoversCurrentVersion` reads the completion stamp and the body,
      so an edit reopens the gate for the page exactly as it does for the server.
    */
    const uncheckedStoryAcknowledged =
      Boolean(evidenceToken) &&
      notes.uncheckedStoryConfirmation?.token === topicConfirmationFingerprint(evidenceToken);
    /*
      Unit ZC: the inputs of the zero-claims gate, so the PAGE can decide it over
      the CURRENT (possibly unsaved) fields rather than the saved row alone -- an
      editor who types a dollar figure and has not saved must still see the chip
      and the block. `recordedClaims` is the run's own output; `evidenceChecked`
      is whether a completed check covers the SAVED version (the completion stamp
      is a server identity the client cannot recompute); `acknowledged` is whether
      the acknowledgement on file names the saved version.
    */
    const uncheckedRecordedClaims = drafts[0]
      ? (await unreviewedClaimsGate(owned(context), id)).recordedClaims
      : 0;
    const uncheckedEvidenceChecked = drafts[0] ? evidenceCheckCoversCurrentVersion(drafts[0]) : false;
    const uncheckedExempt = drafts[0]
      ? drafts[0].form === "editorial"
      : false;
    /*
      The named-outlet check, run for display only -- performPublish decides.

      Same inputs the publish gate uses, so the desk and the refusal cannot
      disagree about what is outstanding: the body as it will print (the
      notebook is already stripped above), the Sources the reader will see, and
      the overrides already recorded for this draft. The recorded rows
      themselves are returned too: an override is a decision the paper made, and
      the desk is where a person can see who made it.
    */
    const outletReport = await performNamedOutletReport(context, id);
    const namedOutlets = outletReport.namedOutlets;
    const outletOverrides = outletReport.overrides;
    return {
      lead,
      meetingTranscriptChoices,
      defaultMeetingTranscriptArtifactId: activeMeetingArtifactId
        ?? defaultMeetingTranscriptArtifactId(meetingTranscriptChoices),
      draft,
      draftMeetingEvidence,
      meetingPublishNotice,
      meetingCitationNotice,
      meetingAccounting,
      evidenceToken,
      topicConfirmed,
      unreviewedClaimsAcceptedCount,
      uncheckedStoryAcknowledged,
      uncheckedRecordedClaims,
      uncheckedEvidenceChecked,
      uncheckedExempt,
      namedOutlets,
      outletOverrides,
      articleSlug: live[0]?.slug ?? null,
      /*
        The id and the printed headline of the article, so the story page can
        edit the headline that is actually on the paper (0.6.67). A published
        story has no editable draft -- its words live in `articles`, and the
        paper's headline may have been changed after it went up -- so the
        headline box needs both the row it would be changing and the words the
        reader is seeing now.
      */
      articleId: live[0]?.id ?? null,
      articleHeadline: live[0]?.headline ?? null,
      articleDek: live[0]?.dek ?? null,
      articleTopic: live[0]?.topic ?? null,
      // Sent whole, like the draft's own body, so the live workbench can seed
      // the editable boxes from the story the reader is looking at.
      articleBody: live[0]?.body ?? null,
      openedExtractionByUrl: extractionByUrl,
      job,
      // Draft has no separate run table -- desk_jobs IS the record, so
      // "orphaned" cannot happen here; only a cold heartbeat means dead.
      stalled: runLooksStalled({
        runOpen: job?.status === "running" || job?.status === "queued",
        job,
      }),
    };
  });

/**
 * The whole transcript behind a meeting story, for the editor to read.
 *
 * The id is the ONLY thing this server function accepts. The path the bytes
 * come from is read from the `meeting_transcript_artifacts` row inside
 * `loadTranscriptView`, scoped to the caller's newsroom, so a caller cannot
 * name a file even by accident -- there is no field here to name one with.
 * `artifact_type='transcript'` is part of the row's identity rather than a
 * filter added here, so this view and the download route resolve the artifact
 * the same way.
 */
export const getTranscriptView = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((artifactId: unknown) => artifactIdInput.parse(artifactId))
  .handler(async ({ context, data: artifactId }) => {
    const { loadTranscriptView } = await import("./meeting-transcript-view.server.ts");
    const sql = await getSql();
    try {
      const view = await loadTranscriptView(sql, {
        newsroomId: owned(context),
        artifactId,
      });
      return {
        ok: true as const,
        view,
        downloadUrl: transcriptDownloadUrl(view.artifactId),
      };
    } catch (error) {
      /*
        A refusal is a page, not a crash. "This transcript belongs to another
        newsroom" is something an editor can be told plainly; an error boundary
        would say the desk broke.
      */
      if (error instanceof TranscriptViewRefused) {
        return { ok: false as const, reason: error.reason, message: error.message };
      }
      throw error;
    }
  });

export const listMemory = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<MemoryRow>`
      select id, entity, last_angle, updated_at
      from beat_memory
      where newsroom_id = ${owned(context)}
      order by updated_at desc
      limit 80
    `;
  });

export const grokStatus = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async () => {
    // Real check, not just "is something configured": on the Claude Code path
    // this confirms the CLI is actually installed, so the desk never shows a
    // green light that turns into a failed draft.
    const probe = await probeProvider();
    if (probe.ok) return { available: true as const };
    return { available: false as const, message: probe.error };
  });

export const listScans = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: { limit?: number; offset?: number } | undefined) => {
    const limit = Math.min(Math.max(Math.trunc(Number(input?.limit ?? 12)) || 12, 1), 50);
    const offset = Math.max(Math.trunc(Number(input?.offset ?? 0)) || 0, 0);
    return { limit, offset };
  })
  .handler(async ({ context, data }) => {
    kickJobs();
    const sql = await getSql();
    const { limit, offset } = data;
    const rows = await sql<ScanRow>`
      select id, started_at, finished_at, sources_fetched, leads_created, sources_proposed, sources_selected, sources_attempted, sources_failed, sources_analyzed, model_batches_used, model_batches_failed, failed_sources, source_coverage, meetings_found, meetings_captured, meetings_failed, meeting_failures, summary, error, execution_origin
      from scan_runs
      where newsroom_id = ${owned(context)}
      order by started_at desc
      limit ${limit} offset ${offset}
    `;
    const [count] = await sql<{ total: number }>`
      select count(*)::int as total from scan_runs where newsroom_id = ${owned(context)}
    `;
    await annotateScanRowsWithStallStatus(rows, owned(context));
    // P0-4: rows and the true total in one response, so the panel can say
    // "showing latest N of M" and page older runs without re-running a scan.
    return { rows, total: count?.total ?? rows.length };
  });

/**
 * P0-1: list accepted sources for the Custom sources picker. Only accepted
 * rows -- proposed/rejected/unavailable are never selectable.
 */
export const listAcceptedScanSources = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: number;
      title: string;
      url: string;
      kind: string;
      tier: string;
      status: string;
    }>`
      select id, title, url, kind, tier, status
      from sources
      where newsroom_id = ${owned(context)} and status = 'accepted'
      order by case tier when 'A' then 0 when 'B' then 1 else 2 end, title asc
    `;
  });

/** P0-2: saved source packs for this newsroom, with current accepted counts. */
export const listScanSourcePacksFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { listScanSourcePacks } = await import("./scan-source-packs.server.ts");
    return listScanSourcePacks(owned(context));
  });

/** P0-2: create or update a named pack from an explicit accepted source set. */
export const saveScanSourcePackFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => packSaveInput.parse(input))
  .handler(async ({ context, data }) => {
    const { saveScanSourcePack } = await import("./scan-source-packs.server.ts");
    return saveScanSourcePack({
      newsroomId: owned(context),
      userId: context.userId,
      name: data.name,
      sourceIds: data.sourceIds,
      packId: data.packId,
    });
  });

/** P0-2: rename a pack without touching its membership. */
export const renameScanSourcePackFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => packRenameInput.parse(input))
  .handler(async ({ context, data }) => {
    const { renameScanSourcePack } = await import("./scan-source-packs.server.ts");
    await renameScanSourcePack({
      newsroomId: owned(context),
      packId: data.packId,
      name: data.name,
    });
    return { ok: true as const };
  });

/** P0-2: delete a pack. Accepted sources themselves are untouched. */
export const deleteScanSourcePackFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => packDeleteInput.parse(input))
  .handler(async ({ context, data }) => {
    const { deleteScanSourcePack } = await import("./scan-source-packs.server.ts");
    await deleteScanSourcePack({ newsroomId: owned(context), packId: data.packId });
    return { ok: true as const };
  });
export const runScan = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  // `input ?? {}` is preserved by the schema: a no-dial run is a real run.
  .validator((input: unknown) => runScanInput.parse(input))
  .handler(async ({ context, data }) => {
    /*
      SG1 / Option A: an install nobody has set up has NO town. Until the owner
      finishes Paper setup this refuses in one plain sentence rather than
      scanning Longmont's sources on a fresh install's behalf.
    */
    /*
      Check the model BEFORE spending the scan.

      This used to enqueue unconditionally: the job fetched every watched
      source and only then failed at the model call, leaving the editor with a
      failed run, no setup guidance, and an invitation to try again that no
      retry could satisfy. An outside audit walked a first-run paper with no
      provider and called it a Blocker, correctly — the core action dead-ends.

      Refusing here costs nothing and says what to do -- and it now goes
      through the same commit boundary Story uses, so a scan run pins to a
      concrete provider the same way a draft does. See `scanPreflight` and
      `commitScanForAuthenticatedEditor`.
    */
    const setup = await paperSetupWarning(context, data.override, "start the scan");
    if (setup) return { ...setup, detail: "", retryable: true };
    await ensureSeeds(context.userId, owned(context));
    const modelChoice = storyModelChoice(data.modelChoice);
    const { commitScanForAuthenticatedEditor } = await import("./model-request-commit.server.ts");
    return commitScanForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      modelChoice,
      modelEffort: modelEffort(modelChoice, data.modelEffort),
      daily: data.daily,
      sectionKey: data.sectionKey,
      customSourceIds: data.customSourceIds,
      packId: data.packId,
      override: data.override,
    });
  });

/**
 * Re-check ONE watch-list source (unit U24).
 *
 * WHAT THIS REPLACED, AND WHY IT WAS WRONG. The row's "Retry" used to call
 * `runScan` with `customSourceIds: [id]` -- a real manual scan: a `scan_runs`
 * row, a queued job, the model writing pass, leads filed, and a refusal
 * outright if another scan was already open. On the stand-in editorial day
 * pressing Retry on one unreadable source produced, instead of a re-check, a
 * failed scan whose report read "Provider failure after 0 fetched" beside
 * "First source failed: Page had almost no readable text" -- and the row itself
 * said nothing had been attempted. The editor asked "can we read this page
 * now?" and the desk spent a model budget answering a different question.
 *
 * So this is the fetch half of the scan and only the fetch half: the same
 * `ingestUrl` the scan loop binds (`performScanWork`'s `fetchUrl`), the same
 * `withRetry`, the same error strings -- which is what makes the row's reason
 * and the scan's `failed_sources` entry read identically -- and no model call,
 * no job, no leads, and no `scan_runs` row. It writes exactly the two columns
 * the row is drawn from (`last_error`, `last_fetched_at`), so the chip, the
 * reason and the "Could not check · 14" count all move together.
 *
 * It deliberately writes NO snapshot. A snapshot is the scan's record of what a
 * source said at a moment, and it is what "3 new items" is counted from; this
 * is a readability check, and claiming new content from it would be inventing
 * a change nobody looked for.
 *
 * TWO FENCES, BOTH SERVER-SIDE (unit U24b). The row's press is drawn only for
 * accepted sources, and the server says the same thing: a source that is not
 * ACCEPTED is not re-checked. Accepted is the status the press exists for;
 * `paused` means "do not fetch on a schedule" but the row offers Resume and
 * Remove there, not Retry, so allowing a paused row would be an unexercised
 * permission. A rejected source is off the watch list entirely.
 *
 * And a short cooldown (`assertCooldown`), because the press fetches somebody
 * else's web server: without it a held-down Retry is a burst at that site, and
 * the editor learns nothing new between one press and the next anyway.
 */
export const performCheckOneSource = createServerOnlyFn(async function performCheckOneSource(
  context: { userId: string; newsroomId?: number },
  sourceId: number,
  cooldownSeconds = 30,
  override?: string[],
) {
  return checkSourceForEditor(context, sourceId, override, async (src) => {
    const sql = await getSql();
  /*
    `withRetry` is the scan's own: one transient timeout is retried there and
    not here, so a source that reads on the second try reads on this press too
    rather than reporting a failure the scanner would not have reported.
  */
  try {
    const bundle = await withRetry(() => ingestUrl(src.url));
    const text = postgresText(bundle.text);
    if (!text.trim()) throw new Error("Page had almost no readable text");
    /*
      SH0-1: the manual check is an ATTEMPT like any other, so it moves the
      streak the same way the scan does -- one code path per outcome, and this
      is the second of them. A press that reads the page ends the streak; a
      press that fails extends it by one, exactly as the scanner would have.

      SH-B: a press that read the page ends any wait and any block, the same
      way a scan that read it does. Without this the row the editor just fixed
      would keep saying "Waiting" -- the chip and the note are drawn from these
      columns, and a successful read that left them behind would make the press
      look like it had done nothing.

      HIGH-1 (A-B8): all three write sites go through `writeSourceTouch` now,
      so a press, an inline scan and the scheduled scan's queued commit cannot
      drift apart on what a read or a refusal does to a row.
    */
    await writeSourceTouch(sql, {
      id: sourceId,
      newsroomId: owned(context),
      touch: { ...touchAfterSuccess(), readMethod: bundle.method, readOutcome: bundle.outcome, readRouteUrl: bundle.routeUrl, newsletterUrl: bundle.newsletterUrl },
    });
    return {
      ok: true as const,
      url: src.url,
      title: bundle.titleHint?.trim() || src.title,
      characters: text.length,
      line: bundle.method === "playwright" ? "Read through a browser." : bundle.method === "feed" ? "Read through its feed." : "Read OK now.",
    };
  } catch (err) {
    const msg = postgresText(err instanceof Error ? err.message : "fetch failed");
    /*
      SH-B: an editor's press is still the desk knocking on somebody's server,
      so a refusal it earns is recorded with the same rules a scan uses -- the
      site's `Retry-After` if it gave one, otherwise the default wait, and for
      a block the next step of the backoff. The press itself is never refused:
      the editor asked, and `assertCooldown` above is what stops a held-down
      button from being a burst.
    */
    const failure = classifyRefusal({
      status: err instanceof BlockedAfterRenderError ? 403 : err instanceof IngestFetchError ? err.status : null,
      retryAfterMs: err instanceof IngestFetchError ? err.retryAfterMs : null,
      nowMs: Date.now(),
    });
    const touch = failure
      ? touchAfterFailure({
          refusal: failure,
          previousBlockedAt: src.blocked_at,
          previousBlockedAttempts: src.blocked_attempts,
          nowMs: Date.now(),
        })
      : touchAfterError(msg);
    if (err instanceof IngestFetchError) touch.newsletterUrl = err.newsletterUrl;
    if (err instanceof BlockedAfterRenderError) {
      touch.last_error = msg;
      touch.retry_after_note = msg;
      touch.readMethod = "playwright";
      touch.readOutcome = err.outcome;
      touch.newsletterUrl = err.newsletterUrl;
    }
    if (touch.countsAgainstHostCap) await noteHostRefusal(sql, owned(context), sourceHost(src.url));
    await writeSourceTouch(sql, {
      id: sourceId,
      newsroomId: owned(context),
      touch,
    });
    return {
      ok: false as const,
      url: src.url,
      title: src.title,
      error: msg,
      /* The row's own words for this error, so the line under the row and the
         reason already on it cannot describe the same failure twice. */
      line: `Still failing: ${editorFetchError(msg, src.url) ?? msg}`,
    };
  }
  }, cooldownSeconds);
});

export const checkOneSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => sourceCheckInput.parse(input))
  .handler(({ context, data }) => performCheckOneSource(context, data.sourceId, 30, data.override));

/*
  SH-B: the per-host allowance for hostile answers.

  Three tiny helpers rather than one clever query, because each answers a
  different question and they are read in different places. `sourceHost` is the
  key they share, and it is the hostname -- not the URL and not the port --
  because a site that has decided to refuse this desk is refusing the desk, and
  every path on it counts as the same site.
*/
function sourceHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The first moment of tomorrow, in the desk's own timezone. Reading "will try
 *  again tomorrow" as "in exactly 24 hours" would be a small lie the second
 *  time it is printed. */
function startOfTomorrow(nowMs: number): Date {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  return d;
}

async function hostAtDailyCap(sql: Sql, newsroomId: number, host: string): Promise<boolean> {
  if (!host) return false;
  const rows = await sql<{ tries: number }>`
    select tries from source_host_tries
    where newsroom_id = ${newsroomId} and host = ${host} and day = current_date
  `;
  return (rows[0]?.tries ?? 0) >= BLOCKED_TRIES_PER_HOST_PER_DAY;
}

async function noteHostRefusal(sql: Sql, newsroomId: number, host: string): Promise<void> {
  if (!host) return;
  await sql`
    insert into source_host_tries (newsroom_id, host, day, tries)
    values (${newsroomId}, ${host}, current_date, 1)
    on conflict (newsroom_id, host, day) do update set tries = source_host_tries.tries + 1
  `;
}

/** Injectable seam so a scan job with a real Claude/Codex 401 mid-run, and
 * the failover it triggers, can be tested without a real provider. Same
 * pattern as `PerformDraftWorkDeps`. */
export type PerformScanWorkDeps = {
  grokChat?: typeof grokChat;
  probe?: typeof probeProvider;
  setJobModelChoice?: typeof setJobModelChoice;
  setJobStage?: typeof setJobStage;
  onModelSwitch?: import("./scan-model-run.ts").RunScanChatWithFailoverInput["onSwitch"];
  ingestUrl?: typeof ingestUrl;
  scheduledGuard?: () => Promise<unknown>;
  scheduledSnapshot?: {
    model: { localModel?: { baseUrl: string; id: string } };
    sources: SourceRow[];
    coverage?: unknown;
  };
  beforeScheduledCommit?: () => Promise<void>;
  scheduledCommit?: <T>(write: (sql: Sql) => Promise<T>) => Promise<T>;
  scheduledFailure?: (msg: string, write: (sql: Sql) => Promise<void>) => Promise<void>;
};

/**
 * U28: the published stories a fresh lead can look like, in the shape the
 * duplicate check reads (slug, headline, the dek the model is shown, topic,
 * date).
 *
 * Deliberately NOT `queryPublishedRows`: that reader exists for screens and
 * carries every article's body, its corrections and its meeting reviews, which
 * is a great deal of text to move in order to ask about one headline. This is
 * the narrow read, and it keeps that reader's order -- newest first -- because
 * `nearDuplicate` returns the FIRST match in the list and the chip shown later
 * must be the pair the desk asked about (see `printedDupChip`, which refuses a
 * verdict recorded against a different slug).
 */
async function queryDupCheckPrinted(context: { newsroomId: number }): Promise<DupCheckPrinted[]> {
  const sql = await getSql();
  return sql<DupCheckPrinted>`
    select slug, headline, dek, topic, published_at
    from articles
    where newsroom_id = ${owned(context)} and status = ${"published"}
    order by published_at desc nulls last, id desc
  `;
}

/**
 * U28: the scan's audit line.
 *
 * The duplicate check's one consequence an editor could notice without asking
 * for it is a "Possible duplicate · compare" LINK that is not there, on a pair
 * the word rule had flagged. That is the right outcome when the desk's model
 * read both and said they are not the same story, but "the desk decided
 * something and said nothing" is the failure mode this repository keeps
 * writing tests against, so the count goes in the run's own record and in the
 * audit event. The clause is absent entirely when nothing was cleared, so the
 * ordinary line reads exactly as it always has.
 */
function scanAuditDetail(
  runId: number,
  fetchedCount: number,
  leadsCreated: number,
  dupCheckCleared: number,
): string {
  const base = `run ${runId} fetched ${fetchedCount} leads ${leadsCreated}`;
  return dupCheckCleared > 0
    ? `${base}, ${dupCheckCleared} possible-duplicate link(s) cleared by the duplicate check`
    : base;
}

/**
 * The receipt for a pass that knocked on nothing because everything on watch
 * was waiting (see `everySourceWasSkipped` in `performScanWork`).
 *
 * A sentence rather than a code, because it is what an editor reads on the
 * desk's history, and it has to answer the only question that row raises:
 * "why did my scan do nothing?" The count is there so the answer is a size and
 * not a shrug -- a newsroom with one parked source and a newsroom with forty
 * are different situations.
 *
 * Agreeing with the number is the whole job of the grammar below: "1 sources
 * are waiting for their time to come back" reads as a bug in the paper, which
 * is exactly what this receipt exists to stop the editor thinking.
 */
export function noOpScanReceipt(skipped: number): string {
  const sources = skipped === 1 ? "1 source" : `${skipped} sources`;
  return `Nothing was due: ${sources} ${skipped === 1 ? "is" : "are"} waiting for ${
    skipped === 1 ? "its" : "their"
  } time to come back`;
}

/*
  Wrapped in createServerOnlyFn for the same reason performDraftWork is (see
  the comment above it): this file is reachable both statically, from client
  route components, and dynamically, from jobs.ts's background runner. Once
  this function's own body called `probeProvider` directly (for the
  Automatic failover probe, mirroring `failOverAndRetry`), the bundler's
  import-protection plugin started pulling ai-claude-code.server.ts and
  ai-codex.server.ts into the client bundle via that reference -- the exact
  build failure `performDraftWork`'s comment describes. Marking this
  server-only strips it from every client bundle by construction.
*/
export const performScanWork = createServerOnlyFn(async function performScanWork(
  job: DeskJob,
  deps: PerformScanWorkDeps = {},
) {
  let failureRunId = job.subject_id;
  let writeQueuedSourceWrites = async (_sql: Sql): Promise<void> => {};
  let sourceCoverage: ScanSourceCoverageEntry[] = [];
  const failureReceipt = {
    sourcesCompleted: 0,
    sourcesSelected: 0,
    sourcesAttempted: 0,
    sourcesFetched: 0,
    sourcesFailed: 0,
    sourcesAnalyzed: 0,
    modelBatchesUsed: 0,
    modelBatchesFailed: 0,
    failedSources: "[]",
  };
  let meetingAwareness: import("./meeting-capture.ts").MeetingAwarenessResult | null = null;
  try {
    const runChat = deps.grokChat ?? grokChat;
    const probe = deps.probe ?? probeProvider;
    const setModelChoice = deps.setJobModelChoice ?? setJobModelChoice;
    /*
    The index-aware reporter, not the raw `setJobStage`: this worker's job row
    carries the stage list written at claim, so each of its sentences -- the
    document reader's, report.ts's, the failover notes -- arrives with the chip
    it belongs to. See `progressReporterFor`.

    The seam keeps its `(id, sentence)` shape because `desk-model-run.ts` and
    `report.ts` pass this function down through their own deps, and every caller
    passes THIS job's id. The reporter closes over that same row, so the id
    argument is redundant here rather than ignored -- and it is the row, not the
    id, that carries the stage list.
  */
    const reportStage = progressReporterFor(job);
    const setStage: typeof setJobStage = deps.setJobStage ?? ((_id, stage) => reportStage(stage));
    /*
    SH-B item 1: one host, one request at a time, a short gap between them.

    One gate for the whole pass, so the pacing is shared by every source the
    scan reads out of the same host -- which is the case that mattered: six
    city pages under one domain, six workers, and fifty requests to one small
    municipal server with nothing between them. `deps.ingestUrl` overrides the
    fetch entirely (tests and the offline paths), and in that case there is no
    network to pace.
  */
    const hostGate = createHostGate();
    const fetchUrl = deps.ingestUrl ?? ((url: string) => ingestUrl(url, { schedule: hostGate.schedule }));
    const context = { userId: job.user_id, newsroomId: job.newsroom_id };
    const paperConfig = await getPaperConfig(owned(context));
    /*
    U26b: this newsroom's own place, read HERE and not at the point of use.

    `fileScanLeads` runs inside `commitResults`, which runs inside
    `withTransaction` (or the scheduler's equivalent), and `getPaperPlace`
    reads through the connection pool: on the dev desk's single PGlite
    connection a pool read inside an open transaction is a second query on a
    connection that is already busy with this one. Reading it out here, beside
    the paper config read, keeps it a plain read on an idle connection. A
    scan is one job; the paper's place does not change under it.
  */
    const scanPlace = await getPaperPlace(owned(context));
    await ensureSeeds(context.userId, owned(context));
    const sql = await getSql();
    const meetingChannels = paperConfig.youtubeChannels ?? [];
    /*
    FB1: the scan's first arrival, and the honest sentence even when the paper
    has no channels configured -- the worker does look, finds nothing to look
    at, and moves on. Before this the whole kind had no stage list at all, so
    the run that spends the most money on the desk drew no chip row.
  */
    await reportStage("Checking for meeting material");
    if (meetingChannels.length > 0) {
    try {
      const { runMeetingAwareness, recheckProvisionalMeetings } = await import("./meeting-capture.ts");
      meetingAwareness = await runMeetingAwareness(sql, owned(context));
      const recheck = await recheckProvisionalMeetings(sql, owned(context));
      if (recheck.failures.length) {
        meetingAwareness.failures.push(...recheck.failures);
        meetingAwareness.coverageLine = `${meetingAwareness.coverageLine} (recheck: ${recheck.checked} checked, ${recheck.revised} revised, ${recheck.settled} settled)`;
      }
    } catch (e) {
      meetingAwareness = {
        configured: true,
        found: [],
        uncaptured: [],
        captured: [],
        failed: [],
        coverageLine: "",
        failures: [e instanceof Error ? e.message : String(e)],
        archivePath: null,
      };
    }
  }
    /*
    Speech-to-text (unit R) runs AFTER the capture pass, never inside it. A
    meeting that ended at audio because captions were unavailable is exactly the
    one worth transcribing -- but textflowkit is optional and external, so a
    missing or unhappy tool adds a line to the coverage summary instead of
    failing a scan that otherwise did its job. When it is not installed nothing
    is queued and the coverage line is unchanged.
  */
    if (meetingAwareness) {
    try {
      const { enqueueMissingTranscriptions } = await import("./textflowkit-transcribe.server.ts");
      const speech = await enqueueMissingTranscriptions(sql, { newsroomId: owned(context), userId: job.user_id });
      if (speech.queued > 0) {
        meetingAwareness.coverageLine = `${meetingAwareness.coverageLine} (speech-to-text: ${speech.queued} queued)`;
      }
    } catch (e) {
      meetingAwareness.failures.push(`speech-to-text: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
    let runId = job.subject_id;
    const { getSections } = await import("./sections.server.ts");
    const sectionConfig = await getSections(owned(context));
    if (runId > 0) {
    const existing = await sql<{ id: number }>`
      select id from scan_runs where id = ${runId} and newsroom_id = ${owned(context)} limit 1
    `;
    if (!existing[0]) runId = 0;
  }
    if (runId <= 0) {
    const runRows = await sql<{ id: number }>`
      insert into scan_runs (user_id, newsroom_id) values (${context.userId}, ${owned(context)}) returning id
    `;
    runId = runRows[0]!.id;
  }
    failureRunId = runId;

    const [scanRun] = await sql<{
    section_snapshot: string | null;
    source_snapshot: string | null;
    policy_snapshot: string | null;
    source_coverage: unknown;
  }>`select section_snapshot, source_snapshot, policy_snapshot, source_coverage from scan_runs where id=${runId} and newsroom_id=${owned(context)}`;
    const parsedSnapshot = scanRun?.section_snapshot ? JSON.parse(scanRun.section_snapshot) : null;
    const { isCustomScanSnapshot } = await import("./section-types.ts");
    // P0-1: a Custom scan carries its explicit accepted source set in the
    // snapshot; a section scan carries a section scope; otherwise General.
    const customSnapshot = isCustomScanSnapshot(parsedSnapshot) ? parsedSnapshot : null;
    const sectionSnapshot = customSnapshot
    ? null
    : (parsedSnapshot as import("./section-types.ts").SectionScanSnapshot | null);
    /*
    The sections this run may file under, as the objects every later step needs.

    The prompt is handed the key, the display name and the editor's reporting
    brief for each one -- a model shown nothing but `schools` was guessing at
    what this newsroom means by it. The keys stay in this order because the
    parser's fallback for a lead the model did not file under a section is the
    first entry (`schema.ts`), and that has always been the first configured
    section.
  */
    const filingSections: { key: string; name: string; brief: string }[] = sectionSnapshot
    ? [sectionSnapshot]
    : sectionConfig.sections.filter((s) => !s.replacementKey && !["about", "opinion"].includes(s.key));
    const allowedTopics = filingSections.map((s) => s.key);
    const topicChoices = filingSections.map((s) => ({ key: s.key, name: s.name, brief: s.brief }));
    // A manual daily run pins the same source plan as the schedule, while using
    // the editor's chosen model and the normal manual claim/commit boundaries.
    const dailyPolicy = scanRun?.policy_snapshot ? JSON.parse(scanRun.policy_snapshot) : null;
    const dailySources: SourceRow[] | undefined = dailyPolicy?.daily && scanRun?.source_snapshot
    ? (dailyPolicy.acceptedSources ?? JSON.parse(scanRun.source_snapshot)) : undefined;
    const allSources =
    deps.scheduledSnapshot?.sources ?? dailySources ??
    (await sql<SourceRow>`
      select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error,
             last_read_method, last_read_outcome, last_read_route_url, newsletter_url,
             -- SH-B: the wait a site asked for, and the block it put on us. Both
             -- are read here because the pass has to SKIP a parked row, which
             -- is the only thing that makes a recorded "come back at 3:40"
             -- mean anything.
             retry_after, retry_after_note, blocked_at, blocked_attempts, last_ok_at
      from sources
      where newsroom_id = ${owned(context)} and status = 'accepted'
      order by case tier when 'A' then 0 when 'B' then 1 else 2 end, id asc
    `);
    // Custom scope: only the explicitly selected, still-accepted sources. The
    // predicate lives in section-types.ts (`selectCustomScanSources`) so the
    // focused test binds to the code that actually runs here, not a copy.
    const sources = customSnapshot
    ? selectCustomScanSources(customSnapshot, allSources)
    : selectedScanSources(sectionSnapshot, allSources);
    failureReceipt.sourcesSelected = sources.length;
    if (sectionSnapshot && !sources.length)
    throw new Error(
      "This section no longer has accepted assigned sources. Review Paper setup and start a new scan.",
    );
    if (customSnapshot && !sources.length)
    throw new Error(
      "None of the selected sources are still accepted. Choose the custom set again and start a new scan.",
    );

    const fetched: {
    id: number;
    title: string;
    url: string;
    text: string;
    extras: { url: string; text: string }[];
    changed: boolean;
  }[] = [];
  const pendingHashes: { id: number; hash: string; text: string; changed: boolean }[] = [];
  const pendingNewsletterSignups: { id: number; url: string }[] = [];
  /*
    The scheduled path queues its writes and commits them inside the run
    transaction. It carries the same columns the manual path writes inline --
    the politeness columns included -- because the two paths are the same
    feature and a row must not depend on which kind of scan touched it. This is
    the mistake `scan-coverage.test.ts` exists to catch.
  */
    /*
    HIGH-1 (A-B8): the queue carries a whole `SourceTouch`, `outcome` included,
    and `writeSourceTouch` branches on that word. It used to carry a loose
    `error` and the scheduled commit read "did we read it?" off `error is null`
    -- true for a "come back later" touch, so the unattended scan wrote a 429 as
    a successful read. A touch that has to state its own outcome cannot be
    mistaken for the other kind of touch.
  */
    const pendingSourceTouches: { id: number; touch: SourceTouch }[] = [];
    const pendingDisappeared: { title: string; url: string; error: string }[] = [];
    /*
    CIVIC REPORTING / SOURCE OBSERVATIONS (migration 0128).

    Every real touch of a source in this pass leaves a dated, append-only
    observation behind: the page changed, the page was quiet, the site asked us
    to wait, the site blocked us, the read failed. The pure vocabulary and the
    "which kind is this touch" decision live in source-observations.server.ts
    (`observationForTouch`); this queue is only the transport so the scheduled
    lane writes them in the same transaction as the touch it is already
    queuing (a scheduled scan writes nothing to the row during the loop).

    WHY THIS EXISTS AT ALL. "We read it and nothing changed" and "we never
    knocked" are different facts and used to look identical on the screen --
    both were just a `last_fetched_at` that did not move. A reporter asking
    "has this source ever actually been checked?" could not tell them apart.
    The observation records the fetch, the hash comparison and the refusal
    separately, scoped to THIS newsroom and THIS source, keyed by the run so a
    retried pass cannot double-record one attempt.

    A failing observation write must never erase the touch that already
    happened: the consumer below swallows its own errors (see
    `recordScanObservation`).
  */
    const pendingObservations: {
    sourceId: number;
    input: { kind: ObservationKind; note: string | null };
  }[] = [];
    /*
    Record one source observation for THIS pass. On the editor-started lane it
    writes now; on the scheduled lane it queues for the run transaction (the
    lane that writes nothing during the loop -- see `writeQueuedSourceWrites`).

    BOTH PATHS SWALLOW THEIR OWN ERRORS. An observation is a record of a touch
    that already happened; if the 0128 table is not there yet, or the insert
    fails, the scan must still finish and the source row must still keep the
    touch it earned. A failure here is not allowed to become a failed scan, so
    the error is dropped on purpose rather than thrown -- the same rule the
    `anomalies` insert on the editor lane already follows.

    `scanRunId: runId` is what makes it idempotent: `recordObservation` refuses
    a second row for the same source, kind and run, so a retried pass cannot
    double-count one refusal.
  */
    const recordScanObservation = async (
    sourceId: number,
    kind: ObservationKind,
    note: string | null,
  ) => {
    if (deps.scheduledCommit) {
      pendingObservations.push({ sourceId, input: { kind, note } });
      return;
    }
    try {
      await recordObservation(
        {
          newsroomId: owned(context),
          sourceId,
          kind,
          note,
          scanRunId: runId,
          observedBy: "scan",
        },
        sql,
      );
    } catch {
      /* the touch stands whatever happens to the observation */
    }
  };
    /*
    THE ONE CONSUMER OF THE QUEUED SOURCE WRITES (B8F2).

    On the scheduled lane the fetch loop writes nothing to a source row as it
    goes: it queues the touch and the run commits it inside the run's
    transaction. That makes this loop the ONLY thing that ever puts an
    unattended scan's answers on the source rows, which means EVERY ending of
    the pass has to reach it.

    It used to live inside `commitResults` alone, and `commitResults` is not
    the ending a scan takes when EVERY source failed -- that ending writes the
    failed run row and throws. So a newsroom whose whole watch list failed on
    an unattended pass recorded the failed run and nothing else: no streak, no
    stored `retry_after`, no reason. The desk went on knocking at full speed
    and "Keeps failing" never arrived, on the lane nobody is watching. The
    editor-started lane never had this shape because it writes during the
    loop.

    `writeSourceTouch` and nothing else: a source row must not depend on which
    path touched it (HIGH-1, A-B8). One rule, three write sites.
  */
    writeQueuedSourceWrites = async (writeSql: Sql) => {
    for (const queued of pendingSourceTouches) {
      await writeSourceTouch(writeSql, {
        id: queued.id,
        newsroomId: owned(context),
        touch: queued.touch,
      });
    }
    /*
      A source that HAD a hash and then answered 404 is worth an anomaly, and on
      this lane it is queued beside its touch. Consuming the two in one place is
      what stops a later early exit from leaving one of them behind.
    */
    for (const gone of pendingDisappeared) {
      await writeSql`
        insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
        values (${context.userId}, ${owned(context)}, 'disappeared', ${`Watched source failed after previously succeeding: ${gone.title}`}, ${gone.url}, ${gone.error})
      `;
    }
    /*
      The dated observations this pass queued (see `recordScanObservation`):
      written in the same transaction as the touches above, so an unattended
      run cannot record a touch and lose the observation that explains it. One
      failing observation is dropped, not thrown -- a bad 0128 row must not
      fail the whole run's commit.
    */
    for (const obs of pendingObservations) {
      try {
        await recordObservation(
          {
            newsroomId: owned(context),
            sourceId: obs.sourceId,
            kind: obs.input.kind,
            note: obs.input.note,
            scanRunId: runId,
            observedBy: "scan",
          },
          writeSql,
        );
      } catch {
        /* the touch stands whatever happens to the observation */
      }
    }
    await saveScanSourceCoverage(writeSql, owned(context), runId, finishScanCoverage(sourceCoverage));
  };
    // P0-3: which sources failed and why, so the editor sees the set, not a count.
    const failedSources: { id: number; title: string; url: string; error: string }[] = [];
    let fetchedCount = 0;
    const scanDeadline = Date.now() + DAILY_SCAN_TIME_BUDGET_MS;
    const [priorityPolicy] = await sql<{
      selected_source_ids: number[];
      every_day_source_count: number;
    }>`
    select selected_source_ids,every_day_source_count from daily_scan_policies
    where newsroom_id=${owned(context)}
  `;
    const fixedIds = (priorityPolicy?.selected_source_ids ?? []).slice(0, priorityPolicy?.every_day_source_count ?? 8);
    const watchSlice = dailySources || deps.scheduledSnapshot ? sources : orderAcceptedSources(sources, fixedIds);
    failureReceipt.sourcesAttempted = 0;
    sourceCoverage = parseScanSourceCoverage(deps.scheduledSnapshot?.coverage ?? (dailySources ? scanRun?.source_coverage : undefined));
    if (!sourceCoverage.length && sources.length)
    sourceCoverage = manualScanCoverage(sources, sources.length);

    const prevRuns = await sql<Pick<ScanRow, "leads_created" | "sources_fetched">>`
      select leads_created, sources_fetched
      from scan_runs
      where newsroom_id = ${owned(context)} and id <> ${runId}
      order by started_at desc
      limit 1
    `;
    const reread = previousScanNeedsReread(prevRuns[0] ?? null);
    // last_hash is newsroom-wide, not evidence that this editorial scope has
    // evaluated the source. Once section scans share it (including overlapping
    // jobs), General cannot safely recover that provenance from one prior run.
    const [scopeHistory] = await sql<{ has_section_scans: boolean }>`
    select exists(select 1 from scan_runs where newsroom_id = ${owned(context)}
      and section_snapshot is not null) as has_section_scans
  `;
    const expandForScope = sectionSnapshot !== null || scopeHistory.has_section_scans;

    /*
    FB1, unit 1: the fetch pass is the scan's longest silence.

    Up to two hundred pages, and until this the whole pass
    reported nothing at all -- not a stage, not a count, not a heartbeat. The
    card could only say "Working…" for as long as it took, which on a real watch
    list is minutes, and the run row in the database kept reading zero fetched
    until the very end (see `noteSourceProgress`).

    Two writes, deliberately: `reportStage` is the throttled job progress (the
    card's bar and "Now:" line), and the run-row write below is what the Scan
    and Sources screens poll -- they read `scan_runs`, not `desk_jobs`.
  */
    let attemptedCount = 0;
    /** SH-B: rows this pass selected but deliberately did not knock on -- parked
     *  by a site's "come back later", or held back by the per-host allowance. */
    let skippedThisPass = 0;
    let lastLiveWriteAt = 0;
    /*
    THE LIVE RUN ROW.

    The owner's complaint was that a working scan read "0 fetched · No sources
    were fetched" -- `scanCountsLine`/`scanZeroWhy` off a row only written when
    the run finishes. FB1b adds the scope to it: `sources_selected` is known
    before the first fetch, and a row that says "2 fetched" without saying out
    of how many is a count with no denominator. Everything here is a counter
    this process already holds; nothing is recomputed and nothing is invented.

    Throttled on the same clock as the card's counted write, and guarded on
    `finished_at is null` so a receipt that has already settled is never
    reopened. `force` is for the boundary writes -- the start of the pass and
    the start of a batch -- where the whole point is that the row changes THEN,
    not up to a second later.

    AND ON THE CLAIM, like every other write to this row. A scan's worker is
    fenced by `desk_jobs.claim_token` -- `lockManualScanClaim` is what the
    receipt and the failure paths go through -- because a job whose lease was
    reclaimed by a newer worker must not settle the run that worker now owns.
    These counters are a write to that same row, and without the fence a
    superseded worker keeps moving them under the replacement: the Scan page
    counts down as often as up, on a run two processes are fetching for.

    The fence is on the WRITE, not on the value, so a count this worker wrote
    while it still held the claim stays on the row -- it was true when it was
    written. What it must not do is write again after losing the claim.

    A run with no claim token -- the older rows, and anything a test seeds --
    is unfenced here, exactly as before.
  */
    const writeLiveRunRow = async (force = false) => {
    const at = Date.now();
    if (!force && at - lastLiveWriteAt < PROGRESS_WRITE_MIN_MS) return;
    lastLiveWriteAt = at;
    await sql`
      update scan_runs
      set sources_selected = ${sources.length},
          sources_attempted = ${failureReceipt.sourcesAttempted},
          sources_fetched = ${fetchedCount},
          sources_failed = ${failedSources.length},
          sources_analyzed = ${failureReceipt.sourcesAnalyzed},
          model_batches_used = ${failureReceipt.modelBatchesUsed}
      where id = ${runId} and newsroom_id = ${owned(context)} and finished_at is null
        and (
          ${job.claim_token ?? null}::text is null
          or exists (
            select 1 from desk_jobs
            where id = ${job.id} and newsroom_id = ${job.newsroom_id} and kind = 'scan'
              and status = 'running' and claim_token = ${job.claim_token}
          )
        )
    `.catch(() => undefined);
  };
    const noteSourceProgress = async () => {
    attemptedCount += 1;
    failureReceipt.sourcesCompleted = attemptedCount;
    /*
      The fetch is the scan's second arrival, so its count fills 5-55 of the
      bar and not 0-100: the model batches and the filing come after it, and a
      bar that filled the moment the last page was read would be lying about
      the part of the scan that spends the money.
    */
    await reportStage(
      countedStep("Reading sources", attemptedCount, watchSlice.length),
      spanPct(attemptedCount, watchSlice.length, 5, 55),
    );
    await writeLiveRunRow();
  };
    // The scope, before a single page is read: "Running · reading sources — 0 of
    // 14" is a different sentence from "0 fetched" with no denominator.
    await writeLiveRunRow(true);
    await reportStage("Reading the sources");
    let fetchLoopError: unknown;
    // One source at a time makes Cancel a boundary the editor can rely on:
    // finish the current fetch, keep its observation, and never start the next.
    // A batch of six could otherwise begin five more reads after the press.
    readingSources: for (const batch of sourceBatches(watchSlice, Date.now, scanDeadline)) for (const src of batch) {
    if (Date.now() >= scanDeadline) break readingSources;
    try {
    await throwIfJobCancelled(job.id);
    await deps.scheduledGuard?.();
    /*
      SH-B items 2 and 3, the half that makes them real: a row the site asked
      us to leave alone is LEFT ALONE. This is the difference between storing
      `retry_after` and honouring it, and it is why the select above now reads
      the column. Nothing else changes: the source stays accepted, stays on
      watch, and the next pass after the time arrives fetches it with no
      special handling at all.
    */
    const nowMs = Date.now();
    if (skipThisPass({ retryAfter: src.retry_after, nowMs })) {
      /*
        Counted as selected-but-not-attempted, which is what it is and what the
        coverage receipt already means by the difference between those two
        numbers (a row cut by `SCAN_WATCH_CAP` reads the same way). Reporting a
        source the desk deliberately did not knock on as "attempted" would put
        a fetch in the record that never happened.

        But the PROGRESS count moves (LOW-3, A-B8): the bar counts the sources
        the pass got through, and a parked row is one of them. Without this the
        card stopped at "199 of 201" whenever anything was parked and then
        jumped at the end -- a count that stops short reads as a scan that is
        still going.
      */
      /*
        Observation: the desk is honouring a "come back later" this site asked
        for earlier, so it did NOT knock this pass. "asked-to-wait" is the
        honest record -- NOT "quiet" (no read happened) and NOT a failure
        (nothing went wrong). The note carries the moment it was asked to
        return, so a reporter reading the source later sees why it was still.
      */
      await recordScanObservation(
        src.id,
        "asked-to-wait",
        "The desk is waiting out a request to come back later, made by this source.",
      );
      sourceCoverage = updateScanCoverageEntry(sourceCoverage, src.id, {
        status: "skipped",
        reasonCode: "waiting",
        reason: src.retry_after_note ?? null,
      });
      skippedThisPass += 1;
      await noteSourceProgress();
      continue;
    }
    /*
      The per-host allowance for the day. A newsroom can watch six pages of one
      city site and a source-level counter would give each of them a full
      allowance -- six times the traffic to one host, which is the thing being
      prevented. So the count is per host, and a host that has refused us
      `BLOCKED_TRIES_PER_HOST_PER_DAY` times today is left until tomorrow.
    */
    {
      const host = sourceHost(src.url);
      if (host && (await hostAtDailyCap(sql, owned(context), host))) {
        const until = startOfTomorrow(nowMs);
        const note = dailyCapSentence();
        /* One `skipped` touch on both paths: the wait and its sentence, and no
           `last_error` -- the desk never asked this source for anything, so it
           has nothing to report about it (LOW-2), and the "Tried 4 times today"
           sentence is about the host anyway. */
        const touch = touchAfterSkip({ retryAfter: until, note });
        if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, touch });
        else
          await writeSourceTouch(sql, { id: src.id, newsroomId: owned(context), touch });
        /*
          Observation: a HOST cap parked this source before the desk knocked --
          the site never refused THIS page, the day's allowance for its host
          ran out. "asked-to-wait" is the honest word for that; it is
          deliberately not "retrieval-error" (nothing failed) and not "quiet"
          (nothing was read). See source-observations.server.ts.
        */
        await recordScanObservation(src.id, "asked-to-wait", note);
        sourceCoverage = updateScanCoverageEntry(sourceCoverage, src.id, {
          status: "skipped",
          reasonCode: "host-cap",
          reason: note,
        });
        skippedThisPass += 1;
        await noteSourceProgress();
        continue;
      }
    }
    try {
      failureReceipt.sourcesAttempted += 1;
      const bundle = await withRetry(async () => {
        await throwIfJobCancelled(job.id);
        await deps.scheduledGuard?.();
        return fetchUrl(src.url);
      });
      const sourceText = postgresText(bundle.text);
      if (bundle.newsletterSignupUrl) pendingNewsletterSignups.push({ id: src.id, url: bundle.newsletterSignupUrl });
      const extras: { url: string; text: string }[] = [];
      for (const extra of bundle.extras.slice(0, 4)) {
        await throwIfJobCancelled(job.id);
        await deps.scheduledGuard?.();
        try {
          const doc = await withRetry(async () => {
            await throwIfJobCancelled(job.id);
            await deps.scheduledGuard?.();
            return fetchUrl(extra);
          });
          extras.push({ url: extra, text: postgresText(doc.text) });
        } catch (err) {
          if (err instanceof JobCancelledError) throw err;
          if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(String(err)))
            throw err;
          /* skip a bad packet */
        }
      }
      const extraBits = extras.map((e) => `DOCUMENT ${e.url}\n${e.text.slice(0, 2500)}`);
      const text = extraBits.length ? `${sourceText}\n\n${extraBits.join("\n\n")}` : sourceText;
      const hash = await sha256(text);
      const changed = hash !== src.last_hash;
      /*
        SH0-1: the streak is written in the SAME statement that clears
        `last_error`, on both commit paths, because a success is the only thing
        that can end a streak and a second statement could be skipped without
        anything noticing. `last_ok_at` is new information -- see 0115 -- and
        this is its one writer (HIGH-1: literally one, `writeSourceTouch`, on
        all three paths).
      */
      const readTouch = { ...touchAfterSuccess(), readMethod: bundle.method, readOutcome: bundle.outcome, readRouteUrl: bundle.routeUrl, newsletterUrl: bundle.newsletterUrl };
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, touch: readTouch });
      else
        await writeSourceTouch(sql, { id: src.id, newsroomId: owned(context), touch: readTouch });
      /*
        Observation: the page was read cleanly. WHICH word -- "changed" or
        "quiet" -- is decided by the hash comparison just above, never by the
        touch alone: a clean read that found the same bytes is "quiet", not
        "changed". This is the fact the editor could never see before -- "we
        knocked and nothing moved" now reads differently from "we never
        knocked". See `observationForTouch` for why the two words are pinned
        apart there rather than here.
      */
      {
        const verdict = observationForTouch({
          outcome: "read",
          changedByHash: changed,
        });
        await recordScanObservation(src.id, verdict.kind, [verdict.note, bundle.method === "playwright" ? "Read through a browser." : bundle.method === "feed" ? "Read through its feed." : null].filter(Boolean).join(" "));
      }
      pendingHashes.push({ id: src.id, hash, text, changed });
      fetchedCount += 1;
      failureReceipt.sourcesFetched = fetchedCount;
      fetched.push({
        id: src.id,
        title: src.tier === "C" ? `[discovery] ${src.title}` : src.title,
        url: src.url,
        text: sourceText.slice(0, 4500),
        extras,
        changed,
      });
      sourceCoverage = updateScanCoverageEntry(sourceCoverage, src.id, {
        status: "read",
        readAt: new Date().toISOString(),
        reason: bundle.method === "playwright" ? "Read through a browser." : bundle.method === "feed" ? "Read through its feed." : null,
      });
      await noteSourceProgress();
    } catch (err) {
      if (err instanceof JobCancelledError) throw err;
      const msg = postgresText(err instanceof Error ? err.message : "fetch failed");
      if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(msg)) throw err;
      /*
        SH-B items 2 and 3: was this refusal aimed at us?

        `ingestUrl` now carries the status and the site's `Retry-After` out of
        the fetch, so a 429/503 becomes a recorded wait and a 401/403 becomes a
        recorded block with a growing backoff -- instead of both being written
        onto the row as "Could not check", which sent the editor to fix a
        source that was working. An ordinary failure (404, timeout, empty page)
        is none of this feature's business and falls through to the message it
        always had.
      */
      const failure = classifyRefusal({
        status: err instanceof BlockedAfterRenderError ? 403 : err instanceof IngestFetchError ? err.status : null,
        retryAfterMs: err instanceof IngestFetchError ? err.retryAfterMs : null,
        nowMs,
      });
      const touch: SourceTouch = failure
        ? touchAfterFailure({
            refusal: failure,
            previousBlockedAt: src.blocked_at,
            previousBlockedAttempts: src.blocked_attempts,
            nowMs,
          })
        : touchAfterError(msg);
      if (err instanceof IngestFetchError) touch.newsletterUrl = err.newsletterUrl;
    if (err instanceof BlockedAfterRenderError) {
        touch.last_error = msg;
        touch.retry_after_note = msg;
        touch.readMethod = "playwright";
        touch.readOutcome = err.outcome;
        touch.newsletterUrl = err.newsletterUrl;
      }
      if (touch.countsAgainstHostCap) await noteHostRefusal(sql, owned(context), sourceHost(src.url));
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, touch });
      else await writeSourceTouch(sql, { id: src.id, newsroomId: owned(context), touch });
      /*
        Observation: the read did not return a page. WHICH kind is read off the
        touch's own outcome, which the politeness layer already decided -- a
        429/503 is "asked-to-wait", a 401/403 is "blocked", an ordinary failure
        is split into "retrieval-error" and "extraction-failure" by the message
        (a page that came back but had nothing to read is a different fact from
        one that never came back). The sentence is the touch's own `last_error`,
        passed through `observationForTouch` so the vocabulary stays in one
        place. See source-observations.server.ts.
      */
      {
        const verdict = observationForTouch({
          outcome: touch.outcome,
          last_error: touch.last_error ?? msg,
        });
        await recordScanObservation(src.id, verdict.kind, verdict.note);
      }
      failedSources.push({ id: src.id, title: src.title, url: src.url, error: msg });
      sourceCoverage = updateScanCoverageEntry(sourceCoverage, src.id, {
        status: "blocked",
        reasonCode: err instanceof BlockedAfterRenderError ? "blocked-after-render" : "fetch-failed",
        reason: editorFetchError(msg, src.url) ?? "The source could not be read.",
      });
      failureReceipt.sourcesFailed = failedSources.length;
      failureReceipt.failedSources = postgresText(JSON.stringify(failedSources)).slice(0, 32000);
      if (src.last_hash && /404|410|not found|had almost no/i.test(msg)) {
        if (deps.scheduledCommit)
          pendingDisappeared.push({ title: src.title, url: src.url, error: msg });
        else
          await sql
            .query(
              `insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
             values ($1, $2, $3, $4, $5, $6)`,
              [
                context.userId,
                owned(context),
                "disappeared",
                `Watched source failed after previously succeeding: ${src.title}`,
                src.url,
                msg,
              ],
            )
            .catch(() => undefined);
      }
      // A source that failed was still a source read: the count moves for it
      // too, or a watch list of dead links would look like no progress at all
      // right up to the failure.
      await noteSourceProgress();
    }
    } catch (error) {
      fetchLoopError = error;
      break readingSources;
    }
  }
  const newsletterInputs = new Map<string, number>();
  const analyzedNewsletterIds = new Set<number>();
  // Retained mail supplements the website, even when a web fetch was blocked.
  for (const src of watchSlice) {
    for (const doc of await newsletterScanDocs(owned(context), src.id, 6, sql)) {
      fetched.push({ id: src.id, title: doc.title, url: doc.url,
        text: postgresText(doc.text).slice(0, 4500), extras: doc.extras, changed: true });
      newsletterInputs.set(doc.url, doc.id);
    }
  }
  if (Date.now() >= scanDeadline) sourceCoverage = sourceCoverage.map(entry => entry.status === "pending"
    ? { ...entry, status: "skipped" as const, reasonCode: "time-budget" as const,
        reason: "The 90-minute scan reading budget ended before this source was reached." } : entry,
      );
    sourceCoverage = finishScanCoverage(sourceCoverage);
    if (fetchLoopError) throw fetchLoopError;
    // The final count is a boundary, not a throttled tick. A fast last source
    // (including a parked one) must not leave the card one source behind.
    await progressReporterFor(job, { minWriteMs: 0 })(
    countedStep("Reading sources", attemptedCount, watchSlice.length),
    spanPct(attemptedCount, watchSlice.length, 5, 55),
  );
    await writeLiveRunRow(true);
    /*
    SH-B: a row the pass deliberately did not knock on is not an attempt.
    `sources_selected` still counts it -- it was in scope -- so the receipt
    reads "14 selected, 12 attempted" exactly the way it already reads when
    `SCAN_WATCH_CAP` cuts the tail, and a source parked by a site that asked us
    to come back is not recorded as a fetch that never happened.
  */
    // Actual fetch attempts are counted at dispatch, including failures.
    // Watches left at the deadline were never attempted.

    const memory = await sql<MemoryRow>`
      select id, entity, last_angle, updated_at from beat_memory
      where newsroom_id = ${owned(context)} order by updated_at desc limit 24
    `;
    const published = await sql<{
    headline: string;
    dek: string | null;
    source_urls: string;
    published_at: string | null;
  }>`
    select headline, dek, source_urls, published_at::text as published_at
       from articles
      where newsroom_id = ${owned(context)} and status = 'published'
        and published_at >= now() - interval '60 days'
      order by published_at desc nulls last, id desc
      limit 100`;
    const publishedContext = published.map((row) => {
    let sourceUrls: string[] = [];
    try {
      const parsed = JSON.parse(row.source_urls || "[]");
      if (Array.isArray(parsed))
        sourceUrls = parsed
          .map(String)
          .filter((url) => /^https?:\/\//i.test(url))
          .slice(0, 4);
    } catch {
      /* malformed legacy source metadata is not scan context */
    }
    return {
      headline: row.headline,
      dek: row.dek ?? "",
      source_urls: sourceUrls,
      published_at: row.published_at ?? "",
    };
  });

    /*
    P0-5: bounded batches, not one truncated pass. The old code built a single
    payload against a 48,000-character budget and `break`-ed the moment the
    next source overflowed, so a 100-source scan silently reached the model
    with a fraction of its sources. Each batch now gets its own model call; a
    failed batch does not discard the others. See `scan-batches.ts`.
  */
    const ranked = [...fetched].sort((a, b) => Number(b.changed) - Number(a.changed));
    const batchSources = ranked.map((f) => {
    const excerpt = scanSourceExcerpt(
      f.text,
      f.extras,
      expandForScope || reread || f.changed ? 2800 : 800,
    );
    const changedLine = expandForScope
      ? f.changed
        ? "yes; expanded excerpt for this scan scope"
        : "no; re-read for this scan scope (source hashes are shared across section scans)"
      : reread
        ? "re-read (previous scan fetched this but filed no leads)"
        : f.changed
          ? "yes"
          : "no (still include if newly newsworthy)";
    return {
      id: f.id,
      title: f.title,
      url: f.url,
      block: `SOURCE: ${f.title}\nURL: ${f.url}\nCHANGED: ${changedLine}\nTEXT:\n${excerpt}`,
    };
  });
    const batches = buildScanBatches({ sources: batchSources });

    const scanOverrides: import("./provider-registry.ts").ProviderOverrides =
    applyJobLocalModelSnapshot(
      job,
      await readProviderOverrides(job.newsroom_id, "scan").catch(() => ({})),
    );
    const scanLocalModel = scanOverrides["local-model"]?.localModel;
    const batchTimeoutMs = scanCallTimeoutFor(scanOverrides);
    const batchResults: import("./schema.ts").ParsedScanResult[] = [];
    let batchesFailed = 0;
    let lastBatchError: string | null = null;
    /*
    The second countable pass. `buildScanBatches` has already split the fetched
    text into bounded batches, so the model phase knows exactly how many calls
    it is going to make -- which is the one place in a scan where a percentage
    is a real fraction of the work rather than a guess.
  */
    await reportStage("Reading the sources with a model", 55);
    for (const [batchIndex, batch] of batches.entries()) {
      await deps.scheduledGuard?.();
      await reportStage(
      countedStep("Reading the sources with a model", batchIndex + 1, batches.length),
      spanPct(batchIndex + 1, batches.length, 55, 92),
    );
      /*
      Between batch boundaries is where a scan can be stopped: the batches
      already read are committed, and stopping here leaves the job's real
      reason ("Cancelled by the editor") on the row rather than a half-read
      batch's parse error. `executeJob` maps the throw.
    */
      await throwIfJobCancelled(job.id);
      const userMsg = buildScanUserMessage({
      topics: topicChoices,
      section: sectionSnapshot,
      city: paperConfig.city,
      state: paperConfig.state,
      reread,
      memory,
      published: publishedContext,
      payload: batch.payload,
    });
      /*
      The same one-shot technical failover Draft uses (see `failOverAndRetry`),
      except the fetched source text is never re-fetched -- this batch's
      payload is reused verbatim for the retry by `runScanChatWithFailover`.

      `liveLabel` tracks the rung the batch is actually on: the failover above
      can hop mid-call, and the ticker below would otherwise keep naming a model
      that has already failed for the rest of the batch's wait.
    */
      let liveLabel = modelChoiceLabel(effectiveStoryModelChoice(job.model_choice));
      const ai = await waitForModel({
        jobId: job.id,
        label: () => liveLabel,
        run: () => {
          failureReceipt.modelBatchesUsed += 1;
          return runScanChatWithFailover({
            job,
            newsroomId: job.newsroom_id,
            localModel: scanOverrides["local-model"]?.localModel,
            system: scanSystem({
            name: paperConfig.name,
            city: paperConfig.city,
            state: paperConfig.state,
          }),
            user: userMsg,
            /*
            A reply this batch cannot read is not a success (Unit Y item 3): the
            helper retries it once on the same rung and then fails over, so the
            batch's parse below is the second half of the contract rather than the
            only reader. Same parser as the line after the call, so the two cannot
            disagree about what "readable" means.
          */
            read: (text) =>
            !parseScanResult(parseJsonBlock<unknown>(text), allowedTopics, topicChoices).parseError,
            maxTokens: 3500,
            modelEffort: effortFromJob(job),
            timeoutMs: batchTimeoutMs,
            grokChat: runChat,
            probe: (choice) =>
              probe(
                choice,
                job.newsroom_id,
                undefined,
                "scan",
                choice === "local-model" ? (scanLocalModel ?? undefined) : undefined,
              ),
            setModelChoice,
            setStage,
            setFailoverNote: setJobFailoverNote,
            onSwitch: async (receipt) => {
            liveLabel = receipt.nextLabel;
            await deps.onModelSwitch?.(receipt);
          },
          });
        },
      });
      if (!ai.ok) {
      batchesFailed += 1;
      failureReceipt.modelBatchesFailed = batchesFailed;
      lastBatchError = ai.error;
      continue;
    }
      const parsed = parseScanResult(parseJsonBlock<unknown>(ai.text), allowedTopics, topicChoices);
      if (parsed.parseError) {
      batchesFailed += 1;
      failureReceipt.modelBatchesFailed = batchesFailed;
      lastBatchError = parsed.parseError;
      continue;
    }
    batchResults.push(parsed);
    for (const source of batch.sources) {
      const messageId = newsletterInputs.get(source.url);
      if (messageId) analyzedNewsletterIds.add(messageId);
    }
    failureReceipt.sourcesAnalyzed += batch.sources.length;
    // The row moves phase: from "reading sources — k of n" to "reading the
    // pages with a model", which is what the editor watching the history sees.
    await writeLiveRunRow(true);
  }

    const recordFailedRun = async (writeSql: Sql, failure: string, sourcesAnalyzed = 0) => {
    await writeSql`
      update scan_runs
      set finished_at = now(),
          sources_fetched = ${fetchedCount},
          leads_created = 0,
          sources_proposed = 0,
          sources_selected = ${sources.length},
          sources_attempted = ${failureReceipt.sourcesAttempted},
          sources_failed = ${failedSources.length},
          sources_analyzed = ${sourcesAnalyzed},
          model_batches_used = ${batches.length},
          model_batches_failed = ${batchesFailed},
          failed_sources = ${postgresText(JSON.stringify(failedSources)).slice(0, 32000)},
          meetings_found = ${meetingAwareness?.found.length ?? 0},
          meetings_captured = ${meetingAwareness?.captured.filter((r) => r.status === "captured").length ?? 0},
          meetings_failed = ${meetingAwareness?.failed.length ?? 0},
          meeting_failures = ${postgresText(JSON.stringify(meetingAwareness?.failures ?? [])).slice(0, 32000)},
          summary = null,
          error = ${postgresText(failure).slice(0, 800)}
      where id = ${runId} and newsroom_id = ${owned(context)} and finished_at is null
    `;
  };

    /*
    The receipt for a pass in which nothing was due, written the way
    `recordFailedRun` is written and for the same reason: this ending never
    reaches `commitResults` either, so without it the run would keep the row it
    was given at claim and stay open forever.

    Same columns, one difference that is the whole point: `error` is left NULL
    and `summary` carries the sentence. A run is failed when its `error` says
    so -- writing the no-op as a failure is the defect this replaces -- and the
    counts are zero because nothing was fetched, nothing failed and nothing was
    attempted. `sources_selected` still names the scope, so the row reads
    "1 selected, 0 attempted", which is what a deferred pass is.
  */
    const recordNoOpRun = async (writeSql: Sql, sentence: string) => {
    await writeSql`
      update scan_runs
      set finished_at = now(),
          sources_fetched = 0,
          leads_created = 0,
          sources_proposed = 0,
          sources_selected = ${sources.length},
          sources_attempted = 0,
          sources_failed = 0,
          sources_analyzed = 0,
          model_batches_used = 0,
          model_batches_failed = 0,
          failed_sources = ${postgresText(JSON.stringify([]))},
          meetings_found = ${meetingAwareness?.found.length ?? 0},
          meetings_captured = ${meetingAwareness?.captured.filter((r) => r.status === "captured").length ?? 0},
          meetings_failed = ${meetingAwareness?.failed.length ?? 0},
          meeting_failures = ${postgresText(JSON.stringify(meetingAwareness?.failures ?? []))},
          summary = ${storableText(sentence).slice(0, 1200)},
          error = null
      where id = ${runId} and newsroom_id = ${owned(context)} and finished_at is null
    `;
  };

    const recordManualFailure = async (failure: string, sourcesAnalyzed = 0) =>
    withTransaction(async (writeSql) => {
      if (!(await lockManualScanClaim(writeSql, job))) return false;
      await recordFailedRun(writeSql, failure, sourcesAnalyzed);
      await refreshManualScanClaim(writeSql, job);
      return true;
    });

    /*
    WAS ANYTHING ATTEMPTED AT ALL?

    A pass in which every selected source was deliberately left alone -- every
    row has a future `retry_after`, or every host has spent the day's allowance
    -- knocks on nothing. Each worker returns through the skip branch, so
    `batchResults` stays empty, and the zero-batch exit below read that as
    "Scan fetched no source text": a FAILED run, thrown, for a scan that did
    exactly what it was told.

    The desk's own patience is not a failure. So this is the one ending that
    has to be told apart from the genuine "fetched nothing" case, and the thing
    that separates them is whether the pass ATTEMPTED anything: a source that
    was fetched either yielded text or was recorded as failed, so nothing
    fetched and nothing failed means nothing was tried.

    `watchSlice.length` rather than "not zero": a pass with no sources in scope
    at all is its own shape and keeps the ending it always had.
  */
    const everySourceWasSkipped =
    watchSlice.length > 0 &&
    skippedThisPass === watchSlice.length &&
    fetchedCount === 0 &&
    failedSources.length === 0;

    if (!batchResults.length && everySourceWasSkipped) {
    /*
      THE RECORDED NO-OP.

      Finished, not failed: `error` stays null and the receipt says in plain
      words why nothing happened, which is the question the desk's history is
      asked. The counts are all zero because that is what happened -- nothing
      was fetched, nothing failed, nothing was attempted, no model ran -- and
      `sources_selected` still names the scope, so the row reads as "1 selected,
      0 attempted" the way it already does when `SCAN_WATCH_CAP` cuts the tail.

      The queued source writes go in beside it on the scheduled lane, exactly
      as the all-failed ending does: the skip touches carry the wait and its
      sentence, and a pass that honoured a wait without writing the reason for
      it would leave the row saying whatever the last real attempt said.
    */
    const noOp = noOpScanReceipt(skippedThisPass);
    await reportStage(noOp);
    if (deps.scheduledCommit) {
      await deps.scheduledCommit(async (writeSql) => {
        await recordNoOpRun(writeSql, noOp);
        await writeQueuedSourceWrites(writeSql);
      });
    } else {
      await withTransaction(async (writeSql) => {
        if (!(await lockManualScanClaim(writeSql, job))) return;
        await recordNoOpRun(writeSql, noOp);
        await writeQueuedSourceWrites(writeSql);
        await refreshManualScanClaim(writeSql, job);
      });
      await audit(context.userId, "scan", scanAuditDetail(runId, 0, 0, 0), owned(context));
    }
    return;
  }

    if (!batchResults.length) {
    const error = lastBatchError ?? (batches.length === 0
      ? `Scan fetched no source text, so no writing pass ran.${failedSources[0] ? ` First source failed: ${failedSources[0].error}` : ""}`
      : "Writing pass returned no usable JSON.");
    // The outer failure settlement saves both the run and queued touches.
    // It must not complete a daily reservation before quota handling runs.
    if (!deps.scheduledCommit) {
      await recordManualFailure(error);
    }
    throw new Error(error);
  }

  const merged = mergeScanBatchResults(batchResults);
  const data: import("./schema.ts").ParsedScanResult = {
    editor_summary: merged.editor_summary
      ? batchesFailed > 0
        ? `${merged.editor_summary} ${batchesFailed} of ${batches.length} analysis batches failed; the rest were kept.`.slice(0, 2000)
        : merged.editor_summary
      : batchesFailed > 0
        ? `${batchesFailed} of ${batches.length} analysis batches failed; the rest were kept.`
        : "",
    leads: merged.leads,
    proposed_sources: merged.proposed_sources,
    parseError: null,
  };
    const analyzedSourceCount = failureReceipt.sourcesAnalyzed;

    /*
    The leads this scan may match against.

    `fileScanLeads` has always read this itself, inside the commit transaction.
    U28 hoists it out for the same reason `getPaperPlace` above is read out
    here: the duplicate check has to identify its borderline pairs BEFORE the
    commit, and a model call inside `commitResults` would hold that transaction
    open for as long as the model takes. On the dev desk's single PGlite
    connection that is not a slow query, it is the whole desk.
  */
    const existingLeadsRaw = await sql<{
    id: number;
    status: string;
    headline: string;
    topic: string | null;
    source_urls: string;
    created_at: string;
    why: string | null;
    evidence: string | null;
  }>`
    select id, status, headline, source_urls, created_at, why, evidence, topic
    from leads
    where newsroom_id = ${owned(context)}
      and status <> 'published'
      and created_at >= now() - (${MATCH_LOOKBACK_DAYS} || ' days')::interval
  `;
    const existingLeads: MatchCandidateLead[] = existingLeadsRaw.map((l) => ({
    id: l.id,
    status: l.status,
    headline: l.headline,
    topic: l.topic,
    source_urls: parseLeadSourceUrls(l.source_urls),
    created_at: l.created_at,
    // Unit AK item 2: the killed lead's own words, so a strong match that
    // brings new facts can be filed against it instead of discarded.
    why: l.why,
    evidence: l.evidence,
  }));

    /*
    U28 (2026-09-30): the owner's "double check. worth it."

    For the pairs the word rules can only rate BORDERLINE -- the matcher's
    "possible" tier, and a "Looks already printed" chip candidate -- the desk
    asks its own model one short question, once for the whole scan, batched:
    are these the same news story? See ./dup-check.ts for what that decides
    (a chip, and only a chip) and what it deliberately does not.

    The duplicate check uses the scan's current pinned provider, reasoning
    effort and local model snapshot. A separate lead-scoring assignment cannot
    override the editor's pick. Technical scan failovers are already recorded
    on the job, so the check follows that same effective runtime.

    A failure here is never fatal and never moves a chip on its own: the
    outcome is empty, `fileScanLeads` falls back to the word rule, and the only
    trace is a log line -- the operator asked for no noise about it.
  */
    let dupCheck: DupCheckOutcome | null = null;
    try {
    await throwIfJobCancelled(job.id);
    /* A scan that found nothing has no pairs and no reason to read the
     * published list -- the check costs one query and one model call per scan
     * THAT NEEDS ONE, and not one query per scheduled scan. */
    const printed = data.leads.length > 0 ? await queryDupCheckPrinted(context) : [];
    const collected = collectDupPairs({
      candidates: data.leads,
      existing: existingLeads,
      printed,
      place: scanPlace,
    });
    if (collected.pairs.length > 0) {
      /*
        `scheduledCommit` is this function's own test for "am I the scheduled
        lane" (it is what the commit below branches on), and the scheduled
        lane's job row carries the exact choice its forced runtime is pinned
        to (daily-scan.server.ts queues it with `model.modelChoice`), so
        passing it back to that same runtime is a no-op rather than a
        re-resolution.
      */
      const dupTimeoutMs = Math.min(batchTimeoutMs(effectiveStoryModelChoice(job.model_choice)), DUP_CHECK_TIMEOUT_MS);
      dupCheck = await runDupCheck({
        pairs: collected.pairs,
        skipped: collected.skipped,
        chat: scanDuplicateChat({
          modelChoice: job.model_choice,
          reasoningEffort: effortFromJob(job),
          newsroomId: job.newsroom_id,
          localModel: scanLocalModel,
          timeoutMs: dupTimeoutMs,
        }, runChat),
      });
    }
  } catch (error) {
    if (error instanceof JobCancelledError) throw error;
    // A check that could not run must not be able to change an answer: the
    // word rule stands, exactly as it did before this unit (see dup-check.ts).
    console.error("[scan] duplicate check could not run", error);
  }
    if (dupCheck?.failure) console.error(`[scan] run ${runId}: ${dupCheck.failure}`);

    const commitResults = async (writeSql: Sql) => {
    if (!deps.scheduledCommit && !(await lockManualScanClaim(writeSql, job)))
      throw new Error("Scan job claim was superseded; refusing stale result writes.");
    const openRun = await writeSql<{ id: number }>`
      select id from scan_runs
      where id = ${runId} and newsroom_id = ${owned(context)} and finished_at is null
      for update
    `;
    if (!openRun[0]) throw new Error("Scan run is already finished; refusing to overwrite its receipt.");
    /*
      HIGH-1 (A-B8): the SCHEDULED scan's half of the streak.

      This statement used to decide "did we read this page?" from
      `touch.error is null`, and that was wrong: a "come back later" touch
      carries a null error on purpose (the site did not fail us), so a 429 on an
      unattended scan was committed as a successful read -- streak wiped,
      `last_ok_at` stamped -- while the inline scan and the editor's press
      counted the same event as a failure. The unattended scan is the main path
      in production, so the source that escalates to "Keeps failing" on a manual
      scan never escalated on the real one.

      Now both paths call `writeSourceTouch`, which branches on the outcome the
      touch carries. One rule, three write sites, and nothing left to drift.

      B8F2: the consumption itself is `writeQueuedSourceWrites` now, because
      this is no longer the only ending that has to run it -- the all-failed
      ending below does too, and it never gets here.
    */
    await writeQueuedSourceWrites(writeSql);
    for (const signup of pendingNewsletterSignups) {
      await writeSql`update sources set newsletter_signup_url=${signup.url}
        where id=${signup.id} and newsroom_id=${owned(context)} and newsletter_signup_url is null`;
    }
    for (const p of pendingHashes) {
      await writeSql`
        update sources
        set last_hash = ${p.hash}
        where id = ${p.id} and newsroom_id = ${owned(context)}
      `;
      if (p.changed) {
        await writeSql`
          insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt)
          values (${context.userId}, ${owned(context)}, ${p.id}, ${p.hash}, ${p.text.slice(0, 32000)})
        `;
      }
    }

    /*
      `existingLeads` was read above, outside this transaction, because the
      duplicate check needs it before the commit (see that read's own comment).
      Matching still happens in code (findMatchingLead), never in the model.
    */
    const {
      leadsCreated,
      resurfacedKilled,
      resurfacedOpen,
      possibleMatched,
      developingFiled,
      firstDiscardedHeadline,
      mergedSameScan,
      dupCheckCleared,
      standingPageDropped,
      noEventDropped,
      firstDroppedReason,
    } = await fileScanLeads(
      writeSql,
      context,
      owned(context),
      runId,
      data.leads,
      existingLeads,
      scanPlace,
      dupCheck,
    );

    await markNewsletterDocsScanned(writeSql, owned(context), [...analyzedNewsletterIds]);

    let proposed = 0;
    for (const p of data.proposed_sources) {
      if (!p.url) continue;
      let url: URL;
      try {
        url = assertHttpUrl(p.url);
      } catch {
        continue;
      }
      /*
        Every string here is model output headed for a `text` column --
        `sources.title`, `.proposed_reason`, `.proposed_section` -- so it gets
        `storableText` for the same reason a lead does: one NUL fails the
        statement, and that fails the scan's commit transaction.
      */
      if (
        await insertProposedNewsroomSource(writeSql, {
          userId: context.userId,
          newsroomId: owned(context),
          url: url.toString(),
          title: storableText(p.title) || url.hostname,
          // 0.6.70: the scan already wrote a sentence about each suggested
          // page and threw it away here. The editor reading 175 rows needs
          // that sentence and the run it came from, not just a bare URL.
          reason: storableText(p.why),
          proposedBy: "scan",
          scanRunId: runId,
          section: storableText(p.section) || null,
        })
      )
        proposed += 1;
    }

    /*
      `storableText`, not `postgresText`: this column holds the desk's own
      sentence about the run -- the model's summary plus the coverage clauses
      below -- not a captured page, so the policy for editorial text applies
      (see storable-text.ts). It took a NUL guard early because it is the one
      model-written field the original fix noticed; the lead fields beside it,
      which fail the same transaction, did not get one until SCAN-001.
    */
    /*
      Scan quality round 2 (2026-10-04): the model's paragraph and the desk's
      own sentences share one 1200-character column, and the paragraph -- not
      the counts -- is what gives way when they do not fit. Before this, each
      sentence was stitched on and the whole thing re-sliced to 1200, so a model
      paragraph that ran to the budget erased every count behind it: the
      2026-10-03 dev scan's summary ended mid-word at the limit and reported no
      dropped or stamped counts at all.

      So the counts go down FIRST, in one short plain sentence
      (`scanDecisionsSentence`), and the model's paragraph is trimmed to the
      room that is left. The counts are the receipt for a decision; the
      paragraph is the colour.
    */
    const SUMMARY_LIMIT = 1200;
    const decisionsSentence = scanDecisionsSentence({
      standingPageDropped,
      noEventDropped,
      repeatsStamped: resurfacedKilled + resurfacedOpen,
      firstDroppedReason,
    });
    const resurfacedSentence = resurfacedSummarySentence({
      // The stamped repeats (killed/open) are carried by `scanDecisionsSentence`
      // above, in the one short plain sentence the editor reads; this sentence
      // keeps the other decisions -- a maybe-same filing, a same-scan merge, a
      // killed story that came back with new facts -- and the example headline.
      resurfacedKilled: 0,
      resurfacedOpen: 0,
      possibleMatched,
      // Unit AK item 2: a developing finding is filed too, but it is not a
      // brand-new story for the desk -- it is an old one that came back -- so
      // it is named by its own bit rather than counted as "filed as new".
      filedNew: leadsCreated - possibleMatched - developingFiled,
      developingFiled,
      firstDiscardedHeadline,
      mergedSameScan,
    });
    let editorSummary = String(data.editor_summary ?? "").trim();
    if (leadsCreated === 0 && !editorSummary)
      editorSummary = composeZeroLeadSummary({
        fetched: fetchedCount,
        changed: pendingHashes.filter((p) => p.changed).length,
      });
    // The assembly -- counts and the coverage line first, the model's
    // paragraph trimmed to the room left -- lives in desk-copy.ts so the
    // folding is testable without a database (see composeScanRunSummary).
    let summary = composeScanRunSummary({
      editorSummary,
      decisionsSentence,
      resurfacedSentence,
      meetingCoverageLine: meetingAwareness?.coverageLine ?? "",
      summaryLimit: SUMMARY_LIMIT,
    });
    // Sanitize the ASSEMBLED sentence rather than only the model's clause at
    // the top: every part of it -- the coverage line, the resurfaced sentence
    // naming a discarded headline, the meeting clause -- is stitched onto the
    // value that gets written, and a guard on the first part alone would leave
    // the joins unguarded.
    summary = storableText(summary);
    await writeSql`
      update scan_runs
      set finished_at = now(),
          sources_fetched = ${fetchedCount},
          leads_created = ${leadsCreated},
          sources_proposed = ${proposed},
          sources_selected = ${sources.length},
          -- SH-B: the receipt says what the pass DID, so a row it deliberately
          -- did not knock on is not an attempt. The live row above keeps the
          -- full scope on purpose (see scanRunningLine's pin: the scope is not
          -- progress); this is the record of the finished pass.
          sources_attempted = ${failureReceipt.sourcesAttempted},
          sources_failed = ${failedSources.length},
          sources_analyzed = ${analyzedSourceCount},
          model_batches_used = ${batches.length},
          model_batches_failed = ${batchesFailed},
          failed_sources = ${postgresText(JSON.stringify(failedSources)).slice(0, 32000)},
          meetings_found = ${meetingAwareness?.found.length ?? 0},
          meetings_captured = ${meetingAwareness?.captured.filter((r) => r.status === "captured").length ?? 0},
          meetings_failed = ${meetingAwareness?.failed.length ?? 0},
          meeting_failures = ${postgresText(JSON.stringify(meetingAwareness?.failures ?? [])).slice(0, 32000)},
          summary = ${summary}
      where id = ${runId} and newsroom_id = ${owned(context)}
    `;
    if (deps.scheduledCommit) {
      await writeSql`
        insert into audit_events (user_id, action, detail, newsroom_id)
        values (${context.userId}, 'scan', ${scanAuditDetail(runId, fetchedCount, leadsCreated, dupCheckCleared)}, ${owned(context)})
      `;
    } else {
      await refreshManualScanClaim(writeSql, job);
    }
    return { leadsCreated, dupCheckCleared };
  };

    /*
    The last arrival, and the one that spends the most time in the database:
    matching every returned lead against the existing ones, writing the new
    leads, filing the proposed sources and recording the snapshots. It runs
    inside one transaction, so nothing inside it can report -- the chip is what
    the editor has for this stretch.
  */
    await reportStage("Filing the leads", 95);
    let committed: { leadsCreated: number; dupCheckCleared: number };
    try {
    await deps.beforeScheduledCommit?.();
    committed = deps.scheduledCommit
      ? await deps.scheduledCommit(commitResults)
      : await withTransaction(commitResults);
  } catch (error) {
    if (!deps.scheduledCommit) {
      const failure = postgresText(error instanceof Error ? error.message : String(error));
      try {
        // `withTransaction` has rolled back before control reaches here. Save a
        // terminal receipt separately so a failed manual result write does not
        // leave scan_runs looking active forever with zero coverage.
        await recordManualFailure(failure, analyzedSourceCount);
      } catch (settleError) {
        const settleMessage = postgresText(
          settleError instanceof Error ? settleError.message : String(settleError),
        );
        throw new Error(`Scan result could not be saved: ${failure}. The run receipt could not be finalized: ${settleMessage}`);
      }
    }
    throw error;
  }
    if (!deps.scheduledCommit)
    await audit(
      context.userId,
      "scan",
      scanAuditDetail(runId, fetchedCount, committed.leadsCreated, committed.dupCheckCleared),
      owned(context),
    );
  } catch (error) {
    const failure = postgresText(error instanceof Error ? error.message : String(error));
    const cancelledSummary = error instanceof JobCancelledError
      ? `Cancelled after ${failureReceipt.sourcesCompleted} of ${failureReceipt.sourcesSelected} sources`
      : null;
    {
      try {
        const settle = async (receiptSql: Sql) => {
          if (!deps.scheduledCommit && !(await lockManualScanClaim(receiptSql, job))) return;
          await receiptSql`
            update scan_runs
            set finished_at = now(),
                sources_fetched = ${failureReceipt.sourcesFetched},
                sources_selected = ${failureReceipt.sourcesSelected},
                sources_attempted = ${failureReceipt.sourcesAttempted},
                sources_failed = ${failureReceipt.sourcesFailed},
                sources_analyzed = ${failureReceipt.sourcesAnalyzed},
                model_batches_used = ${failureReceipt.modelBatchesUsed},
                model_batches_failed = ${failureReceipt.modelBatchesFailed},
                failed_sources = ${failureReceipt.failedSources},
                meetings_found = ${meetingAwareness?.found.length ?? 0},
                meetings_captured = ${meetingAwareness?.captured.filter((r) => r.status === "captured").length ?? 0},
                meetings_failed = ${meetingAwareness?.failed.length ?? 0},
                meeting_failures = ${postgresText(JSON.stringify(meetingAwareness?.failures ?? [])).slice(0, 32000)},
                summary = ${cancelledSummary},
                error = coalesce(error, ${failure.slice(0, 800)})
            where id = ${failureRunId} and newsroom_id = ${job.newsroom_id} and finished_at is null
          `;
          await writeQueuedSourceWrites(receiptSql);
          if (!deps.scheduledCommit) await refreshManualScanClaim(receiptSql, job);
        };
        if (deps.scheduledFailure) await deps.scheduledFailure(failure, settle);
        else if (deps.scheduledCommit) await deps.scheduledCommit(settle);
        else await withTransaction(settle);
      } catch (settleError) {
        const settleMessage = postgresText(
          settleError instanceof Error ? settleError.message : String(settleError),
        );
        throw new Error(`Scan failed: ${failure}. Its run receipt could not be finalized: ${settleMessage}`);
      }
    }
    throw error;
  }
});

// PerformDraftWorkDeps, failOverAndRetry, and its DraftInput/ReportedDraftResult
// types live in desk-model-run.ts now -- a relative-imports-only sibling module
// that a plain `node --test` process can load (desk.ts itself imports
// `@/lib/db`, which only Vite's alias config resolves). See that file's
// docstring; audit-lite 0.6.7 FINDING-001.

/*
  Wrapped in createServerOnlyFn (not just a plain exported async function):
  this file is imported both statically, by client route components (for
  createServerFn handlers like draftLead), and dynamically, by jobs.ts's
  background runner (`await import("./desk.ts")`). That dual reachability
  let a build tip performDraftWork's dependency graph -- specifically its
  reference to `probeProvider` -- into a chunk a client route also loads,
  and the import-protection plugin then rightly refused to ship
  ai-codex.server.ts/ai-claude-code.server.ts to the browser. Marking this
  function server-only makes the framework strip it from every client
  bundle by construction, not by hoping generic tree-shaking gets there.
*/
export const performDraftWork = createServerOnlyFn(async function performDraftWork(
  job: DeskJob,
  deps: PerformDraftWorkDeps = {},
) {
  const { withClaimedLeadDraftLock, withClaimedLeadDraftCheckpointLock } =
    await import("./draft-order.server.ts");
  const runReport = deps.reportAndDraft ?? reportAndDraft;
  const probe = deps.probe ?? probeProvider;
  const setModelRuntime = deps.setJobModelRuntime ?? setJobModelRuntime;
  /*
    The index-aware reporter, not the raw `setJobStage`: this worker's job row
    carries the stage list written at claim, so each of its sentences -- the
    document reader's, report.ts's, the failover notes -- arrives with the chip
    it belongs to. See `progressReporterFor`.

    The seam keeps its `(id, sentence)` shape because `desk-model-run.ts` and
    `report.ts` pass this function down through their own deps, and every caller
    passes THIS job's id. The reporter closes over that same row, so the id
    argument is redundant here rather than ignored -- and it is the row, not the
    id, that carries the stage list.
  */
  /*
    FB1: `stagePct` is on for the draft because its six arrivals are the only
    counts a draft has. Its per-document sentences ("Interpreting notes.pdf:
    part 2 of 7") and its failover notes are not arrivals and pass no
    percentage, so the bar holds where the last arrival put it rather than
    jumping around between packet boundaries.
  */
  const reportStage = progressReporterFor(job, { stagePct: true });
  const setStage: typeof setJobStage = deps.setJobStage ?? ((_id, stage) => reportStage(stage));
  const setFailoverNote = deps.setJobFailoverNote ?? setJobFailoverNote;
  const context = { userId: job.user_id, newsroomId: job.newsroom_id };
  const leadId = job.subject_id;
  const sql = await getSql();
  const batchServer = await import("./draft-batch.server.ts");
  let batchSnapshot = await batchServer.assertDraftBatchCanContinue(sql, job);
  const batchGuard = async () => {
    const current = await batchServer.assertDraftBatchCanContinue(await getSql(), job);
    if (!current) throw new Error("Draft batch runtime snapshot is missing.");
    return current;
  };
  const leads = await sql<LeadRow>`
    select id, headline, why, topic, status, source_urls, evidence, newsworthiness, created_at, notes_json,
           meeting_video_id,meeting_artifact_id,meeting_lead_purpose
    from leads where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
  `;
  const lead = leads[0];
  if (!lead) throw new Error("Lead not found");
  let overrideReceipt: { allowKilledLead?: boolean; meetingVideoId?: string; meetingArtifactId?: number } = {};
  try { overrideReceipt = JSON.parse(job.result_json || "{}"); } catch { /* legacy job */ }
  if (lead.status === "killed" && overrideReceipt.allowKilledLead !== true) throw new Error("Restore this lead before drafting.");
  if (overrideReceipt.meetingVideoId && overrideReceipt.meetingArtifactId) {
    lead.meeting_video_id = overrideReceipt.meetingVideoId;
    lead.meeting_artifact_id = overrideReceipt.meetingArtifactId;
    lead.meeting_lead_purpose = "transcript-story";
  }
  const selectedMeetingArtifactId = meetingArtifactIdFromDraftReceipt(
    job.result_json,
    lead.meeting_artifact_id == null ? null : Number(lead.meeting_artifact_id),
  );
  let expectedDraft =
    (
      await sql<DraftRow>`select * from drafts where lead_id=${leadId} and newsroom_id=${owned(context)} order by updated_at desc,id desc limit 1`
    )[0] ?? null;
  let checkpointDraftId: number | null = null;
  const draftStillExpected = (current: DraftRow | null) =>
    current?.id === expectedDraft?.id &&
    String(current?.updated_at ?? "") === String(expectedDraft?.updated_at ?? "") &&
    (!current ||
      !expectedDraft ||
      evidenceReviewToken(current) === evidenceReviewToken(expectedDraft));
  await ensureDeskDraftMemoSchema();

  let urls: string[] = [];
  try {
    urls = sanitizePublicUrls(JSON.parse(lead.source_urls));
  } catch {
    urls = [];
  }

  const memory = await sql<MemoryRow>`
    select entity, last_angle from beat_memory
    where newsroom_id = ${owned(context)} order by updated_at desc limit 16
  `;

  const prevNotes = parseNotes(lead.notes_json);
  const meetingMaterial =
    lead.meeting_video_id && lead.meeting_artifact_id && lead.meeting_lead_purpose === "transcript-story"
      ? await (await import("./meeting-draft-material.server.ts")).loadMeetingDraftMaterial(sql, {
          newsroomId: owned(context),
          artifactId: selectedMeetingArtifactId ?? Number(lead.meeting_artifact_id),
          videoId: lead.meeting_video_id,
          fallbackTitle: lead.headline,
          videoUrl: urls.find((url) => /youtube\.com|youtu\.be/i.test(url)),
        })
      : null;
  const researchScope = job.research_scope ?? prevNotes.researchScope ?? "public";
  const sourceInput = draftSourceInputs(urls, prevNotes, researchScope);
  const { retainedWatchSources } = await import("./retained-watch-source.server.ts");
  const storyDocumentReader =
    deps.readStoryDocuments ?? (await import("./story-documents.server.ts")).readStoryDocuments;
  const documentAssignment = prevNotes.editorialAssignment?.text || lead.headline;
  const initialDocumentChoice = effectiveStoryModelChoice(job.model_choice);
  // Direct jobs keep this receipt on the job row. Forced batches keep the
  // exact preflighted runtime on the batch row, so document reading must use
  // that already-validated snapshot too instead of resolving a newer paper
  // preference while the batch writer stays pinned to its original model.
  const batchLocalModel = batchSnapshot && "localModel" in batchSnapshot ? batchSnapshot.localModel : null;
  const batchWasAutomatic = (snapshot: typeof batchSnapshot) =>
    Boolean(snapshot && (snapshot as typeof snapshot & { requestedRuntime?: string }).requestedRuntime === "auto");
  const jobLocalModel = pinnedLocalModelForJob(job);
  const queuedLocalModel = batchLocalModel ?? jobLocalModel;
  const storyProviderOverrides = applyJobLocalModelSnapshot(
    job,
    await readProviderOverrides(owned(context), "story").catch(() => ({})),
  );
  if (batchLocalModel) {
    storyProviderOverrides["local-model"] = {
      ...(storyProviderOverrides["local-model"] ?? {}),
      localModel: batchLocalModel,
    };
  }
  const documentReadingEvidence = await storyDocumentReader(
    owned(context),
    leadId,
    initialDocumentChoice,
    documentAssignment,
    (message) => setStage(job.id, message),
    prevNotes.suppliedUrls ?? [],
    context.userId,
    researchScope === "supplied",
    undefined,
    {
      modelEffort: effortFromJob(job),
      source: job.model_choice_source ?? "editor",
      // Hand-picked batch jobs use the selectable-model ladder. Automatic
      // batches retain the story ladder that resolved their first rung.
      ladder: batchSnapshot && !batchWasAutomatic(batchSnapshot) ? FORCED_FAILOVER_LADDER : undefined,
      localModel: queuedLocalModel ?? undefined,
      probe: (choice) =>
        probe(
          choice,
          owned(context),
          undefined,
          "story",
          choice === "local-model" ? (queuedLocalModel ?? undefined) : undefined,
        ),
      chat: deps.chat,
      onSwitch: async ({ previousLabel, nextLabel, nextChoice, nextEffort, reason }) => {
        await setJobModelRuntime(job.id, nextChoice, nextEffort);
        job.model_choice = nextChoice;
        job.result_json = JSON.stringify({ modelEffort: nextEffort });
        await setStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
        const switchNote = failoverNoteSentence(nextLabel, previousLabel, reason);
        await setFailoverNote(job.id, switchNote);
        if (batchSnapshot) {
          if (nextChoice === "auto" || nextChoice === "configured" || (isAutomaticRungId(nextChoice) && !batchWasAutomatic(batchSnapshot)))
              throw new Error("Draft batch fallback did not resolve to a selectable runtime.");
          const old = batchSnapshot as typeof batchSnapshot & {
            requestedRuntime?: string;
            requestedEffort?: ModelEffort | null;
          };
          const { validateForcedRuntime } = await import("./forced-runtime.server.ts");
          const validateBatchRuntime = deps.validateBatchRuntime ?? validateForcedRuntime;
          const nextSnapshot = isAutomaticRungId(nextChoice)
              ? await validateForcedRuntime(job.newsroom_id, nextChoice, nextEffort, { automaticRung: true })
              : await validateBatchRuntime(job.newsroom_id, nextChoice, nextEffort);
          const receipt = {
            requestedRuntime: old.requestedRuntime ?? old.runtime,
            requestedEffort:
              old.requestedEffort ?? ("modelEffort" in old ? (old.modelEffort ?? null) : null),
            switchReason: failoverReasonPhrase(previousLabel, reason),
            switchNote,
          };
          batchSnapshot = await batchServer.persistDraftBatchRuntimeSwitch(job, nextSnapshot, receipt);
        }
      },
    },
  );
  const retainedNameDocuments = await sql<{
    id: string;
    filename: string;
    mime: string;
    full_text: string;
    source_url: string | null;
  }>`
    select id,filename,mime,full_text,source_url from story_documents
    where newsroom_id=${owned(context)} and lead_id=${leadId} and status='read'
      and full_text is not null and mime <> 'application/x-townreporter-source-links'
    order by created_at,id`;
  const documentEvidence = retainedNameDocuments.length
    ? `PRIVATE DOCUMENT IDENTITIES (internal evidence labels only; never print IDs in the story):\n${retainedNameDocuments.map((doc) => `DOCUMENT ID ${doc.id} | FILENAME ${doc.filename}`).join("\n")}\n\n${documentReadingEvidence}`
    : documentReadingEvidence;
  const draftInput: Parameters<typeof reportAndDraft>[0] = {
    documentEvidence,
    documentNameEvidence: retainedNameDocuments.map((doc) => ({
      evidenceKind: "uploaded-document" as const,
      documentId: doc.id,
      filename: doc.filename,
      mime: doc.mime,
      text: doc.full_text,
      sourceUrl: doc.source_url,
    })),
    userId: context.userId,
    newsroomId: context.newsroomId,
    lead,
    // The immutable captured transcript is the source for a meeting story.
    // Re-fetching the YouTube watch page can return stale "upcoming" chrome and
    // contradict a completed recording, which produced the exact false draft
    // this path is designed to prevent.
    urls: meetingMaterial ? [] : sourceInput.urls,
    retainedSources: await retainedWatchSources(sql, owned(context), leadId, sourceInput.urls),
    memory,
    extraEvidence: meetingMaterial?.evidence ?? prevNotes.scratch,
    /*
      0.6.74: the editor's own reporting lines reach the prompt. Both the
      "Add a reporting note" box and the per-claim "Add to notes" button write
      a `src: "you"` to-do, and before this the researcher and the writer never
      saw them -- an editor could add a line, press Redraft, and watch the
      draft come back without it. They travel in `editorNotes`, whose block
      says what they are: leads to verify, not independent evidence. A meeting
      story keeps its transcript in that slot instead.
    */
    editorNotes: meetingMaterial ? prevNotes.scratch : editorNoteLines(prevNotes),
    extraEvidenceLimitChars: meetingMaterial ? 200_000 : undefined,
    extraEvidenceMode: meetingMaterial ? "meeting-transcript" : undefined,
    editorialAssignment: prevNotes.editorialAssignment,
    researchScope,
    extraUrls: sourceInput.extraUrls,
    modelEffort: effortFromJob(job),
    /*
      The paper's own time budgets (0.6.2). Read once, here, and carried in
      `draftInput` so the Automatic failover retry below is sized by the same
      paper-adjusted numbers rather than reverting to the shipped defaults.
      A failed read is not a reason to refuse to draft -- an empty object
      means "no overrides", which is what every paper had before this.
    */
    providerOverrides: storyProviderOverrides,
  };
  const reportDeps: Parameters<typeof reportAndDraft>[1] = {
    onStage: (stage) => setStage(job.id, stage),
  };
  reportDeps.onWriterDraft = async (checkpoint) => {
    const checkpointNote =
      "Evidence reconciliation not completed within the available edit pass. Draft retained; verify its claims and citations before publication.";
    const integrityNotes = [
      ...new Set(
        [checkpoint.integrity_notes, checkpointNote]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      ),
    ].join("\n");
    const provenance = checkpoint.captures.map((capture) => ({
      url: capture.url,
      title: capture.title,
      version_id: capture.version_id,
      capture_event_id: capture.capture_event_id,
      role: "followed",
    }));
    await withClaimedLeadDraftCheckpointLock(job, leadId, async (transactionSql) => {
      const current =
        (
          await transactionSql<DraftRow>`select * from drafts where lead_id=${leadId} and newsroom_id=${owned(context)} order by updated_at desc,id desc limit 1 for update`
        )[0] ?? null;
      if (!draftStillExpected(current))
        throw new Error(
          "The draft changed while the writer was working. The editor's newer draft was preserved.",
        );
      /*
        WHOSE HEADLINE PRINTS -- at a checkpoint too (0.6.67).

        A checkpoint is a draft revision the same way the final write is: it
        INSERTs a row. It used to take the model's headline unconditionally, so
        a checkpoint landing after an editor's edit replaced the editor's words
        AND left that row as the newest one -- which meant the final write's own
        `headlineForRedraft` below then read the model's headline off it and
        agreed with the model. The rule has to hold on both writes or it holds
        on neither.

        `model_topic` is left NULL on a checkpoint: the section here is the
        lead's, not a choice the model has made yet, and NULL is what the desk
        reads as "not recorded". Claiming the model chose it would put every
        checkpoint draft into the section-override count.
      */
      const checkpointHeadline = headlineForRedraft(current, checkpoint.headline);
      /*
        A CHECKPOINT IS A WRITE. It INSERTs a draft row exactly as the final
        write does, into the same columns -- including `research_json`, which
        the drafts projection reads back through `::jsonb` (see the note on
        `listDeskDrafts`). So it takes the same guard as the final write: model
        prose through `storableText`, and every JSON blob built from model
        output through `sanitizeJsonLeaves` before it is stringified, because
        `JSON.stringify` alone would leave a NUL in the row as an escape for
        jsonb to refuse later.

        `checkpoint.source_urls` and `provenance` are the captured-page side of
        this row and are left as they are.
      */
      const checkpointResearchJson = JSON.stringify(
        sanitizeJsonLeaves({
          citationPolicy: "explicit",
          researchScope: draftInput.researchScope,
          reportedClaims: { version: 1, rows: Array.isArray(checkpoint.claims) ? checkpoint.claims : [] },
          writerCheckpoint: { version: 1, jobId: job.id, evidenceCheckIncomplete: true },
        }),
      );
      /*
        The model's own body, kept beside the editor's (0119). Written here and
        at the final write below -- the two inserts the writer model's words
        create -- and by no editor save. Hoisted so the same bytes go into both
        columns: the editor's save overwrites `body` in place, and this is what
        survives it.
      */
      const checkpointBody = storableText(checkpoint.body);
      const [saved] = await transactionSql<DraftRow>`
        insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json,model_headline,headline_source,model_body)
        values(${context.userId},${owned(context)},${leadId},${storableText(checkpointHeadline.headline)},${storableText(checkpoint.dek)},${checkpointBody},${lead.topic},${JSON.stringify(checkpoint.source_urls)},${storableText(integrityNotes)},${JSON.stringify(provenance)},${storableText(String(checkpoint.form ?? ""))},${JSON.stringify(sanitizeJsonLeaves(checkpoint.found ?? null))},${JSON.stringify(sanitizeJsonLeaves(Array.isArray(checkpoint.unanswered) ? checkpoint.unanswered : []))},${checkpointResearchJson},${storableText(checkpointHeadline.modelHeadline)},${checkpointHeadline.source},${checkpointBody})
        returning *
      `;
      /*
        `checkpointDraftId` is a number, so this receipt's own JSON cannot carry
        a NUL -- but the `coalesce(...)::jsonb` on the left re-parses whatever
        the row already holds. That was written by the completion receipt below
        (guarded now) or by `setFailoverNote`/`jobs.ts`, none of which put model
        prose in it, so it is left alone here.
      */
      await transactionSql`
        update desk_jobs set result_json=(coalesce(nullif(result_json,''),'{}')::jsonb || ${JSON.stringify({ checkpointDraftId: Number(saved.id) })}::jsonb)::text,updated_at=now()
        where id=${job.id} and newsroom_id=${job.newsroom_id} and status='running' and claim_token=${job.claim_token ?? ""}
      `;
      expectedDraft = saved;
      checkpointDraftId = Number(saved.id);
    });
  };
  if (!batchSnapshot) {
    let activeReportSnapshot = {
      modelChoice: effectiveStoryModelChoice(job.model_choice),
      modelEffort: draftInput.modelEffort,
    };
    const storyChat = deps.chat ?? grokChat;
    const persistReportSwitch = async (
      nextChoice: EffectiveProviderChoice,
      reason: import("./automatic-failover.ts").AutomaticFailoverReason,
      nextLabel = modelChoiceLabel(nextChoice),
    ) => {
      if (nextChoice === activeReportSnapshot.modelChoice) return;
      const previousLabel = modelChoiceLabel(activeReportSnapshot.modelChoice);
      const nextEffort = modelEffort(nextChoice, activeReportSnapshot.modelEffort);
      await setModelRuntime(job.id, nextChoice, nextEffort);
      await setStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
      await setFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
      job.model_choice = nextChoice;
      job.result_json = JSON.stringify({
        modelEffort: nextEffort,
        ...(selectedMeetingArtifactId != null ? { meetingArtifactId: selectedMeetingArtifactId } : {}),
      });
      activeReportSnapshot = { modelChoice: nextChoice, modelEffort: nextEffort };
    };
    draftInput.onProviderSwitch = async ({ transport, model, reason }) => {
      const nextChoice: EffectiveProviderChoice | null =
        transport === "codex"
          ? "codex-balanced"
          : transport === "anthropic" || transport === "claude-code"
            ? /haiku/i.test(model) ? "claude-haiku" : "claude-sonnet"
            : null;
      if (nextChoice) await persistReportSwitch(nextChoice, reason);
    };
    reportDeps.chat = async (system, user, maxTokens = 800, _modelChoice, options) => {
      const run = (snapshot: typeof activeReportSnapshot) => storyChat(system, user, maxTokens, {
        timeoutMs: Math.max(
          options?.timeoutMs ?? 0,
          providerBudget(snapshot.modelChoice, draftInput.providerOverrides).callMs,
        ),
        choice: snapshot.modelChoice,
        newsroomId: job.newsroom_id,
        localModel: (draftInput.providerOverrides as ProviderOverrides | undefined)?.["local-model"]?.localModel,
        reasoningEffort: snapshot.modelEffort,
      });
      const attempted = await runPinnedCallWithFailover({
        snapshot: activeReportSnapshot,
        source: job.model_choice_source ?? "editor",
        run,
        probe: (choice) => probe(choice, job.newsroom_id),
        resolve: async (choice) => ({
          modelChoice: choice,
          modelEffort:
            activeReportSnapshot.modelEffort == null
              ? null
              : modelEffort(choice, activeReportSnapshot.modelEffort),
        }),
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
          void previousLabel;
          await persistReportSwitch(nextChoice as EffectiveProviderChoice, reason, nextLabel);
        },
      });
      activeReportSnapshot = attempted.snapshot;
      return attempted.result;
    };
  }
  if (batchSnapshot) {
    const { forcedOcrOptions, runForcedChat, validateForcedRuntime } = await import("./forced-runtime.server.ts");
    const validateBatchRuntime = deps.validateBatchRuntime ?? validateForcedRuntime;
    let activeBatchSnapshot = batchSnapshot;
    const adapters = {
        claude: async (input) => (await import("./ai-claude-code.server.ts")).claudeCodeChat(input),
        codex: async (input) => (await import("./ai-codex.server.ts")).codexChat(input),
        local: grokChat,
        custom: grokChat,
        ...deps.batchChatAdapters,
      } satisfies Required<NonNullable<PerformDraftWorkDeps["batchChatAdapters"]>>;
    reportDeps.chat = async (system, user, maxTokens = 800, _modelChoice, options) => {
      await batchGuard();
      const switchState: {
        receipt: null | {
        requestedRuntime: string;
        requestedEffort: ModelEffort | null;
        switchReason: string;
        switchNote: string;
      };
      } = { receipt: null };
      const run = (snapshot: typeof activeBatchSnapshot) => runForcedChat(
        snapshot,
        system,
        user,
        maxTokens,
        { noTools: true, timeoutMs: options?.timeoutMs },
        adapters,
      );
      const attempted = await runPinnedCallWithFailover({
        snapshot: activeBatchSnapshot,
        source: batchWasAutomatic(activeBatchSnapshot) ? "auto" : "editor",
        run,
        probe: (choice) => probe(choice, job.newsroom_id),
        ladder: batchWasAutomatic(activeBatchSnapshot) ? AUTOMATIC_LADDER : FORCED_FAILOVER_LADDER,
        resolve: (choice) => {
          const effort = "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort : null;
          return isAutomaticRungId(choice)
            ? validateForcedRuntime(job.newsroom_id, choice, effort, { automaticRung: true })
            : validateBatchRuntime(job.newsroom_id, choice, effort);
        },
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
          void nextChoice;
          const old = activeBatchSnapshot as typeof activeBatchSnapshot & {
            requestedRuntime?: string;
            requestedEffort?: ModelEffort | null;
          };
          switchState.receipt = {
            requestedRuntime: old.requestedRuntime ?? old.runtime,
            requestedEffort:
              old.requestedEffort ?? ("modelEffort" in old ? (old.modelEffort ?? null) : null),
            switchReason: failoverReasonPhrase(previousLabel, reason),
            switchNote: failoverNoteSentence(nextLabel, previousLabel, reason),
          };
        },
      });
      activeBatchSnapshot = attempted.snapshot;
      if (switchState.receipt) {
        const receipt = switchState.receipt;
        const nextEffort =
          "modelEffort" in activeBatchSnapshot ? (activeBatchSnapshot.modelEffort ?? null) : null;
        await setModelRuntime(job.id, activeBatchSnapshot.modelChoice, nextEffort);
        job.model_choice = activeBatchSnapshot.modelChoice;
        job.result_json = JSON.stringify({ modelEffort: nextEffort });
        await setStage(job.id, `Switched to ${modelChoiceLabel(activeBatchSnapshot.modelChoice)}: ${receipt.switchReason}`);
        await setFailoverNote(job.id, receipt.switchNote);
        activeBatchSnapshot = await batchServer.persistDraftBatchRuntimeSwitch(job, activeBatchSnapshot, receipt);
      }
      return attempted.result;
    };
    reportDeps.ingest = async (url) => {
      const current = await batchGuard();
      const got = await ingestDocument(
        url,
        forcedOcrOptions(
          current,
          async () => {
            await batchGuard();
          },
          deps.batchOcrAdapters,
          async ({ transport, model, reason }) => {
            const nextChoice: EffectiveProviderChoice | null =
              transport === "codex"
                ? "codex-balanced"
                : transport === "anthropic" || transport === "claude-code"
                  ? /haiku/i.test(model) ? "claude-haiku" : "claude-sonnet"
                  : null;
            if (!nextChoice || nextChoice === activeBatchSnapshot.modelChoice) return;
            const previousLabel = modelChoiceLabel(activeBatchSnapshot.modelChoice);
            const nextSnapshot = await validateBatchRuntime(
              job.newsroom_id,
              nextChoice,
              "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort : null,
            );
            const old = activeBatchSnapshot as typeof activeBatchSnapshot & {
            requestedRuntime?: string;
            requestedEffort?: ModelEffort | null;
          };
            const receipt = {
              requestedRuntime: old.requestedRuntime ?? old.runtime,
              requestedEffort:
                old.requestedEffort ?? ("modelEffort" in old ? (old.modelEffort ?? null) : null),
              switchReason: failoverReasonPhrase(previousLabel, reason),
              switchNote: failoverNoteSentence(modelChoiceLabel(nextChoice), previousLabel, reason),
            };
            activeBatchSnapshot = nextSnapshot;
            const nextEffort =
              "modelEffort" in nextSnapshot ? (nextSnapshot.modelEffort ?? null) : null;
            await setModelRuntime(job.id, nextChoice, nextEffort);
            await setStage(job.id, `Switched to ${modelChoiceLabel(nextChoice)}: ${receipt.switchReason}`);
            await setFailoverNote(job.id, receipt.switchNote);
            activeBatchSnapshot = await batchServer.persistDraftBatchRuntimeSwitch(job, nextSnapshot, receipt);
          },
        ),
      );
      return {
        url,
        title: got.title,
        text: got.text,
        extras: got.extras ?? [],
        notices: got.notices ?? [],
        pages: got.pages,
      };
    };
    reportDeps.search = async (query) => {
      await batchGuard();
      return webSearch(query);
    };
    reportDeps.capture = async (_userId, document) =>
      batchServer.withDraftBatchLease(job, async (transactionSql) => {
        const { rememberCapture } = await import("./investigate.ts");
        const rec = await rememberCapture({
          sql: transactionSql,
          userId: job.user_id,
          newsroomId: job.newsroom_id,
          investigationId: null,
          url: document.url,
          title: document.title || document.url,
          text: document.text.slice(0, 2_000_000),
          hash: await sha256(document.text || document.url),
          status: document.text ? 200 : 0,
          outcome: document.text ? "fetched" : "fetch-failed",
          classification: "discovered",
          triggerKind: "draft",
          pages: document.pages,
        });
        return { version_id: rec.versionId, capture_event_id: rec.captureEventId };
      });
  }
  const runReportWithCheckpoint = (input: Parameters<typeof reportAndDraft>[0]) =>
    runReport(input, reportDeps);
  /*
    B8B item 2: the draft kind had no Cancel check of its own.

    `waitForModel` below polls `cancel_requested` while the report runs, but
    nothing checked it on the way IN, so a Cancel pressed on a draft that had
    already been claimed still spent four model calls before the first tick
    could notice -- and `repairDraftStyle` below is a fifth call with no check
    anywhere near it. Both are boundaries the desk can afford to ask at: the
    work between them is a model call, and the answer is a sentence rather than
    a bill.
  */
  /*
    WR1: WHICH WRITER GETS THIS MEETING.

    A transcript-story lead used to hand the meeting to `retrieveMeetingEvidence`,
    which picks one subject and strips "unrelated votes" from the write prompt --
    a four-hour council session became a one-motion brief and everything else it
    did was read and dropped. The whole-meeting writer reads the whole tape on
    purpose and accounts for every item against a ledger. It is the default for
    a meeting draft now; the one-item path stays for the case it was designed
    for, an editor's notes that NAME one item (an ordinance or resolution number,
    or "item 9B2"). A note that only says how to write names nothing and still
    gets the whole meeting -- see `usesWholeMeetingWriter`.
  */
  const wholeMeetingLead = usesWholeMeetingWriter({
    hasMeetingMaterial: Boolean(meetingMaterial),
    editorialAssignment: prevNotes.editorialAssignment?.text ?? null,
  });
  /*
    Rewrite from ledger (WR1 phase 2): "Rewrite from ledger" queues an ordinary
    draft job that carries `reuseLedger` in its receipt, the only free-form
    column `desk_jobs` has. The worker reads that flag here -- before the run,
    because a fail-over switch rewrites `result_json` to a receipt of its own
    partway through -- and, when set, hands the writer the ledger already stored
    for this lead instead of reading the tape again.
  */
  const reuseLedger = (() => {
    try {
      return Boolean((JSON.parse(job.result_json || "{}") as { reuseLedger?: unknown }).reuseLedger);
    } catch {
      return false;
    }
  })();
  // The writer runs inside `waitForModel` so the stall ticker keeps working; the
  // ledger, claims, notes and run stats it produces are carried out through this
  // closure and persisted against the draft row below, after the INSERT gives
  // them a draft id.
  let wholeAccounting: import("./meeting-whole.server.ts").WholeMeetingDraftResult | null = null;
  await throwIfJobCancelled(job.id);
  /*
    The single longest await in the app: one call covering report.ts's plan,
    write, verify and sourcing passes, four sequential model calls that
    routinely run past the 60s stall window. Without the ticker the card would
    call a working draft stalled and offer the editor a retry that spends the
    model budget twice.
  */
  const reported = await waitForModel({
    jobId: job.id,
    label: modelChoiceLabel(effectiveStoryModelChoice(job.model_choice)),
    run: async () => {
      if (!wholeMeetingLead)
        return runReportWithCheckpoint({
          ...draftInput,
          modelChoice: effectiveStoryModelChoice(job.model_choice),
        });
      // A rewrite reuses the stored ledger -- the editor's statuses and all --
      // and skips the fetch and inventory passes. The length guard means an
      // empty read falls back to the normal full run rather than writing a draft
      // off a ledger that is not there.
      const storedLedger = reuseLedger
        ? await (await import("./meeting-ledger.server.ts")).loadStoredLedgerForRewrite(sql, {
            newsroomId: owned(context),
            leadId,
          })
        : undefined;
      const whole = await (await import("./meeting-whole.server.ts")).runWholeMeetingDraft({
        sql,
        newsroomId: owned(context),
        userId: context.userId,
        leadId,
        artifactId: selectedMeetingArtifactId ?? Number(lead.meeting_artifact_id),
        videoId: meetingMaterial?.meeting.videoId ?? lead.meeting_video_id ?? "",
        fallbackTitle: lead.headline,
        // The draft files under the lead's own section, so the sections trigger
        // resolves to a section this newsroom actually has.
        topic: lead.topic ?? "",
        videoUrl: meetingMaterial?.videoUrl ?? urls.find((url) => /youtube\.com|youtu\.be/i.test(url)),
        modelChoice: effectiveStoryModelChoice(job.model_choice),
        chat:
          reportDeps.chat ??
          (async () => ({ ok: false as const, error: "The writing provider is not available." })),
        onStage: (stage) => setStage(job.id, stage),
        reuseLedger: storedLedger?.length ? storedLedger : undefined,
      });
      wholeAccounting = whole;
      return whole.draft;
    },
  });
  if ("error" in reported) throw new Error(reported.error);
  /*
    The boundary between the report and the style repair, and the second half of
    B8B item 2's draft fix. A Cancel that arrived during the four model calls
    above is read here, before the fifth is spent and before anything is
    written: the honest end for a cancelled draft is no draft, with the editor's
    reason on the row, not a repaired one they never asked for.
  */
  await throwIfJobCancelled(job.id);

  /*
    THE STYLE AUDIT, BEFORE ANYTHING IS WRITTEN.

    The model's draft is measured in code, and a finding the code calls a fix
    gets one bounded repair pass through the same chat the draft itself came
    through -- the newsroom's picker, the preflight probe, the fail-over ladder.
    The repair may rewrite wording and nothing else: a rewrite that changes a
    quoted word, a number, a name or a link is refused and the model's own text
    is kept. That refusal is what makes the rest of this function safe, because
    every check that ran against the draft -- the name check, the document
    claims, the citation derivation -- still describes the text being stored:
    the body below is the repaired one, and the guard has already proved the
    facts in it are the facts that were checked.

    Nothing here publishes and nothing here is a verdict. What is left over
    becomes a review reason and a list the editor can read and ignore.
  */
  const style = await repairDraftStyle({
    headline: reported.headline,
    dek: reported.dek,
    body: reported.body,
    form: String(reported.form ?? ""),
    repair: styleRepairCall({
      /*
        Both paths above wire this. The fallback keeps the type honest and turns
        an unwired chat into a plain refusal -- the audit still runs, the draft
        is untouched, and the note says so -- rather than a crash mid-draft.
      */
      chat:
        reportDeps.chat ??
        (async () => ({ ok: false, error: "The writing provider is not available." })),
    }),
  });
  /*
    THE FINAL DRAFT'S WRITE DOOR, and the checkpoint's is the same one further
    up (`reportDeps.onWriterDraft`).

    Everything the writer model produced for this story passes through here:
    the body, the integrity notes, the memo and the claims in `research_json`,
    the unanswered questions. One U+0000 in any of them and the INSERT fails --
    inside the pass's transaction, so the draft the editor was waiting for is
    gone.

    `research_json` gets `sanitizeJsonLeaves` rather than a bare
    `JSON.stringify`, and that difference matters: `JSON.stringify` turns a NUL
    into an escape rather than removing it, so the INSERT would succeed and
    leave the byte in the row for the drafts projection to trip over when it
    reads the column back through `::jsonb` (see `listDeskDrafts` below). A
    JSON blob built from model output is sanitized wherever it is stored,
    because whether some later reader casts it to jsonb is not knowable here.

    `draftBody` is cleaned before the meeting-citation derivation rather than
    after, so the citations describe the body actually being stored.
  */
  const draftBody = storableText(style.body);
  const styleRecord = styleRecordFromRepair(style, { checkedAt: new Date().toISOString() });

  // Discovery exclusions are not citation rules: a watched page or a root
  // dashboard can be the substantive primary record. Preserve the reporter's
  // explicit citations, including an empty list, without adding lead seeds.
  //
  // The one URL added here is the recording a meeting draft was written from.
  // The writer is given the tape as supplied material and the URL sits on the
  // lead, so nothing carried it into the draft's own list -- the published
  // story of a council meeting named no source at all, because the only copy
  // of the video URL was on `leads.source_urls`. A reader checking the story
  // against the recording is the whole point of drafting from it.
  const sourceUrls = JSON.stringify(
    meetingDraftSourceUrls(reported.source_urls, meetingMaterial?.videoUrl),
  );
  const notes = storableText(reported.integrity_notes);
  // `provenance` is the captured-page side of this row -- urls, version ids,
  // capture event ids -- and is left as it is, the way the evidence paths are.
  const provenanceJson = JSON.stringify(reported.provenance);
  const unansweredJson = JSON.stringify(sanitizeJsonLeaves(reported.unanswered));
  const researchJson = JSON.stringify(
    sanitizeJsonLeaves({
      ...reported.research_memo,
      citationPolicy: "explicit",
      researchScope: draftInput.researchScope,
      // Publication must fail closed if a tape-derived draft somehow loses its
      // persisted used-citation link. The lead's candidate list is not proof of
      // what the final story actually used.
      meetingEvidence: {
        used: meetingMaterial != null,
        ...(meetingMaterial ? { artifactId: meetingMaterial.meeting.artifactId } : {}),
      },
      reportedClaims: { version: 1, rows: reported.claims },
      reportedDocumentClaims: {
        version: 1,
        checkedText: [reported.headline, reported.dek, draftBody].join("\n\n"),
        rows: reported.documentClaims ?? [],
      },
      // The findings and the before/after measurements, stored with the draft they
      // describe rather than recomputed into the page on every render.
      styleAudit: styleRecord,
    }),
  );
  const yours = keepHumanTodos(prevNotes);
  /*
    Claims of absence, as checkboxes the editor must tick before Publish.

    Not advice. `performPublish` refuses while one is unchecked, because the
    2026-09-05 story would have passed every check the desk had: it read as a
    careful, sourced piece and its central claim -- that the city had published
    nothing -- was false. The only cure is a human opening the city's own site.
  */
  const gateTodos: NoteTodo[] = absenceClaims(reported.research_memo?.gate).map((claim) => ({
    t: clipTodoText(`Claim of absence: ${claim.sentence}`),
    done: false,
    src: "gate" as const,
    // 0.6.23: the summary line names every rung of the ladder the gate ran
    // ("searched <domain> and <n> more ways"), not just the first query --
    // falls back to the old one-line form for a gate record from before this
    // release that has no `summary`.
    q: claim.summary || claim.query
      ? clipTodoText(claim.summary ?? `Searched: ${claim.query}`, TODO_DETAIL_MAX)
      : undefined,
    queries: claim.steps?.map((s) => ({ query: s.query, hit: s.hit })),
  }));
  const machine = machineTodosFrom([
    reported.research_memo?.follow,
    ...reported.unanswered,
    ...(reported.research_memo?.questions ?? []),
    ...(reported.research_memo?.unknowns ?? []),
  ]);
  const fromClaims = reported.claims.map((c) => ({
    t: c.fact.slice(0, 800),
    src: c.url,
  }));
  const fromFindings = reported.findings.slice(0, 12).map((f) => ({
    t: f.text.slice(0, 800),
    src: f.source_urls?.[0],
  }));
  /*
    Which document answered which of the memo's asks. "The city has nothing"
    and "nobody looked" used to be indistinguishable in these notes; now the
    ask is printed beside the document that answered it.
  */
  const pulledFor = new Map<string, string>();
  for (const pull of reported.research_memo?.pulls ?? []) {
    if (pull.url && pull.fetched === "ok" && !pulledFor.has(pull.url)) {
      pulledFor.set(pull.url, pull.ask);
    }
  }
  const opened = (reported.research_memo?.captured ?? []).map((doc) => {
    const answers = pulledFor.get(doc.url);
    return answers ? { ...doc, for: answers } : doc;
  });
  const nextNotes = {
    news: reported.research_memo?.news ?? "",
    why: reported.research_memo?.why_it_matters ?? "",
    angle: reported.research_memo?.angle ?? "",
    todo: [...gateTodos, ...yours, ...machine].slice(0, 24),
    found: [...fromClaims, ...fromFindings].slice(0, 16),
    verify: reported.integrity_notes ? [reported.integrity_notes] : [],
    opened,
    scratch: prevNotes.scratch,
    editorialAssignment: prevNotes.editorialAssignment,
    researchScope: draftInput.researchScope,
    suppliedUrls: prevNotes.suppliedUrls,
  };
  /*
    `leads.notes_json` is the third column in this pass that is read back
    through `::jsonb` -- `meeting-activity.ts` casts it to find the meeting's
    video and its citation count -- so the same rule as `research_json` above
    applies: the walk happens on the value, before `packNotes` stringifies it,
    because `JSON.stringify` inside `packNotes` would keep a NUL as an escape
    for that cast to refuse later.
  */
  await withClaimedLeadDraftLock(job, leadId, async (sql) => {
    const [latestLead] = await sql<{ notes_json: string | null }>`
      select notes_json from leads where id=${leadId} and newsroom_id=${owned(context)} for update
    `;
    if (!latestLead) throw new Error("Lead not found while saving reporting.");
    const notesJson = packNotes(sanitizeJsonLeaves(mergeCompletedReportingNotes(
      prevNotes, parseNotes(latestLead.notes_json), nextNotes,
    )));
    const current =
      (
        await sql<DraftRow>`select * from drafts where lead_id=${leadId} and newsroom_id=${owned(context)} order by updated_at desc,id desc limit 1 for update`
      )[0] ?? null;
    if (!draftStillExpected(current))
      throw new Error(
        "The draft changed while reporting was finishing. The editor's newer draft was preserved.",
      );
    /*
      WHOSE HEADLINE PRINTS (0.6.67).

      A redraft inserts a new row, so the model's headline replaced the editor's
      without anything noticing. Lead 240, 2026-09-25: the scan headline was
      good, two redrafts rewrote it worse, and there was no way back to either
      the editor's words or the lead's. `headlineForRedraft` keeps the headline
      of the row being replaced when the editor owns it, and records which of
      the two won; the model's own headline is stored either way, so the desk can
      still show it and offer it back with "Use the lead's headline".

      `current` is the row this draft replaces -- the same row the lock and
      `draftStillExpected` above are about, read FOR UPDATE a few lines up.
    */
    const headline = headlineForRedraft(current, reported.headline);
    const [savedDraft] = await sql<{ id: number }>`
    insert into drafts (
      user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, integrity_notes,
      provenance_json, form, found_note, unanswered, research_json,
      model_headline, model_topic, headline_source, model_body
    )
    values (
      ${context.userId}, ${owned(context)}, ${leadId}, ${storableText(headline.headline)},
      ${storableText(reported.dek)}, ${draftBody},
      ${storableText(reported.topic)}, ${sourceUrls}, ${notes},
      ${provenanceJson}, ${storableText(reported.form)}, ${storableText(reported.found_note)},
      ${unansweredJson},
      ${researchJson},
      ${storableText(headline.modelHeadline)}, ${storableText(reported.topic)}, ${headline.source}, ${draftBody}
    )
    returning id
  `;
    if (savedDraft) {
      let transcriptLinkCreated = false;
      /*
        WR1'S ACCOUNTING, AGAINST THE ROW THAT NOW EXISTS.

        The ledger rows, the claim checks, the (uncapped) meeting notes and the
        run stats are written here rather than in the report pass because they
        need a draft id and the id is the INSERT's `returning`. Same transaction
        as the INSERT, so a ledger that cannot be written fails the draft rather
        than leaving an unaccounted one on the desk.
      */
      if (wholeAccounting) {
        await (await import("./meeting-whole.server.ts")).persistWholeMeetingAccounting(sql, {
          newsroomId: owned(context),
          draftId: Number(savedDraft.id),
          leadId,
          ledger: wholeAccounting.ledger,
          claims: wholeAccounting.claims,
          meetingNotes: wholeAccounting.meetingNotes,
          runStats: wholeAccounting.runStats,
        });
      }
      /*
        Link a meeting draft to the transcript it drew from.

        This is the call that makes the revision machinery do real work.
        meeting_draft_transcript_links has held 0 rows since migration 0070
        because nothing ever wrote to it, so recheckProvisionalMeetings ran on
        every capture pass, found no links, and exited having done nothing. With
        a link row, the re-check compares the citation hashes against the new
        caption hash and records a revision notice when the tape moved.

        The citations are DERIVED from what this draft says, never inherited from
        the material it was given, so a redraft describes itself rather than the
        previous draft. A draft that used no transcript material writes no row.
      */
      const meetingCitations = meetingMaterial?.citations ?? prevNotes.transcriptCitations ?? [];
      const meeting = meetingMaterial?.meeting ?? prevNotes.meeting;
      if (meeting && meetingCitations.length) {
        const candidates = meetingCitations.map((c) => ({
            item: c.item, segmentIndex: c.segmentIndex, captionSha256: c.captionSha256, excerpt: c.excerpt,
          }));
        const draftText = {
          headline: reported.headline,
          dek: reported.dek,
          // The text this draft actually stores: the citation derivation has to
          // describe the story on the page, not the one the model first wrote.
          body: draftBody,
        };
        // A new meeting draft can only cite transcript segments the reporter
        // actually saw. Older drafts with saved transcript notes retain their
        // original derivation until they are redrafted through this path.
        const focus = reported.research_memo.meetingFocus;
        // A direction that named no item gave the writer the whole bounded
        // meeting, so the focus visibility filter would cull every citation
        // outside the one item it was never locked to. Derive over every
        // candidate instead, exactly as a draft with no focus does.
        const used = meetingMaterial
          ? focus
            ? deriveFocusedUsedCitations({
                candidates,
                visibleSegmentIndexes: focus.visibleSegmentIndexes,
                anchorSegmentIndexes: focus.anchorSegmentIndexes,
                ...draftText,
              })
            : reported.research_memo.meetingEvidenceWide
              ? deriveUsedCitations({ candidates, ...draftText })
              : []
          : deriveUsedCitations({ candidates, ...draftText });
        if (used.length) {
          await linkDraftToTranscript(sql, {
            newsroomId: owned(context),
            draftId: Number(savedDraft.id),
            artifactId: meeting.artifactId,
            citations: used,
          });
          transcriptLinkCreated = true;
        }
      }
      /*
        THE RECEIPT THE DESK READS BACK, and the reason `sanitizeJsonLeaves`
        exists.

        `JSON.stringify` is not a guard here. The name-check rows and the style
        audit's notes are model-written strings; a U+0000 in one of them comes
        out of the stringify as a JSON escape rather than as a byte, so the
        string itself looks clean -- and then `${completion}::jsonb` hands it to
        Postgres, which parses the escape and refuses the statement with
        "unsupported Unicode escape sequence". The update fails, the job never
        gets its receipt, and the Done card has no Open button. The byte has to
        go before the stringify, which is what `sanitizeJsonLeaves` does.
      */
      const completion = JSON.stringify(
        sanitizeJsonLeaves({
          ...buildDraftCompletionReceipt({
            checkpointDraftId,
            finalDraftId: Number(savedDraft.id),
            citationStatus: transcriptLinkCreated
              ? "complete"
              : meetingMaterial
                ? "review-required"
                : (reported.citation_status ??
                (reported.source_urls.length || (reported.documentClaims?.length ?? 0) > 0
                  ? "complete"
                  : "review-required")),
            evidenceCheckIncomplete: notes.includes(
                "Evidence reconciliation not completed within the available edit pass.",
              ),
            nameCheck: reported.research_memo.nameCheck,
            styleAudit: styleAuditSummary(styleRecord),
          }),
          ...(meetingMaterial ? { meetingArtifactId: meetingMaterial.meeting.artifactId } : {}),
        }),
      );
      await sql`
      update desk_jobs
      set result_json = (coalesce(nullif(result_json, ''), '{}')::jsonb || ${completion}::jsonb)::text,
          -- Where the Done card's Open button goes (0099). Written in the same
          -- statement as the receipt, rather than after the executor turns the
          -- row complete: a Done card whose link arrives a moment later is a
          -- card that says "your draft is ready" with nothing to press.
          result_href = ${`/desk/story/${leadId}`}
      where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = 'running' and claim_token = ${job.claim_token ?? ""}
    `;
    }
    await sql`
    update leads set status = 'drafted', notes_json = ${notesJson}
    where id = ${leadId} and newsroom_id = ${owned(context)}
  `;
    await sql`
    insert into audit_events (user_id, action, detail, newsroom_id)
    values (${context.userId}, 'draft', ${String(leadId)}, ${owned(context)})
  `;
    /*
      0.6.70: a research pass proposes sources too (owner, 2026-09-24: "Research/
      Dark agents can propose newly found sources into the source database (as
      candidates; a person accepts), so the source list grows over time").

      What it proposes is what it READ: the documents it opened for text
      (`research_memo.captured`) and the pages it cited in the draft
      (`source_urls`). Not every URL it saw, and not the search pages it saw
      them on -- `proposePassSources` refuses those, and `isIndexUrl` is the
      different, citation-side question, so it is deliberately not applied here:
      a council's agenda index is a page the owner may well want on the watch
      list even though it is a poor thing to cite as the originating story.

      The section guess travels with the suggestion. It is the section this
      draft is filed under, which is what the pass already decided about this
      material -- kept only when this newsroom still has that section, so the
      review screen never preselects a key the accept would then refuse.

      This runs inside the pass's own transaction, the way the scan's proposals
      do (`:1328`): a pass's proposals are part of what the pass produced. The
      writes below are a handful of column inserts with no model call, no
      fetch and no new constraint to violate.
    */
    const [guessSection] = await sql<{ key: string }>`
      select key from newsroom_sections
      where newsroom_id = ${owned(context)} and key = ${reported.topic}
    `;
    await proposePassSources(sql, {
      userId: context.userId,
      newsroomId: owned(context),
      proposedBy: "research",
      leadId,
      section: guessSection ? reported.topic : null,
      pages: [
        ...opened.map((doc) => {
          // `opened` carries the question a document answered only when the
          // memo recorded one, so the reason says which of the two it was
          // rather than inventing an answer.
          const answered = "for" in doc ? doc.for : "";
          return {
            url: doc.url,
            title: doc.title,
            reason: answered
              ? `Opened while reporting "${reported.headline}" -- it answered: ${answered}`
              : `Opened while reporting "${reported.headline}".`,
          };
        }),
        ...sanitizePublicUrls(reported.source_urls).map((url) => ({
          url,
          reason: `Cited in the draft "${reported.headline}".`,
        })),
      ],
    });
  });
});

export const draftLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftLeadInput.parse(input))
  .handler(async ({ context, data }) => {
    // SG1 / Option A: drafting spends a model on this paper's behalf, and an
    // un-set-up install has no town to write about. Refused in one sentence.
    const leadId = typeof data === "number" ? data : data.leadId;
    const modelChoice = storyModelChoice(typeof data === "number" ? "auto" : data.modelChoice);
    const { commitStoryDraftForAuthenticatedEditor } =
      await import("./model-request-commit.server.ts");
    return commitStoryDraftForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      leadId,
      modelChoice,
      modelEffort: typeof data === "number" ? null : modelEffort(modelChoice, data.modelEffort),
      researchScope: typeof data === "number" ? undefined : data.researchScope,
      meetingArtifactId: typeof data === "number" ? undefined : data.meetingArtifactId,
      override: typeof data === "number" ? undefined : data.override,
    });
  });

/*
  WR1 phase 2: the story page's Meeting ledger panel, and the two writes and one
  queue it makes.

  `deskMiddleware` has already established the caller is an owner or editor and
  told us the newsroom. Both writes are scoped by `newsroom_id` in the saver
  itself, so a draft id or claim id belonging to another newsroom matches no row
  and is refused -- a screen that names someone else's ledger cannot change it.
*/
export const saveLedgerItemStatus = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => ledgerItemStatusInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { saveLedgerItemStatus: save, saveReportingLedgerItemStatus } = await import("./meeting-ledger.server.ts");
    if (data.reporting) return withTransaction((tx) => saveReportingLedgerItemStatus(tx, { ...data, reporting: data.reporting!, newsroomId: owned(context), reason: data.reason ?? "" }));
    return save(sql, {
      newsroomId: owned(context),
      draftId: data.draftId,
      itemNo: data.itemNo,
      status: data.status,
      reason: data.reason ?? "",
    });
  });

/** WR1 phase 2: set or clear the "Checked" mark on one checked claim. */
export const markClaimReviewed = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => claimReviewedInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { markClaimReviewed: mark } = await import("./meeting-ledger.server.ts");
    return mark(sql, { newsroomId: owned(context), claimId: data.claimId, reviewed: data.reviewed });
  });

/**
 * WR1 phase 2: "Rewrite from ledger". Queues an ordinary draft job through the
 * same commit boundary the Draft button uses -- the only difference is the
 * `reuseLedger` flag the worker reads, which makes the run reuse the ledger
 * already stored for this lead instead of reading the tape again.
 */
export const rewriteFromLedger = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => rewriteFromLedgerInput.parse(input))
  .handler(async ({ context, data }) => {
    const modelChoice = storyModelChoice(data.modelChoice);
    const { commitStoryDraftForAuthenticatedEditor } = await import("./model-request-commit.server.ts");
    return commitStoryDraftForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      leadId: data.leadId,
      modelChoice,
      modelEffort: modelEffort(modelChoice, data.modelEffort),
      researchScope: data.researchScope,
      meetingArtifactId: data.meetingArtifactId,
      reuseLedger: true,
      override: data.override,
    });
  });

/*
  `listRecentStoryWork` USED TO LIVE HERE, and it is gone (FB1, unit 3).

  It returned at most five `kind='draft'` rows joined to leads, and it was the
  shell's Running box and Today's "In progress" strip. Three things were wrong
  with it, and the report measured all three: it could not see ten of the eleven
  kinds, so a running scan or dig showed no card anywhere; it drew the same rows
  the phase 3 `desk_jobs` query was already polling, on a 5 s clock of its own;
  and its `order by updated_at desc limit 5` meant a long-running draft could be
  pushed out of the window by five recently-touched finished ones.

  `listDeskJobs` in ./job-progress.ts is the replacement -- every kind, open
  rows first, one reader for the whole desk -- and both callers now use it.
*/

/*
  The drafts screen's list (redesign phase 2a, README "4. Drafts").

  There was no server function that could answer "which drafts are on the desk
  right now": `listLeads` is lead-level, and every other draft read in this file
  is for one lead at a time. This one only reads -- it selects, joins and
  projects, and writes nothing. No migration: every column it touches already
  exists.

  ONE ROW PER LEAD. A redraft INSERTS a new `drafts` row rather than updating
  the old one (see `headlineForRedraft`), so grouping by lead and taking the
  newest row is the same "the draft on this desk" rule `listLeads` already uses
  for `story_headline`. A lead with two draft rows is one story, not two.
*/
/*
  The row SQL lives here so more than one reader can share it. `queryDraftRows`
  runs it for the list, and `countDraftsDesk` runs it as a subquery to count
  exactly the rows the Drafts screen lists -- one source of truth for what a
  draft row is, rather than a second WHERE clause to keep in step.

  It is a plain string with `$1` for the newsroom id, not a tagged template:
  both callers hand it to `sql.query(text, params)`, and a nested tag fragment
  does not work -- `toSql` turns an interpolated value into a parameter, not
  into SQL text.
*/
const DESK_DRAFT_ROWS_SQL = `
    with latest_draft as (
      select distinct on (d.lead_id)
             d.id, d.lead_id, d.headline, d.dek, d.topic, d.form,
             d.model_headline, d.headline_source, d.updated_at,
             /*
               IS THERE ANY PROSE YET?

               fileLead inserts a draft row alongside the lead (see
               insertLeadWithDraft) with body = '', so a lead filed by hand
               has a draft from the moment it is filed. Without this fact
               every such row fell through deskDraftState to its last branch
               and announced "Ready to check", which put unwritten leads on
               the Publish step and in Tonight's edition -- the desk telling
               an editor two stories were ready to print when nothing had
               been written. The boolean is projected rather than the body,
               so no prose is pulled across the wire.
             */
             coalesce(nullif(btrim(d.body), ''), '') <> '' as has_body,
             l.headline as lead_headline, l.status as lead_status, l.origin,
             l.newsworthiness, l.why,
             /*
               research_json is a text column (migration 0010) and is always
               written with JSON.stringify. It is projected to jsonb HERE, in
               the query, so the handful of small keys this screen reads --
               the evidence review's required/decision, the imported-text
               flag and the name check -- do not drag the whole memo,
               including the archived original draft body inside
               evidenceReview.original, across the wire on every poll.
             */
             coalesce(nullif(btrim(d.research_json), ''), '{}')::jsonb as research
      from drafts d
      join leads l on l.id = d.lead_id and l.newsroom_id = d.newsroom_id
      where d.newsroom_id = $1
        -- "Everything not yet printed": a killed lead, or one already
        -- published, is not a draft on the desk.
        and l.status in ('new','drafted','held')
      order by d.lead_id, d.updated_at desc, d.id desc
    )
    select v.id, v.lead_id,
           coalesce(nullif(v.headline, ''), v.lead_headline) as headline,
           v.dek, v.topic, v.form, v.updated_at, v.lead_status, v.origin,
           v.newsworthiness, v.why, v.model_headline, v.headline_source, v.has_body,
           v.research->'storyReadiness' as story_readiness,
           jb.status as job_status, jb.stage as job_stage,
           jb.started_at as job_started_at, jb.updated_at as job_updated_at,
           jb.model_choice as job_model_choice,
           -- The failed row prints WHY it stopped ("Codex quota reached"),
           -- which is the one thing a "Draft failed" chip cannot say. The job
           -- writes it to desk_jobs.error (jobs.ts, 800 chars max).
           jb.error as job_error,
           -- coalesce(..., false): a missing key makes ->> NULL, and
           -- NULL = 'true' is NULL rather than false, which would arrive on
           -- the desk as a third value where the row means "no".
           coalesce((v.research->'evidenceReview'->>'required') = 'true', false) as evidence_required,
           v.research->'evidenceReview'->>'decision' as evidence_decision,
           -- When the reconciliation pass last ran (draft-reconcile.server.ts
           -- stamps this key), and when the name check last ran. The row prints
           -- "checked 8:02 a.m." off these two; a row with neither says nothing
           -- rather than a time it does not have.
           v.research->>'evidenceReconciledAt' as evidence_checked_at,
           v.research->'nameCheck'->>'checkedAt' as names_checked_at,
           coalesce((v.research->>'importedText') = 'true', false) as imported_text,
           coalesce((v.research->'nameCheck'->>'complete') = 'true', false) as name_check_complete,
           case when jsonb_typeof(v.research->'nameCheck'->'rows') = 'array'
             then (select count(*)::int from jsonb_array_elements(v.research->'nameCheck'->'rows') r
                    where r->>'status' = 'unresolved')
             else 0 end as names_unresolved
    from latest_draft v
    left join lateral (
      select j.status, j.stage, j.started_at, j.updated_at, j.model_choice, j.error
      from desk_jobs j
      where j.newsroom_id = $1 and j.kind = 'draft' and j.subject_id = v.lead_id
      order by j.id desc limit 1
    ) jb on true
    -- Newest work first: the draft an editor just touched is the one they
    -- came back for. A running job moves its own updated_at heartbeat, so
    -- a story being written right now holds the top of the list while it is
    -- being written.
    order by greatest(v.updated_at, coalesce(jb.updated_at, v.updated_at)) desc, v.id desc
  `;

export async function queryDraftRows(context: { newsroomId: number }) {
  const { ensureJobsSchema } = await import("./jobs.ts");
  await ensureJobsSchema();
  const sql = await getSql();
  const rows = await sql.query<{
    id: number;
    lead_id: number;
    headline: string;
    dek: string | null;
    topic: string | null;
    form: string | null;
    updated_at: string;
    /** Has any prose been written into this draft row yet? See the CTE note. */
    has_body: boolean;
    story_readiness: (StoryReadiness & { version: number }) | null;
    lead_status: string;
    origin: string | null;
    newsworthiness: number | null;
    why: string | null;
    model_headline: string | null;
    headline_source: string | null;
    job_status: string | null;
    job_stage: string | null;
    job_started_at: string | null;
    job_updated_at: string | null;
    job_model_choice: string | null;
    job_error: string | null;
    evidence_required: boolean;
    evidence_decision: string | null;
    evidence_checked_at: string | null;
    imported_text: boolean;
    name_check_complete: boolean;
    names_checked_at: string | null;
    names_unresolved: number;
  }>(DESK_DRAFT_ROWS_SQL, [owned(context)]);
  const { loadDeskClaimCounts, recordedDraftClaimCount, isUnreadableFindingsError } =
    await import("./finding-evidence-review.ts");
  const counts = await loadDeskClaimCounts(sql, owned(context), rows.map(row => row.id));
  // One bounded read for current-version identities; do not send story bodies to the list.
  const drafts = rows.length ? await sql.query<DraftRow & { notes_json: string }>(
    "select d.*, l.notes_json from drafts d join leads l on l.id=d.lead_id and l.newsroom_id=d.newsroom_id where d.newsroom_id=$1 and d.id=any($2::int[])",
    [owned(context), rows.map(row => row.id)],
  ) : [];
  const readiness = new Map<number, StoryReadiness>();
  for (const draft of drafts) {
    let recordedClaims = 0;
    try {
      recordedClaims = recordedDraftClaimCount(draft);
    } catch (error) {
      if (!isUnreadableFindingsError(error)) throw error;
    }
    readiness.set(draft.id, readinessWithUncheckedStory(savedStoryReadiness(draft.research_json), {
      recordedClaims,
      evidenceCheckedCurrentVersion: evidenceCheckCoversCurrentVersion(draft),
      body: stripReporterNotebook(draft.body ?? ""),
      acknowledgedForVersion: evidenceConfirmationMatches(parseNotes(draft.notes_json).uncheckedStoryConfirmation?.token, draft),
      exempt: draft.form === "editorial",
    }));
  }
  return rows.map(row => ({ ...row,
    story_readiness: { version: 1, ...(readiness.get(row.id) ?? savedStoryReadiness(row.story_readiness)) },
    unreviewed_claims: counts.get(row.id)?.outstanding ?? 0,
    unreviewed_claims_accepted_count: counts.get(row.id)?.accepted ?? 0,
  }));
}

/*
  The whole drafts list, for the readers that need all of it: Today counts
  writing/needing-you/ready across every draft to draw its four steps, so a
  windowed list would make those numbers describe the page rather than the desk.

  The `limit 60` this query used to carry is gone, and the two facts it hid are
  the reason. `deskDraftFilterCounts` counts what a pill would SHOW, and a count
  taken over the 60 newest drafts is not that count once a desk has more; and
  the Drafts screen's own window (below) is the bound that matters now, because
  it is the one that decides what crosses the wire. The query reads every draft
  row for the newsroom exactly as the queue, sources and published queries
  already read their tables.
*/
export const listDraftsDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => queryDraftRows(context));

/*
  A count-only read of the same rows (review D2).

  The shell draws the Drafts nav count on every desk screen, and it used to
  call `listDraftsDesk()` for it -- every draft row with every projection, then
  read `.length`. This runs the very same row query (`DESK_DRAFT_ROWS_SQL`, the
  one `listDraftsDesk` and `listDraftsDeskPage` share) inside `count(*)`, so the
  number is taken over exactly the rows the Drafts screen lists, from one source
  of truth for what a draft row is, and only the integer crosses the wire. The
  Drafts screen's "All" pill counts those same rows; the nav count is that
  number, not a second one invented here.
*/
export const countDraftsDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const sql = await getSql();
    const [row] = await sql.query<{ count: number }>(
      `select count(*)::int as count from (${DESK_DRAFT_ROWS_SQL}) as desk_drafts`,
      [owned(context)],
    );
    return row?.count ?? 0;
  });

/**
 * The Drafts screen's window (Unit CZ-long-lists).
 *
 * "Everything not yet printed" is a growing list on a real desk, and the screen
 * drew every row of it. This returns the pill's match cut to the page the editor
 * asked for, plus the true total and the pill counts.
 *
 * The filter is the state machine in `desk-drafts.ts`, not a column -- "Needs
 * you" is "a name to review OR evidence to check", "Yours" is whether the editor
 * wrote the headline -- so it runs here, over the rows, before the page is cut.
 * `deskDraftState` is called with no elapsed time on purpose: the elapsed
 * argument only changes a running row's LABEL ("Writing · 2:18"), while the
 * state key, `running`, `failed`, `needsYou` and `yours` -- everything the
 * filter reads -- are decided by facts alone. The screen still computes its own
 * states with the real clock, because the label is the row's words.
 */
export const listDraftsDeskPage = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => cleanListWindow(input, DESK_DRAFT_FILTERS, "all"))
  .handler(async ({ context, data }) => {
    const all = await queryDraftRows(context);
    const states = all.map((row) => deskDraftState(row));
    const counts = deskDraftFilterCounts(states);
    const matched = all.filter((_, index) => deskDraftMatchesFilter(states[index], data.filter));
    const { rows, total } = takeWindow(matched, data.offset, data.limit);
    return { rows, total, counts };
  });

export const writeStoryFromInput = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => writeStoryInput.parse(input))
  .handler(async ({ context, data }) => {
    const { writeStoryForAuthenticatedEditor } = await import("./model-request-commit.server.ts");
    return writeStoryForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      text: data.text,
      override: data.override,
      documentIds: data.documentIds,
      sectionKey: data.sectionKey,
      modelChoice: data.modelChoice,
      modelEffort: data.modelEffort,
      researchScope: data.researchScope,
    });
  });

/**
 * "Import finished stories" — the second choice in New story. The editor
 * pastes a report (or a single story); `import-stories.ts` reads the story
 * boundaries and their parts with no model at all when the text has headings.
 * This call is the exception: the editor reaches it from the review screen for
 * a paste where the deterministic reader found nothing, and it asks ONE
 * question about structure and checks every sentence back against the paste.
 */
export const structureImportStories = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => importStructureInput.parse(input))
  .handler(async ({ context, data }) => {
    const { readImportStructure } = await import("./import-stories.server.ts");
    const localModel = data.modelChoice === "local-model"
      ? (await import("./provider-settings.ts")).resolveLocalModelChoice(owned(context), "story").then((choice) => choice.override ?? undefined)
      : undefined;
    return readImportStructure({
      text: data.text,
      newsroomId: owned(context),
      modelChoice: data.modelChoice,
      modelEffort: data.modelEffort,
      localModel: await localModel,
    });
  });

/**
 * File the ticked cards: one lead and one saved draft each, in the Queue,
 * every word checked against the paste first. Nothing here publishes — an
 * imported story leaves the desk through the ordinary Publish button, with
 * the ordinary gates. The cited pages are captured in the background.
 */
export const importFinishedStories = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => importStoriesInput.parse(input))
  .handler(async ({ context, data }) => {
    const { performImportFinishedStories } = await import("./import-stories.server.ts");
    return performImportFinishedStories(
      { userId: context.userId, newsroomId: owned(context) },
      { text: data.text, tool: data.tool, stories: data.stories, override: data.override },
    );
  });

export const saveReportingNotes = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => reportingNotesInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureDeskDraftMemoSchema();
    return withTransaction(async (sql) => {
      /*
        Pull writes excerpts in the background. Lock the same lead row before
        applying an editor note change so neither full notes_json update can
        erase the other after reading an older copy.
      */
      const rows = await sql<{ notes_json: string | null }>`
        select notes_json from leads
        where id = ${data.leadId} and newsroom_id = ${owned(context)}
        for update
      `;
      if (!rows[0]) return { ok: false as const, error: "Lead not found" };
      const notes = applyTodoPatch(parseNotes(rows[0].notes_json), {
        todos: data.todos,
        toggle: data.toggle,
        add: data.add,
        scratch: data.scratch,
      });
      if (data.researchScope === "supplied" || data.researchScope === "public")
        notes.researchScope = data.researchScope;
      if (typeof data.storyDirection === "string") {
        const direction = data.storyDirection.trim().slice(0, 1000);
        notes.editorialAssignment = direction ? { origin: "story-workspace", text: direction } : undefined;
      }
      if (typeof data.scratch === "string")
        notes.suppliedUrls = sanitizePublicUrls([
          ...(notes.suppliedUrls ?? []),
          ...suppliedUrlsFromText(data.scratch),
        ]).slice(0, 8);
      const json = packNotes(notes);
      await sql`
        update leads set notes_json = ${json} where id = ${data.leadId} and newsroom_id = ${owned(context)}
      `;
      return { ok: true as const, notes };
    });
  });

/*
  Editor-facing civic reporting (civic-reporting.ts / civic-reporting.server.ts).

  One press opens ONE reporting run: a `reporting_requests` row (the durable
  assignment/method/model record) and a `desk_jobs` row of kind `reporting`
  whose subject is the REQUEST id. The runner does the actual method work;
  these functions never run it, never write a package, and never fake one.

  The four direct assignments (town/beat/date/issue) file their own lead, so
  they carry no lead id; the two lead actions (this meeting / this lead)
  require one. The distinction is enforced by the commit module, not here.
*/
export const startReporting = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => startReportingInput.parse(input))
  .handler(async ({ context, data }) => {
    const { startReportingForAuthenticatedEditor } = await import("./civic-reporting-commit.server.ts");
    return startReportingForAuthenticatedEditor(
      { userId: context.userId, newsroomId: owned(context) },
      {
        action: data.action,
        leadId: data.leadId,
        assignment: data.assignment,
        override: data.override,
        seedUrls: data.seedUrls,
        parentRequestId: data.parentRequestId,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort ?? null,
        researchScope: data.researchScope,
      },
    );
  });

/** A follow-up run: targeted work against a run the editor already has. */
export const answerReportingFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => reportingFollowUpInput.parse(input))
  .handler(async ({ context, data }) => {
    const { answerReportingFollowUp: run } = await import("./civic-reporting-commit.server.ts");
    return run(
      { userId: context.userId, newsroomId: owned(context) },
      {
        parentRequestId: data.parentRequestId,
        assignment: data.assignment,
        override: data.override,
        seedUrls: data.seedUrls,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort ?? null,
        researchScope: data.researchScope,
      },
    );
  });

/**
  The editor's dated, sourced correction or disposition, saved for a later
  relevant assignment. Scope and evidence are required at the boundary; this
  records a decision and changes no model prompt.
*/
export const saveReportingCorrection = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => reportingObservationInput.parse(input))
  .handler(async ({ context, data }) => {
    const { saveReportingCorrection: save } = await import("./civic-reporting-commit.server.ts");
    return save(
      { userId: context.userId, newsroomId: owned(context) },
      {
        requestId: data.requestId,
        leadId: data.leadId,
        kind: data.kind,
        text: data.text,
        evidence: data.evidence,
      },
    );
  });

/** Open the run's exact saved draft, without selecting a newer version. */
export const getFiledReportingDraft = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => rowId.parse(input))
  .handler(async ({ context, data: draftId }) => {
    const sql = await getSql();
    const [draft] = await sql<Pick<DraftRow, "id" | "lead_id" | "headline" | "dek" | "body">>`
      select d.id, d.lead_id, d.headline, d.dek, d.body from drafts d
      where d.id = ${draftId} and d.newsroom_id = ${owned(context)}
        and d.lead_id is not null
      limit 1
    `;
    return draft ?? null;
  });

/** The structured reporting package for a lead, scoped to this newsroom. */
export const loadLeadReportingPackage = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => leadReportingPackageInput.parse(input))
  .handler(async ({ context, data }) => {
    const { loadLeadReportingPackageForEditor } = await import("./civic-reporting-commit.server.ts");
    return loadLeadReportingPackageForEditor(
      { userId: context.userId, newsroomId: owned(context) },
      data.leadId,
    );
  });

/**
  Observations relevant to ONE assignment, shown beside the package as
  "records kept for the next assignment". The scope is REQUIRED: the screen
  sends the lead, the run's parent request and the run's seed sources, and the
  storage worker answers with only the observations that belong to them. This
  replaces an unscoped newsroom-wide read that leaked every editor correction
  onto every story.
*/
export const listReportingObservations = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => reportingObservationsScopeInput.parse(input))
  .handler(async ({ context, data }) => {
    const { listReportingObservations: list } = await import("./civic-reporting-commit.server.ts");
    return list({ userId: context.userId, newsroomId: owned(context) }, {
      leadId: data.leadId ?? null,
      requestId: data.requestId ?? null,
      seedUrls: data.seedUrls ?? [],
    });
  });

/** Stop a reporting run the editor started (existing desk_jobs cancel path). */
export const cancelReportingRequest = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => reportingRequestIdInput.parse(input))
  .handler(async ({ context, data }) => {
    const { cancelReportingRequest: cancel } = await import("./civic-reporting-commit.server.ts");
    return cancel({ userId: context.userId, newsroomId: owned(context) }, data.requestId);
  });

export const pullTodo = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => pullTodoInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const warning = await paperSetupWarning(context, data.override, "start a Pull");
      if (warning) return warning;
      await ensureDeskDraftMemoSchema();
      const sql = await getSql();
      return startPullForEditor(context, data, async (query, sourceUrl) => {
      const receipt = newPullReceipt({
        leadId: data.leadId,
        // A claim Pull has no reporting line to strike, so it carries no index.
        todoIndex: sourceUrl ? undefined : data.index,
        sourceUrl,
        query,
      });
      const job = await enqueueJob({
        userId: context.userId,
        newsroomId: owned(context),
        kind: "pull",
        subjectId: data.leadId,
        resultJson: JSON.stringify(receipt),
      });
      const accepted = await sql<{ result_json: string }>`
        select result_json from desk_jobs where id = ${job.id} limit 1
      `;
      const acceptedReceipt = parsePullReceipt(accepted[0]?.result_json);
      if (!acceptedReceipt || acceptedReceipt.attemptId !== receipt.attemptId) {
        return {
          ok: false as const,
          error:
            "Another reporting-line Pull won the start race. Its live progress is shown beside that line.",
        };
      }
      return { ok: true as const, jobId: job.id };
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Pull failed";
      return { ok: false as const, error: raw };
    }
  });

export const listPullJobs = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => leadIdInput.parse(input))
  .handler(async ({ context, data }): Promise<PullRunView[]> => {
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      subject_id: number;
      status: "queued" | "running" | "completed" | "failed";
      stage: string;
      result_json: string;
      started_at: string | null;
      updated_at: string;
      finished_at: string | null;
    }>`
      select id, subject_id, status, stage, result_json, started_at, updated_at, finished_at
      from desk_jobs
      where newsroom_id = ${owned(context)} and kind = 'pull' and subject_id = ${data.leadId}
      order by id desc limit 24
    `;
    return rows.flatMap((job) => {
      const receipt = parsePullReceipt(job.result_json);
      if (!receipt) return [];
      const status =
        job.status === "failed"
          ? "failed"
          : job.status === "running" && receipt.status === "queued"
            ? "running"
            : receipt.status;
      return [
        {
          jobId: job.id,
          leadId: receipt.leadId,
          todoIndex: receipt.todoIndex,
          sourceUrl: receipt.sourceUrl ?? null,
          query: receipt.query,
          jobStatus: job.status,
          status,
          stage:
            job.status === "queued" || job.status === "running"
              ? job.stage || receipt.stage
              : receipt.stage,
          stopRequested: receipt.stopRequested,
          counters: receipt.counters,
          errors: receipt.errors,
          providerNotes: providerFailureNotes(receipt.providerFailures ?? []),
          startedAt: receipt.startedAt ?? job.started_at,
          updatedAt: receipt.updatedAt || job.updated_at,
          finishedAt: receipt.finishedAt ?? job.finished_at,
        },
      ];
    });
  });

export const stopPullJob = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => jobIdInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const changed = await sql<{ id: number }>`
      update desk_jobs
      set result_json = jsonb_set(result_json::jsonb, '{stopRequested}', 'true'::jsonb)::text,
          stage = 'Stopping after the current request…', updated_at = now()
      where id = ${data.jobId} and newsroom_id = ${owned(context)}
        and kind = 'pull' and status in ('queued', 'running')
      returning id
    `;
    return changed[0]
      ? { ok: true as const }
      : { ok: false as const, error: "That Pull is no longer running." };
  });

export const continuePullJob = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => jobIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const sql = await getSql();
      const rows = await sql<{
        subject_id: number;
        status: string;
        result_json: string;
      }>`
        select subject_id, status, result_json from desk_jobs
        where id = ${data.jobId} and newsroom_id = ${owned(context)}
          and kind = 'pull' limit 1
      `;
      const prior = rows[0];
      const receipt = parsePullReceipt(prior?.result_json);
      if (!prior || !receipt) return { ok: false as const, error: "Saved Pull not found." };
      if (prior.status === "queued" || prior.status === "running") {
        return { ok: false as const, error: "That Pull is still running." };
      }
      const open = await findOpenJob({
        newsroomId: owned(context),
        kind: "pull",
        subjectId: prior.subject_id,
      });
      if (open) return { ok: false as const, error: "This story already has a Pull running." };
      const setup = await paperSetupWarning(context, data.override, "continue a Pull");
      if (setup) return setup;
      const rate = await checkRate(context.userId, "pull", owned(context), data.override, { record: false });
      if (rate) return rate;
      const resumed: typeof receipt = {
        ...receipt,
        attemptId: crypto.randomUUID(),
        status: "queued",
        stage: "Queued to continue",
        stopRequested: false,
        startedAt: null,
        updatedAt: new Date().toISOString(),
        finishedAt: null,
      };
      const job = await enqueueJob({
        userId: context.userId,
        newsroomId: owned(context),
        kind: "pull",
        subjectId: prior.subject_id,
        resultJson: JSON.stringify(resumed),
      });
      const accepted = await sql<{ result_json: string }>`
        select result_json from desk_jobs where id = ${job.id} limit 1
      `;
      const acceptedReceipt = parsePullReceipt(accepted[0]?.result_json);
      if (!acceptedReceipt || acceptedReceipt.attemptId !== resumed.attemptId) {
        return {
          ok: false as const,
          error:
            "Another reporting-line Pull won the continue race. Its live progress is shown beside that line.",
        };
      }
      await recordDeskRun(context.userId, "pull", owned(context));
      return { ok: true as const, jobId: job.id };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not continue Pull.",
      };
    }
  });

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftEditInput.parse(input))
  .handler(async ({ context, data }) => {
    const { saveDraftForEditor } = await import("./draft-edit.server.ts");
    return saveDraftForEditor({ userId: context.userId, newsroomId: owned(context) }, data);
  });

/**
 * The editor's "Fix these with the model" press.
 *
 * One round, on demand, on the text the page is showing. It saves as a draft
 * revision like any other save -- nothing publishes -- and the row is left
 * exactly as it was when the call fails or the guard refuses the rewrite.
 */
export const fixDraftStyle = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftStyleFixInput.parse(input))
  .handler(async ({ context, data }) => {
    const { fixDraftStyleForEditor } = await import("./draft-audit.server.ts");
    return fixDraftStyleForEditor({ userId: context.userId, newsroomId: owned(context) }, data);
  });

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => leadStatusInput.parse(input))
  .handler(async ({ context, data }) => {
    const { setLeadStatusForEditor } = await import("./lead-lifecycle.ts");
    return setLeadStatusForEditor(await getSql(), { userId: context.userId, newsroomId: owned(context) }, data);
  });

/**
 * The way back from a kill: put the lead where it was, not where kills usually go.
 *
 * Owner, 2026-10-03. The Undo on a kill put every lead back to `new`
 * (`killUndoPress`), so a `drafted` lead an editor killed and took back came back
 * as a fresh lead with its draft orphaned behind it -- the status an Undo must
 * restore is the one the row held when the Kill was pressed, and for a lead that
 * had been drafted that is `drafted`.
 *
 * WHY THIS IS NOT `setLeadStatus`. That input has no `drafted` in it, and should
 * not: `drafted` is written by the desk's own drafting pass and never picked by
 * a screen. The Undo may write it only because it is UN-writing, so the
 * permission lives here, behind two checks the schema cannot make:
 *
 *   - the lead must be KILLED right now. An Undo is the way back from a kill and
 *     nothing else; without this the call would be a general "set any status"
 *     door with a friendly name.
 *   - a lead going back to `drafted` must still have its draft (`drafts.lead_id`).
 *     A lead whose draft was thrown away has nothing to go back to, and calling
 *     it drafted would promise a story that no longer exists.
 *
 * Both refusals are the desk's ordinary `{ok:false, error}`, so the row rolls
 * back through `leadStatusOptimistic` and the toast carries the reason.
 */
export const restoreKilledLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => leadStatusRestoreInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const room = owned(context);
    if (data.status === "drafted") {
      const rows = await sql<{ id: number }>`
        update leads set status = 'drafted'
        where id = ${data.id} and newsroom_id = ${room} and status = 'killed'
          and exists (
            select 1 from drafts
            where drafts.lead_id = leads.id and drafts.newsroom_id = ${room}
          )
        returning id
      `;
      if (!rows.length) return { ok: false as const, error: "That lead has no draft to go back to." };
      return { ok: true as const };
    }
    const rows = await sql<{ id: number }>`
      update leads set status = ${data.status}
      where id = ${data.id} and newsroom_id = ${room} and status = 'killed'
      returning id
    `;
    if (!rows.length) return { ok: false as const, error: "That lead is not killed." };
    return { ok: true as const };
  });

/**
 * "Edit the lead" (design review note 2, 0.6.80): the drawn row's own
 * subtitle is "Change the title, notes or section before drafting"
 * (`docs/design/handoff-2026-09-26/design/Desk Dialogs.dc.html:152`). The
 * behavior lives in `lead-edit.server.ts`, thin-wrapped here the way
 * `saveDraft` wraps `saveDraftForEditor` -- so a test can call it directly
 * against a real `leads` table without importing this file (see the comment
 * on `updateLeadForEditor`).
 */
export const updateLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => editLeadInput.parse(input))
  .handler(async ({ context, data }) => {
    const { updateLeadForEditor } = await import("./lead-edit.server.ts");
    return updateLeadForEditor({ userId: context.userId, newsroomId: owned(context) }, data);
  });

/**
 * Unit AK item 5: the two Compare-view presses that are not a kill.
 *
 * "Not a duplicate — move to New" clears the link the scanner filed the lead
 * with, so the lead stops claiming a twin and stops sitting in Held for a
 * question the editor has just answered. "Newer facts — reopen the old one"
 * puts the KILLED lead it was linked to back on the desk as New, because the
 * finding carried facts the killed lead did not have and the story is live
 * again. Neither press deletes anything: the kill record on the old lead
 * stays, and `killRecordLine` says on its page that the kill was undone
 * rather than letting it disappear.
 *
 * Both are scoped to the newsroom twice over -- the lead being resolved, and
 * the prior lead it points at -- so a link that crosses newsrooms (which the
 * schema does not allow, but which a stale row could still carry) can only
 * ever touch this newsroom's rows.
 */
export const resolveLeadDuplicate = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => leadDuplicateResolutionInput.parse(input))
  .handler(async ({ context, data }) => {
    const { resolveLeadDuplicateForEditor } = await import("./lead-lifecycle.ts");
    return resolveLeadDuplicateForEditor(await getSql(), { userId: context.userId, newsroomId: owned(context) }, data);
  });

export {
  ensureFollowUpsSchema,
  performListFollowUps,
  performCreateAiFollowUp,
  performUpdateAiFollowUp,
  performFollowUpAction,
  performListFollowUpFindings,
} from "./follow-ups.ts";
import {
  performListFollowUps as _performListFollowUps,
  performCreateAiFollowUp as _performCreateAiFollowUp,
  performUpdateAiFollowUp as _performUpdateAiFollowUp,
  performFollowUpAction as _performFollowUpAction,
  performListFollowUpFindings as _performListFollowUpFindings,
} from "./follow-ups.ts";
// Type-only, so `follow-up-scheduler.ts` (and the agents behind it) is not
// pulled into any bundle that imports `desk.ts`. The runtime import is inside
// the `run-now` handler above, which is the only place it is needed.
import type { FollowUpRunStart } from "./follow-up-scheduler.ts";

/**
 * The one list read, and it is agent-only (`performListFollowUps` filters on
 * `agent_kind is not null`). `createFollowUp`, `recordFollowUpReply`,
 * `nudgeFollowUp` and `dropFollowUp` were here until 0.6.81 (unit CU) and are
 * gone with the manual workflow they served -- see the note in
 * ./follow-ups.ts where their `perform*` bodies were. Nothing calls them: the
 * three screens that used to are on the agent half below.
 */
export const listFollowUps = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  // `input ?? {}` is preserved by the schema: listing with no filter is real.
  .validator((input: unknown) => followUpsInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await _performListFollowUps(context, data);
    } catch (err) {
      // The desk rail (desk.index.tsx) and the story page's follow-up block
      // (desk.story.$leadId.tsx) both render a plain notice instead of
      // crashing when this throws -- log once here so the cause is on
      // record, since the client only ever sees "could not be loaded".
      console.error("listFollowUps failed:", err);
      throw err;
    }
  });

/* ==========================================================================
   Redesign phase 6 (lane 2): the AI follow-ups.

   What only an agent row needs -- being made, being edited, being moved through
   the states its cards offer, and the findings query the Today rail mounts. The
   list they are drawn from is the one `listFollowUps` above.
   ========================================================================== */

export const createAiFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => aiFollowUpInput.parse(input))
  .handler(async ({ context, data }) => {
    /*
      SG1 / Option A: an AI follow-up is an agent that will spend a model and
      search the web for this paper on its own clock. An install that has not
      been set up has no town for it to work, so it is not created at all.
    */
    const warning = await paperSetupWarning(context, data.override, "start a follow-up");
    if (warning) return warning;
    return _performCreateAiFollowUp(context, data);
  });

export const updateAiFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => aiFollowUpUpdateInput.parse(input))
  .handler(async ({ context, data }) => _performUpdateAiFollowUp(context, data));

/**
 * Why a "Run now" press did not start: one sentence per fence, and no silent
 * no-op. The two fences are the brief's rule ("one at a time, never beside a
 * running draft") and the third is a card that has been ended -- Stop has to
 * mean stop, and Resume is the way back.
 */
const RUN_START_REFUSALS: Record<NonNullable<FollowUpRunStart["skipped"]>, string> = {
  "draft-running":
    "A draft is being written right now. Follow-ups run one at a time and never alongside a draft — try again once it finishes.",
  "follow-up-running":
    "Another follow-up is already running. They run one at a time — try again once it finishes.",
  "not-found": "That follow-up is gone.",
  "not-active": "That follow-up has been stopped or finished. Resume it first if you want it to run again.",
};

/**
 * The card's action buttons, and the one that press-starts a run.
 *
 * Pause, Resume, Stop and Done are status writes and nothing else -- they move
 * the row, and the scheduler picks it up from there. "Run now" / "Retry now" is
 * different: it goes through `startFollowUpRun` (./follow-up-scheduler.ts),
 * which is the same path the clock uses, including both fences and the same
 * queued `follow-up` job. A run started by a press is therefore indistinguishable
 * from one the clock started, in the queue and in the row, and the card's inline
 * progress takes over as soon as this returns.
 *
 * The refusals above are thrown rather than returned so the press that could not
 * do anything says why on the card. A returned `{ ok: false }` here would be a
 * button that appears to work.
 */
export const followUpAction = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => followUpActionInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.action !== "run-now") {
      const result = await _performFollowUpAction(context, data.id, data.action);
      if (!result.ok) throw new Error(result.error);
      return { ok: true as const };
    }
    // SG1 / Option A: only the press that STARTS a run spends anything; the
    // other actions are status writes (pause, resume, stop, done) and are not
    // gated, so an editor can always tidy up rows on an un-set-up install.
    const warning = await paperSetupWarning(context, data.override, "run this follow-up");
    if (warning) return warning;
    const { startFollowUpRun } = await import("./follow-up-scheduler.ts");
    const started = await startFollowUpRun(
      { userId: context.userId, newsroomId: context.newsroomId ?? 1 },
      data.id,
    );
    if (!started.started) throw new Error(RUN_START_REFUSALS[started.skipped ?? "not-found"]);
    return { ok: true as const };
  });

/**
 * The findings an editor should see on Today: agent follow-ups that have found
 * something and are still being worked.
 *
 * This is the "surface it on Today" half of the brief's item 4. The other half
 * -- the note in the story's reporting notes -- was written once, by the agent
 * that found it, in `performRecordFollowUpRun`; this reads the state, not the
 * notes, so a finding the editor removed from the notes does not come back.
 * Nothing here publishes, and nothing behind it can: a finding is a note and a
 * `last_state`, and there is no publish path in either.
 */
export const listFollowUpFindings = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => followUpFindingsInput.parse(input))
  .handler(async ({ context, data }) => _performListFollowUpFindings(context, data));

/**
 * What the follow-up dialog's Story picker offers: two columns over the recent
 * leads, newest first.
 *
 * Deliberately NOT `listLeads`. That one returns every lead in the newsroom
 * with twenty columns and a correlated duplicate-lookup per row, because the
 * Queue renders all of it; a `<select>` needs an id and a line of text, and
 * pulling the Queue's payload into a dialog to build it would fetch a screen's
 * worth of data to draw a dropdown. The window is the 200 most recent leads,
 * which is a limit the picker names rather than hides -- an agent linked to an
 * older story keeps that story in its list because the dialog keeps the row's
 * own headline (see `FollowUpDialog`).
 */
export const listFollowUpStoryOptions = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<{ id: number; headline: string }[]> => {
    const sql = await getSql();
    const room = context.newsroomId ?? 1;
    return sql<{ id: number; headline: string }>`
      select l.id,
             coalesce(a.headline, (select nullif(d.headline, '') from drafts d
               where d.lead_id = l.id and d.newsroom_id = l.newsroom_id
               order by d.updated_at desc, d.id desc limit 1), l.headline) as headline
      from leads l
      left join articles a on a.lead_id = l.id and a.newsroom_id = l.newsroom_id
      where l.newsroom_id = ${room} and l.status <> 'killed'
      order by l.created_at desc, l.id desc
      limit 200
    `;
  });

/**
 * The section the story files under, confirmed by a person for this draft.
 *
 * The classifier picks a section while nobody is looking, the workbench shows
 * it as a select, and publishing used to print whatever the select happened to
 * say. Two live stories filed a cat-rescue fundraiser under Budget and an LPM
 * staffing change under Schools that way. The desk now makes an editor read the
 * section and say yes to it, and this is where that yes is recorded.
 *
 * It is recorded against `evidenceReviewToken(draft)` -- the same identity the
 * publish transaction uses to mean "this exact draft" -- so confirming a
 * section and then rewriting the story does not carry: the confirmation is for
 * the version that was read.
 */
export async function performConfirmDraftTopic(
  context: { userId: string; newsroomId?: number },
  leadId: number,
): Promise<{ ok: true; topic: string } | { ok: false; error: string }> {
  return withTransaction(async (sql) => {
    const rows = await sql<{ notes_json: string | null }>`
      select notes_json from leads
      where id = ${leadId} and newsroom_id = ${owned(context)} for update
    `;
    if (!rows[0]) return { ok: false as const, error: "Lead not found" };
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    const row = drafts[0];
    if (!row) return { ok: false as const, error: "Draft this lead before confirming its section." };
    const topic = String(row.topic ?? "").trim();
    if (!topic) {
      return {
        ok: false as const,
        error: "This draft has no section yet. Choose one, save the draft, then confirm it.",
      };
    }
    const notes = parseNotes(rows[0].notes_json);
    notes.topicConfirmation = {
      topic,
      token: topicConfirmationFingerprint(evidenceReviewToken(row)),
      at: new Date().toISOString(),
    };
    /*
      A lead the scan filed under a section the MODEL never chose stops being
      that the moment an editor confirms the section on this draft: from here
      the section is a decision somebody made and read the story under. The
      column is cleared in the same statement as the confirmation record, so
      the Queue chip and the story-page notice cannot outlive the decision.
    */
    await sql`
      update leads set notes_json = ${packNotes(notes)}, topic_unchosen = false
      where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const, topic };
  });
}

export const confirmDraftTopic = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((leadId: unknown) => rowId.parse(leadId))
  .handler(async ({ context, data: leadId }) => performConfirmDraftTopic(context, leadId));

/**
 * THE REVIEW THIS GATE READS, through one seam so a test can make it fail
 * (unit U24b). Same pattern as `PerformScanWorkDeps` and `PerformDraftWorkDeps`.
 */
export type UnreviewedClaimDeps = {
  loadReview?: (newsroomId: number, leadId: number) => Promise<{
    rows: readonly FindingEvidenceRow[];
    claimRows: readonly ClaimEvidenceRow[];
    manualClaimRows: readonly ManualClaimEvidenceRow[];
    groundingRows?: readonly DraftGroundingRow[];
    civicReporting?: boolean;
    evidenceToken: string;
  }>;
};

/**
 * The count of claims a draft's own evidence check raised and nobody has
 * answered for (unit U24), for the three gates that must agree: the desk's
 * blocker, `performAcceptUnreviewedClaims` and `performPublish`'s refusal.
 *
 * ONE READER OF THE ONE RULE. It resolves the same review the Checks pane
 * resolves (`loadFindingEvidenceReview`, the query that pane already makes) and
 * counts with `claimsNeedingReview` -- the predicate the pane's `! Needs
 * review` chip is drawn from, contradictions included (U24b). A cheaper count
 * from the memo alone would be the bug this unit exists to fix, one layer
 * down: the pane downgrades a judgment to unreviewed when its binding moved or
 * its record stopped being readable, and a memo-only count cannot see that, so
 * the desk would offer to print something the server then refused with no way
 * to find out why.
 *
 * ── IT FAILS CLOSED (UNIT U24b) ────────────────────────────────────────────
 *
 * U24 wrapped the whole thing in a bare `catch { return 0 }`, so ANY failure --
 * including a transient database error -- read as "nothing outstanding" and
 * opened the gate for the length of the outage. A truthfulness gate must not
 * answer "nothing to see" when what happened is "I could not look".
 *
 * So exactly one error class is swallowed, by name: the unreadable-stored-
 * findings error (`isUnreadableFindingsError`), which is the case where there
 * is genuinely no review to count and the Checks pane already shows those rows
 * as unreadable. Everything else -- a dead connection, a missing table, a draft
 * that vanished mid-request -- propagates, and the caller refuses the publish
 * in words a person can read (`PUBLISH_COULD_NOT_CHECK`).
 */
export async function unreviewedClaimsGate(
  newsroomId: number,
  leadId: number,
  deps: UnreviewedClaimDeps = {},
): Promise<{ outstanding: number; evidenceToken: string; recordedClaims: number }> {
  const { claimsNeedingReview } = await import("./evidence-check-state.ts");
  const load =
    deps.loadReview ??
    (async (room: number, lead: number) => {
      const { loadFindingEvidenceReview } = await import("./finding-evidence-review.ts");
      return loadFindingEvidenceReview(await getSql(), room, lead);
    });
  let review;
  try {
    review = await load(newsroomId, leadId);
  } catch (error) {
    const { isUnreadableFindingsError } = await import("./finding-evidence-review.ts");
    if (isUnreadableFindingsError(error)) return { outstanding: 0, evidenceToken: "", recordedClaims: 0 };
    throw error;
  }
  return {
    outstanding: claimsNeedingReview(
      review.rows,
      review.claimRows,
      review.manualClaimRows,
      review.groundingRows ?? [],
      review.civicReporting ?? false,
    ),
    evidenceToken: review.evidenceToken,
    /*
      Unit ZC: the claims the run actually RECORDED -- findings and reported and
      manual claims, judged or not. The grounding rows are DETECTED specifics
      (a date or a vote the audit flagged), not claims the check raised; a draft
      with a flagged specific and no recorded claim is exactly the zero-claims
      state this gate exists for, so they are deliberately not counted here.
    */
    recordedClaims: review.rows.length + review.claimRows.length + review.manualClaimRows.length,
  };
}

/** The count alone, for the callers that only need the number. */
export async function unreviewedClaimCount(
  newsroomId: number,
  leadId: number,
  deps: UnreviewedClaimDeps = {},
): Promise<number> {
  return (await unreviewedClaimsGate(newsroomId, leadId, deps)).outstanding;
}

/** The draft a lead's gate reads, in the column order every reader uses. */
async function latestDraftForLead(newsroomId: number, leadId: number): Promise<DraftRow | undefined> {
  const [row] = await getSql().then((sql) =>
    sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${newsroomId}
      order by updated_at desc, id desc limit 1
    `);
  return row;
}

/**
 * UNIT ZC -- THE ZERO-RECORDED-CLAIMS GATE, decided once on the server.
 *
 * The evidence check's own output (`draft.found_note`, `reportedClaims`,
 * `manualClaims` through `unreviewedClaimsGate`) counts how many claims the run
 * raised. When that is zero AND no completed check covers this version AND the
 * body carries a fact a person would check, the story is unchecked, not clear.
 * The decision is `uncheckedStoryNeedsCheck`, the same pure function the desk
 * and the readiness chip use, so the server's refusal and the page agree.
 *
 * The acknowledgement is read from `leads.notes_json`, against
 * `topicConfirmationFingerprint(evidenceReviewToken(draft))`: an edit moves the
 * token and takes the acknowledgement back, exactly like the section
 * confirmation and the unreviewed-claims acceptance beside it.
 */
export async function uncheckedStoryGate(
  newsroomId: number,
  leadId: number,
  deps: UnreviewedClaimDeps = {},
): Promise<{ blocked: boolean; reason: string; evidenceToken: string }> {
  const review = await unreviewedClaimsGate(newsroomId, leadId, deps);
  const draft = await latestDraftForLead(newsroomId, leadId);
  if (!draft) return { blocked: false, reason: "", evidenceToken: review.evidenceToken };
  const identity = topicConfirmationFingerprint(evidenceReviewToken(draft));
  const [lead] = await getSql().then((sql) =>
    sql<{ notes_json: string | null }>`
      select notes_json from leads where id = ${leadId} and newsroom_id = ${newsroomId} limit 1
    `);
  const acknowledged = parseNotes(lead?.notes_json).uncheckedStoryConfirmation?.token === identity;
  const exempt = draft.form === "editorial";
  const decision = uncheckedStoryNeedsCheck({
    recordedClaims: review.recordedClaims,
    evidenceCheckedCurrentVersion: evidenceCheckCoversCurrentVersion(draft),
    body: stripReporterNotebook(draft.body ?? ""),
    acknowledgedForVersion: acknowledged,
    exempt,
  });
  /* The acknowledgement press carries the DRAFT identity the page holds
     (`evidenceReviewToken(draft)`), which is what `performAcknowledgeUnchecked`
     compares against its locked row. */
  return { ...decision, evidenceToken: evidenceReviewToken(draft) };
}

/**
 * What the desk says when the evidence review could not be read at all (U24b).
 *
 * A publish refused for this reason is refused for a reason that has nothing to
 * do with the story, so it says so plainly and points at the retry rather than
 * printing a driver error at the editor.
 */
const PUBLISH_COULD_NOT_CHECK =
  "The desk could not read this draft's evidence review just now, so nothing was published. Try again in a moment.";

/** The same sentence for the acceptance press, which the same failure refuses. */
const ACCEPT_COULD_NOT_CHECK =
  "The desk could not read this draft's evidence review just now, so nothing was recorded. Try again in a moment.";

/**
 * "Publish anyway -- I accept these claims are unreviewed" (unit U24).
 *
 * The override for the one blocker the desk refuses to leave silent: a draft
 * going to paper with claims its own evidence check raised and no person has
 * judged. This writes the acceptance against `evidenceReviewToken(draft)` --
 * the identity the section confirmation uses, so it is for the version the
 * editor was looking at and an edit takes it back -- and one `audit_events`
 * row naming who accepted, when, and how many claims.
 *
 * The count is recomputed here rather than taken from the client, and the
 * press is refused if there is nothing left to accept: an acceptance recorded
 * over a draft with no unreviewed claims would be a permission that outlives
 * the thing it was about.
 */
export async function performAcceptUnreviewedClaims(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  /*
    The review token the editor's screen was holding (unit U24b). Compared
    against the review resolved HERE, the same way every judgment save compares
    its token: an acceptance is "I read these claims", so one recorded against
    a review that has moved since is refused rather than stored. Empty means
    the press did not carry one (a stale client), which is also a refusal.
  */
  evidenceToken: string,
  deps: UnreviewedClaimDeps = {},
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  let gate: { outstanding: number; evidenceToken: string };
  try {
    gate = await unreviewedClaimsGate(owned(context), leadId, deps);
  } catch {
    /* Unit U24b: fail closed, in words. Recording an acceptance over a review
       nobody could read would be the widest possible version of this bug. */
    return { ok: false as const, error: ACCEPT_COULD_NOT_CHECK };
  }
  const count = gate.outstanding;
  if (count === 0) {
    return {
      ok: false as const,
      error: "There is nothing to accept: every claim the evidence check raised has been reviewed.",
    };
  }
  /*
    Unit U24b: the press carried the review the editor was looking at. A review
    that has moved since -- a judgment saved in another tab, a claim edited, the
    draft rewritten -- is not the one they read, so nothing is recorded.
  */
  if (!evidenceToken || evidenceToken !== gate.evidenceToken) {
    return {
      ok: false as const,
      error:
        "The draft or its evidence review changed since this page was drawn, so nothing was accepted. Reload the story and look at the claims again.",
    };
  }
  const result = await withTransaction(async (sql) => {
    const rows = await sql<{ notes_json: string | null }>`
      select notes_json from leads
      where id = ${leadId} and newsroom_id = ${owned(context)} for update
    `;
    if (!rows[0]) return { ok: false as const, error: "Lead not found" };
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    const row = drafts[0];
    if (!row) return { ok: false as const, error: "There is no draft to accept anything for." };
    const notes = parseNotes(rows[0].notes_json);
    notes.unreviewedClaimsConfirmation = {
      count,
      token: topicConfirmationFingerprint(evidenceReviewToken(row)),
      at: new Date().toISOString(),
      by: context.userId,
    };
    await sql`
      update leads set notes_json = ${packNotes(notes)}
      where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const, count };
  });
  if (!result.ok) return result;
  /*
    Audited outside the transaction, where the rest of the publish path's
    audits sit: `audit` writes on the pooled connection, and on PGlite there is
    one connection, so writing from inside a transaction deadlocks it.
  */
  await audit(
    context.userId,
    "accept_unreviewed_claims",
    `Lead ${leadId}: ${count} unreviewed claim${count === 1 ? "" : "s"} accepted for this draft`,
    owned(context),
    { kind: "leads", id: leadId },
  );
  return result;
}

export const acceptUnreviewedClaims = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => acceptUnreviewedClaimsInput.parse(input))
  .handler(async ({ context, data }) =>
    performAcceptUnreviewedClaims(context, data.leadId, data.evidenceToken),
  );

/**
 * "I checked this story myself" (unit ZC).
 *
 * The second honest answer to the zero-claims gate: the editor read a body with
 * a checkable fact in it against their own sources. The press carries the DRAFT
 * identity the page was holding (`data.evidenceToken`); the server compares it
 * against the locked current draft's `evidenceReviewToken`, so a stale tab
 * cannot acknowledge a version it never saw, and an edit takes the
 * acknowledgement back. It writes `leads.notes_json.uncheckedStoryConfirmation`
 * (who, when, which version) and one `audit_events` row.
 */
export async function performAcknowledgeUnchecked(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  evidenceToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  /*
    The gate is computed BEFORE the transaction, where the pooled connection and
    the review load live (a `getSql()` read inside the PGlite transaction
    deadlocks it). It only accepts a press when the zero-claims gate is LIVE for
    this lead: a draft with recorded claims, or with a completed check, or with
    an already-recorded acknowledgement has nothing to acknowledge.
  */
  let gate: { blocked: boolean; reason: string; evidenceToken: string };
  try {
    gate = await uncheckedStoryGate(owned(context), leadId);
  } catch {
    return { ok: false as const, error: ACCEPT_COULD_NOT_CHECK };
  }
  if (!gate.blocked) return { ok: false as const, error: gate.reason || "There is nothing to check here." };
  const result = await withTransaction(async (sql) => {
    const rows = await sql<{ notes_json: string | null }>`
      select notes_json from leads
      where id = ${leadId} and newsroom_id = ${owned(context)} for update
    `;
    if (!rows[0]) return { ok: false as const, error: "Lead not found" };
    const [row] = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    if (!row) return { ok: false as const, error: "There is no draft to acknowledge anything for." };
    /* The editor's screen carried the draft it was reading. A stale tab must not
       acknowledge words it never saw. */
    if (!evidenceToken || evidenceToken !== evidenceReviewToken(row)) {
      return {
        ok: false as const,
        error:
          "The draft changed since this page was drawn, so nothing was acknowledged. Reload the story and read it again.",
      };
    }
    const notes = parseNotes(rows[0].notes_json);
    notes.uncheckedStoryConfirmation = {
      token: topicConfirmationFingerprint(evidenceReviewToken(row)),
      at: new Date().toISOString(),
      by: context.userId,
    };
    await sql`
      update leads set notes_json = ${packNotes(notes)}
      where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const };
  });
  if (!result.ok) return result;
  await audit(
    context.userId,
    "publish-unchecked-acknowledged",
    `Lead ${leadId}: editor confirmed they checked this story against their sources`,
    owned(context),
    { kind: "leads", id: leadId },
  );
  return result;
}

export const acknowledgeUncheckedStory = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => acknowledgeUncheckedInput.parse(input))
  .handler(async ({ context, data }) =>
    performAcknowledgeUnchecked(context, data.leadId, data.evidenceToken),
  );

/**
 * The titles a reader will see on this draft's Sources list.
 *
 * Two places hold them. The draft's own provenance is what the page prints for
 * each captured record, and the newsroom's source list is where an operator
 * typed the name of the outlet they were reading. Either one naming the outlet
 * is enough: the first is what the reader is shown, the second is what the
 * editor was looking at when they filed the source.
 */
async function sourceTitlesForDraft(
  sql: Sql,
  newsroomId: number,
  draft: { source_urls: string; provenance_json?: string | null },
): Promise<string[]> {
  const urls = parseUrlList(draft.source_urls);
  const titles: string[] = [];
  try {
    const stored = JSON.parse(draft.provenance_json || "[]") as { title?: string; url?: string }[];
    // Only entries the public list actually shows: a provenance row dropped
    // from Sources is not a source the reader can check.
    if (Array.isArray(stored)) {
      for (const item of stored) {
        if (item?.url && !urls.includes(item.url)) continue;
        const title = String(item?.title ?? "").trim();
        if (title) titles.push(title);
      }
    }
  } catch {
    /* a draft whose provenance will not parse has no titles to offer */
  }
  if (urls.length) {
    const rows = await sql<{ title: string }>`
      select title from sources where newsroom_id = ${newsroomId} and url = any(${urls})
    `;
    for (const r of rows) if (r.title) titles.push(r.title);
  }
  return titles;
}

export type NamedOutletReport = {
  /** Outlets the body names that the Sources do not show, and no one has overridden. */
  namedOutlets: string[];
  /** The overrides already recorded for this draft, oldest first. */
  overrides: { outlet: string; overridden_by: string; overridden_at: string }[];
};

/**
 * What the desk shows about the named-outlet check, for one lead.
 *
 * `performPublish` is the gate; this asks the same question for display, from
 * the same helper and the same inputs -- the body as it prints, the Sources
 * the reader will see (including the lead's, for a legacy draft that inherits
 * them), and the overrides recorded for this draft. The desk and the refusal
 * therefore cannot disagree about what is outstanding: a button the editor
 * cannot press, or a refusal with nothing on screen to fix it, would both be
 * the same bug wearing a different coat.
 *
 * It is a plain function rather than part of the story loader so that the
 * desk's half of the check can be driven in a test without a browser.
 */
export async function performNamedOutletReport(
  context: { userId: string; newsroomId?: number },
  leadId: number,
): Promise<NamedOutletReport> {
  const sql = await getSql();
  const drafts = await sql<DraftRow>`
    select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
           provenance_json, form, found_note, unanswered, research_json
    from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
    order by updated_at desc, id desc limit 1
  `;
  const row = drafts[0];
  if (!row) return { namedOutlets: [], overrides: [] };
  const draft = unpackStoredDraft({ ...row });
  draft.body = stripReporterNotebook(draft.body);
  let sourceUrls = parseUrlList(draft.source_urls);
  if (sourceUrls.length === 0 && mayInheritLeadSources(row)) {
    const leads = await sql<{ source_urls: string }>`
      select source_urls from leads
      where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
    `;
    sourceUrls = sanitizePublicUrls(parseUrlList(leads[0]?.source_urls ?? "[]"));
  }
  const overrides = await sql<{
    outlet: string;
    overridden_by: string;
    overridden_at: string;
  }>`
    select outlet, overridden_by, overridden_at from named_outlet_overrides
    where newsroom_id = ${owned(context)} and draft_id = ${Number(row.id)}
    order by id
  `;
  return {
    namedOutlets: unresolvedNamedOutlets({
      body: draft.body,
      sourceUrls,
      sourceTitles: await sourceTitlesForDraft(sql, owned(context), draft),
      overridden: overrides.map((o) => o.outlet),
      outlets: (await getPaperConfig(owned(context))).namedOutlets,
    }),
    overrides,
  };
}

/*
  THE NAMED-OUTLET OVERRIDE (0.6.62).

  An editor can clear one named-and-uncovered outlet for one draft, and this is
  the only way past the publish gate below. The row it writes is the paper's
  record of the decision: who accepted the claim, when, for which outlet, on
  which draft. The desk shows it back; the public page never does.

  It refuses to record an override the draft does not need when the outlet is
  one this paper TRACKS -- a tracked outlet the story never names, or one its
  Sources already cover (`namedOutlet` resolves it). An outlet the paper does
  NOT track cannot be checked that way, so an explicit instruction to override
  one is recorded rather than refused. A row saying an editor overrode
  something is worth less than nothing if it can be created for a claim the
  editor never saw; but refusing the legitimate override is worse.
*/
export async function performOverrideNamedOutlet(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  outletName: string,
  input: { override?: string[] } = {},
): Promise<{ ok: true; outlet: string } | { ok: false; error: string } | OverrideWarning> {
  const room = owned(context);
  const name = outletName.trim();
  if (!name) return { ok: false as const, error: "Name the outlet you are overriding." };
  const outlets = (await getPaperConfig(room)).namedOutlets;
  const outlet = namedOutlet(name, outlets);

  const key = `named-outlet:${name}`;
  const decision = await withTransaction(async (sql) => {
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${room}
      order by updated_at desc, id desc limit 1
    `;
    const row = drafts[0];
    if (!row) return { ok: false as const, error: "Draft this lead before overriding an outlet." };
    const warning = outlet ? null : checkOverride(input, key,
      `"${name}" is not one of the outlets this check knows about. Override it to record your decision?`);
    if (warning) return warning;
    // Clicking twice is the same decision. The table is append-only, so the
    // second click must not try to write over the first row.
    await sql`
      insert into named_outlet_overrides (newsroom_id, draft_id, lead_id, outlet, overridden_by)
      values (${room}, ${row.id}, ${leadId}, ${outlet ? outlet.name : name}, ${context.userId})
      on conflict (newsroom_id, draft_id, outlet) do nothing
    `;
    return {
      ok: true as const,
      outlet: outlet ? outlet.name : name,
      draftId: Number(row.id),
      /** Whether the name came off the newsroom's own list or was accepted by override. */
      known: Boolean(outlet),
    };
  });
  if (!decision.ok) {
    // An unknown outlet's first press is a warning, not a refusal.
    if ("warning" in decision) return decision;
    return { ok: false as const, error: decision.error };
  }

  await auditOverrides({userId: context.userId, newsroomId: room}, [key], {kind: "drafts", id: decision.draftId});
  return { ok: true as const, outlet: decision.outlet };
}

/**
 * `overrideNamedOutlet`'s input, read here rather than in `request-input.ts`
 * (another worker owns that file). The base shape is the same `outletInput`; the
 * new `override` key is added on top, bounded like every other desk input.
  */
export function outletOverrideInput(raw: unknown): {
  leadId: number;
  outlet: string;
  override?: string[];
} {
  const base = outletInput.parse(raw);
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { ...base, override: cleanOverrideKeys(o.override) };
}

export const overrideNamedOutlet = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: unknown) => outletOverrideInput(data))
  .handler(async ({ context, data }) =>
    performOverrideNamedOutlet(context, data.leadId, data.outlet, { override: data.override }),
  );

export const performPublish = createServerOnlyFn(async function performPublish(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  /*
    The section the editor saw on the button they pressed (0.6.67).

    The desk used to make a person confirm the section with a second button and
    then publish with a first, and any text edit reset the confirmation -- so the
    two could disagree and the editor was nagged about a section they had
    already read. Publish now carries the section it printed on its face, and
    pressing it IS the confirmation: `performPublish` records the confirmation
    for this exact draft version in the same transaction that prints it.

    Absent means "no section was shown to me" -- a scripted call, or a client
    from before this release -- and then the gate falls back to the stored
    confirmation exactly as it did in 0.6.62. A section that is present but does
    not match the draft's own is refused outright rather than confirmed: that is
    the case where the editor pressed a button naming a section this draft does
    not file under, and printing either one on their behalf would be a guess.
  */
  sectionFromEditor?: string,
  /*
    The ground this story stands on, as the editor chose it on the publish step
    (0.6.71). One of the four keys the paper's geography pills read, or absent.

    Absent is not an error and is not a second decision to make: it means no
    area was shown to the editor, and a story with no recorded area reads as the
    home town -- the owner's rule (2026-09-26) and the same fallback every story
    printed before 0098 gets. So a scripted call, an older client and "the
    editor left the select alone" all land on the home town rather than refusing
    the print. A value that is not one of the four keys is dropped for the same
    reason the clean-up helper drops it: the column is not the place to discover
    a typo.
  */
  areaFromEditor?: string,
  /*
    Test seam only, same shape as `PerformScanWorkDeps`: `loadReview` replaces
    the one read the claims gate makes, so a test can make it fail and prove the
    publish refuses rather than opening on an error it could not read (unit
    U24b). Production passes nothing.
  */
  deps: UnreviewedClaimDeps = {},
  /*
    THE KEYS THE EDITOR HAS ACKNOWLEDGED (PR233).

    Every WARNING this gate raises can be overridden by an editor who says so in
    so many words -- the request carries the warning keys they ticked. The keys
    are only ever COMPARED against the warnings the server recomputes here, for
    this exact draft, while holding the publish fence: a key that names no
    current warning is not an override and is not audited.

    The parameter is the SIXTH, after `deps`, so every older caller -- and every
    test written against the old shape -- still compiles and behaves.

    An empty list is the ordinary print: every warning refuses. A list that
    names a current warning lets it through, and writes one audit row per
    warning let through (see `publish-override.server.ts`).
  */
  acknowledgedWarningKeys: readonly string[] = [],
): Promise<
  | { ok: true; slug: string }
  | {
      ok: false;
      error: string;
      warnings?: { key: string; sentence: string }[];
      /* A hard refusal is NOT a warning: it carries the key of the true
         impossibility (empty headline/body, no draft, a running check) so the
         UI can treat it as a wall, not a checkbox. */
      hard?: string;
    }
> {
  const { withCurrentDraftForPublish } = await import("./draft-order.server.ts");
  const { acknowledgedWarnings, auditPublishOverrides } =
    await import("./publish-override.server.ts");
  const { ensureAuditEventsSchema } = await import("./ops.ts");
  /*
    The audit schema is DDL and cannot run inside the publish transaction, so it
    is ensured here, before any work -- exactly as `audit()` would have done,
    except that it now happens once for the whole publish rather than per row.
  */
  await ensureAuditEventsSchema();
  const sql = await getSql();
  const already = await sql<{ slug: string }>`
      select slug from articles
      where lead_id = ${leadId} and newsroom_id = ${owned(context)} and status = 'published'
      limit 1
    `;
  if (already[0]) return { ok: true as const, slug: already[0].slug };

  const leads = await sql<LeadRow>`
      select id, headline, why, topic, status, source_urls, evidence, newsworthiness, created_at
      from leads where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
    `;
  const lead = leads[0];
  if (!lead) return { ok: false as const, error: "Lead not found" };

  /*
    THE WARNINGS THIS PRINT WOULD RAISE, AGAINST THE DRAFT AS IT STANDS NOW
    (PR233).

    Every policy the desk keeps is a WARNING here, not a wall: an editor who
    says in so many words that they have read it and are printing anyway gets
    through, and the print leaves a record of who said so and for which draft.

    Two kinds of thing are NOT warnings and are never overridable, because no
    editor can make them true by acknowledging them:

      - the true IMPOSSIBILITIES (empty headline, empty body after the
        reporter's notebook is stripped, a draft that does not exist), and
      - the transient LOCK-LIKE gates the desk cannot print through (an evidence
        check job that is queued or running).

    The whole list is recomputed INSIDE the publish transaction below, against
    the draft the fence actually prints -- so a client that acknowledged
    everything it was shown cannot smuggle a print past a warning that only
    became true afterwards (a tape that moved, a rewrite under the fence). This
    pre-fence read exists only to build the refusal sentence a person reads.
  */
  const preDraftRows = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json, disclosure_text,
             model_topic
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
  const preDraft = preDraftRows[0];
  const acknowledged = new Set(acknowledgedWarningKeys);

  const collectWarnings = async (
    tx: Sql,
    row: DraftRow,
    namedOutlets: NamedOutlet[],
  ): Promise<{
    warnings: { key: string; sentence: string }[];
    hard: { key: string; sentence: string } | null;
    outstandingClaims: number;
    confirmSection: boolean;
    draftTopic: string;
    area: string | null;
    evidence: Awaited<ReturnType<typeof loadMeetingPublishEvidence>> | null;
  }> => {
    const draftTopic = String(row.topic ?? "").trim();
    const area = cleanStoryArea(areaFromEditor);
    const editorTopic = String(sectionFromEditor ?? "").trim();
    const warnings: { key: string; sentence: string }[] = [];

    /*
      THE TRUE IMPOSSIBILITIES. These are checked first and returned as `hard`:
      the caller refuses them whatever the editor acknowledged, because no
      acknowledgement can fill a headline or a body.
    */
    const draft = unpackStoredDraft({ ...row });
    draft.body = stripReporterNotebook(draft.body);
    if (!String(draft.headline ?? "").trim()) {
      return {
        warnings,
        hard: { key: "headline", sentence: "The headline is empty, so there is nothing to print." },
        outstandingClaims: 0,
        confirmSection: false,
        draftTopic,
        area,
        evidence: null,
      };
    }
    if (!String(draft.body ?? "").trim()) {
      return {
        warnings,
        hard: { key: "body", sentence: "The story body is empty." },
        outstandingClaims: 0,
        confirmSection: false,
        draftTopic,
        area,
        evidence: null,
      };
    }

    /* The evidence-review READ failing is a warning (unable to read judgments),
       not a wall: an editor may print past it once they say so. */
    let outstandingClaims = 0;
    let recordedClaims = 0;
    let reviewReadFailed = false;
    try {
      const gate = await unreviewedClaimsGate(owned(context), leadId, {
        ...deps,
        loadReview:
          deps.loadReview ??
          (async (room: number, lead: number) => {
            const { loadFindingEvidenceReview } = await import("./finding-evidence-review.ts");
            return loadFindingEvidenceReview(tx, room, lead);
          }),
      });
      outstandingClaims = gate.outstanding;
      recordedClaims = gate.recordedClaims;
    } catch {
      reviewReadFailed = true;
      warnings.push({ key: "evidence-loading", sentence: PUBLISH_COULD_NOT_CHECK });
    }

    const notes = parseNotes(
      (
        await tx<{ notes_json: string | null }>`
          select notes_json from leads where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
        `
      )[0]?.notes_json,
    );

    if (!reviewReadFailed && uncheckedStoryNeedsCheck({
      recordedClaims,
      evidenceCheckedCurrentVersion: evidenceCheckCoversCurrentVersion(row),
      body: draft.body,
      acknowledgedForVersion: evidenceConfirmationMatches(notes.uncheckedStoryConfirmation?.token, row),
      exempt: row.form === "editorial",
    }).blocked) warnings.push({ key: "unchecked", sentence: UNCHECKED_STORY_REASON });

    if (!draft.dek || !draft.dek.trim()) {
      warnings.push({
        key: "dek",
        sentence: "Add a dek, the one-line summary under the headline, before you publish.",
      });
    }

    const openClaims = uncheckedGateTodos(notes);
    if (openClaims.length) {
      warnings.push({
        key: "claims",
        sentence:
          openClaims.length === 1
          ? "Confirm the claim of absence first — open the city's own site, check the story is right that the document is not there, then tick it in reporting notes."
          : `Confirm the ${openClaims.length} claims of absence first — open the city's own site, check the story is right that those documents are not there, then tick them in reporting notes.`,
    });
  }

    if (!reviewReadFailed && outstandingClaims > 0) {
      const acceptance = notes.unreviewedClaimsConfirmation;
      const acceptedForThisDraft =
      evidenceConfirmationMatches(acceptance?.token, row);
      const accepted = acceptedForThisDraft && (acceptance?.count ?? 0) >= outstandingClaims;
      if (!accepted) {
        const short = acceptedForThisDraft ? (acceptance?.count ?? 0) : 0;
        warnings.push({
          key: "claims-unreviewed",
          sentence: `${outstandingClaims} claim${
          outstandingClaims === 1 ? "" : "s"
        } from the evidence check ${
          outstandingClaims === 1 ? "has" : "have"
        } not been reviewed${
          short > 0
            ? ` (you accepted ${short}, and ${
                outstandingClaims - short
              } more ${outstandingClaims - short === 1 ? "is" : "are"} outstanding now)`
            : ""
        }. Review them in the workbench, or accept them explicitly to print anyway.`,
      });
    }
  }

    if (evidenceNeedsReview(row, row.body)) {
      warnings.push({
        key: "evidence-stale",
        sentence:
          "The story changed after its evidence was gathered. Review the evidence in the workbench before publishing.",
      });
    }

    /*
      THE SECTION. A supplied section that MATCHES the draft is the editor's own
      confirmation and needs no warning. A supply that does not match, or no
      supply with no stored confirmation for this version, is a section warning.
    */
    const confirmedTopic = notes.topicConfirmation;
  const confirmSection = Boolean(editorTopic) && editorTopic === draftTopic;
  if (editorTopic && editorTopic !== draftTopic) {
      warnings.push({
        key: "section",
        sentence: `This story files under "${draftTopic || "no section"}", and the button said "${editorTopic}". Reload the story, check the section, then publish again.`,
    });
  } else if (
    !confirmSection &&
    (!confirmedTopic ||
      confirmedTopic.topic !== draftTopic ||
      !evidenceConfirmationMatches(confirmedTopic.token, row))
  ) {
      warnings.push({
        key: "section",
        sentence: `This draft files under "${draftTopic || "no section"}", and no editor has confirmed that for the version being printed. Open the story, check the section, and publish from there.`,
    });
  }

    /*
      Legacy/manual drafts with no sources may fall back to their lead's. This is
      the same fallback the article print uses below, so the outlet check judges
      the list the reader will actually see.
    */
    if (parseUrlList(draft.source_urls).length === 0 && mayInheritLeadSources(row)) {
    const inherited = sanitizePublicUrls(
        parseUrlList(
      (
            await tx<{ source_urls: string }>`
              select source_urls from leads
              where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
            `
          )[0]?.source_urls ?? "[]",
        ),
      );
      if (inherited.length > 0) draft.source_urls = JSON.stringify(inherited);
    }

    const outletRows = await tx<{ outlet: string }>`
      select outlet from named_outlet_overrides
    where newsroom_id = ${owned(context)} and draft_id = ${row.id}
    `;
    const unresolvedOutlets = unresolvedNamedOutlets({
      body: draft.body,
      sourceUrls: parseUrlList(draft.source_urls),
      sourceTitles: await sourceTitlesForDraft(tx, owned(context), draft),
      overridden: outletRows.map((r) => r.outlet),
      outlets: namedOutlets,
    });
    for (const outlet of unresolvedOutlets) {
      warnings.push({
        key: `outlet:${outlet}`,
        sentence: namedOutletNotice([outlet]),
      });
    }

    /* AI readiness is a cached claim tally, already covered by the live
       claims-unreviewed warning above. The page uses that live review too;
       adding the old memo under a second key would refuse Publish anyway.
       Other readiness memos remain warnings, and package holds are recomputed
       below independently. The live reconcile job remains a hard gate. */
    const readiness = savedStoryReadiness(row.research_json);
    if (!liveClaimsOwnReadiness(row.research_json) && (
      readiness.state === "checking" ||
      readiness.state === "to-check" ||
      readiness.state === "not-ready"
    )) {
      warnings.push({
        key: "readiness",
        sentence:
          readiness.reason ||
          (readiness.state === "checking"
            ? "The AI is still checking this story against the meeting record."
            : "This story is not ready to publish."),
      });
    }

    /*
      ── THE REPORTING PACKAGE'S OWN HELD STORIES (SECTION A, PR233) ──────────

      A civic-reporting run files a package whose `held` list names stories it
      could not run with: a source gap, a correction the run could not retrieve.
      The desk shows these as a readiness hold ("not-ready") even when the saved
      readiness memo says ready -- and the saved memo is not authoritative,
      because a stale tab can hold a memo written before the hold existed.

      So the server recomputes it here, the SAME way the story page does: the
      package's draft must be THIS draft, and the hold's `storyId` must be the
      story this lead was filed as (`storyLeadLinksForRequest`). The held item
      must be `unverified` -- a hold the run later retrieved is not one. This
      dedupes with the `readiness` key above: one warning, the stricter reason.
    */
    const { loadLeadReportingPackage } = await import("./civic-reporting.server.ts");
    const { storyLeadLinksForRequest } = await import("./civic-reporting-commit.server.ts");
    const loaded = await loadLeadReportingPackage(tx, leadId, owned(context));
    if (loaded && loaded.draftId === Number(row.id)) {
      const links = await storyLeadLinksForRequest(tx, loaded.requestId, owned(context));
      const storyId = links.find((link) => link.leadId === leadId)?.storyId;
      const held = (loaded.pkg.held ?? []).filter(
        (item) => item.unverified && (!storyId || item.storyId === storyId),
      );
      if (held.length) {
        const summary = held
          .map(
            (item) =>
              `${String(item.headline ?? "")
                .replace(/\s+/g, " ")
                .slice(0, 70)}${
                item.reason ? `: ${String(item.reason).replace(/\s+/g, " ").slice(0, 120)}` : ""
              }`,
          )
          .join("; ");
        const existing = warnings.find((w) => w.key === "readiness");
        const sentence = summary || "A story in this reporting package is still held.";
        if (existing) existing.sentence = sentence;
        else warnings.push({ key: "readiness", sentence });
      }
    }

    /*
      Held and killed leads are warnings now, not walls (PR233). The status is
      re-read HERE, from the transaction, not from the outer pooled read: a lead
      held or killed between the pre-read and this fence must be seen as it now
      is, or a print that only became improper under the fence would slip past.
    */
    const [fencedLead] = await tx<{ status: string | null }>`
      select to_jsonb(leads)->>'status' as status from leads
      where id = ${leadId} and newsroom_id = ${owned(context)} for update
    `;
    if (fencedLead?.status === "held") {
      warnings.push({
        key: "lead-held",
        sentence:
          "This lead is held. Publishing anyway will un-hold it and publish it in one press.",
      });
    }
    if (fencedLead?.status === "killed") {
      warnings.push({
        key: "lead-killed",
        sentence:
          "This lead is killed. Publishing anyway will restore it and publish it in one press.",
      });
    }

    /* The meeting tape check belongs INSIDE the fence: the only place a tape
       that moved after the client looked can be seen. */
    const evidence = await loadMeetingPublishEvidence(tx, {
        newsroomId: owned(context),
        draftId: Number(row.id),
      });
    if (evidence.stale.length) {
      warnings.push({
        key: "meeting-citation-stale",
        sentence: staleCitationNotice(evidence.stale),
      });
    }

    /* The live evidence check job is a hard gate: nothing can print while a
       check the editor is waiting on is still queued or running. The job kind
       is `reconcile` (jobs.ts) and its subject is the DRAFT row. */
    const [liveCheck] = await tx<{ id: number }>`
      select id from desk_jobs
      where newsroom_id = ${owned(context)} and kind = 'reconcile' and subject_id = ${row.id}
        and status in ('queued','running')
      limit 1
    `;
    if (liveCheck) {
      return {
        warnings,
        hard: {
          key: "reconcile-running",
          sentence: "An evidence check is running on this draft. Its answer is not in yet.",
        },
        outstandingClaims,
        confirmSection: false,
        draftTopic,
        area,
        evidence,
      };
    }

    return { warnings, hard: null, outstandingClaims, confirmSection, draftTopic, area, evidence };
  };

  /* A missing draft is a true impossibility: there is nothing to be warned about. */
  if (!preDraft) return { ok: false as const, error: "Draft this lead before publishing." };

  /*
    The newsroom's own outlet list, read ONCE here (not inside the transaction:
    `getPaperConfig` opens the pooled connection, and on PGlite there is one, so
    reading it inside the fence would deadlock). The fence re-check below uses
    the same list, so the desk report, the override and this gate cannot
    disagree about what is outstanding.
  */
  const namedOutlets = (await getPaperConfig(owned(context))).namedOutlets;
  /*
    A fast early-out so an unacknowledged warning or a true impossibility does
    not even open the fence. The authoritative decision is the re-check INSIDE
    the transaction below, against the locked current draft.
  */
  const pre = await collectWarnings(sql, preDraft, namedOutlets);
  if (pre.hard) {
    return { ok: false as const, error: pre.hard.sentence, hard: pre.hard.key };
  }
  const unacknowledged = pre.warnings.filter((w) => !acknowledged.has(w.key));
  if (unacknowledged.length) {
    return {
      ok: false as const,
      error: unacknowledged[0].sentence,
      warnings: pre.warnings,
    };
  }

  /* The warnings whose keys the editor acknowledged, recomputed under the fence
     and used for the audit rows -- filled in by the transaction below. */
  let recordedOverrides: { key: string; sentence: string }[] = [];

  const published = await withCurrentDraftForPublish(
    {
      newsroomId: owned(context),
      /*
        The publish path owns the held/killed decision (it warns and audits it),
        so it does not want the helper's own lifecycle throw: a lead held under
        the fence must come back as a warning the editor can acknowledge, not a
        bare refusal behind a dialog.
      */
      allowLifecycleOverride: true,
      /* Hand us the CURRENT locked draft: recompute every warning on what will
         actually print, so a warning that appeared under the fence is refused
         with a fresh list rather than hidden behind a "draft changed" throw. */
      useCurrentDraft: true,
    },
    leadId,
    preDraft,
    async (sql, row) => {
      /*
        Every value below is derived from `row`, the draft this fence will
        actually print -- not the pre-read draft. `draft` is the stored story
        with the reporter's notebook stripped; the topic, area, section
        confirmation, outstanding-claims tally and provenance are all recomputed
        here so a rewrite under the fence cannot print yesterday's words.
      */
      const draft = unpackStoredDraft({ ...row });
      draft.body = stripReporterNotebook(draft.body);
      if (parseUrlList(draft.source_urls).length === 0 && mayInheritLeadSources(row)) {
        const inherited = sanitizePublicUrls(
          parseUrlList(
            (
              await sql<{ source_urls: string }>`
                select source_urls from leads
                where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
              `
            )[0]?.source_urls ?? "[]",
          ),
        );
        if (inherited.length > 0) draft.source_urls = JSON.stringify(inherited);
      }
      const provenanceJson =
        row.provenance_json && row.provenance_json !== "[]"
          ? row.provenance_json
          : JSON.stringify(provenanceFromUrls(parseUrlList(draft.source_urls)));
      const baseSlug = slugify(draft.headline);
      let slug = baseSlug;

      /*
        Publication and capture share the same lead -> meeting-record fence.
        Once this lock is held, either this transaction observes the old tape
        and publishes before a revision, or it observes the new tape and blocks
        the old draft. A capture cannot commit between this check and insert.
      */
      await lockMeetingsForDraftPublish(sql, {
        newsroomId: owned(context),
        draftId: Number(row.id),
      });

      /*
        NO STALE PREFLIGHT APPROVAL (PR233). Every warning is recomputed here,
        against the exact draft this fence will print, INSIDE the transaction
        that prints it. A client that acknowledged the warnings it was shown
        cannot print past a warning that only became true since -- a tape that
        moved, a rewrite, a section that stopped being confirmed. If any current
        warning is unacknowledged, the print is refused and nothing is written.
      */
      const fenced = await collectWarnings(sql, row, namedOutlets);
      if (fenced.hard) {
        return {
          blocked: true as const,
          error: fenced.hard.sentence,
          hard: fenced.hard.key,
        };
      }
      const stillUnacknowledged = fenced.warnings.filter((w) => !acknowledged.has(w.key));
      if (stillUnacknowledged.length) {
        return {
          blocked: true as const,
          error: stillUnacknowledged[0].sentence,
          warnings: fenced.warnings,
        };
      }
      const evidence = fenced.evidence;
      if (!evidence) {
        return {
          blocked: true as const,
          error: "The meeting record for this draft could not be read.",
        };
      }
      /*
        THE WARNINGS THE EDITOR ACTUALLY OVERRODE: the keys they sent that named
        a CURRENT warning. A key that names nothing is not an override and is
        not audited. These are written below, in this same transaction, one row
        each, so an override cannot outlive a print that never happened.
      */
      recordedOverrides = acknowledgedWarnings(fenced.warnings, acknowledgedWarningKeys);

      /*
        THE PRESS THAT CARRIED THE SECTION IS THE CONFIRMATION (0.6.67).

        Written here, in the transaction that prints the story, against the
        token of the row actually being printed -- so the record cannot survive
        a newer draft, and a print without its confirmation cannot happen. The
        confirmation is what the gate above reads for any later request that
        carries no section; the guarantee the separate button used to provide is
        unchanged, it is just made by the same press that publishes now.
      */
      if (fenced.confirmSection) {
        const noteRows = await sql<{ notes_json: string | null }>`
          select notes_json from leads
          where id = ${leadId} and newsroom_id = ${owned(context)} for update
        `;
        const printNotes = parseNotes(noteRows[0]?.notes_json);
        printNotes.topicConfirmation = {
          topic: fenced.draftTopic,
          token: topicConfirmationFingerprint(evidenceReviewToken(row)),
          at: new Date().toISOString(),
        };
        await sql`
          update leads set notes_json = ${packNotes(printNotes)}, topic_unchosen = false
          where id = ${leadId} and newsroom_id = ${owned(context)}
        `;
      }

      // `articles.slug` is UNIQUE. The old code checked once and, on a clash,
      // appended the lead id without re-checking — so a second collision (a
      // headline that slugifies to an existing "<base>-<leadId>", or a
      // re-publish after the first article was deleted) hit the constraint and
      // threw a raw 500 out of the server function. Keep looking until free.
      slug = baseSlug;
      for (let n = 0; n < 50; n += 1) {
        const clash = await sql<{ slug: string }>`
        select slug from articles where slug = ${slug} limit 1
      `;
        if (!clash[0]) break;
        slug = n === 0 ? `${baseSlug}-${leadId}` : `${baseSlug}-${leadId}-${n + 1}`;
      }
      /*
        PRINTING IS A WRITE, and it is the last door the model's words pass
        through before a reader sees them. The draft row this reads was cleaned
        when it was saved, but a row saved before that guard existed can still
        carry a NUL, and a NUL in any of the `text` columns below fails the
        INSERT -- inside the transaction that prints the story, so the publish
        is lost rather than half-done.

        `provenance_json` and `source_urls` are the captured-page side of the
        row and are left as they are.
      */
      const [printed] = await sql<{ id: number }>`
      insert into articles (
        user_id, newsroom_id, lead_id, slug, headline, dek, body, topic, source_urls, status, published_at,
        provenance_json, form, found_note, unanswered, origin_draft_id, disclosure_text, area
      )
      values (
        ${context.userId}, ${owned(context)}, ${leadId}, ${slug}, ${storableText(draft.headline)},
        ${storableText(draft.dek)},
        ${storableText(draft.body)}, ${storableText(draft.topic)}, ${draft.source_urls}, 'published', now(),
        ${provenanceJson}, ${storableText(row.form || "reported")}, ${storableText(row.found_note || "")},
        ${row.unanswered || "[]"}, ${row.id},
        /* The line the editor chose on the import screen, carried on the draft.
           Empty for every story the desk wrote, which prints the standard AI
           line exactly as before. */
        ${storableText(row.disclosure_text || "")},
        /* The geography pill this story answers to. NULL is the home town on the
           paper, which is the rule for the whole pre-0098 archive too -- see
           story-area.ts, which owns the four keys. */
        ${fenced.area}
      ) returning id
    `;
      /*
        THE TAPE RECORD, FOR A STORY WHOSE CITATIONS WERE OVERRIDDEN (PR233).

        When no citation is stale this is the ordinary path: freeze the verified
        snapshot in the same transaction. When the editor ACKNOWLEDGED a stale
        citation, the recording layer would (rightly) refuse to fabricate a
        "current, verified" snapshot -- so on that path we preserve the ORIGINAL
        draft link's snapshot with an explicit insert-select, never a new
        verification. A draft with no current link simply has nothing to
        preserve: no snapshot is written, and the override is still audited.
      */
      if (evidence.stale.length && acknowledged.has("meeting-citation-stale")) {
        await sql`
          insert into meeting_article_transcript_links
            (newsroom_id, article_id, origin_draft_id, artifact_id, artifact_sha256, video_id, citation_snapshot)
          select l.newsroom_id, ${printed.id}, l.draft_id, l.artifact_id, a.sha256, a.video_id, l.citation_snapshot
            from meeting_draft_transcript_links l
            join meeting_transcript_artifacts a on a.id = l.artifact_id
           where l.newsroom_id = ${owned(context)} and l.draft_id = ${Number(row.id)} and l.is_current = true
          on conflict (newsroom_id, article_id, artifact_id) do nothing
        `;
      } else {
        await recordMeetingPublishEvidence(sql, {
        newsroomId: owned(context),
        articleId: printed.id,
        draftId: Number(row.id),
      }, evidence);
      }
      await sql`
      update leads set status = 'published' where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
      /*
        ONE AUDIT ROW PER WARNING THE EDITOR OVERRODE (PR233), written in THIS
        transaction so the record and the print are one act: a refusal below
        rolls both back, and a print cannot commit without its record.
      */
      await auditPublishOverrides(sql, {
        newsroomId: owned(context),
        userId: context.userId,
        leadId,
        draftId: Number(row.id),
        warnings: recordedOverrides,
      });
      /*
        Both halves of a beat-memory row are model-written -- the entity is cut
        out of the draft's headline, the angle is its dek -- and both are `text`
        columns. Guarded after the split and the trim, so the entity written is
        the entity that was counted.
      */
      const entities = [draft.topic, ...draft.headline.split(/[:,—-]/).slice(0, 2)];
      for (const entity of entities.map((e) => storableText(e).trim()).filter((e) => e.length > 2)) {
        await sql`
        insert into beat_memory (user_id, newsroom_id, entity, last_angle, article_id)
        values (${context.userId}, ${owned(context)}, ${entity.slice(0, 80)}, ${storableText(draft.dek).slice(0, 200)}, ${printed.id})
      `;
      }
      return {
        blocked: false as const,
        slug,
        id: printed.id,
        fileAbsent: evidence.fileAbsent,
        outstandingClaims: fenced.outstandingClaims,
        draftTopic: fenced.draftTopic,
        modelTopic: String(row.model_topic ?? "").trim(),
      };
    },
  );

  if (published.blocked) {
    return {
      ok: false as const,
      error: published.error,
      ...("warnings" in published && published.warnings ? { warnings: published.warnings } : {}),
      ...("hard" in published && published.hard ? { hard: published.hard } : {}),
    };
  }

  for (const absent of published.fileAbsent) {
    await audit(
      context.userId,
      "publish-transcript-file-absent",
      `Article ${published.id}: transcript artifact ${absent.artifactId} file absent; ${absent.verifiedCitationCount} citation${absent.verifiedCitationCount === 1 ? "" : "s"} verified against the database`,
      owned(context),
      { kind: "articles", id: published.id },
    );
  }

  /*
    A SECTION THE MODEL DID NOT CHOOSE (0.6.67).

    "the model filed this under Council, the editor published it under Schools"
    is the fact the paper wants to be able to count. Recorded on the existing
    audit trail rather than in a table of its own, because it is one line about
    one decision and the trail already carries the who and the when.
  */
  if (published.id && sectionOverridden(published.modelTopic, published.draftTopic)) {
    await audit(
      context.userId,
      "section-override",
      sectionOverrideDetail({
        leadId,
        modelTopic: published.modelTopic,
        editorTopic: published.draftTopic,
      }),
      owned(context),
      { kind: "articles", id: published.id },
    );
  }
  /*
    Unit U24: a story that printed with claims its own evidence check raised
    and nobody judged says so on the trail, beside the section override above
    and for the same reason -- "the record raised seven claims and a person
    chose to print them" is a fact the paper should be able to look up later.
    The acceptance itself was audited when it was given
    (`accept_unreviewed_claims`); this is the print that used it.
  */
  if (published.outstandingClaims > 0) {
    await audit(
      context.userId,
      "publish-unreviewed-claims",
      `Article ${published.id}: ${published.outstandingClaims} unreviewed claim${
        published.outstandingClaims === 1 ? "" : "s"
      } accepted before printing`,
      owned(context),
      { kind: "articles", id: published.id },
    );
  }
  await audit(context.userId, "publish", `Article ${published.id}`, owned(context), {
    kind: "articles",
    id: published.id,
  });
  return { ok: true as const, slug: published.slug };
});

export const publishLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  /*
    `(leadId: number) => leadId` was an annotation, not a check: the body
    arrived as whatever the client sent and went into `where id = $1` as
    itself. The query is parameterised, so this was never injection -- it was a
    declared type that nothing enforced. `cleanPublishRequest` answers `null`
    for anything that is not a positive 32-bit integer, and the handler refuses.

    0.6.67: the request may also carry `topic`, the section the desk's Publish
    button showed. The bare id every older caller sends is still accepted, and
    an absent topic means "unconfirmed", never "confirmed blank".

    0.6.71: it may also carry `area`, the geography the publish step chose.
    Absent means the home town, which is where every story printed before 0098
    already sits -- so an older client is not a client that prints wrong.
  */
  .validator((raw: unknown) => cleanPublishRequest(raw))
  .handler(async ({ context, data }) =>
    data.leadId === null
      ? { ok: false as const, error: "There is no such story." }
      : performPublish(
          context,
          data.leadId,
          data.topic,
          data.area,
          {},
          data.acknowledgedWarningKeys ?? [],
        ),
  );

/**
 * Change the headline of a story that has already printed.
 *
 * Headlines are a primary editor's job and the desk had no way to do this at
 * all: `articles.headline` was written once, at publish, and the input on the
 * story page is disabled for a lead on paper. A typo, a better verb, a section
 * editor's rewrite -- all of it needed a developer and a SQL prompt.
 *
 * WHAT MOVES AND WHAT DOES NOT. Only `articles.headline`. `articles.slug` is
 * untouched, so every link, every share and every reader's open tab keeps
 * working and the page changes under them; that is the whole reason this is an
 * update rather than a reprint. The old headline, who changed it and when go to
 * `article_headline_history` (migration 0093), append-only, written in the same
 * transaction as the update so the record cannot outlive a failed change.
 *
 * NO CORRECTION NOTICE. `addCorrection` is a separate, explicit act and nothing
 * in this codebase couples a headline to it -- grep for `headline` in
 * corrections.ts and the only mentions are of the article's own. A correction
 * says the paper got something wrong; a headline rewrite says the paper can say
 * it better, and the story's facts are unchanged. Requiring one would also mean
 * a headline could not be fixed without publishing a second, reader-facing
 * change, which is a worse outcome for the reader than the fix.
 */
export async function performUpdateArticleHeadline(
  context: { userId: string; newsroomId?: number },
  articleId: number,
  headline: string,
): Promise<{ ok: true; headline: string } | { ok: false; error: string }> {
  const clean = cleanHeadline(headline);
  if (!clean) {
    return {
      ok: false as const,
      error: "A headline cannot be blank. Type the headline you want the paper to print, then save.",
    };
  }
  const rows = await getSql().then(
    (sql) =>
      sql<{ id: number; headline: string | null; status: string }>`
      select id, headline, status from articles
      where id = ${articleId} and newsroom_id = ${owned(context)} limit 1
    `,
  );
  const article = rows[0];
  if (!article) {
    return { ok: false as const, error: "That story is not one of this paper's stories." };
  }
  if (article.status !== "published") {
    return {
      ok: false as const,
      error: "That story is not on the paper yet. Edit its headline in the story workbench instead.",
    };
  }
  const record = headlineEditRecord(article, clean, context.userId);
  // Nothing changed: a second press of Save is not a second decision, and it
  // must not leave a row that says the headline was rewritten.
  if (!record) return { ok: true as const, headline: String(article.headline ?? "").trim() };

  await withTransaction(async (sql) => {
    await sql`
      update articles set headline = ${record.newHeadline}
      where id = ${articleId} and newsroom_id = ${owned(context)}
    `;
    await sql`
      insert into article_headline_history (newsroom_id, article_id, old_headline, new_headline, changed_by)
      values (${owned(context)}, ${articleId}, ${record.oldHeadline}, ${record.newHeadline}, ${context.userId})
    `;
  });
  /*
    Audited after the transaction, where the rest of the publish path's audits
    sit: `audit` writes on the pooled connection, and on PGlite there is one
    connection, so writing from inside a transaction deadlocks it.
  */
  await audit(
    context.userId,
    "edit_headline",
    `Article ${articleId}: "${record.oldHeadline}" -> "${record.newHeadline}"`,
    owned(context),
    { kind: "articles", id: articleId },
  );
  return { ok: true as const, headline: record.newHeadline };
}

export const updateArticleHeadline = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => updateArticleHeadlineInput.parse(raw))
  .handler(async ({ context, data }) => performUpdateArticleHeadline(context, data.articleId, data.headline));


export const LIVE_STORY_CHANGE_KEY = "published-live-change";

/** The sentence the desk shows before it lets a live change through. */
export const LIVE_STORY_CHANGE_SENTENCE =
  "This story is live. Your change will show on the paper.";

export type LiveStoryChangeInput = {
  articleId?: number;
  articleSlug?: string;
  dek?: string;
  topic?: string;
  body?: string;
  modelChoice?: EffectiveProviderChoice;
  modelEffort?: ModelEffort | null;
  override?: string[];
};

export type LiveStoryChangeResult =
  | { ok: true; changed: string[] }
  | { ok: false; error: string }
  | OverrideWarning;

/** Read the string warning keys carried by an override retry. */
export function cleanOverrideKeys(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((key): key is string => typeof key === "string");
}

/** Read the fields for a live-story edit or review. */
export function liveStoryChangeInput(raw: unknown): LiveStoryChangeInput {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const id = Number(o.articleId);
  return {
    articleId: Number.isFinite(id) && id > 0 ? id : undefined,
    articleSlug: text(o.articleSlug),
    dek: text(o.dek),
    topic: text(o.topic),
    body: text(o.body),
    modelChoice: storyModelChoice(o.modelChoice),
    modelEffort: modelEffort(storyModelChoice(o.modelChoice), o.modelEffort),
    override: cleanOverrideKeys(o.override),
  };
}

/** The change-log line a live edit prints, naming what moved and that a person did it. */
export function liveChangeNotice(changes: { dek?: string; topic?: string; body?: string }): string {
  const what = [
    changes.dek !== undefined ? "the summary" : null,
    changes.topic !== undefined ? "the section" : null,
    changes.body !== undefined ? "the story text" : null,
  ].filter((part): part is string => Boolean(part));

  const recorded =
    changes.body !== undefined ? " The story text it replaced is kept on the record." : "";
  return `The paper changed ${what.join(", ")} on this story after it was published. The story's link is unchanged.${recorded}`;
}

export async function performChangePublishedStory(
  context: { userId: string; newsroomId?: number },
  input: LiveStoryChangeInput,
): Promise<LiveStoryChangeResult> {
  const room = owned(context);
  const articleId = Number(input.articleId ?? 0);
  const slug = String(input.articleSlug ?? "").trim();
  if (!articleId && !slug) return { ok: false, error: "Which story is this change for?" };

  const sql = await getSql();
  type LiveArticle = {
    id: number;
    dek: string;
    body: string;
    topic: string;
    status: string;
    lead_id: number | null;
  };
  const rows = articleId
    ? await sql<LiveArticle>`
        select id, dek, body, topic, status, lead_id from articles
        where id = ${articleId} and newsroom_id = ${room} limit 1
      `
    : await sql<LiveArticle>`
        select id, dek, body, topic, status, lead_id from articles
        where slug = ${slug} and newsroom_id = ${room} limit 1
      `;
  const article = rows[0];
  if (!article) return { ok: false, error: "That story is not one of this paper's stories." };
  if (article.status !== "published") {
    return {
      ok: false,
      error: "That story is not on the paper, so there is nothing live to change.",
    };
  }
  /*
    A model is already rewriting this row. Two writers on one story is how a
    live edit loses to whichever write landed first, so the change waits for
    the job -- the same reason the workbench's own draft refuses one.
  */
  if (article.lead_id != null) {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema(sql);
    const running = await sql<{ id: number }>`
      select id from desk_jobs
      where newsroom_id = ${room} and kind = 'draft' and subject_id = ${article.lead_id}
        and status = 'running' limit 1
    `;
    if (running[0]) {
      return {
        ok: false,
        error:
          "A job is already running for this story. Wait for it to finish, then change the paper.",
      };
    }
  }

  const changes: { dek?: string; topic?: string; body?: string } = {};
  if (input.dek !== undefined) {
    const dek = String(input.dek).trim();
    if (dek !== String(article.dek ?? "").trim()) changes.dek = dek;
  }
  if (input.topic !== undefined) {
    const topic = String(input.topic).trim().slice(0, LIMITS.topic);
    if (!topic) return { ok: false, error: "Pick a section for this story." };
    const { resolveSectionKey } = await import("./sections.server.ts");
    let resolved: string;
    try {
      resolved = await resolveSectionKey(room, topic);
    } catch {
      return {
        ok: false,
        error:
          "That is not a section this paper files under. Pick one of the paper's own sections.",
      };
    }
    if (resolved !== String(article.topic ?? "").trim()) changes.topic = resolved;
  }
  if (input.body !== undefined) {
    const body = String(input.body).trim();
    if (!body) {
      return {
        ok: false,
        error: "The story text cannot be blank. Put the corrected story in the box, then save.",
      };
    }
    if (body !== String(article.body ?? "").trim()) changes.body = body;
  }

  const kinds = Object.keys(changes);
  // A second press of the same text is not a second decision: it changes
  // nothing, writes nothing, and does not warn.
  if (kinds.length === 0) return { ok: true, changed: [] };

  const warning = checkOverride(input, LIVE_STORY_CHANGE_KEY, LIVE_STORY_CHANGE_SENTENCE);
  if (warning) return warning;

  const notice = liveChangeNotice(changes);
  try {
    await withTransaction(async (sql) => {
      /*
        The note first, so the history row can carry the correction's id: the
        two halves of one act are joined, exactly as `performAddCorrection`'s
        `alsoFixBody` joins them.
      */
      const [correction] = await sql<{ id: number }>`
        insert into corrections (user_id, newsroom_id, article_id, body)
        values (${context.userId}, ${room}, ${article.id}, ${notice})
        returning id
      `;
      // `!== undefined`, not truthiness: a cleared summary is `""`, which is a
      // real change and must reach the UPDATE.
      if (changes.body !== undefined) {
        const locked = await sql<{ body: string }>`
          select body from articles
          where id = ${article.id} and newsroom_id = ${room} for update
        `;
        const beforeBody = locked[0]?.body ?? article.body;
        await sql`update articles set body = ${changes.body} where id = ${article.id} and newsroom_id = ${room}`;
        await sql`
          insert into article_body_history
            (newsroom_id, article_id, old_body, new_body, changed_by, correction_id)
          values (
            ${room}, ${article.id}, ${beforeBody}, ${changes.body},
            ${context.userId}, ${correction.id}
          )
        `;
      }
      if (changes.dek !== undefined) {
        await sql`update articles set dek = ${changes.dek} where id = ${article.id} and newsroom_id = ${room}`;
      }
      if (changes.topic !== undefined) {
        await sql`update articles set topic = ${changes.topic} where id = ${article.id} and newsroom_id = ${room}`;
      }
    });
  } catch (err) {
    /*
      A story under a legal removal is refused by the database trigger on
      `articles`/`corrections` (0047). That is the correct refusal; this only
      turns its exception into the sentence the desk shows.
    */
    const message = err instanceof Error ? err.message : "";
    if (/legal removal|legally removed/i.test(message)) {
      return {
        ok: false,
        error: "This story is covered by a legal removal and cannot be changed.",
      };
    }
    throw err;
  }

  /*
    Audited after the transaction, where the headline path's audit sits: `audit`
    writes on the pooled connection, and on PGlite there is one connection, so
    writing from inside the transaction deadlocks it.
  */
  await audit(
    context.userId,
    "edit_published_story",
    `Article ${article.id}: ${kinds.join(", ")} changed after publishing`,
    room,
    { kind: "articles", id: article.id },
  );
  await auditOverrides({ userId: context.userId, newsroomId: room }, [LIVE_STORY_CHANGE_KEY], {
    kind: "articles",
    id: article.id,
  });
  return { ok: true, changed: kinds };
}

export const changePublishedStory = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => liveStoryChangeInput(raw))
  .handler(async ({ context, data }) => performChangePublishedStory(context, data));

/** Re-check the printed text against retained captures; never fetch new URLs. */
export const LIVE_STORY_REVERIFY_KEY = "published-live-reverify";
export const LIVE_STORY_REVERIFY_SENTENCE = LIVE_STORY_CHANGE_SENTENCE;

async function liveWorkArticle(context: { newsroomId?: number }, input: LiveStoryChangeInput) {
  const sql = await getSql();
  const rows = await sql.query<{
    id: number;
    body: string;
    status: string;
    lead_id: number | null;
    source_urls: string;
  }>(
    "select id,body,status,lead_id,source_urls from articles where newsroom_id=$1 and (id=$2 or slug=$3) limit 1",
    [owned(context), input.articleId ?? 0, input.articleSlug ?? ""],
  );
  const article = rows[0];
  if (!article)
    return { ok: false as const, error: "That story is not one of this paper's stories." };
  if (article.status !== "published")
    return { ok: false as const, error: "That story is not on the paper." };
  if (!article.body.trim())
    return { ok: false as const, error: "The story on the paper has no text." };
  if (article.lead_id != null) {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema(sql);
    const jobs = await sql.query(
      "select id from desk_jobs where newsroom_id=$1 and subject_id=$2 and status='running' and kind='draft' limit 1",
      [owned(context), article.lead_id],
    );
    if (jobs.length)
      return {
        ok: false as const,
        error: "A job is already running for this story. Wait for it to finish.",
      };
  }
  const removals = await sql.query(
    "select row_id from legal_removal_targets where newsroom_id=$1 and table_name='articles' and row_id=$2 limit 1",
    [owned(context), article.id],
  );
  if (removals.length)
    return {
      ok: false as const,
      error: "This story is covered by a legal removal and cannot be changed.",
    };
  return { ok: true as const, article };
}

async function liveChatOptions(context: { newsroomId?: number }, input: LiveStoryChangeInput) {
  const choice = input.modelChoice ?? "auto";
  const localModel =
    choice === "local-model"
      ? (
          await (
            await import("./provider-settings.ts")
          ).resolveLocalModelChoice(owned(context), "story")
        ).override
      : undefined;
  return {
    newsroomId: owned(context),
    choice,
    reasoningEffort: input.modelEffort ?? null,
    ...(localModel ? { localModel } : {}),
  };
}

export async function performReverifyPublishedStory(
  context: { userId: string; newsroomId?: number },
  input: LiveStoryChangeInput,
  deps: { chat?: typeof grokChat } = {},
) {
  const loaded = await liveWorkArticle(context, input);
  if (!loaded.ok) return loaded;
  const warning = checkOverride(input, LIVE_STORY_REVERIFY_KEY, LIVE_STORY_REVERIFY_SENTENCE);
  if (warning) return warning;
  const { article } = loaded;
  const sql = await getSql();
  const urls = parseUrlList(article.source_urls);
  const sources = await sql.query<{ url: string; text: string }>(
    "select distinct on (url) url,full_text as text from artifact_versions where newsroom_id=$1 and url=any($2::text[]) order by url,captured_at desc,id desc",
    [owned(context), urls],
  );
  const { judgeEvidenceClaims } = await import("./evidence-ai.ts");
  const claims = article.body
    .split(/(?<=[.!?])\s+/)
    .filter((text) => text.trim())
    .map((text) => ({ text, urls }));
  const options = await liveChatOptions(context, input);
  const rows = await judgeEvidenceClaims(claims, sources, (prompt) =>
    (deps.chat ?? grokChat)(
      "Check claims only against the supplied retained evidence.",
      prompt,
      4000,
      options,
    ),
  );
  const review = { checkedText: article.body, rows };
  await audit(context.userId, "reverify_published_story", JSON.stringify(review), owned(context), {
    kind: "articles",
    id: article.id,
  });
  await auditOverrides(
    { userId: context.userId, newsroomId: owned(context) },
    [LIVE_STORY_REVERIFY_KEY],
    { kind: "articles", id: article.id },
  );
  return { ok: true as const, review };
}

export const reverifyPublishedStory = createServerFn({method: "POST"}).middleware([deskMiddleware])
  .validator((raw: unknown) => liveStoryChangeInput(raw))
  .handler(({context, data}) => performReverifyPublishedStory(context, data));

/** Rewrite a live story from its saved ledger and captures, then record the public update. */
export async function performRewritePublishedStory(
  context: { userId: string; newsroomId?: number },
  input: LiveStoryChangeInput,
  deps: { chat?: typeof grokChat } = {},
) {
  const loaded = await liveWorkArticle(context, input);
  if (!loaded.ok) return loaded;
  const warning = checkOverride(input, LIVE_STORY_CHANGE_KEY, LIVE_STORY_CHANGE_SENTENCE);
  if (warning) return warning;
  const { article } = loaded;
  const sql = await getSql();
  const { loadStoredLedgerForRewrite } = await import("./meeting-ledger.server.ts");
  const ledger =
    article.lead_id == null
      ? []
      : await loadStoredLedgerForRewrite(sql, {
          newsroomId: owned(context),
          leadId: article.lead_id,
        });
  const sources = await sql.query<{ url: string; full_text: string }>(
    "select distinct on (url) url,full_text from artifact_versions where newsroom_id=$1 and url=any($2::text[]) order by url,captured_at desc,id desc",
    [owned(context), parseUrlList(article.source_urls)],
  );
  const reply = await (deps.chat ?? grokChat)(
    "Rewrite the story using only its supplied text, saved meeting ledger and retained captures. Preserve uncertainty and the editor’s ledger decisions. Return JSON {body: string}. Do not invent facts or sources.",
    JSON.stringify({ body: article.body, ledger, sources }),
    8000,
    await liveChatOptions(context, input),
  );
  if (!reply.ok)
    return {
      ok: false as const,
      error: reply.error || "The rewrite could not finish. The live story is unchanged.",
    };
  const parsed = parseJsonBlock(reply.text ?? "") as { body?: unknown } | null;
  if (!parsed || typeof parsed.body !== "string" || !parsed.body.trim())
    return {
      ok: false as const,
      error: "The rewrite returned no story text. The live story is unchanged.",
    };
  const current = await liveWorkArticle(context, input);
  if (!current.ok) return current;
  if (current.article.body !== article.body)
    return {
      ok: false as const,
      error: "The live story changed during the rewrite. Reload it before trying again.",
    };
  const result = await performChangePublishedStory(context, { ...input, body: parsed.body });
  if (result.ok && result.changed.length === 0) {
    await auditOverrides({userId: context.userId, newsroomId: owned(context)}, [LIVE_STORY_CHANGE_KEY], {kind: "articles", id: article.id});
  }
  return result;
}

export const rewritePublishedStory = createServerFn({method: "POST"}).middleware([deskMiddleware])
  .validator((raw: unknown) => liveStoryChangeInput(raw))
  .handler(({context, data}) => performRewritePublishedStory(context, data));

/**
 * Three headlines the story model would write, offered to the editor.
 *
 * The desk's own answer to a headline the editor does not like used to be
 * "Redraft", which rewrites the whole story to change one line and may come
 * back worse -- it did, twice, on lead 240. This asks the same story model, on
 * the same provider ladder as every other story call (Automatic, resolved once
 * by `grokChat`), for three options and changes nothing: the desk shows them
 * and an editor clicks one. `parseHeadlineSuggestions` drops anything that
 * would not print, so an option that is offered is an option that can be saved.
 *
 * A model that cannot be reached says so in a sentence and leaves the editor's
 * headline exactly as they typed it. A suggestion that silently did nothing
 * would be indistinguishable from a suggestion that failed.
 */
export async function performSuggestHeadlines(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  currentHeadline?: string,
  model?: { choice?: string | null; effort?: string | null },
  deps: {
    chat?: typeof grokChat;
    resolveLocalModel?: (newsroomId: number, scope: "story") => Promise<LocalModelOverride | null>;
  } = {},
): Promise<{ ok: true; options: string[] } | { ok: false; error: string }> {
  const sql = await getSql();
  const leads = await sql<LeadRow>`
    select id, headline, topic from leads
    where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
  `;
  const lead = leads[0];
  if (!lead) return { ok: false as const, error: "Lead not found" };
  const drafts = await sql<DraftRow>`
    select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at
    from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
    order by updated_at desc, id desc limit 1
  `;
  const row = drafts[0];
  const prompt = headlineSuggestionPrompt({
    leadHeadline: String(lead.headline ?? "").trim(),
    section: String(row?.topic ?? lead.topic ?? "").trim(),
    currentHeadline: String(currentHeadline ?? "").trim(),
    dek: row?.dek,
    body: row?.body,
  });
  /*
    Unit BK's Headline dialog draws the model row the reference draws, so a pick
    arrives here; absent, this is "auto" and the desk's resolution decides, which
    is what this call has always done. The pick is the dialog's own row, and
    `grokChat` is still the thing that resolves an "auto".
  */
  const choice = (model?.choice || "auto") as EffectiveProviderChoice;
  const newsroomId = owned(context);
  const localModel = choice === "local-model"
    ? await (deps.resolveLocalModel
      ? deps.resolveLocalModel(newsroomId, "story")
      : import("./provider-settings.ts").then((settings) => settings.resolveLocalModelChoice(newsroomId, "story")).then((resolved) => resolved.override))
    : undefined;
  const got = await (deps.chat ?? grokChat)(prompt.system, prompt.user, 700, {
    choice,
    newsroomId,
    ...(localModel ? { localModel } : {}),
    reasoningEffort: (model?.effort ?? null) as ModelEffort | null,
  });
  if (!got.ok) {
    return {
      ok: false as const,
      error:
        "The story model could not be reached just now, so no headlines were suggested. Your headline is exactly as you left it.",
    };
  }
  const options = parseHeadlineSuggestions(got.text);
  if (!options.length) {
    return {
      ok: false as const,
      error:
        "The story model did not come back with anything that would print as a headline. Your headline is exactly as you left it.",
    };
  }
  return { ok: true as const, options };
}

export const suggestHeadlines = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => suggestHeadlinesInput.parse(raw))
  .handler(async ({ context, data }) =>
    performSuggestHeadlines(context, data.leadId, data.headline, {
      choice: data.modelChoice,
      effort: data.modelEffort as ModelEffort | null | undefined,
    }),
  );

/**
 * A correction note the story model would write, from the editor's two lines.
 *
 * The owner's first real correction (2026-09-25) was that the box starts empty.
 * The editor knows what was wrong and what is right -- they are looking at both
 * -- and what they need is the house form. This asks the story model, on the
 * same provider ladder as every other story call (Automatic, resolved once by
 * `grokChat`), for one note built from those two lines plus the story text, and
 * changes nothing: the answer goes into the box, and the existing post button
 * is still the only thing that publishes.
 *
 * TWO WAYS TO GET A NOTE, AND THEY ARE DIFFERENT ON PURPOSE. This is the model
 * one. `correctionTemplate` is the other: the same note, written on the desk
 * from the same two lines with no model involved, and the desk offers it as its
 * own button. That is what keeps the basic case working on a machine with no
 * model configured at all -- a fallback hidden inside a failed call would make
 * "the model is down" and "here is your note" the same event, and they are not.
 *
 * A model that cannot be reached says so in a sentence and leaves the box
 * exactly as the editor left it. A suggestion that silently did nothing would
 * be indistinguishable from a suggestion that failed.
 */
export async function performSuggestCorrectionWording(
  context: { userId: string; newsroomId?: number },
  input: { articleSlug: string; wasWrong: string; isRight: string; modelChoice?: string },
  deps: {
    resolveLocalModel?: (newsroomId: number, scope: "story") => Promise<LocalModelOverride | null>;
    chat?: typeof grokChat;
  } = {},
): Promise<
  { ok: true; wording: string; source: "model" | "template" } | { ok: false; error: string }
> {
  const wasWrong = cleanCorrectionLine(input.wasWrong);
  const isRight = cleanCorrectionLine(input.isRight);
  /*
    Both lines are required for either path: the desk cannot write a correction
    from half the fact, and asking a model to would produce a sentence that
    reads finished and is not. A missing line is the editor's to fix, so it is
    refused in a sentence naming which one, before any model is called.
  */
  if (!wasWrong || !isRight) {
    return {
      ok: false as const,
      error: !wasWrong && !isRight
        ? "Say what was wrong and what is right, then the desk can suggest the wording."
        : !wasWrong
          ? "Say what the story got wrong, then the desk can suggest the wording."
          : "Say what is right, then the desk can suggest the wording.",
    };
  }
  /*
    A template the desk can write on its own. It is returned as the suggestion
    when there is no story to ask about -- the editor is correcting a printed
    story, so this should not happen, but answering with a usable note is better
    than a model call about a story that is not there or a dead button.
  */
  const fallback = correctionTemplate(wasWrong, isRight);
  const sql = await getSql();
  const rows = await sql<{ id: number; headline: string | null; body: string | null }>`
    select id, headline, body from articles
    where slug = ${input.articleSlug}
      and newsroom_id = ${owned(context)}
      and status = 'published'
    limit 1
  `;
  const article = rows[0];
  if (!article) {
    if (!fallback) return { ok: false as const, error: "That published story is not available in this newsroom." };
    return { ok: true as const, wording: fallback, source: "template" as const };
  }
  const prompt = correctionWordingPrompt({
    wasWrong,
    isRight,
    headline: String(article.headline ?? "").trim(),
    body: String(article.body ?? ""),
  });
  const newsroomId = owned(context);
  const choice = storyModelChoice(input.modelChoice);
  const localModel = choice === "local-model"
    ? await (deps.resolveLocalModel
      ? deps.resolveLocalModel(newsroomId, "story")
      : import("./provider-settings.ts").then((settings) => settings.resolveLocalModelChoice(newsroomId, "story")).then((resolved) => resolved.override))
    : undefined;
  const got = await (deps.chat ?? grokChat)(prompt.system, prompt.user, 700, {
    choice,
    newsroomId,
    ...(localModel ? { localModel } : {}),
  });
  if (!got.ok) {
    return {
      ok: false as const,
      error:
        "The story model could not be reached just now, so no wording was suggested. Your box is exactly as you left it.",
    };
  }
  const wording = parseCorrectionWording(got.text);
  if (!wording) {
    return {
      ok: false as const,
      error:
        "The story model did not come back with something that would post as a correction. Your box is exactly as you left it.",
    };
  }
  return { ok: true as const, wording, source: "model" as const };
}

/**
 * The plain correction note, written on the desk from the editor's two lines.
 *
 * No model, no network, nothing that can be down. This is the path the owner's
 * complaint really asks for -- a filled box -- and it is deliberately separate
 * from the model call so that "the model is unreachable" never turns into an
 * empty box.
 */
export const suggestCorrectionTemplate = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => correctionWordingInput.parse(input))
  .handler(async ({ data }) => {
    const wording = correctionTemplate(data.wasWrong, data.isRight);
    return wording
      ? { ok: true as const, wording, source: "template" as const }
      : {
          ok: false as const,
          error: "Say what was wrong and what is right, then the desk can write the note.",
        };
  });

export const suggestCorrectionWording = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => correctionWordingInput.parse(input))
  .handler(async ({ context, data }) =>
    performSuggestCorrectionWording(context, {
      articleSlug: data.articleSlug,
      wasWrong: data.wasWrong,
      isRight: data.isRight,
      modelChoice: data.modelChoice,
    }));

export const addCorrection = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => correctionInput.parse(input))
  .handler(async ({ context, data }) => {
    const { performAddCorrection } = await import("./corrections.ts");
    return performAddCorrection({ userId: context.userId, newsroomId: owned(context) }, data);
  });

export type DeskPublishedRow = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  topic: string;
  published_at: string;
  lead_id: number | null;
  lead_score: number | null;
  /**
   * The story text as it is on the paper right now.
   *
   * 0.6.70: the desk needs it to open a correction's "also fix the story text"
   * editor seeded with the words it is about to replace, so the editor never
   * starts from an empty box holding a story they cannot see. It is what the
   * public page prints, no more and no less.
   */
  body: string;
  corrections: { date: string; body: string }[];
  transcriptReviews: PublishedMeetingReview[];
};

export const resolveMeetingArticleReview = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => meetingArticleReviewInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!data.note.trim()) return { ok: false as const, error: "Record what you checked or what needs correction." };
    await withTransaction((sql) => resolvePublishedMeetingReview(sql, {
      newsroomId: owned(context),
      reviewId: data.reviewId,
      reviewerId: context.userId,
      resolution: data.resolution,
      acceptedArtifactId: data.acceptedArtifactId,
      note: data.note.trim(),
      confirmedSegmentIndices: data.confirmedSegmentIndices,
    }));
    return { ok: true as const };
  });

export async function performDraftMeetingReview(
  context: { userId: string; newsroomId?: number },
  data: ReturnType<typeof draftMeetingReviewInput.parse>,
  deps: { record?: typeof recordDraftTranscriptRevisionReview } = {},
) {
  const sql = await getSql();
  const articles = await sql.query<{ id: number }>(
    "select id from articles where newsroom_id=$1 and lead_id=$2 and status='published' limit 1",
    [owned(context), data.leadId],
  );
  const article = articles[0];
  if (article) {
    const loaded = await liveWorkArticle(context, { articleId: article.id });
    if (!loaded.ok) return loaded;
    const warning = checkOverride(data, LIVE_STORY_REVERIFY_KEY, LIVE_STORY_CHANGE_SENTENCE);
    if (warning) return warning;
  }
  try {
    const result = await withTransaction((sql) =>
      (deps.record ?? recordDraftTranscriptRevisionReview)(sql, {
        newsroomId: owned(context),
        leadId: data.leadId,
        draftId: data.draftId,
        reviewerId: context.userId,
        expectedEvidenceToken: data.evidenceToken,
        acceptedArtifactId: data.acceptedArtifactId,
        confirmedSegmentIndexes: data.confirmedSegmentIndexes,
        note: data.note,
      }),
    );
    await audit(
      context.userId,
      "review",
      `Meeting draft ${data.draftId} transcript evidence`,
      owned(context),
      { kind: "drafts", id: data.draftId },
    );
    if (article)
      await auditOverrides(
        { userId: context.userId, newsroomId: owned(context) },
        [LIVE_STORY_REVERIFY_KEY],
        { kind: "articles", id: article.id },
      );
    return { ok: true as const, ...result };
  } catch (cause) {
    return {
      ok: false as const,
      error: cause instanceof Error ? cause.message : "Could not save the citation review.",
    };
  }
}

export const resolveDraftMeetingReview = createServerFn({method: "POST"}).middleware([deskMiddleware])
  .validator((input: unknown) => draftMeetingReviewInput.parse(input))
  .handler(({context, data}) => performDraftMeetingReview(context, data));

export const listDraftHistory = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((leadId: unknown) => rowId.parse(leadId))
  .handler(async ({ context, data: leadId }) => {
    const sql = await getSql();
    const drafts = await sql<{
      id: number; headline: string; dek: string; topic: string; updated_at: string;
    }>`
      select id,headline,dek,topic,updated_at from drafts
       where lead_id=${leadId} and newsroom_id=${owned(context)}
       order by updated_at desc,id desc
    `;
    if (!drafts.length) return [];
    const ids = drafts.map((draft) => Number(draft.id));
    const links = await sql<{
      id: number; draft_id: number; artifact_id: number; citation_snapshot: string;
      revision_notice: string | null; is_current: boolean; video_id: string; sha256: string;
    }>`
      select l.id,l.draft_id,l.artifact_id,l.citation_snapshot,l.revision_notice,l.is_current,
             a.video_id,a.sha256
        from meeting_draft_transcript_links l
        join meeting_transcript_artifacts a on a.id=l.artifact_id and a.newsroom_id=l.newsroom_id
       where l.newsroom_id=${owned(context)} and l.draft_id=any(${ids})
       order by l.draft_id,l.created_at,l.id
    `;
    const reviews = await sql<{
      draft_id: number; accepted_artifact_id: number; accepted_artifact_sha256: string;
      reviewed_by: string; resolution_note: string; reviewed_at: string;
    }>`
      select draft_id,accepted_artifact_id,accepted_artifact_sha256,reviewed_by,resolution_note,reviewed_at
        from meeting_draft_transcript_revision_reviews
       where newsroom_id=${owned(context)} and draft_id=any(${ids})
       order by draft_id,reviewed_at,id
    `;
    return drafts.map((draft) => ({
      id: Number(draft.id), headline: draft.headline, dek: draft.dek, topic: draft.topic, updatedAt: draft.updated_at,
      transcriptLinks: links.filter((link) => Number(link.draft_id) === Number(draft.id)).map((link) => ({
        id: Number(link.id), artifactId: Number(link.artifact_id), sha256: link.sha256,
        videoId: link.video_id, isCurrent: link.is_current, revisionNotice: link.revision_notice,
        citationCount: (() => { try { const value = JSON.parse(link.citation_snapshot) as unknown; return Array.isArray(value) ? value.length : 0; } catch { return 0; } })(),
      })),
      transcriptReviews: reviews.filter((review) => Number(review.draft_id) === Number(draft.id)).map((review) => ({
        acceptedArtifactId: Number(review.accepted_artifact_id), acceptedArtifactSha256: review.accepted_artifact_sha256,
        reviewedBy: review.reviewed_by, note: review.resolution_note, reviewedAt: review.reviewed_at,
      })),
    }));
  });

export const getDraftHistoryItem = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftHistoryInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: number; headline: string; dek: string; body: string; topic: string; updated_at: string;
    }>`
      select id,headline,dek,body,topic,updated_at from drafts
       where id=${data.draftId} and lead_id=${data.leadId} and newsroom_id=${owned(context)} limit 1
    `;
    const draft = rows[0];
    if (!draft) return null;
    const links = await sql<{
      id: number; artifact_id: number; citation_snapshot: string; revision_notice: string | null;
      is_current: boolean; video_id: string; sha256: string;
    }>`
      select l.id,l.artifact_id,l.citation_snapshot,l.revision_notice,l.is_current,a.video_id,a.sha256
        from meeting_draft_transcript_links l
        join meeting_transcript_artifacts a on a.id=l.artifact_id and a.newsroom_id=l.newsroom_id
       where l.newsroom_id=${owned(context)} and l.draft_id=${data.draftId}
       order by l.created_at,l.id
    `;
    const details = [];
    for (const link of links) {
      let parsed: { segmentIndex: number; captionSha256?: string }[] = [];
      try {
        const value = JSON.parse(link.citation_snapshot) as unknown;
        if (Array.isArray(value)) parsed = value as typeof parsed;
      } catch { /* report malformed history without inventing citations */ }
      const indices = parsed.map((citation) => Number(citation.segmentIndex)).filter(Number.isInteger);
      const segments = indices.length ? await sql<{
        segment_index: number; start_seconds: number; excerpt: string; caption_sha256: string;
      }>`
        select segment_index,start_seconds,excerpt,caption_sha256 from meeting_transcript_segments
         where artifact_id=${link.artifact_id} and segment_index=any(${indices}) order by segment_index
      ` : [];
      details.push({
        id: Number(link.id), artifactId: Number(link.artifact_id), sha256: link.sha256,
        videoId: link.video_id, isCurrent: link.is_current, revisionNotice: link.revision_notice,
        citations: parsed.map((citation) => {
          const segment = segments.find((row) => Number(row.segment_index) === Number(citation.segmentIndex));
          return {
            segmentIndex: Number(citation.segmentIndex),
            timestampSeconds: segment ? Number(segment.start_seconds) : null,
            excerpt: segment?.excerpt ?? null,
            captionSha256: citation.captionSha256 ?? null,
            segmentAvailable: Boolean(segment && segment.caption_sha256 === citation.captionSha256),
          };
        }),
      });
    }
    const reviews = await sql<{
      id: number; accepted_artifact_id: number; accepted_artifact_sha256: string;
      accepted_citation_snapshot: string; reviewed_by: string; resolution_note: string; reviewed_at: string;
    }>`
      select id,accepted_artifact_id,accepted_artifact_sha256,accepted_citation_snapshot,reviewed_by,resolution_note,reviewed_at
        from meeting_draft_transcript_revision_reviews
       where newsroom_id=${owned(context)} and draft_id=${data.draftId}
       order by reviewed_at,id
    `;
    return {
      id: Number(draft.id),
      headline: draft.headline,
      dek: draft.dek,
      body: draft.body,
      topic: draft.topic,
      updatedAt: draft.updated_at,
      transcriptLinks: details,
      transcriptReviews: reviews.map((review) => {
        let raw: unknown = null;
        try { raw = JSON.parse(review.accepted_citation_snapshot) as unknown; } catch { /* malformed record is displayed as unavailable */ }
        const citations = Array.isArray(raw)
          ? raw.map((value) => {
              const citation =
                value && typeof value === "object" ? (value as Record<string, unknown>) : {};
              const numberOrNull = (field: unknown) => typeof field === "number" && Number.isFinite(field) ? field : null;
              return {
            sourceSegmentIndex: numberOrNull(citation.sourceSegmentIndex),
            acceptedSegmentIndex: numberOrNull(citation.acceptedSegmentIndex),
            acceptedTimestampSeconds: numberOrNull(citation.acceptedTimestampSeconds),
            excerpt: typeof citation.excerpt === "string" ? citation.excerpt : null,
            captionSha256: typeof citation.captionSha256 === "string" ? citation.captionSha256 : null,
          };
            })
          : [];
        return {
          id: Number(review.id), acceptedArtifactId: Number(review.accepted_artifact_id),
          acceptedArtifactSha256: review.accepted_artifact_sha256, reviewedBy: review.reviewed_by,
          note: review.resolution_note, reviewedAt: review.reviewed_at, citations,
        };
      }),
    };
  });

async function queryPublishedRows(context: { newsroomId: number }): Promise<DeskPublishedRow[]> {
  const sql = await getSql();
  const arts = await sql<{
    id: number;
    slug: string;
    headline: string;
    dek: string;
    topic: string;
    published_at: string;
    lead_id: number | null;
    lead_score: number | null;
    body: string | null;
  }>`
    select a.id, a.slug, a.headline, a.dek, a.topic, a.published_at, a.lead_id,
      a.body, l.newsworthiness as lead_score
    from articles a
    left join leads l on l.id = a.lead_id
    where a.newsroom_id = ${owned(context)} and a.status = ${"published"}
    order by a.published_at desc nulls last, a.id desc
  `;
  if (!arts.length) return [] as DeskPublishedRow[];
  const corrs = await sql<{ article_id: number | null; body: string; created_at: string }>`
    select article_id, body, created_at
    from corrections
    where newsroom_id = ${owned(context)} and article_id is not null
    order by created_at asc
  `;
  const byArt = new Map<number, { date: string; body: string }[]>();
  for (const c of corrs) {
    if (c.article_id == null) continue;
    const list = byArt.get(c.article_id) ?? [];
    list.push({ date: c.created_at, body: c.body });
    byArt.set(c.article_id, list);
  }
  const reviews = await loadPublishedMeetingReviews(sql, owned(context));
  const reviewsByArticle = new Map<number, PublishedMeetingReview[]>();
  for (const review of reviews) {
    const list = reviewsByArticle.get(review.article.id) ?? [];
    list.push(review);
    reviewsByArticle.set(review.article.id, list);
  }
  return arts.map((a) => ({
    ...a,
    lead_score: a.lead_score == null ? null : Number(a.lead_score),
    /*
      `articles.body` is nullable in the schema and every path that publishes
      writes it, but the desk must not hand a component a null where it
      expects the story's words: an editor-opening box seeded from null would
      read as "this story has no text".
    */
    body: String(a.body ?? ""),
    corrections: byArt.get(a.id) ?? [],
    transcriptReviews: reviewsByArticle.get(a.id) ?? [],
  }));
}

/**
 * The whole published list, for the readers that genuinely need all of it:
 * the Queue's near-duplicate matching, `desk.legal-removals`' article picker,
 * the import screen and Today. The Published SCREEN does not call this any
 * more -- it calls `listPublishedDeskPage` below, which sends it 25 rows.
 */
export const listPublishedDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => queryPublishedRows(context));

/**
 * The Published screen's window (Unit CZ-long-lists).
 *
 * The real desk holds 214 printed stories -- 17,615 px of them, drawn as a list
 * of seven. This returns the pill-and-search match cut to the page the editor
 * has asked for, plus the true total and the pill counts, so the screen can say
 * "Showing 25 of 214" and a pill can count the list rather than the page.
 *
 * The filter runs HERE, before the cut, which is why it lives in
 * `published-rows.ts` as a named decision rather than inline in the route: a
 * window cut before the filter would show whichever 25 rows happened to sort
 * first instead of the 25 the editor asked for.
 */
export const listPublishedDeskPage = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => cleanListWindow(input, PUBLISHED_FILTERS, "all"))
  .handler(async ({ context, data }) => {
    const all = await queryPublishedRows(context);
    const weekAgo = publishedWeekAgo(Date.now());
    const needle = publishedNeedle(data.search);
    const matched = all.filter((row) => publishedMatches(row, data.filter, needle, weekAgo));
    const { rows, total } = takeWindow(matched, data.offset, data.limit);
    return { rows, total, counts: publishedFilterCounts(all, weekAgo) };
  });

/**
 * Deleting, which the desk could not do at all.
 *
 * Kill is not delete. A killed lead stays on the desk under Killed, which is
 * right for "not this one" and wrong for "this should not exist" — a lead filed
 * against the wrong person, a scan that swept up something private, a story
 * that should never have printed. The operator's rule is that an editor can
 * always remove something, before or after it prints.
 *
 * These are real deletes, not a status. Each one is audited, and each one is
 * behind a confirm in the UI that says what will happen.
 */
export const deleteLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((leadId: unknown) => rowId.parse(leadId))
  .handler(async ({ context, data: leadId }) => {
    const sql = await getSql();
    /*
      `drafts.lead_id` cascades, so the drafts go with it. `articles.lead_id`
      is ON DELETE SET NULL, so a printed story SURVIVES its lead being
      deleted — deliberately. Removing something from the paper is a separate,
      louder action.
    */
    const { keepACopy, snapshotLead } = await import("./trash");
    const snapshot = await snapshotLead(sql, leadId);
    if (!snapshot) return { ok: false as const, error: "That lead is already gone." };

    // Copy first, then delete. The other order loses the row if the delete
    // succeeds and the copy throws.
    const trashId = await keepACopy({
      sql,
      newsroomId: owned(context),
      userId: context.userId,
      kind: "lead",
      refId: leadId,
      label: String(snapshot.row.headline ?? "A lead"),
      snapshot,
    });

    const gone = await sql<{ id: number; headline: string }>`
      delete from leads
      where id = ${leadId} and newsroom_id = ${owned(context)}
      returning id, headline
    `;
    if (!gone[0]) {
      await sql`delete from deleted_items where id = ${trashId}`.catch(() => undefined);
      return { ok: false as const, error: "That lead is already gone." };
    }
    await audit(context.userId, "delete-lead", gone[0].headline.slice(0, 120), owned(context));
    return { ok: true as const, trashId };
  });

/**
 * Take a story off the paper.
 *
 * This is the loud one. The URL becomes a 404, the feed and the sitemap drop
 * it, and anyone holding a link to it has a dead link. That is the operator's
 * call to make, not the software's — but the confirm says it plainly, because
 * the paper's own convention is that a printed piece is corrected rather than
 * quietly changed, and this is the exception to it.
 *
 * The lead, if there was one, goes back to `drafted` so the story can be
 * reworked and printed again rather than being stranded as published.
 */
export const deleteArticle = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((slug: unknown) => slugInput.parse(slug))
  .handler(async ({ context, data: slug }) => {
    const sql = await getSql();
    const found = await sql<{ id: number }>`
      select id from articles where slug = ${slug} and newsroom_id = ${owned(context)} limit 1
    `;
    if (!found[0]) return { ok: false as const, error: "That story is already gone." };

    const { keepACopy, snapshotArticle } = await import("./trash");
    const snapshot = await snapshotArticle(sql, found[0].id);
    if (!snapshot) return { ok: false as const, error: "That story is already gone." };
    const trashId = await keepACopy({
      sql,
      newsroomId: owned(context),
      userId: context.userId,
      kind: "article",
      refId: found[0].id,
      label: String(snapshot.row.headline ?? slug),
      snapshot,
    });

    /*
      Corrections FIRST, then the article, and both inside one transaction.

      `corrections.article_id` is ON DELETE SET NULL. This used to delete the
      article and then run `delete from corrections where article_id = <id>` —
      by which time Postgres had already nulled that column, so the cleanup
      matched nothing. The correction survived, detached, and the public
      corrections page prints it forever under no headline.

      That is the worst possible thing to leave behind: correction text repeats
      the error it is correcting, and an editor deleting a story is usually
      deleting it precisely to take that sentence off the paper.

      One transaction, so a failure halfway cannot leave the story gone and its
      corrections standing. Audit finding ENG-005.
    */
    const { withTransaction } = await import("@/lib/db");
    let gone: { id: number; headline: string; lead_id: number | null } | undefined;
    try {
      gone = await withTransaction(async (tx) => {
        await tx`delete from corrections where article_id = ${found[0]!.id}`;
        const rows = await tx<{ id: number; headline: string; lead_id: number | null }>`
          delete from articles
          where slug = ${slug} and newsroom_id = ${owned(context)}
          returning id, headline, lead_id
        `;
        if (!rows[0]) throw new Error("gone");
        if (rows[0].lead_id != null) {
          await tx`
            update leads set status = 'drafted'
            where id = ${rows[0].lead_id} and newsroom_id = ${owned(context)}
              and status = 'published'
          `;
        }
        return rows[0];
      });
    } catch {
      await sql`delete from deleted_items where id = ${trashId}`.catch(() => undefined);
      return { ok: false as const, error: "That story is already gone." };
    }
    await audit(
      context.userId,
      "delete-article",
      `${slug} — ${gone.headline.slice(0, 100)}`,
      owned(context),
    );
    return { ok: true as const, trashId };
  });
