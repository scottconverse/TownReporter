import {
  ensureNewsroomSources as ensureSeeds,
  insertProposedNewsroomSource,
  saveAcceptedNewsroomSource,
} from "./source-seeds.server.ts";
import { selectCustomScanSources, selectedScanSources } from "./section-types.ts";
import { scanSourceExcerpt } from "./scan-source-excerpt.ts";
import { buildScanBatches, mergeScanBatchResults } from "./scan-batches.ts";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { slugify, parseUrlList } from "@/lib/paper";
import { getPaperConfig } from "./paper-settings";
import { assertHttpUrl, sha256 } from "./url-guard";
import { parseHttpUrl, parseSourceLines } from "./source-lines.ts";
import { ingestUrl, ingestDocument, mapLimit, withRetry } from "./ingest";
import { assertRate, audit } from "./ops";
import { scanSystem, grokChat, parseJsonBlock, probeProvider, providerBudget, type EffectiveProviderChoice } from "./ai";
import { unpackStoredDraft } from "./coerce-draft";
import { stripReporterNotebook } from "./strip-draft";
import {
  parseScanResult,
  previousScanNeedsReread,
  sanitizePublicUrls,
  shouldCommitFetchHashes,
} from "./schema";
import { reportAndDraft } from "./report";
import { draftSourceInputs, suppliedUrlsFromText } from "./draft-input.ts";
import {
  evidenceNeedsReview,
  evidenceReviewToken,
  mayInheritLeadSources,
} from "./draft-evidence.ts";
import { webSearch } from "./search-web";
import { namedSubjects } from "./extract";
import { absenceClaims } from "./absence-gate";
import {
  applyTodoPatch,
  keepHumanTodos,
  machineTodosFrom,
  packNotes,
  parseNotes,
  uncheckedGateTodos,
  type NoteTodo,
} from "./notes";
import { provenanceFromUrls } from "./findings";
import {
  buildScanUserMessage,
  composeZeroLeadSummary,
  kindFromSourceUrl,
  resurfacedSummarySentence,
} from "./desk-copy";
import { MATCH_LOOKBACK_DAYS, type MatchCandidateLead } from "./lead-match";
import { fileScanLeads, parseLeadSourceUrls } from "./lead-filing";
import {
  enqueueJob,
  findOpenJob,
  kickJobs,
  latestJob,
  runLooksStalled,
  setJobFailoverNote,
  setJobModelChoice,
  setJobModelRuntime,
  setJobStage,
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
export type { PerformDraftWorkDeps };
import { readProviderOverrides } from "./provider-settings.ts";
import { modelEffort, type ModelEffort, type ProviderOverrides } from "./provider-registry.ts";
import {
  failoverNoteSentence,
  failoverReasonPhrase,
} from "./automatic-failover.ts";
import type { DraftRow, LeadRow, MemoryRow, ScanRow, SourceRow } from "./types";

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

function effortFromJob(job: Pick<DeskJob, "model_choice" | "result_json">): ModelEffort | null {
  try {
    const value = JSON.parse(job.result_json || "{}") as { modelEffort?: unknown };
    return modelEffort(job.model_choice, value.modelEffort);
  } catch {
    return modelEffort(job.model_choice, null);
  }
}

async function ensureDraftMemoColumn() {
  const sql = await getSql();
  await sql.query(
    "alter table drafts add column if not exists research_json text not null default '{}'",
  );
  await sql.query(
    "alter table leads add column if not exists notes_json text not null default '{}'",
  );
}

export const bootstrapDesk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureSeeds(context.userId, owned(context));
    return { ok: true as const };
  });

export const listSources = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureSeeds(context.userId, owned(context));
    const sql = await getSql();
    return sql<SourceRow>`
      select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
      from sources
      where newsroom_id = ${owned(context)}
      order by
        case status when 'proposed' then 0 when 'accepted' then 1 else 2 end,
        id asc
    `;
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
  .validator((input: { url: string; title: string; kind: string; tier: string }) => input)
  .handler(async ({ context, data }) => {
    const parsed = parseHttpUrl(data.url);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    const title = data.title.trim() || parsed.host;
    const kind = data.kind || kindFromSourceUrl(parsed.url);
    const source = await upsertSource(
      context.userId,
      parsed.url,
      title,
      kind,
      data.tier || "A",
      owned(context),
    );
    if (!source) return { ok: false as const, error: "Could not save that source." };
    return { ok: true as const, source };
  });

export const addSourcesBulk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { text: string }) => input)
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

export const setSourceStatus = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { id: number; status: "accepted" | "rejected" | "proposed" }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update sources set status = ${data.status}
      where id = ${data.id} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const };
  });

export const listLeads = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<
      LeadRow & {
        article_slug: string | null;
        investigation_id: number | null;
        story_headline: string | null;
      }
    >`
      select l.id, l.scan_run_id, l.headline, l.why, l.topic, l.status, l.source_urls, l.evidence,
             l.newsworthiness, l.created_at, l.investigation_id, a.slug as article_slug,
             coalesce(a.headline, (select nullif(d.headline, '') from drafts d
               where d.lead_id=l.id and d.newsroom_id=l.newsroom_id
               order by d.updated_at desc,d.id desc limit 1)) as story_headline,
             l.resurfaced_count, l.last_resurfaced_at, l.last_resurfaced_scan_run_id,
             l.possible_duplicate_of,
             case when prior.id is null then null else jsonb_build_object(
               'id', prior.id, 'headline', prior.headline, 'status', prior.status
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
  });

/**
 * Insert a lead exactly the way `fileLead` always has, plus the draft row
 * `publishLead` reads its source_urls from (see the note below) — pulled out
 * so `writeStoryFromInput` can file the same shape without duplicating it.
 */
async function insertLeadWithDraft(
  context: { userId: string; newsroomId?: number },
  input: { headline: string; why: string; topic: string; urls: string[]; notesJson?: string },
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const sql = await getSql();
  const urlsJson = JSON.stringify(input.urls);
  const rows = input.notesJson
    ? await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, notes_json)
        values (
          ${context.userId}, ${owned(context)}, ${input.headline}, ${input.why}, ${input.topic},
          ${urlsJson}, ${input.why.slice(0, 400)}, 0, 'new', ${input.notesJson}
        )
        returning id
      `
    : await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status)
        values (
          ${context.userId}, ${owned(context)}, ${input.headline}, ${input.why}, ${input.topic},
          ${urlsJson}, ${input.why.slice(0, 400)}, 0, 'new'
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
    insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls)
    values (
      ${context.userId}, ${owned(context)}, ${id}, ${input.headline}, ${input.why.slice(0, 220)}, '', ${input.topic},
      ${urlsJson}
    )
  `;
  await audit(context.userId, "lead", `filed ${id}`, owned(context));
  return { ok: true as const, id };
}

export const fileLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { headline: string; why: string; topic: string; url?: string }) => input)
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
    return insertLeadWithDraft(context, {
      headline,
      why,
      topic,
      urls,
      notesJson: packNotes({ ...parseNotes(null), suppliedUrls: urls }),
    });
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    kickJobs();
    const sql = await getSql();
    await ensureDraftMemoColumn();
    const leads = await sql<LeadRow>`
      select l.id, l.scan_run_id, l.headline, l.why, l.topic, l.status, l.source_urls, l.evidence, l.newsworthiness, l.created_at, l.investigation_id, l.notes_json,
             l.possible_duplicate_of,
             case when prior.id is null then null else jsonb_build_object(
               'id', prior.id, 'headline', prior.headline, 'status', prior.status
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
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${id} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `;
    const live = await sql<{ slug: string }>`
      select slug from articles
      where lead_id = ${id} and newsroom_id = ${owned(context)} and status = 'published'
      limit 1
    `;
    const evidenceToken = drafts[0] ? evidenceReviewToken(drafts[0]) : "";
    const draft = drafts[0] ? unpackStoredDraft({ ...drafts[0] }) : null;
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
    return {
      lead,
      draft,
      evidenceToken,
      articleSlug: live[0]?.slug ?? null,
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
      select id, started_at, finished_at, sources_fetched, leads_created, sources_proposed, sources_selected, sources_attempted, sources_failed, sources_analyzed, model_batches_used, model_batches_failed, failed_sources, summary, error, execution_origin
      from scan_runs
      where newsroom_id = ${owned(context)}
      order by started_at desc
      limit ${limit} offset ${offset}
    `;
    const [count] = await sql<{ total: number }>`
      select count(*)::int as total from scan_runs where newsroom_id = ${owned(context)}
    `;
    /*
      Only the most recent row can be the one a screen is watching, and it is
      the only one worth a job lookup -- older rows are either finished or,
      if a still-open older row exists too, will resolve on their own turn.
    */
    const newest = rows[0];
    if (newest && !newest.finished_at && !newest.error) {
      const job = await latestJob({
        newsroomId: owned(context),
        kind: "scan",
        subjectId: newest.id,
      });
      newest.stalled = runLooksStalled({ runOpen: true, job });
    }
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
  .validator(
    (input: { name: string; sourceIds: number[]; packId?: number }) => input,
  )
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
  .validator((input: { packId: number; name: string }) => input)
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
  .validator((input: { packId: number }) => input)
  .handler(async ({ context, data }) => {
    const { deleteScanSourcePack } = await import("./scan-source-packs.server.ts");
    await deleteScanSourcePack({ newsroomId: owned(context), packId: data.packId });
    return { ok: true as const };
  });
export const runScan = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (
      input:
        | {
            modelChoice?: string;
            modelEffort?: ModelEffort | null;
            sectionKey?: string;
            customSourceIds?: number[];
            packId?: number;
          }
        | undefined,
    ) => input ?? {},
  )
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
  const runChat = deps.grokChat ?? grokChat;
  const probe = deps.probe ?? probeProvider;
  const setModelChoice = deps.setJobModelChoice ?? setJobModelChoice;
  const setStage = deps.setJobStage ?? setJobStage;
  const fetchUrl = deps.ingestUrl ?? ingestUrl;
  const context = { userId: job.user_id, newsroomId: job.newsroom_id };
  const paperConfig = await getPaperConfig(owned(context));
  await ensureSeeds(context.userId, owned(context));
  const sql = await getSql();
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
  const allowedTopics = sectionSnapshot
    ? [sectionSnapshot.key]
    : sectionConfig.sections
        .filter((s) => !s.replacementKey && !["about", "opinion"].includes(s.key))
        .map((s) => s.key);
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

  await mapLimit(watchSlice, 6, async (src) => {
    await deps.scheduledGuard?.();
    try {
      const bundle = await withRetry(async () => {
        await deps.scheduledGuard?.();
        return fetchUrl(src.url);
      });
      const extras: { url: string; text: string }[] = [];
      for (const extra of bundle.extras.slice(0, 4)) {
        await deps.scheduledGuard?.();
        try {
          const doc = await withRetry(async () => {
            await deps.scheduledGuard?.();
            return fetchUrl(extra);
          });
          extras.push({ url: extra, text: doc.text });
        } catch (err) {
          if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(String(err)))
            throw err;
          /* skip a bad packet */
        }
      }
      const extraBits = extras.map((e) => `DOCUMENT ${e.url}\n${e.text.slice(0, 2500)}`);
      const text = extraBits.length ? `${bundle.text}\n\n${extraBits.join("\n\n")}` : bundle.text;
      const hash = await sha256(text);
      const changed = hash !== src.last_hash;
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, error: null });
      else
        await sql`
        update sources set last_fetched_at = now(), last_error = null
        where id = ${src.id} and newsroom_id = ${owned(context)}
      `;
      pendingHashes.push({ id: src.id, hash, text, changed });
      fetchedCount += 1;
      fetched.push({
        id: src.id,
        title: src.tier === "C" ? `[discovery] ${src.title}` : src.title,
        url: src.url,
        text: bundle.text.slice(0, 4500),
        extras,
        changed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      if (deps.scheduledGuard && /Scheduled scan permission was withdrawn/.test(msg)) throw err;
      if (deps.scheduledCommit) pendingSourceTouches.push({ id: src.id, error: msg });
      else
        await sql`
        update sources set last_error = ${msg}, last_fetched_at = now()
        where id = ${src.id} and newsroom_id = ${owned(context)}
      `;
      failedSources.push({ id: src.id, title: src.title, url: src.url, error: msg });
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

  const batchTimeoutMs = scanCallTimeoutFor(
    await readProviderOverrides(job.newsroom_id).catch(() => ({})),
  );
  const batchResults: import("./schema.ts").ParsedScanResult[] = [];
  let batchesFailed = 0;
  let lastBatchError: string | null = null;
  for (const batch of batches) {
    await deps.scheduledGuard?.();
    const userMsg = buildScanUserMessage({
      topics: allowedTopics,
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
    */
    const ai = await runScanChatWithFailover({
      job,
      newsroomId: job.newsroom_id,
      system: scanSystem({
        name: paperConfig.name,
        city: paperConfig.city,
        state: paperConfig.state,
      }),
      user: userMsg,
      maxTokens: 3500,
      modelEffort: effortFromJob(job),
      timeoutMs: batchTimeoutMs,
      grokChat: runChat,
      probe,
      setModelChoice,
      setStage,
      setFailoverNote: setJobFailoverNote,
      onSwitch: deps.onModelSwitch,
    });
    if (!ai.ok) {
      batchesFailed += 1;
      lastBatchError = ai.error;
      continue;
    }
    const parsed = parseScanResult(parseJsonBlock<unknown>(ai.text), allowedTopics);
    if (parsed.parseError) {
      batchesFailed += 1;
      lastBatchError = parsed.parseError;
      continue;
    }
    batchResults.push(parsed);
  }

  if (!batchResults.length) {
    const error = lastBatchError ?? "Writing pass returned no usable JSON.";
    if (!deps.scheduledCommit)
      await sql`
        update scan_runs
        set finished_at = now(), sources_fetched = ${fetchedCount},
            sources_selected = ${sources.length}, sources_attempted = ${watchSlice.length},
            sources_failed = ${failedSources.length},
            model_batches_used = ${batches.length}, model_batches_failed = ${batchesFailed},
            failed_sources = ${JSON.stringify(failedSources).slice(0, 32000)},
            error = ${error}
        where id = ${runId} and newsroom_id = ${owned(context)}
      `;
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
  const analyzedSourceCount = batches
    .slice(0, batches.length - batchesFailed)
    .reduce((n, b) => n + b.sources.length, 0);

  const commitResults = async (writeSql: Sql) => {
    for (const touch of pendingSourceTouches) {
      await writeSql`
        update sources set last_error = ${touch.error}, last_fetched_at = now()
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

    // Loaded once, not fed to the AI: matching happens in code (findMatchingLead).
    const existingLeadsRaw = await writeSql<{
      id: number;
      status: string;
      headline: string;
      source_urls: string;
      created_at: string;
    }>`
      select id, status, headline, source_urls, created_at
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
    }));

    const {
      leadsCreated,
      resurfacedKilled,
      resurfacedOpen,
      possibleMatched,
      firstDiscardedHeadline,
    } = await fileScanLeads(writeSql, context, owned(context), runId, data.leads, existingLeads);

    let proposed = 0;
    for (const p of data.proposed_sources) {
      if (!p.url) continue;
      let url: URL;
      try {
        url = assertHttpUrl(p.url);
      } catch {
        continue;
      }
      if (
        await insertProposedNewsroomSource(writeSql, {
          userId: context.userId,
          newsroomId: owned(context),
          url: url.toString(),
          title: p.title || url.hostname,
        })
      )
        proposed += 1;
    }

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
      filedNew: leadsCreated - possibleMatched,
      firstDiscardedHeadline,
    });
    if (resurfacedSentence)
      summary = summary ? `${summary} ${resurfacedSentence}`.slice(0, 1200) : resurfacedSentence;
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
          failed_sources = ${JSON.stringify(failedSources).slice(0, 32000)},
          summary = ${summary}
      where id = ${runId} and newsroom_id = ${owned(context)}
    `;
    if (deps.scheduledCommit) {
      await writeSql`
        insert into audit_events (user_id, action, detail, newsroom_id)
        values (${context.userId}, 'scan', ${`run ${runId} fetched ${fetchedCount} leads ${leadsCreated}`}, ${owned(context)})
      `;
    }
    return { leadsCreated };
  };

  await deps.beforeScheduledCommit?.();
  const committed = deps.scheduledCommit
    ? await deps.scheduledCommit(commitResults)
    : await withTransaction(commitResults);
  if (!deps.scheduledCommit)
    await audit(
      context.userId,
      "scan",
      `run ${runId} fetched ${fetchedCount} leads ${committed.leadsCreated}`,
      owned(context),
    );
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
  const setModelChoice = deps.setJobModelChoice ?? setJobModelChoice;
  const setModelRuntime = deps.setJobModelRuntime ?? setJobModelRuntime;
  const setStage = deps.setJobStage ?? setJobStage;
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
    select id, headline, why, topic, status, source_urls, evidence, newsworthiness, created_at, notes_json
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
  await ensureDraftMemoColumn();

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
  const researchScope = job.research_scope ?? prevNotes.researchScope ?? "public";
  const sourceInput = draftSourceInputs(urls, prevNotes, researchScope);
  const { retainedWatchSources } = await import("./retained-watch-source.server.ts");
  const storyDocumentReader =
    deps.readStoryDocuments ?? (await import("./story-documents.server.ts")).readStoryDocuments;
  const documentAssignment = prevNotes.editorialAssignment?.text || lead.headline;
  const initialDocumentChoice = effectiveStoryModelChoice(job.model_choice);
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
        probe: (choice) => probe(choice, owned(context)),
        chat: deps.chat,
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, nextEffort, reason }) => {
          await setJobModelRuntime(job.id, nextChoice, nextEffort);
          job.model_choice = nextChoice;
          job.result_json = JSON.stringify({ modelEffort: nextEffort });
          await setStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
          const switchNote = failoverNoteSentence(nextLabel, previousLabel, reason);
          await setFailoverNote(job.id, switchNote);
          if (batchSnapshot) {
            if (nextChoice === "auto" || nextChoice === "configured") throw new Error("Draft batch fallback did not resolve to a selectable runtime.");
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
    urls: sourceInput.urls,
    retainedSources: await retainedWatchSources(sql, owned(context), leadId, sourceInput.urls),
    memory,
    extraEvidence: prevNotes.scratch,
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
    providerOverrides: await readProviderOverrides(owned(context)).catch(() => ({})),
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
      const [saved] = await transactionSql<DraftRow>`
        insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json)
        values(${context.userId},${owned(context)},${leadId},${checkpoint.headline},${checkpoint.dek},${checkpoint.body},${lead.topic},${JSON.stringify(checkpoint.source_urls)},${integrityNotes},${JSON.stringify(provenance)},${String(checkpoint.form ?? "")},${JSON.stringify(checkpoint.found ?? null)},${JSON.stringify(Array.isArray(checkpoint.unanswered) ? checkpoint.unanswered : [])},${JSON.stringify({ citationPolicy: "explicit", researchScope: draftInput.researchScope, reportedClaims: { version: 1, rows: Array.isArray(checkpoint.claims) ? checkpoint.claims : [] }, writerCheckpoint: { version: 1, jobId: job.id, evidenceCheckIncomplete: true } })})
        returning *
      `;
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
    const adapters =
      deps.batchChatAdapters ??
      ({
        claude: async (input) => (await import("./ai-claude-code.server.ts")).claudeCodeChat(input),
        codex: async (input) => (await import("./ai-codex.server.ts")).codexChat(input),
        local: grokChat,
        custom: grokChat,
        xai: grokChat,
      } satisfies NonNullable<PerformDraftWorkDeps["batchChatAdapters"]>);
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
        resolve: (choice) => validateBatchRuntime(
          job.newsroom_id,
          choice,
          "modelEffort" in activeBatchSnapshot ? activeBatchSnapshot.modelEffort : null,
        ),
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
  const reported = await runReportWithCheckpoint({
    ...draftInput,
    modelChoice: effectiveStoryModelChoice(job.model_choice),
  });
  if ("error" in reported) throw new Error(reported.error);

  // Discovery exclusions are not citation rules: a watched page or a root
  // dashboard can be the substantive primary record. Preserve the reporter's
  // explicit citations, including an empty list, without adding lead seeds.
  const sourceUrls = JSON.stringify(sanitizePublicUrls(reported.source_urls));
  const notes = reported.integrity_notes;
  const provenanceJson = JSON.stringify(reported.provenance);
  const unansweredJson = JSON.stringify(reported.unanswered);
  const researchJson = JSON.stringify({
    ...reported.research_memo,
    citationPolicy: "explicit",
    researchScope: draftInput.researchScope,
    reportedClaims: { version: 1, rows: reported.claims },
    reportedDocumentClaims: {
      version: 1,
      checkedText: [reported.headline, reported.dek, reported.body].join("\n\n"),
      rows: reported.documentClaims ?? [],
    },
  });
  const yours = keepHumanTodos(prevNotes);
  /*
    Claims of absence, as checkboxes the editor must tick before Publish.

    Not advice. `performPublish` refuses while one is unchecked, because the
    2026-09-05 story would have passed every check the desk had: it read as a
    careful, sourced piece and its central claim -- that the city had published
    nothing -- was false. The only cure is a human opening the city's own site.
  */
  const gateTodos: NoteTodo[] = absenceClaims(reported.research_memo?.gate).map((claim) => ({
    t: `Claim of absence: ${claim.sentence}`.slice(0, 400),
    done: false,
    src: "gate" as const,
    // 0.6.23: the summary line names every rung of the ladder the gate ran
    // ("searched <domain> and <n> more ways"), not just the first query --
    // falls back to the old one-line form for a gate record from before this
    // release that has no `summary`.
    q: (claim.summary ?? (claim.query ? `Searched: ${claim.query}` : undefined))?.slice(0, 300),
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
  const notesJson = packNotes(nextNotes);

  await withClaimedLeadDraftLock(job, leadId, async (sql) => {
    const current =
      (
        await sql<DraftRow>`select * from drafts where lead_id=${leadId} and newsroom_id=${owned(context)} order by updated_at desc,id desc limit 1 for update`
      )[0] ?? null;
    if (!draftStillExpected(current))
      throw new Error(
        "The draft changed while reporting was finishing. The editor's newer draft was preserved.",
      );
    const [savedDraft] = await sql<{ id: number }>`
    insert into drafts (
      user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, integrity_notes,
      provenance_json, form, found_note, unanswered, research_json
    )
    values (
      ${context.userId}, ${owned(context)}, ${leadId}, ${reported.headline}, ${reported.dek}, ${reported.body},
      ${reported.topic}, ${sourceUrls}, ${notes},
      ${provenanceJson}, ${reported.form}, ${reported.found_note}, ${unansweredJson},
      ${researchJson}
    )
    returning id
  `;
    if (savedDraft) {
      const completion = JSON.stringify(
        buildDraftCompletionReceipt({
          checkpointDraftId,
          finalDraftId: Number(savedDraft.id),
          citationStatus:
            reported.citation_status ??
            (reported.source_urls.length || (reported.documentClaims?.length ?? 0) > 0
              ? "complete"
              : "review-required"),
          evidenceCheckIncomplete: notes.includes(
            "Evidence reconciliation not completed within the available edit pass.",
          ),
          nameCheck: reported.research_memo.nameCheck,
        }),
      );
      await sql`
      update desk_jobs
      set result_json = (coalesce(nullif(result_json, ''), '{}')::jsonb || ${completion}::jsonb)::text
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
  });
});

export const draftLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (
      input:
        number | { leadId: number; modelChoice?: string; modelEffort?: ModelEffort | null; researchScope?: "public" | "supplied" },
    ) => input,
  )
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

/**
 * "Write a story" — the one-box path on the Desk landing page, mirroring
 * Opinion's single textarea instead of the Queue's four-field form. Any
 * editor may use it, exactly like `fileLead` and `draftLead`: it parses the
 * pasted text into a lead (see `write-story.ts`), files it with the full
 * text kept as Reporting notes scratch so the draft reads it as evidence,
 * then hands off to the same commit boundary Story uses so a provider
 * refusal comes back structured and nothing is spent.
 */
export const listRecentStoryWork = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const sql = await getSql();
    return sql<{
      id: number;
      lead_id: number;
      headline: string;
      status: string;
      stage: string;
      updated_at: string;
    }>`
      select * from (
        select distinct on (j.subject_id) j.id, j.subject_id as lead_id, coalesce((select nullif(d.headline, '') from drafts d where d.lead_id=l.id and d.newsroom_id=l.newsroom_id order by d.updated_at desc,d.id desc limit 1), l.headline) as headline, j.status, j.stage, j.updated_at
        from desk_jobs j join leads l on l.id=j.subject_id and l.newsroom_id=j.newsroom_id
        where j.newsroom_id=${owned(context)} and j.kind='draft' and l.status in ('new','drafted','held')
        order by j.subject_id,j.id desc
      ) recent order by updated_at desc limit 5
    `;
  });

export const writeStoryFromInput = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: {
      text: string;
      documentIds?: string[];
      modelChoice?: string;
      modelEffort?: ModelEffort | null;
      researchScope?: "public" | "supplied";
      sectionKey?: string;
    }) => input,
  )
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

export const saveReportingNotes = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: {
      leadId: number;
      add?: string;
      toggle?: number;
      scratch?: string;
      researchScope?: "public" | "supplied";
      todos?: NoteTodo[];
    }) => input,
  )
  .handler(async ({ context, data }) => {
    await ensureDraftMemoColumn();
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
  .validator((input: { leadId: number; query: string; index?: number }) => input)
  .handler(async ({ context, data }) => {
    try {
      await assertRate(context.userId, "pull", owned(context));
      await ensureDraftMemoColumn();
      const sql = await getSql();
      const rows = await sql<{ id: number }>`
        select id from leads
        where id = ${data.leadId} and newsroom_id = ${owned(context)} limit 1
      `;
      if (!rows[0]) return { ok: false as const, error: "Lead not found" };
      const query = data.query.trim().slice(0, 240);
      if (query.length < 4)
        return { ok: false as const, error: "That line is too thin to search." };
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
      const receipt = newPullReceipt({ leadId: data.leadId, todoIndex: data.index, query });
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
  .validator((input: { leadId: number }) => input)
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
  .validator((input: { jobId: number }) => input)
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
  .validator((input: { jobId: number }) => input)
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
  .validator((input: import("./draft-edit.server.ts").DraftEditInput) => input)
  .handler(async ({ context, data }) => {
    const { saveDraftForEditor } = await import("./draft-edit.server.ts");
    return saveDraftForEditor({ userId: context.userId, newsroomId: owned(context) }, data);
  });

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { id: number; status: "held" | "killed" | "new" }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update leads set status = ${data.status}
      where id = ${data.id} and newsroom_id = ${owned(context)}
    `;
    return { ok: true as const };
  });

export {
  ensureFollowUpsSchema,
  performListFollowUps,
  performCreateFollowUp,
  performRecordFollowUpReply,
  performNudgeFollowUp,
  performDropFollowUp,
} from "./follow-ups.ts";
import {
  performListFollowUps as _performListFollowUps,
  performCreateFollowUp as _performCreateFollowUp,
  performRecordFollowUpReply as _performRecordFollowUpReply,
  performNudgeFollowUp as _performNudgeFollowUp,
  performDropFollowUp as _performDropFollowUp,
} from "./follow-ups.ts";

export const listFollowUps = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input?: { status?: "open" | "answered" | "dropped"; limit?: number }) => input ?? {})
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

export const createFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: {
      leadId?: number | null;
      articleId?: number | null;
      who: string;
      what: string;
      dueOn?: string | null;
    }) => input,
  )
  .handler(async ({ context, data }) => _performCreateFollowUp(context, data));

export const recordFollowUpReply = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { id: number; replyText: string; repliedOn?: string | null }) => input)
  .handler(async ({ context, data }) => _performRecordFollowUpReply(context, data));

export const nudgeFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { id: number }) => input)
  .handler(async ({ context, data }) => _performNudgeFollowUp(context, data.id));

export const dropFollowUp = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { id: number }) => input)
  .handler(async ({ context, data }) => _performDropFollowUp(context, data.id));

export const performPublish = createServerOnlyFn(async function performPublish(
  context: { userId: string; newsroomId?: number },
  leadId: number,
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
             provenance_json, form, found_note, unanswered, research_json
      from drafts where lead_id = ${leadId} and newsroom_id = ${owned(context)}
      order by updated_at desc, id desc limit 1
    `,
  );
  const row = drafts[0];
  if (!row) return { ok: false as const, error: "Draft this lead before publishing." };
  if (evidenceNeedsReview(row, row.body))
    return {
      ok: false as const,
      error:
        "The story changed after its evidence was gathered. Review the evidence in the workbench before publishing.",
    };
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

  const baseSlug = slugify(draft.headline);
  let slug = baseSlug;

  const published = await withCurrentDraftForPublish(
    { newsroomId: owned(context) },
    leadId,
    row,
    async (sql) => {
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
      const [printed] = await sql<{ id: number }>`
      insert into articles (
        user_id, newsroom_id, lead_id, slug, headline, dek, body, topic, source_urls, status, published_at,
        provenance_json, form, found_note, unanswered, origin_draft_id
      )
      values (
        ${context.userId}, ${owned(context)}, ${leadId}, ${slug}, ${draft.headline}, ${draft.dek},
        ${draft.body}, ${draft.topic}, ${draft.source_urls}, 'published', now(),
        ${provenanceJson}, ${row.form || "reported"}, ${row.found_note || ""}, ${row.unanswered || "[]"}, ${row.id}
      ) returning id
    `;
      await sql`
      update leads set status = 'published' where id = ${leadId} and newsroom_id = ${owned(context)}
    `;
      const entities = [draft.topic, ...draft.headline.split(/[:,—-]/).slice(0, 2)];
      for (const entity of entities.map((e) => e.trim()).filter((e) => e.length > 2)) {
        await sql`
        insert into beat_memory (user_id, newsroom_id, entity, last_angle, article_id)
        values (${context.userId}, ${owned(context)}, ${entity.slice(0, 80)}, ${draft.dek.slice(0, 200)}, ${printed.id})
      `;
      }
      return { slug, id: printed.id };
    },
  );

  await audit(context.userId, "publish", `Article ${published.id}`, owned(context), {
    kind: "articles",
    id: published.id,
  });
  return { ok: true as const, slug: published.slug };
});

export const publishLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((leadId: number) => leadId)
  .handler(async ({ context, data: leadId }) => performPublish(context, leadId));

export const addCorrection = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { articleSlug?: string; body: string }) => input)
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
  corrections: { date: string; body: string }[];
};

export const listPublishedDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
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
    }>`
      select a.id, a.slug, a.headline, a.dek, a.topic, a.published_at, a.lead_id,
        l.newsworthiness as lead_score
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
    return arts.map((a) => ({
      ...a,
      lead_score: a.lead_score == null ? null : Number(a.lead_score),
      corrections: byArt.get(a.id) ?? [],
    }));
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
  .validator((leadId: number) => leadId)
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
  .validator((slug: string) => slug)
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