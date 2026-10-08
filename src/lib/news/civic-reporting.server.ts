/*
  The server half of the editor's civic reporting: where the method lives, and
  where a run's request, its package and its observations are stored.

  WHY A SEPARATE FILE FROM `civic-reporting.ts`. `civic-reporting.ts` is the
  package SHAPE and stays client-safe so the story route and `node --test` can
  both load it. This file opens a database connection, so it is server-only and
  never imported by a component.

  THE METHOD IS NOT COPIED HERE. The civic-scanner method is an installed skill
  (SKILL.md + references/ + scripts/) that must stay reusable OUTSIDE
  TownReporter. Production must therefore be able to point at it either as a
  packaged asset shipped beside the app or as an operator-configured directory --
  a hardcoded personal path is the fallback, never the only mechanism. The run
  receipt records which directory was actually read and the method version, so
  an editor can tell which instructions produced the work.
*/
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  CIVIC_SCANNER_METHOD_VERSION,
  parseReportingPackage,
  type ReportingPackage,
} from "./civic-reporting.ts";

/** The files a valid civic-scanner method directory must contain. */
export const CIVIC_METHOD_REQUIRED_FILES = [
  "SKILL.md",
  "references/full-pipeline.md",
  "references/editorial-controls.md",
  "references/daily-scan.md",
] as const;

export type CivicMethodDir = {
  /** The directory a run should read its instructions from. */
  dir: string;
  /** True when the directory holds the files the method needs. */
  complete: boolean;
  /** Which of the required files are missing (empty when complete). */
  missing: string[];
  /** How the directory was chosen: "configured" | "packaged" | "known-install" | "none". */
  source: "configured" | "packaged" | "known-install" | "none";
};

/**
 * Where the civic-scanner method lives, in priority order.
 *
 *   1. An operator-configured directory (`TOWNREPORTER_CIVIC_SCANNER_DIR`), so a
 *      deployment can vendor or pin a specific copy without a code change.
 *   2. A directory packaged beside the app (`<cwd>/civic-scanner`), so the
 *      method can ship with the product rather than depend on one machine.
 *   3. The known install location on this workstation, as a development
 *      fallback -- useful, but never the sole mechanism.
 *
 * Returns the first candidate that EXISTS; `complete` says whether it holds the
 * files the method needs. A caller that needs a live method refuses when none is
 * complete rather than pretending a text-only rewrite is full reporting.
 */
export function resolveCivicMethodDir(env: Record<string, string | undefined> = process.env): CivicMethodDir {
  const candidates: { dir: string; source: CivicMethodDir["source"] }[] = [];
  const configured = env.TOWNREPORTER_CIVIC_SCANNER_DIR?.trim();
  if (configured) candidates.push({ dir: configured, source: "configured" });
  candidates.push({ dir: join(process.cwd(), "civic-scanner"), source: "packaged" });
  const home = env.USERPROFILE ?? env.HOME;
  if (home) {
    candidates.push({ dir: join(home, ".agents", "skills", "civic-scanner"), source: "known-install" });
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate.dir)) continue;
    const missing = CIVIC_METHOD_REQUIRED_FILES.filter((file) => !existsSync(join(candidate.dir, file)));
    return { dir: candidate.dir, source: candidate.source, complete: missing.length === 0, missing };
  }
  return { dir: "", source: "none", complete: false, missing: [...CIVIC_METHOD_REQUIRED_FILES] };
}

/** The version recorded in a run receipt. Kept here so the server half reads it once. */
export const civicReportingMethodVersion = CIVIC_SCANNER_METHOD_VERSION;

/* ------------------------------------------------------------------ *
 * Storage. The tables are created by migrations/0125; these helpers read and
 * write them. They never truncate: a package is jsonb and stored whole.
 * ------------------------------------------------------------------ */

export type ReportingRequestRow = {
  id: number;
  user_id: string;
  newsroom_id: number;
  request_kind: string;
  lead_id: number | null;
  parent_request_id: number | null;
  action: string;
  assignment: string;
  seed_urls: string;
  model_choice: string;
  method_version: string;
  method_source: string;
  model_receipt: string;
  workspace_dir: string;
  run_status: string;
  run_note: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

/**
 * Schema is owned by migrations/0125_civic_reporting.sql. Keep this function
 * for existing callers, but do not create or mutate schema during a request.
 */
export async function ensureReportingSchema(_sql?: Sql): Promise<void> {}

export async function loadReportingRequest(
  sql: Sql,
  requestId: number,
  newsroomId: number,
): Promise<ReportingRequestRow | null> {
  const [row] = await sql<ReportingRequestRow>`
    select * from reporting_requests where id = ${requestId} and newsroom_id = ${newsroomId} limit 1
  `;
  return row ?? null;
}

/** The newest package for a lead, as the story route reads it. */
export async function loadLeadReportingPackage(
  sql: Sql,
  leadId: number,
  newsroomId: number,
): Promise<{ requestId: number; draftId: number | null; pkg: ReportingPackage } | null> {
  const [row] = await sql<{ request_id: number; draft_id: number | null; package: unknown }>`
    select request_id, draft_id, package from reporting_packages
    where newsroom_id = ${newsroomId} and lead_id = ${leadId}
    order by created_at desc, id desc limit 1
  `;
  if (row) {
    const pkg = parseReportingPackage(row.package);
    if (pkg) return { requestId: Number(row.request_id), draftId: row.draft_id, pkg };
  }

  // A run may file several stories as separate leads while storing one package
  // row against its first lead. The secondary drafts carry the request/story
  // link in research_json; inspect it in JavaScript so malformed legacy values
  // cannot make a JSON cast fail this story read.
  const drafts = await sql.query<{ id: number; research_json: unknown }>(
    `select id, research_json from drafts
      where newsroom_id = $1 and lead_id = $2
      order by created_at desc, id desc limit 100`,
    [newsroomId, leadId],
  );
  for (const draft of drafts) {
    const reference = reportingDraftReference(draft.research_json);
    if (!reference) continue;
    const [packageRow] = await sql<{ request_id: number; package: unknown }>`
      select request_id, package from reporting_packages
      where newsroom_id = ${newsroomId} and request_id = ${reference.requestId}
      limit 1
    `;
    if (!packageRow) continue;
    const pkg = parseReportingPackage(packageRow.package);
    if (!pkg || !pkg.stories.some((story) => story.id === reference.storyId)) continue;
    return { requestId: Number(packageRow.request_id), draftId: Number(draft.id), pkg };
  }
  return null;
}

export type EarlierReportingPackage = { requestId: number; createdAt: string; pkg: ReportingPackage };

export async function loadEarlierLeadReportingPackages(
  sql: Sql,
  leadId: number,
  newsroomId: number,
  currentRequestId: number,
): Promise<EarlierReportingPackage[]> {
  const rows = await sql<{ request_id: number; created_at: Date | string; package: unknown }>`
    select request_id, created_at, package from reporting_packages
    where newsroom_id = ${newsroomId} and lead_id = ${leadId} and request_id <> ${currentRequestId}
    order by created_at desc, id desc
  `;
  return rows.flatMap((row) => {
    const pkg = parseReportingPackage(row.package);
    return pkg
      ? [{ requestId: Number(row.request_id), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at), pkg }]
      : [];
  });
}

function reportingDraftReference(value: unknown): { requestId: number; storyId: string } | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const requestId = Number(record.requestId);
  const storyId = typeof record.storyId === "string" ? record.storyId.trim() : "";
  if (record.civicReporting !== true || !Number.isSafeInteger(requestId) || requestId <= 0 || !storyId) return null;
  return { requestId, storyId };
}

/**
 * Store a package for a run, keyed to its request. Upserts on `request_id` so a
 * retried run replaces its own row rather than stacking duplicates, and NEVER
 * touches a different request's package -- a follow-up is a new request, so it
 * cannot overwrite the copy it was asked to keep.
 */
export async function saveReportingPackage(
  sql: Sql,
  input: {
    requestId: number;
    newsroomId: number;
    leadId: number | null;
    draftId: number | null;
    pkg: ReportingPackage;
  },
): Promise<void> {
  const headline = input.pkg.stories[0]?.headline ?? "";
  const readiness = input.pkg.readinessTier;
  const scoreTotal = input.pkg.score?.total ?? 0;
  await sql`
    insert into reporting_packages (request_id, newsroom_id, lead_id, draft_id, package, headline, readiness_tier, score_total)
    values (${input.requestId}, ${input.newsroomId}, ${input.leadId}, ${input.draftId},
            ${JSON.stringify(input.pkg)}::jsonb, ${headline}, ${readiness}, ${scoreTotal})
    on conflict (request_id) do update set
      package = excluded.package, headline = excluded.headline,
      readiness_tier = excluded.readiness_tier, score_total = excluded.score_total,
      draft_id = excluded.draft_id, updated_at = now()
  `;
}

/** A dated, sourced observation for the next assignment. Never truncates its text. */
export async function saveReportingObservation(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    requestId?: number | null;
    leadId?: number | null;
    sourceId?: number | null;
    kind: "source" | "correction" | "disposition" | "retrieval";
    text: string;
    evidence: string;
  },
): Promise<void> {
  await sql`
    insert into reporting_observations (newsroom_id, user_id, request_id, lead_id, source_id, kind, text, evidence)
    values (${input.newsroomId}, ${input.userId}, ${input.requestId ?? null}, ${input.leadId ?? null},
            ${input.sourceId ?? null}, ${input.kind}, ${input.text}, ${input.evidence})
  `;
}

/** Observations for retrieval into a new assignment, newest first. */
export async function recentReportingObservations(
  sql: Sql,
  newsroomId: number,
  limit = 20,
): Promise<{ kind: string; text: string; evidence: string; created_at: string }[]> {
  return sql<{ kind: string; text: string; evidence: string; created_at: string }>`
    select kind, text, evidence, created_at from reporting_observations
    where newsroom_id = ${newsroomId} order by created_at desc limit ${limit}
  `;
}

export type RelevantReportingObservation = {
  id: number;
  origin: "reporting" | "source";
  newsroomId: number;
  kind: string;
  text: string;
  evidence: string;
  createdAt: string;
  observedOn: string | null;
  requestId: number | null;
  leadId: number | null;
  sourceId: number | null;
  scope: Array<"lead" | "parent-request" | "seed-source">;
  observedBy: string | null;
  reversalOf: number | null;
};

const RELEVANT_OBSERVATION_LIMIT = 24;
const OBSERVATION_QUERY_LIMIT = 100;

/**
 * Read only observations that belong to this newsroom and assignment. Seed
 * URLs match existing sources exactly; their IDs then scope the observation
 * reads. Human corrections are ranked ahead of automated disposition noise,
 * with recency deciding within each group.
 */
export async function relevantReportingObservations(
  sql: Sql,
  input: {
    newsroomId: number;
    leadId: number | null;
    parentRequestId: number | null;
    seedUrls?: string[];
  },
): Promise<RelevantReportingObservation[]> {
  const seedUrls = [...new Set((input.seedUrls ?? []).map((url) => url.trim()).filter(Boolean))];
  const matchingSources = seedUrls.length
    ? await sql.query<{ id: number; url: string }>(
        "select id, url from sources where newsroom_id = $1 and url = any($2::text[])",
        [input.newsroomId, seedUrls],
      )
    : [];
  const sourceIds = [...new Set(matchingSources.map((source) => Number(source.id)))];

  const reportingRows = await sql.query<{
    id: number;
    newsroom_id: number;
    request_id: number | null;
    lead_id: number | null;
    source_id: number | null;
    kind: string;
    text: string;
    evidence: string;
    created_at: string;
  }>(
    `select id, newsroom_id, request_id, lead_id, source_id, kind, text, evidence, created_at
       from reporting_observations
      where newsroom_id = $1
        and kind in ('correction', 'disposition', 'source', 'retrieval')
        and (($2::integer is not null and lead_id = $2)
          or ($3::bigint is not null and request_id = $3)
          or source_id = any($4::integer[]))
      order by (kind = 'correction') desc, (kind = 'disposition') asc, created_at desc, id desc
      limit $5`,
    [input.newsroomId, input.leadId, input.parentRequestId, sourceIds, OBSERVATION_QUERY_LIMIT],
  );

  const sourceRows = await sql.query<{
    id: number;
    newsroom_id: number;
    source_id: number;
    source_url: string;
    observed_on: string;
    kind: string;
    note: string | null;
    lead_id: number | null;
    observed_by: string;
    reversal_of: number | null;
    created_at: string;
  }>(
    `select so.id, so.newsroom_id, so.source_id, s.url as source_url,
            so.observed_on, so.kind, so.note, so.lead_id, so.observed_by,
            so.reversal_of, so.created_at
       from source_observations so
       join sources s on s.id = so.source_id and s.newsroom_id = so.newsroom_id
      where so.newsroom_id = $1
        and (($2::integer is not null and so.lead_id = $2)
          or so.source_id = any($3::integer[]))
      order by (
        so.observed_by = 'editor' or so.reversal_of is not null or so.kind = 'corrected-draft'
      ) desc,
      (so.observed_by = 'system' and so.kind in ('changed', 'quiet', 'never-checked')) asc,
      so.created_at desc, so.id desc
      limit $4`,
    [input.newsroomId, input.leadId, sourceIds, OBSERVATION_QUERY_LIMIT],
  );

  const observations: RelevantReportingObservation[] = [
    ...reportingRows.map((row) => {
      const sourceId = row.source_id == null ? null : Number(row.source_id);
      return {
        id: Number(row.id),
        origin: "reporting" as const,
        newsroomId: Number(row.newsroom_id),
        kind: row.kind,
        text: row.text,
        evidence: row.evidence,
        createdAt: String(row.created_at),
        observedOn: null,
        requestId: row.request_id == null ? null : Number(row.request_id),
        leadId: row.lead_id == null ? null : Number(row.lead_id),
        sourceId,
        scope: [
          ...(input.leadId != null && Number(row.lead_id) === input.leadId ? ["lead" as const] : []),
          ...(input.parentRequestId != null && Number(row.request_id) === input.parentRequestId
            ? ["parent-request" as const]
            : []),
          ...(sourceId != null && sourceIds.includes(sourceId) ? ["seed-source" as const] : []),
        ],
        observedBy: null,
        reversalOf: null,
      };
    }),
    ...sourceRows.map((row) => ({
      id: Number(row.id),
      origin: "source" as const,
      newsroomId: Number(row.newsroom_id),
      kind: row.kind,
      text: row.note ?? "",
      evidence: row.source_url,
      createdAt: String(row.created_at),
      observedOn: String(row.observed_on),
      requestId: null,
      leadId: row.lead_id == null ? null : Number(row.lead_id),
      sourceId: Number(row.source_id),
      scope: [
        ...(input.leadId != null && Number(row.lead_id) === input.leadId ? ["lead" as const] : []),
        ...(sourceIds.includes(Number(row.source_id)) ? ["seed-source" as const] : []),
      ],
      observedBy: row.observed_by,
      reversalOf: row.reversal_of == null ? null : Number(row.reversal_of),
    })),
  ];

  return observations
    .sort((a, b) => {
      const priorityRank = observationPriority(a) - observationPriority(b);
      if (priorityRank !== 0) return priorityRank;
      const dateRank = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (Number.isFinite(dateRank) && dateRank !== 0) return dateRank;
      return b.id - a.id;
    })
    .slice(0, RELEVANT_OBSERVATION_LIMIT);
}

function isHumanCorrection(observation: RelevantReportingObservation): boolean {
  if (observation.kind === "correction") return true;
  return observation.origin === "source" && (
    observation.observedBy === "editor" ||
    observation.reversalOf !== null ||
    observation.kind === "corrected-draft"
  );
}

function observationPriority(observation: RelevantReportingObservation): number {
  if (isHumanCorrection(observation)) return 0;
  if (observation.origin === "reporting" && observation.kind === "disposition") return 2;
  if (
    observation.origin === "source" &&
    observation.observedBy === "system" &&
    ["changed", "quiet", "never-checked"].includes(observation.kind)
  ) return 2;
  return 1;
}

export { DEFAULT_NEWSROOM_ID };
