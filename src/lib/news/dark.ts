import { subredditFromSources } from "./dark-place.ts";
import { describeResearchWindow, validateResearchPreferences, type ResearchPreferences, type ResearchSnapshot } from './dark-preferences.ts';
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import {
  grokChat,
  parseJsonBlock,
  providerBudget,
  probeProvider,
  type EffectiveProviderChoice,
} from "./ai.ts";
import { effectiveStoryModelChoice, modelChoiceLabel, storyModelChoice } from "./model-choice.ts";
import { planAutomaticFailover, failoverReasonPhrase } from "./automatic-failover.ts";
import { readProviderOverrides } from "./provider-settings.ts";
import type { ProviderOverrides } from "./provider-registry.ts";
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
  matchDeadEnds,
  researchLoop,
  resurfaceDeadEnds,
  runDueMonitors,
} from "./investigate.ts";
import { readableCapture } from "./html-text.ts";
import { chunksFromEvidence } from "./ingest.ts";
import { queryTokens } from "./retrieve.ts";
import { sanitizePublicUrls } from "./schema.ts";
import type { ArticleRow, MemoryRow, SourceRow } from "./types.ts";
import { rankWorthItems, presentWorthItems, type WorthSeed } from "./worth-a-look.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { titlesOverlap, topicFromText } from "./desk-copy.ts";
import { officialDomains, pressDomains as pressDomainsOf } from "./absence-gate.ts";
import { getPaperConfig } from "./paper-settings.ts";
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
  type DarkDials,
} from "./dark-dials.ts";
import {
  enqueueJob,
  findOpenJob,
  latestJob,
  runLooksStalled,
  setJobModelChoice,
  setJobStage,
  type DeskJob,
} from "./jobs.ts";

const DARK_SYNTHESIS_PACK_CAP = 28_000;
const DARK_SYNTHESIS_CONTEXT_CAP = 14_000;
const DARK_ARTIFACT_CAP = 12_000;
const DARK_ARTIFACT_COUNT = 8;
const SECTION_BUDGET_MARKER = "\n[section budget reached]";

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
async function darkPreflightRefusal(choice?: string): Promise<{
  ok: false;
  kind: string;
  error: string;
  detail: string;
  retryable: boolean;
} | null> {
  const { scanPreflight } = await import("./preflight.ts");
  const ready = scanPreflight(await probeProvider(choice), choice);
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
};

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
  status: string;
  summary: string;
  hops: number;
  budget: number;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
  records?: number;
  still_open?: number;
  /**
   * The model that last dug this file (0.6.2). Null on every investigation
   * opened before Dark Desk had a picker; the page falls back to Automatic.
   */
  last_model_choice?: string | null;
};

const HANDOFFS = new Set([
  "DISCARD",
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

/**
 * Dark Desk F3: the same tool-refusal/sandbox-escape narration filtered out
 * of claims/frontier/anomalies/dead_ends (investigate.ts's `parsePlan`) can
 * land here too — this is the dig's OTHER JSON-returning call. Checked
 * across every free-text field a refusal could hide in, not just
 * `observation`. Exported for tests only.
 */
export function isPoisonedSignal(sig: DarkSignal): boolean {
  const text = [
    sig.name,
    sig.observation,
    sig.pattern,
    sig.linkage_map,
    sig.alternatives,
    sig.counter_narrative,
    sig.what_would_kill,
    sig.pathway,
  ]
    .map((v) => String(v ?? ""))
    .join(" ");
  return isSelfReferential(text);
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
    return sql<DarkRunRow>`
      select id, started_at, finished_at, summary, error, model_choice
      from dark_runs
      where newsroom_id = ${owned(context)}
      order by started_at desc
      limit 12
    `;
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

export const listInvestigations = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const rows = await sql<InvestigationRow>`
      select i.id, i.title, i.status, i.summary, i.hops, i.budget, i.pause_reason,
        i.created_at, i.updated_at,
        coalesce((
          select count(*)::int from artifacts a
          where a.investigation_id = i.id
        ), 0) as records,
        coalesce((
          select count(*)::int from frontier_items f
          where f.investigation_id = i.id
            and f.status in ('open', 'investigating', 'reopened')
        ), 0) as still_open
      from investigations i
      where i.newsroom_id = ${owned(context)}
      order by i.updated_at desc
      limit 40
    `;
    return rows.map((r) => ({
      ...r,
      records: Number(r.records ?? 0),
      still_open: Number(r.still_open ?? 0),
    }));
  });

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
  }>`
    select label, kind, why, status, closed_reason from frontier_items
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
    rankWorthItems({ anomalies, monitors, leads, frontier, signals, promises }),
  );
}

export const listWorthALook = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    return gatherWorthALook(owned(context));
  });

export const getInvestigation = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const inv = await sql<InvestigationRow>`
      select id, title, status, summary, hops, budget, pause_reason, created_at, updated_at,
             last_model_choice
      from investigations where id = ${id} and newsroom_id = ${owned(context)} limit 1
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
        created_at, left(full_text, 2500) as excerpt, extraction_method
      from artifacts
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 60
    `;
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

    return {
      investigation: inv[0],
      stalled,
      briefJob: brief_job
        ? { id: brief_job.id, status: brief_job.status, error: brief_job.error }
        : null,
      brief,
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

export const getArtifact = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
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
    }>`
      select id, url, title, left(full_text, 120000) as full_text, fetch_outcome, fetch_status, created_at
      from artifacts
      where id = ${id} and newsroom_id = ${owned(context)}
      limit 1
    `;
    return rows[0] ?? null;
  });

export async function buildDarkSynthesisPack(
  investigationId: number,
  paste: string,
  newsroomId: number,
  packCap: number = DARK_SYNTHESIS_PACK_CAP,
): Promise<string> {
  const sql = await getSql();
  const investigation = await sql<{ title: string }>`
    select title from investigations
    where id = ${investigationId} and newsroom_id = ${newsroomId}
    limit 1
  `;
  const sources = await sql<SourceRow>`
    select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
    from sources where newsroom_id = ${newsroomId} order by id asc
  `;
  const frontier = await sql<{ label: string; kind: string; why: string }>`
    select label, kind, why from frontier_items
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} and status in ('open', 'investigating', 'reopened')
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

async function synthesizeSignals(
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
  const ai = await grokChat(darkSystemFor(dials, place), pack, 3200, {
    timeoutMs: providerBudget(choice, overrides).callMs,
    choice,
    localModel: overrides?.["local-model"]?.localModel,
    // Dark Desk F1: synthesis reads the pack already assembled above and
    // returns JSON only — it never fetches or searches itself.
    noTools: true,
  });
  if (!ai?.ok)
    return {
      stored: 0,
      summary: "",
      error: (ai && "error" in ai ? ai.error : "Empty model response") as string | undefined,
    };

  const parsed = parseJsonBlock<DarkJson>(ai.text) ?? {};
  const summary = String(parsed.editor_summary ?? "").slice(0, 2000);
  const gaps = (parsed.inventory_gaps ?? []).join("; ").slice(0, 800);
  const header = [
    summary,
    gaps ? `Gaps: ${gaps}` : "",
    parsed.window ? `Window: ${parsed.window}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let stored = 0;
  for (const sig of parsed.signals ?? []) {
    const name = String(sig.name ?? "").trim();
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
    if (!HANDOFFS.has(handoff)) handoff = "HOLD FOR PATTERN";
    await sql`
      insert into dark_signals (
        user_id, newsroom_id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, stage, verification_status, gates_missing
      ) values (
        ${userId}, ${newsroomId}, ${runId}, ${investigationId}, ${name.slice(0, 200)},
        ${normalizePosture(sig.posture)},
        ${String(sig.type ?? "").slice(0, 80)},
        ${strength}, ${confidence},
        ${String(sig.observation ?? "").slice(0, 4000)},
        ${String(sig.pattern ?? "").slice(0, 4000)},
        ${String(sig.linkage_map ?? "").slice(0, 4000)},
        ${String(sig.alternatives ?? "").slice(0, 4000)},
        ${String(sig.counter_narrative ?? "").slice(0, 4000)},
        ${String(sig.what_would_kill ?? "").slice(0, 2000)},
        ${String(sig.pathway ?? "").slice(0, 2000)},
        ${String(sig.privacy_review ?? "").slice(0, 500)},
        ${handoff},
        ${"black-desk"},
        ${"unverified"},
        ${GATE_KEYS.map((k) => GATE_WORDS[k]).join("; ")}
      )
    `;
    stored += 1;
  }

  for (const p of parsed.promises ?? []) {
    const who = String(p.who ?? "").trim();
    const what = String(p.what ?? "").trim();
    if (!who || !what) continue;
    await sql`
      insert into dark_promises (user_id, newsroom_id, who_promised, what, when_due, source_cite, status)
      values (
        ${userId}, ${newsroomId}, ${who.slice(0, 200)}, ${what.slice(0, 800)},
        ${String(p.when_due ?? "").slice(0, 120) || null},
        ${String(p.source_cite ?? "").slice(0, 400) || null},
        ${String(p.status ?? "open").slice(0, 40)}
      )
    `;
  }

  return { stored, summary: header, error: undefined as string | undefined };
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
  const city = cfg?.city || "Longmont";
  const official = officialDomains(
    city,
    srcs.map((s) => s.url),
    srcs.filter((s) => (s.tier ?? "").toUpperCase() === "A").map((s) => s.url),
  );
  const press = pressDomainsOf(srcs);
  return {
    place: {
      city,
      state: cfg?.state || "Colorado",
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
): Promise<string> {
  try {
    const { place, official, press } = await readDarkPlace(newsroomId);
    const out = await verifyRunSignals({
      userId,
      newsroomId,
      runId,
      investigationId,
      place,
      officialDomains: official,
      pressDomains: press,
      choice,
      overrides,
      preferences,
    });
    return out.summary;
  } catch (err) {
    return `Verification could not run this round (${
      err instanceof Error ? err.message : "unknown"
    }). Every signal from this round stays unverified.`;
  }
}

function asDarkError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err)
    return String((err as { error: unknown }).error);
  return err instanceof Error ? err.message : "Dark desk failed";
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
  },
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const sql = await getSql();
  const choice = opts.choice;
  const overrides = await readProviderOverrides(newsroomId).catch(() => ({}));
  const runRows = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id, model_choice)
    values (${userId}, ${newsroomId}, ${choice ?? null}) returning id
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

  try {
    const snapshot = await snapshotDarkSettingsFor(newsroomId, runId);
    await checkBaselines(userId, investigationId, new Date(), newsroomId);
    await runDueMonitors({ userId, newsroomId });

    // Same setting as a continued round: an editor who turned the desk up
    // expects the file they open next to dig that hard too.
    const dials = snapshot.dials;
    const budget = budgetFor(dials);
    // Location scoping and domain tiers come from the paper's own settings,
    // so the loop's searches name this town and the run record can say which
    // tier answered.
    const where = await readDarkPlace(newsroomId).catch(() => null);
    const loop = await researchLoop({
      userId,
      investigationId,
      hops: budget.hops,
      choice,
      providerOverrides: overrides,
      newsroomId,
      place: where?.place,
      officialDomains: where?.official,
      pressDomains: where?.press,
      preferences: snapshot.preferences,
    });

    const synth = await synthesizeSignals(
      userId,
      runId,
      investigationId,
      paste,
      dials,
      choice,
      overrides,
      newsroomId,
      snapshot.preferences,
    );
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
      choice,
      overrides,
      snapshot.preferences,
    );
    await rememberLastModelChoice(investigationId, choice);
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
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null}
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
  .validator((input: { paste: string; investigationId?: number; modelChoice?: string }) => input)
  .handler(async ({ context, data }) => {
    /*
      The editor's pick decides which provider is probed, and an unresolvable
      one refuses BEFORE any spend -- the same commit boundary Story and Scan
      have. `storyModelChoice` narrows anything else to Automatic rather than
      trusting a string off the wire.
    */
    const asked = storyModelChoice(data.modelChoice);
    const probe = await probeProvider(asked);
    const refusal = await darkPreflightRefusal(asked);
    if (refusal) return refusal;
    await ensureDarkSchema();
    await assertRate(context.userId, "dark", owned(context));
    return executeDarkRun(
      context.userId,
      {
        paste: data.paste,
        investigationId: data.investigationId,
        choice: probe.ok ? probe.choice : asked,
      },
      owned(context),
    );
  });

export const openDarkInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { paste: string; title?: string }) => input)
  .handler(async ({ context, data }) => {
    try {
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
) {
  const asked = storyModelChoice(modelChoice);
  /*
    Probe the model the editor picked BEFORE anything is written or spent,
    exactly as `commitStoryDraftForAuthenticatedEditor` does. Automatic
    resolves to a concrete provider here, and that concrete provider is what
    gets pinned on the job -- so a round does not silently change author
    between the press and the queue picking it up.
  */
  const probe = await probeProvider(asked);
  const refusal = await darkPreflightRefusal(asked);
  if (refusal) return refusal;
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<{ id: number }>`
    select id from investigations where id = ${id} and newsroom_id = ${owned(context)} limit 1
  `;
  if (!inv[0]) return { ok: false as const, error: "Investigation not found" };

  const effectiveChoice = probe.ok ? probe.choice : asked;

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
    if (persisted !== effectiveChoice) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `This file is already digging with ${modelChoiceLabel(persisted)}. Watch that round finish before choosing another model.`,
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
  });
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
  .validator((input: number | { id: number; modelChoice?: string }) => input)
  .handler(async ({ context, data }) =>
    typeof data === "number"
      ? startDarkRound(context, data)
      : startDarkRound(context, data.id, data.modelChoice),
  );

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
 * recognised failure, or no ready later rung) -- the caller keeps `loop`/
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
  });
  if (!plan) return null;

  const previous = modelChoiceLabel(job.model_choice);
  await setModelChoice(job.id, plan.next);
  const switchedBecause = failoverReasonPhrase(previous, plan.reason);
  await setStage(job.id, `Switched to ${plan.label}: ${switchedBecause}`);
  return { next: plan.next, label: plan.label, switchedBecause };
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
  const overrides = await readProviderOverrides(owned(context)).catch(() => ({}));
  const runRows = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id, model_choice)
    values (${context.userId}, ${owned(context)}, ${choice}) returning id
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
    const dials = snapshot.dials;
    const budget = budgetFor(dials);
    const where = await readDarkPlace(owned(context)).catch(() => null);
    const runOnce = async (on: EffectiveProviderChoice) => {
      const ran = await researchLoop({
        userId: context.userId,
        investigationId: id,
        hops: budget.hops,
        choice: on,
        providerOverrides: overrides,
        newsroomId: owned(context),
        place: where?.place,
        officialDomains: where?.official,
        pressDomains: where?.press,
      preferences: snapshot.preferences,
      });
      const signals = await synthesizeSignals(
        context.userId,
        runId,
        id,
        "",
        dials,
        on,
        overrides,
        owned(context),
        snapshot.preferences,
      );
      return { loop: ran, synth: signals };
    };

    let { loop, synth } = await runOnce(choice);

    /*
      One-shot Automatic failover, at the ROUND level.

      Story and Scan both do this (see automatic-failover.ts and
      scan-model-run.ts) and Dark Desk did not, because until 0.6.2 it had no
      pinned model to fail over FROM. The trigger is deliberately narrow: only
      a job Automatic chose for, only an error that reads as a lapsed login OR
      a timeout/no-output, only a rung strictly later in the ladder, and only
      once. A refusal or an empty-but-not-zero-byte answer is a real result
      and must not be papered over with a second provider's opinion.

      A hop's own planner failure surfaces in `loop.summary` ("Planner fell
      back on 1 of 4 hops: ...") rather than as a thrown error, because the
      loop keeps digging with the keyword heuristic when the model will not
      answer. That text is checked too, so a round whose every hop was planned
      by a signed-out provider is not recorded as a successful dig.
    */
    const failure = synth.error || (loop.plannerFailures > 0 ? loop.summary : "");
    if (failure) {
      const switched = await planDarkRoundFailover(job, failure);
      if (switched) {
        choice = switched.next;
        ({ loop, synth } = await runOnce(choice));
      }
    }
    // Stage 2, on the "Keep digging" path too.
    const verifySummary = await runVerificationStage(
      context.userId,
      owned(context),
      runId,
      id,
      choice,
      overrides,
      snapshot.preferences,
    );
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
    await sql`
      update dark_runs
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null},
          model_choice = ${choice}
      where id = ${runId} and newsroom_id = ${owned(context)}
    `;
    await audit(
      context.userId,
      "dark-continue",
      `run ${runId} inv ${id} hops ${loop.hops} signals ${synth.stored}`,
      owned(context),
    );
    /*
      Write the brief while the round is still warm.

      Not on page load: it is a model call, and an editor refreshing a file
      should not pay for one. Failure is deliberately swallowed — the four
      lists are the real content and a missing summary must never fail a round
      that otherwise dug successfully.
    */
    try {
      await buildBrief(context.userId, owned(context), id, choice, overrides);
    } catch {
      /* the file is still readable without it */
    }

    if (synth.error && !loop.paused) await markInvestigationPaused(context.userId, id, synth.error);
  } catch (err) {
    const error = asDarkError(err);
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
 * Send ONE signal to the working queue as a story lead.
 *
 * Two gates stand in front of this, both from the operator's originals, and
 * both answerable in words on screen:
 *
 * 1. The four adversarial gates. "A signal moves from open collection to
 *    closed escalation ONLY after all 4 gates of the Adversarial
 *    Verification Protocol are completed with documented results."
 *    An editor may still push an unverified signal through — deliberately,
 *    with `asTip` — and the lead then says so in its own notes.
 * 2. The newsworthiness gate. A no to all three questions (does anyone's
 *    life change, is it new, is there a record) keeps it in the file as a
 *    watch item rather than a lead.
 *
 * Plain function so both gates can be proved without deskMiddleware, the same
 * pattern `queueInvestigationFor` already uses in this file.
 */
export async function sendDarkSignalToQueueFor(
  userId: string,
  newsroomId: number,
  id: number,
  opts: { asTip?: boolean } = {},
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
  if (!verified && !opts.asTip) {
    return {
      ok: false as const,
      blocked: "unverified" as const,
      error: `${words.sentence} Tick "send unverified, as a tip" if you want it on the queue anyway.`,
    };
  }

  let news: ReturnType<typeof readNewsworthiness> = null;
  try {
    news = sig.newsworthiness_json ? readNewsworthiness(JSON.parse(sig.newsworthiness_json)) : null;
  } catch {
    news = null;
  }
  if (verified && !opts.asTip && sig.newsworthiness_decision === "watch") {
    return {
      ok: false as const,
      blocked: "watch" as const,
      error: `Kept in the file as a watch item, not a lead. ${newsworthinessWords(news)} Nobody's life changes, it is not new, and there is no record to point at — send it as a tip if you disagree.`,
    };
  }

  const arts = sig.investigation_id
    ? await sql<{ url: string }>`
        select url from artifacts
        where newsroom_id = ${newsroomId} and investigation_id = ${sig.investigation_id}
        order by id desc limit 12
      `
    : await sql<{ url: string }>`
        select url from artifacts
        where newsroom_id = ${newsroomId}
        order by id desc limit 12
      `;
  const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
  const why = [
    `DARK DESK investigation notes. Claim kinds in the evidence. Publication is a separate human action.`,
    `Posture: ${sig.posture}. Type: ${sig.signal_type}. Strength ${sig.strength} / confidence ${sig.confidence}.`,
    `Stage: ${words.chip}. ${words.sentence}`,
    `Newsworthiness gate: ${newsworthinessWords(news)}`,
    verified ? "" : "Sent unverified, at the editor's direction. Treat it as a tip, not a finding.",
    `Opposing account: ${(sig.counter_narrative || "Not established.").slice(0, 800)}`,
    `Missing context: ${(sig.gate_missing_context || "Not assessed.").slice(0, 800)}`,
    sig.observation,
    `Linkage: ${sig.linkage_map}`,
    `Alternatives: ${sig.alternatives}`,
    `Pathway: ${sig.pathway}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
  const created = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
    values (
      ${userId},
      ${newsroomId},
      ${sig.name.slice(0, 240)},
      ${why},
      'council',
      'new',
      ${urls},
      ${sig.observation.slice(0, 4000)},
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
  .validator((input: number | { id: number; asTip?: boolean }) =>
    typeof input === "number" ? { id: input } : input,
  )
  .handler(async ({ context, data }) =>
    sendDarkSignalToQueueFor(context.userId, owned(context), data.id, {
      asTip: data.asTip === true,
    }),
  );

/**
 * Create-or-find the story lead for an investigation.
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
  opts: { asTip?: boolean } = {},
) {
  await ensureDarkSchema();
  const sql = await getSql();
  const inv = await sql<InvestigationRow>`
    select id, title, status, summary, hops, budget, pause_reason, created_at, updated_at,
           last_model_choice
    from investigations where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  if (!inv[0]) return { ok: false as const, error: "Investigation not found" };
  /*
    The verification gate, at the file level.

    A file that has filed signals may not become a story lead while every one
    of those signals is still speculative -- that is the escalation boundary
    the original draws ("A signal moves from open collection to closed
    escalation ONLY after all 4 gates ... are completed with documented
    results"). A file with NO signals is untouched by this: there is nothing
    to verify, so there is nothing to gate, and the editor's own reading of
    the captured records is the lead.
  */
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
  if (total > 0 && verifiedCount === 0 && !opts.asTip) {
    return {
      ok: false as const,
      blocked: "unverified" as const,
      error:
        total === 1
          ? 'The one signal on this file has not passed the four gates yet — the desk has not shown that it tried to disprove it. Tick "send unverified, as a tip" to put it on the queue anyway.'
          : `None of the ${total} signals on this file have passed the four gates yet — the desk has not shown that it tried to disprove them. Tick "send unverified, as a tip" to put the file on the queue anyway.`,
    };
  }
  const already = await sql<{ id: number }>`
    select id from leads
    where investigation_id = ${id} and newsroom_id = ${newsroomId}
    order by id asc limit 1
  `;
  if (already[0]) {
    await audit(userId, "dark-handoff", `inv ${id} existing lead ${already[0].id}`, newsroomId);
    return { ok: true as const, leadId: already[0].id, alreadyQueued: true as const };
  }
  const arts = await sql<{ url: string }>`
    select url from artifacts
    where newsroom_id = ${newsroomId} and investigation_id = ${id}
    order by id desc limit 12
  `;
  const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
  const topic = topicFromText(`${inv[0].title}\n${inv[0].summary}`);
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
  const handoff = [
    "DARK DESK notes. Publication is a separate human action.",
    opts.asTip
      ? "Sent unverified, at the editor's direction. Treat it as a tip, not a finding."
      : `${verifiedCount} of ${total} filed signals passed verification; other signals remain unverified.`,
    signalNotes.length
      ? `Signal notes: showing ${signalNotes.length} of ${total}. Open investigation for the complete file and unabridged accounts.`
      : "",
    ...signalNotes.map((signal) =>
      [
        `${shorten(signal.name, 80)} — ${signal.verification_status === "verified" ? "verified" : "unverified"}`,
        `Opposing account: ${shorten(signal.counter_narrative || "Not established.", 320)}`,
        `Missing context: ${shorten(signal.gate_missing_context || "Not assessed.", 320)}`,
        `What would disprove it: ${shorten(signal.what_would_kill || "Not established.", 160)}`,
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  const evidence = `${handoff}\n\nFile summary: ${shorten(inv[0].summary, Math.max(0, 4000 - handoff.length - 16))}`;
  const created = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
    values (
      ${userId},
      ${newsroomId},
      ${inv[0].title.slice(0, 240)},
      ${evidence},
      ${topic},
      'new',
      ${urls},
      ${evidence},
      ${12},
      ${id}
    )
    returning id
  `;
  await audit(userId, "dark-handoff", `inv ${id} lead ${created[0]!.id}`, newsroomId);
  return { ok: true as const, leadId: created[0]!.id, alreadyQueued: false as const };
}

export const queueInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: number | { id: number; asTip?: boolean }) =>
    typeof input === "number" ? { id: input } : input,
  )
  .handler(async ({ context, data }) =>
    queueInvestigationFor(context.userId, owned(context), data.id, {
      asTip: data.asTip === true,
    }),
  );

export const parkInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    await sql`
      update investigations
      set status = ${"closed"},
          pause_reason = ${"Editor set this aside."},
          updated_at = now()
      where id = ${id} and newsroom_id = ${owned(context)}
    `;
    await audit(context.userId, "dark", `set aside inv ${id}`, owned(context));
    return { ok: true as const, investigationId: id };
  });

export const reopenParkedInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const leftover = await sql<{ c: number }>`
      select count(*)::int as c from frontier_items
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
        and status in ('open', 'investigating', 'reopened')
    `;
    const still = Number(leftover[0]?.c ?? 0);
    await sql`
      update investigations
      set status = ${still > 0 ? "paused" : "open"},
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
    await ensureDarkSchema();
    await assertRate(context.userId, "reddit", owned(context));
    const { sweepRedditFeeds } = await import("./reddit.server.ts");
    const {
      subredditNewFeed,
      subredditSearchFeed,
      pickCivicPosts,
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
    const picked = pickCivicPosts(sweep.posts);

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
      `r/${sub} read ${sweep.posts.length} filed ${filed}`,
      owned(context),
    );

    // Every post read, not only the ones filed, so a near miss stays visible
    // to the editor instead of vanishing along with the sweep. Split at the
    // civic threshold: the desk shows what cleared it and, separately, the
    // near misses (3-5) that almost did — the sniffing the owner asked to see.
    const classified = classifyRedditPosts(sweep.posts, alreadyKnownUrls, filedUrls);
    const asCard = (p: (typeof classified)[number]) => ({
      title: p.title,
      score: p.score,
      url: p.url,
      excerpt: p.excerpt,
      state: p.state,
    });

    return {
      ok: true as const,
      subreddit: sub,
      read: sweep.posts.length,
      civic: picked.length,
      filed,
      alreadyKnown: alreadyKnownUrls.size,
      incomplete: sweep.incomplete,
      reason: sweep.reason ?? "",
      log: sweep.log,
      // Which of the rotating searches ran this check, newest-posts first.
      searched,
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
  data: { url: string; title: string; excerpt?: string },
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
    { title: data.title, url: data.url, updated: "", author: "", excerpt: data.excerpt ?? "" },
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
  .validator((data: { url: string; title: string; excerpt?: string }) => data)
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
  .validator((input: { county: string }) => input)
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
      and status in ('open', 'reopened')
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
    facts: claims
      .filter((c) => /FACT|OBSERVATION/i.test(c.kind))
      .map((c) => ({ body: c.body, evidence: c.evidence ?? "" })),
    hypotheses: hyps.map((h) => h.body),
    questions: front.map((f) => `${f.label}${f.why ? ` — ${f.why}` : ""}`),
    findings: anoms.map((a) => `${a.kind}: ${a.summary}`),
    entities: ents,
    artifacts: artifactEvidence.artifacts,
  });
}

export async function buildBrief(
  userId: string,
  newsroomId: number,
  id: number,
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
  chat: typeof grokChat = grokChat,
) {
  const sql = await getSql();
  const pack = await buildDarkBriefPromptPack(newsroomId, id);
  if (!pack) return { ok: false as const, error: "not found" };

  const ai = await chat(BRIEF_SYSTEM, pack, 1200, {
    timeoutMs: providerBudget(choice, overrides).callMs,
    choice,
    localModel: overrides?.["local-model"]?.localModel,
    // Dark Desk F1: the brief reads the file already assembled above and
    // returns JSON only — it never fetches or searches itself.
    noTools: true,
  });
  if (!ai?.ok) return { ok: false as const, error: "error" in ai ? ai.error : "no response" };

  const brief = parseBrief(parseJsonBlock<unknown>(ai.text));
  if (!briefIsUseful(brief)) return { ok: false as const, error: "brief was empty" };

  await sql`
    insert into investigation_briefs (investigation_id, newsroom_id, brief_json, generated_at)
    values (${id}, ${newsroomId}, ${JSON.stringify(brief).slice(0, 12000)}, now())
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
) {
  const asked = storyModelChoice(modelChoice);
  const probe = await probeProvider(asked);
  const refusal = await darkPreflightRefusal(asked);
  if (refusal) return refusal;
  await ensureDarkSchema();
  const effectiveChoice = probe.ok ? probe.choice : asked;

  const open = await findOpenJob({ newsroomId: owned(context), kind: "brief", subjectId: id });
  if (open) {
    const persisted = effectiveStoryModelChoice(open.model_choice);
    if (persisted !== effectiveChoice) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `A brief is already being written with ${modelChoiceLabel(persisted)}. Wait for it to finish before choosing another model.`,
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
  });
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
  const overrides = await readProviderOverrides(newsroomId).catch(() => ({}));
  const result = await buildBrief(
    job.user_id,
    newsroomId,
    job.subject_id,
    effectiveStoryModelChoice(job.model_choice),
    overrides,
  );
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
  .validator((input: number | { id: number; modelChoice?: string }) => input)
  .handler(async ({ context, data }) =>
    typeof data === "number"
      ? startBriefJob(context, data)
      : startBriefJob(context, data.id, data.modelChoice),
  );
