/**
 * Writing a scan's registry proposals into `resource_changes` (spec 14,
 * steps 4-6 and the guardrails under them).
 *
 * What this module does NOT do is the point of it:
 *
 *  - it never writes a registry table. No `update services`, no publish flip.
 *    A proposal is a `resource_changes` row in `review_state='pending'` (or
 *    `needs-editor` for a crisis-flagged service) and nothing else;
 *  - it never creates an organization, service or any other HSDS row. A
 *    change that matches no existing entity is stored with `entity_id` null --
 *    a new-entity proposal for an editor -- not inserted;
 *  - a change with no retained capture for the page it cites is rejected, not
 *    stored as an unverified row (13.3: `evidence_capture_id` is NOT NULL).
 *
 * `scan_run_id`, `source_id` and `evidence_tier` are the desk's facts, not the
 * model's: the model names the source URL, and the caller's maps turn that
 * into this run's source id, this fetch's snapshot, and the source's tier.
 */

import type { Sql } from "../../db.ts";
import type { ParsedResourceChange } from "../schema.ts";

/** Entity type (the schema's closed set) -> the table it lives in. */
const ENTITY_TABLE: Record<ParsedResourceChange["entity_type"], string> = {
  organization: "organizations",
  service: "services",
  location: "locations",
  service_at_location: "service_at_locations",
  schedule: "schedules",
  contact: "contacts",
  eligibility: "eligibilities",
  required_document: "required_documents",
  language: "languages",
  accessibility: "accessibilities",
  taxonomy: "taxonomies",
};

/** Only these tables have a `name` column to match `entity_name` against. */
const TABLES_WITH_NAME = new Set([
  "organizations",
  "services",
  "locations",
  "taxonomies",
  "contacts",
]);

/**
 * One spelling for the same page. The model echoes a URL it read from the
 * batch, where a trailing slash or a fragment is easy to add or drop.
 */
export function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/**
 * The tier a change's evidence takes, from its source's tier.
 *
 * `resource_changes.evidence_tier` allows A/B/C only; a source whose own tier
 * is `unclassified` (or anything else) is recorded as C, the weakest claim,
 * rather than promoted.
 */
export function evidenceTierForSource(tier: string | null | undefined): "A" | "B" | "C" {
  return tier === "A" || tier === "B" ? tier : "C";
}

async function resolveEntityId(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
): Promise<number | null> {
  const table = ENTITY_TABLE[change.entity_type];
  if (change.entity_hsds_id) {
    const rows = await sql.query<{ id: number }>(
      `select id from ${table} where newsroom_id = $1 and hsds_id = $2 limit 1`,
      [newsroomId, change.entity_hsds_id],
    );
    if (rows[0]) return Number(rows[0].id);
  }
  if (change.entity_name && TABLES_WITH_NAME.has(table)) {
    const rows = await sql.query<{ id: number }>(
      `select id from ${table} where newsroom_id = $1 and lower(name) = lower($2) limit 1`,
      [newsroomId, change.entity_name],
    );
    if (rows[0]) return Number(rows[0].id);
  }
  return null;
}

/**
 * A crisis-flagged service is never auto-modified (spec 14): any change to it
 * lands in the editor's queue whatever the model's confidence.
 */
async function entityIsCrisis(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  entityId: number | null,
): Promise<boolean> {
  if (change.entity_type !== "service" || entityId === null) return false;
  const rows = await sql.query<{ crisis: boolean }>(
    "select crisis from services where id = $1 and newsroom_id = $2 limit 1",
    [entityId, newsroomId],
  );
  return rows[0]?.crisis === true;
}

export interface ScanResourceChangeCommitInput {
  newsroomId: number;
  scanRunId: number;
  changes: ParsedResourceChange[];
  /** Normalized source URL -> this newsroom's source id. */
  sourceIdByUrl: Map<string, number>;
  /** Source id -> the snapshot this run retained for it (changed sources only). */
  snapshotIdBySourceId: Map<number, number>;
  /** Source id -> its `sources.tier`. */
  tierBySourceId: Map<number, string>;
}

export interface ScanResourceChangeCommitResult {
  stored: number;
  /** Changes dropped because their cited page has no retained capture. */
  rejected: number;
  /** Stored changes the crisis rule sent straight to the editor. */
  needsEditor: number;
}

export async function commitScanResourceChanges(
  sql: Sql,
  input: ScanResourceChangeCommitInput,
): Promise<ScanResourceChangeCommitResult> {
  let stored = 0;
  let rejected = 0;
  let needsEditor = 0;

  for (const change of input.changes) {
    const sourceId = input.sourceIdByUrl.get(normalizeSourceUrl(change.source_url));
    const snapshotId = sourceId === undefined ? undefined : input.snapshotIdBySourceId.get(sourceId);
    /*
      Capture-or-reject (guardrail 1). No source, or a source this run did not
      retain a capture for, is not something an editor could check -- and a
      proposal nobody can check is exactly the unverified row 13.3 forbids.
    */
    if (sourceId === undefined || snapshotId === undefined) {
      rejected += 1;
      continue;
    }

    const entityId = await resolveEntityId(sql, input.newsroomId, change);
    const crisis = await entityIsCrisis(sql, input.newsroomId, change, entityId);
    const reviewState = crisis ? "needs-editor" : "pending";
    if (crisis) needsEditor += 1;

    await sql.query(
      `insert into resource_changes
         (newsroom_id, scan_run_id, source_id, source_capture_id, evidence_capture_id,
          evidence_tier, entity_type, entity_id, field_name, before_value, after_value,
          change_kind, summary, model_confidence, review_state, lead_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, null)`,
      [
        input.newsroomId,
        input.scanRunId,
        sourceId,
        snapshotId,
        evidenceTierForSource(input.tierBySourceId.get(sourceId)),
        change.entity_type,
        entityId,
        change.field_name,
        change.before_value,
        change.after_value,
        change.change_kind,
        change.summary || null,
        change.model_confidence,
        reviewState,
      ],
    );
    stored += 1;
  }

  return { stored, rejected, needsEditor };
}

/** The run's own sentence about its registry proposals, or "". */
export function registryChangeSentence(counts: ScanResourceChangeCommitResult): string {
  if (counts.stored === 0 && counts.rejected === 0) return "";
  const parts: string[] = [];
  if (counts.stored > 0) {
    parts.push(
      `${counts.stored} registry change proposal${counts.stored === 1 ? "" : "s"} filed for review`,
    );
  }
  if (counts.needsEditor > 0) {
    parts.push(
      `${counts.needsEditor} to the editor because the service is a crisis resource`,
    );
  }
  if (counts.rejected > 0) {
    parts.push(
      `${counts.rejected} registry change${counts.rejected === 1 ? "" : "s"} rejected for lack of a retained capture`,
    );
  }
  return `${parts.join("; ")}.`;
}
