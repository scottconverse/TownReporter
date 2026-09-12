import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import { getPaperConfig } from "./paper-settings.ts";
import {
  grokChat,
  parseJsonBlock,
  plannerModel,
  providerBudget,
  type EffectiveProviderChoice,
} from "./ai.ts";
import type { ProviderOverrides } from "./provider-registry.ts";
import { isSelfReferential, labelAfterCitationCheck } from "./claim-hygiene.ts";
import { readableCapture } from "./html-text.ts";
import { darkPlannerFor } from "./dark-prompt.ts";
import { enforceSearchMinimums, tierForQuery, tierForUrl, type Place } from "./dark-gates.ts";
import {
  classifyClaimKind,
  detectMissingCadence,
  detectPatternAnomalies,
  diffExcerpt,
  extractMeetingInstant,
  extractReferences,
  heuristicPlan as heuristicFromText,
  leadHoursBefore,
  nthWeekday,
  structureSnapshot,
  queriesForRef,
  type ExtractedRef,
  type StructureSnapshot,
} from "./extract.ts";
import { sha256, sha256Bytes } from "./url-guard.ts";
import {
  classifyFetchedPage,
  canonicalPublicUrl,
  canonicalFrontierUrl,
  type FetchOutcome,
} from "./fetch-outcome.ts";
import {
  ARCHIVE_TEXT_CAP,
  PLANNER_TEXT_CAP,
  chunksFromEvidence,
  ingestDocument,
  type PdfPage,
} from "./ingest.ts";
import { storableText } from "./storable-text.ts";
import {
  searchWithFallback,
  waybackCopies,
  type SearchAttempt,
  type WebHit,
} from "./search-web.ts";
import { queryTokens, retrieveRelevantChunks } from "./retrieve.ts";
import { identityKey, isConfirmedSame, resolveEntityName } from "./entity-resolve.ts";
import { isRedditUrl } from "./reddit.ts";
import { sanitizePublicUrls } from "./schema.ts";
import {
  parseResearchAction,
  responsiveActionPrompt,
  type ResearchAction,
  type ResearchActionReceipt,
} from "./research-actions.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  queryFingerprint,
  remainingStrategies,
  strategiesForFrontier,
  strategyKeyForQuery,
} from "./strategies.ts";

export const HOPS_PER_RUN = 5;
export const SEARCHES_PER_HOP = 3;
export const FETCHES_PER_HOP = 4;
/** Matches grokPlanner's provider input ceiling; keep important context inside it. */
export const PLANNER_INPUT_CAP = 24_000;
const PLANNER_GRAPH_CAP = 16_000;
const PLANNER_ARTIFACT_CAP = 6_000;
const PLANNER_HISTORY_CAP = 700;
/** Dark Desk F5: see the researchLoop fetch loop for why this is capped separately from FETCHES_PER_HOP. */
export const REDDIT_FETCHES_PER_HOP_CAP = 3;

export type EvidenceHint = {
  source_url?: string;
  artifact_version_id?: number;
  capture_event_id?: number;
  locator?: string;
  excerpt?: string;
};

export type HopPlan = {
  searches: string[];
  fetch_urls: string[];
  entities: { name: string; kind: string; why: string }[];
  relationships: {
    from: string;
    to: string;
    kind: string;
    evidence: string;
    source_url?: string;
    artifact_version_id?: number;
    capture_event_id?: number;
    locator?: string;
  }[];
  hypotheses: { text: string; supporting: string; contradicting: string }[];
  claims: {
    text: string;
    kind: string;
    evidence: string;
    source_url?: string;
    confidence?: number;
    artifact_version_id?: number;
    capture_event_id?: number;
    locator?: string;
  }[];
  frontier: { label: string; kind: string; why: string; priority: number; queries?: string[] }[];
  anomalies: { kind: string; summary: string; url?: string }[];
  dead_ends: { hypothesis: string; reason: string }[];
  questions: string[];
  stop: boolean;
  summary: string;
  /**
   * Set when the model never answered and this plan came from the heuristic.
   *
   * The fallback used to be silent. Every hop of every run had been running on
   * the keyword heuristic — zero entities, zero claims, zero hypotheses across
   * the whole database — while the run summary read like a successful dig. A
   * fallback that does not announce itself is indistinguishable from working.
   */
  planner_error?: string;
};

export type HopPlanClaim = HopPlan["claims"][number];
export type HopPlanRel = HopPlan["relationships"][number];

export type SearchFn = (query: string) => Promise<WebHit[]>;
export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: string;
  title: string;
  extras: string[];
  outcome?: string;
  redirectChain?: string[];
  contentType?: string;
  extractionMethod?: string;
  pages?: PdfPage[];
  needsOcr?: boolean;
  rawBytes?: Uint8Array;
  classification?: string;
}>;
export type SearchAttemptFn = (query: string) => Promise<SearchAttempt>;
export type PlannerFn = (pack: string) => Promise<HopPlan>;
export type ResearchActionChooser = (context: string) => Promise<ResearchAction>;

export type ResearchLoopResult = {
  hops: number;
  artifacts: number;
  frontier: number;
  paused: boolean;
  summary: string;
  plannerFailures: number;
  plannerStartupFailures: number;
  actionDecisions?: number;
  finished?: boolean;
};

export type ResearchLoopOptions = {
  userId: string;
  investigationId: number;
  hops?: number;
  choice?: EffectiveProviderChoice;
  providerOverrides?: ProviderOverrides | null;
  search?: SearchFn;
  searchAttempt?: SearchAttemptFn;
  fetch?: FetchFn;
  planner?: PlannerFn;
  readSelector?: PlannerFn;
  archives?: (url: string) => Promise<string[]>;
  newsroomId?: number;
  place?: Place;
  officialDomains?: string[];
  pressDomains?: string[];
  preferences?: import("./dark-preferences.ts").ResearchSnapshot;
  /** Explicit opt-in; omission preserves the original batch loop. */
  executionMode?: "batch" | "responsive";
  /** Responsive model-decision cap, clamped to 1..24. Default 6. */
  actionLimit?: number;
  /** Deterministic test seam; production uses the editor-selected provider. */
  actionChooser?: ResearchActionChooser;
  /** Internal one-operation adapter marker; callers should not set this. */
  _responsiveOperation?: "search" | "read" | "follow";
};

export type CaptureRecord = {
  versionId: number | null;
  captureEventId: number;
  contentHash: string;
  url: string;
};

const SCHEMA_SQL = `
alter table snapshots add column if not exists url text;
alter table snapshots add column if not exists fetch_status integer;
alter table leads add column if not exists investigation_id integer;
create table if not exists investigations (
  id serial primary key,
  user_id text not null,
  title text not null,
  status text not null default 'open',
  summary text not null default '',
  hops integer not null default 0,
  budget integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists frontier_items (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  kind text not null,
  label text not null,
  why text not null default '',
  evidence text not null default '',
  priority integer not null default 5,
  queries_tried text not null default '[]',
  next_steps text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists artifacts (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  url text not null,
  referrer_url text,
  query text,
  title text not null default '',
  content_type text not null default 'html',
  content_hash text not null,
  full_text text not null default '',
  classification text not null default 'discovered',
  fetch_status integer,
  created_at timestamptz not null default now()
);
create table if not exists entities (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  name text not null,
  kind text not null,
  why text not null default '',
  unique (user_id, canonical)
);
create table if not exists relationships (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  from_name text not null,
  to_name text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  created_at timestamptz not null default now()
);
create table if not exists claims (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  body text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  confidence numeric,
  created_at timestamptz not null default now()
);
create table if not exists hypotheses (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  body text not null,
  supporting text not null default '',
  contradicting text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists anomalies (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  kind text not null,
  summary text not null,
  url text,
  details text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists dead_ends (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  hypothesis text not null,
  why_interesting text not null default '',
  searches text not null default '',
  entities text not null default '',
  dismissed_because text not null default '',
  unresolved text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists search_log (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  hop integer not null,
  query text not null,
  results_json text not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists recurring_baselines (
  id serial primary key,
  user_id text not null,
  key text not null,
  kind text not null,
  cadence_days integer not null default 30,
  last_seen timestamptz,
  typical_title text not null default '',
  typical_url text not null default '',
  unique (user_id, key)
);
create table if not exists artifact_versions (
  id serial primary key,
  user_id text not null,
  url text not null,
  content_hash text not null,
  title text not null default '',
  full_text text not null default '',
  fetch_status integer,
  fetch_outcome text not null default 'fetched',
  content_type text not null default 'html',
  captured_at timestamptz not null default now(),
  unique (user_id, url, content_hash)
);
create table if not exists entity_aliases (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  alias text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  unique (user_id, canonical, alias)
);
create table if not exists capture_events (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  source_url text not null,
  observed_at timestamptz not null default now(),
  http_status integer,
  fetch_outcome text not null,
  redirect_chain text not null default '[]',
  version_id integer,
  disappearance boolean not null default false,
  soft_404 boolean not null default false,
  trigger_kind text not null default 'investigation',
  monitor_id integer,
  headers_json text not null default '{}',
  content_hash text,
  content_type text not null default '',
  extraction_method text not null default ''
);
create table if not exists artifact_chunks (
  id serial primary key,
  version_id integer not null,
  user_id text not null,
  chunk_index integer not null,
  page_number integer,
  section text not null default '',
  excerpt text not null,
  locator text not null default ''
);
create table if not exists investigation_entities (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  entity_id integer not null,
  first_seen_version_id integer,
  first_seen_capture_id integer,
  first_seen_url text,
  relevance text not null default 'direct',
  status text not null default 'active',
  unique (investigation_id, entity_id)
);
create table if not exists entity_matches (
  id serial primary key,
  user_id text not null,
  left_canonical text not null,
  right_canonical text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  capture_event_id integer,
  investigation_id integer,
  unique (user_id, left_canonical, right_canonical)
);
create table if not exists source_monitors (
  id serial primary key,
  user_id text not null,
  url text not null,
  title text not null default '',
  enabled boolean not null default true,
  cadence_hours integer not null default 24,
  next_check_at timestamptz not null default now(),
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_outcome text,
  last_version_id integer,
  expected_cadence_days integer,
  importance integer not null default 5,
  disappearance_sensitive boolean not null default true,
  investigation_id integer,
  typical_structure text not null default '',
  unique (user_id, url)
);
create table if not exists search_attempts (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  search_log_id integer,
  frontier_id integer,
  query text not null,
  provider text not null,
  state text not null,
  hits_json text not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
alter table artifacts add column if not exists version_id integer;
alter table artifacts add column if not exists fetch_outcome text;
alter table artifacts add column if not exists capture_event_id integer;
alter table artifacts add column if not exists extraction_method text;
alter table claims add column if not exists version_id integer;
alter table claims add column if not exists excerpt text;
alter table claims add column if not exists capture_hash text;
alter table claims add column if not exists capture_event_id integer;
alter table claims add column if not exists provenance_status text;
alter table claims add column if not exists locator text;
alter table claims add column if not exists captured_at timestamptz;
alter table relationships add column if not exists version_id integer;
alter table relationships add column if not exists excerpt text;
alter table relationships add column if not exists capture_event_id integer;
alter table relationships add column if not exists capture_hash text;
alter table relationships add column if not exists provenance_status text;
alter table relationships add column if not exists locator text;
alter table frontier_items add column if not exists closed_reason text;
alter table frontier_items add column if not exists strategies_tried text;
alter table frontier_items add column if not exists strategies_budget text;
alter table frontier_items add column if not exists search_zero_count integer;
alter table hypotheses add column if not exists transition_note text;
alter table search_log add column if not exists provider text;
alter table search_log add column if not exists state text;
alter table search_log add column if not exists caused_by text;
alter table search_log add column if not exists frontier_id integer;
alter table search_log add column if not exists hypothesis_id integer;
alter table search_log add column if not exists research_question text;
alter table search_log add column if not exists strategy text;
alter table search_log add column if not exists selected_json text;
alter table search_log add column if not exists fetched_json text;
alter table search_log add column if not exists generated_json text;
alter table search_log add column if not exists query_fingerprint text;
-- Which source tier answered: official / local-press / community. The
-- operator's civic-scanner orders them that way and the desk has to be able
-- to say which one actually came back (migrations/0043_dark_gates.sql).
alter table search_log add column if not exists tier text;
alter table recurring_baselines add column if not exists sightings integer;
alter table recurring_baselines add column if not exists usual_weekday text;
alter table recurring_baselines add column if not exists usual_nth_weekday text;
alter table recurring_baselines add column if not exists usual_lead_hours integer;
alter table recurring_baselines add column if not exists usual_attachment_count integer;
alter table recurring_baselines add column if not exists typical_structure_json text;
alter table artifact_versions add column if not exists extraction_method text;
alter table artifact_versions add column if not exists page_count integer;
alter table artifact_versions add column if not exists raw_ref text;
alter table artifact_versions add column if not exists content_type text;
alter table entity_aliases add column if not exists evidence text;
alter table entity_aliases add column if not exists verdict text;
alter table investigations add column if not exists pause_reason text;
alter table frontier_items add column if not exists prior_status text;
alter table frontier_items add column if not exists reopened_at timestamptz;
alter table frontier_items add column if not exists reopened_from text;
alter table frontier_items add column if not exists label_norm text not null default '';
alter table dead_ends add column if not exists confirmation_count integer not null default 1;
alter table dead_ends add column if not exists settled boolean not null default false;
alter table dead_ends add column if not exists dedup_key text not null default '';
create table if not exists artifact_blobs (
  id serial primary key,
  version_id integer not null,
  user_id text not null,
  sha256 text not null,
  mime text not null default 'application/octet-stream',
  original_url text not null default '',
  redirect_chain text not null default '[]',
  byte_length integer not null default 0,
  body_b64 text not null default '',
  captured_at timestamptz not null default now()
);
create index if not exists artifact_blobs_version_idx on artifact_blobs (version_id);
`;

// The 73 `create table`/`create index` statements above, plus the 32
// `alter table ... add column`/index-rename statements below, as one ordered
// list. `ensureSchemaOnce` (src/lib/db.ts) fingerprints this exact list and
// only replays it against a database that doesn't already carry a matching
// fingerprint — see that function's doc comment for why that is safe across
// restarts, redeploys (a changed statement list gets a new fingerprint) and
// a database dropped and recreated under a live process (the fingerprint
// table goes with it, so the next call sees nothing and reruns everything).
const INVESTIGATE_SCHEMA_STATEMENTS: readonly string[] = [
  ...SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean),
  `alter table artifact_versions add column if not exists extracted_sha256 text`,
  `alter table artifact_versions add column if not exists raw_sha256 text`,
  `alter table artifact_versions add column if not exists newsroom_id integer not null default 1`,
  `alter table frontier_items add column if not exists newsroom_id integer not null default 1`,
  `alter table entities add column if not exists newsroom_id integer not null default 1`,
  `alter table relationships add column if not exists newsroom_id integer not null default 1`,
  `alter table claims add column if not exists newsroom_id integer not null default 1`,
  `alter table hypotheses add column if not exists newsroom_id integer not null default 1`,
  `alter table anomalies add column if not exists newsroom_id integer not null default 1`,
  `alter table dead_ends add column if not exists newsroom_id integer not null default 1`,
  `alter table search_log add column if not exists newsroom_id integer not null default 1`,
  `alter table recurring_baselines add column if not exists newsroom_id integer not null default 1`,
  `alter table entity_aliases add column if not exists newsroom_id integer not null default 1`,
  `alter table investigation_entities add column if not exists newsroom_id integer not null default 1`,
  `alter table entity_matches add column if not exists newsroom_id integer not null default 1`,
  `alter table search_attempts add column if not exists newsroom_id integer not null default 1`,
  `alter table investigations add column if not exists newsroom_id integer not null default 1`,
  `alter table artifacts add column if not exists newsroom_id integer not null default 1`,
  `alter table source_monitors add column if not exists newsroom_id integer not null default 1`,
  `alter table capture_events add column if not exists newsroom_id integer not null default 1`,
  // Mirrors migrations/0012_newsroom_appliance.sql. These two were missing
  // from this ensure list even though the migration adds them (GauntletGate
  // ENG-03) -- a database built via this path alone (a fresh PGLite dev
  // instance, or the Node unit-test path when the migration glob is
  // unavailable) would lack the column every scoped read here filters on.
  `alter table artifact_blobs add column if not exists newsroom_id integer not null default 1`,
  `alter table artifact_chunks add column if not exists newsroom_id integer not null default 1`,
  `alter table artifact_versions drop constraint if exists artifact_versions_user_id_url_content_hash_key`,
  `drop index if exists artifact_versions_user_id_url_content_hash_key`,
  `create unique index if not exists artifact_versions_newsroom_url_hash on artifact_versions (newsroom_id, url, content_hash)`,
  `alter table entities drop constraint if exists entities_user_id_canonical_key`,
  `drop index if exists entities_user_id_canonical_key`,
  `create unique index if not exists entities_newsroom_canonical on entities (newsroom_id, canonical)`,
  // Migration 0044 adds the room to the existing per-editor identity keys.
  // No historical rows are deleted or assigned to a different newsroom.
  `create unique index if not exists entity_aliases_newsroom_user_names on entity_aliases (newsroom_id, user_id, canonical, alias)`,
  `alter table entity_aliases drop constraint if exists entity_aliases_user_id_canonical_alias_key`,
  `drop index if exists entity_aliases_user_id_canonical_alias_key`,
  `create unique index if not exists entity_matches_newsroom_user_names on entity_matches (newsroom_id, user_id, left_canonical, right_canonical)`,
  `alter table entity_matches drop constraint if exists entity_matches_user_id_left_canonical_right_canonical_key`,
  `drop index if exists entity_matches_user_id_left_canonical_right_canonical_key`,
  `alter table source_monitors drop constraint if exists source_monitors_user_id_url_key`,
  `drop index if exists source_monitors_user_id_url_key`,
  `create unique index if not exists source_monitors_newsroom_url on source_monitors (newsroom_id, url)`,
  /*
    Dark Desk F4: unique index on the dedup key persistDiscovery already
    computes (label_norm). Mirrors migrations/0038_frontier_items_dedup.sql,
    which dedupes existing rows first -- this ensure-side statement follows
    the same best-effort convention as the artifact_versions/entities/
    source_monitors indexes just above: if it runs against a database that
    was never migrated and still has duplicates, ensureSchemaOnce's
    try/catch (this file's ensureInvestigateSchema) swallows the failure and
    the app keeps working on app-level dedup alone -- the migration is what
    makes the guarantee real.
  */
  `create unique index if not exists frontier_items_investigation_label_norm on frontier_items (investigation_id, label_norm)`,
  /*
    Dark Desk F4: one row per (investigation, dedup_key) in dead_ends
    (dedup_key = lower(trim(hypothesis)), computed the same way persistPlan
    computes it on write), so a re-asserted dead end increments
    confirmation_count (see persistPlan) instead of inserting a duplicate
    row -- the fix for the "18x" zombie dead end. A stored column rather
    than a functional index on lower(hypothesis) directly, so
    migrations/0039_dead_ends_confirmation.sql can de-collide a
    pre-existing duplicate WITHOUT deleting or rewriting its hypothesis
    text (this repo's migration runner refuses any DELETE FROM -- see
    scripts/no-destructive-migrate.test.mjs). Same best-effort convention
    as above.
  */
  `create unique index if not exists dead_ends_investigation_dedup_key on dead_ends (investigation_id, dedup_key)`,
  /*
    Which writing model this investigation last dug with (0.6.2). Mirrors
    migrations/0030_dark_model_choice.sql. "Keep digging" defaults to it, so
    a file that was started on Codex does not silently switch to Claude the
    next time someone presses the button.
  */
  `alter table investigations add column if not exists last_model_choice text`,
  `alter table source_monitors add column if not exists manual_watch boolean not null default false`,
  `alter table recurring_baselines drop constraint if exists recurring_baselines_user_id_key_key`,
  `drop index if exists recurring_baselines_user_id_key_key`,
  `create unique index if not exists recurring_baselines_newsroom_key on recurring_baselines (newsroom_id, key)`,
];

export async function ensureInvestigateSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "investigate", INVESTIGATE_SCHEMA_STATEMENTS);
}

/** Investigation IDs come from authorized callers; model hints never select a newsroom. */
async function investigationNewsroom(investigationId: number, expected?: number): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{
    newsroom_id: number;
  }>`select newsroom_id from investigations where id=${investigationId}`;
  const room = rows[0]?.newsroom_id;
  if (room == null || (expected != null && room !== expected))
    throw new Error("Investigation not found in this newsroom");
  return room;
}

export function emptyPlan(): HopPlan {
  return {
    searches: [],
    fetch_urls: [],
    entities: [],
    relationships: [],
    hypotheses: [],
    claims: [],
    frontier: [],
    anomalies: [],
    dead_ends: [],
    questions: [],
    stop: false,
    summary: "",
  };
}

/**
 * A claim may not be more certain than its own label allows.
 *
 * Measured across Opus, Sonnet and Haiku on the same real pack: every one of
 * them produced claims labelled ALLEGATION or INFERENCE carrying confidence
 * above 0.8 — Opus four of eight, Haiku five of six. That is not a small-model
 * problem, it is a missing rule, and it is the specific way a desk like this
 * turns "somebody said" into "we know".
 *
 * The prompt now states the ceilings, and this enforces them, because a prompt
 * is a request and this needs to be a guarantee.
 */
export const CONFIDENCE_CEILING: Record<string, number> = {
  FACT: 1,
  OBSERVATION: 0.9,
  INFERENCE: 0.7,
  ALLEGATION: 0.6,
  HYPOTHESIS: 0.5,
  UNKNOWN: 0.3,
};

export function clampConfidenceToLabel(kind: string, raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const ceiling = CONFIDENCE_CEILING[String(kind).toUpperCase()] ?? 0.3;
  return Math.max(0, Math.min(ceiling, raw));
}

export function heuristicPlan(text: string, tried: Set<string>): HopPlan {
  const h = heuristicFromText(text, tried, SEARCHES_PER_HOP, FETCHES_PER_HOP);
  const plan = emptyPlan();
  plan.searches = h.searches;
  plan.fetch_urls = sanitizePublicUrls(h.fetch_urls);
  plan.frontier = h.frontier;
  plan.summary = h.summary;
  return plan;
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Exported for tests only: proving the model-output hygiene filter (Dark
 * Desk F3) actually reaches claims/frontier/anomalies/dead_ends, not just
 * claims. See investigate.test.ts.
 */
export function parsePlan(raw: unknown): HopPlan {
  const plan = emptyPlan();
  if (!raw || typeof raw !== "object") return plan;
  const o = raw as Record<string, unknown>;
  plan.searches = Array.isArray(o.searches) ? o.searches.map(String).slice(0, 8) : [];
  plan.fetch_urls = sanitizePublicUrls(o.fetch_urls).slice(0, 10);
  plan.stop = Boolean(o.stop);
  plan.summary = String(o.summary ?? "").slice(0, 2000);
  plan.questions = Array.isArray(o.questions) ? o.questions.map(String).slice(0, 12) : [];
  const arr = <T>(key: string) => (Array.isArray(o[key]) ? (o[key] as T[]) : []);
  for (const e of arr<Record<string, unknown>>("entities")) {
    if (e?.name)
      plan.entities.push({
        name: String(e.name),
        kind: String(e.kind ?? "unknown"),
        why: String(e.why ?? ""),
      });
  }
  for (const r of arr<Record<string, unknown>>("relationships")) {
    if (r?.from && r?.to) {
      plan.relationships.push({
        from: String(r.from),
        to: String(r.to),
        kind: String(r.kind ?? "related"),
        evidence: String(r.evidence ?? ""),
        source_url: r.source_url ? String(r.source_url) : undefined,
        artifact_version_id: numOrUndef(r.artifact_version_id),
        capture_event_id: numOrUndef(r.capture_event_id),
        locator: r.locator ? String(r.locator) : undefined,
      });
    }
  }
  for (const h of arr<Record<string, unknown>>("hypotheses")) {
    if (h?.text) {
      plan.hypotheses.push({
        text: String(h.text),
        supporting: String(h.supporting ?? ""),
        contradicting: String(h.contradicting ?? ""),
      });
    }
  }
  for (const c of arr<Record<string, unknown>>("claims")) {
    /*
      A claim about the investigation is not a claim.

      Every model tested filed several per hop — "X remains unexamined after 20
      hops", "this hop invoked the fetch tool" — and they crowd the real
      findings out of the file and the brief. What is still unchecked belongs in
      the frontier, which already tracks exactly that.
    */
    if (c?.text && isSelfReferential(String(c.text))) continue;
    if (c?.text) {
      plan.claims.push({
        text: String(c.text),
        /*
          Two hygiene rules, applied here because the prompt cannot guarantee
          them. A FACT with no document behind it becomes an INFERENCE, and the
          confidence is then capped by whatever label survives that.
        */
        kind: labelAfterCitationCheck(classifyClaimKind(String(c.kind ?? "UNKNOWN")), {
          source_url: c.source_url ? String(c.source_url) : null,
          artifact_version_id: numOrUndef(c.artifact_version_id) ?? null,
          capture_event_id: numOrUndef(c.capture_event_id) ?? null,
        }),
        evidence: String(c.evidence ?? ""),
        source_url: c.source_url ? String(c.source_url) : undefined,
        confidence: clampConfidenceToLabel(
          labelAfterCitationCheck(classifyClaimKind(String(c.kind ?? "UNKNOWN")), {
            source_url: c.source_url ? String(c.source_url) : null,
            artifact_version_id: numOrUndef(c.artifact_version_id) ?? null,
            capture_event_id: numOrUndef(c.capture_event_id) ?? null,
          }),
          c.confidence,
        ),
        artifact_version_id: numOrUndef(c.artifact_version_id),
        capture_event_id: numOrUndef(c.capture_event_id),
        locator: c.locator ? String(c.locator) : undefined,
      });
    }
  }
  for (const f of arr<Record<string, unknown>>("frontier")) {
    /*
      Dark Desk F3: the same tool-refusal/sandbox-escape narration that used
      to poison `claims` (see the comment above) poisons the frontier too —
      "Bash tool call was denied, still unopened" reads exactly like a real
      lead and is what the editor's "Still unopened" pile actually showed.
      Checked against label+why together since either half can carry it.
    */
    if (f?.label && isSelfReferential(`${String(f.label)} ${String(f.why ?? "")}`)) continue;
    if (f?.label) {
      plan.frontier.push({
        label: String(f.label),
        kind: String(f.kind ?? "unknown"),
        why: String(f.why ?? ""),
        priority: Number(f.priority) || 5,
        queries: Array.isArray(f.queries) ? f.queries.map(String) : [],
      });
    }
  }
  for (const a of arr<Record<string, unknown>>("anomalies")) {
    if (a?.summary && isSelfReferential(String(a.summary))) continue;
    if (a?.summary) {
      plan.anomalies.push({
        kind: String(a.kind ?? "anomaly"),
        summary: String(a.summary),
        url: a.url ? String(a.url) : undefined,
      });
    }
  }
  for (const d of arr<Record<string, unknown>>("dead_ends")) {
    if (d?.hypothesis && isSelfReferential(`${String(d.hypothesis)} ${String(d.reason ?? "")}`))
      continue;
    if (d?.hypothesis) {
      plan.dead_ends.push({ hypothesis: String(d.hypothesis), reason: String(d.reason ?? "") });
    }
  }
  return plan;
}

export async function grokPlanner(
  pack: string,
  choice?: EffectiveProviderChoice,
  overrides?: ProviderOverrides | null,
  place?: Place,
  newsroomId?: number,
): Promise<HopPlan> {
  /*
    The provider's own per-call budget, not the 45-second default.

    This is the call that decides every hop, and it was being given 45 seconds
    to read a 24,000-character pack and return a plan. Against the local Claude
    Code CLI it timed out every time, fell back to the keyword heuristic without
    a word, and the desk produced no entities, claims or hypotheses at all while
    its summaries read like successful digs. `providerBudget()` has said 150
    seconds for this provider the whole time; nothing passed it.
  */
  const { callMs } = providerBudget(choice, overrides);
  /*
    The cheap half of the split, on the provider the ROUND is running.

    Before 0.6.2 both of these were provider-blind: `providerBudget()` and
    `plannerModel()` with no argument each asked `resolveProvider()` what this
    machine happens to prefer, which is not necessarily what the editor chose
    for this round. A round pinned to Codex would be budgeted and planned as
    if it were Claude. See `plannerModel` for the substitution rule.
  */
  const ai = await grokChat(darkPlannerFor(place), pack.slice(0, PLANNER_INPUT_CAP), 2200, {
    timeoutMs: callMs,
    model: plannerModel(choice),
    choice,
    newsroomId,
    localModel: overrides?.["local-model"]?.localModel,
    // Dark Desk F1: the planner only ever returns JSON (searches/fetch_urls
    // for the app to run) — it must never be handed a live tool surface to
    // try and get denied on. See ai-claude-code.server.ts's noTools comment.
    noTools: true,
  });
  if (!ai?.ok) {
    const why = ai && "error" in ai ? ai.error : "no response";
    return { ...heuristicPlan(pack, new Set()), planner_error: why };
  }
  const parsed = parsePlan(parseJsonBlock<unknown>(ai.text));
  if (!parsed.searches.length && !parsed.fetch_urls.length) {
    return { ...parsed, planner_error: "model replied but the plan had no next step" };
  }
  return parsed;
}

async function defaultFetch(url: string): ReturnType<FetchFn> {
  try {
    const doc = await ingestDocument(url);
    if (!doc || typeof doc.ok !== "boolean") {
      return { ok: false, status: 0, text: "", title: url, extras: [] };
    }
    return {
      ok: doc.ok,
      status: doc.status,
      text: doc.text,
      title: doc.title,
      extras: doc.extras ?? [],
      outcome: doc.outcome,
      redirectChain: doc.redirectChain,
      contentType: doc.contentType,
      extractionMethod: doc.extractionMethod,
      pages: doc.pages,
      needsOcr: doc.needsOcr,
      rawBytes: doc.rawBytes,
    };
  } catch {
    return { ok: false, status: 0, text: "", title: url, extras: [] };
  }
}

function asFetched(
  got: Awaited<ReturnType<FetchFn>> | null | undefined,
  url: string,
): Awaited<ReturnType<FetchFn>> {
  if (got && typeof got.ok === "boolean") {
    return {
      ...got,
      extras: got.extras ?? [],
      text: got.text ?? "",
      title: got.title || url,
      status: got.status ?? 0,
    };
  }
  return { ok: false, status: 0, text: "", title: url, extras: [] };
}

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function seedInvestigation(
  userId: string,
  investigationId: number,
  paste: string,
  snapshotBits: { title: string; url: string; excerpt: string }[],
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  if (paste.trim()) {
    const hash = await sha256(paste);
    await rememberCapture({
      userId,
      investigationId,
      url: "editor://paste",
      title: "Editor paste",
      text: paste.slice(0, ARCHIVE_TEXT_CAP),
      hash,
      status: 200,
      outcome: "fetched",
      classification: "watch",
      triggerKind: "seed",
      newsroomId,
    });
  }
  for (const snap of snapshotBits.slice(0, 20)) {
    const hash = await sha256(snap.excerpt);
    await rememberCapture({
      userId,
      investigationId,
      url: snap.url,
      title: snap.title,
      text: snap.excerpt.slice(0, ARCHIVE_TEXT_CAP),
      hash,
      status: 200,
      outcome: "fetched",
      classification: "watch",
      triggerKind: "seed",
      newsroomId,
    });
    const refs = extractReferences(`${snap.title}\n${snap.excerpt}`);
    await addFrontierFromRefs(userId, investigationId, refs, snap.url);
  }
  if (paste.trim()) {
    await addFrontierFromRefs(userId, investigationId, extractReferences(paste), "editor://paste");
  }
}

async function addFrontierFromRefs(
  userId: string,
  investigationId: number,
  refs: ExtractedRef[],
  evidence: string,
) {
  for (const ref of refs.slice(0, 30)) {
    await persistDiscovery(userId, investigationId, {
      kind: ref.kind,
      label: ref.value,
      why: "Referenced in evidence",
      evidence: evidence.slice(0, 400),
      priority: ref.kind === "company" || ref.kind === "url" ? 9 : 6,
      query: queriesForRef(ref)[0],
    });
  }
}

/**
 * Dark Desk F4 dedup key for a frontier lead.
 *
 * A URL-kind label is run through `canonicalFrontierUrl` (strips www/hash/
 * tracking params/trailing slash AND document-viewer nav params like
 * municode's `?nodeId=`) and lowercased, so `?nodeId=12345`, a trailing
 * slash, or `WWW.` vs no-`www.` all collapse to the same row instead of the
 * "same page saved 7 ways" bug. A non-URL label (an entity name, a
 * hypothesis-shaped frontier item, etc.) is normalized on case/whitespace
 * only — collapsing "Front Range LLC" and "front range llc " without
 * pretending two different-looking phrases are the same lead.
 *
 * Returns both the STORED label (canonical for URLs, trimmed-but-original
 * case otherwise, so the desk still shows a readable label) and the NORM
 * used for lookup/the unique index.
 */
export function frontierDedupKey(kind: string, rawLabel: string): { label: string; norm: string } {
  const trimmed = rawLabel.trim();
  if (kind === "url" || /^https?:\/\//i.test(trimmed)) {
    try {
      const canon = canonicalFrontierUrl(trimmed);
      return { label: canon, norm: canon.toLowerCase() };
    } catch {
      /* looked like a URL, wasn't one — fall through to generic normalization */
    }
  }
  return { label: trimmed, norm: trimmed.toLowerCase().replace(/\s+/g, " ") };
}

type FrontierRow = {
  id: number;
  queries_tried: string;
  next_steps: string;
  status: string;
  evidence: string;
  closed_reason: string | null;
  why: string;
};

/** Record a lead. Unknown/weak/parked never skip this — exhaustion is historical, not a ban. */
export async function persistDiscovery(
  userId: string,
  investigationId: number,
  item: {
    kind: string;
    label: string;
    why: string;
    evidence?: string;
    priority?: number;
    /** Planned searches that have not run yet. Unlike `query`, these are not provenance. */
    pendingQueries?: string[];
    query?: string;
  },
) {
  const sql = await getSql();
  const newsroomId = await investigationNewsroom(investigationId);
  const { label: canonLabel, norm } = frontierDedupKey(item.kind, item.label);
  const label = canonLabel.slice(0, 240);
  if (!label) return;
  const pendingQueries = (item.pendingQueries ?? [])
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((query, index, all) => all.indexOf(query) === index)
    .slice(0, 12);
  const mergePending = (current: string, additions: string[]) =>
    [...current.split("|").map((query) => query.trim()), ...additions]
      .filter((query, index, all) => query && all.indexOf(query) === index)
      .join(" | ")
      .slice(0, 800);

  async function mergeIntoExisting(row: FrontierRow): Promise<void> {
    if (item.query) {
      const tried = parseJsonArray(row.queries_tried);
      if (!tried.includes(item.query)) {
        tried.push(item.query);
        await sql`
          update frontier_items
          set queries_tried = ${JSON.stringify(tried).slice(0, 4000)}
          where id = ${row.id}
        `;
      }
    }
    const mergedNext = pendingQueries.length ? mergePending(row.next_steps, pendingQueries) : row.next_steps;
    if (mergedNext !== row.next_steps) {
      await sql`update frontier_items set next_steps = ${mergedNext} where id = ${row.id}`;
    }
    const incoming = (item.evidence ?? "").trim();
    const priorEv = (row.evidence ?? "").trim();
    const newEvidence = incoming.length >= 8 && !priorEv.includes(incoming.slice(0, 120));
    const parked = ["exhausted", "dead-end", "resolved", "deferred"].includes(row.status);
    if (parked && newEvidence) {
      const merged = `${priorEv}\n${incoming}`.trim().slice(0, 2000);
      const note =
        `Reopened from ${row.status}: materially new evidence. Prior: ${(row.closed_reason ?? row.why).slice(0, 240)}`.slice(
          0,
          800,
        );
      const reopenNext = (item.query || `"${label}" ${(await getPaperConfig(newsroomId)).city}`).slice(0, 800);
      await sql`
        update frontier_items
        set status = ${"reopened"},
            prior_status = ${row.status},
            reopened_at = now(),
            reopened_from = ${incoming.slice(0, 400)},
            closed_reason = ${note},
            evidence = ${merged},
            why = ${item.why.slice(0, 800)},
            next_steps = ${reopenNext},
            priority = greatest(priority, ${item.priority ?? 9})
        where id = ${row.id}
      `;
    } else if (incoming && incoming !== priorEv) {
      await sql`
        update frontier_items
        set evidence = ${`${priorEv}\n${incoming}`.trim().slice(0, 2000)}
        where id = ${row.id}
      `;
    }
  }

  const existing = await sql<FrontierRow>`
    select id, queries_tried, next_steps, status, evidence, closed_reason, why from frontier_items
    where investigation_id = ${investigationId} and label_norm = ${norm}
    limit 1
  `;
  if (existing[0]) {
    await mergeIntoExisting(existing[0]);
    return;
  }

  const budget = strategiesForFrontier(item.kind, label);
  const next = [...pendingQueries, ...(item.query ? [item.query] : []), ...budget.map((s) => s.query)]
    .filter((q, i, arr) => q && arr.indexOf(q) === i)
    .join(" | ")
    .slice(0, 800);
  const queriesTriedJson = JSON.stringify(item.query ? [item.query] : []);
  const strategiesBudgetJson = JSON.stringify(budget.map((s) => s.key));
  const evidenceVal = (item.evidence ?? "").slice(0, 400);
  const priorityVal = item.priority ?? 7;
  const kindVal = item.kind.slice(0, 40);
  const whyVal = item.why.slice(0, 800);
  /*
    Dark Desk F4: app-level dedup above still races on concurrent hops — two
    hops can both miss the `existing` select and both try to insert the same
    (investigation_id, label_norm). `on conflict` is the DB-level guard.
    Mirrors persistPlan's entities upsert immediately below in this file: if
    the ON CONFLICT target doesn't exist yet (a database whose unique index
    creation was itself skipped because pre-existing duplicates blocked it —
    see the ensureInvestigateSchema statement list), this throws and falls
    through to a re-check-then-plain-insert, never a hard failure.
  */
  try {
    const created = await sql<{ id: number }>`
      insert into frontier_items (
        user_id, newsroom_id, investigation_id, kind, label, label_norm, why, evidence, priority, next_steps, queries_tried,
        strategies_tried, strategies_budget, search_zero_count
      ) values (
        ${userId}, ${newsroomId}, ${investigationId}, ${kindVal}, ${label}, ${norm},
        ${whyVal}, ${evidenceVal},
        ${priorityVal}, ${next},
        ${queriesTriedJson},
        ${JSON.stringify([])},
        ${strategiesBudgetJson},
        ${0}
      )
      on conflict (investigation_id, label_norm) do nothing
      returning id
    `;
    if (created[0]) return;
  } catch {
    /* no matching unique constraint on this database — fall through */
  }
  const raced = await sql<FrontierRow>`
    select id, queries_tried, next_steps, status, evidence, closed_reason, why from frontier_items
    where investigation_id = ${investigationId} and label_norm = ${norm}
    limit 1
  `;
  if (raced[0]) {
    await mergeIntoExisting(raced[0]);
    return;
  }
  await sql`
    insert into frontier_items (
      user_id, newsroom_id, investigation_id, kind, label, label_norm, why, evidence, priority, next_steps, queries_tried,
      strategies_tried, strategies_budget, search_zero_count
    ) values (
      ${userId}, ${newsroomId}, ${investigationId}, ${kindVal}, ${label}, ${norm},
      ${whyVal}, ${evidenceVal},
      ${priorityVal}, ${next},
      ${queriesTriedJson},
      ${JSON.stringify([])},
      ${strategiesBudgetJson},
      ${0}
    )
  `;
}

async function markFrontier(
  _userId: string,
  investigationId: number,
  label: string,
  status: string,
  reason: string,
) {
  const sql = await getSql();
  const { norm } = frontierDedupKey("url", label);
  await sql`
    update frontier_items
    set status = ${status}, closed_reason = ${reason.slice(0, 800)}
    where investigation_id = ${investigationId}
      and label_norm = ${norm}
      and status in ('open', 'investigating', 'reopened')
  `;
}

async function recordStrategyTried(
  userId: string,
  investigationId: number,
  label: string,
  strategyKey: string,
  query: string,
  zero: boolean,
) {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    strategies_tried: string | null;
    strategies_budget: string | null;
    search_zero_count: number | null;
    kind: string;
    queries_tried: string;
  }>`
    select id, strategies_tried, strategies_budget, search_zero_count, kind, queries_tried
    from frontier_items
    where investigation_id = ${investigationId} and label = ${label.slice(0, 240)}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { remaining: remainingStrategies("unknown", label, []), exhausted: false };
  const tried = parseJsonArray(row.strategies_tried);
  if (strategyKey && !tried.includes(strategyKey) && strategyKey !== "adhoc")
    tried.push(strategyKey);
  const queries = parseJsonArray(row.queries_tried);
  if (query && !queries.includes(query)) queries.push(query);
  const budget = parseJsonArray(row.strategies_budget);
  const remaining = remainingStrategies(
    row.kind,
    label,
    tried.length ? tried : budget.length ? tried : [],
  );
  const zeroCount = (row.search_zero_count ?? 0) + (zero ? 1 : 0);
  await sql`
    update frontier_items
    set strategies_tried = ${JSON.stringify(tried)},
        queries_tried = ${JSON.stringify(queries).slice(0, 4000)},
        search_zero_count = ${zeroCount},
        next_steps = ${remaining
          .map((s) => s.query)
          .join(" | ")
          .slice(0, 800)}
    where id = ${row.id}
  `;
  const exhausted =
    row.kind !== "url" && remaining.length === 0 && (tried.length > 0 || budget.length > 0) && zero;
  return { remaining, exhausted };
}

export async function rememberCapture(opts: {
  /** An explicit transaction client; every capture write uses this client. */
  sql?: Sql;
  userId: string;
  investigationId: number | null;
  url: string;
  title: string;
  text: string;
  hash: string;
  status: number;
  outcome: string;
  classification?: string;
  triggerKind?: string;
  monitorId?: number | null;
  redirectChain?: string[];
  contentType?: string;
  extractionMethod?: string;
  pages?: PdfPage[];
  extras?: string[];
  observedAt?: Date;
  rawBytes?: Uint8Array;
  /** Skip automatic monitor creation for an explicit one-off capture. */
  autoWatch?: boolean;
  /**
   * The caller's real newsroom (0.6.13). Threaded down to the `artifacts`
   * and `artifact_blobs` inserts below -- the two tables 0.6.11 claimed were
   * newsroom-scoped here but weren't (audit-lite 0.6.11, FINDING-001).
   * 0.6.23 also threads it into `capture_events` (closing the TODO.md
   * "Known caveats" line about `runDueMonitors`'s prior-capture lookup
   * defaulting to newsroom 1: that lookup reads `capture_events`, so
   * scoping the write is what makes scoping the read mean anything -- see
   * `runDueMonitors` below). Version deduplication and extracted chunks now
   * use this same newsroom: matching URL/hash is not permission to share
   * another newsroom's extraction or provenance.
   */
  newsroomId?: number;
}): Promise<CaptureRecord> {
  const sql = opts.sql ?? await getSql();
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  let url = opts.url;
  try {
    url = canonicalPublicUrl(opts.url);
  } catch {
    /* keep raw */
  }
  const fullText = (opts.text ?? "").slice(0, ARCHIVE_TEXT_CAP);
  // `ingestDocument` cleans its combined text, but page-aware PDF chunks
  // retain their own page strings. Those strings go straight into
  // `artifact_chunks` below, where one NUL makes Postgres reject the whole
  // Dark round after the artifact/version rows were already written.
  const pages = opts.pages?.map((page) => ({ ...page, text: storableText(page.text) }));
  const extractedHash = opts.hash || (await sha256(fullText || url));
  const rawHash =
    opts.rawBytes && opts.rawBytes.byteLength > 0 ? await sha256Bytes(opts.rawBytes) : null;
  const versionHash = rawHash ?? extractedHash;
  // Embedded-image OCR has no PDF page association. Do not persist its image
  // inventory as a page count; native extraction retains its actual pages.
  const pageCount =
    pages?.length && pages.every((p) => p.page != null && p.imageIndex == null)
      ? pages.length
      : null;
  const existing = await sql<{ id: number }>`
    select id from artifact_versions
    where newsroom_id = ${newsroomId} and url = ${url} and content_hash = ${versionHash}
    limit 1
  `;
  let versionId = existing[0]?.id ?? null;
  let createdVersion = false;
  if (!versionId) {
    try {
      const created = await sql<{ id: number }>`
        insert into artifact_versions (
          user_id, newsroom_id, url, content_hash, title, full_text, fetch_status, fetch_outcome,
          content_type, extraction_method, page_count
        ) values (
          ${opts.userId}, ${newsroomId}, ${url}, ${versionHash}, ${opts.title.slice(0, 200)},
          ${fullText}, ${opts.status}, ${opts.outcome},
          ${opts.contentType ?? "html"}, ${opts.extractionMethod ?? ""},
          ${pageCount}
        )
        on conflict (newsroom_id, url, content_hash) do update set title = excluded.title
        returning id
      `;
      versionId = created[0]?.id ?? null;
      createdVersion = Boolean(versionId) && !existing[0];
    } catch {
      const again = await sql<{ id: number }>`
        select id from artifact_versions
        where newsroom_id = ${newsroomId} and url = ${url} and content_hash = ${versionHash}
        limit 1
      `;
      versionId = again[0]?.id ?? null;
      if (!versionId) {
        const created = await sql<{ id: number }>`
          insert into artifact_versions (
            user_id, newsroom_id, url, content_hash, title, full_text, fetch_status, fetch_outcome
          ) values (
            ${opts.userId}, ${newsroomId}, ${url}, ${versionHash}, ${opts.title.slice(0, 200)},
            ${fullText}, ${opts.status}, ${opts.outcome}
          )
          returning id
        `;
        versionId = created[0]?.id ?? null;
        createdVersion = Boolean(versionId);
      }
    }
  }
  if (versionId) {
    try {
      await sql`
        update artifact_versions
        set extracted_sha256 = ${extractedHash}, raw_sha256 = ${rawHash}
        where id = ${versionId} and newsroom_id = ${newsroomId}
      `;
    } catch {
      /* columns may not exist yet */
    }
  }
  if (versionId && (createdVersion || !existing[0]) && fullText) {
    const already = await sql<{ c: number }>`
      select count(*)::int as c from artifact_chunks where version_id = ${versionId} and newsroom_id = ${newsroomId}
    `;
    if ((already[0]?.c ?? 0) === 0) {
      const chunks = chunksFromEvidence(fullText, pages);
      for (const c of chunks) {
        await sql`
          insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, page_number, section, excerpt, locator)
          values (
            ${versionId}, ${opts.userId}, ${newsroomId}, ${c.index}, ${c.page_number},
            ${c.section}, ${c.excerpt}, ${c.locator}
          )
        `;
      }
    }
  }

  const disappearance = opts.outcome === "removed" || opts.outcome === "not-found";
  const soft404 = opts.outcome === "soft-404" || opts.outcome === "removed";
  const observed = (opts.observedAt ?? new Date()).toISOString();
  const cap = await sql<{ id: number }>`
    insert into capture_events (
      user_id, newsroom_id, investigation_id, source_url, observed_at, http_status, fetch_outcome,
      redirect_chain, version_id, disappearance, soft_404, trigger_kind, monitor_id,
      content_hash, content_type, extraction_method
    ) values (
      ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${url}, ${observed}::timestamptz,
      ${opts.status}, ${opts.outcome}, ${JSON.stringify(opts.redirectChain ?? [])},
      ${versionId}, ${disappearance}, ${soft404}, ${opts.triggerKind ?? "investigation"},
      ${opts.monitorId ?? null}, ${versionHash}, ${opts.contentType ?? ""},
      ${opts.extractionMethod ?? ""}
    )
    returning id
  `;
  const captureEventId = cap[0]!.id;

  if (
    versionId &&
    opts.rawBytes &&
    opts.rawBytes.byteLength > 0 &&
    opts.rawBytes.byteLength <= 4_000_000
  ) {
    const alreadyBlob = await sql<{ c: number }>`
      select count(*)::int as c from artifact_blobs where version_id = ${versionId}
    `;
    if ((alreadyBlob[0]?.c ?? 0) === 0) {
      const b64 = Buffer.from(opts.rawBytes).toString("base64");
      try {
        await sql`
          insert into artifact_blobs (
            version_id, user_id, newsroom_id, sha256, mime, original_url, redirect_chain, byte_length, body_b64
          ) values (
            ${versionId}, ${opts.userId}, ${newsroomId}, ${rawHash ?? extractedHash}, ${opts.contentType ?? "application/octet-stream"},
            ${url}, ${JSON.stringify(opts.redirectChain ?? [])}, ${opts.rawBytes.byteLength}, ${b64}
          )
        `;
      } catch {
        /* blob table may not exist on an old process */
      }
    }
  }

  if (opts.investigationId != null) {
    await sql`
      insert into artifacts (
        user_id, newsroom_id, investigation_id, url, title, content_hash, full_text,
        classification, fetch_status, fetch_outcome, version_id, capture_event_id, extraction_method
      ) values (
        ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${url}, ${opts.title.slice(0, 200)},
        ${versionHash}, ${fullText}, ${opts.classification ?? "discovered"},
        ${opts.status}, ${opts.outcome}, ${versionId}, ${captureEventId},
        ${opts.extractionMethod ?? ""}
      )
    `;
  }

  if (
    opts.autoWatch !== false &&
    (opts.outcome === "fetched" || opts.outcome === "changed" || opts.outcome === "unchanged")
  ) {
    await maybeWatch(
      opts.userId,
      url,
      opts.title,
      opts.investigationId,
      versionId,
      opts.extras ?? [],
      opts.text,
      newsroomId,
      sql,
    );
  }

  return { versionId, captureEventId, contentHash: opts.hash, url };
}

/**
 * `newsroomId` (0.6.18) -- `source_monitors` was the last table left
 * hardcoded to `DEFAULT_NEWSROOM_ID` after 0.6.13 threaded the real
 * newsroom through `artifacts`/`artifact_blobs`/`anomalies` (see the
 * removed docstring on `runDueMonitors` below, and TODO.md item 1). Callers
 * pass the same `newsroomId` `rememberCapture` already resolved for this
 * capture, so a monitor created while investigating a newsroom-2 story is
 * filed under newsroom 2, not silently collapsed into newsroom 1.
 */
async function maybeWatch(
  userId: string,
  url: string,
  title: string,
  investigationId: number | null,
  versionId: number | null,
  extras: string[],
  text = "",
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  transactionSql?: Sql,
) {
  const spec = baselineSpec(url, title);
  if (!spec) return;
  const sql = transactionSql ?? await getSql();
  const awaitingTape = /no transcript yet|upcoming live stream/i.test(text);
  const cadenceHours = awaitingTape
    ? 6
    : spec.kind === "meeting"
      ? 24
      : spec.kind === "report"
        ? 48
        : 72;
  const structure = JSON.stringify(structureSnapshot(title, "", extras));
  const existing = await sql<{ id: number }>`
    select id from source_monitors where newsroom_id = ${newsroomId} and url = ${url} limit 1
  `;
  const next = new Date(Date.now() + cadenceHours * 3600 * 1000).toISOString();
  if (existing[0]) {
    await sql`
      update source_monitors
      set title = ${title.slice(0, 200)}, last_version_id = ${versionId},
          last_success_at = now(), last_outcome = ${"fetched"},
          typical_structure = ${structure},
          cadence_hours = ${cadenceHours},
          next_check_at = case
            when ${awaitingTape} then least(next_check_at, ${next}::timestamptz)
            else next_check_at
          end,
          investigation_id = coalesce(investigation_id, ${investigationId})
      where id = ${existing[0].id} and manual_watch = false
    `;
    return;
  }
  await sql`
    insert into source_monitors (
      user_id, newsroom_id, url, title, enabled, cadence_hours, next_check_at, last_success_at,
      last_outcome, last_version_id, expected_cadence_days, importance,
      disappearance_sensitive, investigation_id, typical_structure
    ) values (
      ${userId}, ${newsroomId}, ${url}, ${title.slice(0, 200)}, ${true}, ${cadenceHours},
      ${next}::timestamptz, now(), ${"fetched"},
      ${versionId}, ${Math.round(cadenceHours / 24)}, ${8}, ${true},
      ${investigationId}, ${structure}
    )
    on conflict (newsroom_id, url) do update set last_success_at = now()
  `;
}

/**
 * `newsroomId` (0.6.18) -- see the docstring on `maybeWatch` above. Defaults
 * to `DEFAULT_NEWSROOM_ID` only so existing single-newsroom callers (and
 * this repo's own tests) don't have to pass it; a caller that knows the
 * real newsroom should always pass it explicitly.
 */
export async function watchSource(opts: {
  userId: string;
  url: string;
  title?: string;
  investigationId?: number | null;
  nextCheckAt?: Date;
  cadenceHours?: number;
  newsroomId?: number;
}) {
  const sql = await getSql();
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  let url = opts.url;
  try {
    url = canonicalPublicUrl(opts.url);
  } catch {
    /* keep */
  }
  const cadence = opts.cadenceHours ?? 24;
  const next = (opts.nextCheckAt ?? new Date()).toISOString();
  await sql`
    insert into source_monitors (
      user_id, newsroom_id, url, title, enabled, cadence_hours, next_check_at,
      disappearance_sensitive, investigation_id, importance
    ) values (
      ${opts.userId}, ${newsroomId}, ${url}, ${(opts.title ?? url).slice(0, 200)}, ${true}, ${cadence},
      ${next}::timestamptz, ${true}, ${opts.investigationId ?? null}, ${8}
    )
    on conflict (newsroom_id, url) do update
      set enabled = true,
          next_check_at = excluded.next_check_at,
          investigation_id = coalesce(source_monitors.investigation_id, excluded.investigation_id)
  `;
}

function baselineSpec(url: string, title: string): { key: string; kind: string } | null {
  const blob = `${url} ${title}`.toLowerCase();
  let kind = "";
  if (
    /agenda|minutes|city.?council|board.?meeting|neighborhood.?meeting|primegov|youtube\.com\/watch|youtu\.be\//.test(
      blob,
    )
  ) {
    kind = "meeting";
  } else if (/(water|utility|wastewater|drinking).{0,40}(report|quality)/.test(blob))
    kind = "report";
  else if (/budget|cafr|financial.?report/.test(blob)) kind = "report";
  else if (/staff.?report|packet/.test(blob)) kind = "packet";
  else if (/procurement|purchasing|bid|rfp/.test(blob)) kind = "report";
  else if (/dashboard|dataset|filing|disclosure/.test(blob)) kind = "report";
  else return null;
  let path = url;
  try {
    const u = new URL(url);
    path = u.origin + u.pathname;
  } catch {
    /* keep */
  }
  const key = `${kind}:${path
    .replace(/\/\d{4}([/-]\d{1,2}){0,2}/g, "")
    .replace(/\/\d{4,8}\b/g, "")
    .slice(0, 200)}`;
  return { key, kind };
}

export async function observeBaseline(
  userId: string,
  url: string,
  title: string,
  at?: Date,
  extras: string[] = [],
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const spec = baselineSpec(url, title);
  if (!spec) return;
  const paperConfig = await getPaperConfig(newsroomId);
  const sql = await getSql();
  const prev = await sql<{
    last_seen: string | null;
    sightings: number | null;
    cadence_days: number;
    usual_nth_weekday: string | null;
    usual_attachment_count: number | null;
    usual_lead_hours: number | null;
    typical_structure_json: string | null;
  }>`
    select last_seen::text as last_seen, sightings, cadence_days, usual_nth_weekday,
           usual_attachment_count, usual_lead_hours, typical_structure_json
    from recurring_baselines where newsroom_id = ${newsroomId} and key = ${spec.key} limit 1
  `;
  const now = at ?? new Date();
  let cadence = prev[0]?.cadence_days ?? 30;
  const sightings = (prev[0]?.sightings ?? 0) + 1;
  if (prev[0]?.last_seen) {
    const gap = (now.getTime() - new Date(prev[0].last_seen).getTime()) / 86400000;
    if (gap > 3 && gap < 400) {
      cadence = Math.round(((prev[0].cadence_days || 30) + gap) / 2);
    }
  }
  const weekday = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: paperConfig.timezone,
  });
  const nth = nthWeekday(now, paperConfig.timezone);
  const snap = structureSnapshot(title, "", extras);
  const meeting = extractMeetingInstant(title);
  let lead = prev[0]?.usual_lead_hours ?? null;
  if (meeting) {
    const hours = leadHoursBefore(now, meeting);
    if (hours != null) lead = lead != null ? Math.round((lead + hours) / 2) : hours;
  }
  const seen = now.toISOString();
  if (prev[0]) {
    await sql`
      update recurring_baselines
      set last_seen = ${seen}::timestamptz, typical_title = ${title.slice(0, 200)}, typical_url = ${url.slice(0, 500)},
          cadence_days = ${cadence}, sightings = ${sightings}, usual_weekday = ${weekday},
          usual_nth_weekday = ${nth}, usual_attachment_count = ${snap.attachmentCount},
          usual_lead_hours = ${lead}, typical_structure_json = ${JSON.stringify(snap)}
      where newsroom_id = ${newsroomId} and key = ${spec.key}
    `;
  } else {
    await sql`
      insert into recurring_baselines (
        user_id, newsroom_id, key, kind, cadence_days, last_seen, typical_title, typical_url, sightings,
        usual_weekday, usual_nth_weekday, usual_attachment_count, usual_lead_hours, typical_structure_json
      ) values (
        ${userId}, ${newsroomId}, ${spec.key}, ${spec.kind}, ${cadence}, ${seen}::timestamptz,
        ${title.slice(0, 200)}, ${url.slice(0, 500)}, ${1}, ${weekday}, ${nth},
        ${snap.attachmentCount}, ${lead}, ${JSON.stringify(snap)}
      )
      on conflict (newsroom_id, key) do update set last_seen = excluded.last_seen, sightings = recurring_baselines.sightings + 1
    `;
  }
}

async function flagPatternAnomalies(opts: {
  userId: string;
  investigationId: number | null;
  url: string;
  title: string;
  text: string;
  extras: string[];
  previous: StructureSnapshot | null;
  now: Date;
  /** The caller's real newsroom (0.6.13); see `rememberCapture`'s doc comment. */
  newsroomId?: number;
}): Promise<number> {
  const sql = await getSql();
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  const spec = baselineSpec(opts.url, opts.title);
  let usualNth: string | null = null;
  let usualAtt: number | null = null;
  let usualLead: number | null = null;
  if (spec) {
    const b = await sql<{
      usual_nth_weekday: string | null;
      usual_attachment_count: number | null;
      usual_lead_hours: number | null;
    }>`
      select usual_nth_weekday, usual_attachment_count, usual_lead_hours
      from recurring_baselines where newsroom_id = ${newsroomId} and key = ${spec.key} limit 1
    `;
    usualNth = b[0]?.usual_nth_weekday ?? null;
    usualAtt = b[0]?.usual_attachment_count ?? null;
    usualLead = b[0]?.usual_lead_hours ?? null;
  }
  const meeting = extractMeetingInstant(`${opts.title}\n${opts.text.slice(0, 4000)}`);
  const currentLead = meeting ? leadHoursBefore(opts.now, meeting) : null;
  const current = structureSnapshot(opts.title, opts.text, opts.extras);
  const found = detectPatternAnomalies({
    previous: opts.previous,
    current,
    usualNthWeekday: usualNth,
    observedAt: opts.now,
    usualAttachmentCount: usualAtt,
    usualLeadHours: usualLead,
    currentLeadHours: currentLead,
  });
  for (const a of found) {
    await sql`
      insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
      values (
        ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${a.kind}, ${a.summary.slice(0, 1000)},
        ${opts.url}, ${a.details.slice(0, 2000)}
      )
    `;
  }
  return found.length;
}

export async function retrievePack(
  userId: string,
  investigationId: number,
  terms: string[],
): Promise<string> {
  const sql = await getSql();
  const newsroomId = await investigationNewsroom(investigationId);
  const investigation = await sql<{ title: string }>`
    select title from investigations where newsroom_id = ${newsroomId} and id = ${investigationId} limit 1
  `;
  const compact = (text: string, cap: number) =>
    text.length <= cap ? text : `${text.slice(0, Math.max(0, cap - 27))}\n[section budget reached]`;
  const section = (name: string, text: string, cap: number) => `${name}:\n${compact(text, cap)}`;
  const canonical = (raw: string) => {
    try {
      return canonicalPublicUrl(raw);
    } catch {
      return raw;
    }
  };
  const seedsRaw = await sql<{
    url: string;
    title: string;
    full_text: string;
    fetch_status: number | null;
    fetch_outcome: string | null;
  }>`
    select url, title, full_text, fetch_status, fetch_outcome from artifacts
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} and classification = 'watch'
    order by id asc limit 3
  `;
  const recentRaw = await sql<{
    url: string;
    title: string;
    full_text: string;
    version_id: number | null;
    capture_event_id: number | null;
    content_hash: string;
    fetch_status: number | null;
    fetch_outcome: string | null;
  }>`
    select url, title, full_text, version_id, capture_event_id, content_hash,
      fetch_status, fetch_outcome
    from artifacts
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId}
    order by id desc limit 40
  `;
  // Keep failed captures out of the synthesis pool: a blocked/empty page's
  // text is a paywall notice or a nav shell, not evidence, and feeding it
  // to the model produces claims sourced from an error page (Dark Desk F6).
  const isReadable = (a: {
    full_text: string;
    fetch_status: number | null;
    fetch_outcome: string | null;
    title: string;
  }) =>
    readableCapture({
      text: a.full_text,
      status: a.fetch_status,
      outcome: a.fetch_outcome,
      title: a.title,
    }).kind === "ok";
  const seeds = seedsRaw.filter(isReadable);
  const recent = recentRaw.filter(isReadable);
  // The frontier can be only old navigation URLs; the editor's original
  // question is still a relevant selector for captured evidence.
  const titleTerms = queryTokens(investigation[0]?.title ?? "");
  const lowered = [...terms, ...titleTerms]
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 3);
  const scored = recent
    .map((a) => {
      const blob = `${a.title} ${a.url} ${a.full_text}`.toLowerCase();
      const score = lowered.reduce((s, t) => s + (blob.includes(t) ? 2 : 0), 0);
      return { ...a, score };
    })
    .sort((a, b) => b.score - a.score);
  const picked = [
    ...seeds,
    ...scored.filter((a) => !seeds.some((s) => s.url === a.url)).slice(0, 8),
  ];

  const chunkHitsRaw =
    lowered.length > 0
      ? await sql<{
          excerpt: string;
          page_number: number | null;
          locator: string;
          version_id: number;
          url: string;
          fetch_status: number | null;
          fetch_outcome: string | null;
          title: string | null;
        }>`
          select c.excerpt, c.page_number, c.locator, c.version_id, av.url,
            av.fetch_status, av.fetch_outcome, av.title
          from artifact_chunks c
          join artifact_versions av on av.id = c.version_id
          where av.newsroom_id = ${newsroomId} and c.newsroom_id = ${newsroomId} and exists (
              select 1 from artifacts a
              where a.newsroom_id = ${newsroomId} and a.version_id = av.id and a.investigation_id = ${investigationId}
            )
          order by c.id desc
          limit 80
        `
      : [];
  // Same rule as the artifacts pool above: a chunk from a blocked/empty
  // capture is a paywall notice or an error page, not evidence (Dark Desk
  // F6).
  const chunkHits = chunkHitsRaw.filter((c) =>
    isReadable({
      full_text: c.excerpt,
      fetch_status: c.fetch_status,
      fetch_outcome: c.fetch_outcome,
      title: c.title ?? "",
    }),
  );
  const matchedChunks = chunkHits
    .filter((c) => lowered.some((t) => c.excerpt.toLowerCase().includes(t)))
    .slice(0, 8);

  const frontier = await sql<{
    label: string;
    kind: string;
    why: string;
    priority: number;
    next_steps: string;
    status: string;
  }>`
    select label, kind, why, priority, next_steps, status from frontier_items
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId}
    order by case when status in ('open', 'investigating', 'reopened') then 0 else 1 end,
      priority desc, id asc limit 16
  `;
  const hyps = await sql<{
    body: string;
    status: string;
    supporting: string;
    contradicting: string;
  }>`
    select body, status, supporting, contradicting from hypotheses
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId}
    order by id desc limit 12
  `;
  const ents = await sql<{ name: string; kind: string; why: string; canonical: string }>`
    select e.name, e.kind, e.why, e.canonical
    from investigation_entities ie
    join entities e on e.id = ie.entity_id
    where ie.newsroom_id = ${newsroomId} and e.newsroom_id = ${newsroomId} and ie.investigation_id = ${investigationId}
    order by ie.id desc limit 20
  `;
  const historical = await sql<{
    name: string;
    kind: string;
    why: string;
    investigation_id: number;
    verdict: string | null;
  }>`
    select e.name, e.kind, e.why, ie.investigation_id, m.verdict
    from entities e
    join investigation_entities ie on ie.entity_id = e.id
    left join entity_matches m on m.newsroom_id = ${newsroomId}
      and (
        (m.left_canonical = e.canonical and m.right_canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.newsroom_id = ${newsroomId} and e2.newsroom_id = ${newsroomId} and x.investigation_id = ${investigationId}
        ))
        or (m.right_canonical = e.canonical and m.left_canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.newsroom_id = ${newsroomId} and e2.newsroom_id = ${newsroomId} and x.investigation_id = ${investigationId}
        ))
      )
    where e.newsroom_id = ${newsroomId}
      and ie.newsroom_id = ${newsroomId} and ie.investigation_id <> ${investigationId}
      and (
        e.canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.newsroom_id = ${newsroomId} and e2.newsroom_id = ${newsroomId} and x.investigation_id = ${investigationId}
        )
        or m.id is not null
      )
    order by ie.id desc
    limit 8
  `;
  const rels = await sql<{ from_name: string; to_name: string; kind: string; evidence: string }>`
    select from_name, to_name, kind, evidence from relationships
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} limit 16
  `;
  const claims = await sql<{ body: string; kind: string; evidence: string }>`
    select body, kind, evidence from claims
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 12
  `;
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 10
  `;
  const dead = await sql<{ hypothesis: string; dismissed_because: string }>`
    select hypothesis, dismissed_because from dead_ends
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 8
  `;
  const searches = await sql<{
    query: string;
    state: string | null;
    selected_json: string | null;
    results_json: string | null;
  }>`
    select query, state, selected_json, results_json from search_log
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId} order by id desc limit 24
  `;
  const captured = await sql<{ url: string }>`
    select distinct url from artifacts
    where newsroom_id = ${newsroomId} and investigation_id = ${investigationId}
  `;
  const capturedUrls = new Set(
    captured.flatMap((row) => sanitizePublicUrls([row.url]).map(canonical)),
  );
  const surfacedUrls = new Set<string>();
  const unreadSearchResults: string[] = [];
  for (const search of searches) {
    if (search.state !== "SEARCH_SUCCESS_RESULTS" || unreadSearchResults.length >= 12) continue;
    const titles = new Map<string, string>();
    try {
      const results = JSON.parse(search.results_json || "[]") as unknown;
      if (Array.isArray(results)) {
        for (const result of results) {
          if (!result || typeof result !== "object") continue;
          const item = result as { url?: unknown; title?: unknown };
          if (typeof item.url !== "string") continue;
          for (const url of sanitizePublicUrls([item.url]).map(canonical)) {
            titles.set(url, String(item.title ?? "").replace(/\s+/g, " ").trim().slice(0, 180));
          }
        }
      }
    } catch {
      // A legacy/malformed result record cannot become a planner instruction.
    }
    let perQuery = 0;
    for (const url of sanitizePublicUrls(parseJsonArray(search.selected_json)).map(canonical)) {
      if (perQuery >= 3 || unreadSearchResults.length >= 12) break;
      if (capturedUrls.has(url) || surfacedUrls.has(url)) continue;
      surfacedUrls.add(url);
      perQuery += 1;
      const title = titles.get(url) || "Untitled search result";
      const query = search.query.replace(/\s+/g, " ").trim().slice(0, 300);
      unreadSearchResults.push(`- ${title} — ${url}\n  query: ${query}`);
    }
  }
  const artifactHeads = picked.map((a, index) => {
    const rec = a as { version_id?: number | null; capture_event_id?: number | null; content_hash?: string };
    const sourceUrl = a.url.length <= 220 ? a.url : "[URL omitted: exceeds source-index entry budget]";
    return `[source:${index + 1} capture:${rec.capture_event_id ?? "—"} version:${rec.version_id ?? "—"} hash:${(rec.content_hash ?? "").slice(0, 12)}] ${a.title.slice(0, 120)}\n${sourceUrl}`;
  });
  const sourceIndex = `SOURCES:\n${artifactHeads.join("\n") || "(none)"}`;
  const excerptBudget = Math.max(0, PLANNER_ARTIFACT_CAP - sourceIndex.length - 32 - picked.length * 14);
  const artifactBudget = Math.floor(excerptBudget / Math.max(1, picked.length));
  const excerpts = picked
        .map((a, index) => {
          const rec = a as {
            version_id?: number | null;
            capture_event_id?: number | null;
            content_hash?: string;
          };
          if (artifactBudget <= 0) return "";
          if (a.full_text.length <= artifactBudget) return `[source:${index + 1}] ${a.full_text}`;
          const hits = retrieveRelevantChunks(
            [{ url: a.url, title: a.title, text: a.full_text }],
            [...terms, ...titleTerms],
            {
              budgetChars: artifactBudget,
              perDoc: 6,
            },
          );
          const body =
            hits.map((c) => `[${c.locator}] ${c.excerpt}`).join("\n") ||
            a.full_text.slice(0, artifactBudget);
          return `[source:${index + 1}] ${body}`;
        })
        .join("\n\n");
  const artifacts = `${sourceIndex}\n\nEXCERPTS:\n${excerpts || "(source identities reserved; no excerpt budget)"}`;
  const graph = [
    section("INVESTIGATION", investigation[0]?.title.slice(0, 220) || `Investigation ${investigationId}`, 250),
    section("UNREAD SEARCH RESULTS", unreadSearchResults.join("\n") || "(none)", 1_800),
    section("RELEVANT ARTIFACTS", artifacts, PLANNER_ARTIFACT_CAP),
    section("CHUNK HITS", matchedChunks.map((c) => `[version:${c.version_id} page:${c.page_number ?? "—"} ${c.locator}] ${c.excerpt.slice(0, 500)}`).join("\n") || "(none)", 800),
    section("FRONTIER", frontier.map((f) => `${f.status} ${f.priority} ${f.kind}: ${f.label} — ${f.why}`).join("\n") || "(empty)", 900),
    section("HYPOTHESES", hyps.map((h) => `[${h.status}] ${h.body} pro:${h.supporting} con:${h.contradicting}`).join("\n") || "(none)", PLANNER_HISTORY_CAP),
    section("ENTITIES (this investigation)", ents.map((e) => `${e.kind}: ${e.name} — ${e.why}`).join("\n") || "(none)", 600),
    section("HISTORICAL MATCHES (other investigations, labeled)", historical.map((e) => `[from inv ${e.investigation_id}${e.verdict ? ` ${e.verdict}` : ""}] ${e.kind}: ${e.name} — ${e.why}`).join("\n") || "(none)", PLANNER_HISTORY_CAP),
    section("RELATIONSHIPS", rels.map((r) => `${r.from_name} -[${r.kind}]-> ${r.to_name}`).join("\n") || "(none)", 500),
    section("CLAIMS", claims.map((c) => `${c.kind}: ${c.body}`).join("\n") || "(none)", 500),
    section("ANOMALIES", anoms.map((a) => `${a.kind}: ${a.summary}`).join("\n") || "(none)", 400),
    section("DEAD ENDS", dead.map((d) => `${d.hypothesis} — ${d.dismissed_because}`).join("\n") || "(none)", 400),
    section("SEARCHES", searches.map((s) => `${s.state ?? "unknown"} ${s.query}`).join("\n") || "(none)", 600),
  ].join("\n\n");
  return compact(graph, PLANNER_GRAPH_CAP);
}

export async function findEvidenceChunks(
  userId: string,
  investigationId: number,
  needle: string,
  expectedNewsroom?: number,
) {
  const sql = await getSql();
  const newsroomId = await investigationNewsroom(investigationId, expectedNewsroom);
  const n = needle.toLowerCase();
  return sql<{ excerpt: string; locator: string; page_number: number | null; version_id: number }>`
    select c.excerpt, c.locator, c.page_number, c.version_id
    from artifact_chunks c
    join artifact_versions av on av.id = c.version_id
    where av.newsroom_id = ${newsroomId} and c.newsroom_id = ${newsroomId} and exists (
        select 1 from artifacts a
        where a.version_id = av.id and a.investigation_id = ${investigationId} and a.newsroom_id = ${newsroomId}
      )
      and lower(c.excerpt) like ${"%" + n + "%"}
    order by c.id asc
  `;
}

/** Quoted evidence is in the captured text. Not a citation of an id that happens to exist. */
export function evidenceAppearsInText(evidence: string, text: string): boolean {
  const q = evidence.toLowerCase().replace(/\s+/g, " ").trim();
  if (q.length < 12) return false;
  return text.toLowerCase().replace(/\s+/g, " ").includes(q);
}

export async function researchLoop(opts: ResearchLoopOptions): Promise<ResearchLoopResult> {
  const sql = await getSql();
  const { describeResearchWindow, queryWithResearchWindow } = await import("./dark-preferences.ts");
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  const place: Place = opts.place ?? await getPaperConfig(newsroomId);
  await investigationNewsroom(opts.investigationId, newsroomId);
  const investigation = await sql<{ title: string }>`
    select title from investigations where id = ${opts.investigationId} and newsroom_id = ${newsroomId} limit 1
  `;
  const investigationTitle = investigation[0]?.title ?? "";
  if (opts.executionMode === "responsive" && !opts._responsiveOperation) {
    return responsiveResearchLoop(opts, investigationTitle, place, newsroomId);
  }
  const officialDomainList = opts.officialDomains ?? [];
  const pressDomainList = opts.pressDomains ?? [];
  const hopsBudget = opts.hops ?? HOPS_PER_RUN;
  const fetchDoc = opts.fetch ?? defaultFetch;
  const planner = opts.planner;
  const readSelector = opts.readSelector ?? (!planner ? async (pack: string) => grokPlanner(pack, opts.choice, opts.providerOverrides, place, newsroomId) : undefined);
  const tried = new Set<string>();
  /** Every hop that had to fall back, so the run can say so. */
  const plannerFailures: string[] = [];
  const plannerStartupFailures: string[] = [];
  const selectorFailures: string[] = [];
  const priorQueries = await sql<{ query: string }>`
    select query from search_log where investigation_id = ${opts.investigationId}
  `;
  for (const q of priorQueries) tried.add(queryFingerprint(q.query));

  await sql`
    update investigations
    set status = ${"investigating"}, updated_at = now()
    where id = ${opts.investigationId}
  `;

  let hopsDone = 0;
  let lastSummary = "";
  const fetchedThisRun = new Set<string>();

  function canon(raw: string) {
    try {
      return canonicalPublicUrl(raw);
    } catch {
      return raw;
    }
  }

  async function runSearch(q: string): Promise<SearchAttempt> {
    if (opts.searchAttempt) return opts.searchAttempt(q);
    if (opts.search) {
      try {
        const hits = await opts.search(q);
        return {
          state: hits.length ? "SEARCH_SUCCESS_RESULTS" : "SEARCH_SUCCESS_ZERO_RESULTS",
          hits,
          provider: "injected",
        };
      } catch (err) {
        return {
          state: "SEARCH_FAILED_NETWORK",
          hits: [],
          provider: "injected",
          error: err instanceof Error ? err.message : "search failed",
        };
      }
    }
    return searchWithFallback(q, undefined, {
      officialDomains: officialDomainList,
      localityStopwords: [place.city, place.state, place.county ?? ""],
    });
  }

  for (let hop = 0; hop < hopsBudget; hop++) {
    const openFrontier = await sql<{
      id: number;
      label: string;
      kind: string;
      next_steps: string;
      strategies_tried: string | null;
    }>`
      select id, label, kind, next_steps, strategies_tried from frontier_items
      where investigation_id = ${opts.investigationId}
        and status in ('open', 'investigating', 'reopened')
      order by priority desc limit 16
    `;
    const terms = openFrontier.map((f) => f.label);
    const graph = await retrievePack(opts.userId, opts.investigationId, terms);
    const preferenceContext = opts.preferences ? describeResearchWindow(opts.preferences).slice(0, 2_000) : "";
    const triedContext = [...tried].slice(-40).join("\n").slice(0, 3_000);
    const pack = [
      preferenceContext,
      `INVESTIGATION ${opts.investigationId}. Hop ${hop + 1}. ${place.city}, ${place.state}.`,
      graph,
      `QUERIES ALREADY TRIED:\n${triedContext || "(none)"}`,
      `Generate the NEXT searches and fetches. Follow names, companies, contracts, parcels. Search contradictions. A failed search is not "nothing found." Do not stop after one hop. Cite capture and version IDs from artifacts when making claims.`,
    ].join("\n\n").slice(0, PLANNER_INPUT_CAP);

    let plan: HopPlan;
    if (planner) plan = await planner(pack);
    else {
      const grok = await grokPlanner(pack, opts.choice, opts.providerOverrides, place, newsroomId);
      const heur = heuristicPlan(graph, tried);
      plan = grok.searches.length || grok.fetch_urls.length ? grok : heur;
      if (grok.planner_error) plan.planner_error = grok.planner_error;
      if (!plan.searches.length && heur.searches.length) plan.searches = heur.searches;
      if (!plan.fetch_urls.length && heur.fetch_urls.length) plan.fetch_urls = heur.fetch_urls;
      plan.frontier = [...plan.frontier, ...heur.frontier];
    }

    // Say it out loud. A run that dug with the heuristic must not read like a
    // run that dug with the model.
    if (plan.planner_error) {
      plannerFailures.push(plan.planner_error);
      if (plan.planner_error !== "model replied but the plan had no next step") {
        plannerStartupFailures.push(plan.planner_error);
      }
    }
    lastSummary = plan.summary;

    for (const url of plan.fetch_urls) {
      await persistDiscovery(opts.userId, opts.investigationId, {
        kind: "url",
        label: url,
        why: "Planner fetch target",
        evidence: url,
        priority: 10,
      });
    }
    for (const f of plan.frontier) {
      await persistDiscovery(opts.userId, opts.investigationId, {
        kind: f.kind,
        label: f.label,
        why: f.why,
        priority: f.priority,
        pendingQueries: f.queries,
      });
    }

    const fromFrontier: string[] = [];
    const toFetch = new Set<string>(plan.fetch_urls);
    const currentSearchHits = new Set<string>();
    for (const f of openFrontier) {
      if (f.kind === "url" && /^https?:/i.test(f.label)) {
        toFetch.add(f.label);
        continue;
      }
      let added = 0;
      for (const q of (f.next_steps || "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (q.startsWith("http://") || q.startsWith("https://")) {
          toFetch.add(q);
          continue;
        }
        if (q && !tried.has(queryFingerprint(q)) && added < 1) {
          fromFrontier.push(q);
          added += 1;
        }
      }
    }
    const planned = [...plan.searches, ...fromFrontier].filter(
      (q, i, arr) =>
        q &&
        !tried.has(queryFingerprint(q)) &&
        arr.findIndex((x) => queryFingerprint(x) === queryFingerprint(q)) === i,
    );
    const fill: string[] = [];
    for (const f of openFrontier) {
      if (planned.length + fill.length >= SEARCHES_PER_HOP) break;
      if (f.kind === "url") continue;
      const triedStrats = parseJsonArray(f.strategies_tried);
      for (const s of remainingStrategies(f.kind, f.label, triedStrats)) {
        if (planned.length + fill.length >= SEARCHES_PER_HOP) break;
        const q = s.query;
        if (
          !q ||
          q.startsWith("http://") ||
          q.startsWith("https://") ||
          tried.has(queryFingerprint(q)) ||
          planned.some((p) => queryFingerprint(p) === queryFingerprint(q)) ||
          fill.some((p) => queryFingerprint(p) === queryFingerprint(q))
        ) {
          continue;
        }
        fill.push(q);
      }
    }
    /*
      Search minimums, enforced by the app rather than asked for in prose.

      The operator's Dark Signal Desk requires at least three distinct query
      variations per hypothesis before anything may be written down as "not
      found", and every query location-scoped. The planner is told the same
      thing; this is what happens when it does not comply. Planner queries
      keep their place at the front -- the fill only ever adds what is
      missing.
    */
    const withMinimums = enforceSearchMinimums(
      planned,
      plan.hypotheses.map((h) => h.text).filter(Boolean),
      place,
    ).filter((q) => !tried.has(queryFingerprint(q)));
    const queries = [...withMinimums, ...fill].map((q) => queryWithResearchWindow(q, opts.preferences)).filter((q) => !tried.has(queryFingerprint(q))).slice(0, SEARCHES_PER_HOP);

    /*
      A provider startup failure is not a research hop when its fallback
      cannot produce even one source action. Retrying that identical empty
      fallback to the full hop budget only consumes the editor's run while
      creating no search receipt or capture. A completed zero-result search,
      by contrast, still has a query and continues through the normal path.
    */
    const hasSourceAction =
      queries.length > 0 ||
      [...toFetch].some((url) => !fetchedThisRun.has(canon(url)));
    if (plan.planner_error && !hasSourceAction) {
      lastSummary = `Planner could not start research: ${plan.planner_error}`;
      break;
    }

    const selectedThisHop: string[] = [];
    const fetchedThisHop: string[] = [];
    const thisHopEvidenceNames: string[] = [];
    let postSearchPlan: HopPlan | null = null;
    let postSearchFailure = "";

    for (const q of queries) {
      tried.add(queryFingerprint(q));
      const attempt = await runSearch(q);
      const selected = attempt.hits.slice(0, 6).map((h) => h.url);
      selectedThisHop.push(...selected);
      const fp = queryFingerprint(q);
      const matchedFrontier = openFrontier.find(
        (f) =>
          q.toLowerCase().includes(f.label.toLowerCase().slice(0, 24)) ||
          strategyKeyForQuery(f.kind, f.label, q) !== "adhoc",
      );
      const strategy = matchedFrontier
        ? strategyKeyForQuery(matchedFrontier.kind, matchedFrontier.label, q)
        : "adhoc";
      /*
        Which tier answered: the paper's own official record, local press, or
        the community. Taken from the URL that actually came back where one
        did, and from what the query was aiming at where nothing did — a
        query nobody answered still says which kind of source was tried.
      */
      const tier = selected[0]
        ? tierForUrl(selected[0], officialDomainList, pressDomainList)
        : tierForQuery(q, officialDomainList);
      const logRows = await sql<{ id: number }>`
        insert into search_log (
          user_id, newsroom_id, investigation_id, hop, query, results_json, provider, state, caused_by,
          frontier_id, strategy, selected_json, query_fingerprint, research_question, tier
        )
        values (
          ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${hop + 1}, ${q.slice(0, 300)},
          ${JSON.stringify(attempt.hits).slice(0, 8000)},
          ${attempt.provider}, ${attempt.state}, ${plan.summary.slice(0, 200)},
          ${matchedFrontier?.id ?? null}, ${strategy},
          ${JSON.stringify(selected).slice(0, 4000)}, ${fp}, ${plan.questions[0] ?? plan.summary.slice(0, 200)},
          ${tier}
        )
        returning id
      `;
      const logId = logRows[0]?.id ?? null;
      const lineage = attempt.lineage?.length ? attempt.lineage : [attempt];
      const assessedStep = [...lineage].reverse().find((step) => step.state === "SEARCH_SUCCESS_RESULTS");
      for (const step of lineage) {
        // Keep the aggregate discovery assessment with a successful attempt,
        // not in place of a later provider's real failure. This is metadata,
        // not a factual judgment about any document that was not captured.
        const relevance = step === assessedStep ? attempt.relevance : step.relevance;
        const warnings = [...new Set([...(step.warnings ?? []), ...(relevance ? attempt.warnings ?? [] : [])])];
        await sql`
          insert into search_attempts (
            user_id, newsroom_id, investigation_id, search_log_id, frontier_id, query, provider, state, hits_json, error
          ) values (
            ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${logId}, ${matchedFrontier?.id ?? null},
            ${q.slice(0, 300)}, ${step.provider}, ${step.state},
            ${JSON.stringify(step.hits).slice(0, 8000)},
            ${step.error ?? (warnings.length || relevance || step.available !== undefined || step.complete !== undefined || step.nextCursor !== undefined
              ? `search-metadata:${JSON.stringify({ warnings, available: step.available ?? null, complete: step.complete ?? null, next_cursor: step.nextCursor ?? null, relevance: relevance ?? null }).slice(0, 1800)}`
              : null)}
          )
        `;
      }
      if (
        attempt.state !== "SEARCH_SUCCESS_RESULTS" &&
        attempt.state !== "SEARCH_SUCCESS_ZERO_RESULTS"
      ) {
        await sql`
          insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, details)
          values (
            ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${"search-failed"},
            ${`Search ${attempt.state} via ${attempt.provider}: ${q.slice(0, 180)}`},
            ${attempt.error ?? attempt.state}
          )
        `;
      }
      for (const hit of attempt.hits.slice(0, 6)) {
        const degraded = attempt.relevance?.decision === "degraded";
        if (!degraded && attempt.state === "SEARCH_SUCCESS_RESULTS" && opts._responsiveOperation !== "search") {
          toFetch.add(hit.url);
          currentSearchHits.add(hit.url);
        }
        await persistDiscovery(opts.userId, opts.investigationId, {
          kind: "url",
          label: hit.url,
          why: `Search hit for ${q}`,
          evidence: hit.title,
          priority: 9,
          query: q,
        });
        if (degraded) {
          await markFrontier(
            opts.userId,
            opts.investigationId,
            hit.url,
            "deferred",
            "Search relevance degraded — saved without spending a fetch slot",
          );
        }
      }
      for (const f of openFrontier) {
        if (
          q.toLowerCase().includes(f.label.toLowerCase().slice(0, 24)) ||
          strategyKeyForQuery(f.kind, f.label, q) !== "adhoc"
        ) {
          await sql`
            update frontier_items set status = 'investigating'
            where investigation_id = ${opts.investigationId}
              and label = ${f.label} and status in ('open', 'reopened')
          `;
          await persistDiscovery(opts.userId, opts.investigationId, {
            kind: f.kind,
            label: f.label,
            why: "query attempted",
            query: q,
          });
          if (attempt.state === "SEARCH_SUCCESS_ZERO_RESULTS") {
            const rec = await recordStrategyTried(
              opts.userId,
              opts.investigationId,
              f.label,
              strategyKeyForQuery(f.kind, f.label, q),
              q,
              true,
            );
            if (rec.exhausted) {
              await markFrontier(
                opts.userId,
                opts.investigationId,
                f.label,
                "exhausted",
                `All research strategies attempted; last zero for ${q}`,
              );
            }
          } else if (attempt.state === "SEARCH_SUCCESS_RESULTS") {
            await recordStrategyTried(
              opts.userId,
              opts.investigationId,
              f.label,
              strategyKeyForQuery(f.kind, f.label, q),
              q,
              false,
            );
          }
        }
      }
    }

    if (readSelector && currentSearchHits.size > 0) {
      const hitContext = [...currentSearchHits].slice(0, 6).map((url) => `SEARCH RESULT URL: ${url}`).join("\n");
      try {
        postSearchPlan = await readSelector([
          await retrievePack(opts.userId, opts.investigationId, terms),
          `POST-SEARCH RESULTS (untrusted candidates; read before citing):\n${hitContext}`,
          "Choose only the next URLs worth reading from these available results. Do not treat result titles or snippets as factual proof. Return no searches; existing search and fetch caps remain in force.",
        ].join("\n\n"));
        if (postSearchPlan.planner_error) {
          postSearchFailure = postSearchPlan.planner_error;
          selectorFailures.push(postSearchFailure);
          postSearchPlan = null;
        }
        for (const url of postSearchPlan?.fetch_urls.slice(0, FETCHES_PER_HOP) ?? []) {
          if (sanitizePublicUrls([url]).length) toFetch.add(url);
        }
        if (postSearchPlan) await persistPlan(opts.userId, opts.investigationId, postSearchPlan, newsroomId);
      } catch (err) {
        postSearchFailure = err instanceof Error ? err.message : "post-search selector failed";
        selectorFailures.push(postSearchFailure);
      }
    }

    let redditFetchesThisHop = 0;
    // Give successful discovery one of the existing four fetch opportunities.
    // Otherwise older planner/frontier links can consume every hop indefinitely
    // while the search result the investigation needs stays unread. Remaining
    // slots retain the ordinary queue, including explicit planner fetches.
    let searchSlotUsed = false;
    const selectedReads = postSearchPlan?.fetch_urls
      .map(canon)
      .filter((url, i, arr) => arr.indexOf(url) === i && !fetchedThisRun.has(url)) ?? [];
    const fetchLimit = opts._responsiveOperation ? 1 : FETCHES_PER_HOP;
    while (fetchedThisHop.length < fetchLimit) {
      const discovery = selectedReads[0] ?? (opts._responsiveOperation !== "search" && !searchSlotUsed
        ? sanitizePublicUrls([...currentSearchHits]).map(canon).find((u) => !fetchedThisRun.has(u))
        : undefined);
      const url = [
        ...new Set(
          sanitizePublicUrls(discovery ? [discovery, ...toFetch] : [...toFetch])
            .map(canon)
            .filter((u) => !fetchedThisRun.has(u)),
        ),
      ][0];
      if (!url) break;
      if (url === discovery) {
        searchSlotUsed = true;
        selectedReads.shift();
      }
      fetchedThisRun.add(url);
      fetchedThisHop.push(url);

      let isReddit = false;
      try {
        isReddit = isRedditUrl(new URL(url));
      } catch {
        isReddit = false;
      }
      /*
        Dark Desk F5: reddit's anonymous rate limit is per IP, so this hop
        (and every other hop, and the tip-subreddit scan — see
        reddit.server.ts's module-level pacing clock) must never burn
        through more than a small number of reddit requests at once. 3 is a
        deliberately conservative per-hop cap: FETCHES_PER_HOP is 4, so this
        still leaves room for at least one non-reddit fetch even on an
        all-reddit hop, and pairs with the >=8s pacing inside
        fetchRedditDocument to keep total reddit traffic well under
        Reddit's ~10/min budget across a whole run.
      */
      if (isReddit && redditFetchesThisHop >= REDDIT_FETCHES_PER_HOP_CAP) {
        await persistDiscovery(opts.userId, opts.investigationId, {
          kind: "url",
          label: url,
          why: `Reddit fetch cap (${REDDIT_FETCHES_PER_HOP_CAP} per hop) reached — deferred to respect Reddit's per-IP rate limit`,
          evidence: url,
          priority: 8,
        });
        await markFrontier(
          opts.userId,
          opts.investigationId,
          url,
          "deferred",
          "Reddit fetch cap reached this hop",
        );
        continue;
      }
      if (isReddit) redditFetchesThisHop += 1;

      await persistDiscovery(opts.userId, opts.investigationId, {
        kind: "url",
        label: url,
        why: "Queued for fetch",
        evidence: url,
        priority: 10,
      });
      const priorCap = await sql<{
        content_hash: string | null;
        fetch_status: number | null;
        full_text: string | null;
      }>`
        select ce.content_hash, ce.http_status as fetch_status, av.full_text
        from capture_events ce
        left join artifact_versions av on av.id = ce.version_id and av.newsroom_id = ce.newsroom_id
        where ce.newsroom_id = ${newsroomId} and ce.source_url = ${url}
        order by ce.id desc limit 1
      `;
      const prior =
        priorCap[0] ??
        (
          await sql<{ content_hash: string; full_text: string; fetch_status: number | null }>`
            select content_hash, full_text, fetch_status from artifact_versions
            where newsroom_id = ${newsroomId} and url = ${url}
            order by id desc limit 1
          `
        )[0];
      const got = asFetched(await fetchDoc(url), url);
      const hash = got.ok ? await sha256(got.text) : "missing";
      const classified = classifyFetchedPage({
        status: got.status,
        title: got.title,
        text: got.text,
        priorHash: prior?.content_hash,
        priorStatus: prior?.fetch_status,
        newHash: hash,
      });
      const outcome: FetchOutcome = got.outcome === "needs-ocr" ? "needs-ocr" : classified;
      await rememberCapture({
        userId: opts.userId,
        investigationId: opts.investigationId,
        url,
        title: got.title || url,
        text: got.text,
        hash,
        status: got.status,
        outcome,
        redirectChain: got.redirectChain,
        contentType: got.contentType,
        extractionMethod: got.extractionMethod,
        pages: got.pages,
        extras: got.extras,
        rawBytes: got.rawBytes,
        classification: got.classification ?? "discovered",
        newsroomId,
      });

      if (outcome === "unchanged") {
        await markFrontier(opts.userId, opts.investigationId, url, "resolved", "Unchanged capture");
        continue;
      }

      if (outcome === "removed" || outcome === "not-found" || outcome === "soft-404") {
        if (prior && prior.fetch_status === 200) {
          await sql`
            insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
            values (
              ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${"disappeared"},
              ${`Previously captured document is gone: ${url}`},
              ${url},
              ${`Prior hash ${prior.content_hash}. Outcome ${outcome}. Status ${got.status}. Original version retained.`}
            )
          `;
          const follow = [
            `"${url}" (wayback OR archive.org OR relocated OR moved)`,
            `${(got.title || "document").slice(0, 80)} ${place.city} (replacement OR "no longer" OR cancelled)`,
          ];
          for (const q of follow) {
            await persistDiscovery(opts.userId, opts.investigationId, {
              kind: "missing-record",
              label: q.slice(0, 240),
              why: `Follow-up after ${outcome} of ${url}`,
              evidence: url,
              priority: 12,
              query: q,
            });
          }
          try {
            const copies = opts.archives ? await opts.archives(url) : await waybackCopies(url);
            for (const c of copies.slice(0, 3)) {
              toFetch.add(c);
              await persistDiscovery(opts.userId, opts.investigationId, {
                kind: "url",
                label: c,
                why: `Archive copy after disappearance of ${url}`,
                evidence: url,
                priority: 12,
              });
            }
          } catch {
            /* archive optional */
          }
        }
        await markFrontier(opts.userId, opts.investigationId, url, "exhausted", outcome);
        continue;
      }

      if (outcome === "needs-ocr") {
        await persistDiscovery(opts.userId, opts.investigationId, {
          kind: "url",
          label: url,
          why: "Scanned or image-only document — OCR incomplete; keep investigating",
          evidence: (got.text || url).slice(0, 400),
          priority: 10,
        });
        if (got.text && got.text.trim().length >= 40) {
          /* fall through and treat available text as evidence */
        } else {
          continue;
        }
      }

      if (!got.ok && outcome !== "needs-ocr") {
        await persistDiscovery(opts.userId, opts.investigationId, {
          kind: "url",
          label: url,
          why: `Fetch ${outcome} — deferred, not closed`,
          evidence: url,
          priority: 8,
        });
        await markFrontier(opts.userId, opts.investigationId, url, "deferred", `Fetch ${outcome}`);
        continue;
      }

      if (outcome === "changed" && prior?.full_text) {
        const delta = diffExcerpt(prior.full_text, got.text);
        if (delta) {
          await sql`
            insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
            values (
              ${opts.userId}, ${newsroomId}, ${opts.investigationId}, ${"changed"},
              ${`Document changed: ${url}`}, ${url}, ${delta.slice(0, 4000)}
            )
          `;
        }
        let prevSnap: StructureSnapshot | null = null;
        try {
          // source_monitors is now newsroom-scoped (0.6.18) -- key this
          // lookup off the same `newsroomId` watchSource/maybeWatch write
          // the row under, not the default.
          const mon = await sql<{ typical_structure: string | null }>`
            select typical_structure from source_monitors where newsroom_id = ${newsroomId} and url = ${url} limit 1
          `;
          if (mon[0]?.typical_structure)
            prevSnap = JSON.parse(mon[0].typical_structure) as StructureSnapshot;
        } catch {
          prevSnap = null;
        }
        await flagPatternAnomalies({
          userId: opts.userId,
          investigationId: opts.investigationId,
          url,
          title: got.title || url,
          text: got.text,
          extras: got.extras,
          previous: prevSnap,
          now: new Date(),
          newsroomId,
        });
      }

      await observeBaseline(opts.userId, url, got.title, undefined, got.extras, newsroomId);
      await markFrontier(opts.userId, opts.investigationId, url, "resolved", "Fetched");
      for (const extra of got.extras.slice(0, 6)) {
        let extraPath = extra;
        try {
          const parsedExtra = new URL(extra);
          extraPath = `${decodeURIComponent(parsedExtra.pathname)} ${decodeURIComponent(parsedExtra.search)}`;
        } catch {
          // Invalid encodings and non-URLs fail closed instead of borrowing relevance from a hostname.
          extraPath = "";
        }
        const extraTokens = new Set(queryTokens(extraPath));
        const contextTokens = new Set(queryTokens([investigationTitle, ...plan.questions, ...queries].join(" ")));
        const shared = [...extraTokens].filter((token) => contextTokens.has(token));
        const documentTarget =
          /\.(?:pdf|docx?|xlsx?|csv)(?:\s|$)/i.test(extraPath) ||
          /\/(?:documentcenter\/view|api\/document)\/\d+(?:\/|\s|$)/i.test(extraPath) ||
          /\/download(?:\s|$)[^\n]*\bid=\d+/i.test(extraPath);
        const relevantExtra = documentTarget || shared.length >= 2;
        if (relevantExtra) toFetch.add(extra);
        await persistDiscovery(opts.userId, opts.investigationId, {
          kind: "url",
          label: extra,
          why: `Attachment/document link on ${url}`,
          evidence: url,
          priority: 11,
        });
        if (!relevantExtra) {
          await markFrontier(
            opts.userId,
            opts.investigationId,
            extra,
            "deferred",
            "Attachment link did not match enough investigation terms",
          );
        }
      }
      const refs = extractReferences(got.text);
      await addFrontierFromRefs(opts.userId, opts.investigationId, refs, url);
      for (const ref of refs) thisHopEvidenceNames.push(ref.value);
      if (got.title) thisHopEvidenceNames.push(got.title);
    }

    for (const extra of sanitizePublicUrls([...toFetch])) {
      const leftover = canon(extra);
      if (fetchedThisRun.has(leftover)) continue;
      await persistDiscovery(opts.userId, opts.investigationId, {
        kind: "url",
        label: leftover,
        why: "Discovered this hop — fetch next",
        evidence: leftover,
        priority: 10,
      });
    }

    await persistPlan(opts.userId, opts.investigationId, plan, newsroomId);
    await resurfaceDeadEnds(opts.userId, opts.investigationId, thisHopEvidenceNames);

    if (queries.length) {
      await sql`
        update search_log
        set fetched_json = ${JSON.stringify(fetchedThisHop).slice(0, 4000)},
            generated_json = ${JSON.stringify({
              entities: plan.entities.map((e) => e.name),
              urls: plan.fetch_urls,
              questions: plan.questions,
              post_search_selected: postSearchPlan?.fetch_urls.slice(0, FETCHES_PER_HOP) ?? [],
              post_search_failure: postSearchFailure || null,
              post_search_reason: postSearchPlan?.summary?.slice(0, 400) ?? null,
            }).slice(0, 4000)}
        where investigation_id = ${opts.investigationId} and hop = ${hop + 1}
      `;
    }

    hopsDone += 1;
    await sql`
      update investigations
      set hops = hops + 1, summary = ${lastSummary.slice(0, 2500)}, updated_at = now()
      where id = ${opts.investigationId}
    `;

    const open = await sql<{ c: number }>`
      select count(*)::int as c from frontier_items
      where investigation_id = ${opts.investigationId}
        and status in ('open', 'investigating', 'reopened')
    `;
    if (plan.stop && (open[0]?.c ?? 0) === 0) break;
  }

  const open = await sql<{ c: number }>`
    select count(*)::int as c from frontier_items
    where investigation_id = ${opts.investigationId}
      and status in ('open', 'investigating', 'reopened')
  `;
  const artsN = await sql<{ c: number }>`
    select count(*)::int as c from artifacts
    where investigation_id = ${opts.investigationId}
  `;
  const paused = (open[0]?.c ?? 0) > 0;
  const pauseReason = paused
    ? `Hop budget ${hopsBudget} reached with ${open[0]!.c} frontier item(s) still open. Budget pauses work; evidence exhaustion would close it.`
    : "";
  await sql`
    update investigations
    set status = ${paused ? "paused" : "open"},
        pause_reason = ${pauseReason || null},
        updated_at = now()
    where id = ${opts.investigationId}
  `;
  /*
    A run that dug with the heuristic must not read like a run that dug with
    the model. The whole database had zero entities, claims and hypotheses
    while every summary described a successful dig.
  */
  const fellBack = plannerFailures.length && hopsDone > 0
    ? `
Planner fell back on ${plannerFailures.length} of ${hopsDone} hop${hopsDone === 1 ? "" : "s"}: ${[...new Set(plannerFailures)].join("; ")}`
    : plannerFailures.length
      ? `
Planner could not start research: ${[...new Set(plannerFailures)].join("; ")}`
      : "";

  return {
    hops: hopsDone,
    artifacts: artsN[0]?.c ?? 0,
    frontier: open[0]?.c ?? 0,
    paused,
    summary: lastSummary + fellBack + (selectorFailures.length ? `\nPost-search read selection fell back to the ordinary queue: ${[...new Set(selectorFailures)].join("; ")}` : ""),
    plannerFailures: plannerFailures.length,
    plannerStartupFailures: plannerStartupFailures.length,
  };
}

async function defaultResearchActionChooser(
  context: string,
  opts: Pick<ResearchLoopOptions, "choice" | "providerOverrides" | "newsroomId">,
): Promise<ResearchAction> {
  const { callMs } = providerBudget(opts.choice, opts.providerOverrides);
  const ai = await grokChat(
    "You operate TownReporter's bounded responsive research loop. Choose exactly one typed action from the supplied protocol. Never claim evidence from a search snippet.",
    context.slice(0, PLANNER_INPUT_CAP),
    900,
    {
      timeoutMs: callMs,
      model: plannerModel(opts.choice),
      choice: opts.choice,
      newsroomId: opts.newsroomId,
      localModel: opts.providerOverrides?.["local-model"]?.localModel,
      noTools: true,
    },
  );
  if (!ai.ok) throw new Error("error" in ai ? ai.error : "responsive action model returned no response");
  return parseResearchAction(ai.text);
}

async function responsiveResearchLoop(
  opts: ResearchLoopOptions,
  investigationTitle: string,
  place: Place,
  newsroomId: number,
): Promise<ResearchLoopResult> {
  const sql = await getSql();
  const requestedLimit = Number.isFinite(opts.actionLimit) ? Math.trunc(opts.actionLimit!) : 6;
  const limit = Math.max(1, Math.min(24, requestedLimit));
  const choose = opts.actionChooser ?? ((context: string) => defaultResearchActionChooser(context, {
    choice: opts.choice,
    providerOverrides: opts.providerOverrides,
    newsroomId,
  }));
  const receipts: ResearchActionReceipt[] = [];
  const contextTerms = [investigationTitle];
  let aggregateHops = 0;
  let summary = "";

  async function capturedPageLinks(): Promise<string[]> {
    const rows = await sql<{ label: string }>`
      select label from frontier_items
      where investigation_id = ${opts.investigationId}
        and why like 'Attachment/document link on %'
      order by priority desc, id desc limit 24
    `;
    return sanitizePublicUrls(rows.map((row) => row.label));
  }

  async function knownRead(url: string): Promise<boolean> {
    const rows = await sql<{ c: number }>`
      select count(*)::int as c from frontier_items
      where investigation_id = ${opts.investigationId} and label = ${url}
    `;
    return (rows[0]?.c ?? 0) > 0;
  }

  for (let decision = 1; decision <= limit; decision++) {
    const availableLinks = await capturedPageLinks();
    const graph = await retrievePack(opts.userId, opts.investigationId, contextTerms.slice(-24));
    const context = responsiveActionPrompt({
      investigation: `INVESTIGATION ${opts.investigationId}: ${investigationTitle}. ${place.city}, ${place.state}.\n${graph}`.slice(0, PLANNER_INPUT_CAP),
      receiptHistory: receipts,
      availableLinks,
      decision,
      limit,
    });
    let action: ResearchAction;
    try {
      action = await choose(context);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "responsive action selection failed";
      receipts.push({ decision, action: { type: "finish", summary: detail, findings: [] }, outcome: "decision-failed", detail, links: [] });
      summary = `Responsive research stopped because decision ${decision} failed: ${detail}`;
      break;
    }

    if (action.type === "finish") {
      const plan = emptyPlan();
      plan.summary = action.summary || "Responsive research finished.";
      plan.stop = true;
      plan.claims = action.findings.map((finding) => ({
        text: finding.text,
        kind: "FACT",
        evidence: finding.text,
        source_url: finding.evidenceUrl ?? "",
      }));
      await persistPlan(opts.userId, opts.investigationId, plan, newsroomId);
      summary = durableResponsiveSummary(plan.summary, receipts);
      const counts = await responsiveCounts(opts.investigationId);
      await sql`update investigations set status = 'open', pause_reason = null, summary = ${summary.slice(0, 2500)}, updated_at = now() where id = ${opts.investigationId} and newsroom_id = ${newsroomId}`;
      return { ...counts, hops: aggregateHops, paused: false, summary, plannerFailures: 0, plannerStartupFailures: 0, actionDecisions: decision, finished: true };
    }

    const safeUrl = action.type === "search" ? "" : sanitizePublicUrls([action.url])[0];
    if (action.type !== "search" && !safeUrl) {
      receipts.push({ decision, action, outcome: "invalid-url", detail: "URL was not an allowed public URL", links: [] });
      continue;
    }
    if (action.type === "read" && !(await knownRead(safeUrl!))) {
      receipts.push({ decision, action, outcome: "not-discovered", detail: "Read target was not present in the app's discovered frontier", links: [] });
      continue;
    }
    if (action.type === "follow" && !availableLinks.includes(safeUrl!)) {
      receipts.push({ decision, action, outcome: "not-captured-link", detail: "Follow target was not found in a captured page", links: availableLinks });
      continue;
    }

    let searchReceipt: Awaited<ReturnType<SearchAttemptFn>> | null = null;
    let fetchReceipt: Awaited<ReturnType<FetchFn>> | null = null;
    const plan = emptyPlan();
    plan.summary = action.reason || `${action.type} action`;
    contextTerms.push(action.reason);
    if (action.type === "search") {
      plan.searches = [action.query];
      contextTerms.push(action.query);
    } else plan.fetch_urls = [safeUrl!];
    const operationResult = await researchLoop({
      ...opts,
      executionMode: "batch",
      hops: 1,
      readSelector: undefined,
      planner: async () => plan,
      _responsiveOperation: action.type,
      searchAttempt: async (query) => {
        if (opts.searchAttempt) searchReceipt = await opts.searchAttempt(query);
        else if (opts.search) {
          try {
            const hits = await opts.search(query);
            searchReceipt = { state: hits.length ? "SEARCH_SUCCESS_RESULTS" : "SEARCH_SUCCESS_ZERO_RESULTS", hits, provider: "injected" };
          } catch (err) {
            searchReceipt = { state: "SEARCH_FAILED_NETWORK", hits: [], provider: "injected", error: err instanceof Error ? err.message : "search failed" };
          }
        } else {
          searchReceipt = await searchWithFallback(query, undefined, {
            officialDomains: opts.officialDomains ?? [],
            localityStopwords: [place.city, place.state, place.county ?? ""],
          });
        }
        return searchReceipt;
      },
      fetch: async (url) => {
        fetchReceipt = asFetched(await (opts.fetch ?? defaultFetch)(url), url);
        return fetchReceipt;
      },
    });
    aggregateHops += operationResult.hops;
    if (action.type === "search") {
      const attempt = searchReceipt as Awaited<ReturnType<SearchAttemptFn>> | null;
      const described = describeResponsiveSearchReceipt(attempt);
      receipts.push({
        decision,
        action,
        outcome: described.outcome,
        detail: described.detail,
        links: sanitizePublicUrls(attempt?.hits.map((hit) => hit.url) ?? []),
      });
    } else {
      const capture = await sql<{ fetch_outcome: string; http_status: number | null }>`
        select fetch_outcome, http_status from capture_events
        where investigation_id = ${opts.investigationId} and newsroom_id = ${newsroomId} and source_url = ${safeUrl}
        order by id desc limit 1
      `;
      const fetched = fetchReceipt as Awaited<ReturnType<FetchFn>> | null;
      receipts.push({
        decision,
        action,
        outcome: capture[0]?.fetch_outcome ?? fetched?.outcome ?? (fetched?.ok ? "captured" : "fetch-failed"),
        detail: actionReceiptExcerpt(fetched?.text ?? "", contextTerms) || `HTTP ${capture[0]?.http_status ?? fetched?.status ?? 0}`,
        links: sanitizePublicUrls(fetched?.extras ?? []),
      });
    }
  }

  const counts = await responsiveCounts(opts.investigationId);
  summary = durableResponsiveSummary(summary || `Responsive research reached its decision limit ${limit} without an explicit finish.`, receipts);
  await sql`update investigations set status = 'paused', pause_reason = ${summary}, summary = ${summary.slice(0, 2500)}, updated_at = now() where id = ${opts.investigationId} and newsroom_id = ${newsroomId}`;
  return { ...counts, hops: aggregateHops, paused: true, summary, plannerFailures: 0, plannerStartupFailures: 0, actionDecisions: receipts.length, finished: false };
}

function describeResponsiveSearchReceipt(
  attempt: Awaited<ReturnType<SearchAttemptFn>> | null,
): { outcome: string; detail: string } {
  if (!attempt) return { outcome: "SEARCH_FAILED_NETWORK", detail: "Search returned no attempt receipt" };
  const relevance = attempt.relevance;
  const outcome = relevance?.decision === "degraded"
    ? `${attempt.state}_DEGRADED`
    : attempt.state;
  const failedProviders = (attempt.lineage ?? [])
    .filter((step) => step.state !== "SEARCH_SUCCESS_RESULTS" && step.state !== "SEARCH_SUCCESS_ZERO_RESULTS")
    .slice(0, 4)
    .map((step) => `${step.provider}:${step.errorCode ?? step.state}${step.error ? ` (${step.error})` : ""}`);
  const parts = [
    `${attempt.hits.length} result(s) discovered; none read`,
    relevance ? `relevance=${relevance.decision}: ${relevance.reason}` : "",
    failedProviders.length ? `provider failures: ${failedProviders.join("; ")}` : "",
    attempt.error ? `aggregate error: ${attempt.error}` : "",
  ].filter(Boolean);
  return { outcome, detail: parts.join(" | ").slice(0, 1_200) };
}

function actionReceiptExcerpt(text: string, terms: string[]): string {
  if (!text) return "";
  const needles = [...new Set(queryTokens(terms.join(" ")).filter((term) => term.length >= 4))];
  const lower = text.toLowerCase();
  const starts = needles.flatMap((needle) => {
    const at = lower.indexOf(needle.toLowerCase());
    return at >= 0 ? [Math.max(0, at - 240)] : [];
  });
  if (!starts.length) return text.slice(0, 1_500);
  return [...new Set(starts)].slice(0, 3).map((start) => text.slice(start, start + 500)).join("\n…\n").slice(0, 1_500);
}

function durableResponsiveSummary(summary: string, receipts: ResearchActionReceipt[]): string {
  const trail = receipts.map((receipt) =>
    `${receipt.decision}:${receipt.action.type}:${receipt.outcome} ${receipt.detail.replace(/\s+/g, " ").slice(0, 180)}`,
  ).join("\n");
  return `${summary}\n\nResponsive action receipts:\n${trail || "(finish selected before an operation)"}`.slice(0, 2_500);
}

async function responsiveCounts(investigationId: number): Promise<{ artifacts: number; frontier: number }> {
  const sql = await getSql();
  const [artifacts, frontier] = await Promise.all([
    sql<{ c: number }>`select count(*)::int as c from artifacts where investigation_id = ${investigationId}`,
    sql<{ c: number }>`select count(*)::int as c from frontier_items where investigation_id = ${investigationId} and status in ('open', 'investigating', 'reopened')`,
  ]);
  return { artifacts: artifacts[0]?.c ?? 0, frontier: frontier[0]?.c ?? 0 };
}

async function resolveProvenance(
  userId: string,
  investigationId: number,
  hint: EvidenceHint,
  expectedNewsroom: number,
): Promise<{
  versionId: number | null;
  captureEventId: number | null;
  sourceUrl: string | null;
  contentHash: string | null;
  capturedAt: string | null;
  status: "resolved" | "unresolved";
  locator: string | null;
}> {
  const sql = await getSql();
  const unresolved = {
    versionId: null as number | null,
    captureEventId: null as number | null,
    sourceUrl: hint.source_url ?? null,
    contentHash: null as string | null,
    capturedAt: null as string | null,
    status: "unresolved" as const,
    locator: hint.locator ?? null,
  };
  let newsroomId: number;
  try {
    newsroomId = await investigationNewsroom(investigationId, expectedNewsroom);
  } catch {
    return unresolved;
  }

  async function confirm(hit: {
    versionId: number | null;
    captureEventId: number | null;
    sourceUrl: string | null;
    contentHash: string | null;
    capturedAt: string | null;
    locator: string | null;
  }) {
    const quote = (hint.excerpt ?? "").trim();
    if (!quote) return { ...hit, status: "unresolved" as const };
    let body = "";
    if (hit.versionId) {
      const rows = await sql<{ full_text: string }>`
        select full_text from artifact_versions where id = ${hit.versionId} and newsroom_id = ${newsroomId} limit 1
      `;
      if (!rows[0]) return unresolved;
      body = rows[0].full_text;
    }
    if (evidenceAppearsInText(quote, body)) return { ...hit, status: "resolved" as const };
    // Evidence elsewhere in this file cannot validate the selected source.
    // Keep the citation unresolved until the planner/editor selects the source
    // that actually contains the quote; never retain A's ID with B's evidence.
    return { ...hit, status: "unresolved" as const };
  }

  if (hint.capture_event_id) {
    const row = await sql<{
      id: number;
      version_id: number | null;
      source_url: string;
      content_hash: string | null;
      observed_at: string;
    }>`
      select id, version_id, source_url, content_hash, observed_at::text as observed_at
      from capture_events
      where id = ${hint.capture_event_id} and newsroom_id = ${newsroomId}
      limit 1
    `;
    if (row[0]) {
      return confirm({
        versionId: row[0].version_id,
        captureEventId: row[0].id,
        sourceUrl: row[0].source_url,
        contentHash: row[0].content_hash,
        capturedAt: row[0].observed_at,
        locator: hint.locator ?? null,
      });
    }
  }
  if (hint.artifact_version_id) {
    const row = await sql<{ id: number; url: string; content_hash: string; captured_at: string }>`
      select id, url, content_hash, captured_at::text as captured_at
      from artifact_versions
      where id = ${hint.artifact_version_id} and newsroom_id = ${newsroomId}
      limit 1
    `;
    if (row[0]) {
      const cap = await sql<{ id: number; observed_at: string }>`
        select id, observed_at::text as observed_at from capture_events
        where version_id = ${row[0].id} and newsroom_id = ${newsroomId}
          and (investigation_id = ${investigationId} or investigation_id is null)
        order by id desc limit 1
      `;
      return confirm({
        versionId: row[0].id,
        captureEventId: cap[0]?.id ?? null,
        sourceUrl: row[0].url,
        contentHash: row[0].content_hash,
        capturedAt: cap[0]?.observed_at ?? row[0].captured_at,
        locator: hint.locator ?? null,
      });
    }
  }
  if (hint.source_url) {
    let source = hint.source_url;
    try {
      source = canonicalPublicUrl(hint.source_url);
    } catch {
      /* keep */
    }
    const cap = await sql<{
      id: number;
      version_id: number | null;
      source_url: string;
      content_hash: string | null;
      observed_at: string;
    }>`
      select id, version_id, source_url, content_hash, observed_at::text as observed_at
      from capture_events
      where investigation_id = ${investigationId} and source_url = ${source} and newsroom_id = ${newsroomId}
      order by id desc limit 1
    `;
    if (cap[0]) {
      return confirm({
        versionId: cap[0].version_id,
        captureEventId: cap[0].id,
        sourceUrl: cap[0].source_url,
        contentHash: cap[0].content_hash,
        capturedAt: cap[0].observed_at,
        locator: hint.locator ?? null,
      });
    }
    const art = await sql<{
      version_id: number | null;
      capture_event_id: number | null;
      content_hash: string;
      url: string;
    }>`
      select version_id, capture_event_id, content_hash, url from artifacts
      where investigation_id = ${investigationId} and url = ${source} and newsroom_id = ${newsroomId}
      order by id desc limit 1
    `;
    if (art[0]?.version_id || art[0]?.capture_event_id) {
      return confirm({
        versionId: art[0].version_id,
        captureEventId: art[0].capture_event_id,
        sourceUrl: art[0].url,
        contentHash: art[0].content_hash,
        capturedAt: null,
        locator: hint.locator ?? null,
      });
    }
  }
  return unresolved;
}

async function persistPlan(
  userId: string,
  investigationId: number,
  plan: HopPlan,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const sql = await getSql();
  const known = await sql<{ canonical: string; name: string }>`
    select canonical, name from entities where newsroom_id = ${newsroomId}
  `;
  for (const e of plan.entities) {
    const resolved = resolveEntityName(e.name, known);
    const key = identityKey(e.name);
    if (!key) continue;
    const merge = isConfirmedSame(resolved.verdict) && resolved.canonical === key;
    const c = merge ? resolved.canonical : key;
    let entityId: number | null = null;
    try {
      const created = await sql<{ id: number }>`
        insert into entities (user_id, newsroom_id, canonical, name, kind, why)
        values (${userId}, ${newsroomId}, ${c}, ${e.name.slice(0, 200)}, ${e.kind.slice(0, 40)}, ${e.why.slice(0, 800)})
        on conflict (newsroom_id, canonical) do update set why = excluded.why
        returning id
      `;
      entityId = created[0]?.id ?? null;
    } catch {
      try {
        const created = await sql<{ id: number }>`
          insert into entities (user_id, newsroom_id, canonical, name, kind, why)
          values (${userId}, ${newsroomId}, ${c}, ${e.name.slice(0, 200)}, ${e.kind.slice(0, 40)}, ${e.why.slice(0, 800)})
          returning id
        `;
        entityId = created[0]?.id ?? null;
      } catch {
        await sql`
          update entities set why = ${e.why.slice(0, 800)}
          where newsroom_id = ${newsroomId} and canonical = ${c}
        `;
        const found = await sql<{ id: number }>`
          select id from entities where newsroom_id = ${newsroomId} and canonical = ${c} limit 1
        `;
        entityId = found[0]?.id ?? null;
      }
    }
    if (entityId) {
      const hit = await sql<{
        version_id: number | null;
        capture_event_id: number | null;
        url: string;
      }>`
        select version_id, capture_event_id, url from artifacts
        where investigation_id = ${investigationId}
          and (
            lower(full_text) like ${"%" + e.name.toLowerCase().slice(0, 80) + "%"}
            or lower(title) like ${"%" + e.name.toLowerCase().slice(0, 80) + "%"}
          )
        order by id desc limit 1
      `;
      try {
        await sql`
          insert into investigation_entities (
            user_id, newsroom_id, investigation_id, entity_id, first_seen_version_id, first_seen_capture_id,
            first_seen_url, relevance, status
          ) values (
            ${userId}, ${newsroomId}, ${investigationId}, ${entityId},
            ${hit[0]?.version_id ?? null}, ${hit[0]?.capture_event_id ?? null},
            ${hit[0]?.url ?? null}, ${"direct"}, ${"active"}
          )
          on conflict (investigation_id, entity_id) do nothing
        `;
      } catch {
        /* mapping already recorded */
      }
      if (hit[0]) {
        await sql`
          update investigation_entities
          set first_seen_version_id = coalesce(first_seen_version_id, ${hit[0].version_id}),
              first_seen_capture_id = coalesce(first_seen_capture_id, ${hit[0].capture_event_id}),
              first_seen_url = coalesce(first_seen_url, ${hit[0].url})
          where investigation_id = ${investigationId} and entity_id = ${entityId}
            and first_seen_capture_id is null
        `;
      }
    }
    if (!merge && resolved.matched && resolved.canonical !== c) {
      const verdict =
        resolved.verdict === "possible"
          ? "possible-same"
          : resolved.verdict === "same"
            ? "possible-same"
            : resolved.verdict;
      try {
        await sql`
          insert into entity_aliases (user_id, newsroom_id, canonical, alias, verdict, evidence)
          values (${userId}, ${newsroomId}, ${resolved.canonical}, ${e.name.slice(0, 200)}, ${verdict}, ${e.why.slice(0, 400)})
          on conflict (newsroom_id, user_id, canonical, alias) do update set verdict = excluded.verdict
        `;
      } catch {
        /* alias already recorded */
      }
      const [left, right] = [resolved.canonical, c].sort();
      try {
        await sql`
          insert into entity_matches (user_id, newsroom_id, left_canonical, right_canonical, verdict, evidence, investigation_id)
          values (${userId}, ${newsroomId}, ${left}, ${right}, ${verdict}, ${e.why.slice(0, 400)}, ${investigationId})
          on conflict (newsroom_id, user_id, left_canonical, right_canonical) do update set verdict = excluded.verdict
        `;
      } catch {
        /* match already recorded */
      }
      await persistDiscovery(userId, investigationId, {
        kind: e.kind || "unknown",
        label: e.name,
        why: `Unresolved identity vs ${resolved.matched} (${verdict}) — keep both possibilities alive`,
        evidence: e.why,
        priority: 8,
        query: `"${e.name}" ${(await getPaperConfig(newsroomId)).city}`,
      });
      await persistDiscovery(userId, investigationId, {
        kind: e.kind || "unknown",
        label: resolved.matched,
        why: `Unresolved identity vs ${e.name} (${verdict}) — keep both possibilities alive`,
        evidence: e.why,
        priority: 8,
        query: `"${resolved.matched}" ${(await getPaperConfig(newsroomId)).city}`,
      });
    }
    known.push({ canonical: c, name: e.name });
  }
  for (const r of plan.relationships) {
    const prov = await resolveProvenance(
      userId,
      investigationId,
      {
        source_url: r.source_url,
        artifact_version_id: r.artifact_version_id,
        capture_event_id: r.capture_event_id,
        locator: r.locator,
        excerpt: r.evidence,
      },
      newsroomId,
    );
    await sql`
      insert into relationships (
        user_id, newsroom_id, investigation_id, from_name, to_name, kind, evidence, source_url,
        version_id, excerpt, capture_event_id, capture_hash, provenance_status, locator
      )
      values (
        ${userId}, ${newsroomId}, ${investigationId}, ${r.from.slice(0, 200)}, ${r.to.slice(0, 200)},
        ${r.kind.slice(0, 80)}, ${r.evidence.slice(0, 2000)}, ${prov.sourceUrl},
        ${prov.versionId}, ${r.evidence.slice(0, 800)}, ${prov.captureEventId},
        ${prov.contentHash}, ${prov.status}, ${prov.locator}
      )
    `;
    if (prov.status === "unresolved") {
      await persistDiscovery(userId, investigationId, {
        kind: "unresolved-provenance",
        label: `${r.from} ${r.kind} ${r.to}`.slice(0, 240),
        why: "Relationship provenance unresolved; keep investigating",
        evidence: r.evidence.slice(0, 400),
        priority: 7,
      });
    }
  }
  for (const h of plan.hypotheses) {
    const status = h.contradicting.trim()
      ? "weakened"
      : h.supporting.trim()
        ? "strengthened"
        : "active";
    const existing = await sql<{ id: number }>`
      select id from hypotheses
      where investigation_id = ${investigationId} and body = ${h.text.slice(0, 2000)}
      limit 1
    `;
    if (existing[0]) {
      await sql`
        update hypotheses
        set supporting = ${h.supporting.slice(0, 2000)},
            contradicting = ${h.contradicting.slice(0, 2000)},
            status = ${status},
            transition_note = ${`Evidence update (${status})`}
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into hypotheses (user_id, newsroom_id, investigation_id, body, supporting, contradicting, status, transition_note)
        values (
          ${userId}, ${newsroomId}, ${investigationId}, ${h.text.slice(0, 2000)},
          ${h.supporting.slice(0, 2000)}, ${h.contradicting.slice(0, 2000)},
          ${status}, ${"opened"}
        )
      `;
    }
  }
  for (const c of plan.claims) {
    const conf = c.confidence;
    const prov = await resolveProvenance(
      userId,
      investigationId,
      {
        source_url: c.source_url,
        artifact_version_id: c.artifact_version_id,
        capture_event_id: c.capture_event_id,
        locator: c.locator,
        excerpt: c.evidence,
      },
      newsroomId,
    );
    await sql`
      insert into claims (
        user_id, newsroom_id, investigation_id, body, kind, evidence, source_url, confidence,
        version_id, excerpt, capture_hash, capture_event_id, provenance_status, locator, captured_at
      )
      values (
        ${userId}, ${newsroomId}, ${investigationId}, ${c.text.slice(0, 2000)}, ${c.kind},
        ${c.evidence.slice(0, 2000)}, ${prov.sourceUrl ?? c.source_url ?? null}, ${conf ?? null},
        ${prov.versionId}, ${c.evidence.slice(0, 800)}, ${prov.contentHash},
        ${prov.captureEventId}, ${prov.status}, ${prov.locator},
        ${prov.capturedAt}
      )
    `;
    if (prov.status === "unresolved") {
      await persistDiscovery(userId, investigationId, {
        kind: "unresolved-provenance",
        label: c.text.slice(0, 240),
        why: "Provenance unresolved; keep investigating — missing artifact link is a state, not a stop",
        evidence: (c.evidence || c.text).slice(0, 400),
        priority: 7,
      });
    }
  }
  for (const f of plan.frontier) {
    await persistDiscovery(userId, investigationId, {
      kind: f.kind,
      label: f.label,
      why: f.why,
      priority: f.priority,
      pendingQueries: f.queries,
    });
  }
  for (const a of plan.anomalies) {
    await sql`
      insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
      values (
        ${userId}, ${newsroomId}, ${investigationId}, ${a.kind.slice(0, 40)}, ${a.summary.slice(0, 1000)},
        ${a.url ?? null}, ${""}
      )
    `;
  }
  for (const d of plan.dead_ends) {
    const entNames = await sql<{ name: string }>`
      select e.name from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${investigationId}
      limit 40
    `;
    const blob = [d.hypothesis, ...entNames.map((n) => n.name)].join(", ").slice(0, 2000);
    const hypothesisVal = d.hypothesis.slice(0, 1000);
    const reasonVal = d.reason.slice(0, 2000);
    const dedupKey = hypothesisVal.toLowerCase().trim();
    /*
      Dark Desk F4: the model re-asserting the same dead end every hop used
      to insert a fresh row every time (18x on one live hypothesis). Upsert
      keyed on (investigation_id, dedup_key) instead, incrementing
      confirmation_count; once it crosses DEAD_END_CONFIRMATION_CAP the row
      is settled and matchDeadEnds stops resurfacing it (see below). Same
      best-effort try/catch convention as persistDiscovery's frontier_items
      upsert just above: a database whose unique index creation was skipped
      (pre-existing duplicates) falls back to the old insert-every-time
      behavior rather than failing the hop.
    */
    try {
      await sql`
        insert into dead_ends (user_id, newsroom_id, investigation_id, hypothesis, dismissed_because, entities, confirmation_count, settled, dedup_key)
        values (${userId}, ${newsroomId}, ${investigationId}, ${hypothesisVal}, ${reasonVal}, ${blob}, 1, false, ${dedupKey})
        on conflict (investigation_id, dedup_key) do update
        set confirmation_count = dead_ends.confirmation_count + 1,
            dismissed_because = excluded.dismissed_because,
            entities = excluded.entities,
            settled = (dead_ends.confirmation_count + 1 >= ${DEAD_END_CONFIRMATION_CAP})
      `;
    } catch {
      await sql`
        insert into dead_ends (user_id, newsroom_id, investigation_id, hypothesis, dismissed_because, entities, dedup_key)
        values (${userId}, ${newsroomId}, ${investigationId}, ${hypothesisVal}, ${reasonVal}, ${blob}, ${dedupKey})
      `;
    }
    await markFrontier(userId, investigationId, d.hypothesis, "dead-end", d.reason);
    await sql`
      update hypotheses
      set status = 'dead-end', transition_note = ${d.reason.slice(0, 800)}
      where investigation_id = ${investigationId}
        and body = ${d.hypothesis.slice(0, 2000)}
    `;
  }
}

/**
 * Dark Desk F4: how many times the model may re-assert the same dead end
 * before it's treated as settled and stops resurfacing. Live data showed one
 * hypothesis inserted 18x and 42 "revived" rows pinned above real leads — 3
 * confirmations is enough to be sure it is genuinely a repeat, not enough to
 * still be crowding the pile by the time it settles.
 */
export const DEAD_END_CONFIRMATION_CAP = 3;

/**
 * Priority given to a resurfaced dead end. Previously `greatest(priority, 11)`
 * unconditionally forced revived dead ends above fresh leads (real leads
 * default to 7-10); this sits below that band on purpose so a revived dead
 * end has to actually compete for attention rather than jump the queue.
 */
const REVIVED_DEAD_END_PRIORITY = 6;

/**
 * Dark Desk F4: words too common to mean anything on their own, so a match
 * that reduces to just these doesn't count as "the same name".
 */
const DEAD_END_MATCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "were",
  "have",
  "been",
  "into",
  "during",
  "after",
  "before",
  "about",
  "city",
  "county",
  "council",
  "board",
  "meeting",
  "public",
  "report",
  "case",
]);

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Dark Desk F4: was "any extracted name >3 chars that's a substring of
 * hypothesis+entities" — loose enough that "Main" false-positived inside
 * "Maintenance budget" and revived dead ends that had nothing to do with the
 * new evidence. Requires either (a) a multi-token phrase where every
 * meaningful token appears as a whole word, or (b) a single specific
 * (>=6 char) word as a whole word — never a raw substring.
 */
export function meaningfulDeadEndMatch(name: string, blob: string): boolean {
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter((t) => t.length > 2 && !DEAD_END_MATCH_STOPWORDS.has(t));
  if (!tokens.length) return false;
  if (tokens.length >= 2) {
    return tokens.every((t) => new RegExp(`\\b${escapeRegExpLiteral(t)}\\b`, "i").test(blob));
  }
  const only = tokens[0]!;
  if (only.length < 6) return false;
  return new RegExp(`\\b${escapeRegExpLiteral(only)}\\b`, "i").test(blob);
}

export async function matchDeadEnds(
  userId: string,
  names: string[],
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    hypothesis: string;
    dismissed_because: string;
    entities: string;
    investigation_id: number | null;
  }>`
    select id, hypothesis, dismissed_because, entities, investigation_id from dead_ends
    where newsroom_id = ${newsroomId} and settled = false
    order by created_at desc limit 80
  `;
  return rows.filter((r) => {
    const blob = `${r.hypothesis} ${r.entities}`;
    return names.some((n) => meaningfulDeadEndMatch(n, blob));
  });
}

/** Reopen a dead end when newly captured evidence names it. Does not auto-reopen from the same old entity list. */
export async function resurfaceDeadEnds(
  userId: string,
  investigationId: number,
  names: string[],
  opts: { foreignOnly?: boolean } = {},
): Promise<number> {
  const newsroomId = await investigationNewsroom(investigationId);
  const hits = await matchDeadEnds(userId, names, newsroomId);
  if (!hits.length) return 0;
  const sql = await getSql();
  let n = 0;
  for (const h of hits) {
    if (opts.foreignOnly && h.investigation_id === investigationId) continue;
    const label = h.hypothesis.slice(0, 240);
    const norm = frontierDedupKey("revived-dead-end", label).norm;
    const existing = await sql<{ id: number; status: string }>`
      select id, status from frontier_items
      where investigation_id = ${investigationId} and label_norm = ${norm}
      limit 1
    `;
    if (existing[0]) {
      if (existing[0].status === "dead-end" || existing[0].status === "exhausted") {
        await sql`
          update frontier_items
          set status = ${"reopened"},
              prior_status = ${existing[0].status},
              reopened_at = now(),
              reopened_from = ${names.join(", ").slice(0, 400)},
              closed_reason = ${"New evidence revived this dead end"},
              next_steps = ${`"${label}" ${(await getPaperConfig(newsroomId)).city}`},
              priority = ${REVIVED_DEAD_END_PRIORITY}
          where id = ${existing[0].id}
        `;
        n += 1;
      }
    } else {
      await persistDiscovery(userId, investigationId, {
        kind: "revived-dead-end",
        label,
        why: `Prior dead end revived: ${h.dismissed_because}`,
        evidence: names.join(", ").slice(0, 400),
        priority: REVIVED_DEAD_END_PRIORITY,
      });
      n += 1;
    }
    await sql`
      update hypotheses
      set status = ${"reopened"}, transition_note = ${"New evidence revived this dead end"}
      where investigation_id = ${investigationId}
        and status = ${"dead-end"} and body = ${h.hypothesis.slice(0, 2000)}
    `;
  }
  return n;
}

export async function checkBaselines(
  userId: string,
  investigationId: number,
  now = new Date(),
  /**
   * Baselines and their anomalies use the same caller-authorized newsroom.
   */
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const sql = await getSql();
  const rows = await sql<{
    key: string;
    typical_title: string;
    typical_url: string;
    cadence_days: number;
    last_seen: string | null;
    usual_weekday: string | null;
    usual_nth_weekday: string | null;
    sightings: number | null;
  }>`
    select key, typical_title, typical_url, cadence_days, last_seen::text as last_seen,
           usual_weekday, usual_nth_weekday, sightings
    from recurring_baselines where newsroom_id = ${newsroomId}
  `;
  let flagged = 0;
  for (const r of rows) {
    if (!r.last_seen) continue;
    const events = [
      {
        key: r.key,
        at: new Date(r.last_seen),
        title: r.typical_title,
        url: r.typical_url,
      },
    ];
    const missing = detectMissingCadence(events, now, r.cadence_days || 30, 7);
    for (const m of missing) {
      const already = await sql<{ id: number }>`
        select id from anomalies
        where investigation_id = ${investigationId} and newsroom_id = ${newsroomId}
          and kind = ${"missing-cadence"} and url is not distinct from ${m.url || null}
        limit 1
      `;
      if (already[0]) {
        flagged += 1;
        continue;
      }
      const details = [
        `Last seen ${m.lastSeen.toISOString()}.`,
        `Learned cadence ${r.cadence_days} days.`,
        r.usual_weekday ? `Usual weekday ${r.usual_weekday}.` : "",
        r.usual_nth_weekday ? `Usual nth-weekday ${r.usual_nth_weekday}.` : "",
        r.sightings ? `${r.sightings} prior sightings.` : "",
        `Search for cancellation, reschedule, rename, archive.`,
      ]
        .filter(Boolean)
        .join(" ");
      await sql`
        insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
        values (
          ${userId}, ${newsroomId}, ${investigationId}, ${"missing-cadence"},
          ${`Expected recurring record is late: ${m.title || m.key} (${m.daysLate} days past cadence)`},
          ${m.url || null},
          ${details}
        )
      `;
      const next = [
        `${m.title} cancellation`,
        `${m.title} rescheduled OR postponed`,
        `${m.title} agenda OR minutes OR notice`,
      ].join(" | ");
      // Dark Desk F4: label_norm must be set on every frontier_items insert
      // (it carries the unique index (investigation_id, label_norm)); a bare
      // insert would default it to '' and collide across missing-record rows.
      const missingLabel = m.title || m.key;
      const missingNorm = frontierDedupKey("missing-record", missingLabel).norm;
      await sql`
        insert into frontier_items (user_id, newsroom_id, investigation_id, kind, label, label_norm, why, priority, next_steps)
        values (
          ${userId}, ${newsroomId}, ${investigationId}, ${"missing-record"}, ${missingLabel}, ${missingNorm},
          ${"Dog that didn't bark — expected cadence broken"}, ${12},
          ${next.slice(0, 500)}
        )
        on conflict (investigation_id, label_norm) do nothing
      `;
      flagged += 1;
    }
  }
  return flagged;
}

/**
 * `newsroomId` (0.6.18, closes the 0.6.11 STOP) -- `source_monitors` is now
 * newsroom-scoped end to end: `watchSource`/`maybeWatch` write the real
 * newsroom on the row, and this function reads/writes that same newsroom
 * for the monitor it is ticking and every anomaly it files, instead of the
 * hardcoded `DEFAULT_NEWSROOM_ID` prior releases used. The caller,
 * `tickAllDueMonitors` (monitors-cron.ts), now sweeps due monitors grouped
 * by `(user_id, newsroom_id)` and passes each group's newsroom in here, so
 * a user with monitors in two newsrooms never has one newsroom's anomalies
 * collapse into the other's.
 */
export async function runDueMonitors(opts: {
  userId: string;
  newsroomId?: number;
  now?: Date;
  fetch?: FetchFn;
  limit?: number;
  archives?: (url: string) => Promise<string[]>;
}): Promise<{ checked: number; anomalies: number }> {
  const sql = await getSql();
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  const now = opts.now ?? new Date();
  const fetchDoc = opts.fetch ?? defaultFetch;
  const dueRows = await sql<{
    id: number;
    url: string;
    title: string;
    investigation_id: number | null;
    cadence_hours: number;
    last_version_id: number | null;
    typical_structure: string | null;
  }>`
    select id, url, title, investigation_id, cadence_hours, last_version_id, typical_structure
    from source_monitors
    where newsroom_id = ${newsroomId} and manual_watch = false and enabled = true and next_check_at <= ${now.toISOString()}::timestamptz
    order by next_check_at asc
  `;
  const due = dueRows.slice(0, opts.limit ?? 20);
  let anomalies = 0;
  for (const m of due) {
    let url = m.url;
    try {
      url = canonicalPublicUrl(m.url);
    } catch {
      /* keep */
    }
    const priorCap = await sql<{
      content_hash: string | null;
      fetch_status: number | null;
      full_text: string | null;
      fetch_outcome: string | null;
    }>`
      select ce.content_hash, ce.http_status as fetch_status, av.full_text, ce.fetch_outcome
      from capture_events ce
      left join artifact_versions av on av.id = ce.version_id and av.newsroom_id = ce.newsroom_id
      -- 0.6.23: scoped to this monitor's own newsroom (closes the TODO.md
      -- "Known caveats" line -- this lookup used to key off the hardcoded
      -- DEFAULT_NEWSROOM_ID, so two newsrooms watching the same url would
      -- compare against each other's captures instead of their own).
      -- rememberCapture now writes the real newsroom onto capture_events,
      -- so this filter actually isolates rows per newsroom instead of
      -- just matching where they used to all land by accident.
      -- The joined version must belong to this newsroom too. Legacy captures
      -- linked across newsrooms must not import the other paper's text.
      where ce.newsroom_id = ${newsroomId} and ce.source_url = ${url}
      order by ce.id desc limit 1
    `;
    const got = asFetched(await fetchDoc(url), url);
    const hash = got.ok ? await sha256(got.text) : "missing";
    const classified = classifyFetchedPage({
      status: got.status,
      title: got.title,
      text: got.text,
      priorHash: priorCap[0]?.content_hash,
      priorStatus: priorCap[0]?.fetch_status,
      newHash: hash,
    });
    const outcome: FetchOutcome = got.outcome === "needs-ocr" ? "needs-ocr" : classified;
    const rec = await rememberCapture({
      userId: opts.userId,
      investigationId: m.investigation_id,
      url,
      title: got.title || m.title || url,
      text: got.text,
      hash,
      status: got.status,
      outcome,
      triggerKind: "monitor",
      monitorId: m.id,
      redirectChain: got.redirectChain,
      contentType: got.contentType,
      extractionMethod: got.extractionMethod,
      pages: got.pages,
      extras: got.extras,
      observedAt: now,
      rawBytes: got.rawBytes,
      newsroomId,
    });
    const invId = m.investigation_id;
    const gone = outcome === "removed" || outcome === "not-found" || outcome === "soft-404";
    const priorGone =
      Boolean(priorCap[0]) &&
      (priorCap[0]!.fetch_status === 404 ||
        priorCap[0]!.fetch_status === 410 ||
        priorCap[0]!.content_hash === "missing" ||
        priorCap[0]!.fetch_outcome === "removed" ||
        priorCap[0]!.fetch_outcome === "not-found" ||
        priorCap[0]!.fetch_outcome === "soft-404");
    if (gone) {
      await sql`
        insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
        values (
          ${opts.userId}, ${newsroomId}, ${invId}, ${"disappeared"},
          ${`Monitored record disappeared: ${url}`},
          ${url},
          ${`Monitor ${m.id}. Outcome ${outcome}. Status ${got.status}. No human reopen required.`}
        )
      `;
      anomalies += 1;
      if (invId) {
        await persistDiscovery(opts.userId, invId, {
          kind: "missing-record",
          label: url,
          why: "Autonomous monitor detected disappearance",
          evidence: url,
          priority: 12,
        });
        try {
          const copies = opts.archives ? await opts.archives(url) : await waybackCopies(url);
          for (const c of copies.slice(0, 3)) {
            await persistDiscovery(opts.userId, invId, {
              kind: "url",
              label: c,
              why: `Archive copy after monitored disappearance of ${url}`,
              evidence: url,
              priority: 12,
            });
          }
        } catch {
          /* archive optional */
        }
      }
    } else {
      if (priorGone && (outcome === "fetched" || outcome === "changed")) {
        await sql`
          insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
          values (
            ${opts.userId}, ${newsroomId}, ${invId}, ${"restored"},
            ${`Monitored record restored: ${url}`},
            ${url},
            ${`Prior outcome ${priorCap[0]?.fetch_outcome ?? "missing"}. New hash ${hash}.`}
          )
        `;
        anomalies += 1;
        if (invId) {
          const rows = await sql<{ id: number }>`
            select id from frontier_items
            where investigation_id = ${invId} and label = ${url}
              and status in ('dead-end', 'exhausted', 'deferred')
            limit 1
          `;
          if (rows[0]) {
            await sql`
              update frontier_items
              set status = ${"reopened"},
                  prior_status = ${"exhausted"},
                  reopened_at = now(),
                  reopened_from = ${`Monitored source restored: ${url}`.slice(0, 400)},
                  closed_reason = ${"Monitored source restored"},
                  next_steps = ${url.slice(0, 800)},
                  priority = greatest(priority, 11)
              where id = ${rows[0].id}
            `;
          }
        }
      }
      if (outcome === "changed") {
        await sql`
          insert into anomalies (user_id, newsroom_id, investigation_id, kind, summary, url, details)
          values (
            ${opts.userId}, ${newsroomId}, ${invId}, ${"changed"},
            ${`Monitored record changed: ${url}`},
            ${url},
            ${diffExcerpt(priorCap[0]?.full_text ?? "", got.text).slice(0, 4000)}
          )
        `;
        anomalies += 1;
        let prevSnap: StructureSnapshot | null = null;
        try {
          if (m.typical_structure) prevSnap = JSON.parse(m.typical_structure) as StructureSnapshot;
        } catch {
          prevSnap = null;
        }
        anomalies += await flagPatternAnomalies({
          userId: opts.userId,
          investigationId: invId,
          url,
          title: got.title || m.title || url,
          text: got.text,
          extras: got.extras,
          previous: prevSnap,
          now,
          newsroomId,
        });
      }
    }
    if (got.ok) {
      await observeBaseline(opts.userId, url, got.title || m.title, now, got.extras, newsroomId);
    }
    const hours = m.cadence_hours || 24;
    const next = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
    const successAt = got.ok ? now.toISOString() : null;
    const structure = JSON.stringify(structureSnapshot(got.title || m.title, got.text, got.extras));
    await sql`
      update source_monitors
      set last_check_at = ${now.toISOString()}::timestamptz,
          last_outcome = ${outcome},
          last_version_id = ${rec.versionId},
          last_success_at = ${successAt}::timestamptz,
          next_check_at = ${next}::timestamptz,
          typical_structure = ${structure}
      where id = ${m.id}
    `;
  }
  return { checked: due.length, anomalies };
}

export { detectMissingCadence };
