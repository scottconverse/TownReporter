import { createServerFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import {
  grokChat,
  parseJsonBlock,
  providerBudget,
  probeProvider,
  type EffectiveProviderChoice,
} from "./ai.ts";
import {
  effectiveStoryModelChoice,
  modelChoiceLabel,
  storyModelChoice,
} from "./model-choice.ts";
import { planAutomaticFailover } from "./automatic-failover.ts";
import { readProviderOverrides } from "./provider-settings.ts";
import type { ProviderOverrides } from "./provider-registry.ts";
import { darkSystemFor } from "./dark-prompt.ts";
import { assertRate, audit } from "./ops.ts";
import {
  checkBaselines,
  ensureInvestigateSchema,
  matchDeadEnds,
  researchLoop,
  resurfaceDeadEnds,
  runDueMonitors,
} from "./investigate.ts";
import { sanitizePublicUrls } from "./schema.ts";
import type { ArticleRow, MemoryRow, SourceRow } from "./types.ts";
import { rankWorthItems, presentWorthItems, type WorthSeed } from "./worth-a-look.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { titlesOverlap, topicFromText } from "./desk-copy.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { TIP_SUBREDDIT, TIP_SUBREDDIT_QUERIES } from "../paper.ts";
import {
  BRIEF_SYSTEM,
  briefIsUseful,
  briefPack,
  parseBrief,
  type InvestigationBrief,
} from "./dark-brief.ts";
import {
  PRESETS,
  SCOPE_LABEL,
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

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

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
  const ready = scanPreflight(await probeProvider(choice));
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

// The inline DDL this desk owns directly (dark_* tables + the brief/settings
// tables). Kept as a plain statement list — rather than issued one at a time
// as before — so `ensureSchemaOnce` (src/lib/db.ts) can fingerprint the whole
// batch and skip it entirely once the database already has these objects.
// See that function's doc comment for why a per-process boolean would be
// wrong here (a rebuilt database under a live process must not look "ensured").
const DARK_SCHEMA_STATEMENTS: readonly string[] = [
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
    }>`
      select id, url, title, classification, fetch_status, fetch_outcome, version_id,
        created_at, left(full_text, 2500) as excerpt
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
    }>`
      select hop, query, state, provider, generated_json from search_log
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 40
    `;
    const signals = await sql<{
      id: number;
      name: string;
      observation: string;
      handoff: string;
      strength: number;
    }>`
      select id, name, observation, handoff, strength from dark_signals
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id desc limit 12
    `.catch(() => []);
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
) {
  const sql = await getSql();
  const sources = await sql<SourceRow>`
    select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
    from sources where newsroom_id = ${DEFAULT_NEWSROOM_ID} order by id asc
  `;
  const arts = await sql<{ title: string; url: string; full_text: string }>`
    select title, url, full_text from artifacts
    where investigation_id = ${investigationId}
    order by id desc limit 12
  `;
  const frontier = await sql<{ label: string; kind: string; why: string }>`
    select label, kind, why from frontier_items
    where investigation_id = ${investigationId} and status in ('open', 'investigating', 'reopened')
    order by priority desc limit 16
  `;
  const rels = await sql<{ from_name: string; to_name: string; kind: string }>`
    select from_name, to_name, kind from relationships
    where investigation_id = ${investigationId} limit 20
  `;
  const claims = await sql<{ body: string; kind: string }>`
    select body, kind from claims
    where investigation_id = ${investigationId} order by id desc limit 12
  `;
  const hyps = await sql<{ body: string; status: string }>`
    select body, status from hypotheses
    where investigation_id = ${investigationId} order by id desc limit 12
  `;
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies
    where investigation_id = ${investigationId} order by id desc limit 10
  `;
  const leads = await sql<{
    headline: string;
    why: string;
    topic: string;
    status: string;
    resurfaced_count: number;
  }>`
    select headline, why, topic, status, resurfaced_count from leads
    where newsroom_id = ${DEFAULT_NEWSROOM_ID} order by created_at desc limit 8
  `;
  const articles = await sql<Pick<ArticleRow, "headline" | "topic" | "published_at">>`
    select headline, topic, published_at from articles
    where newsroom_id = ${DEFAULT_NEWSROOM_ID} and status = 'published' order by published_at desc limit 6
  `;
  const memory = await sql<MemoryRow>`
    select entity, last_angle from beat_memory where newsroom_id = ${DEFAULT_NEWSROOM_ID} order by updated_at desc limit 12
  `;
  const searches = await sql<{ query: string }>`
    select query from search_log where investigation_id = ${investigationId} order by id desc limit 20
  `;

  const pack = [
    `CITY: Longmont, Colorado. Investigation ${investigationId}. Watch list is a start, not a boundary.`,
    `WATCH LIST:\n${sources.map((s) => `${s.tier} ${s.status} ${s.title} ${s.url}`).join("\n") || "(empty)"}`,
    `SEARCHES RUN:\n${searches.map((s) => s.query).join("\n") || "(none)"}`,
    `FRONTIER:\n${frontier.map((f) => `${f.kind}: ${f.label} — ${f.why}`).join("\n") || "(none)"}`,
    `RELATIONSHIPS:\n${rels.map((r) => `${r.from_name} -[${r.kind}]-> ${r.to_name}`).join("\n") || "(none)"}`,
    `CLAIMS:\n${claims.map((c) => `${c.kind}: ${c.body}`).join("\n") || "(none)"}`,
    `HYPOTHESES:\n${hyps.map((h) => `[${h.status}] ${h.body}`).join("\n") || "(none)"}`,
    `ANOMALIES:\n${anoms.map((a) => `${a.kind}: ${a.summary}`).join("\n") || "(none)"}`,
    `ARTIFACTS:\n${arts.map((s) => `### ${s.title}\n${s.url}\n${s.full_text.slice(0, 1600)}`).join("\n\n") || "(none)"}`,
    `OPEN LEADS:\n${leads
      .map((l) => {
        const resurfaced = l.status === "killed" && l.resurfaced_count > 0 ? ` (killed, resurfaced ×${l.resurfaced_count})` : "";
        return `${l.status} ${l.topic}: ${l.headline}${resurfaced}`;
      })
      .join("\n") || "(none)"}`,
    `PUBLISHED:\n${articles.map((a) => `${a.topic}: ${a.headline}`).join("\n") || "(none)"}`,
    `BEAT MEMORY:\n${memory.map((m) => `${m.entity}: ${m.last_angle}`).join("\n") || "(none)"}`,
    paste ? `EDITOR PASTE:\n${paste.slice(0, 8000)}` : "EDITOR PASTE: (none)",
  ].join("\n\n");

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
  const ai = await grokChat(darkSystemFor(dials), pack.slice(0, 28000), 3200, {
    timeoutMs: providerBudget(choice, overrides).callMs,
    choice,
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
    const strength = Math.min(15, Math.max(3, Number(sig.strength) || 3));
    const confidence = Math.min(1, Math.max(0, Number(sig.confidence) || 0.3));
    let handoff = String(sig.handoff ?? "HOLD FOR PATTERN").toUpperCase();
    if (!HANDOFFS.has(handoff)) handoff = "HOLD FOR PATTERN";
    await sql`
      insert into dark_signals (
        user_id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff
      ) values (
        ${userId}, ${runId}, ${investigationId}, ${name.slice(0, 200)},
        ${String(sig.posture ?? "").slice(0, 80)},
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
        ${handoff}
      )
    `;
    stored += 1;
  }

  for (const p of parsed.promises ?? []) {
    const who = String(p.who ?? "").trim();
    const what = String(p.what ?? "").trim();
    if (!who || !what) continue;
    await sql`
      insert into dark_promises (user_id, who_promised, what, when_due, source_cite, status)
      values (
        ${userId}, ${who.slice(0, 200)}, ${what.slice(0, 800)},
        ${String(p.when_due ?? "").slice(0, 120) || null},
        ${String(p.source_cite ?? "").slice(0, 400) || null},
        ${String(p.status ?? "open").slice(0, 40)}
      )
    `;
  }

  return { stored, summary: header, error: undefined as string | undefined };
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
) {
  const sql = await getSql();
  const choice = opts.choice;
  const overrides = await readProviderOverrides(DEFAULT_NEWSROOM_ID).catch(() => ({}));
  const runRows = await sql<{ id: number }>`
    insert into dark_runs (user_id, model_choice) values (${userId}, ${choice ?? null}) returning id
  `;
  const runId = runRows[0]!.id;
  const paste = opts.paste.trim().slice(0, 14000);

  let investigationId = opts.investigationId ?? 0;
  if (!investigationId) {
    const opened = await openInvestigationForEditor(userId, { paste, title: opts.title });
    investigationId = opened.investigationId;
  }

  try {
    await checkBaselines(userId, investigationId);
    await runDueMonitors({ userId });

    // Same setting as a continued round: an editor who turned the desk up
    // expects the file they open next to dig that hard too.
    const dials = await readDarkDials(DEFAULT_NEWSROOM_ID);
    const budget = budgetFor(dials);
    const loop = await researchLoop({
      userId,
      investigationId,
      hops: budget.hops,
      choice,
      providerOverrides: overrides,
    });

    const synth = await synthesizeSignals(
      userId,
      runId,
      investigationId,
      paste,
      dials,
      choice,
      overrides,
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
    const revived = await matchDeadEnds(userId, names);

    const header = [
      loop.summary,
      synth.summary,
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
  .validator(
    (input: { paste: string; investigationId?: number; modelChoice?: string }) => input,
  )
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
    await assertRate(context.userId, "dark");
    return executeDarkRun(context.userId, {
      paste: data.paste,
      investigationId: data.investigationId,
      choice: probe.ok ? probe.choice : asked,
    });
  });

export const openDarkInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { paste: string; title?: string }) => input)
  .handler(async ({ context, data }) => {
    try {
      await ensureDarkSchema();
      const opened = await openInvestigationForEditor(context.userId, data);
      await audit(context.userId, "dark", `open inv ${opened.investigationId}`);
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
    const opened = await openInvestigationForEditor(context.userId, {
      paste: top.seed,
      title: top.title,
    });
    await audit(context.userId, "dark", `open inv ${opened.investigationId} from worth-a-look`);
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

  await assertRate(context.userId, "dark");
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
    await checkBaselines(context.userId, id);
    await runDueMonitors({ userId: context.userId });
    /*
      Depth comes from the desk's own setting.

      This was `hops: 1` — one hop per press, whatever the investigation needed
      and whatever the editor wanted. The machinery underneath could always
      chase a trail; nothing could ask it to.
    */
    const dials = await readDarkDials(owned(context));
    const budget = budgetFor(dials);
    const runOnce = async (on: EffectiveProviderChoice) => {
      const ran = await researchLoop({
        userId: context.userId,
        investigationId: id,
        hops: budget.hops,
        choice: on,
        providerOverrides: overrides,
      });
      const signals = await synthesizeSignals(
        context.userId,
        runId,
        id,
        "",
        dials,
        on,
        overrides,
      );
      return { loop: ran, synth: signals };
    };

    let { loop, synth } = await runOnce(choice);

    /*
      One-shot Automatic failover, at the ROUND level.

      Story and Scan both do this (see automatic-failover.ts and
      scan-model-run.ts) and Dark Desk did not, because until 0.6.2 it had no
      pinned model to fail over FROM. The trigger is deliberately narrow: only
      a job Automatic chose for, only an error that reads as a lapsed login,
      only a rung strictly later in the ladder, and only once. A refusal, a
      timeout, or an empty answer is a real result and must not be papered
      over with a second provider's opinion.

      A hop's own planner failure surfaces in `loop.summary` ("Planner fell
      back on 1 of 4 hops: ...") rather than as a thrown error, because the
      loop keeps digging with the keyword heuristic when the model will not
      answer. That text is checked too, so a round whose every hop was planned
      by a signed-out provider is not recorded as a successful dig.
    */
    const failure = synth.error || (loop.plannerFailures > 0 ? loop.summary : "");
    if (failure) {
      const plan = await planAutomaticFailover({
        source: job.model_choice_source ?? "editor",
        current: job.model_choice,
        error: failure,
        probe: probeProvider,
      });
      if (plan) {
        const previous = modelChoiceLabel(job.model_choice);
        await setJobModelChoice(job.id, plan.next);
        await setJobStage(job.id, `Switched to ${plan.label}: ${previous} sign-in lapsed`);
        choice = plan.next;
        ({ loop, synth } = await runOnce(choice));
      }
    }
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
    const revived = await matchDeadEnds(context.userId, names);
    const header = [
      loop.summary,
      synth.summary,
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

export const sendDarkSignalToQueue = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const rows = await sql<DarkSignalRow>`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals where id = ${id} and newsroom_id = ${owned(context)} limit 1
    `;
    const sig = rows[0];
    if (!sig) return { ok: false as const, error: "Signal not found" };
    const arts = sig.investigation_id
      ? await sql<{ url: string }>`
          select url from artifacts
          where newsroom_id = ${owned(context)} and investigation_id = ${sig.investigation_id}
          order by id desc limit 12
        `
      : await sql<{ url: string }>`
          select url from artifacts
          where newsroom_id = ${owned(context)}
          order by id desc limit 12
        `;
    const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
    const why = [
      `DARK DESK investigation notes. Claim kinds in the evidence. Publication is a separate human action.`,
      `Posture: ${sig.posture}. Type: ${sig.signal_type}. Strength ${sig.strength} / confidence ${sig.confidence}.`,
      sig.observation,
      `Linkage: ${sig.linkage_map}`,
      `Alternatives: ${sig.alternatives}`,
      `Pathway: ${sig.pathway}`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    const created = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
      values (
        ${context.userId},
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
    await audit(context.userId, "dark-handoff", String(id));
    return { ok: true as const, leadId: created[0]!.id };
  });

export const queueInvestigation = createServerFn({ method: "POST" })
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
    if (!inv[0]) return { ok: false as const, error: "Investigation not found" };
    const already = await sql<{ id: number }>`
      select id from leads
      where investigation_id = ${id} and newsroom_id = ${owned(context)}
      order by id asc limit 1
    `;
    if (already[0]) {
      await audit(context.userId, "dark-handoff", `inv ${id} existing lead ${already[0].id}`);
      return { ok: true as const, leadId: already[0].id };
    }
    const arts = await sql<{ url: string }>`
      select url from artifacts
      where newsroom_id = ${owned(context)} and investigation_id = ${id}
      order by id desc limit 12
    `;
    const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
    const topic = topicFromText(`${inv[0].title}\n${inv[0].summary}`);
    const created = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
      values (
        ${context.userId},
        ${inv[0].title.slice(0, 240)},
        ${`DARK DESK notes. Publication is a separate human action.\n\n${inv[0].summary}`.slice(0, 4000)},
        ${topic},
        'new',
        ${urls},
        ${inv[0].summary.slice(0, 4000)},
        ${12},
        ${id}
      )
      returning id
    `;
    await audit(context.userId, "dark-handoff", `inv ${id} lead ${created[0]!.id}`);
    return { ok: true as const, leadId: created[0]!.id };
  });

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
    await audit(context.userId, "dark", `set aside inv ${id}`);
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
    await audit(context.userId, "dark", `pull back inv ${id}`);
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
export const scanTipSubreddit = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    await assertRate(context.userId, "reddit");
    const { sweepRedditFeeds } = await import("./reddit.server.ts");
    const { subredditNewFeed, subredditSearchFeed, pickCivicPosts, redditAnomaly, civicScore } =
      await import("./reddit.ts");
    const sub = TIP_SUBREDDIT;

    const feeds = [
      subredditNewFeed(sub),
      ...TIP_SUBREDDIT_QUERIES.map((q) => subredditSearchFeed(sub, q)),
    ];
    const sweep = await sweepRedditFeeds(feeds, 3);
    const picked = pickCivicPosts(sweep.posts);

    const sql = await getSql();
    let filed = 0;
    const already: string[] = [];
    for (const post of picked) {
      const seen = await sql<{ id: number }>`
        select id from anomalies
        where newsroom_id = ${owned(context)} and url = ${post.url}
        limit 1
      `;
      if (seen[0]) {
        already.push(post.title);
        continue;
      }
      const a = redditAnomaly(post, sub);
      await sql`
        insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
        values (${context.userId}, ${owned(context)}, ${a.kind}, ${a.summary}, ${a.url}, ${a.details})
      `;
      filed += 1;
    }

    await audit(context.userId, "reddit", `r/${sub} read ${sweep.posts.length} filed ${filed}`);

    return {
      ok: true as const,
      subreddit: sub,
      read: sweep.posts.length,
      civic: picked.length,
      filed,
      alreadyKnown: already.length,
      incomplete: sweep.incomplete,
      reason: sweep.reason ?? "",
      log: sweep.log,
      // Shown to the editor so a thin result is explainable rather than mysterious.
      topScores: picked
        .slice(0, 5)
        .map((p) => ({ title: p.title, score: civicScore(p), url: p.url })),
    };
  });

/**
 * The dials, as stored for this newsroom.
 *
 * Read on every round rather than captured at investigation time: an editor who
 * turns the desk up expects the next round to dig harder, not the next
 * investigation they happen to start.
 */
export async function readDarkDials(newsroomId: number): Promise<DarkDials> {
  const sql = await getSql();
  const rows = await sql<{ dig: number; nerve: number; scope: string }>`
    select dig, nerve, scope from dark_settings where newsroom_id = ${newsroomId} limit 1
  `.catch(() => []);
  return clampDials(rows[0] as Partial<DarkDials> | undefined);
}

export const getDarkDials = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const dials = await readDarkDials(owned(context));
    return {
      dials,
      budget: budgetFor(dials),
      stance: stanceFor(dials),
      description: describeDials(dials),
      minutes: estimateMinutes(dials),
      presets: PRESETS,
      scopeLabel: SCOPE_LABEL,
    };
  });

export const saveDarkDials = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { dig: number; nerve: number; scope: string }) => input)
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    // Clamped on the way in as well as on the way out: a stored 40 would be a
    // very expensive typo.
    const d = clampDials(data as Partial<DarkDials>);
    const sql = await getSql();
    await sql`
      insert into dark_settings (newsroom_id, dig, nerve, scope, updated_at)
      values (${owned(context)}, ${d.dig}, ${d.nerve}, ${d.scope}, now())
      on conflict (newsroom_id) do update
        set dig = excluded.dig, nerve = excluded.nerve, scope = excluded.scope,
            updated_at = now()
    `;
    await audit(context.userId, "dark-dials", `dig ${d.dig} nerve ${d.nerve} scope ${d.scope}`);
    return {
      ok: true as const,
      dials: d,
      description: describeDials(d),
      minutes: estimateMinutes(d),
    };
  });

/**
 * Write the read-me-first block for one investigation.
 *
 * Runs after a round rather than on page load: it is a model call, and an
 * editor refreshing a file should not pay for one. Failure is silent by design
 * — the four lists below it are the real content, and a missing summary must
 * never stop the file opening.
 */
export async function buildBrief(
  userId: string,
  newsroomId: number,
  id: number,
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
) {
  const sql = await getSql();
  const inv = await sql<{ title: string }>`
    select title from investigations where id = ${id} and newsroom_id = ${newsroomId} limit 1
  `;
  if (!inv[0]) return { ok: false as const, error: "not found" };

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
  const arts = await sql<{ title: string; url: string }>`
    select title, url from artifacts where investigation_id = ${id} order by id desc limit 30
  `.catch(() => []);
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies where investigation_id = ${id} order by id desc limit 20
  `.catch(() => []);

  const pack = briefPack({
    title: inv[0].title,
    facts: claims
      .filter((c) => /FACT|OBSERVATION/i.test(c.kind))
      .map((c) => ({ body: c.body, evidence: c.evidence ?? "" })),
    hypotheses: hyps.map((h) => h.body),
    questions: front.map((f) => `${f.label}${f.why ? ` — ${f.why}` : ""}`),
    findings: anoms.map((a) => `${a.kind}: ${a.summary}`),
    entities: ents,
    artifacts: arts,
  });

  const ai = await grokChat(BRIEF_SYSTEM, pack.slice(0, 22000), 1200, {
    timeoutMs: providerBudget(choice, overrides).callMs,
    choice,
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

  await assertRate(context.userId, "brief");
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
