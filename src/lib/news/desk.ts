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
import { slugify, parseUrlList } from "@/lib/paper";
import { getPaperConfig, getPaperPlace } from "./paper-settings";
import { assertHttpUrl, sha256 } from "./url-guard";
import { parseHttpUrl, parseSourceLines } from "./source-lines.ts";
import { ingestUrl, ingestDocument, mapLimit, withRetry } from "./ingest";
import { assertCooldown, assertRate, audit } from "./ops";
import { scanSystem, grokChat, parseJsonBlock, probeProvider, providerBudget, type EffectiveProviderChoice } from "./ai";
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
import { disclosureLine } from "./import-stories.ts";
import { findDuplicate } from "./import-review.ts";
import { recordDraftTranscriptRevisionReview } from "./meeting-draft-revision-review.ts";
import { staleMeetingCitations, staleCitationNotice } from "./meeting-publish-guard.ts";
import { lockMeetingsForDraftPublish } from "./meeting-revision-lock.ts";
import {
  listPublishedMeetingReviews as loadPublishedMeetingReviews,
  recordPublishedMeetingEvidence,
  resolvePublishedMeetingReview,
  type PublishedMeetingReview,
} from "./meeting-article-revision.ts";
import { deriveFocusedUsedCitations, deriveUsedCitations } from "./meeting-draft-citations.ts";
import { meetingDraftSourceUrls } from "./meeting-draft-input.ts";
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
  aiFollowUpInput,
  aiFollowUpUpdateInput,
  followUpActionInput,
  followUpFindingsInput,
  followUpsInput,
  jobIdInput,
  leadIdInput,
  leadStatusInput,
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
  slugInput,
  sourceStatusInput,
  suggestedSourceReviewInput,
  writeStoryInput,
  cleanPublishRequest,
  suggestHeadlinesInput,
  updateArticleHeadlineInput,
  correctionWordingInput,
} from "./request-input.ts";
import {
  evidenceNeedsReview,
  evidenceReviewToken,
  mayInheritLeadSources,
} from "./draft-evidence.ts";
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
} from "./outlet-credit";
import {
  buildScanUserMessage,
  composeZeroLeadSummary,
  editorFetchError,
  kindFromSourceUrl,
  resurfacedSummarySentence,
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
import { readModelAssignments } from "./model-assignments-store.ts";
import { resolveJobModel } from "./model-assignments.ts";
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
  waitForModel,
  type DeskJob,
} from "./jobs";
import { newPullReceipt, parsePullReceipt, type PullRunView } from "./pull.server.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership";
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
  return sql<SourceRow>`
      select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error,
             -- 0115 (SH0-1): the failure streak the two scan write sites keep, so
             -- the row can say "Keeps failing" rather than repeating the last
             -- reason for ever. last_ok_at is the only column in this schema
             -- that answers "when did this last READ" -- last_fetched_at moves
             -- on a failed attempt too.
             consecutive_failures, failure_streak_started_at, last_ok_at,
             -- 0097: why it was suggested, who suggested it, and where it came
             -- from. Null on every row that predates 0.6.70 = "not recorded".
             proposed_reason, proposed_by, proposed_scan_run_id, proposed_lead_id,
             proposed_section, reviewed_at, review_note,
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
      where newsroom_id = ${owned(context)}
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
}

/**
 * Every source, for the callers that need the whole list rather than a page:
 * the Today screen's rail, the scan settings dialog, the routine-notice
 * permissions dialog and the editor dialogs all ask "which sources are there".
 */
export const listSources = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => querySourceRows(context));

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
  }) as Promise<SourceRow | null>;
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
      data.tier || "A",
      owned(context),
    );
    if (!source) return { ok: false as const, error: "Could not save that source." };
    return { ok: true as const, source };
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
      if (source) {
        added += 1;
        if (row.tier === "A" || row.tier === "B" || row.tier === "C") {
          byTier[row.tier] += 1;
        }
      }
    }
    return { ok: true as const, added, total: rows.length, byTier };
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
    select l.id, l.scan_run_id, l.headline, l.why, l.topic, l.topic_unchosen, l.status, l.source_urls, l.evidence,
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
  .handler(async ({ context, data }) => {
    const headline = data.headline.trim().slice(0, 180);
    const why = data.why.trim().slice(0, 800);
    if (headline.length < 8) {
      return { ok: false as const, error: "Headline needs a full sentence." };
    }
    if (why.length < 8) {
      return { ok: false as const, error: "Say why this is news." };
    }
    const topic = (data.topic || "council").slice(0, 40);
    let urls: string[] = [];
    if (data.url?.trim()) {
      try {
        urls = sanitizePublicUrls([assertHttpUrl(data.url.trim()).toString()]);
      } catch {
        return { ok: false as const, error: "That source URL is not a public http(s) address." };
      }
    }
    /*
      Unit BW3: the New story dialog's paste tab knows every page the pasted
      story cites, not only its original link, and the reader sees exactly what
      the DRAFT carries (`publishLead`, `desk.ts:3659`) -- so a story saved
      from that tab would publish with an empty Sources section while the page
      still promised "Sources shown." Dropped here rather than refused, the way
      the old paste panel dropped them (`sanitizePublicUrls` also de-dupes).
    */
    if (data.urls?.length) {
      urls = sanitizePublicUrls([...urls, ...data.urls]);
    }
    return insertLeadWithDraft(context, {
      headline,
      why,
      topic,
      urls,
      notesJson: packNotes({ ...parseNotes(null), suppliedUrls: urls }),
      /*
        Who wrote it, for the filing screen that asked. Every other caller
        sends nothing and the paper prints its own AI line
        (`ai-disclosure.tsx:33`).
      */
      disclosure: data.disclosureKey
        ? disclosureLine(data.disclosureKey, data.disclosureOther ?? "")
        : "",
      importedText: data.importedText === true,
      /*
        Unit BW5: the drawn New story dialog's paste tab files a story written
        elsewhere, and the Queue's Imported mark is drawn from `leads.origin`
        (`desk-leads.tsx:516`). The one-story paste panel this tab replaces was
        the import path, which wrote `origin = 'import'`
        (`import-stories.server.ts:402`) -- so the same paste filed from the
        drawn tab has to carry the same word or the mark the old panel put on
        the row disappears with the panel. Absent -- every other caller -- files
        no origin, which is the scanner lead's own answer (`0091`: null).
      */
      origin: data.origin,
    });
  });

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
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json,
             model_headline, model_topic, headline_source
      from drafts where lead_id = ${id} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    const live = await sql<{ id: number; slug: string; headline: string }>`
      select id, slug, headline from articles
      where lead_id = ${id} and newsroom_id = ${owned(context)} and status = 'published'
      limit 1
    `;
    const evidenceToken = drafts[0] ? evidenceReviewToken(drafts[0]) : "";
    const draft = drafts[0] ? unpackStoredDraft({ ...drafts[0] }) : null;
    const draftMeetingEvidence = drafts[0]
      ? await loadDraftMeetingEvidence(sql, { newsroomId: owned(context), draftId: Number(drafts[0].id) })
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
        const json = JSON.stringify(notes).slice(0, 8000);
        await sql`
          update leads set notes_json = ${json} where id = ${id} and newsroom_id = ${owned(context)}
        `;
        lead.notes_json = json;
      }
    }
    const job = await latestJob({ newsroomId: owned(context), kind: "draft", subjectId: id });
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
      notes.topicConfirmation?.token === topicConfirmationFingerprint(evidenceToken) &&
      notes.topicConfirmation.topic === String(drafts[0]?.topic ?? "").trim()
        ? notes.topicConfirmation.topic
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
      notes.unreviewedClaimsConfirmation?.token === topicConfirmationFingerprint(evidenceToken)
        ? notes.unreviewedClaimsConfirmation.count
        : 0;
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
      draft,
      draftMeetingEvidence,
      evidenceToken,
      topicConfirmed,
      unreviewedClaimsAcceptedCount,
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
      select id, started_at, finished_at, sources_fetched, leads_created, sources_proposed, sources_selected, sources_attempted, sources_failed, sources_analyzed, model_batches_used, model_batches_failed, failed_sources, meetings_found, meetings_captured, meetings_failed, meeting_failures, summary, error, execution_origin
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
    await ensureSeeds(context.userId, owned(context));
    const modelChoice = storyModelChoice(data.modelChoice);
    const { commitScanForAuthenticatedEditor } = await import("./model-request-commit.server.ts");
    return commitScanForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      modelChoice,
      modelEffort: modelEffort(modelChoice, data.modelEffort),
      sectionKey: data.sectionKey,
      customSourceIds: data.customSourceIds,
      packId: data.packId,
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
export async function performCheckOneSource(
  context: { userId: string; newsroomId?: number },
  sourceId: number,
  /*
    The cooldown, in seconds, overridable for the tests that press twice on
    purpose. Production passes nothing.
  */
  cooldownSeconds = 30,
): Promise<
  | { ok: true; title: string; url: string; characters: number; line: string }
  | { ok: false; url: string; title: string; error: string; line: string }
> {
  const sql = await getSql();
  const [src] = await sql.query<{ id: number; url: string; title: string; status: string }>(
    "select id,url,title,status from sources where id=$1 and newsroom_id=$2",
    [sourceId, owned(context)],
  );
  if (!src) {
    return {
      ok: false as const,
      url: "",
      title: "",
      error: "That source is not on this desk.",
      line: "That source is not on this desk.",
    };
  }
  if (src.status !== "accepted") {
    const line =
      src.status === "paused"
        ? "This source is paused. Resume it first, then check it."
        : "This source is not on the watch list.";
    return { ok: false as const, url: src.url, title: src.title, error: line, line };
  }
  /*
    Unit U24b: the pause is checked BEFORE anything is fetched, and comes back
    as an ordinary refusal rather than a thrown one -- every way this press can
    do nothing lands on the row through the same `line`, so the editor reads one
    shape of sentence whatever stopped it.
  */
  try {
    await assertCooldown(context.userId, `check-source:${sourceId}`, cooldownSeconds, owned(context));
  } catch (err) {
    const line = err instanceof Error ? err.message : "That was checked a moment ago.";
    return { ok: false as const, url: src.url, title: src.title, error: line, line };
  }
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
    */
    await sql.query(
      "update sources set last_fetched_at=now(), last_error=null, consecutive_failures=0, failure_streak_started_at=null, last_ok_at=now() where id=$1 and newsroom_id=$2",
      [sourceId, owned(context)],
    );
    return {
      ok: true as const,
      url: src.url,
      title: bundle.titleHint?.trim() || src.title,
      characters: text.length,
      line: "Read OK now.",
    };
  } catch (err) {
    const msg = postgresText(err instanceof Error ? err.message : "fetch failed");
    await sql.query(
      `update sources set last_error=$1, last_fetched_at=now(),
         consecutive_failures = sources.consecutive_failures + 1,
         failure_streak_started_at = coalesce(failure_streak_started_at, now())
       where id=$2 and newsroom_id=$3`,
      [msg, sourceId, owned(context)],
    );
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
}

export const checkOneSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((sourceId: unknown) => rowId.parse(sourceId))
  .handler(async ({ context, data: sourceId }) => performCheckOneSource(context, sourceId));

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
  };
  beforeScheduledCommit?: () => Promise<void>;
  scheduledCommit?: <T>(write: (sql: Sql) => Promise<T>) => Promise<T>;
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
  const failureReceipt = {
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
  const fetchUrl = deps.ingestUrl ?? ingestUrl;
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
  }>`select section_snapshot from scan_runs where id=${runId} and newsroom_id=${owned(context)}`;
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
  const allSources =
    deps.scheduledSnapshot?.sources ??
    (await sql<SourceRow>`
      select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
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
  const pendingSourceTouches: { id: number; error: string | null }[] = [];
  const pendingDisappeared: { title: string; url: string; error: string }[] = [];
  // P0-3: which sources failed and why, so the editor sees the set, not a count.
  const failedSources: { id: number; title: string; url: string; error: string }[] = [];
  let fetchedCount = 0;
  const SCAN_WATCH_CAP = 200;
  const watchSlice = sources.slice(0, SCAN_WATCH_CAP);
  failureReceipt.sourcesAttempted = watchSlice.length;

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

    Up to two hundred pages, six at a time, and until this the whole pass
    reported nothing at all -- not a stage, not a count, not a heartbeat. The
    card could only say "Working…" for as long as it took, which on a real watch
    list is minutes, and the run row in the database kept reading zero fetched
    until the very end (see `noteSourceProgress`).

    Two writes, deliberately: `reportStage` is the throttled job progress (the
    card's bar and "Now:" line), and the run-row write below is what the Scan
    and Sources screens poll -- they read `scan_runs`, not `desk_jobs`.
  */
  let attemptedCount = 0;
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
          sources_attempted = ${watchSlice.length},
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
  await mapLimit(watchSlice, 6, async (src) => {
    await deps.scheduledGuard?.();
    try {
      const bundle = await withRetry(async () => {
        await deps.scheduledGuard?.();
        return fetchUrl(src.url);
      });
      const sourceText = postgresText(bundle.text);
      const extras: { url: string; text: string }[] = [];
      for (const extra of bundle.extras.slice(0, 4)) {
        await deps.scheduledGuard?.();
        try {
          const doc = await withRetry(async () => {
            await deps.scheduledGuard?.();
            return fetchUrl(extra);
          });
          extras.push({ url: extra, text: postgresText(doc.text) });
        } catch (err) {
          if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(String(err)))
            throw err;
          /* skip a bad packet */
        }
      }
      const extraBits = extras.map((e) => `DOCUMENT ${e.url}\n${e.text.slice(0, 2500)}`);
      const text = extraBits.length ? `${sourceText}\n\n${extraBits.join("\n\n")}` : sourceText;
      const hash = await sha256(text);
      const changed = hash !== src.last_hash;
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, error: null });
      else
        /*
          SH0-1: the streak is written in the SAME statement that clears
          `last_error`, on both commit paths, because a success is the only
          thing that can end a streak and a second statement could be skipped
          without anything noticing. `last_ok_at` is new information -- see
          0115 -- and this is its one writer.
        */
        await sql`
        update sources set last_fetched_at = now(), last_error = null,
          consecutive_failures = 0, failure_streak_started_at = null, last_ok_at = now()
        where id = ${src.id} and newsroom_id = ${owned(context)}
      `;
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
      await noteSourceProgress();
    } catch (err) {
      const msg = postgresText(err instanceof Error ? err.message : "fetch failed");
      if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(msg)) throw err;
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, error: msg });
      else
        /*
          SH0-1: the count is carried by the DATABASE, not read-then-written by
          this process -- six sources are in flight at once and two attempts at
          the same row must not both read the same number. The streak's start is
          `coalesce`d so the second failure in a row does not move it: "first
          failed <date>" must name the first.
        */
        await sql`
        update sources set last_error = ${msg}, last_fetched_at = now(),
          consecutive_failures = sources.consecutive_failures + 1,
          failure_streak_started_at = coalesce(failure_streak_started_at, now())
        where id = ${src.id} and newsroom_id = ${owned(context)}
      `;
      failedSources.push({ id: src.id, title: src.title, url: src.url, error: msg });
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
  });

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
              choice === "local-model" ? scanLocalModel ?? undefined : undefined,
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
          sources_attempted = ${watchSlice.length},
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

  const recordManualFailure = async (failure: string, sourcesAnalyzed = 0) =>
    withTransaction(async (writeSql) => {
      if (!(await lockManualScanClaim(writeSql, job))) return false;
      await recordFailedRun(writeSql, failure, sourcesAnalyzed);
      await refreshManualScanClaim(writeSql, job);
      return true;
    });

  if (!batchResults.length) {
    /*
      A run with ZERO batches never reached a model at all: `buildScanBatches`
      returns nothing when no source yielded text (scan-batches.ts), so the only
      thing that failed is the fetch. Reporting the model-shaped fallback for
      that case sent its reader to the provider when the source had simply not
      resolved -- measured in Unit AA2, where a scheduled run recorded
      `sources_fetched 0`, `model_batches_used 0` and zero chat calls at the
      stubbed rung, yet failed as "Writing pass returned no usable JSON." The
      first failed source's own message is the truth when there is one; the
      model-shaped fallback stays for the batches-ran-and-were-unreadable case.
    */
    const error =
      lastBatchError ??
      (batches.length === 0
        ? `Scan fetched no source text, so no writing pass ran.${
            failedSources[0] ? ` First source failed: ${failedSources[0].error}` : ""
          }`
        : "Writing pass returned no usable JSON.");
    /*
      Record the failed run on BOTH commit paths.

      This wrote the scan_runs row only when there was no scheduledCommit, so a
      SCHEDULED scan in which every model batch failed threw before anything was
      persisted: no counts, no coverage line, no error row. The desk then showed
      nothing at all, and "the scan ran and everything failed" was
      indistinguishable from "the scan never ran" -- the exact silent-failure
      class the coverage accounting exists to eliminate.

      The scheduled path commits through the caller-supplied transaction so the
      write lands in the same unit of work as the rest of a scheduled run.
    */
    if (deps.scheduledCommit) {
      await deps.scheduledCommit((writeSql) => recordFailedRun(writeSql, error));
    } else {
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
    source_urls: string;
    created_at: string;
    why: string | null;
    evidence: string | null;
  }>`
    select id, status, headline, source_urls, created_at, why, evidence
    from leads
    where newsroom_id = ${owned(context)}
      and status <> 'published'
      and created_at >= now() - (${MATCH_LOOKBACK_DAYS} || ' days')::interval
  `;
  const existingLeads: MatchCandidateLead[] = existingLeadsRaw.map((l) => ({
    id: l.id,
    status: l.status,
    headline: l.headline,
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

    The model is the one this newsroom assigned to the `lead-score` job -- the
    row the Models screen already draws as "Lead scoring & duplicates / Scores
    leads, spots ≈ printed" -- resolved through the same order every other job
    uses (`resolveJobModel`: an explicit pick, then the saved rows, then the
    surface's default, which is Automatic and therefore the ladder's first rung,
    DeepSeek v4.1 Flash). Nothing here hard-codes a provider, and the answer
    records which model actually replied rather than which one was meant to.

    The SCHEDULED scan is the one exception, and it is a transport fact rather
    than a second policy: that lane is pinned to exactly one runtime
    (`forcedChat`, daily-scan.server.ts), so the check runs on the model the
    scan itself is already running on. There is no other transport available to
    hand a per-job assignment to.

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
      const assigned = deps.scheduledCommit
        ? String(job.model_choice)
        : (
            await resolveJobModel({
              jobKey: "lead-score",
              explicit: null,
              assignments: await readModelAssignments(job.newsroom_id).catch(() => []),
            })
          ).providerId;
      const dupChoice = assigned as EffectiveProviderChoice;
      const dupTimeoutMs = Math.min(batchTimeoutMs(assigned), DUP_CHECK_TIMEOUT_MS);
      dupCheck = await runDupCheck({
        pairs: collected.pairs,
        skipped: collected.skipped,
        chat: async (system, user, maxTokens) => {
          const got = await runChat(system, user, maxTokens, {
            timeoutMs: dupTimeoutMs,
            choice: dupChoice,
            newsroomId: job.newsroom_id,
          });
          return got.ok
            ? { ok: true as const, text: got.text, model: got.meta?.model ?? null }
            : { ok: false as const, error: got.error };
        },
      });
    }
  } catch (error) {
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
    for (const touch of pendingSourceTouches) {
      /*
        SH0-1: the SCHEDULED scan's half of the streak, and it is a separate
        statement from the inline path's for the reason `scan-coverage.test.ts`
        exists -- a source touch committed here once went without something the
        inline write had. `touch.error` is null on the sources this pass read
        and a message on the ones it could not, so the one statement carries
        both outcomes and the two paths cannot disagree.
      */
      await writeSql`
        update sources set
          last_error = ${touch.error},
          last_fetched_at = now(),
          consecutive_failures = case when ${touch.error}::text is null then 0
            else sources.consecutive_failures + 1 end,
          failure_streak_started_at = case when ${touch.error}::text is null then null
            else coalesce(failure_streak_started_at, now()) end,
          last_ok_at = case when ${touch.error}::text is null then now() else last_ok_at end
        where id = ${touch.id} and newsroom_id = ${owned(context)}
      `;
    }
    for (const gone of pendingDisappeared) {
      await writeSql`
        insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
        values (${context.userId}, ${owned(context)}, 'disappeared', ${`Watched source failed after previously succeeding: ${gone.title}`}, ${gone.url}, ${gone.error})
      `;
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
    let summary = String(data.editor_summary ?? "").slice(0, 1200);
    if (leadsCreated === 0 && !summary)
      summary = composeZeroLeadSummary({
        fetched: fetchedCount,
        changed: pendingHashes.filter((p) => p.changed).length,
      });
    const resurfacedSentence = resurfacedSummarySentence({
      resurfacedKilled,
      resurfacedOpen,
      possibleMatched,
      // Unit AK item 2: a developing finding is filed too, but it is not a
      // brand-new story for the desk -- it is an old one that came back -- so
      // it is named by its own bit rather than counted as "filed as new".
      filedNew: leadsCreated - possibleMatched - developingFiled,
      developingFiled,
      firstDiscardedHeadline,
      mergedSameScan,
    });
    if (resurfacedSentence)
      summary = summary ? `${summary} ${resurfacedSentence}`.slice(0, 1200) : resurfacedSentence;
    const meetingCoverageLine = meetingAwareness?.coverageLine ?? "";
    if (meetingCoverageLine)
      summary = summary ? `${summary} ${meetingCoverageLine}`.slice(0, 1200) : meetingCoverageLine;
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
          sources_attempted = ${watchSlice.length},
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
    if (!deps.scheduledCommit) {
      const failure = postgresText(error instanceof Error ? error.message : String(error));
      try {
        await withTransaction(async (receiptSql) => {
          if (!(await lockManualScanClaim(receiptSql, job))) return;
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
                summary = null,
                error = coalesce(error, ${failure.slice(0, 800)})
            where id = ${failureRunId} and newsroom_id = ${job.newsroom_id} and finished_at is null
          `;
          await refreshManualScanClaim(receiptSql, job);
        });
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
  if (lead.status === "killed") throw new Error("Restore this lead before drafting.");
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
          artifactId: Number(lead.meeting_artifact_id),
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
  const batchLocalModel = batchSnapshot?.runtime === "local" ? batchSnapshot.localModel : null;
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
        // A batch job's document stage moves along the hand-pick ladder with
        // its writer (see FORCED_FAILOVER_LADDER): a batch row cannot hold one
        // of Automatic's own rungs. An ordinary Story job keeps the shared
        // Automatic ladder.
        ladder: batchSnapshot ? FORCED_FAILOVER_LADDER : undefined,
        localModel: queuedLocalModel ?? undefined,
        probe: (choice) => probe(choice, owned(context), undefined, "story", choice === "local-model" ? queuedLocalModel ?? undefined : undefined),
        chat: deps.chat,
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, nextEffort, reason }) => {
          await setJobModelRuntime(job.id, nextChoice, nextEffort);
          job.model_choice = nextChoice;
          job.result_json = JSON.stringify({ modelEffort: nextEffort });
          await setStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
          const switchNote = failoverNoteSentence(nextLabel, previousLabel, reason);
          await setFailoverNote(job.id, switchNote);
          if (batchSnapshot) {
            if (nextChoice === "auto" || nextChoice === "configured" || isAutomaticRungId(nextChoice))
              throw new Error("Draft batch fallback did not resolve to a selectable runtime.");
            const old = batchSnapshot as typeof batchSnapshot & { requestedRuntime?: string; requestedEffort?: ModelEffort | null };
            const { validateForcedRuntime } = await import("./forced-runtime.server.ts");
            const validateBatchRuntime = deps.validateBatchRuntime ?? validateForcedRuntime;
            const nextSnapshot = await validateBatchRuntime(job.newsroom_id, nextChoice, nextEffort);
            const receipt = {
              requestedRuntime: old.requestedRuntime ?? old.runtime,
              requestedEffort: old.requestedEffort ?? ("modelEffort" in old ? old.modelEffort ?? null : null),
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
      const [saved] = await transactionSql<DraftRow>`
        insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json,model_headline,headline_source)
        values(${context.userId},${owned(context)},${leadId},${storableText(checkpointHeadline.headline)},${storableText(checkpoint.dek)},${storableText(checkpoint.body)},${lead.topic},${JSON.stringify(checkpoint.source_urls)},${storableText(integrityNotes)},${JSON.stringify(provenance)},${storableText(String(checkpoint.form ?? ""))},${JSON.stringify(sanitizeJsonLeaves(checkpoint.found ?? null))},${JSON.stringify(sanitizeJsonLeaves(Array.isArray(checkpoint.unanswered) ? checkpoint.unanswered : []))},${checkpointResearchJson},${storableText(checkpointHeadline.modelHeadline)},${checkpointHeadline.source})
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
      job.result_json = JSON.stringify({ modelEffort: nextEffort });
      activeReportSnapshot = { modelChoice: nextChoice, modelEffort: nextEffort };
    };
    draftInput.onProviderSwitch = async ({ transport, model, reason }) => {
      const nextChoice: EffectiveProviderChoice | null = transport === "codex"
        ? "codex-balanced"
        : transport === "anthropic" || transport === "claude-code"
          ? (/haiku/i.test(model) ? "claude-haiku" : "claude-sonnet")
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
      const switchState: { receipt: null | {
        requestedRuntime: string;
        requestedEffort: ModelEffort | null;
        switchReason: string;
        switchNote: string;
      } } = { receipt: null };
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
        source: "editor",
        run,
        probe: (choice) => probe(choice, job.newsroom_id),
        ladder: FORCED_FAILOVER_LADDER,
        resolve: (choice) => {
          // Unreachable with FORCED_FAILOVER_LADDER, which carries no rung --
          // but Automatic's own rung is not a runtime a batch row can hold, so
          // it must never reach the batch validator either.
          if (isAutomaticRungId(choice))
            throw new Error("A draft batch cannot run on Automatic's own rung.");
          return validateBatchRuntime(
            job.newsroom_id,
            choice,
            "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort : null,
          );
        },
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
          void nextChoice;
          const old = activeBatchSnapshot as typeof activeBatchSnapshot & {
            requestedRuntime?: string;
            requestedEffort?: ModelEffort | null;
          };
          switchState.receipt = {
            requestedRuntime: old.requestedRuntime ?? old.runtime,
            requestedEffort: old.requestedEffort ?? ("modelEffort" in old ? old.modelEffort ?? null : null),
            switchReason: failoverReasonPhrase(previousLabel, reason),
            switchNote: failoverNoteSentence(nextLabel, previousLabel, reason),
          };
        },
      });
      activeBatchSnapshot = attempted.snapshot;
      if (switchState.receipt) {
        const receipt = switchState.receipt;
        const nextEffort = "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort ?? null : null;
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
            const nextChoice: EffectiveProviderChoice | null = transport === "codex"
              ? "codex-balanced"
              : transport === "anthropic" || transport === "claude-code"
                ? (/haiku/i.test(model) ? "claude-haiku" : "claude-sonnet")
                : null;
            if (!nextChoice || nextChoice === activeBatchSnapshot.modelChoice) return;
            const previousLabel = modelChoiceLabel(activeBatchSnapshot.modelChoice);
            const nextSnapshot = await validateBatchRuntime(
              job.newsroom_id,
              nextChoice,
              "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort : null,
            );
            const old = activeBatchSnapshot as typeof activeBatchSnapshot & { requestedRuntime?: string; requestedEffort?: ModelEffort | null };
            const receipt = {
              requestedRuntime: old.requestedRuntime ?? old.runtime,
              requestedEffort: old.requestedEffort ?? ("modelEffort" in old ? old.modelEffort ?? null : null),
              switchReason: failoverReasonPhrase(previousLabel, reason),
              switchNote: failoverNoteSentence(modelChoiceLabel(nextChoice), previousLabel, reason),
            };
            activeBatchSnapshot = nextSnapshot;
            const nextEffort = "modelEffort" in nextSnapshot ? nextSnapshot.modelEffort ?? null : null;
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
    The single longest await in the app: one call covering report.ts's plan,
    write, verify and sourcing passes, four sequential model calls that
    routinely run past the 60s stall window. Without the ticker the card would
    call a working draft stalled and offer the editor a retry that spends the
    model budget twice.
  */
  const reported = await waitForModel({
    jobId: job.id,
    label: modelChoiceLabel(effectiveStoryModelChoice(job.model_choice)),
    run: () =>
      runReportWithCheckpoint({
        ...draftInput,
        modelChoice: effectiveStoryModelChoice(job.model_choice),
      }),
  });
  if ("error" in reported) throw new Error(reported.error);

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
      meetingEvidence: { used: meetingMaterial != null },
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
  const notesJson = packNotes(sanitizeJsonLeaves(nextNotes));

  await withClaimedLeadDraftLock(job, leadId, async (sql) => {
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
      model_headline, model_topic, headline_source
    )
    values (
      ${context.userId}, ${owned(context)}, ${leadId}, ${storableText(headline.headline)},
      ${storableText(reported.dek)}, ${draftBody},
      ${storableText(reported.topic)}, ${sourceUrls}, ${notes},
      ${provenanceJson}, ${storableText(reported.form)}, ${storableText(reported.found_note)},
      ${unansweredJson},
      ${researchJson},
      ${storableText(headline.modelHeadline)}, ${storableText(reported.topic)}, ${headline.source}
    )
    returning id
  `;
    if (savedDraft) {
      let transcriptLinkCreated = false;
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
        sanitizeJsonLeaves(
          buildDraftCompletionReceipt({
            checkpointDraftId,
            finalDraftId: Number(savedDraft.id),
            citationStatus:
              transcriptLinkCreated ? "complete" : meetingMaterial ? "review-required" : reported.citation_status ??
              (reported.source_urls.length || (reported.documentClaims?.length ?? 0) > 0
                ? "complete"
                : "review-required"),
            evidenceCheckIncomplete: notes.includes(
              "Evidence reconciliation not completed within the available edit pass.",
            ),
            nameCheck: reported.research_memo.nameCheck,
            styleAudit: styleAuditSummary(styleRecord),
          }),
        ),
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
async function queryDraftRows(context: { newsroomId: number }) {
  const { ensureJobsSchema } = await import("./jobs.ts");
  await ensureJobsSchema();
  const sql = await getSql();
  return sql<{
    id: number;
    lead_id: number;
    headline: string;
    dek: string | null;
    topic: string | null;
    form: string | null;
    updated_at: string;
    /** Has any prose been written into this draft row yet? See the CTE note. */
    has_body: boolean;
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
  }>`
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
      where d.newsroom_id = ${owned(context)}
        -- "Everything not yet printed": a killed lead, or one already
        -- published, is not a draft on the desk.
        and l.status in ('new','drafted','held')
      order by d.lead_id, d.updated_at desc, d.id desc
    )
    select v.id, v.lead_id,
           coalesce(nullif(v.headline, ''), v.lead_headline) as headline,
           v.dek, v.topic, v.form, v.updated_at, v.lead_status, v.origin,
           v.newsworthiness, v.why, v.model_headline, v.headline_source, v.has_body,
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
      where j.newsroom_id = ${owned(context)} and j.kind = 'draft' and j.subject_id = v.lead_id
      order by j.id desc limit 1
    ) jb on true
    -- Newest work first: the draft an editor just touched is the one they
    -- came back for. A running job moves its own updated_at heartbeat, so
    -- a story being written right now holds the top of the list while it is
    -- being written.
    order by greatest(v.updated_at, coalesce(jb.updated_at, v.updated_at)) desc, v.id desc
  `;
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
    return readImportStructure({
      text: data.text,
      newsroomId: owned(context),
      modelChoice: data.modelChoice,
      modelEffort: data.modelEffort,
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
      { text: data.text, tool: data.tool, stories: data.stories },
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

export const pullTodo = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => pullTodoInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      await assertRate(context.userId, "pull", owned(context));
      await ensureDeskDraftMemoSchema();
      const sql = await getSql();
      const rows = await sql<{ id: number }>`
        select id from leads
        where id = ${data.leadId} and newsroom_id = ${owned(context)} limit 1
      `;
      if (!rows[0]) return { ok: false as const, error: "Lead not found" };
      const query = data.query.trim().slice(0, 240);
      if (query.length < 4)
        return { ok: false as const, error: "That line is too thin to search." };
      /*
        0.6.74: a claim's Pull reads the claim's own source page rather than
        searching for it. Only an http(s) URL is honoured; anything else falls
        back to the search an ordinary Pull runs, and the page is checked by
        the desk's URL guard at fetch time (`ingestDocument`), never here.
      */
      const rawUrl = data.url?.trim() ?? "";
      const sourceUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl.slice(0, 2_000) : null;
      const open = await findOpenJob({
        newsroomId: owned(context),
        kind: "pull",
        subjectId: data.leadId,
      });
      if (open) {
        return {
          ok: false as const,
          error:
            "This story already has a Pull running. Its live progress is shown beside the reporting line.",
        };
      }
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
      await assertRate(context.userId, "pull", owned(context));
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
    const sql = await getSql();
    const reason = data.killReason?.trim();
    if (data.status === "killed") {
      // Unit AK items 4 and 6 (migration 0094): a kill keeps a record. The
      // timestamp is always written -- "when was this killed" has an answer
      // the moment the kill happens -- and the reason is written when the
      // editor's press stated one ("Kill as duplicate" and the Compare view's
      // "Same story" both do). A plain Kill from the Queue states none, and
      // the page says so in words rather than showing an empty line
      // (killRecordLine, lib/news/desk-copy.ts).
      await sql`
        update leads set status = 'killed', killed_at = now(),
                kill_reason = ${reason || null},
                kill_reason_url = ${data.killReasonUrl?.trim() || null}
        where id = ${data.id} and newsroom_id = ${owned(context)}
      `;
      return { ok: true as const };
    }
    await sql`
      update leads set status = ${data.status}
      where id = ${data.id} and newsroom_id = ${owned(context)}
    `;
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
    const sql = await getSql();
    const room = owned(context);
    if (data.action === "not-a-duplicate") {
      const rows = await sql<{ id: number }>`
        update leads
        set possible_duplicate_of = null, dup_kind = null,
            status = case when status = 'held' then 'new' else status end
        where id = ${data.id} and newsroom_id = ${room}
        returning id
      `;
      if (!rows.length) return { ok: false as const, error: "That lead is no longer on the desk." };
      return { ok: true as const, action: data.action };
    }
    const reopened = await sql<{ id: number }>`
      update leads
      set status = 'new'
      where newsroom_id = ${room}
        and id = (select possible_duplicate_of from leads
                  where id = ${data.id} and newsroom_id = ${room})
      returning id
    `;
    if (!reopened.length) {
      return { ok: false as const, error: "There is no earlier lead to reopen for this one." };
    }
    return { ok: true as const, action: data.action, priorId: reopened[0]!.id };
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
  .handler(async ({ context, data }) => _performCreateAiFollowUp(context, data));

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
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    if (data.action !== "run-now") {
      const result = await _performFollowUpAction(context, data.id, data.action);
      if (!result.ok) throw new Error(result.error);
      return { ok: true };
    }
    const { startFollowUpRun } = await import("./follow-up-scheduler.ts");
    const started = await startFollowUpRun(
      { userId: context.userId, newsroomId: context.newsroomId ?? 1 },
      data.id,
    );
    if (!started.started) throw new Error(RUN_START_REFUSALS[started.skipped ?? "not-found"]);
    return { ok: true };
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
): Promise<{ outstanding: number; evidenceToken: string }> {
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
    if (isUnreadableFindingsError(error)) return { outstanding: 0, evidenceToken: "" };
    throw error;
  }
  return {
    outstanding: claimsNeedingReview(review.rows, review.claimRows, review.manualClaimRows),
    evidenceToken: review.evidenceToken,
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

  It refuses to record an override the draft does not need -- an outlet the
  story never names, or one its Sources already cover. A row saying an editor
  overrode something is worth less than nothing if it can be created for a
  claim the editor never saw.
*/
export async function performOverrideNamedOutlet(
  context: { userId: string; newsroomId?: number },
  leadId: number,
  outletName: string,
): Promise<{ ok: true; outlet: string } | { ok: false; error: string }> {
  const outlets = (await getPaperConfig(owned(context))).namedOutlets;
  const outlet = namedOutlet(outletName, outlets);
  if (!outlet) {
    return {
      ok: false as const,
      error: `"${outletName}" is not one of the outlets this check knows about, so it cannot be overridden.`,
    };
  }
  const decision = await withTransaction(async (sql) => {
    const drafts = await sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    const row = drafts[0];
    if (!row) return { ok: false as const, error: "Draft this lead before overriding an outlet." };
    const draft = unpackStoredDraft({ ...row });
    draft.body = stripReporterNotebook(draft.body);
    const unresolved = unresolvedNamedOutlets({
      body: draft.body,
      sourceUrls: parseUrlList(draft.source_urls),
      sourceTitles: await sourceTitlesForDraft(sql, owned(context), draft),
      outlets,
    });
    if (!unresolved.includes(outlet.name)) {
      return {
        ok: false as const,
        error: `${outlet.name} needs no override on this draft — the story does not name it, or its Sources already show it.`,
      };
    }
    // Clicking twice is the same decision. The table is append-only, so the
    // second click must not try to write over the first row.
    await sql`
      insert into named_outlet_overrides (newsroom_id, draft_id, lead_id, outlet, overridden_by)
      values (${owned(context)}, ${row.id}, ${leadId}, ${outlet.name}, ${context.userId})
      on conflict (newsroom_id, draft_id, outlet) do nothing
    `;
    return { ok: true as const, outlet: outlet.name, draftId: Number(row.id) };
  });
  if (!decision.ok) return { ok: false as const, error: decision.error };
  /*
    Audited outside the transaction, where every other publish-path audit sits.
    `audit` runs on the pooled connection, not the transaction's, and on PGlite
    there is one connection: writing from inside the transaction deadlocks it.
  */
  await audit(context.userId, "override_named_outlet", `Draft ${decision.draftId}`, owned(context), {
    kind: "drafts",
    id: decision.draftId,
  });
  return { ok: true as const, outlet: decision.outlet };
}

export const overrideNamedOutlet = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: unknown) => outletInput.parse(data))
  .handler(async ({ context, data }) =>
    performOverrideNamedOutlet(context, data.leadId, data.outlet),
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
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const { withCurrentDraftForPublish } = await import("./draft-order.server.ts");
  const already = await getSql().then(
    (sql) =>
      sql<{ slug: string }>`
      select slug from articles
      where lead_id = ${leadId} and newsroom_id = ${owned(context)} and status = 'published'
      limit 1
    `,
  );
  if (already[0]) return { ok: true as const, slug: already[0].slug };

  const leads = await getSql().then(
    (sql) =>
      sql<LeadRow>`
      select id, headline, why, topic, status, source_urls, evidence, newsworthiness, created_at
      from leads where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
    `,
  );
  const lead = leads[0];
  if (!lead) return { ok: false as const, error: "Lead not found" };
  if (lead.status === "killed") {
    return { ok: false as const, error: "Killed leads cannot print." };
  }
  if (lead.status === "held") {
    return {
      ok: false as const,
      error: "Un-hold this lead before publishing. Working notes stay private until then.",
    };
  }

  /*
    FAIL CLOSED ON A CLAIM OF ABSENCE (2026-09-05).

    The Publish button is disabled in the desk while one of these is unchecked,
    and a disabled button is a suggestion: a stale tab, a second window, a
    scripted call or a walkthrough all route straight past it. This is the
    check that actually holds. A story is allowed to say a document is not
    there -- once a person has opened the city's own site and confirmed it.
  */
  const notesRows = await getSql().then(
    (sql) =>
      sql<{ notes_json: string | null }>`
      select notes_json from leads where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
    `,
  );
  const openClaims = uncheckedGateTodos(parseNotes(notesRows[0]?.notes_json));
  if (openClaims.length) {
    return {
      ok: false as const,
      error:
        openClaims.length === 1
          ? "Confirm the claim of absence first — open the city's own site, check the story is right that the document is not there, then tick it in reporting notes."
          : `Confirm the ${openClaims.length} claims of absence first — open the city's own site, check the story is right that those documents are not there, then tick them in reporting notes.`,
    };
  }

  const drafts = await getSql().then(
    (sql) =>
      sql<DraftRow>`
      select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
             provenance_json, form, found_note, unanswered, research_json, disclosure_text,
             model_topic
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `,
  );
  const row = drafts[0];
  if (!row) return { ok: false as const, error: "Draft this lead before publishing." };
  /*
    A STORY NEVER PRINTS WITH A HOLE WHERE ITS DEK BELONGS (0.6.80).
    Nothing upstream requires one -- a pasted story is filed with `dek: ""`
    (`paste-one-story.ts:178`) and a report's own model can omit the "why it
    matters" paragraph a dek comes from (`import-review.ts:2111`) -- so this is
    the one gate every reported story passes through before it prints. The
    workbench already has a dek field (`desk.story.draft.$draftId.tsx:259`);
    refusing here, not earlier, lets the editor fill it any time before this
    click.
  */
  if (!row.dek || !row.dek.trim()) {
    return {
      ok: false as const,
      error: "Add a dek, the one-line summary under the headline, before you publish.",
    };
  }
  if (evidenceNeedsReview(row, row.body))
    return {
      ok: false as const,
      error:
        "The story changed after its evidence was gathered. Review the evidence in the workbench before publishing.",
    };
  /*
    ── THE CLAIMS NOBODY READ (UNIT U24) ──────────────────────────────────────

    On the stand-in editorial day a story went to paper with seven claims its
    own evidence check had raised still chipped `! Needs review`, and nothing
    anywhere said so. Every other machine-made decision on this story passes a
    person first; so does this one.

    Two ways past it, and both are the editor's to choose: judge the claims in
    the workbench (the blocker's first press, and the one to prefer), or accept
    them explicitly with a press that records who and when against this exact
    draft version (`performAcceptUnreviewedClaims`). The accepted COUNT and
    token are read from `notes_json` -- the same place, and the same
    fingerprint, as the section confirmation, so the acceptance is for the
    version the editor was reading and an edit takes it back.

    THREE WAYS IT FAILS CLOSED (units U24, U24b):

      1. The count cannot be read at all. `unreviewedClaimCount` now only
         swallows the unreadable-findings error and lets infrastructure errors
         out; a publish that cannot be checked is a publish that does not
         happen, in a sentence a person can read.
      2. No acceptance, or one recorded for a different draft version.
      3. An acceptance given for FEWER claims than are outstanding now. The
         fingerprint alone cannot see this: a judgment the desk downgrades to
         unreviewed -- the capture behind it changed, its binding moved -- does
         not touch the draft row, so the token stands still while the number to
         answer for grows. "I accepted three" must not print four.

    A disabled button is a suggestion -- a stale tab, a second window or a
    scripted call all route straight past it -- so the gate is here, and the
    desk's blocker is the sentence that tells the editor this one exists.
  */
  let outstandingClaims: number;
  try {
    outstandingClaims = await unreviewedClaimCount(owned(context), leadId, deps);
  } catch {
    return { ok: false as const, error: PUBLISH_COULD_NOT_CHECK };
  }
  if (outstandingClaims > 0) {
    const acceptance = parseNotes(notesRows[0]?.notes_json).unreviewedClaimsConfirmation;
    const acceptedForThisDraft =
      acceptance?.token === topicConfirmationFingerprint(evidenceReviewToken(row));
    const accepted = acceptedForThisDraft && (acceptance?.count ?? 0) >= outstandingClaims;
    if (!accepted) {
      const short = acceptedForThisDraft ? (acceptance?.count ?? 0) : 0;
      return {
        ok: false as const,
        error: `${outstandingClaims} claim${
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
      };
    }
  }
  /*
    THE SECTION IS A CLAIM TOO (0.6.62).

    Every other machine-made decision on this story passes a person before it
    prints: the claims of absence above, the evidence review before that. The
    section did not, and two published stories filed under a section nobody
    chose -- a cat-rescue fundraiser under Budget, a staffing change at LPM
    under Schools. A reader looking for either in its section would not find it.

    The desk's button is disabled while the section is unconfirmed, and a
    disabled button is a suggestion: this is the check that holds.
  */
  const confirmedTopic = parseNotes(notesRows[0]?.notes_json).topicConfirmation;
  const draftTopic = String(row.topic ?? "").trim();
  /* `null` for anything that is not one of the four keys, including absent. */
  const area = cleanStoryArea(areaFromEditor);
  const editorTopic = String(sectionFromEditor ?? "").trim();
  if (editorTopic && editorTopic !== draftTopic) {
    return {
      ok: false as const,
      error: `This story files under "${draftTopic || "no section"}", and the button said "${editorTopic}". Reload the story, check the section, then publish again.`,
    };
  }
  /*
    The editor's own section, for this version: confirmed by the press that
    carried it. Recorded inside the publish transaction below, so a print with
    no confirmation row cannot happen and a confirmation with no print cannot
    either.
  */
  const confirmSection = Boolean(editorTopic) && editorTopic === draftTopic;
  if (
    !confirmSection &&
    (!confirmedTopic ||
      confirmedTopic.topic !== draftTopic ||
      confirmedTopic.token !== topicConfirmationFingerprint(evidenceReviewToken(row)))
  ) {
    return {
      ok: false as const,
      error: `This draft files under "${draftTopic || "no section"}", and no editor has confirmed that for the version being printed. Open the story, check the section, and publish from there.`,
    };
  }

  const draft = unpackStoredDraft({ ...row });
  draft.body = stripReporterNotebook(draft.body);

  /*
    Legacy/manual drafts with no sources may fall back to their lead's.
    Report-backed drafts mark their citation list explicit, including empty;
    publication must not resurrect uncited discovery URLs for those drafts.

    Belt and braces for UX-005. The insert above now copies the URL into the
    draft, but every draft created before that fix is still empty, and those
    are exactly the stories an operator has in flight right now. Publishing
    one of them would print an article with no sources and no warning.
  */
  if (parseUrlList(draft.source_urls).length === 0 && mayInheritLeadSources(row)) {
    const fromLead = await getSql().then(
      (sql) =>
        sql<{ source_urls: string }>`
        select source_urls from leads
        where id = ${leadId} and newsroom_id = ${owned(context)} limit 1
      `,
    );
    const inherited = sanitizePublicUrls(parseUrlList(fromLead[0]?.source_urls ?? "[]"));
    if (inherited.length > 0) draft.source_urls = JSON.stringify(inherited);
  }
  let provenanceJson =
    row.provenance_json && row.provenance_json !== "[]" ? row.provenance_json : "";
  if (!provenanceJson) {
    provenanceJson = JSON.stringify(provenanceFromUrls(parseUrlList(draft.source_urls)));
  }

  /*
    THE NAMED-OUTLET CHECK (0.6.62).

    A story that says "the Denver Post reported" is asking the reader to trust
    a report the paper has not shown them. The Sources list is the only place
    they can check it, and if the outlet is not there, nothing on the page
    tells them where the claim came from -- or that anyone at the paper looked.

    It runs here, after the lead-source fallback above, because the list it
    judges is the list the article will print. An editor clears one outlet at a
    time with an override recorded in named_outlet_overrides, read back here --
    per draft, so clearing the Denver Post for this story says nothing about
    the Longmont Leader, and nothing about the next draft.
  */
  const outletSql = await getSql();
  const overrideRows = await outletSql<{ outlet: string }>`
    select outlet from named_outlet_overrides
    where newsroom_id = ${owned(context)} and draft_id = ${row.id}
  `;
  const unresolvedOutlets = unresolvedNamedOutlets({
    body: draft.body,
    sourceUrls: parseUrlList(draft.source_urls),
    sourceTitles: await sourceTitlesForDraft(outletSql, owned(context), draft),
    overridden: overrideRows.map((r) => r.outlet),
    /*
      This newsroom's own outlet list, not the shipped one (Unit P item 5).
      The desk report and the override above read the same list, so the three
      cannot disagree about what is outstanding.
    */
    outlets: (await getPaperConfig(owned(context))).namedOutlets,
  });
  if (unresolvedOutlets.length) {
    return { ok: false as const, error: namedOutletNotice(unresolvedOutlets) };
  }

  const baseSlug = slugify(draft.headline);
  let slug = baseSlug;

  const published = await withCurrentDraftForPublish(
    { newsroomId: owned(context) },
    leadId,
    row,
    async (sql) => {
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
      const stale = await staleMeetingCitations(sql, {
        newsroomId: owned(context),
        draftId: Number(row.id),
      });
      if (stale.length) return { blocked: true as const, error: staleCitationNotice(stale) };

      /*
        THE PRESS THAT CARRIED THE SECTION IS THE CONFIRMATION (0.6.67).

        Written here, in the transaction that prints the story, against the
        token of the row actually being printed -- so the record cannot survive
        a newer draft, and a print without its confirmation cannot happen. The
        confirmation is what the gate above reads for any later request that
        carries no section; the guarantee the separate button used to provide is
        unchanged, it is just made by the same press that publishes now.
      */
      if (confirmSection) {
        const noteRows = await sql<{ notes_json: string | null }>`
          select notes_json from leads
          where id = ${leadId} and newsroom_id = ${owned(context)} for update
        `;
        const printNotes = parseNotes(noteRows[0]?.notes_json);
        printNotes.topicConfirmation = {
          topic: draftTopic,
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
        ${area}
      ) returning id
    `;
      await recordPublishedMeetingEvidence(sql, {
        newsroomId: owned(context),
        articleId: printed.id,
        draftId: Number(row.id),
      });
      await sql`
      update leads set status = 'published' where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
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
      return { blocked: false as const, slug, id: printed.id };
    },
  );

  if (published.blocked) return { ok: false as const, error: published.error };

  /*
    A SECTION THE MODEL DID NOT CHOOSE (0.6.67).

    "the model filed this under Council, the editor published it under Schools"
    is the fact the paper wants to be able to count. Recorded on the existing
    audit trail rather than in a table of its own, because it is one line about
    one decision and the trail already carries the who and the when.
  */
  if (published.id && sectionOverridden(row.model_topic, draftTopic)) {
    await audit(
      context.userId,
      "section-override",
      sectionOverrideDetail({
        leadId,
        modelTopic: String(row.model_topic ?? "").trim(),
        editorTopic: draftTopic,
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
  if (outstandingClaims > 0) {
    await audit(
      context.userId,
      "publish-unreviewed-claims",
      `Article ${published.id}: ${outstandingClaims} unreviewed claim${
        outstandingClaims === 1 ? "" : "s"
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
      : performPublish(context, data.leadId, data.topic, data.area),
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
  const got = await grokChat(prompt.system, prompt.user, 700, {
    choice: (model?.choice || "auto") as EffectiveProviderChoice,
    newsroomId: owned(context),
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
  input: { articleSlug: string; wasWrong: string; isRight: string },
): Promise<
  | { ok: true; wording: string; source: "model" | "template" }
  | { ok: false; error: string }
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
  const got = await grokChat(prompt.system, prompt.user, 700, {
    choice: "auto",
    newsroomId: owned(context),
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

export const resolveDraftMeetingReview = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftMeetingReviewInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const result = await withTransaction((sql) => recordDraftTranscriptRevisionReview(sql, {
        newsroomId: owned(context),
        leadId: data.leadId,
        draftId: data.draftId,
        reviewerId: context.userId,
        expectedEvidenceToken: data.evidenceToken,
        acceptedArtifactId: data.acceptedArtifactId,
        confirmedSegmentIndexes: data.confirmedSegmentIndexes,
        note: data.note,
      }));
      await audit(context.userId, "review", `Meeting draft ${data.draftId} transcript evidence`, owned(context), {
        kind: "drafts", id: data.draftId,
      });
      return { ok: true as const, ...result };
    } catch (cause) {
      return { ok: false as const, error: cause instanceof Error ? cause.message : "Could not save the citation review." };
    }
  });

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
      id: Number(draft.id), headline: draft.headline, dek: draft.dek, body: draft.body, topic: draft.topic,
      updatedAt: draft.updated_at, transcriptLinks: details,
      transcriptReviews: reviews.map((review) => {
        let raw: unknown = null;
        try { raw = JSON.parse(review.accepted_citation_snapshot) as unknown; } catch { /* malformed record is displayed as unavailable */ }
        const citations = Array.isArray(raw) ? raw.map((value) => {
          const citation = value && typeof value === "object" ? value as Record<string, unknown> : {};
          const numberOrNull = (field: unknown) => typeof field === "number" && Number.isFinite(field) ? field : null;
          return {
            sourceSegmentIndex: numberOrNull(citation.sourceSegmentIndex),
            acceptedSegmentIndex: numberOrNull(citation.acceptedSegmentIndex),
            acceptedTimestampSeconds: numberOrNull(citation.acceptedTimestampSeconds),
            excerpt: typeof citation.excerpt === "string" ? citation.excerpt : null,
            captionSha256: typeof citation.captionSha256 === "string" ? citation.captionSha256 : null,
          };
        }) : [];
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
