import { presentDarkRun, type StoredDarkRunRow } from "./dark-run-presentation.ts";
export { presentDarkRun } from "./dark-run-presentation.ts";
import {
  artifactIdInput,
  darkCountyInput,
  darkOpenInput,
  darkRunInput,
  darkSignalInput,
  darkStepInput,
  draftSignalFileInput,
  redditTipInput,
  rowId,
} from "./request-input.ts";
import { subredditFromSources } from "./dark-place.ts";
import { describeResearchWindow, validateResearchPreferences, type ResearchPreferences, type ResearchSnapshot } from './dark-preferences.ts';
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import {
  grokChat,
  parseJsonBlock,
  providerBudget,
  probeProvider,
  type EffectiveProviderChoice,
} from "./ai.ts";
import { DARK_AUTOMATIC_LADDER, effectiveStoryModelChoice, modelChoiceLabel, storyModelChoice } from "./model-choice.ts";
import { isOfferedForJob } from "./model-assignments.ts";
import { planAutomaticFailover, failoverNoteSentence, failoverReasonPhrase } from "./automatic-failover.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { readProviderOverrides, resolveLocalModelChoice } from "./provider-settings.ts";
import { applyJobLocalModelSnapshot } from "./job-local-model.ts";
import {
  modelEffort as validatedModelEffort,
  type ModelEffort,
  type ProviderOverrides,
} from "./provider-registry.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import { darkSystemFor } from "./dark-prompt.ts";
import {
  GATE_KEYS,
  GATE_WORDS,
  capSpeculativeConfidence,
  newsworthinessWords,
  normalizePosture,
  readNewsworthiness,
  stageWords,
  type Place,
} from "./dark-gates.ts";
import { verifyRunSignals } from "./dark-verify.ts";
import { isSelfReferential } from "./claim-hygiene.ts";
import { assertRate, audit } from "./ops.ts";
import {
  checkBaselines,
  ensureInvestigateSchema,
  evidenceAppearsInText,
  groundingCorpus,
  matchDeadEnds,
  researchLoop,
  resurfaceDeadEnds,
  runDueMonitors,
} from "./investigate.ts";
import { DIG_CAPTURE_COUNT_SQL, digCaptureCounts, digCaptureCountsFromRows } from "./dark-counters.ts";
import { dedupeFactLines } from "./dark-fact-lines.ts";
import {
  groundedHeadline,
  markAlreadyOnFile,
  markedSpecifics,
  markUngroundedSpecifics,
  placeCorpus,
  prepareCorpus,
  stripUngroundedNotes,
  type GroundingCorpus,
} from "./dark-specific-grounding.ts";
import { readableCapture } from "./html-text.ts";
import { chunksFromEvidence } from "./ingest.ts";
import { OCR_TOTAL_BUDGET_MS, pdfPageCount, productionOcr } from "./ocr.ts";
import {
  pageListSummary,
  planMissingOcrBatches,
  unreadOcrPages,
  type OcrPageBatch,
} from "./ocr-batches.ts";
import { storableText } from "./storable-text.ts";
import { queryTokens } from "./retrieve.ts";
import { sanitizePublicUrls } from "./schema.ts";
import { usableLeadSources, type CapturedPage } from "./result-quality.ts";
import type { ArticleRow, MemoryRow, SourceRow } from "./types.ts";
import { rankWorthItems, presentWorthItems, signalReviewItems, type WorthSeed } from "./worth-a-look.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { ensureFollowUpsSchema, parseFinding, performListFollowUps } from "./follow-ups.ts";
import { ensurePageWatchSchema } from "./page-watch.ts";
import { DARK_LIMITS, hopsForLimit, type DarkLimitKey } from "./editor-dialog-logic.ts";
import {
  buildInvestigationActivity,
  titlesOverlap,
  topicFromText,
  type InvestigationActivityInput,
} from "./desk-copy.ts";
import { officialDomains, pressDomains as pressDomainsOf } from "./absence-gate.ts";
import { getPaperConfig, paperSetUpRefusal, requirePaperSetUp } from "./paper-settings.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { TIP_SUBREDDIT_QUERY_GROUPS } from "../paper.ts";
import {
  BRIEF_SYSTEM,
  briefIsUseful,
  briefPack,
  parseBrief,
  type InvestigationBrief,
} from "./dark-brief.ts";
import {
  PRESETS,
  scopeLabelsFor,
  budgetFor,
  clampDials,
  describeDials,
  estimateMinutes,
  stanceFor,
  type DarkScope,
  type DarkDials,
} from "./dark-dials.ts";
import {
  enqueueJob,
  findOpenJob,
  latestJob,
  pctFor,
  progressReporterFor,
  runLooksStalled,
  setJobModelChoice,
  setJobModelRuntime,
  setJobFailoverNote,
  setJobStage,
  throwIfJobCancelled,
  waitForModel,
  JobCancelledError,
  JOB_CANCELLED_REASON,
  type DeskJob,
} from "./jobs.ts";
import {
  createDarkRunBudgetForFile,
  type DarkRunBudget,
  type DarkRunStopReason,
  type DarkRunUsageSnapshot,
} from "./dark-run-budget.ts";

const DARK_SYNTHESIS_PACK_CAP = 28_000;
const DARK_SYNTHESIS_CONTEXT_CAP = 14_000;
const DARK_ARTIFACT_CAP = 12_000;
const DARK_ARTIFACT_COUNT = 8;
const SECTION_BUDGET_MARKER = "\n[section budget reached]";

type DarkFileRunLimits = { key: DarkLimitKey; minutes: number; dollars: number | null; scope: DarkScope };

async function darkFileRunLimits(investigationId: number, newsroomId: number): Promise<DarkFileRunLimits> {
  const sql = await getSql();
  const rows = await sql<{
    limit_key: string;
    limit_minutes: number;
    limit_dollars: number | string | null;
    scope_json: string;
  }>`
    select limit_key, limit_minutes, limit_dollars, scope_json
    from investigations where id = ${investigationId} and newsroom_id = ${newsroomId} limit 1
  `;
  const saved = rows[0];
  const limit = DARK_LIMITS.find((row) => row.key === saved?.limit_key) ?? DARK_LIMITS[1];
  let scope: DarkScope = "city";
  try {
    const parsed = JSON.parse(saved?.scope_json || "{}") as { scope?: unknown };
    if (["city", "county", "region", "adjacent"].includes(String(parsed.scope))) scope = parsed.scope as DarkScope;
  } catch {
    /* Old or malformed rows keep the city default. */
  }
  const minutes = Number(saved?.limit_minutes);
  const dollars = saved?.limit_dollars == null ? limit.dollars : Number(saved.limit_dollars);
  return {
    key: limit.key,
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : limit.minutes,
    dollars: dollars != null && Number.isFinite(dollars) ? dollars : null,
    scope,
  };
}

function darkRunBudget(
  dials: DarkDials,
  choice: EffectiveProviderChoice,
  overrides: ProviderOverrides | null,
  verificationLimit: number,
  fileLimits: DarkFileRunLimits,
): DarkRunBudget {
  const hopLimit = hopsForLimit(fileLimits.key);
  return createDarkRunBudgetForFile(
    {
      elapsedMs: providerBudget(choice, overrides).wallMs,
      modelCalls: hopLimit * 2 + Math.max(0, verificationLimit) + 3,
      searches: hopLimit * 3 + Math.max(0, verificationLimit) * 4,
      documentReads: hopLimit * 4,
    },
    { minutes: fileLimits.minutes, dollars: fileLimits.dollars },
  );
}

/**
 * Store a dark-run summary without losing the run's own status lines.
 *
 * Both run paths assemble one header and used to store it with
 * `slice(0, 2500)`. When the model's narrative was long that slice cut the
 * tail - the hop count, the saved dials, and "Brief: run stopped: ..." - so a
 * round whose brief never ran looked like an ordinary run that simply stopped
 * mid-word. Evidence: run 5 of 2026-09-16 stored a summary ending at "Hops".
 *
 * The trailing lines are kept whole and the narrative is what gets clipped.
 */
export function tailSafeDarkSummary(text: string, cap = 2_500): string {
  if (text.length <= cap) return text;
  const lines = text.split("\n");
  const tail: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i]!.length + 1;
    if (used + cost > cap) break;
    tail.unshift(lines[i]!);
    used += cost;
  }
  if (!tail.length) return text.slice(0, cap);
  const head = text.slice(0, Math.max(0, cap - used - 2));
  return `${head}\u2026\n${tail.join("\n")}`;
}

type DarkArtifactEvidence = {
  id: number;
  title: string;
  url: string;
  full_text: string;
  content_hash: string;
  version_id: number | null;
  capture_event_id: number | null;
  fetch_status: number | null;
  fetch_outcome: string | null;
};

type DarkArtifactCandidate = Omit<DarkArtifactEvidence, "full_text"> & {
  score: number;
};

type DarkArtifactChunk = {
  version_id: number;
  chunk_index: number;
  excerpt: string;
  page_number: number | null;
  locator: string;
};

function artifactReadable(artifact: DarkArtifactEvidence): boolean {
  return (
    readableCapture({
      text: artifact.full_text,
      status: artifact.fetch_status,
      outcome: artifact.fetch_outcome,
      title: artifact.title,
    }).kind === "ok"
  );
}

function focusTextScore(text: string, questionTerms: string[], frontierTerms: string[]) {
  const blob = text.toLowerCase();
  const hits = (terms: string[]) => terms.reduce((score, term) => score + (blob.includes(term) ? 1 : 0), 0);
  // The editor's question is the purpose of the pack. Frontier vocabulary is
  // useful context, but it must not crowd out the question with generic noise.
  return hits(questionTerms) * 5 + hits(frontierTerms);
}

function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  if (cap <= SECTION_BUDGET_MARKER.length) return text.slice(0, cap);
  return `${text.slice(0, cap - SECTION_BUDGET_MARKER.length)}${SECTION_BUDGET_MARKER}`;
}

/**
 * Select stored evidence by the editor's actual question before applying an
 * output cap. Captures are never inferred from a current URL: every header
 * carries the stored capture/version/hash and persisted chunks keep their
 * genuine page locators when the extractor supplied one.
 */
async function relevantDarkArtifactEvidence(
  investigationId: number,
  newsroomId: number,
  focus: { title: string; paste: string; frontier: string[] },
  budgetChars: number,
): Promise<{ text: string; artifacts: { title: string; url: string; evidence: string }[] }> {
  const sql = await getSql();
  const questionTerms = [...new Set(queryTokens(`${focus.title} ${focus.paste}`))];
  const frontierTerms = [
    ...new Set(queryTokens(focus.frontier.join(" ")).filter((term) => !questionTerms.includes(term))),
  ];
  // Score all stored captures in SQL, but transfer full bodies only after the
  // readable, version-aware candidates have been ranked. A large mature file
  // must not allocate every capture body in the application merely to choose
  // eight evidence records.
  const candidates = await sql.query<DarkArtifactCandidate>(
    `with scored as (
       select a.id, a.title, a.url, a.content_hash, a.version_id, a.capture_event_id,
         a.fetch_status, a.fetch_outcome,
         (
           5 * (select count(*) from unnest($3::text[]) term
                where position(term in lower(a.title || ' ' || a.url || ' ' || a.full_text)) > 0)
           + (select count(*) from unnest($4::text[]) term
              where position(term in lower(a.title || ' ' || a.url || ' ' || a.full_text)) > 0)
         )::int as score,
         case when a.version_id is null then 'artifact:' || a.id::text
              else 'version:' || a.version_id::text end as evidence_key
       from artifacts a
       where a.newsroom_id = $1
         and a.investigation_id = $2
         and char_length(btrim(a.full_text)) >= 40
         and coalesce(a.fetch_status, 200) < 400
         and coalesce(a.fetch_status, 200) not in (401, 403, 404, 410, 429)
         and coalesce(a.fetch_outcome, 'fetched') not in ('not-found', 'soft-404', 'fetch-failed', 'parse-failed')
         and coalesce(a.extraction_method, '') not in ('refused-too-large', 'refused-content-type')
     ), deduplicated as (
       select distinct on (evidence_key) id, title, url, content_hash, version_id, capture_event_id,
         fetch_status, fetch_outcome, score
       from scored
       order by evidence_key, id desc
     )
     select id, title, url, content_hash, version_id, capture_event_id, fetch_status, fetch_outcome, score
     from deduplicated
     where score > 0 or (cardinality($3::text[]) = 0 and cardinality($4::text[]) = 0)
     order by score desc, id desc
     limit $5`,
    [newsroomId, investigationId, questionTerms, frontierTerms, DARK_ARTIFACT_COUNT],
  );
  const selectedRows = candidates.length
    ? await sql.query<DarkArtifactEvidence>(
        `select id, title, url, full_text, content_hash, version_id, capture_event_id, fetch_status, fetch_outcome
         from artifacts
         where newsroom_id = $1 and id = any($2::int[])`,
        [newsroomId, candidates.map((candidate) => candidate.id)],
      )
    : [];
  const selectedById = new Map(selectedRows.map((artifact) => [artifact.id, artifact]));
  const selected = candidates
    .map((candidate) => selectedById.get(candidate.id))
    .filter((artifact): artifact is DarkArtifactEvidence => Boolean(artifact && artifactReadable(artifact)));

  if (!selected.length) return { text: "(none)", artifacts: [] };

  const versionIds = selected.flatMap((artifact) =>
    artifact.version_id == null ? [] : [artifact.version_id],
  );
  const persistedChunks = versionIds.length
    ? await sql.query<DarkArtifactChunk>(
        `select version_id, chunk_index, excerpt, page_number, locator
         from artifact_chunks
         where newsroom_id = $1 and version_id = any($2::int[])
         order by id asc`,
        [newsroomId, versionIds],
      )
    : [];
  let used = 0;
  const rendered: { title: string; url: string; evidence: string }[] = [];
  for (const artifact of selected) {
    const header = `### [capture:${artifact.capture_event_id ?? "—"} version:${artifact.version_id ?? "—"} hash:${artifact.content_hash.slice(0, 12)}] ${artifact.title}\n${artifact.url}`;
    const exactHits = persistedChunks
      .filter((chunk) => chunk.version_id === artifact.version_id)
      .map((chunk) => ({
        ...chunk,
        score: focusTextScore(chunk.excerpt, questionTerms, frontierTerms),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index);
    const separator = rendered.length ? 2 : 0;
    const availableEvidence = budgetChars - used - separator - header.length - 1;
    const formatChunk = (chunk: DarkArtifactChunk) =>
      `[${chunk.locator}${chunk.page_number == null ? "" : ` page:${chunk.page_number}`}] ${chunk.excerpt}`;
    const chunksForArtifact = persistedChunks
      .filter((chunk) => chunk.version_id === artifact.version_id)
      .sort((a, b) => a.chunk_index - b.chunk_index);
    const rankedPages = [...new Set(exactHits.flatMap((hit) => (hit.page_number == null ? [] : [hit.page_number])))]
      .map((pageNumber) => ({
        pageNumber,
        score: Math.max(...exactHits.filter((hit) => hit.page_number === pageNumber).map((hit) => hit.score)),
        chunks: chunksForArtifact.filter((chunk) => chunk.page_number === pageNumber),
      }))
      .sort((a, b) => b.score - a.score || a.chunks[0]!.chunk_index - b.chunks[0]!.chunk_index);
    const exact: string[] = [];
    let exactUsed = 0;
    for (const page of rankedPages) {
      const wholePage = page.chunks.map(formatChunk).join("\n");
      const separatorForPage = exact.length ? 1 : 0;
      if (wholePage.length + separatorForPage + exactUsed <= availableEvidence) {
        exact.push(wholePage);
        exactUsed += wholePage.length + separatorForPage;
        continue;
      }
      // A page that cannot fit still keeps a source-ordered neighborhood of
      // its strongest matching chunk. This preserves table-row context without
      // manufacturing a record parser or silently clipping an arbitrary head.
      const center = exactHits.find((hit) => hit.page_number === page.pageNumber);
      if (!center) continue;
      const neighborhood = page.chunks.filter((chunk) => Math.abs(chunk.chunk_index - center.chunk_index) <= 1);
      const bounded = neighborhood.map(formatChunk).join("\n");
      if (bounded.length + separatorForPage + exactUsed <= availableEvidence) {
        exact.push(bounded);
        exactUsed += bounded.length + separatorForPage;
      }
    }
    if (!exact.length && exactHits[0]) {
      const center = exactHits[0];
      const neighborhood = chunksForArtifact
        .filter(
          (chunk) =>
            chunk.page_number === center.page_number && Math.abs(chunk.chunk_index - center.chunk_index) <= 1,
        )
        .map(formatChunk)
        .join("\n");
      if (neighborhood) exact.push(capText(neighborhood, Math.max(0, availableEvidence)));
    }
    const fallbackChunks = chunksFromEvidence(artifact.full_text)
      .map((chunk) => ({
        ...chunk,
        score: focusTextScore(chunk.excerpt, questionTerms, frontierTerms),
      }));
    const fallback = (exact.length
      ? []
      : questionTerms.length || frontierTerms.length
        ? fallbackChunks.filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, 4)
        : fallbackChunks.slice(0, 1))
      .map(
        (chunk) =>
          `[${chunk.locator}${chunk.page_number == null ? "" : ` page:${chunk.page_number}`}] ${chunk.excerpt}`,
      );
    const evidence = [...exact, ...fallback.filter((excerpt) => !exact.includes(excerpt))].join("\n");
    const entry = `${header}\n${evidence || "[no matching excerpt retained]"}`;
    const remaining = budgetChars - used - separator;
    if (remaining <= header.length) break;
    const boundedEntry = capText(entry, remaining);
    used += separator + boundedEntry.length;
    rendered.push({ title: artifact.title, url: artifact.url, evidence: boundedEntry });
  }
  return { text: rendered.map((artifact) => artifact.evidence).join("\n\n") || "(none)", artifacts: rendered };
}

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

const readDarkSettingsFor = createServerOnlyFn(async (newsroomId: number) =>
  (await import("./dark-preferences.server.ts")).readDarkSettingsFor(newsroomId),
);
const saveDarkSettingsFor = createServerOnlyFn(async (
  newsroomId: number,
  input: { dials?: Partial<DarkDials>; preferences?: ResearchPreferences },
) => (await import("./dark-preferences.server.ts")).saveDarkSettingsFor(newsroomId, input));
const snapshotDarkSettingsFor = createServerOnlyFn(async (newsroomId: number, runId: number) =>
  (await import("./dark-preferences.server.ts")).snapshotDarkSettingsFor(newsroomId, runId),
);
/*
  The seed writer is a `.server` module and this file is reachable from the
  browser -- `routes/desk.ops.tsx` imports it -- so a plain import of it is
  refused outright by import-protection, which is what turned the 0.6.63 client
  build red. The other three server modules above cross the same boundary the
  same way.

  A plain import was not pruned here the way the ones inside a `createServerFn`
  handler are: `queueInvestigationFor` below is exported as a plain function so
  a test can call it without `deskMiddleware`'s request plumbing, and the client
  build has no server-fn boundary to prune its body at. A body handed to
  `createServerOnlyFn` IS such a boundary, so the client drops it and the write
  still happens on the server, which is the only place `getSql()` can be called.
*/
const proposePassSourcesFor = createServerOnlyFn(async (
  sql: Sql,
  input: {
    userId: string;
    newsroomId: number;
    proposedBy: "scan" | "research" | "dark" | "editor";
    leadId?: number | null;
    scanRunId?: number | null;
    section?: string | null;
    pages: { url: string; title?: string; reason?: string }[];
  },
) => (await import("./source-seeds.server.ts")).proposePassSources(sql, input));

/**
 * Same question Scan asks before it spends anything: is a model actually
 * reachable? Dark Desk did not ask it.
 *
 * An outside audit ran a dig with no provider configured and watched it
 * report SUCCESS: the planner fell back on every hop, `dark_runs.error` came
 * back "AI is not available…", and `desk_jobs.status` still landed on
 * `completed` with twelve cards filed from whatever the heuristic crawler
 * happened to fetch (mostly LinkedIn — QA-002). Nothing downstream of the
 * job queue can tell a real dig from that fallback, so the fix is the same
 * one Scan already has: refuse before a job is even enqueued, so no run,
 * no cards, no false "completed".
 *
 * Returns the same `{ ok: false, ... }` shape `runScan` returns so the UI's
 * existing error handling (which already knows how to show a refusal) works
 * unchanged; returns null when the desk should proceed.
 */
/**
 * The commit boundary for anything that spends on Dark Desk.
 *
 * 0.6.2: probes the model the EDITOR picked, not whatever `resolveProvider()`
 * happens to prefer on this machine. Same shape as Story's and Scan's
 * boundary (see model-request-commit.server.ts): refusing here means no job
 * row, no dark_runs row and no rate spend ever exist, so there is nothing for
 * the queue to mark completed while lying about what happened.
 */
async function probeDarkProvider(choice?: string, newsroomId?: number) {
  if (choice !== "auto") {
    const first = await probeProvider(choice, newsroomId, undefined, "dark");
    if (first.ok) return first;
    const plan = await planAutomaticFailover({
      source: "editor",
      current: choice ?? "auto",
      error: first.error,
      probe: (candidate) => probeProvider(candidate, newsroomId, undefined, "dark"),
      ladder: DARK_AUTOMATIC_LADDER,
    });
    if (!plan) return first;
    const resolved = await probeProvider(plan.next, newsroomId, undefined, "dark");
    if (!resolved.ok) return first;
    const previousLabel = modelChoiceLabel(choice ?? "auto");
    return {
      ...resolved,
      switchReceipt: {
        requested: choice,
        resolved: plan.next,
        reason: failoverReasonPhrase(previousLabel, plan.reason),
        note: failoverNoteSentence(plan.label, previousLabel, plan.reason),
        stage: `Switched to ${plan.label}: ${failoverReasonPhrase(previousLabel, plan.reason)}`,
      },
    };
  }
  /*
    0.6.63 (Unit Y item 2). Dark Desk walks the registry ladder now (item 1),
    so it inherits the rule that a rung whose model has to be ALREADY loaded is
    skipped rather than pinned -- and it inherits it from the rung's own probe
    (ai.ts), the same one Story, Scan and the mid-run hop use. A rung that was
    passed over is not a failure: it is carried out on the receipt, so a round
    that ran on Terra says Qwen was skipped and why, rather than looking like a
    round that never offered it.
  */
  const failures: string[] = [];
  const skippedRungs: string[] = [];
  for (const rung of ["configured", ...DARK_AUTOMATIC_LADDER]) {
    const result = await probeProvider(rung, newsroomId, undefined, "dark");
    if (result.ok) return skippedRungs.length ? { ...result, skippedRungs } : result;
    if (result.skippedRungs?.length) skippedRungs.push(...result.skippedRungs);
    else failures.push(result.error);
  }
  const skippedNote = skippedRungs.length ? ` Skipped: ${skippedRungs.join("; ")}.` : "";
  return {
    ok: false as const,
    error: `No Dark Desk Automatic provider is ready. ${failures.join(" ")}${skippedNote}`,
    ...(skippedRungs.length ? { skippedRungs } : {}),
  };
}

async function darkPreflightRefusal(
  choice?: string,
  newsroomId?: number,
  probed?: Awaited<ReturnType<typeof probeProvider>>,
): Promise<{
  ok: false;
  kind: string;
  error: string;
  detail: string;
  retryable: boolean;
} | null> {
  const { scanPreflight } = await import("./preflight.ts");
  const ready = scanPreflight(probed ?? await probeDarkProvider(choice, newsroomId), choice);
  if (ready.ok) return null;
  return {
    ok: false as const,
    kind: ready.kind,
    error: ready.guidance,
    detail: ready.detail,
    retryable: ready.retryable,
  };
}

export { openInvestigationForEditor } from "./dark-open.ts";

export type DarkSignalRow = {
  id: number;
  run_id: number | null;
  investigation_id: number | null;
  name: string;
  posture: string;
  signal_type: string;
  strength: number;
  confidence: number;
  observation: string;
  pattern: string;
  linkage_map: string;
  alternatives: string;
  counter_narrative: string;
  what_would_kill: string;
  pathway: string;
  privacy_review: string;
  handoff: string;
  created_at: string;
  /** 'black-desk' (stage 1, speculative) or 'dark-signal-desk' (stage 2 ran). */
  stage?: string | null;
  /** 'unverified' until all four gates are answered. Never assumed. */
  verification_status?: string | null;
  gates_missing?: string | null;
  gate_missing_context?: string | null;
  adversarial_json?: string | null;
  newsworthiness_json?: string | null;
  newsworthiness_decision?: string | null;
};

export type DarkRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
  /** Null on every round dug before 0.6.2 gave Dark Desk a picker. */
  model_choice: string | null;
  model_effort: ModelEffort | null;
  investigation_id: number | null;
  stopReason: string | null;
  usageRecorded?: boolean;
  usage: import("./dark-run-budget.ts").DarkRunUsageSnapshot;
};

async function persistDarkRunUsage(
  runId: number,
  newsroomId: number,
  usage: DarkRunUsageSnapshot,
  stopReason?: DarkRunStopReason | null,
) {
  const sql = await getSql();
  await sql`
    update dark_runs
    set usage_totals_json = ${JSON.stringify(usage.totals)},
        usage_ledger_json = ${JSON.stringify(usage.calls)},
        stop_reason = coalesce(${stopReason ?? null}, stop_reason)
    where id = ${runId} and newsroom_id = ${newsroomId}
  `;
}

export type DarkPromiseRow = {
  id: number;
  who_promised: string;
  what: string;
  when_due: string | null;
  source_cite: string | null;
  status: string;
  created_at: string;
};

export type InvestigationRow = {
  id: number;
  title: string;
  ordinary_explanation: string;
  scope_json: string;
  limit_key: string;
  limit_minutes: number;
  limit_dollars: number | string | null;
  status: string;
  summary: string;
  hops: number;
  budget: number;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
  records?: number;
  still_open?: number;
  waiting_follow_up?: string | null;
  waiting_watch?: string | null;
  waiting_since?: string | null;
  closed_kind?: string | null;
  close_note?: string | null;
  /**
   * The model that last dug this file (0.6.2). Null on every investigation
   * opened before Dark Desk had a picker; the page falls back to Automatic.
   */
  last_model_choice?: string | null;
};

/**
 * One capture as both handoff writers read it: enough of `artifacts` for
 * `leadSourceRefusalReason` to judge whether it may become a source on a lead.
 */
type CapturedArtifactRow = {
  url: string;
  title: string;
  fetch_status: number | null;
  fetch_outcome: string | null;
  full_text: string | null;
};

/**
 * One `artifacts` row as `leadSourceRefusalReason` reads it.
 *
 * The two handoff writers select these rows with snake_cased columns, and they
 * used to hand the row straight to `usableLeadSources`, which reads
 * `CapturedPage` -- `fetchStatus`, `fetchOutcome`, `text`. Every one of those
 * was `undefined` on a raw row, and TypeScript never said so: `CapturedPage`'s
 * fields are all optional, so a snake_cased row structurally *satisfies* it.
 * The whole capture check was therefore skipped and a 404, a 403 or a
 * soft-404 whose title happened to share a word with the lead was still listed
 * as a source on it.
 *
 * The translation is explicit and in one place so a later column can be added
 * without the judge silently reading `undefined` for it. A capture read any
 * other way is a capture the desk has not judged.
 */
const capturedPageOf = (row: CapturedArtifactRow): CapturedPage => ({
  url: row.url,
  title: row.title,
  fetchStatus: row.fetch_status,
  fetchOutcome: row.fetch_outcome,
  text: row.full_text,
});

const HANDOFFS = new Set([
  "HOLD FOR PATTERN",
  "MONITOR",
  "FOR VERIFICATION",
  "CONTINUE",
  "FINDING",
  "DEAD END",
]);

type DarkJson = {
  window?: string;
  inventory_gaps?: string[];
  editor_summary?: string;
  promises?: {
    who?: string;
    what?: string;
    when_due?: string;
    source_cite?: string;
    status?: string;
  }[];
  signals?: {
    name?: string;
    posture?: string;
    type?: string;
    strength?: number;
    confidence?: number;
    observation?: string;
    pattern?: string;
    linkage_map?: string;
    alternatives?: string;
    counter_narrative?: string;
    what_would_kill?: string;
    pathway?: string;
    privacy_review?: string;
    handoff?: string;
  }[];
};

type DarkSignal = NonNullable<DarkJson["signals"]>[number];

type CandidateDarkPromise = NonNullable<DarkJson["promises"]>[number];

function normalizedEvidenceText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Promise rows become standing newsroom leads, so a prompt instruction is not
 * enough. Require the named actor and returned source locator to exist in the
 * evidence, plus explicit commitment language near that actor. If this narrow
 * boundary fails, the surrounding signal stays; only the unsupported promise
 * row is omitted.
 */
export function isGroundedDarkPromise(p: CandidateDarkPromise, evidencePack: string): boolean {
  const who = normalizedEvidenceText(p.who);
  const what = normalizedEvidenceText(p.what);
  const cite = normalizedEvidenceText(p.source_cite);
  const evidence = normalizedEvidenceText(evidencePack);
  if (
    !who ||
    !what ||
    cite.length < 8 ||
    !evidence.includes(who) ||
    !evidence.includes(what) ||
    !evidence.includes(cite)
  ) return false;

  const commitment = /\b(?:will|shall|promis(?:e|es|ed)|commit(?:s|ted)?|pledge(?:s|d)?|agree(?:s|d)?|scheduled to|plans? to|intends? to|by \d{4}-\d{2}-\d{2})\b/i;
  let from = evidence.indexOf(who);
  while (from >= 0) {
    const nearby = evidence.slice(Math.max(0, from - 500), Math.min(evidence.length, from + who.length + 700));
    if (commitment.test(nearby)) return true;
    from = evidence.indexOf(who, from + who.length);
  }
  return false;
}

/** The visible window comes from the saved run setting, never model inference. */
export function groundedDarkWindow(preferences?: ResearchSnapshot): string {
  return preferences
    ? `${preferences.startDate} through ${preferences.endDate} (search preference; verify dates in each source)`
    : "unknown";
}

/**
 * A bounded file cannot establish universal nonexistence. Models commonly
 * shorten "not established in this file" to "no record was found," so narrow
 * that phrasing again before factual summary/observation text is persisted.
 * Hypothesis fields remain untouched so the desk can still test a concrete
 * hidden explanation.
 */
export function preserveBoundedAbsenceLanguage(value: unknown, evidencePack: string): string {
  const text = String(value ?? "");
  const asObject = (subject: string) => subject.trim().replace(/^(The|A|An)\b/, (article) => article.toLowerCase());
  const boundedPack = /(?:not established|no [^.\n]{2,180}? (?:was|were) established) in (?:the )?(?:captured|provided|bounded|current|available)?\s*(?:material|file|record|evidence)|absence of (?:those|these|the) records[^.]{0,120}does not prove/i.test(evidencePack);
  if (!boundedPack) return text;

  const narrowed = text.replace(
    /\bNo\s+([^.\n]{2,180}?)\s+(?:was|were)\s+found(?:\s+in\s+(?:the\s+)?(?:provided|current|captured|available|bounded)\s+(?:search notes|file|record|material|evidence(?:\s+pack)?))?(?=[.;\n]|$)/gi,
    (_match, subject: string) => `The bounded evidence pack did not establish ${subject.trim()}`,
  );
  return narrowed
    .replace(
      /\b([^.\n]{2,180}?)\s+does not exist(?=[.;\n]|$)/gi,
      (_match, subject: string) => `The bounded evidence pack did not establish the existence of ${asObject(subject)}`,
    )
    .replace(
      /\b([^.\n]{2,180}?)\s+is\s+(unregistered|unpermitted|missing)(?=[.;\n]|$)/gi,
      (_match, subject: string, state: string) => {
        const object = state.toLowerCase() === "unregistered"
          ? "registration for"
          : state.toLowerCase() === "unpermitted"
            ? "permits for"
            : "the presence of";
        return `The bounded evidence pack did not establish ${object} ${asObject(subject)}`;
      },
    );
}

/**
 * Reject a response only when every substantive field is model-process
 * narration. A real lead must not disappear because one field contains an
 * awkward progress note; its other observations, connections and follow-ups
 * remain useful to the editor. Exported for tests only.
 */
export function isPoisonedSignal(sig: DarkSignal): boolean {
  const fields = [
    sig.name,
    sig.observation,
    sig.pattern,
    sig.linkage_map,
    sig.alternatives,
    sig.counter_narrative,
    sig.what_would_kill,
    sig.pathway,
  ].map((v) => String(v ?? "").trim()).filter(Boolean);
  return fields.length > 0 && fields.every((value) => isSelfReferential(value));
}

// The inline DDL this desk owns directly (dark_* tables + the brief/settings
// tables). Kept as a plain statement list — rather than issued one at a time
// as before — so `ensureSchemaOnce` (src/lib/db.ts) can fingerprint the whole
// batch and skip it entirely once the database already has these objects.
// See that function's doc comment for why a per-process boolean would be
// wrong here (a rebuilt database under a live process must not look "ensured").
export const DARK_SCHEMA_STATEMENTS: readonly string[] = [
  `create table if not exists investigation_briefs (
      investigation_id integer primary key,
      newsroom_id integer not null default 1,
      brief_json text not null default '{}',
      generated_at timestamptz not null default now()
    )`,
  `create table if not exists dark_settings (
      newsroom_id integer primary key,
      dig integer not null default 4,
      nerve integer not null default 5,
      scope text not null default 'city',
      updated_at timestamptz not null default now()
    )`,
  `create table if not exists dark_runs (
      id serial primary key,
      user_id text not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      summary text,
      error text
    )`,
  `create index if not exists dark_runs_user_idx on dark_runs (user_id, started_at desc)`,
  /*
    Which writing model did this round (0.6.2). Mirrors
    migrations/0030_dark_model_choice.sql. The round history says so out loud
    -- "Claude Opus / 6 hops" -- because a round that dug badly and a round
    that dug on a different model are different facts about the same file.
  */
  `alter table dark_runs add column if not exists model_choice text`,
  `alter table dark_runs add column if not exists model_effort text`,
  // Mirrors migrations/0012_newsroom_appliance.sql. A rebuild-under-live-
  // process (ensureDarkSchema's whole reason to exist) must recreate a
  // dark_runs/dark_signals/dark_promises the rest of this file can actually
  // query -- every read here filters on newsroom_id (GauntletGate ENG-02).
  `alter table dark_runs add column if not exists newsroom_id integer not null default 1`,
  `create table if not exists dark_signals (
      id serial primary key,
      user_id text not null,
      run_id integer references dark_runs(id) on delete set null,
      name text not null,
      posture text not null,
      signal_type text not null,
      strength integer not null default 3,
      confidence numeric not null default 0.3,
      observation text not null default '',
      pattern text not null default '',
      linkage_map text not null default '',
      alternatives text not null default '',
      counter_narrative text not null default '',
      what_would_kill text not null default '',
      pathway text not null default '',
      privacy_review text not null default '',
      handoff text not null default 'HOLD FOR PATTERN',
      investigation_id integer,
      created_at timestamptz not null default now()
    )`,
  `create index if not exists dark_signals_user_idx on dark_signals (user_id, created_at desc)`,
  `alter table dark_signals add column if not exists investigation_id integer`,
  `alter table dark_signals add column if not exists newsroom_id integer not null default 1`,
  `create table if not exists dark_promises (
      id serial primary key,
      user_id text not null,
      who_promised text not null,
      what text not null,
      when_due text,
      source_cite text,
      status text not null default 'open',
      created_at timestamptz not null default now()
    )`,
  `create index if not exists dark_promises_user_idx on dark_promises (user_id, created_at desc)`,
  `alter table dark_promises add column if not exists newsroom_id integer not null default 1`,
  /*
    The two stages, and the four gates between them. Mirrors
    migrations/0043_dark_gates.sql. A signal is filed by the Black Desk
    (stage 1, speculative, confidence capped at 0.5) and stays
    `verification_status = 'unverified'` until the Dark Signal Desk has run
    the adversarial searches and the model has answered all four gates.
  */
  `alter table dark_signals add column if not exists stage text not null default 'black-desk'`,
  `alter table dark_signals add column if not exists verification_status text not null default 'unverified'`,
  `alter table dark_signals add column if not exists gate_disproof text`,
  `alter table dark_signals add column if not exists gate_source_independence text`,
  `alter table dark_signals add column if not exists gate_missing_context text`,
  `alter table dark_signals add column if not exists gate_self_referential boolean`,
  `alter table dark_signals add column if not exists gates_missing text`,
  `alter table dark_signals add column if not exists adversarial_json text`,
  `alter table dark_signals add column if not exists newsworthiness_json text`,
  `alter table dark_signals add column if not exists newsworthiness_decision text`,
  `alter table dark_signals add column if not exists verified_at timestamptz`,
  `alter table dark_runs add column if not exists searches_json text`,
  `alter table dark_runs add column if not exists stage text`,
  `alter table dark_settings add column if not exists county text`,
  `alter table dark_settings add column if not exists research_preferences text not null default '{}'`,
  `alter table dark_runs add column if not exists research_preferences_json text`,
  `alter table dark_runs add column if not exists verification_counts_json text`,
  `alter table dark_runs add column if not exists investigation_id integer`,
  `alter table dark_runs add column if not exists stop_reason text`,
  `alter table dark_runs add column if not exists usage_totals_json text not null default '{}'`,
  `alter table dark_runs add column if not exists usage_ledger_json text not null default '[]'`,
  `create index if not exists dark_runs_investigation_idx on dark_runs (newsroom_id, investigation_id, started_at desc)`,
];

export async function ensureDarkSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "dark", DARK_SCHEMA_STATEMENTS);
  await ensureInvestigateSchema();
}

export const listDarkSignals = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<DarkSignalRow>`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals
      where newsroom_id = ${owned(context)}
      order by created_at desc
      limit 40
    `;
  });

export const listDarkRuns = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const rows = await sql<StoredDarkRunRow>`
      select id, started_at, finished_at, summary, error, model_choice, model_effort, investigation_id,
             stop_reason, usage_totals_json, usage_ledger_json
      from dark_runs
      where newsroom_id = ${owned(context)}
      order by started_at desc
      limit 12
    `;
    return rows.map(presentDarkRun);
  });

export const listDarkPromises = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<DarkPromiseRow>`
      select id, who_promised, what, when_due, source_cite, status, created_at
      from dark_promises
      where newsroom_id = ${owned(context)}
      order by created_at desc
      limit 40
    `;
  });

export async function listInvestigationsFor(newsroomId: number) {
  await ensureDarkSchema();
  await ensureFollowUpsSchema();
  await ensurePageWatchSchema();
  const sql = await getSql();
  const rows = await sql<InvestigationRow>`
      select i.id, i.title, i.ordinary_explanation, i.scope_json, i.limit_key, i.limit_minutes,
        i.limit_dollars, i.status, i.summary, i.hops, i.budget, i.pause_reason,
        i.created_at, i.updated_at, i.closed_kind, i.close_note,
        (select f.what from follow_ups f
         where f.investigation_id = i.id and f.newsroom_id = i.newsroom_id
           and f.status = 'active' and f.agent_kind is not null
         order by f.id desc limit 1) as waiting_follow_up,
        (select f.created_at::text from follow_ups f
         where f.investigation_id = i.id and f.newsroom_id = i.newsroom_id
           and f.status = 'active' and f.agent_kind is not null
         order by f.id desc limit 1) as waiting_since,
        (select coalesce(nullif(m.watch_reason, ''), m.title) from source_monitors m
         where m.investigation_id = i.id and m.newsroom_id = i.newsroom_id
           and m.manual_watch = true and m.watch_state = 'active' and m.enabled = true
         order by m.id desc limit 1) as waiting_watch,
        coalesce((
          -- Unit DD1, item 6: captures, and only captures. The editor's own
          -- pasted tip is an editor:// row, and counting it here is what put
          -- the rail one ahead of the file's own line. See dark-counters.ts.
          select count(*)::int from artifacts a
          where a.investigation_id = i.id and a.url not like 'editor://%'
        ), 0) as records,
        coalesce((
          select count(*)::int from frontier_items f
          where f.investigation_id = i.id
            and f.status in ('open', 'investigating', 'reopened', 'deferred')
        ), 0) as still_open
      from investigations i
      where i.newsroom_id = ${newsroomId}
      order by i.updated_at desc
    `;
  return rows.map((r) => ({
    ...r,
    records: Number(r.records ?? 0),
    still_open: Number(r.still_open ?? 0),
  }));
}

export const listInvestigations = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => listInvestigationsFor(owned(context)));

async function gatherWorthALook(newsroomId: number): Promise<WorthSeed[]> {
  const sql = await getSql();
  const anomalies = await sql<{
    kind: string;
    summary: string;
    url: string | null;
    details: string;
  }>`
    select kind, summary, url, details from anomalies
    where newsroom_id = ${newsroomId}
    order by id desc limit 24
  `.catch(() => []);
  const monitors = await sql<{ url: string; title: string; last_outcome: string | null }>`
    select url, title, last_outcome from source_monitors
    where newsroom_id = ${newsroomId} and enabled = true
    order by last_check_at desc nulls last
    limit 24
  `.catch(() => []);
  const leads = await sql<{
    id: number;
    headline: string;
    why: string;
    evidence: string | null;
    newsworthiness: number | null;
    source_urls: string;
  }>`
    select id, headline, why, evidence, newsworthiness, source_urls from leads
    where newsroom_id = ${newsroomId} and status in ('new', 'held', 'drafted')
    order by newsworthiness desc nulls last, id desc
    limit 12
  `.catch(() => []);
  const frontier = await sql<{
    label: string;
    kind: string;
    why: string;
    status: string;
    closed_reason: string | null;
    evidence: string | null;
  }>`
    select label, kind, why, status, closed_reason, evidence from frontier_items
    where newsroom_id = ${newsroomId} and status in ('reopened', 'open')
    order by priority desc, id desc
    limit 16
  `.catch(() => []);
  const signals = await sql<{
    id: number;
    name: string;
    observation: string;
    pathway: string;
    handoff: string;
    strength: number;
  }>`
    select id, name, observation, pathway, handoff, strength from dark_signals
    where newsroom_id = ${newsroomId}
    order by id desc limit 12
  `.catch(() => []);
  const promises = await sql<{
    who_promised: string;
    what: string;
    when_due: string | null;
    source_cite: string | null;
    status: string;
  }>`
    select who_promised, what, when_due, source_cite, status from dark_promises
    where newsroom_id = ${newsroomId} and status in ('open', 'unclear')
    order by id desc limit 8
  `.catch(() => []);
  return presentWorthItems(
    signalReviewItems(rankWorthItems({ anomalies, monitors, leads, frontier, signals, promises })),
  );
}

export const listWorthALook = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    return gatherWorthALook(owned(context));
  });

export async function draftSignalFileFor(
  item: WorthSeed,
  newsroomId: number,
  choice: string,
  effort: ModelEffort | null,
  chat: typeof grokChat = grokChat,
) {
  const ai = await chat(
    "Draft one investigative question and one ordinary explanation that could also fit the signal. Return JSON with question and ordinary_explanation. Do not claim the signal is true. Do not add people, dates, counts, events, or sources absent from the supplied material. Keep both fields concise and suitable for an editor to revise.",
    JSON.stringify({ title: item.title, whatWasSeen: item.happened, source: item.source_url, evidence: item.evidence }),
    700,
    {
      choice: effectiveStoryModelChoice(choice),
      newsroomId,
      reasoningEffort: validatedModelEffort(choice, effort),
      noTools: true,
    },
  );
  if (!ai.ok) return { ok: false as const, error: "The AI could not draft the question and ordinary explanation." };
  const drafted = parseJsonBlock<{ question?: unknown; ordinary_explanation?: unknown }>(ai.text);
  const question = String(drafted?.question ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
  const explanation = String(drafted?.ordinary_explanation ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (question.length < 8 || explanation.length < 8) {
    return { ok: false as const, error: "The AI draft was incomplete. Try again or start a file without it." };
  }
  return {
    ok: true as const,
    prefill: { question, tip: item.seed, explanation },
  };
}

export const draftSignalFile = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => draftSignalFileInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    const item = (await gatherWorthALook(owned(context))).find((row) => row.id === data.id);
    if (!item) return { ok: false as const, error: "That signal is no longer available." };
    return draftSignalFileFor(item, owned(context), data.choice, data.effort);
  });

export const getInvestigation = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const inv = await sql<InvestigationRow>`
      select i.id, i.title, i.ordinary_explanation, i.scope_json, i.limit_key, i.limit_minutes,
             i.limit_dollars, i.status, i.summary, i.hops, i.budget, i.pause_reason,
             i.closed_kind, i.close_note,
             i.created_at, i.updated_at, i.last_model_choice,
             coalesce((
               select count(*)::int from frontier_items f
               where f.investigation_id = i.id
                 and f.newsroom_id = ${owned(context)}
                 and f.status in ('open', 'investigating', 'reopened', 'deferred')
             ), 0) as still_open
      from investigations i
      where i.id = ${id} and i.newsroom_id = ${owned(context)} limit 1
    `;
    if (!inv[0]) return null;
    const frontier = await sql<{
      id: number;
      kind: string;
      label: string;
      why: string;
      priority: number;
      status: string;
      closed_reason: string | null;
      prior_status: string | null;
      reopened_at: string | null;
    }>`
      select id, kind, label, why, priority, status, closed_reason, prior_status, reopened_at::text as reopened_at
      from frontier_items
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by priority desc, id desc limit 40
    `;
    const artifacts = await sql<{
      id: number;
      url: string;
      title: string;
      classification: string;
      fetch_status: number | null;
      fetch_outcome: string | null;
      version_id: number | null;
      created_at: string;
      excerpt: string;
      extraction_method: string | null;
    }>`
      select id, url, title, classification, fetch_status, fetch_outcome, version_id,
        created_at,
        case when url like 'editor://%' then full_text else left(full_text, 2500) end as excerpt,
        extraction_method
      from artifacts
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 60
    `;
    /*
      Unit DD1, item 6. The sixty rows above are a page, not a fact about the
      file, so the counts the editor is shown are asked for separately and over
      the whole file -- the same query `listInvestigations` counts the rail row
      with, so the two surfaces cannot say different things about one file.
    */
    const captureCountRows = await sql
      .query<{ captures: number; readable: number }>(DIG_CAPTURE_COUNT_SQL, [owned(context), id])
      .catch(() => [] as { captures: number; readable: number }[]);
    const captureCounts = captureCountRows[0]
      ? digCaptureCounts(captureCountRows[0])
      : digCaptureCountsFromRows(artifacts);
    const entities = await sql<{ name: string; kind: string; why: string }>`
      select e.name, e.kind, e.why
      from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${id} and ie.newsroom_id = ${owned(context)}
      order by ie.id desc limit 40
    `;
    const historicalEntities = await sql<{
      name: string;
      kind: string;
      why: string;
      investigation_id: number;
      verdict: string | null;
    }>`
      select e.name, e.kind, e.why, ie.investigation_id, m.verdict
      from entities e
      join investigation_entities ie on ie.entity_id = e.id
      left join entity_matches m on m.newsroom_id = ${owned(context)}
        and (
          (m.left_canonical = e.canonical and m.right_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.newsroom_id = ${owned(context)}
          ))
          or (m.right_canonical = e.canonical and m.left_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.newsroom_id = ${owned(context)}
          ))
        )
      where e.newsroom_id = ${owned(context)}
        and ie.investigation_id <> ${id}
        and (
          e.canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.newsroom_id = ${owned(context)}
          )
          or m.id is not null
        )
      order by ie.id desc
      limit 12
    `;
    const relationships = await sql<{
      from_name: string;
      to_name: string;
      kind: string;
      evidence: string;
      version_id: number | null;
      capture_event_id: number | null;
      provenance_status: string | null;
    }>`
      select from_name, to_name, kind, evidence, version_id, capture_event_id, provenance_status from relationships
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 40
    `;
    const claims = await sql<{
      body: string;
      kind: string;
      evidence: string;
      confidence: number | null;
      version_id: number | null;
      capture_event_id: number | null;
      provenance_status: string | null;
    }>`
      select body, kind, evidence, confidence, version_id, capture_event_id, provenance_status from claims
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 40
    `;
    const hypotheses = await sql<{
      body: string;
      status: string;
      supporting: string;
      contradicting: string;
    }>`
      select body, status, supporting, contradicting from hypotheses
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 20
    `;
    const anomalies = await sql<{ kind: string; summary: string; url: string | null }>`
      select kind, summary, url from anomalies
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 20
    `;
    const deadEnds = await sql<{ hypothesis: string; dismissed_because: string }>`
      select hypothesis, dismissed_because from dead_ends
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 20
    `;
    const searches = await sql<{
      hop: number;
      query: string;
      state: string | null;
      provider: string | null;
      generated_json: string | null;
      selected_json: string | null;
      tier: string | null;
      strategy: string | null;
    }>`
      select hop, query, state, provider, generated_json, selected_json, tier, strategy from search_log
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 40
    `;
    const signalRows = await sql<{
      id: number;
      name: string;
      observation: string;
      handoff: string;
      strength: number;
      confidence: number;
      posture: string;
      stage: string | null;
      verification_status: string | null;
      gates_missing: string | null;
      adversarial_json: string | null;
      newsworthiness_json: string | null;
      newsworthiness_decision: string | null;
    }>`
      select id, name, observation, handoff, strength, confidence, posture,
             stage, verification_status, gates_missing, adversarial_json,
             newsworthiness_json, newsworthiness_decision
      from dark_signals
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 12
    `.catch(() => []);
    /*
      The stage is spelled out in words on the way to the page, not left as a
      column name for the UI to interpret. Every state an editor can hit gets
      a sentence: "Black Desk · speculative, ≤50%", "Verified · four gates",
      or "Unverified · gates missing: ...".
    */
    const signals = signalRows.map((s) => {
      const words = stageWords(s);
      let adversarial: { query: string; tier: string; outcome: string; url: string | null }[] = [];
      try {
        adversarial = s.adversarial_json ? JSON.parse(s.adversarial_json) : [];
      } catch {
        adversarial = [];
      }
      let newsworthiness: string | null = null;
      try {
        newsworthiness = s.newsworthiness_json
          ? newsworthinessWords(readNewsworthiness(JSON.parse(s.newsworthiness_json)))
          : null;
      } catch {
        newsworthiness = null;
      }
      return {
        ...s,
        stageChip: words.chip,
        stageSentence: words.sentence,
        adversarial,
        newsworthiness,
      };
    });
    const briefRow = await sql<{ brief_json: string }>`
      select brief_json from investigation_briefs where investigation_id = ${id} limit 1
    `.catch(() => []);
    let brief: InvestigationBrief | null = null;
    try {
      // Re-parsed rather than trusted: a stored brief from an older shape must
      // render or be dropped, never break the page it sits on.
      brief = briefRow[0] ? parseBrief(JSON.parse(briefRow[0].brief_json)) : null;
    } catch {
      // A brief that will not parse is the same as no brief. The four lists
      // below are the real content; this only ever helps.
      brief = null;
    }

    /*
      "investigating" is the only status the page polls on -- see
      `desk.dark.tsx`'s `detail` query. `performDarkRound` inserts a FRESH
      dark_runs row every round rather than reusing one, so a process killed
      mid-round leaves the investigation stuck at "investigating" with no run
      record to even check: the status itself is the only open state there
      is, and nothing ever flips it back without a live job behind it.
    */
    const job = await latestJob({ newsroomId: owned(context), kind: "dark", subjectId: id });
    const stalled = runLooksStalled({ runOpen: inv[0].status === "investigating", job });
    const runRows = await sql<StoredDarkRunRow>`
      select id, started_at, finished_at, summary, error, model_choice, model_effort, investigation_id,
             stop_reason, usage_totals_json, usage_ledger_json
      from dark_runs
      where newsroom_id = ${owned(context)} and investigation_id = ${id}
      order by started_at desc limit 1
    `;

    /*
      The brief is its own job now (0.6.2), so the page has something to poll
      on rather than holding an HTTP request open for the length of a model
      call. Only the fields the page actually renders are returned.
    */
    const brief_job = await latestJob({
      newsroomId: owned(context),
      kind: "brief",
      subjectId: id,
    });
    const investigationFollowUps = (await performListFollowUps(
      { userId: context.userId, newsroomId: owned(context) },
      { limit: 200 },
    ))
      .filter((row) => row.investigation_id === id)
      .map((row) => ({
        id: row.id,
        what: row.what,
        agentKind: row.agent_kind,
        status: row.status,
        lastState: row.last_state,
        findingJson: row.finding_json,
        targetsJson: row.targets_json,
        createdAt: row.created_at,
      }));

    return {
      investigation: inv[0],
      stalled,
      darkJob: job
        ? { id: job.id, status: job.status, stage: job.stage, error: job.error }
        : null,
      run: runRows[0] ? presentDarkRun(runRows[0]) : null,
      briefJob: brief_job
        ? { id: brief_job.id, status: brief_job.status, error: brief_job.error }
        : null,
      brief,
      investigationFollowUps,
      captureCounts,
      frontier,
      artifacts,
      entities,
      historicalEntities,
      relationships,
      claims,
      hypotheses,
      anomalies,
      deadEnds,
      searches,
      signals,
    };
  });

export const investigationActivity = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    await ensureInvestigateSchema();
    const sql = await getSql();
    const newsroomId = owned(context);
    const [captures, searches, findings, deadEnds, runs, followUps] = await Promise.all([
      sql<{ id: number; at: string; title: string; url: string; outcome: string; httpStatus: number | null; removed: boolean }>`
        select ce.id, ce.observed_at::text as at, coalesce(a.title, '') as title, ce.source_url as url,
          ce.fetch_outcome as outcome, ce.http_status as "httpStatus", ce.disappearance as removed
        from capture_events ce
        left join artifacts a on a.capture_event_id = ce.id and a.newsroom_id = ce.newsroom_id
        where ce.investigation_id = ${id} and ce.newsroom_id = ${newsroomId}
        order by ce.observed_at desc limit 120
      `.catch(() => [] as { id: number; at: string; title: string; url: string; outcome: string; httpStatus: number | null; removed: boolean }[]),
      sql<{ id: number; at: string; state: string | null; resultsJson: string }>`
        select id, created_at::text as at, state, results_json as "resultsJson"
        from search_log where investigation_id = ${id} and newsroom_id = ${newsroomId}
        order by created_at desc limit 120
      `.catch(() => [] as { id: number; at: string; state: string | null; resultsJson: string }[]),
      sql<{ id: number; at: string; body: string }>`
        select id, created_at::text as at, body from claims
        where investigation_id = ${id} and newsroom_id = ${newsroomId}
          and (capture_event_id is not null or source_url is not null)
        order by created_at desc limit 60
      `.catch(() => [] as { id: number; at: string; body: string }[]),
      sql<{ id: number; at: string; hypothesis: string }>`
        select id, created_at::text as at, hypothesis from dead_ends
        where investigation_id = ${id} and newsroom_id = ${newsroomId}
        order by created_at desc limit 60
      `.catch(() => [] as { id: number; at: string; hypothesis: string }[]),
      sql<{ id: number; at: string; stopReason: string | null; failed: boolean }>`
        select id, coalesce(finished_at, started_at)::text as at, stop_reason as "stopReason",
          (error is not null) as failed
        from dark_runs
        where investigation_id = ${id} and newsroom_id = ${newsroomId}
          and (finished_at is not null or error is not null or stop_reason is not null)
        order by started_at desc limit 30
      `.catch(() => [] as { id: number; at: string; stopReason: string | null; failed: boolean }[]),
      performListFollowUps({ userId: context.userId, newsroomId }, { limit: 200 }).catch(() => []),
    ]);
    const events: InvestigationActivityInput[] = [
      ...captures.map((row) => ({ id: `capture-${row.id}`, at: row.at, kind: "capture" as const, title: row.title, url: row.url, outcome: row.outcome, httpStatus: row.httpStatus, removed: row.removed })),
      ...searches.map((row) => ({ id: `search-${row.id}`, at: row.at, kind: "search" as const, outcome: row.state, resultsJson: row.resultsJson })),
      ...findings.map((row) => ({ id: `finding-${row.id}`, at: row.at, kind: "finding" as const, body: row.body })),
      ...deadEnds.map((row) => ({ id: `dead-end-${row.id}`, at: row.at, kind: "dead-end" as const, body: row.hypothesis })),
      ...runs.map((row) => ({ id: `run-${row.id}`, at: row.at, kind: "run-stop" as const, stopReason: row.stopReason, failed: row.failed })),
      ...followUps
        .filter((row) => row.investigation_id === id && ["active", "paused"].includes(row.status))
        .map((row) => {
          const finding = parseFinding(row.finding_json);
          const found = row.last_state === "found";
          return {
            id: `follow-up-${row.id}`,
            at: row.last_run_at ?? row.created_at,
            kind: "follow-up" as const,
            body: found ? finding.summary || finding.title || row.what : row.what,
            found,
          };
        }),
    ];
    return buildInvestigationActivity(events);
  });

export const getArtifact = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      url: string;
      title: string;
      full_text: string;
      fetch_outcome: string | null;
      fetch_status: number | null;
      created_at: string;
      retained_pdf: boolean;
    }>`
      select id, url, title, left(full_text, 120000) as full_text, fetch_outcome, fetch_status, created_at,
        exists(select 1 from artifact_blobs b where b.version_id=artifacts.version_id
          and b.newsroom_id=artifacts.newsroom_id and b.mime ilike '%pdf%' and b.body_b64<>'') as retained_pdf
      from artifacts
      where id = ${id} and newsroom_id = ${owned(context)}
      limit 1
    `;
    return rows[0] ?? null;
  });

type ArtifactOcrRequest = {
  artifactId: number;
  start: number;
  end: number;
  modelChoice: string;
  modelEffort?: ModelEffort | null;
  mode: "range" | "complete";
};
type ArtifactOcrReceipt = {
  request?: ArtifactOcrRequest;
  artifactId?: number;
  mode?: "range" | "complete";
  start?: number;
  end?: number;
  pages?: { page: number | null; text: string }[];
  pagesRead?: number;
  pagesTotal?: number;
  batchesCompleted?: number;
  batchesTotal?: number;
  unreadPages?: number[];
  modelCalls?: number;
  budgetPaused?: boolean;
  provider?: string;
  reason?: string | null;
};

/** One click may spend at most this many page-transcription attempts, including fallbacks. */
export const ARTIFACT_OCR_MAX_MODEL_CALLS = 48;

function artifactOcrRequest(raw: ArtifactOcrRequest | ArtifactOcrReceipt): ArtifactOcrRequest {
  const input: Partial<ArtifactOcrRequest> =
    "request" in raw && raw.request ? raw.request : (raw as ArtifactOcrRequest);
  const artifactId = Number(input?.artifactId);
  const mode = input?.mode === "complete" ? "complete" : "range";
  const start = mode === "complete" ? 1 : Number(input?.start);
  const end = mode === "complete" ? 1 : Number(input?.end);
  if (!Number.isInteger(artifactId) || artifactId < 1) throw new Error("Choose a captured PDF.");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 12) {
    throw new Error("Choose one to twelve PDF pages.");
  }
  const requestedChoice = String(input?.modelChoice ?? "").trim();
  if (!requestedChoice || !isOfferedForJob("ocr", requestedChoice)) {
    throw new Error("Choose a model this PDF reader can use.");
  }
  const modelChoice = storyModelChoice(requestedChoice);
  return {
    artifactId,
    start,
    end,
    modelChoice,
    modelEffort: validatedModelEffort(modelChoice, input?.modelEffort),
    mode,
  };
}

/** Queue a bounded range or a checkpointed complete read; never refetches a live URL. */
export const queueArtifactOcr = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(artifactOcrRequest)
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const retained = await sql<{ id: number }>`
      select a.id from artifacts a
      join artifact_blobs b on b.version_id = a.version_id and b.newsroom_id = a.newsroom_id
      where a.id = ${data.artifactId} and a.newsroom_id = ${owned(context)}
        and b.mime ilike '%pdf%' and b.body_b64<>''
      limit 1
    `;
    if (!retained[0]) return { ok: false as const, error: "The original PDF bytes were not retained; this read will not refetch the live URL." };
    const job = await enqueueJob({
      userId: context.userId,
      newsroomId: owned(context),
      kind: "artifact-ocr",
      subjectId: data.artifactId,
      modelChoice: data.modelChoice,
      resultJson: JSON.stringify(data),
    });
    return { ok: true as const, jobId: job.id, status: job.status };
  });

export const getArtifactOcrJob = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((artifactId: unknown) => artifactIdInput.parse(artifactId))
  .handler(async ({ context, data: artifactId }) => {
    const sql = await getSql();
    const rows = await sql<{ id: number; status: string; stage: string; error: string | null; result_json: string }>`
      select j.id, j.status, j.stage, j.error, j.result_json
      from desk_jobs j join artifacts a on a.id = j.subject_id and a.newsroom_id = j.newsroom_id
      where j.kind = ${"artifact-ocr"} and j.subject_id = ${artifactId} and j.newsroom_id = ${owned(context)}
      order by j.id desc limit 1
    `;
    const job = rows[0];
    if (!job) return null;
    let result: ArtifactOcrReceipt = {};
    try { result = JSON.parse(job.result_json || "{}") as ArtifactOcrReceipt; } catch { /* malformed legacy job receipt */ }
    return { ...job, result };
  });

export async function buildDarkSynthesisPack(
  investigationId: number,
  paste: string,
  newsroomId: number,
  packCap: number = DARK_SYNTHESIS_PACK_CAP,
): Promise<string> {
  const sql = await getSql();
  const investigation = await sql<{ title: string; ordinary_explanation: string }>`
    select title, ordinary_explanation from investigations
    where id = ${investigationId} and newsroom_id = ${newsroomId}
    limit 1
  `;
  const sources = await sql<SourceRow>`
    select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
    from sources where newsroom_id = ${newsroomId} order by id asc
  `;
  const frontier = await sql<{ label: string; kind: string; why: string }>`
    select label, kind, why from frontier_items
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} and status in ('open', 'investigating', 'reopened', 'deferred')
    order by priority desc limit 16
  `;
  const rels = await sql<{ from_name: string; to_name: string; kind: string }>`
    select from_name, to_name, kind from relationships
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} limit 20
  `;
  const claims = await sql<{ body: string; kind: string }>`
    select body, kind from claims
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 12
  `;
  const hyps = await sql<{ body: string; status: string }>`
    select body, status from hypotheses
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 12
  `;
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 10
  `;
  const leads = await sql<{
    headline: string;
    why: string;
    topic: string;
    status: string;
    resurfaced_count: number;
  }>`
    select headline, why, topic, status, resurfaced_count from leads
    where newsroom_id = ${newsroomId} order by created_at desc limit 8
  `;
  const articles = await sql<Pick<ArticleRow, "headline" | "topic" | "published_at">>`
    select headline, topic, published_at from articles
    where newsroom_id = ${newsroomId} and status = 'published' order by published_at desc limit 6
  `;
  const memory = await sql<MemoryRow>`
    select entity, last_angle from beat_memory where newsroom_id = ${newsroomId} order by updated_at desc limit 12
  `;
  const searches = await sql<{ query: string }>`
    select query from search_log where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 20
  `;

  const { place } = await readDarkPlace(newsroomId);
  const context = [
    `INVESTIGATION QUESTION:\n${capText(investigation[0]?.title ?? "(unknown)", 600)}${paste ? `\nEDITOR PASTE:\n${capText(paste, 4_000)}` : ""}`,
    ...(investigation[0]?.ordinary_explanation?.trim()
      ? [`ORDINARY EXPLANATION TO RULE OUT FIRST:\n${capText(investigation[0].ordinary_explanation, 1_600)}`]
      : []),
    `CITY: ${place.city}, ${place.state}. Investigation ${investigationId}. Watch list is a start, not a boundary.`,
    `WATCH LIST:\n${sources.slice(0, 30).map((s) => `${s.tier} ${s.status} ${capText(s.title, 180)} ${capText(s.url, 300)}`).join("\n") || "(empty)"}`,
    `SEARCHES RUN:\n${searches.map((s) => capText(s.query, 360)).join("\n") || "(none)"}`,
    `FRONTIER:\n${frontier.map((f) => `${f.kind}: ${capText(f.label, 240)} — ${capText(f.why, 500)}`).join("\n") || "(none)"}`,
    `RELATIONSHIPS:\n${rels.map((r) => `${capText(r.from_name, 180)} -[${capText(r.kind, 80)}]-> ${capText(r.to_name, 180)}`).join("\n") || "(none)"}`,
    `CLAIMS:\n${claims.map((c) => `${capText(c.kind, 80)}: ${capText(c.body, 600)}`).join("\n") || "(none)"}`,
    `HYPOTHESES:\n${hyps.map((h) => `[${capText(h.status, 80)}] ${capText(h.body, 600)}`).join("\n") || "(none)"}`,
    `ANOMALIES:\n${anoms.map((a) => `${capText(a.kind, 80)}: ${capText(a.summary, 600)}`).join("\n") || "(none)"}`,
    `OPEN LEADS:\n${
      leads
        .map((l) => {
          const resurfaced =
            l.status === "killed" && l.resurfaced_count > 0
              ? ` (killed, resurfaced ×${l.resurfaced_count})`
              : "";
          return `${l.status} ${capText(l.topic, 100)}: ${capText(l.headline, 420)}${resurfaced}`;
        })
        .join("\n") || "(none)"
    }`,
    `PUBLISHED:\n${articles.map((a) => `${capText(a.topic, 100)}: ${capText(a.headline, 420)}`).join("\n") || "(none)"}`,
    `BEAT MEMORY:\n${memory.map((m) => `${capText(m.entity, 160)}: ${capText(m.last_angle, 420)}`).join("\n") || "(none)"}`,
  ];
  const contextText = capText(context.join("\n\n"), Math.min(DARK_SYNTHESIS_CONTEXT_CAP, packCap - 2_000));
  const artifactBudget = Math.min(DARK_ARTIFACT_CAP, Math.max(2_000, packCap - contextText.length - 24));
  const artifactEvidence = await relevantDarkArtifactEvidence(
    investigationId,
    newsroomId,
    {
      title: investigation[0]?.title ?? "",
      paste,
      frontier: frontier.flatMap((item) => [item.label, item.why]),
    },
    artifactBudget,
  );

  return `${contextText}\n\nARTIFACTS:\n${artifactEvidence.text}`;
}

/*
  Exported, and given a `chat` seam, for the same reason `queueInvestigationFor`
  is exported and `performScanWork` takes its deps: the Dark Desk's signal write
  is the one place the model's prose becomes a `dark_signals` row, and the guard
  on it has to be provable against a real PostgreSQL rather than argued for.
  The seam defaults to the real `grokChat`; every production caller omits it.
*/
export async function synthesizeSignals(
  userId: string,
  runId: number,
  investigationId: number,
  paste: string,
  dials: DarkDials,
  /**
   * The model this round is pinned to (0.6.2). Before this, the synthesis
   * called `grokChat` with no `choice` at all -- whatever `resolveProvider()`
   * returned -- while the desk told the editor the picker controlled which
   * model wrote. Dark Desk had no picker, so nobody could contradict it.
   */
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  preferences?: ResearchSnapshot,
  runBudget?: DarkRunBudget,
  onUsage?: (usage: DarkRunUsageSnapshot) => Promise<unknown>,
  reasoningEffort?: ModelEffort | null,
  /** Test seam for the single model call this pass makes. Production omits it. */
  deps: { chat?: typeof grokChat } = {},
) {
  const sql = await getSql();
  const researchWindow = preferences ? `${describeResearchWindow(preferences)}\n\n` : "";
  const sourcePack = await buildDarkSynthesisPack(
    investigationId,
    paste,
    newsroomId,
    DARK_SYNTHESIS_PACK_CAP - researchWindow.length,
  );
  const pack = researchWindow + sourcePack;

  /*
    The prompt is built from the dials, not fixed.

    Depth, appetite and map all change what this pass is allowed to do, and the
    model has to be told which run it is on — a desk set to Black Sky that is
    still reading the Careful prompt is just a slower Careful desk.
  */
  /*
    Same missing budget as the planner. This call reads a 28,000-character pack
    against an 11,500-character system prompt and had 45 seconds to do it — the
    default — while `providerBudget()` allows 150 for this provider. Run 1 of
    the dark desk failed with "Claude Code request timed out" for exactly this.
  */
  const { place } = await readDarkPlace(newsroomId);
  const call = runBudget?.startModelCall({
    stage: "synthesis",
    provider: choice ?? "automatic",
    model: choice ?? "provider-default",
  });
  if (runBudget && !call) {
    return { stored: 0, summary: "", error: `Run stopped: ${runBudget.stopReason ?? "budget-limit"}` };
  }
  if (call) await onUsage?.(runBudget!.snapshot());
  const callMs = providerBudget(choice, overrides).callMs;
  const chat = deps.chat ?? grokChat;
  let ai: Awaited<ReturnType<typeof grokChat>>;
  try {
    ai = await chat(darkSystemFor(dials, place), pack, 3200, {
      timeoutMs: Math.max(1, Math.min(callMs, runBudget?.remainingMs() ?? callMs)),
      choice,
      newsroomId,
      localModel: overrides?.["local-model"]?.localModel,
      // Dark Desk F1: synthesis reads the pack already assembled above and
      // returns JSON only — it never fetches or searches itself.
      noTools: true,
      reasoningEffort,
    });
  } catch (err) {
    call?.finish({
      result: "error",
      timedOut: /timed out|timeout/i.test(asDarkError(err)),
    });
    if (call) await onUsage?.(runBudget!.snapshot());
    throw err;
  }
  if (call) {
    const error = ai && !ai.ok ? ai.error : "";
    call.finish({
      result: ai?.ok ? "ok" : (/timed out|timeout/i.test(error) ? "timeout" : "error"),
      durationMs: ai?.meta?.durationMs,
      timedOut: ai?.meta?.timedOut ?? (!ai?.ok && /timed out|timeout/i.test(error)),
      provider: ai?.meta?.provider,
      model: ai?.meta?.model,
      inputTokens: ai?.meta?.inputTokens,
      outputTokens: ai?.meta?.outputTokens,
      totalTokens: ai?.meta?.totalTokens,
    });
    await onUsage?.(runBudget!.snapshot());
  }
  if (!ai?.ok)
    return {
      stored: 0,
      summary: "",
      error: (ai && "error" in ai ? ai.error : "Empty model response") as string | undefined,
    };

  const parsed = parseJsonBlock<DarkJson>(ai.text) ?? {};
  /*
    Unit DD1, item 1: the case file is held to the grounding rule too.

    The pass that files signals is the other door into durable state -- it
    writes `dark_signals` and, through `summary`, `dark_runs.summary` -- and it
    is the door the walkthrough's "The facility at 1749 Main Street
    transitioned from a prior operator" came through. A specific that is
    nowhere in the file wears the marker; nothing is deleted, because the
    editor still needs to see what the model was reaching for. See
    dark-specific-grounding.ts.

    N2 of the batch-7 re-audit: the corpus is the FILE -- the captures and the
    lead it was opened from -- and NOT the pack this model was handed. The pack
    is the model's own earlier notes: `buildDarkSynthesisPack` prints its
    FRONTIER, RELATIONSHIPS, CLAIMS, HYPOTHESES and ANOMALIES sections, every
    one of them written by the model on an earlier pass. Handed the pack, this
    pass could find "1749 Main Street" in a RELATIONSHIPS line and call its own
    invention grounded, one hop after `groundPlan` refused to spend a search on
    it. This is the same narrowing `buildBrief` took for the same reason, and it
    reads the same corpus through the same reader.

    A failed read falls back to the paper's own place and nothing else, and
    never to the pack: a narrower corpus marks more, never less, and
    over-marking is the honest error here.
  */
  const corpus = await groundingCorpus(investigationId, newsroomId, place).catch(() =>
    prepareCorpus("", placeCorpus(place)),
  );
  const summary = markUngroundedSpecifics(
    preserveBoundedAbsenceLanguage(parsed.editor_summary, pack),
    corpus,
  ).slice(0, 2000);
  const gaps = markUngroundedSpecifics((parsed.inventory_gaps ?? []).join("; "), corpus).slice(0, 800);
  const header = [
    summary,
    gaps ? `Gaps: ${gaps}` : "",
    `Window: ${groundedDarkWindow(preferences)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let stored = 0;
  for (const sig of parsed.signals ?? []) {
    /*
      EVERY FIELD OF THIS ROW IS MODEL PROSE, so every one of them is guarded
      here rather than at a caller: `title`, `observation`, `pattern`,
      `linkage_map`, `alternatives`, `counter_narrative`, `what_would_kill`,
      `pathway` and `privacy_review` all come straight out of the model's JSON
      and all land in `text` columns. One U+0000 in one of them fails the whole
      insert, and the insert is inside the pass's transaction, so the whole
      Dark desk round -- every signal already stored in it -- goes with it.

      `normalizePosture` and the `HANDOFFS` set pick from fixed vocabularies
      and `strength`/`confidence` are numbers, so those four cannot carry a
      byte that is not printable. `storableText`, not `postgresText`: this is
      what the model wrote, not what a source said (see storable-text.ts).
    */
    /*
      M1 of the pre-merge audit: `name` was the ONE prose field of this row that
      was not held to the grounding rule -- every other field below goes through
      `markUngroundedSpecifics`. It is also the field the verification lane
      reads back and turns into four adversarial queries
      (`adversarialQueries`), so a signal named "Operator transition at 1749
      Main Street" was searched for verbatim one stage later: the walkthrough's
      invented address, run against a provider, through the door the first fix
      left open. The name is marked like everything else it sits beside, and
      `adversarialSubject` takes the marker back off before it builds a query.
    */
    const name = storableText(markUngroundedSpecifics(String(sig.name ?? ""), corpus)).trim();
    if (!name) continue;
    if (isPoisonedSignal(sig)) continue;
    const strength = Math.min(15, Math.max(3, Number(sig.strength) || 3));
    /*
      Stage 1 is the Black Desk, and the Black Desk is capped.

      "Confidence range for all signals: 0.1-0.5 (Low). By design. This is the
      feature." (the operator's 03-black-desk.md). The prompt says so too, but
      a prompt is a request and this is a rule -- a speculative pass that files
      at 0.85 has quietly become a verification pass that never verified
      anything. Stage 2 (dark-verify.ts) is where a higher number can be
      earned.
    */
    const confidence = capSpeculativeConfidence(sig.confidence);
    let handoff = String(sig.handoff ?? "HOLD FOR PATTERN").toUpperCase();
    // Historical prompts allowed DISCARD. Preserve the signal instead: a thin
    // or incomplete lead belongs in the pattern file where later evidence can
    // reopen it.
    if (handoff === "DISCARD") handoff = "HOLD FOR PATTERN";
    if (!HANDOFFS.has(handoff)) handoff = "HOLD FOR PATTERN";
    await sql`
      insert into dark_signals (
        user_id, newsroom_id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, stage, verification_status, gates_missing
      ) values (
        ${userId}, ${newsroomId}, ${runId}, ${investigationId}, ${name.slice(0, 200)},
        ${normalizePosture(sig.posture)},
        ${storableText(String(sig.type ?? "")).slice(0, 80)},
        ${strength}, ${confidence},
        ${storableText(
          markUngroundedSpecifics(preserveBoundedAbsenceLanguage(sig.observation, pack), corpus),
        ).slice(0, 4000)},
        ${storableText(markUngroundedSpecifics(String(sig.pattern ?? ""), corpus)).slice(0, 4000)},
        ${storableText(markUngroundedSpecifics(String(sig.linkage_map ?? ""), corpus)).slice(0, 4000)},
        ${storableText(markUngroundedSpecifics(String(sig.alternatives ?? ""), corpus)).slice(0, 4000)},
        ${storableText(markUngroundedSpecifics(String(sig.counter_narrative ?? ""), corpus)).slice(0, 4000)},
        ${storableText(markUngroundedSpecifics(String(sig.what_would_kill ?? ""), corpus)).slice(0, 2000)},
        ${storableText(markUngroundedSpecifics(String(sig.pathway ?? ""), corpus)).slice(0, 2000)},
        ${storableText(String(sig.privacy_review ?? "")).slice(0, 500)},
        ${handoff},
        ${"black-desk"},
        ${"unverified"},
        ${GATE_KEYS.map((k) => GATE_WORDS[k]).join("; ")}
      )
    `;
    stored += 1;
  }

  for (const p of parsed.promises ?? []) {
    /*
      The same write door as the signals above, one statement later, and the
      same model: `who`, `what`, `when_due`, `source_cite` and `status` are all
      the model's words about a promise it read. `isGroundedDarkPromise` is a
      check on what was written, not a guard against a byte that cannot be
      stored, so the fields still go through `storableText`.
    */
    const who = storableText(String(p.who ?? "")).trim();
    const what = storableText(String(p.what ?? "")).trim();
    if (!who || !what || !isGroundedDarkPromise(p, pack)) continue;
    await sql`
      insert into dark_promises (user_id, newsroom_id, who_promised, what, when_due, source_cite, status)
      values (
        ${userId}, ${newsroomId}, ${who.slice(0, 200)}, ${what.slice(0, 800)},
        ${storableText(String(p.when_due ?? "")).slice(0, 120) || null},
        ${storableText(String(p.source_cite ?? "")).slice(0, 400) || null},
        ${storableText(String(p.status ?? "open")).slice(0, 40)}
      )
    `;
  }

  return { stored, summary: header, error: undefined as string | undefined };
}

/**
 * The desk's place, straight out of the paper's own configuration.
 *
 * Both fields used to carry a second, built-in answer (`cfg?.city ||
 * "Longmont"`, `cfg?.state || "Colorado"`), so a paper whose configuration
 * named no city was read as the shipped paper's town and every search, prompt
 * and label that follows was scoped to Longmont. `getPaperConfig` already
 * merges the shipped constants column by column, so whatever arrives here IS
 * the configuration; a blank one means the paper has not said, and the honest
 * answer is to leave it blank rather than invent a place.
 *
 * Pure and exported so a test can pin that (see dark-place.test.ts): an
 * unconfigured paper yields no city and no state at all.
 */
export function darkPlaceFromConfig(cfg: { city: string; state: string }): Pick<Place, "city" | "state"> {
  return { city: cfg.city.trim(), state: cfg.state.trim() };
}

/**
 * Where this desk is searching, and whose records count as official.
 *
 * The Dark Signal Desk's searches are location-scoped by default — the
 * operator's civic-scanner passes a `user_location` on every search for
 * exactly this reason, and an unscoped query comes back with a national
 * explainer instead of a clue. The county sits next to the city because
 * that is where half the records actually live (assessor, clerk, court).
 */
export async function readDarkPlace(newsroomId: number): Promise<{
  place: Place;
  official: string[];
  press: string[];
}> {
  const sql = await getSql();
  const cfg = await getPaperConfig(newsroomId);
  const county = await sql<{ county: string | null }>`
    select county from dark_settings where newsroom_id = ${newsroomId} limit 1
  `.catch(() => [] as { county: string | null }[]);
  const srcs = await sql<{ url: string; tier: string | null }>`
    select url, tier from sources where newsroom_id = ${newsroomId} order by id asc limit 60
  `.catch(() => [] as { url: string; tier: string | null }[]);
  const configured = darkPlaceFromConfig(cfg);
  const official = officialDomains(
    configured.city,
    srcs.map((s) => s.url),
    srcs.filter((s) => (s.tier ?? "").toUpperCase() === "A").map((s) => s.url),
  );
  const press = pressDomainsOf(srcs);
  return {
    place: {
      ...configured,
      county: county[0]?.county?.trim() || null,
    },
    official,
    press,
  };
}

/**
 * Stage 2, run for real, from both places a round can start.
 *
 * Swallows its own failure on purpose: a provider that will not answer must
 * leave the round's signals honestly unverified — which is the correct and
 * visible outcome — rather than failing a dig that did find things.
 */
async function runVerificationStage(
  userId: string,
  newsroomId: number,
  runId: number,
  investigationId: number,
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
  preferences?: ResearchSnapshot,
  runBudget?: DarkRunBudget,
  onUsage?: (usage: DarkRunUsageSnapshot) => Promise<unknown>,
  onStage?: (stage: string) => Promise<unknown>,
  reasoningEffort?: ModelEffort | null,
  job?: DeskJob,
): Promise<string> {
  const { place, official, press } = await readDarkPlace(newsroomId);
  let active = {
    modelChoice: choice ?? "codex-balanced" as EffectiveProviderChoice,
    modelEffort: effortForChoice(choice ?? "codex-balanced", reasoningEffort ?? null),
  };
  const verifyModel = async (system: string, pack: string) => {
    const attempted = await runPinnedCallWithFailover({
      snapshot: active,
      source: job?.model_choice_source ?? "editor",
      ladder: DARK_AUTOMATIC_LADDER,
      run: (snapshot) => grokChat(system, pack, 1400, {
        choice: snapshot.modelChoice,
        newsroomId,
        localModel: overrides?.["local-model"]?.localModel,
        noTools: true,
        reasoningEffort: snapshot.modelEffort,
      }),
      probe: (candidate) => probeProvider(candidate, newsroomId, undefined, "dark"),
      resolve: async (candidate) => ({
        modelChoice: candidate,
        modelEffort: effortForChoice(candidate, active.modelEffort),
      }),
      onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
        if (job) {
          const resolvedChoice = effectiveStoryModelChoice(nextChoice);
          const nextEffort = effortForChoice(resolvedChoice, active.modelEffort);
          await setJobModelRuntime(job.id, resolvedChoice, nextEffort);
          await setJobStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
          await setJobFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
        }
      },
    });
    active = attempted.snapshot;
    if (!attempted.result.ok) throw new Error(attempted.result.error);
    return attempted.result.text;
  };
    const out = await verifyRunSignals({
      userId,
      newsroomId,
      runId,
      investigationId,
      place,
      officialDomains: official,
      pressDomains: press,
      choice: active.modelChoice,
      overrides,
      preferences,
      runBudget,
      onUsage,
      onStage,
      reasoningEffort: active.modelEffort,
      deps: { model: verifyModel },
    });
    return out.summary;
}

export async function performChallengeWork(
  job: DeskJob,
  deps: { verify?: typeof verifyRunSignals; readPlace?: typeof readDarkPlace } = {},
) {
  await ensureDarkSchema();
  await throwIfJobCancelled(job.id);
  const sql = await getSql();
  const investigationId = job.subject_id;
  const runs = await sql<{
    id: number;
    model_choice: string | null;
    research_preferences_json: string | null;
  }>`
    select id, model_choice, research_preferences_json from dark_runs
    where newsroom_id = ${job.newsroom_id} and investigation_id = ${investigationId}
    order by started_at desc, id desc limit 1
  `;
  const run = runs[0] ?? null;
  const choice = effectiveStoryModelChoice(run?.model_choice ?? job.model_choice);
  const overrides = applyJobLocalModelSnapshot(
    job,
    await readProviderOverrides(job.newsroom_id, "dark").catch(() => ({})),
  );
  let preferences: ResearchSnapshot | undefined;
  try {
    const snapshot = JSON.parse(run?.research_preferences_json ?? "{}") as {
      preferences?: ResearchSnapshot;
    };
    preferences = snapshot.preferences;
  } catch {
    preferences = undefined;
  }
  const report = progressReporterFor(job);
  await report("Challenging the case", pctFor(0, 1));
  let result: Awaited<ReturnType<typeof verifyRunSignals>> = {
    checked: 0,
    eligible: 0,
    deferred: 0,
    failed: 0,
    verified: 0,
    unverified: 0,
    searches: [],
    summary: "No prior research round to challenge.",
  };
  if (run) {
    const place = await (deps.readPlace ?? readDarkPlace)(job.newsroom_id);
    const verify = deps.verify ?? verifyRunSignals;
    result = await waitForModel({
      jobId: job.id,
      label: () => modelChoiceLabel(choice),
      run: () => verify({
        userId: job.user_id,
        newsroomId: job.newsroom_id,
        runId: run.id,
        investigationId,
        place: place.place,
        officialDomains: place.official,
        pressDomains: place.press,
        choice,
        overrides,
        preferences,
        reasoningEffort: savedJobEffort(job),
      }),
    });
  }
  await throwIfJobCancelled(job.id);
  await sql`
    insert into investigation_challenges (
      newsroom_id, investigation_id, job_id, run_id, summary, result_json
    ) values (
      ${job.newsroom_id}, ${investigationId}, ${job.id}, ${run?.id ?? null},
      ${result.summary.slice(0, 4000)}, ${JSON.stringify(result)}
    )
    on conflict (newsroom_id, job_id) do update set
      run_id = excluded.run_id, summary = excluded.summary,
      result_json = excluded.result_json
  `;
}

function asDarkError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err)
    return String((err as { error: unknown }).error);
  return err instanceof Error ? err.message : "Dark desk failed";
}

function savedJobEffort(job: Pick<DeskJob, "model_choice" | "result_json">): ModelEffort | null {
  try {
    const parsed = JSON.parse(job.result_json || "{}") as { modelEffort?: unknown };
    if (!("modelEffort" in parsed)) return null;
    return validatedModelEffort(job.model_choice, parsed.modelEffort);
  } catch {
    return null;
  }
}

function effortForChoice(choice: EffectiveProviderChoice, saved: ModelEffort | null): ModelEffort | null {
  return saved == null ? null : validatedModelEffort(choice, saved);
}

async function markInvestigationPaused(userId: string, investigationId: number, error: string) {
  const sql = await getSql();
  await sql`
    update investigations
    set status = ${"paused"}, pause_reason = ${error.slice(0, 800)}, updated_at = now()
    where id = ${investigationId}
  `;
}

/**
 * Remember which model dug this file, so "Keep digging" defaults to it.
 *
 * An investigation is a continuing piece of work, and switching author
 * halfway is a decision, not a default. `null` (a round that ran before the
 * picker existed, or one whose choice could not be resolved) leaves the
 * column alone rather than blanking a good answer.
 */
async function rememberLastModelChoice(investigationId: number, choice?: string | null) {
  if (!choice) return;
  const sql = await getSql();
  await sql`
    update investigations set last_model_choice = ${choice}, updated_at = now()
    where id = ${investigationId}
  `.catch(() => undefined);
}

async function executeDarkRun(
  userId: string,
  opts: {
    paste: string;
    investigationId?: number;
    title?: string;
    choice?: EffectiveProviderChoice;
    automatic?: boolean;
    modelEffort?: ModelEffort | null;
  },
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const sql = await getSql();
  const choice = opts.choice;
  const overrides = await readProviderOverrides(newsroomId, "dark").catch(() => ({}));
  const runRows = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id, model_choice, model_effort)
    values (${userId}, ${newsroomId}, ${choice ?? null}, ${opts.modelEffort ?? null}) returning id
  `;
  const runId = runRows[0]!.id;
  const paste = opts.paste.trim().slice(0, 14000);

  let investigationId = opts.investigationId ?? 0;
  if (!investigationId) {
    const opened = await openInvestigationForEditor(
      userId,
      { paste, title: opts.title },
      newsroomId,
    );
    investigationId = opened.investigationId;
  }
  await sql`update dark_runs set investigation_id = ${investigationId} where id = ${runId}`;

  try {
    const snapshot = await snapshotDarkSettingsFor(newsroomId, runId);
    await checkBaselines(userId, investigationId, new Date(), newsroomId);
    await runDueMonitors({ userId, newsroomId });

    // Same setting as a continued round: an editor who turned the desk up
    // expects the file they open next to dig that hard too.
    const fileLimits = await darkFileRunLimits(investigationId, newsroomId);
    const dials = { ...snapshot.dials, scope: fileLimits.scope };
    const budget = { ...budgetFor(dials), hops: hopsForLimit(fileLimits.key) };
    const runBudget = darkRunBudget(dials, choice!, overrides, snapshot.preferences.verificationLimit ?? 6, fileLimits);
    /*
      Synthesis, the four-question review and the editor brief all draw on the
      same meter as research, so the hop loop stops while the provider's own
      reserve is still on it. Without this the run ends elapsed-time-limit
      with zero eligible signals, which is honest but useless to an editor.
    */
    const researchReserveMs = providerBudget(choice ?? undefined, overrides).reserveMs;
    const saveUsage = (usage: DarkRunUsageSnapshot) =>
      persistDarkRunUsage(runId, newsroomId, usage, runBudget.stopReason);
    await saveUsage(runBudget.snapshot());
    // Location scoping and domain tiers come from the paper's own settings,
    // so the loop's searches name this town and the run record can say which
    // tier answered.
    const where = await readDarkPlace(newsroomId).catch(() => null);
    let activeChoice = choice!;
    const research = (on: EffectiveProviderChoice) => {
      activeChoice = on;
      return runDarkResearchWithRememberedChoice(investigationId, on, {
        remember: rememberLastModelChoice,
        run: (remembered) => researchLoop({
          userId,
          investigationId,
          hops: budget.hops,
          choice: remembered,
          providerOverrides: overrides,
          newsroomId,
          place: where?.place,
          officialDomains: where?.official,
          pressDomains: where?.press,
          preferences: snapshot.preferences,
          executionMode: snapshot.preferences.executionMode ?? "batch",
          actionLimit: snapshot.preferences.actionLimit ?? 6,
          runBudget,
          researchReserveMs,
          onUsage: saveUsage,
          reasoningEffort: effortForChoice(remembered, opts.modelEffort ?? null),
        }),
      });
    };
    const synthesize = (on: EffectiveProviderChoice) => {
      activeChoice = on;
      return synthesizeSignals(
        userId,
        runId,
        investigationId,
        paste,
        dials,
        on,
        overrides,
        newsroomId,
        snapshot.preferences,
        runBudget,
        saveUsage,
        effortForChoice(on, opts.modelEffort ?? null),
      );
    };
    const checkpointed = await runCheckpointedDarkStages({
      initialChoice: activeChoice,
      research,
      synthesize,
      failOver: async (error) => {
        const plan = await planAutomaticFailover({
          source: opts.automatic ? "auto" : "editor",
          current: activeChoice,
          error,
          probe: (next) => probeProvider(next, newsroomId, undefined, "dark"),
          ladder: DARK_AUTOMATIC_LADDER,
        });
        if (!plan) return null;
        const switchedBecause = failoverReasonPhrase(modelChoiceLabel(activeChoice), plan.reason);
        return { next: plan.next, label: plan.label, switchedBecause };
      },
    });
    activeChoice = checkpointed.choice;
    const { loop, synth } = checkpointed;
    /*
      Stage 2. Nothing this round filed may be shown as finalized until the
      Dark Signal Desk has run the adversarial searches and the model has
      answered all four gates.
    */
    const verifySummary = await runVerificationStage(
      userId,
      newsroomId,
      runId,
      investigationId,
      activeChoice,
      overrides,
      snapshot.preferences,
      runBudget,
      saveUsage,
      undefined,
      effortForChoice(activeChoice, opts.modelEffort ?? null),
    );
    const stopReason: DarkRunStopReason = runBudget.stopReason ?? loop.stopReason ?? (synth.error ? "synthesis-failed" : loop.paused ? "hop-limit" : "completed");
    await persistDarkRunUsage(runId, newsroomId, runBudget.snapshot(), stopReason);
    await rememberLastModelChoice(investigationId, activeChoice);
    const names = (
      await sql<{ name: string }>`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${investigationId}
        order by ie.id desc limit 40
      `
    ).map((n) => n.name);
    await resurfaceDeadEnds(userId, investigationId, names, { foreignOnly: true });
    const revived = await matchDeadEnds(userId, names, newsroomId);

    const header = [
      loop.summary,
      synth.summary,
      verifySummary,
      describeResearchWindow(snapshot.preferences),
      `Hops ${loop.hops} of ${budget.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
      `Setting: dig ${dials.dig}/10, nerve ${dials.nerve}/10 (${stanceFor(dials).label}), scope ${dials.scope}.`,
      revived.length
        ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}`
        : "",
      synth.error ? `Synthesis: ${synth.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sql`
      update dark_runs
      set finished_at = now(), summary = ${tailSafeDarkSummary(header)}, error = ${synth.error ?? null},
          stop_reason = ${stopReason}
      where id = ${runId}
    `;
    await audit(
      userId,
      "dark",
      `run ${runId} inv ${investigationId} hops ${loop.hops} signals ${synth.stored}`,
      newsroomId,
    );
    if (synth.error && !loop.paused) {
      await markInvestigationPaused(userId, investigationId, synth.error);
    }
    return {
      ok: true as const,
      runId,
      investigationId,
      stored: synth.stored,
      hops: loop.hops,
      artifacts: loop.artifacts,
      frontier: loop.frontier,
      paused: loop.paused || Boolean(synth.error),
      summary: header,
      error: synth.error,
    };
  } catch (err) {
    const error = asDarkError(err);
    await sql`
      update dark_runs
      set finished_at = now(), error = ${error.slice(0, 800)}
      where id = ${runId}
    `;
    await markInvestigationPaused(userId, investigationId, error);
    return {
      ok: false as const,
      runId,
      investigationId,
      error,
    };
  }
}

export const runDarkDesk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkRunInput.parse(input))
  .handler(async ({ context, data }) => {
    /*
      SG1 / Option A: a Dark Desk run searches the web and spends a model on
      this paper's behalf. An install nobody has set up has no town and no
      county to look in, so the run is refused in one plain sentence first.
    */
    await requirePaperSetUp(owned(context), "start a Dark Desk run");
    /*
      The editor's pick decides which provider is probed, and an unresolvable
      one refuses BEFORE any spend -- the same commit boundary Story and Scan
      have. `storyModelChoice` narrows anything else to Automatic rather than
      trusting a string off the wire.
    */
    const asked = storyModelChoice(data.modelChoice);
    const probe = await probeDarkProvider(asked, owned(context));
    const refusal = await darkPreflightRefusal(asked, owned(context), probe);
    if (refusal) return refusal;
    await ensureDarkSchema();
    await assertRate(context.userId, "dark", owned(context));
    return executeDarkRun(
      context.userId,
      {
        paste: data.paste,
        investigationId: data.investigationId,
        choice: probe.ok ? probe.choice : asked,
        automatic: asked === "auto",
        /*
          Unit CY item 9: the effort the Start-a-file dialog's select showed.
          It travels beside the model for the same reason the model does --
          a row the editor turned that the run never sees is a control that
          does nothing. `executeDarkRun` revalidates it against the resolved
          choice (`effortForChoice`), so a level this provider does not offer
          is dropped, not sent.
        */
        modelEffort: data.modelEffort ?? null,
      },
      owned(context),
    );
  });

export const openDarkInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkOpenInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      // SG1 / Option A: opening a file is step one of a Dark Desk run.
      const notSetUp = await paperSetUpRefusal(owned(context), "open an investigation");
      if (notSetUp) return { ok: false as const, error: notSetUp };
      await ensureDarkSchema();
      const opened = await openInvestigationForEditor(context.userId, data, owned(context));
      await audit(context.userId, "dark", `open inv ${opened.investigationId}`, owned(context));
      return opened;
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Could not open an investigation";
      return { ok: false as const, error: raw };
    }
  });

export const findSomethingToDigInto = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    // SG1 / Option A: "Find something to dig into" opens an investigation,
    // which is the start of a Dark Desk run.
    const notSetUp = await paperSetUpRefusal(owned(context), "start a Dark Desk run");
    if (notSetUp) return { ok: false as const, error: notSetUp };
    await ensureDarkSchema();
    const items = await gatherWorthALook(owned(context));
    const sql = await getSql();
    const active = await sql<{ title: string }>`
      select title from investigations
      where newsroom_id = ${owned(context)}
        and status in ('open', 'investigating', 'paused')
    `;
    const top = items.find((item) => !active.some((row) => titlesOverlap(item.title, row.title)));
    if (!top?.seed?.trim() && !top?.title?.trim()) {
      return { ok: false as const, error: "nothing-new" };
    }
    const opened = await openInvestigationForEditor(
      context.userId,
      {
        paste: top.seed,
        title: top.title,
      },
      owned(context),
    );
    await audit(
      context.userId,
      "dark",
      `open inv ${opened.investigationId} from worth-a-look`,
      owned(context),
    );
    return opened;
  });

/**
 * The actual work of "keep digging" — pulled out of the server function so
 * it can be called (and tested) with a plain `{ userId, newsroomId }`
 * context instead of a live authenticated request.
 *
 * This is the one place a "dark" job gets enqueued for an existing
 * investigation, which makes it the right and only place to ask
 * `darkPreflightRefusal()`: refusing here means no job row is ever written,
 * so there is nothing for the queue to mark `completed` while lying about
 * what happened.
 */
export async function startDarkRound(
  context: { userId: string; newsroomId?: number },
  id: number,
  modelChoice: string = "auto",
  effortValue?: unknown,
) {
  const asked = storyModelChoice(modelChoice);
  /*
    Probe the model the editor picked BEFORE anything is written or spent,
    exactly as `commitStoryDraftForAuthenticatedEditor` does. Automatic
    resolves to a concrete provider here, and that concrete provider is what
    gets pinned on the job -- so a round does not silently change author
    between the press and the queue picking it up.
  */
  const probe = await probeDarkProvider(asked, owned(context));
  const refusal = await darkPreflightRefusal(asked, owned(context), probe);
  if (refusal) return refusal;
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<{ id: number }>`
    select id from investigations where id = ${id} and newsroom_id = ${owned(context)} limit 1
  `;
  if (!inv[0]) return { ok: false as const, error: "Investigation not found" };

  const effectiveChoice = probe.ok ? probe.choice : asked;
  const modelEffort = validatedModelEffort(effectiveChoice, effortValue);

  /*
    A round already digging this file on a different model is the same
    situation Story reports for a lead already drafting: the run is pinned,
    switching mid-flight is not a thing this desk does, and the honest answer
    is to say which model is running rather than quietly queueing a second
    one. Checked BEFORE the rate spend, like Story's.
  */
  const open = await findOpenJob({ newsroomId: owned(context), kind: "dark", subjectId: id });
  if (open) {
    const persisted = effectiveStoryModelChoice(open.model_choice);
    const persistedEffort = savedJobEffort(open);
    if (persisted !== effectiveChoice || persistedEffort !== modelEffort) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `This file is already digging with ${modelChoiceLabel(persisted)}${persistedEffort ? ` at ${persistedEffort} effort` : ""}. Watch that round finish before choosing another model or effort.`,
        modelChoice: persisted,
        jobId: open.id,
      };
    }
    return {
      ok: true as const,
      pending: true as const,
      jobId: open.id,
      investigationId: id,
      modelChoice: persisted,
    };
  }

  await assertRate(context.userId, "dark", owned(context));
  await sql`
    update investigations set status = ${"investigating"}, updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
  const job = await enqueueJob({
    userId: context.userId,
    newsroomId: owned(context),
    kind: "dark",
    subjectId: id,
    modelChoice: effectiveChoice,
    // "auto" means Automatic picked it, which is the ONLY case allowed to
    // fail over mid-round. See automatic-failover.ts.
    modelChoiceSource: asked === "auto" ? "auto" : "editor",
    resultJson: JSON.stringify(initialModelRuntimeReceipt({
      requestedRuntime: asked,
      requestedEffort: validatedModelEffort(asked, effortValue),
      actualRuntime: effectiveChoice,
      actualEffort: modelEffort,
      localModel: probe.ok ? probe.localModel : undefined,
      preflightFailover: "switchReceipt" in probe ? probe.switchReceipt : null,
      /*
        A rung the desk passed over on the way to the one that answered
        (0.6.63, Unit Y item 2). Omitted when empty -- see
        `initialModelRuntimeReceipt` -- so every receipt that has nothing to
        report reads exactly as it did before.
      */
      skippedRungs: probe.skippedRungs,
    })),
  });
  if ("switchReceipt" in probe) {
    await setJobStage(job.id, probe.switchReceipt.stage);
    await setJobFailoverNote(job.id, probe.switchReceipt.note);
  }
  return {
    ok: true as const,
    pending: true as const,
    jobId: job.id,
    investigationId: id,
    modelChoice: effectiveStoryModelChoice(job.model_choice),
  };
}

export const continueInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkStepInput.parse(input))
  .handler(async ({ context, data }) => {
    // SG1 / Option A: "Keep digging" starts a Dark Desk round, which searches
    // and spends. Refused in one sentence until the paper is set up.
    const notSetUp = await paperSetUpRefusal(owned(context), "keep digging");
    if (notSetUp) return { ok: false as const, error: notSetUp };
    return typeof data === "number"
      ? startDarkRound(context, data)
      : startDarkRound(context, data.id, data.modelChoice, data.modelEffort);
  });

/** Injectable seam for `planDarkRoundFailover`, the same pattern
 * `PerformDraftWorkDeps` uses in desk-model-run.ts. */
export type DarkRoundFailoverDeps = {
  probe?: typeof probeProvider;
  setModelChoice?: typeof setJobModelChoice;
  setStage?: typeof setJobStage;
};

/**
 * The Dark Desk half of the one-shot Automatic failover round-level check
 * (see `automatic-failover.ts` and `failOverAndRetry` in desk-model-run.ts,
 * the same mechanism for Story). Pulled out of `performDarkRound`'s body so
 * the decide-and-write step can be driven directly in a test with injected
 * fakes (audit-lite 0.6.7 FINDING-001): `performDarkRound` itself needs a
 * live investigation row, dials, and a real research loop to reach this
 * point, which makes it unsuitable as the seam a unit test drives through.
 *
 * Returns null when Automatic did not move on (not on Automatic, not a
 * recognized failure, or no ready later rung) -- the caller keeps `loop`/
 * `synth` from the attempt that just ran. Otherwise the model_choice and
 * stage writes have already happened, same as before this was extracted,
 * and the caller re-runs on the returned rung.
 */
export async function planDarkRoundFailover(
  job: DeskJob,
  failure: string,
  deps: DarkRoundFailoverDeps = {},
): Promise<{ next: EffectiveProviderChoice; label: string; switchedBecause: string } | null> {
  const probe = deps.probe ?? probeProvider;
  const setModelChoice = deps.setModelChoice ?? setJobModelChoice;
  const setStage = deps.setStage ?? setJobStage;
  const plan = await planAutomaticFailover({
    source: job.model_choice_source ?? "editor",
    current: job.model_choice,
    error: failure,
    probe,
    ladder: DARK_AUTOMATIC_LADDER,
  });
  if (!plan) return null;

  const previous = modelChoiceLabel(job.model_choice);
  await setModelChoice(job.id, plan.next);
  const switchedBecause = failoverReasonPhrase(previous, plan.reason);
  await setStage(job.id, `Switched to ${plan.label}: ${switchedBecause}`);
  return { next: plan.next, label: plan.label, switchedBecause };
}

export async function runDarkResearchWithRememberedChoice<T>(
  investigationId: number,
  choice: EffectiveProviderChoice,
  deps: {
    remember: (investigationId: number, choice: EffectiveProviderChoice) => Promise<unknown>;
    run: (choice: EffectiveProviderChoice) => Promise<T>;
  },
): Promise<T> {
  await deps.remember(investigationId, choice).catch(() => undefined);
  return deps.run(choice);
}

export async function runCheckpointedDarkStages<
  TLoop extends { hops: number; plannerStartupFailures: number; summary: string },
  TSynthesis extends { error?: string },
>(opts: {
  initialChoice: EffectiveProviderChoice;
  research: (choice: EffectiveProviderChoice) => Promise<TLoop>;
  synthesize: (choice: EffectiveProviderChoice) => Promise<TSynthesis>;
  failOver: (
    error: string,
    stage: "research" | "synthesis",
  ) => Promise<{ next: EffectiveProviderChoice; label: string; switchedBecause: string } | null>;
  /**
   * FB1: carries the round's percentage alongside the stage sentence, so the
   * research hop loop's "Researching hop 2/5" reaches the card as a real
   * fraction rather than only as text. Optional, like `onStage` everywhere else.
   */
  setStage?: (stage: string, pct?: number | null) => Promise<unknown>;
}) {
  let choice = opts.initialChoice;
  let switched = false;
  let loop = await opts.research(choice);
  if (loop.hops === 0 && loop.plannerStartupFailures > 0) {
    const next = await opts.failOver(loop.summary, "research");
    if (next) {
      switched = true;
      choice = next.next;
      await opts.setStage?.(`${next.switchedBecause} → ${next.label} retrying research`);
      loop = await opts.research(choice);
    }
  }

  let synth = await opts.synthesize(choice);
  if (synth.error && !switched) {
    const next = await opts.failOver(synth.error, "synthesis");
    if (next) {
      choice = next.next;
      await opts.setStage?.(`${next.switchedBecause} → ${next.label} retrying synthesis`);
      synth = await opts.synthesize(choice);
    }
  }
  return { choice, loop, synth };
}

export function terminalPlannerStartupFailure(
  loop: { hops: number; plannerStartupFailures: number },
  synthesisError: string | null | undefined,
): string | null {
  return loop.hops === 0 && loop.plannerStartupFailures > 0 && synthesisError
    ? synthesisError
    : null;
}

/**
 * Worker for editor-requested OCR from the exact retained PDF.
 *
 * Complete reads keep each model call bounded, then commit the extracted page
 * chunks and the job receipt before starting the next batch. A reclaimed or
 * newly retried job plans only pages that do not already have retained chunks.
 */
export async function performArtifactOcrWork(
  job: DeskJob,
  deps: {
    ocr?: typeof productionOcr;
    pageCount?: typeof pdfPageCount;
    resolveLocalModel?: (newsroomId: number, scope: "ocr") => Promise<{ baseUrl: string; id: string } | null>;
    /** Test seam for replacing a claim immediately before the checkpoint transaction. */
    beforeCheckpoint?: () => Promise<void>;
  } = {},
) {
  await ensureDarkSchema();
  const sql = await getSql();
  const stored = await sql<{ result_json: string }>`
    select result_json from desk_jobs
    where id = ${job.id} and newsroom_id = ${job.newsroom_id} and kind = ${"artifact-ocr"}
    limit 1
  `;
  let request: ArtifactOcrRequest;
  try {
    request = artifactOcrRequest(JSON.parse(stored[0]?.result_json || "{}") as ArtifactOcrRequest);
  } catch {
    throw new Error("This PDF page-read request is invalid.");
  }
  if (request.artifactId !== job.subject_id) throw new Error("This PDF page-read request does not match its captured file.");
  const source = await sql<{ version_id: number | null; body_b64: string; mime: string }>`
    select a.version_id, b.body_b64, b.mime
    from artifacts a join artifact_blobs b on b.version_id = a.version_id and b.newsroom_id = a.newsroom_id
    where a.id = ${request.artifactId} and a.newsroom_id = ${job.newsroom_id}
    order by b.captured_at desc limit 1
  `;
  const retained = source[0];
  if (!retained?.version_id || !retained.body_b64 || !/pdf/i.test(retained.mime)) {
    throw new Error("The original retained PDF is unavailable; this read will not refetch the live URL.");
  }
  const assertClaim = async () => {
    const owns = await sql<{ id: number }>`
      select id from desk_jobs
      where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = ${"running"} and claim_token = ${job.claim_token}
      limit 1
    `;
    if (!owns[0]) throw new Error("This PDF read was replaced by a newer worker; stopping without changing retained evidence.");
  };
  /*
    FB1: this helper used to write `stage` and `updated_at` and nothing else, so
    a PDF read that took ten minutes reported a sentence, never a step, never a
    percentage and -- because `beat_at` was left alone -- never a heartbeat
    either. Its card would have read "no activity for 1:14" through a batch that
    was being read perfectly.

    It now goes through the same `reportProgress` every other kind uses. The
    ownership guard stays: the write still only lands while THIS execution holds
    the claim, so a replaced worker cannot report progress onto its
    replacement's row.
  */
  const ocrReport = progressReporterFor(job);
  const setOwnedStage = async (stage: string, pct?: number | null) => {
    await assertClaim();
    await ocrReport(stage, pct);
  };
  await assertClaim();
  const bytes = new Uint8Array(Buffer.from(retained.body_b64, "base64"));
  const existingRows = await sql<{ page_number: number }>`
    select distinct page_number from artifact_chunks
    where version_id = ${retained.version_id} and newsroom_id = ${job.newsroom_id}
      and page_number is not null
    order by page_number
  `;
  const retainedPages = new Set(existingRows.map((row) => Number(row.page_number)));
  const jobStarted = Date.now();
  let ocrChoice = effectiveStoryModelChoice(request.modelChoice);
  let ocrEffort = request.modelEffort ?? savedJobEffort(job);
  const exactLocalModel = ocrChoice === "local-model"
    ? await (deps.resolveLocalModel ?? (async (newsroomId: number, scope: "ocr") =>
        (await resolveLocalModelChoice(newsroomId, scope)).override))(job.newsroom_id, "ocr")
    : undefined;
  let modelCalls = 0;
  let budgetPaused = false;
  let totalPages = 0;
  let batches: OcrPageBatch[];
  if (request.mode === "complete") {
    await setOwnedStage("Opening the retained PDF");
    totalPages = await (deps.pageCount ?? pdfPageCount)(bytes);
    if (totalPages < 1) throw new Error("The retained PDF could not be opened to count its pages.");
    for (const page of retainedPages) {
      if (page < 1 || page > totalPages) retainedPages.delete(page);
    }
    batches = planMissingOcrBatches(totalPages, retainedPages);
  } else {
    batches = [{ start: request.start, end: request.end }];
  }

  const saveBatch = async (
    batch: OcrPageBatch,
    pages: { page: number | null; text: string }[],
    provider: string,
    reason: string | null,
    batchIndex: number,
  ) => {
    for (const page of pages) if (page.page != null && page.text.trim()) retainedPages.add(page.page);
    const unread = totalPages > 0 ? unreadOcrPages(totalPages, retainedPages) : [];
    const safeProvider = provider.replace(/:/g, "-");
    const method = totalPages > 0
      ? `ocr-pages${unread.length ? "-partial" : ""}:${safeProvider}:${retainedPages.size}/${totalPages}`
      : null;
    const result: ArtifactOcrReceipt = {
      request,
      artifactId: request.artifactId,
      mode: request.mode,
      start: batch.start,
      end: batch.end,
      pages,
      pagesRead: request.mode === "complete" ? retainedPages.size : pages.length,
      pagesTotal: totalPages,
      batchesCompleted: batchIndex,
      batchesTotal: batches.length,
      unreadPages: unread,
      modelCalls,
      budgetPaused,
      provider,
      reason,
    };
    await withTransaction(async (tx) => {
      const owns = await tx<{ id: number }>`
        select id from desk_jobs
        where id = ${job.id} and newsroom_id = ${job.newsroom_id}
          and status = ${"running"} and claim_token = ${job.claim_token}
        for update
      `;
      if (!owns[0])
        throw new Error("This PDF read was replaced by a newer worker; stopping without changing retained evidence.");
      /*
        Unit U11b2: never write an OCR passage back onto a capture the owner has
        taken down.

        The purge (`evidence-takedown.ts`) empties every `artifact_chunks`
        excerpt of the version. A PDF read that was already queued when the
        takedown happened would otherwise land afterwards and put model-read
        text from the publisher's page straight back into the table the purge
        just cleared -- the takedown would look done on the evidence page and
        not be done in the database. Skipped rather than refused: the job's own
        bookkeeping (pages read, the extraction method) still finishes, so the
        desk sees a completed read with no passages added, and the takedown
        stays the last word on what this capture holds.
      */
      /*
        `for share`, so this read cannot race a takedown that is committing.

        A plain select would read `taken_down_at` as null, let a takedown purge
        every passage of the version, and then insert this read's pages back
        into the table the purge had just cleared -- the evidence page saying
        the excerpt was removed while the database held it again. The takedown
        takes its row `for update` (`evidence-takedown.ts`) and this takes it
        `for share`, so the two serialise: whichever arrives first finishes
        first, and a read that arrives second sees the marker and adds nothing.
      */
      const [takenDown] = await tx<{ taken_down_at: string | null }>`
        select taken_down_at::text as taken_down_at from artifact_versions
        where id = ${retained.version_id} and newsroom_id = ${job.newsroom_id}
        for share
      `;
      if (pages.length && !takenDown?.taken_down_at) {
        const chunks = chunksFromEvidence(pages.map((page) => page.text).join("\n\n"), pages);
        const next = await tx<{ next: number }>`
          select coalesce(max(chunk_index), -1) + 1 as next from artifact_chunks
          where version_id = ${retained.version_id} and newsroom_id = ${job.newsroom_id}
        `;
        let offset = next[0]?.next ?? 0;
        for (const chunk of chunks) {
          const duplicate = await tx<{ id: number }>`
            select id from artifact_chunks
            where version_id = ${retained.version_id} and newsroom_id = ${job.newsroom_id}
              and page_number is not distinct from ${chunk.page_number} and excerpt = ${chunk.excerpt}
            limit 1
          `;
          if (duplicate[0]) continue;
          await tx`
            insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, page_number, section, excerpt, locator)
            values (
              ${retained.version_id}, ${job.user_id}, ${job.newsroom_id}, ${offset++},
              ${chunk.page_number}, ${"editor-requested OCR"}, ${chunk.excerpt},
              ${`editor-ocr:${job.id}:${chunk.locator}`}
            )
          `;
        }
      }
      if (method) {
        await tx`
          update artifact_versions set extraction_method = ${method}, page_count = ${totalPages}
          where id = ${retained.version_id} and newsroom_id = ${job.newsroom_id}
        `;
        await tx`
          update artifacts set extraction_method = ${method}
          where id = ${request.artifactId} and newsroom_id = ${job.newsroom_id}
        `;
      }
      await tx`
        update desk_jobs set result_json = ${JSON.stringify(result)}, updated_at = now()
        where id = ${job.id} and newsroom_id = ${job.newsroom_id} and claim_token = ${job.claim_token}
      `;
    });
  };

  if (!batches.length) {
    totalPages ||= retainedPages.size;
    await saveBatch({ start: 1, end: totalPages }, [], modelChoiceLabel(job.model_choice), null, 0);
    await setOwnedStage(`All ${totalPages} PDF pages were already retained.`);
    return;
  }

  /*
    FB1: the percentage, in the one denominator that does not dip.

    A whole-PDF read knows two counts -- the batch it is on and the pages it has
    retained -- and they move at different rates, so a bar that switched between
    them would jump backwards every time a batch finished. Pages is the honest
    one (it is the thing the editor asked for: "how much of this PDF is read")
    and batches is the fallback for a single-batch read, where `totalPages` is
    not known because the job was asked for one page range rather than the file.
  */
  const ocrPct = (batchIndex: number) =>
    totalPages > 0 ? pctFor(retainedPages.size, totalPages) : pctFor(batchIndex, batches.length);
  await setOwnedStage("Reading the pages with a model", ocrPct(0));
  let accumulatedReason: string | null = null;
  let lastProvider = modelChoiceLabel(job.model_choice);
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]!;
    await assertClaim();
    // Batch boundaries are where a read of a long PDF can be stopped: every
    // batch already read is committed through `saveBatch`, so the pages stay
    // and the job's reason is the editor's, not a truncation's.
    await throwIfJobCancelled(job.id);
    const elapsed = Date.now() - jobStarted;
    if (elapsed >= OCR_TOTAL_BUDGET_MS || modelCalls >= ARTIFACT_OCR_MAX_MODEL_CALLS) {
      budgetPaused = true;
      const limit = elapsed >= OCR_TOTAL_BUDGET_MS
        ? "the 10-minute whole-run time budget"
        : `the ${ARTIFACT_OCR_MAX_MODEL_CALLS}-call whole-run model budget`;
      accumulatedReason = [
        accumulatedReason,
        `OCR paused at ${limit}. Saved pages are retained; run Read entire PDF again to continue only the unread pages.`,
      ].filter(Boolean).join(" ");
      await saveBatch(batch, [], lastProvider, accumulatedReason, index);
      break;
    }
    await setOwnedStage(
      `Reading batch ${index + 1} of ${batches.length} · PDF pages ${batch.start}-${batch.end} · ${retainedPages.size}${totalPages ? ` of ${totalPages}` : ""} already saved…`,
      ocrPct(index),
    );
    const read = await waitForModel({
      jobId: job.id,
      // `ocrChoice` is reassigned by the switch handler below, so the ticker
      // names the transport this batch is actually reading on after a hop.
      label: () => modelChoiceLabel(ocrChoice),
      run: () =>
        (deps.ocr ?? productionOcr)(bytes, {
          provider: ocrChoice,
          reasoningEffort: ocrEffort,
          pageRange: batch,
          newsroomId: String(job.newsroom_id),
          localModel: exactLocalModel,
          jobLabel: `Dark artifact ${request.artifactId}, pages ${batch.start}-${batch.end}`,
          startedAt: jobStarted,
          maxModelCalls: ARTIFACT_OCR_MAX_MODEL_CALLS - modelCalls,
          onProviderSwitch: async ({ transport, model, reason }) => {
            const nextChoice: EffectiveProviderChoice | null = transport === "codex"
              ? "codex-balanced"
              : transport === "anthropic" || transport === "claude-code"
                ? (/haiku/i.test(model) ? "claude-haiku" : "claude-sonnet")
                : null;
            if (!nextChoice || nextChoice === ocrChoice) return;
            const previousLabel = modelChoiceLabel(ocrChoice);
            const nextLabel = modelChoiceLabel(nextChoice);
            const nextEffort = validatedModelEffort(nextChoice, ocrEffort);
            await setJobModelRuntime(job.id, nextChoice, nextEffort);
            await setOwnedStage(`Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
            await setJobFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
            ocrChoice = nextChoice;
            ocrEffort = nextEffort;
          },
        }),
    });
    modelCalls += read.modelCalls ?? read.pages.length;
    totalPages ||= read.pagesTotal ?? 0;
    const pages = read.pages.map((page) => ({ page: page.page, text: storableText(page.text) }));
    accumulatedReason = [accumulatedReason, read.reason].filter(Boolean).join(" ") || null;
    if (/\b(?:model-call|time) limit\b/i.test(read.reason ?? "")) {
      budgetPaused = true;
      accumulatedReason = [
        accumulatedReason,
        "Saved pages are retained; run Read entire PDF again to continue only the unread pages.",
      ].filter(Boolean).join(" ");
    }
    lastProvider = read.provider ?? lastProvider;
    await setOwnedStage("Saving the pages", ocrPct(index));
    await setOwnedStage(`Saving PDF pages ${batch.start}-${batch.end} before continuing…`, ocrPct(index));
    await deps.beforeCheckpoint?.();
    await saveBatch(
      batch,
      pages,
      lastProvider,
      accumulatedReason,
      index + 1,
    );
    if (budgetPaused) break;
  }

  const unread = totalPages > 0 ? unreadOcrPages(totalPages, retainedPages) : [];
  await setOwnedStage(
    unread.length
      ? `${budgetPaused ? "Paused safely. " : ""}Saved ${retainedPages.size} of ${totalPages} PDF pages. Still unread: ${pageListSummary(unread)}.`
      : `Saved all ${totalPages} PDF pages as retained evidence.`,
  );
}

export async function performDarkRound(job: DeskJob) {
  const context = { userId: job.user_id, newsroomId: job.newsroom_id };
  const id = job.subject_id;
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<{ id: number }>`
    select id from investigations where id = ${id} and newsroom_id = ${owned(context)} limit 1
  `;
  if (!inv[0]) throw new Error("Investigation not found");
  /*
    The model this round is pinned to, and the paper's own time budgets.

    `desk_jobs.model_choice` was written at the commit boundary by
    `startDarkRound`, after a successful probe -- so by the time the queue
    reaches here, Automatic has already been resolved to a concrete provider
    and the round cannot change author on its own. `model_choice_source`
    records whether it was Automatic that chose, which is the only case the
    one-shot failover below is allowed to act on.
  */
  let choice = effectiveStoryModelChoice(job.model_choice);
  const modelEffort = savedJobEffort(job);
  const overrides = applyJobLocalModelSnapshot(
    job,
    await readProviderOverrides(owned(context), "dark").catch(() => ({})),
  );
  const runRows = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id, model_choice, model_effort, investigation_id)
    values (${context.userId}, ${owned(context)}, ${choice}, ${modelEffort}, ${id}) returning id
  `;
  const runId = runRows[0]!.id;
  try {
    const snapshot = await snapshotDarkSettingsFor(owned(context), runId);
    await checkBaselines(context.userId, id, new Date(), owned(context));
    await runDueMonitors({ userId: context.userId, newsroomId: owned(context) });
    /*
      Depth comes from the desk's own setting.

      This was `hops: 1` — one hop per press, whatever the investigation needed
      and whatever the editor wanted. The machinery underneath could always
      chase a trail; nothing could ask it to.
    */
    const fileLimits = await darkFileRunLimits(id, owned(context));
    const dials = { ...snapshot.dials, scope: fileLimits.scope };
    const budget = { ...budgetFor(dials), hops: hopsForLimit(fileLimits.key) };
    const runBudget = darkRunBudget(dials, choice, overrides, snapshot.preferences.verificationLimit ?? 6, fileLimits);
    /*
      Synthesis, the four-question review and the editor brief all draw on the
      same meter as research, so the hop loop stops while the provider's own
      reserve is still on it. Without this the run ends elapsed-time-limit
      with zero eligible signals, which is honest but useless to an editor.
    */
    const researchReserveMs = providerBudget(choice ?? undefined, overrides).reserveMs;
    const saveUsage = (usage: DarkRunUsageSnapshot) =>
      persistDarkRunUsage(runId, owned(context), usage, runBudget.stopReason);
    await saveUsage(runBudget.snapshot());
    const where = await readDarkPlace(owned(context)).catch(() => null);
    /*
      FB1, unit 2: the round's four arrivals.

      `progressReporterFor` resolves each sentence against the stage list
      `executeJob` seeded from JOB_STAGE_LISTS at claim, so "Researching the
      file" below lights chip 0 rather than merely filling the "Now:" line.
      Before this the round had no list at all: the whole dig drew an empty chip
      row and a sliding bar.
    */
    const reportRound = progressReporterFor(job);
    const research = async (on: EffectiveProviderChoice) =>
      runDarkResearchWithRememberedChoice(id, on, {
        remember: rememberLastModelChoice,
        run: (rememberedChoice) => researchLoop({
          userId: context.userId,
          investigationId: id,
          hops: budget.hops,
          choice: rememberedChoice,
          providerOverrides: overrides,
          newsroomId: owned(context),
          place: where?.place,
          officialDomains: where?.official,
          pressDomains: where?.press,
          preferences: snapshot.preferences,
          executionMode: snapshot.preferences.executionMode ?? "batch",
          actionLimit: snapshot.preferences.actionLimit ?? 6,
          runBudget,
          researchReserveMs,
          onUsage: saveUsage,
          /*
            FB1: the round's reporter, not `setJobStage`. The hop loop hands a
            percentage out with each of its sentences ("Researching hop 2/5"),
            and `setJobStage`'s signature is a sentence and nothing else -- a
            bridge that dropped the second argument would leave the Dark Desk's
            bar indeterminate for the whole dig, which is one of the two longest
            jobs on the desk.
          */
          onStage: (stage, pct) => reportRound(stage, pct),
          reasoningEffort: effortForChoice(rememberedChoice, modelEffort),
          // Unit U25, B4: the editor's Stop, read fresh at each hop and each
          // search. Before this a dig could only end at its own hop, time or
          // call limit -- a 2-to-13-minute wait with no way out, which the
          // stand-in walkthrough measured by scanning every button on the page
          // for /stop|pause|halt|cancel|abandon/ and finding none.
          throwIfCancelled: () => throwIfJobCancelled(job.id),
        }),
      });
    const synthesize = async (on: EffectiveProviderChoice) => {
      await throwIfJobCancelled(job.id);
      await reportRound("Synthesizing signals", 45);
      await setJobStage(job.id, `Synthesizing signals with ${modelChoiceLabel(on)}`);
      return synthesizeSignals(
        context.userId,
        runId,
        id,
        "",
        dials,
        on,
        overrides,
        owned(context),
        snapshot.preferences,
        runBudget,
        saveUsage,
        effortForChoice(on, modelEffort),
      );
    };

    await reportRound("Researching the file");
    const checkpointed = await runCheckpointedDarkStages({
      initialChoice: choice,
      research,
      synthesize,
      failOver: (error) => planDarkRoundFailover(job, error, { setStage: async () => undefined }),
      setStage: (stage, pct) => reportRound(stage, pct),
    });
    choice = checkpointed.choice;
    const { loop, synth } = checkpointed;
    const terminalFailure = terminalPlannerStartupFailure(loop, synth.error);
    if (terminalFailure) throw new Error(terminalFailure);
    // Stage 2, on the "Keep digging" path too.
    await reportRound("Testing explanations", 65);
    /*
      B8B item 2: the round's longest single call, under the ticker.

      The hop loop asks about Cancel between hops and between searches (DD1),
      and this stage has its own boundary check below -- but the check reads
      Cancel once, BEFORE the call, and this is the one call in a round that is
      routinely minutes long and is not part of the hop loop. An editor
      watching the dig sat on "Testing explanations" with no beat for that whole
      stretch, which is long enough for the card to call a healthy round
      stalled, and a Cancel pressed a second after the check waited for the call
      to finish to be read.

      `waitForModel` is the same ticker every model-calling worker uses: it
      beats while the verification runs, so the row never goes quiet, and it
      polls Cancel on the same tick, so the editor's Stop lands inside the call
      rather than after it.
    */
    const verifySummary = await waitForModel({
      jobId: job.id,
      label: () => modelChoiceLabel(choice),
      run: () =>
        runVerificationStage(
          context.userId,
          owned(context),
          runId,
          id,
          choice,
          overrides,
          snapshot.preferences,
          runBudget,
          saveUsage,
          (stage) => reportRound(stage),
          effortForChoice(choice, modelEffort),
          job,
        ),
    });
    // Stage 2 is the longest single model call of the round and it is not part
    // of the hop loop, so it needs its own boundary check.
    await throwIfJobCancelled(job.id);
    await rememberLastModelChoice(id, choice);
    const names = (
      await sql<{ name: string }>`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${id} and ie.newsroom_id = ${owned(context)}
        order by ie.id desc limit 40
      `
    ).map((n) => n.name);
    await resurfaceDeadEnds(context.userId, id, names, { foreignOnly: true });
    const revived = await matchDeadEnds(context.userId, names, owned(context));
    const header = [
      loop.summary,
      synth.summary,
      verifySummary,
      describeResearchWindow(snapshot.preferences),
      `Hops ${loop.hops} of ${budget.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
      `Setting: dig ${dials.dig}/10, nerve ${dials.nerve}/10 (${stanceFor(dials).label}), scope ${dials.scope}.`,
      revived.length
        ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}`
        : "",
      synth.error ? `Synthesis: ${synth.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    /*
      Write the brief while the round is still warm.

      Not on page load: it is a model call, and an editor refreshing a file
      should not pay for one. Failure is deliberately swallowed — the four
      lists are the real content and a missing summary must never fail a round
      that otherwise dug successfully.
    */
    let briefError = "";
    try {
      await reportRound("Writing editor brief", 85);
      const briefResult = await buildBrief(
        context.userId,
        owned(context),
        id,
        choice,
        overrides,
        grokChat,
        {
          budget: runBudget,
          onUsage: saveUsage,
          onStage: (stage) => reportRound(stage),
        },
        effortForChoice(choice, modelEffort),
      );
      if (!briefResult.ok) briefError = briefResult.error;
    } catch (error) {
      briefError = asDarkError(error);
      /* the file is still readable without it */
    }

    const stopReason = runBudget.stopReason ?? loop.stopReason ?? (synth.error ? "synthesis-failed" : loop.paused ? "hop-limit" : "completed");
    await persistDarkRunUsage(runId, owned(context), runBudget.snapshot(), stopReason as DarkRunStopReason);
    const finishedSummary = briefError ? `${header}\nBrief: ${briefError}` : header;
    await sql`
      update dark_runs
      set finished_at = now(), summary = ${tailSafeDarkSummary(finishedSummary)}, error = ${synth.error ?? null},
          model_choice = ${choice}, stop_reason = ${stopReason}
      where id = ${runId} and newsroom_id = ${owned(context)}
    `;
    await audit(
      context.userId,
      "dark-continue",
      `run ${runId} inv ${id} hops ${loop.hops} signals ${synth.stored}`,
      owned(context),
    );

    if (synth.error && !loop.paused) await markInvestigationPaused(context.userId, id, synth.error);
  } catch (err) {
    const error = asDarkError(err);
    /*
      Unit U25, B4: a stopped round says it was stopped, and the file says so
      too. Without this the cancel arrived as an ordinary failure and the run
      summary read like a dig that broke -- which is the opposite of what the
      editor asked for. `throwIfJobCancelled` throws `JobCancelledError`, whose
      message is `JOB_CANCELLED_REASON`; `executeJob` records that as the job's
      error, so the desk and the job queue say the same sentence.
    */
    const cancelled = err instanceof JobCancelledError;
    if (cancelled) {
      await sql`
        update dark_runs
        set finished_at = now(), error = ${JOB_CANCELLED_REASON},
            stop_reason = ${"cancelled"}, summary = ${tailSafeDarkSummary(
              `Stopped by the editor. Work completed before the stop is saved; open follow-ups remain on the file.`,
            )}
        where id = ${runId} and newsroom_id = ${owned(context)}
      `.catch(() => undefined);
      await markInvestigationPaused(context.userId, id, JOB_CANCELLED_REASON).catch(() => undefined);
      throw err;
    }
    await sql`
      update dark_runs
      set finished_at = now(), error = ${error.slice(0, 800)}
      where id = ${runId} and newsroom_id = ${owned(context)}
    `;
    await markInvestigationPaused(context.userId, id, error);
    throw new Error(error);
  }
}

/**
 * The file's own title, marker-stripped: the grounded subject a lead falls back
 * to when its signal's name leaves nothing to headline.
 *
 * Read only when it is needed -- a name that survives the strip is the headline
 * -- and read through `groundedHeadline` rather than used raw, because the one
 * thing that must never reach `leads.headline` is the Dark Desk's marker
 * (N3 of the batch-7 re-audit).
 */
async function investigationHeadlineFor(
  sql: Sql,
  investigationId: number,
  newsroomId: number,
): Promise<string> {
  const rows = await sql<{ title: string }>`
    select title from investigations
    where id = ${investigationId} and newsroom_id = ${newsroomId} limit 1
  `.catch(() => []);
  return groundedHeadline(rows[0]?.title ?? "");
}

/**
 * Send ONE signal to the working queue as a story lead.
 *
 * Protocol and triage state travel with the lead, but neither can block the
 * editor's handoff. The Dark Desk develops leads; sending one to the working
 * queue is not publication and does not claim the theory is true.
 */
export async function sendDarkSignalToQueueFor(
  userId: string,
  newsroomId: number,
  id: number,
  _opts: { asTip?: boolean } = {},
): Promise<
  | { ok: true; leadId: number; asTip: boolean }
  | { ok: false; error: string; blocked?: "unverified" | "watch" }
> {
  await ensureDarkSchema();
  const sql = await getSql();
  const rows = await sql<DarkSignalRow>`
    select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
      observation, pattern, linkage_map, alternatives, counter_narrative,
      what_would_kill, pathway, privacy_review, handoff, created_at,
      stage, verification_status, gates_missing, gate_missing_context, newsworthiness_json, newsworthiness_decision
    from dark_signals where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  const sig = rows[0];
  if (!sig) return { ok: false as const, error: "Signal not found" };

  const verified = sig.verification_status === "verified";
  const words = stageWords(sig);

  let news: ReturnType<typeof readNewsworthiness> = null;
  try {
    news = sig.newsworthiness_json ? readNewsworthiness(JSON.parse(sig.newsworthiness_json)) : null;
  } catch {
    news = null;
  }
  /*
    Unit U25, B3: the captures that become this lead's sources are the ones the
    dig actually got AND that are about the lead. `order by id desc limit 12`
    with no predicate is what put a movie-ordering listicle and four courier
    sites on the drafted story's source list; see `result-quality.ts`.
  */
  const arts = sig.investigation_id
    ? await sql<CapturedArtifactRow>`
        select url, title, fetch_status, fetch_outcome, full_text from artifacts
        where newsroom_id = ${newsroomId} and investigation_id = ${sig.investigation_id}
        order by id desc limit 40
      `
    : await sql<CapturedArtifactRow>`
        select url, title, fetch_status, fetch_outcome, full_text from artifacts
        where newsroom_id = ${newsroomId}
        order by id desc limit 40
      `;
  const urls = JSON.stringify(
    sanitizePublicUrls(
      usableLeadSources(arts.map(capturedPageOf), sig.name).map((a) => a.url),
    ).slice(0, 12),
  );
  /*
    N3 of the batch-7 re-audit: THE MARKER NEVER LEAVES THE DARK DESK.

    Every prose field of this signal wears the marker where the model named
    something no capture carries -- `name` since M1, and the rest since DD1 --
    and every one of them is read by the Queue, the Draft button, the story page
    and the duplicate check. The marker is a note addressed to an editor
    reading the Dark Desk; on the working queue it is noise that survives into
    a headline and a draft. So the specifics come out here, and what they said
    is handed to the editor as a sentence in the notes instead -- the same
    bargain DD1 strikes everywhere else: nothing is deleted, what the model was
    reaching for is still readable, and it is never mistaken for fact.
  */
  const signalFields = [
    sig.name,
    sig.observation,
    sig.linkage_map,
    sig.alternatives,
    sig.pathway,
    sig.counter_narrative,
    sig.gate_missing_context ?? "",
  ];
  const unconfirmed = [
    ...new Set(signalFields.flatMap((field) => markedSpecifics(String(field ?? "")))),
  ];
  /*
    The two LONG fields of the notes, stripped before they are cut to length
    rather than after: a slice that lands inside a marker leaves "(not in a",
    which no stripper can pair with the specific it belonged to -- the same
    trap the frontier labels fall into (see `UNRESOLVED_PROVENANCE_KIND`).
  */
  const opposing = stripUngroundedNotes(sig.counter_narrative ?? "").slice(0, 800);
  const missing = stripUngroundedNotes(sig.gate_missing_context ?? "").slice(0, 800);
  /*
    `why` is ASSEMBLED from the signal, and every part of it is the model's --
    the observation, the linkage map, the alternatives, the pathway, the
    opposing account. The guard goes on the joined sentence, not on each clause
    on the way in, so a field added to this list by a later author is covered
    without their having to know this comment exists. The `strip` is N3's half
    of it: the same joined sentence, with the Dark Desk's markers and the
    specifics they mark taken back out on the way to the queue.
  */
  const why = storableText(
    stripUngroundedNotes(
      [
        `DARK DESK investigation notes. Claim kinds in the evidence. Publication is a separate human action.`,
        `Posture: ${sig.posture}. Type: ${sig.signal_type}. Strength ${sig.strength} / confidence ${sig.confidence}.`,
        `Stage: ${words.chip}. ${words.sentence}`,
        `Editor triage: ${newsworthinessWords(news)}`,
        verified ? "" : "Research protocol incomplete. This is an editor lead, not a factual finding.",
        unconfirmed.length
          ? `Unconfirmed, not in any capture: ${unconfirmed.join("; ")}. Nothing here carries it yet — check it before it goes into a story.`
          : "",
        `Opposing account: ${opposing || "Not established."}`,
        `Missing context: ${missing || "Not assessed."}`,
        sig.observation,
        `Linkage: ${sig.linkage_map}`,
        `Alternatives: ${sig.alternatives}`,
        `Pathway: ${sig.pathway}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
  ).slice(0, 4000);
  /*
    The headline, from the signal's name with the marker and the ungrounded
    specific taken out. A name that was only ever the invented address leaves
    nothing to headline, and the file's own title -- the lead the Dark Desk was
    opened from, and the one string here the editor wrote -- is the grounded
    subject to fall back to.
  */
  const headline =
    groundedHeadline(sig.name) ||
    (sig.investigation_id ? await investigationHeadlineFor(sql, sig.investigation_id, newsroomId) : "");
  const created = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
    values (
      ${userId},
      ${newsroomId},
      ${storableText(headline || "Untitled Dark Desk signal").slice(0, 240)},
      ${why},
      'council',
      'new',
      ${urls},
      ${storableText(stripUngroundedNotes(sig.observation)).slice(0, 4000)},
      ${Math.min(20, sig.strength)},
      ${sig.investigation_id}
    )
    returning id
  `;
  await audit(userId, "dark-handoff", String(id), newsroomId);
  return { ok: true as const, leadId: created[0]!.id, asTip: !verified };
}

export const sendDarkSignalToQueue = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkSignalInput.parse(input))
  .handler(async ({ context, data }) =>
    sendDarkSignalToQueueFor(context.userId, owned(context), data.id, {
      asTip: data.asTip === true,
    }),
  );

export type InvestigationQueuePacket = {
  investigationId: number;
  title: string;
  suggestedHeadline: string;
  evidence: { text: string; source: string | null }[];
  uncertainties: string[];
  contradictions: InvestigationBrief["contradictions"];
  whatWouldDisproveIt: string[];
  publicationNotice: "Publication remains an editorial decision.";
};

export async function queuePacketFor(newsroomId: number, id: number) {
  await ensureDarkSchema();
  const sql = await getSql();
  const files = await sql<{ id: number; title: string; ordinary_explanation: string }>`
    select id, title, ordinary_explanation from investigations
    where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  if (!files[0]) return null;
  const [claims, signalRows, briefRows] = await Promise.all([
    sql<{ body: string; source_url: string | null }>`
      select body, source_url from claims
      where investigation_id = ${id} and newsroom_id = ${newsroomId}
        and (capture_event_id is not null or source_url is not null)
      order by id desc limit 8
    `.catch(() => [] as { body: string; source_url: string | null }[]),
    sql<{ name: string; verification_status: string; gate_missing_context: string | null; what_would_kill: string }>`
      select name, verification_status, gate_missing_context, what_would_kill
      from dark_signals where investigation_id = ${id} and newsroom_id = ${newsroomId}
      order by id desc limit 5
    `.catch(() => [] as { name: string; verification_status: string; gate_missing_context: string | null; what_would_kill: string }[]),
    sql<{ brief_json: string }>`
      select brief_json from investigation_briefs
      where investigation_id = ${id} and newsroom_id = ${newsroomId} limit 1
    `.catch(() => [] as { brief_json: string }[]),
  ]);
  let brief: InvestigationBrief | null = null;
  try {
    brief = briefRows[0] ? parseBrief(JSON.parse(briefRows[0].brief_json)) : null;
  } catch {
    brief = null;
  }
  const clean = (value: unknown) => stripUngroundedNotes(String(value ?? "")).replace(/\s+/g, " ").trim();
  const unique = (values: string[]) => [...new Set(values.map(clean).filter(Boolean))];
  const uncertainties = unique([
    files[0].ordinary_explanation,
    brief?.benign ?? "",
    brief?.kills_it ?? "",
    ...signalRows
      .filter((signal) => signal.verification_status !== "verified")
      .map((signal) => `${signal.name}: ${signal.gate_missing_context || "This signal has not completed verification."}`),
  ]);
  return {
    investigationId: id,
    title: clean(files[0].title),
    suggestedHeadline: clean(brief?.headline || files[0].title),
    evidence: claims.map((claim) => ({ text: clean(claim.body), source: claim.source_url })),
    uncertainties,
    contradictions: brief?.contradictions ?? [],
    whatWouldDisproveIt: unique([
      brief?.kills_it ?? "",
      ...signalRows.map((signal) => signal.what_would_kill),
    ]),
    publicationNotice: "Publication remains an editorial decision." as const,
  };
}

export const queuePacket = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => queuePacketFor(owned(context), id));

async function markInvestigationDisposition(
  newsroomId: number,
  id: number,
  kind: "set-aside" | "no-finding" | "queued",
  note: string | null,
) {
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    update investigations
    set status = 'closed', closed_kind = ${kind}, close_note = ${note},
        pause_reason = ${kind === "queued" ? "Sent to the reporting queue." : null},
        updated_at = now()
    where id = ${id} and newsroom_id = ${newsroomId}
    returning id
  `;
  return rows[0]?.id != null;
}

export async function closeInvestigationFor(
  userId: string,
  newsroomId: number,
  id: number,
  note?: string | null,
) {
  await ensureDarkSchema();
  const cleanNote = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const closed = await markInvestigationDisposition(newsroomId, id, "no-finding", cleanNote);
  if (!closed) return { ok: false as const, error: "Investigation not found" };
  await audit(userId, "dark", `closed inv ${id} without a finding`, newsroomId);
  return { ok: true as const, investigationId: id };
}

export const closeInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => {
    const value = input as { id?: unknown; note?: unknown };
    return { id: rowId.parse(value?.id), note: typeof value?.note === "string" ? value.note : null };
  })
  .handler(async ({ context, data }) => closeInvestigationFor(context.userId, owned(context), data.id, data.note));

/**
 * Create-or-find the story lead for an investigation. Research completeness
 * is preserved in the notes and never blocks this editor-controlled handoff.
 *
 * Pulled out of the `createServerFn` handler so a test can prove the three
 * outcomes the Dark Desk "Send to the queue" button now distinguishes on
 * screen (new lead / already-queued / not found) without standing up
 * `deskMiddleware`'s request-and-bearer-token plumbing — see `assertOwner`
 * above for the same reasoning.
 */
export async function queueInvestigationFor(
  userId: string,
  newsroomId: number,
  id: number,
  _opts: { asTip?: boolean } = {},
) {
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<InvestigationRow>`
    select id, title, status, summary, hops, budget, pause_reason, created_at, updated_at,
           last_model_choice
    from investigations where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  if (!inv[0]) return { ok: false as const, error: "Investigation not found" };
  const gate = await sql<{ total: number; verified: number }>`
    select count(*)::int as total,
           count(*) filter (where verification_status = 'verified')::int as verified
    from dark_signals
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
  `.catch(() => null);
  if (!gate?.[0])
    return {
      ok: false as const,
      error: "Could not read the file verification status. Nothing was sent; retry the handoff.",
    };
  const total = Number(gate[0]?.total ?? 0);
  const verifiedCount = Number(gate[0]?.verified ?? 0);
  const already = await sql<{ id: number }>`
    select id from leads
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
    order by id asc limit 1
  `;
  if (already[0]) {
    await markInvestigationDisposition(newsroomId, id, "queued", `Lead ${already[0].id}`);
    await audit(userId, "dark-handoff", `inv ${id} existing lead ${already[0].id}`, newsroomId);
    return { ok: true as const, leadId: already[0].id, alreadyQueued: true as const };
  }
  /*
    Unit U25, B3. The handoff carried the file's last twelve captures with no
    predicate at all, so `leads.source_urls` became the junk the dig had most
    recently fetched -- and the drafted story's "Sources on the lead" listed
    them while omitting the one real source. Read a wider window, then keep
    only the captures that got the article and are about this lead.
  */
  const arts = await sql<CapturedArtifactRow>`
    select url, title, fetch_status, fetch_outcome, full_text from artifacts
    where newsroom_id = ${newsroomId} and investigation_id = ${id}
    order by id desc limit 40
  `;
  const leadWords = `${inv[0].title}\n${inv[0].summary}`;
  const leadSources = usableLeadSources(arts.map(capturedPageOf), leadWords);
  const urls = JSON.stringify(sanitizePublicUrls(leadSources.map((a) => a.url)).slice(0, 12));
  /*
    Same reading as the Write box (Unit P item 2): this newsroom's own section
    names and briefs decide the beat, and a file that names none of them is
    marked not-chosen instead of silently landing in the first section. The
    light reader never installs the sections schema -- a handoff must not fail
    over a label.
  */
  const { readTopicSections } = await import("./sections.server.ts");
  const { topic, unchosen: topicUnchosen } = topicFromText(
    `${inv[0].title}\n${inv[0].summary}`,
    await readTopicSections(newsroomId),
  );
  // Keep uncertainty ahead of the summary: a long brief must not crowd out
  // the opposing account when a whole file becomes a lead.
  const signalNotes = await sql<{
    name: string;
    verification_status: string;
    counter_narrative: string;
    gate_missing_context: string | null;
    what_would_kill: string;
  }>`
    select name, verification_status, counter_narrative, gate_missing_context, what_would_kill
    from dark_signals where investigation_id = ${id} and newsroom_id = ${newsroomId}
    order by id asc limit 3
  `;
  const shorten = (value: string, limit: number) =>
    value.length > limit ? `${value.slice(0, limit - 13)} [shortened]` : value;
  const briefs = await sql<{ brief_json: string }>`
    select brief_json from investigation_briefs
    where investigation_id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  let briefNext = "";
  try {
    briefNext = briefs[0] ? parseBrief(JSON.parse(briefs[0].brief_json)).next : "";
  } catch {
    // A malformed old brief must not prevent handing off the captured file.
  }
  const frontier = await sql<{ next_steps: string }>`
    select next_steps from frontier_items
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
      and status in ('open', 'reopened', 'deferred') and trim(next_steps) <> ''
    order by priority desc, id asc limit 3
  `;
  /*
    N3 of the batch-7 re-audit: THE MARKER NEVER LEAVES THE DARK DESK.

    The single-signal handoff is where the marker was caught reaching
    `leads.headline`, but this path carries it too: the signal names, the
    next-step lines and the file's own summary are all model prose written with
    the marker when the model named something no capture carries, and all of
    them are stitched into the lead's notes. Every piece is taken off its
    markers BEFORE it is shortened -- a shortened marker is half a marker
    ("(not in a"), which no stripper downstream can pair with the specific it
    belonged to -- and what the specifics said is handed over as a sentence the
    editor can read, rather than deleted.
  */
  const plain = (value: string) => stripUngroundedNotes(String(value ?? ""));
  const unconfirmed = [
    ...new Set([
      ...signalNotes.flatMap((signal) => markedSpecifics(signal.name)),
      ...signalNotes.flatMap((signal) => markedSpecifics(signal.counter_narrative)),
      ...signalNotes.flatMap((signal) => markedSpecifics(signal.gate_missing_context ?? "")),
      ...signalNotes.flatMap((signal) => markedSpecifics(signal.what_would_kill)),
      ...frontier.flatMap((item) => markedSpecifics(item.next_steps)),
      ...markedSpecifics(briefNext),
      ...markedSpecifics(inv[0].summary),
    ]),
  ];
  const nextSteps = [briefNext, ...frontier.map((item) => item.next_steps)]
    .filter(Boolean)
    .map((step) => shorten(plain(step), 300));
  const handoff = [
    "DARK DESK notes. Publication is a separate human action.",
    `${verifiedCount} of ${total} filed signals completed the research protocol; other signals remain unverified. This is a lead handoff, not publication.`,
    unconfirmed.length
      ? `Unconfirmed, not in any capture: ${unconfirmed.join("; ")}. Nothing here carries it yet — check it before it goes into a story.`
      : "",
    nextSteps.length
      ? `Next steps (not established facts): ${shorten([...new Set(nextSteps)].join("\n"), 600)}\nOpen investigation for all follow-ups.`
      : "",
    signalNotes.length
      ? `Signal notes: showing ${signalNotes.length} of ${total}. Open investigation for the complete file and unabridged accounts.`
      : "",
    ...signalNotes.map((signal) =>
      [
        `${shorten(plain(signal.name), 80)} — ${signal.verification_status === "verified" ? "verified" : "unverified"}`,
        `Opposing account: ${shorten(plain(signal.counter_narrative) || "Not established.", 320)}`,
        `Missing context: ${shorten(plain(signal.gate_missing_context ?? "") || "Not assessed.", 320)}`,
        `What would disprove it: ${shorten(plain(signal.what_would_kill) || "Not established.", 160)}`,
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  /*
    The handoff's `evidence` is the same shape of assembled model prose as
    `why` above: signal names, opposing accounts, what-would-kill lines and the
    investigation's own summary, stitched into one string. Guarded whole, after
    the join, so the stitches are covered too, and so is a clause a later author
    adds to the `handoff` list above. `topic` is the one field here that is not
    the model's: `topicFromText` answers with a key from the newsroom's own
    section list.
  */
  const evidence = stripUngroundedNotes(
    storableText(
      `${handoff}\n\nFile summary: ${shorten(plain(inv[0].summary), Math.max(0, 4000 - handoff.length - 16))}`,
    ),
  );
  const created = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id, topic_unchosen)
    values (
      ${userId},
      ${newsroomId},
      ${storableText(stripUngroundedNotes(inv[0].title)).slice(0, 240)},
      ${evidence},
      ${topic},
      'new',
      ${urls},
      ${evidence},
      ${12},
      ${id},
      ${topicUnchosen}
    )
    returning id
  `;
  await audit(userId, "dark-handoff", `inv ${id} lead ${created[0]!.id}`, newsroomId);
  /*
    The pass ends here -- the captured file becomes a story lead and the editor
    is looking at it -- and the pages it read come with it.

    `arts` above is exactly "the pages the pass actually fetched": the loop
    writes an artifact row only for a document it retrieved, so the suggestion
    is evidence the page exists in the form the desk would fetch tomorrow. They
    are offered as candidates, never as sources; nothing is fetched until
    someone accepts one, and the editor can still add a source by hand.

    The section guess is the one `topicFromText` just made for the lead, kept
    only when the file's own words named a section this newsroom files under.
    `topicUnchosen` is precisely that answer, so a guess that came from the
    fallback is not offered -- the review screen starts its picker at its own
    default rather than at a decision nobody made.

    The single-signal handoff (`sendDarkSignalToQueueFor`) deliberately does not
    propose as well: it reads the same investigation's artifacts, so every page
    it could offer the file handoff has already offered, and the duplicate guard
    would return nothing.
  */
  await proposePassSourcesFor(sql, {
    userId,
    newsroomId,
    proposedBy: "dark",
    leadId: created[0]!.id,
    section: topicUnchosen ? null : topic,
    pages: leadSources.slice(0, 12).map((art) => ({
      url: art.url,
      // `CapturedPage.title` is nullable because a capture may have none;
      // a proposed source with no title is one with the field absent.
      title: art.title ?? undefined,
      reason: `Read while developing "${inv[0].title.slice(0, 120)}" on the Dark Desk.`,
    })),
  });
  await markInvestigationDisposition(newsroomId, id, "queued", `Lead ${created[0]!.id}`);
  return { ok: true as const, leadId: created[0]!.id, alreadyQueued: false as const };
}

export const queueInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkSignalInput.parse(input))
  .handler(async ({ context, data }) => {
    // SG1 / Option A: sending an investigation to the Queue is how a Dark Desk
    // finding becomes a spent draft, so it is refused until setup is done.
    const notSetUp = await paperSetUpRefusal(owned(context), "send this to the Queue");
    if (notSetUp) return { ok: false as const, error: notSetUp };
    return queueInvestigationFor(context.userId, owned(context), data.id, {
      asTip: data.asTip === true,
    });
  });

export const parkInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    await markInvestigationDisposition(owned(context), id, "set-aside", null);
    await audit(context.userId, "dark", `set aside inv ${id}`, owned(context));
    return { ok: true as const, investigationId: id };
  });

export const reopenParkedInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => rowId.parse(id))
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const leftover = await sql<{ c: number }>`
      select count(*)::int as c from frontier_items
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
        and status in ('open', 'investigating', 'reopened', 'deferred')
    `;
    const still = Number(leftover[0]?.c ?? 0);
    await sql`
      update investigations
      set status = ${still > 0 ? "paused" : "open"},
          closed_kind = null,
          close_note = null,
          pause_reason = ${still > 0 ? `Hop budget resumed with ${still} frontier item(s) still open.` : null},
          updated_at = now()
      where id = ${id} and newsroom_id = ${owned(context)}
    `;
    await audit(context.userId, "dark", `pull back inv ${id}`, owned(context));
    return { ok: true as const, investigationId: id };
  });

/**
 * Read the town's subreddit and file anything that looks like a record.
 *
 * Lands in `anomalies`, which is what "Worth a look" already reads, so a tip
 * competes with every other lead on the desk instead of getting its own pile.
 * Everything filed is marked UNVERIFIED and carries its permalink: a resident's
 * account is a reason to go looking, never a citation.
 *
 * Deduplicated on the permalink, so running this twice in a day adds only what
 * is new. Rate-limited harder than the rest of the desk because the budget it
 * spends is Reddit's, shared with everything else on this machine.
 */
export async function readTipSubreddit(newsroomId: number): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{url:string}>`select url from sources where newsroom_id=${newsroomId} and status='accepted'`;
  return subredditFromSources(rows.map(row=>row.url));
}
export const getTipSubreddit = createServerFn({method:"GET"})
  .middleware([deskMiddleware])
  .handler(async ({context}) => ({subreddit:await readTipSubreddit(owned(context))}));

export const scanTipSubreddit = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    /*
      SG1 / Option A: this sweep fetches a subreddit the paper's own Sources
      named; an install nobody has set up has no sources, so it is refused.
      THROWN rather than returned: the caller's type is the successful read
      (this handler always threw before), and the refusal reaches the editor
      through the same error path with the same one sentence.
    */
    await requirePaperSetUp(owned(context), "check the tip subreddit");
    await ensureDarkSchema();
    await assertRate(context.userId, "reddit", owned(context));
    const { enrichRedditPostsWithLocalRedlib, sweepRedditFeeds } = await import("./reddit.server.ts");
    const {
      subredditNewFeed,
      subredditSearchFeed,
      pickCivicPosts,
      redditPostIsAutoFileEligible,
      redditAnomaly,
      classifyRedditPosts,
      selectRotatingQueryGroups,
    } = await import("./reddit.ts");
    const sub = await readTipSubreddit(owned(context));
    if (!sub) throw new Error("Reddit check unavailable: add one unambiguous subreddit URL to Sources. No subreddit was guessed from the town name.");

    // Rotate by hour so successive checks sweep different ground instead of
    // asking the same three questions of the subreddit every time.
    const hourIndex = Math.floor(Date.now() / 3_600_000);
    const groups = selectRotatingQueryGroups(TIP_SUBREDDIT_QUERY_GROUPS, hourIndex, 3);
    const feeds = [subredditNewFeed(sub), ...groups.map((g) => subredditSearchFeed(sub, g.query))];
    const searched = ["newest", ...groups.map((g) => g.label)];
    const sweep = await sweepRedditFeeds(feeds, feeds.length);
    const enrichment = await enrichRedditPostsWithLocalRedlib(sweep.posts, 3);
    const posts = enrichment.posts;
    const picked = pickCivicPosts(posts.filter((post) => redditPostIsAutoFileEligible(post)));

    const sql = await getSql();
    let filed = 0;
    const alreadyKnownUrls = new Set<string>();
    const filedUrls = new Set<string>();
    for (const post of picked) {
      const seen = await sql<{ id: number }>`
        select id from anomalies
        where newsroom_id = ${owned(context)} and url = ${post.url}
        limit 1
      `;
      if (seen[0]) {
        alreadyKnownUrls.add(post.url);
        continue;
      }
      const a = redditAnomaly(post, sub);
      await sql`
        insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
        values (${context.userId}, ${owned(context)}, ${a.kind}, ${a.summary}, ${a.url}, ${a.details})
      `;
      filed += 1;
      filedUrls.add(post.url);
    }

    await audit(
      context.userId,
      "reddit",
      `r/${sub} read ${posts.length} redlib ${enrichment.report.enriched}/${enrichment.report.attempted} filed ${filed}`,
      owned(context),
    );

    // Every post read, not only the ones filed, so a near miss stays visible
    // to the editor instead of vanishing along with the sweep. Split at the
    // civic threshold: the desk shows what cleared it and, separately, the
    // near misses (3-5) that almost did — the sniffing the owner asked to see.
    const classified = classifyRedditPosts(posts, alreadyKnownUrls, filedUrls);
    const asCard = (p: (typeof classified)[number]) => ({
      title: p.title,
      score: p.score,
      url: p.url,
      excerpt: p.excerpt,
      updated: p.updated,
      author: p.author,
      autoFileEligible: p.autoFileEligible,
      state: p.state,
      sourceAdapter: p.sourceAdapter,
      redditScore: p.redditScore,
      upvoteRatio: p.upvoteRatio,
      reportedCommentCount: p.reportedCommentCount,
      retrievedCommentCount: p.retrievedCommentCount,
      coverage: p.coverage,
    });

    return {
      ok: true as const,
      subreddit: sub,
      read: posts.length,
      civic: picked.length,
      filed,
      alreadyKnown: alreadyKnownUrls.size,
      incomplete: sweep.incomplete,
      reason: sweep.reason ?? "",
      log: sweep.log,
      // Which of the rotating searches ran this check, newest-posts first.
      searched,
      enrichment: enrichment.report,
      topScores: classified
        .filter((p) => p.score >= 6)
        .slice(0, 12)
        .map(asCard),
      nearMisses: classified
        .filter((p) => p.score >= 3 && p.score < 6)
        .slice(0, 5)
        .map(asCard),
    };
  });

/**
 * File one reddit post as a tip by hand.
 *
 * Used from the "File as tip" action next to a post the automatic sweep
 * scored below the civic line, or scored above it but had already been seen
 * (`scanTipSubreddit`'s own de-dup). Same anomaly shape, same de-dup on the
 * permalink, so a hand-filed tip is indistinguishable on the desk from one
 * the sweep filed itself.
 *
 * Pulled out as a plain function (the queueInvestigationFor/queueInvestigation
 * pattern this file already uses) so it is testable against PGLite without
 * standing up a request context.
 */
export async function fileRedditTipFor(
  userId: string,
  newsroomId: number,
  data: { url: string; title: string; excerpt?: string; updated?: string; author?: string },
): Promise<{ ok: true; filed: boolean }> {
  await ensureDarkSchema();
  const sql = await getSql();
  const seen = await sql<{ id: number }>`
    select id from anomalies
    where newsroom_id = ${newsroomId} and url = ${data.url}
    limit 1
  `;
  if (seen[0]) {
    return { ok: true, filed: false };
  }
  const { redditAnomaly } = await import("./reddit.ts");
  const a = redditAnomaly(
    { title: data.title, url: data.url, updated: data.updated ?? "", author: data.author ?? "", excerpt: data.excerpt ?? "" },
    subredditFromSources([data.url]) ?? "reddit",
  );
  await sql`
    insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
    values (${userId}, ${newsroomId}, ${a.kind}, ${a.summary}, ${a.url}, ${a.details})
  `;
  await audit(userId, "reddit-manual", `filed by hand: ${data.title}`, newsroomId);
  return { ok: true, filed: true };
}

export const fileRedditTip = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: unknown) => redditTipInput.parse(data))
  .handler(async ({ context, data }) => fileRedditTipFor(context.userId, owned(context), data));

/**
 * The dials, as stored for this newsroom.
 *
 * Read on every round rather than captured at investigation time: an editor who
 * turns the desk up expects the next round to dig harder, not the next
 * investigation they happen to start.
 */
export async function readDarkDials(newsroomId: number): Promise<DarkDials> {
 return (await readDarkSettingsFor(newsroomId)).dials;
}

export const getDarkDials = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const {dials,preferences} = await readDarkSettingsFor(owned(context));
    const {place} = await readDarkPlace(owned(context));
    return {
      dials,
      preferences,
      budget: budgetFor(dials),
      stance: stanceFor(dials),
      place,
      description: describeDials(dials, place),
      minutes: estimateMinutes(dials),
      presets: PRESETS,
      scopeLabel: scopeLabelsFor(place),
    };
  });

export const getDarkCounty = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const { place } = await readDarkPlace(owned(context));
    return { county: place.county ?? "" };
  });

export const saveDarkDials = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { dig: number; nerve: number; scope: string; preferences?: ResearchPreferences }) => ({...input, preferences: input.preferences === undefined ? undefined : validateResearchPreferences(input.preferences)}))
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    // Clamped on the way in as well as on the way out: a stored 40 would be a
    // very expensive typo.
    const d = clampDials(data as Partial<DarkDials>);
    const saved = await saveDarkSettingsFor(owned(context), {dials:d,preferences:data.preferences});
    await audit(
      context.userId,
      "dark-dials",
      `dig ${d.dig} nerve ${d.nerve} scope ${d.scope}`,
      owned(context),
    );
    return {
      ok: true as const,
      dials: saved.dials,
      preferences: saved.preferences,
      description: describeDials(saved.dials, (await readDarkPlace(owned(context))).place),
      minutes: estimateMinutes(d),
    };
  });

/**
 * The county for this newsroom's Dark Desk searches, as stored on
 * `dark_settings` -- the same table and the same newsroom-scoped upsert as
 * the dig/nerve/scope dials above. Extracted as a plain function (the
 * `fileRedditTipFor` pattern this file already uses) so it is testable
 * against PGLite without a request context; the `createServerFn` wrapper
 * below is the thin layer Paper setup's county field actually calls.
 *
 * Blank clears the column back to null rather than storing an empty
 * string, so `readDarkPlace` (which does `.trim() || null`) and any other
 * reader sees one unambiguous "not set" value.
 */
export async function saveDarkCountyFor(newsroomId: number, county: string): Promise<string> {
  const sql = await getSql();
  const trimmed = county.trim();
  await sql`
    insert into dark_settings (newsroom_id, county, updated_at)
    values (${newsroomId}, ${trimmed || null}, now())
    on conflict (newsroom_id) do update
      set county = excluded.county, updated_at = now()
  `;
  return trimmed;
}

export const saveDarkCounty = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkCountyInput.parse(input))
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    const county = await saveDarkCountyFor(owned(context), data.county);
    await audit(
      context.userId,
      "dark-county",
      county ? `county set to ${county}` : "county cleared (city-only scoping)",
      owned(context),
    );
    return { ok: true as const, county };
  });

/**
 * Write the read-me-first block for one investigation.
 *
 * Runs after a round rather than on page load: it is a model call, and an
 * editor refreshing a file should not pay for one. Failure is silent by design
 * — the four lists below it are the real content, and a missing summary must
 * never stop the file opening.
 */
/** The exact bounded evidence pack sent to the brief model. */
export async function buildDarkBriefPromptPack(newsroomId: number, id: number): Promise<string | null> {
  const sql = await getSql();
  const inv = await sql<{ title: string }>`
    select title from investigations where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  if (!inv[0]) return null;

  const claims = await sql<{ body: string; kind: string; evidence: string | null }>`
    select body, kind, evidence from claims where investigation_id = ${id}
    order by confidence desc nulls last, id desc limit 40
  `.catch(() => []);
  const hyps = await sql<{ body: string }>`
    select body from hypotheses where investigation_id = ${id} order by id desc limit 20
  `.catch(() => []);
  const front = await sql<{ label: string; why: string }>`
    select label, why from frontier_items where investigation_id = ${id}
      and status in ('open', 'reopened', 'deferred')
    order by priority desc, id desc limit 25
  `.catch(() => []);
  const ents = await sql<{ name: string; kind: string }>`
    select e.name, e.kind from investigation_entities ie
    join entities e on e.id = ie.entity_id
    where ie.investigation_id = ${id} order by ie.id desc limit 40
  `.catch(() => []);
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies where investigation_id = ${id} order by id desc limit 20
  `.catch(() => []);
  const verificationRows = await sql<{ eligible: number; complete: number }>`
    select count(*)::int as eligible,
           count(*) filter (where verification_status = 'verified')::int as complete
    from dark_signals
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
  `.catch(() => [{ eligible: 0, complete: 0 }]);
  const verification = verificationRows[0] ?? { eligible: 0, complete: 0 };

  const artifactEvidence = await relevantDarkArtifactEvidence(
    id,
    newsroomId,
    {
      title: inv[0].title,
      paste: "",
      frontier: front.flatMap((item) => [item.label, item.why]),
    },
    10_000,
  );
  return briefPack({
    title: inv[0].title,
    verification,
    /*
      FB7, item 5 (A2c X3). Deduped BEFORE the model sees it, not only before
      the editor does. Five identical WHAT WE KNOW lines in the pack are part
      of why the brief kept re-asking for a record the file already held: the
      model was shown the same sentence five times and read it as five
      confirmations of something half-established. One line, once.
    */
    facts: dedupeFactLines(
      claims
        .filter((c) => /FACT|OBSERVATION/i.test(c.kind))
        .map((c) => ({ body: c.body, evidence: c.evidence ?? "" })),
    ),
    hypotheses: hyps.map((h) => h.body),
    questions: front.map((f) => `${f.label}${f.why ? ` — ${f.why}` : ""}`),
    findings: anoms.map((a) => `${a.kind}: ${a.summary}`),
    entities: ents,
    artifacts: artifactEvidence.artifacts,
  });
}

/**
 * Unit DD1, item 1: the editor brief, held to the grounding rule.
 *
 * The brief is the last model-written prose in the file and the first thing an
 * editor reads -- "WHAT WOULD SETTLE IT", "DO THIS NEXT", the hypothesis on the
 * line under the percentage. A specific that is nowhere in the file wears the
 * marker rather than being handed to an editor as the next place to go.
 * Measured on the Kid City USA file: the brief's "DO THIS NEXT" sent the editor
 * to a street address no capture in the file carried.
 *
 * `corpus` is the FILE, not the prompt it was written from. That distinction is
 * M6 of the pre-merge audit: handed the pack, the brief could find a specific
 * in the pack's own "NAMES AND THINGS SEEN" -- a list of model-written
 * `entities` rows -- and ground itself on the model's earlier guess. A caller
 * that has only a string (the tests, and any future one) still gets the old
 * behaviour; `buildBrief` passes the captures.
 *
 * Every string field of the brief, and nothing else: the numbers and the
 * closed vocabularies (`verdict`, `evidence_status`) are not prose and cannot
 * carry an invented specific.
 */
export function groundBrief(brief: InvestigationBrief, corpus: GroundingCorpus): InvestigationBrief {
  const prepared = typeof corpus === "string" ? prepareCorpus(corpus) : corpus;
  const text = (value: string) => markUngroundedSpecifics(value, prepared);
  const list = (values: string[]) => values.map(text);
  const captureText = new Map(
    (typeof corpus === "string" ? [] : (corpus.captures ?? [])).map((capture) => [
      capture.captureEventId,
      capture.text,
    ]),
  );
  const contradictions = brief.contradictions.filter((pair) => {
    const first = captureText.get(pair.first.captureId);
    const second = captureText.get(pair.second.captureId);
    return Boolean(
      pair.first.captureId > 0 &&
      pair.second.captureId > 0 &&
      first && second &&
      evidenceAppearsInText(pair.first.text, first) &&
      evidenceAppearsInText(pair.second.text, second),
    );
  });
  return {
    ...brief,
    headline: text(brief.headline),
    tldr: text(brief.tldr),
    why_verdict: text(brief.why_verdict),
    hypothesis: text(brief.hypothesis),
    supports: list(brief.supports),
    contradictions,
    benign: text(brief.benign),
    kills_it: text(brief.kills_it),
    /*
      FB7, item 5 (A2c X3): "its DO THIS NEXT asks for the licensing record the
      round had already captured". The grounding pass above marks what the file
      does NOT carry; this marks the opposite case, where every record the step
      names is already among the captures. Same convention -- marked in place,
      so the editor reads the ask and its answer together.
    */
    next: markAlreadyOnFile(text(brief.next), prepared),
    connections: list(brief.connections),
    sections: {
      record: text(brief.sections.record),
      tested: text(brief.sections.tested),
      open: text(brief.sections.open),
      known: text(brief.sections.known),
    },
  };
}

export async function buildBrief(
  userId: string,
  newsroomId: number,
  id: number,
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
  chat: typeof grokChat = grokChat,
  run?: {
    budget: DarkRunBudget;
    onUsage?: (usage: DarkRunUsageSnapshot) => Promise<unknown>;
    onStage?: (stage: string) => Promise<unknown>;
  },
  reasoningEffort?: ModelEffort | null,
) {
  const sql = await getSql();
  const pack = await buildDarkBriefPromptPack(newsroomId, id);
  if (!pack) return { ok: false as const, error: "not found" };
  const verificationRows = await sql<{ eligible: number; complete: number }>`
    select count(*)::int as eligible,
           count(*) filter (where verification_status = 'verified')::int as complete
    from dark_signals
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
  `.catch(() => [{ eligible: 0, complete: 0 }]);
  const verification = verificationRows[0] ?? { eligible: 0, complete: 0 };
  const evidenceStatus =
    verification.eligible > 0 && verification.complete === verification.eligible
      ? "protocol-complete" as const
      : "unverified" as const;

  await run?.onStage?.("Writing editor brief");
  const modelCall = run?.budget.startModelCall({
    stage: "writing editor brief",
    provider: choice ?? "automatic",
    model: choice ?? "provider-default",
  });
  if (run?.budget && !modelCall) {
    await run.onUsage?.(run.budget.snapshot());
    return { ok: false as const, error: `run stopped: ${run.budget.stopReason ?? "model-call-limit"}` };
  }
  if (modelCall) await run?.onUsage?.(run.budget.snapshot());
  const callMs = providerBudget(choice, overrides).callMs;
  let ai: Awaited<ReturnType<typeof chat>>;
  try {
    ai = await chat(BRIEF_SYSTEM, pack, 1200, {
      timeoutMs: Math.max(1, Math.min(callMs, run?.budget.remainingMs() ?? callMs)),
      choice,
      newsroomId,
      localModel: overrides?.["local-model"]?.localModel,
      // Dark Desk F1: the brief reads the file already assembled above and
      // returns JSON only — it never fetches or searches itself.
      noTools: true,
      reasoningEffort,
    });
  } catch (err) {
    modelCall?.finish({
      result: "error",
      timedOut: /timed out|timeout/i.test(asDarkError(err)),
    });
    if (modelCall) await run?.onUsage?.(run.budget.snapshot());
    throw err;
  }
  if (modelCall) {
    const meta = "meta" in ai ? ai.meta : undefined;
    modelCall.finish({
      result: ai.ok ? "ok" : (/timed out|timeout/i.test(ai.error) ? "timeout" : "error"),
      timedOut: meta?.timedOut ?? (!ai.ok && /timed out|timeout/i.test(ai.error)),
      provider: meta?.provider,
      model: meta?.model,
      durationMs: meta?.durationMs,
      inputTokens: meta?.inputTokens,
      outputTokens: meta?.outputTokens,
      totalTokens: meta?.totalTokens,
    });
    await run?.onUsage?.(run.budget.snapshot());
  }
  if (!ai?.ok) return { ok: false as const, error: "error" in ai ? ai.error : "no response" };

  /*
    M6 of the pre-merge audit: the corpus the brief is judged against is the
    FILE, not the prompt.

    `groundBrief` used to be handed `pack` -- the same string the model was
    given -- and that pack's "NAMES AND THINGS SEEN" section is a list of
    `entities` rows, written by the model and deliberately unmarked (an entity
    name is the key the resolver merges on). So a brief could say "1749 Main
    Street" and find it in the pack, one section above, and ground itself on its
    own earlier guess. The captures are what the desk holds; the title is the
    lead. Everything else in the pack is the model talking to itself.

    A failed read falls back to the paper's own place and nothing else, and
    never to the pack. A narrower corpus marks more, never less, and
    over-marking is the honest error here.
  */
  const settings = await getPaperConfig(newsroomId).catch(() => null);
  const briefPlace = {
    city: settings?.city ?? null,
    state: settings?.state ?? null,
    county: null as string | null,
  };
  const briefCorpus = await groundingCorpus(id, newsroomId, briefPlace).catch(() =>
    prepareCorpus("", placeCorpus(briefPlace)),
  );
  const brief = groundBrief(
    parseBrief(parseJsonBlock<unknown>(ai.text), new Date(), evidenceStatus),
    briefCorpus,
  );
  if (!briefIsUseful(brief)) return { ok: false as const, error: "brief was empty" };


  await sql`
    insert into investigation_briefs (investigation_id, newsroom_id, brief_json, generated_at)
    values (${id}, ${newsroomId}, ${JSON.stringify(brief)}, now())
    on conflict (investigation_id) do update
      set brief_json = excluded.brief_json, generated_at = now()
  `;
  return { ok: true as const, brief };
}

/**
 * The queued half of "write the brief". Same commit boundary as a round:
 * probe the chosen model first, so a signed-out provider refuses before a
 * job row or a rate entry exists.
 */
export async function startBriefJob(
  context: { userId: string; newsroomId?: number },
  id: number,
  modelChoice: string = "auto",
  effortValue?: unknown,
) {
  const asked = storyModelChoice(modelChoice);
  const probe = await probeDarkProvider(asked, owned(context));
  const refusal = await darkPreflightRefusal(asked, owned(context), probe);
  if (refusal) return refusal;
  await ensureDarkSchema();
  const effectiveChoice = probe.ok ? probe.choice : asked;
  const modelEffort = validatedModelEffort(effectiveChoice, effortValue);

  const open = await findOpenJob({ newsroomId: owned(context), kind: "brief", subjectId: id });
  if (open) {
    const persisted = effectiveStoryModelChoice(open.model_choice);
    const persistedEffort = savedJobEffort(open);
    if (persisted !== effectiveChoice || persistedEffort !== modelEffort) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `A brief is already being written with ${modelChoiceLabel(persisted)}${persistedEffort ? ` at ${persistedEffort} effort` : ""}. Wait for it to finish before choosing another model or effort.`,
        modelChoice: persisted,
        jobId: open.id,
      };
    }
    return { ok: true as const, pending: true as const, jobId: open.id, modelChoice: persisted };
  }

  await assertRate(context.userId, "brief", owned(context));
  const job = await enqueueJob({
    userId: context.userId,
    newsroomId: owned(context),
    kind: "brief",
    subjectId: id,
    modelChoice: effectiveChoice,
    modelChoiceSource: asked === "auto" ? "auto" : "editor",
    resultJson: JSON.stringify(initialModelRuntimeReceipt({
      requestedRuntime: asked,
      requestedEffort: validatedModelEffort(asked, effortValue),
      actualRuntime: effectiveChoice,
      actualEffort: modelEffort,
      localModel: probe.ok ? probe.localModel : undefined,
      preflightFailover: "switchReceipt" in probe ? probe.switchReceipt : null,
      /*
        A rung the desk passed over on the way to the one that answered
        (0.6.63, Unit Y item 2). Omitted when empty -- see
        `initialModelRuntimeReceipt` -- so every receipt that has nothing to
        report reads exactly as it did before.
      */
      skippedRungs: probe.skippedRungs,
    })),
  });
  if ("switchReceipt" in probe) {
    await setJobStage(job.id, probe.switchReceipt.stage);
    await setJobFailoverNote(job.id, probe.switchReceipt.note);
  }
  return {
    ok: true as const,
    pending: true as const,
    jobId: job.id,
    modelChoice: effectiveStoryModelChoice(job.model_choice),
  };
}

/** What the queue runs for a `brief` job. */
export async function performBriefWork(job: DeskJob) {
  const newsroomId = job.newsroom_id;
  const overrides = applyJobLocalModelSnapshot(
    job,
    await readProviderOverrides(newsroomId, "dark").catch(() => ({})),
  );
  /*
    FB1: the brief's two arrivals, and the reason its bar is determinate at all.

    A brief has no countable work inside it -- it assembles a pack out of the
    file's own rows and then makes ONE model call with no denominator. What it
    does have is two stages, so 0% until the call starts and 50% while it runs
    is the honest reading: the editor sees the bar move from "reading" to
    "writing" instead of a segment sliding back and forth. The completion writes
    100 (the card fills on Done regardless of the stored number).
  */
  const report = progressReporterFor(job);
  await report("Reading the file", pctFor(0, 2));
  let active = {
    modelChoice: effectiveStoryModelChoice(job.model_choice),
    modelEffort: savedJobEffort(job),
  };
  // Tracks the rung the brief is actually on, for the same reason the scan
  // batch does: `active` is only reassigned once the failed call returns, so a
  // ticker reading it would name the model that already failed.
  let briefLabel = modelChoiceLabel(active.modelChoice);
  const callWithFallback: typeof grokChat = async (system, user, maxTokens, options) => {
    const attempted = await runPinnedCallWithFailover({
      snapshot: active,
      source: job.model_choice_source ?? "editor",
      ladder: DARK_AUTOMATIC_LADDER,
      run: (snapshot) => grokChat(system, user, maxTokens, {
        ...options,
        choice: snapshot.modelChoice,
        reasoningEffort: snapshot.modelEffort,
      }),
      probe: (choice) => probeProvider(choice, newsroomId, undefined, "dark"),
      resolve: async (choice) => ({
        modelChoice: choice,
        modelEffort: effortForChoice(choice, active.modelEffort),
      }),
      onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
        const resolvedChoice = effectiveStoryModelChoice(nextChoice);
        const nextEffort = effortForChoice(resolvedChoice, active.modelEffort);
        briefLabel = nextLabel;
        await setJobModelRuntime(job.id, resolvedChoice, nextEffort);
        await setJobStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
        await setJobFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
      },
    });
    active = attempted.snapshot;
    return attempted.result;
  };
  /*
    B8B item 2: the brief's own boundary check.

    `waitForModel` below polls Cancel while the brief is being built, but
    nothing read it on the way in: a brief the editor had already stopped still
    assembled its whole pack and opened its model call before the first tick
    (twelve seconds later) could notice. The check is before the stage line, so
    a cancelled brief never moves the bar either.
  */
  await throwIfJobCancelled(job.id);
  await report("Writing editor brief", pctFor(1, 2));
  const result = await waitForModel({
    jobId: job.id,
    label: () => briefLabel,
    // The whole brief is the wait: `buildBrief` fans out over its own calls and
    // has no single await to wrap, and a ticker per inner call would report the
    // same job four times over.
    run: () =>
      buildBrief(
        job.user_id,
        newsroomId,
        job.subject_id,
        active.modelChoice,
        overrides,
        callWithFallback,
        undefined,
        active.modelEffort,
      ),
  });
  /*
    A brief that could not be written is a real failure of a job the editor
    started and is watching, so it is thrown rather than swallowed. That is
    the opposite of the best-effort call inside `performDarkRound`, where the
    round's four lists are the content and a missing summary must never fail
    a round that dug successfully.
  */
  if (!result.ok) throw new Error(result.error);
}

export const refreshBrief = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => darkStepInput.parse(input))
  .handler(async ({ context, data }) =>
    typeof data === "number"
      ? startBriefJob(context, data)
      : startBriefJob(context, data.id, data.modelChoice, data.modelEffort),
  );
