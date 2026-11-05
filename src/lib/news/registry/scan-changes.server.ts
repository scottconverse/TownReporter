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

/**
 * The directory an evidence source belongs to, when the registry knows one.
 *
 * A source can carry several registry roles, each with its own directory name;
 * only a single distinct name is usable as a filter. No name, or two names,
 * means the directory is unknown and the lookup stays newsroom-wide.
 */
async function directoryNameForSource(
  sql: Sql,
  newsroomId: number,
  sourceId: number,
): Promise<string | null> {
  const rows = await sql.query<{ directory_name: string }>(
    `select distinct directory_name
       from resource_sources
      where newsroom_id = $1 and source_id = $2 and directory_name is not null`,
    [newsroomId, sourceId],
  );
  return rows.length === 1 ? rows[0]!.directory_name : null;
}

/**
 * The registry row a change names, or null when there is no single answer.
 *
 * The HSDS id is unique only per (newsroom, directory_name, hsds_id): two
 * directories in one newsroom may both number a record the same way. So the
 * lookup is narrowed to the directory of the change's own source when that is
 * known. Where more than one row still matches -- by HSDS id or by the name
 * fallback -- the change is left unresolved rather than bound to whichever row
 * happened to come back first.
 */
async function resolveEntityId(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  sourceId: number,
): Promise<number | null> {
  const table = ENTITY_TABLE[change.entity_type];
  const directoryName = await directoryNameForSource(sql, newsroomId, sourceId);

  const find = async (column: string, value: string, caseInsensitive = false) => {
    const params: unknown[] = [newsroomId, value];
    let text = `select id from ${table} where newsroom_id = $1 and `;
    text += caseInsensitive ? `lower(${column}) = lower($2)` : `${column} = $2`;
    if (directoryName !== null) {
      params.push(directoryName);
      text += ` and directory_name = $3`;
    }
    return sql.query<{ id: number }>(text, params);
  };

  if (change.entity_hsds_id) {
    const rows = await find("hsds_id", change.entity_hsds_id);
    if (rows.length === 1) return Number(rows[0]!.id);
    if (rows.length > 1) return null;
  }
  if (change.entity_name && TABLES_WITH_NAME.has(table)) {
    const rows = await find("name", change.entity_name, true);
    if (rows.length === 1) return Number(rows[0]!.id);
  }
  return null;
}

/**
 * The service ids a changed child row belongs to.
 *
 * A schedule, contact, eligibility, required document, language, accessibility
 * or service-at-location row carries no crisis flag of its own -- the flag is
 * on the service, and spec 14's rule ("crisis-flagged services are never
 * auto-modified") applies to every row beneath it. So the row's own link is
 * followed to its service: directly where the table has a `service_id`, and
 * through `service_at_locations` when the row hangs off a location or a
 * schedule instead.
 *
 * A row that names no service -- an organization-level contact, say -- is
 * followed through its organization to that organization's services, because
 * the phone on the organization is often the crisis line itself.
 */
async function linkedServiceIds(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  entityId: number,
): Promise<number[]> {
  const query = async (text: string) => {
    const rows = await sql.query<{ service_id: number | null }>(text, [entityId, newsroomId]);
    return rows
      .map((row) => (row.service_id == null ? null : Number(row.service_id)))
      .filter((id): id is number => id !== null);
  };

  switch (change.entity_type) {
    case "service":
      return [entityId];
    case "eligibility":
      return query(
        "select service_id from eligibilities where id = $1 and newsroom_id = $2",
      );
    case "required_document":
      return query(
        "select service_id from required_documents where id = $1 and newsroom_id = $2",
      );
    case "language":
      return query("select service_id from languages where id = $1 and newsroom_id = $2");
    case "service_at_location":
      return query(
        "select service_id from service_at_locations where id = $1 and newsroom_id = $2",
      );
    case "schedule":
      /*
        A schedule names its service directly, or belongs to a location (or to
        a service-at-location row) and reaches its service that way. The
        location path is used only when the schedule names no service of its
        own, so one schedule shared by a location's services is not confused
        with a schedule the service owns.
      */
      return query(
        `select sc.service_id
           from schedules sc
          where sc.id = $1 and sc.newsroom_id = $2 and sc.service_id is not null
         union
         select sal.service_id
           from schedules sc
           join service_at_locations sal
             on sal.newsroom_id = sc.newsroom_id
            and (sal.schedule_id = sc.id
                 or (sc.service_id is null and sc.location_id is not null
                     and sal.location_id = sc.location_id))
          where sc.id = $1 and sc.newsroom_id = $2`,
      );
    case "accessibility":
      return query(
        `select a.service_id
           from accessibilities a
          where a.id = $1 and a.newsroom_id = $2 and a.service_id is not null
         union
         select sal.service_id
           from accessibilities a
           join service_at_locations sal
             on sal.newsroom_id = a.newsroom_id and sal.location_id = a.location_id
          where a.id = $1 and a.newsroom_id = $2
            and a.service_id is null and a.location_id is not null`,
      );
    case "contact":
      return query(
        `select c.service_id
           from contacts c
          where c.id = $1 and c.newsroom_id = $2 and c.service_id is not null
         union
         select s.id
           from contacts c
           join services s
             on s.organization_id = c.organization_id and s.newsroom_id = c.newsroom_id
          where c.id = $1 and c.newsroom_id = $2
            and c.service_id is null and c.organization_id is not null
         union
         select sal.service_id
           from contacts c
           join service_at_locations sal
             on sal.newsroom_id = c.newsroom_id and sal.location_id = c.location_id
          where c.id = $1 and c.newsroom_id = $2
            and c.service_id is null and c.location_id is not null`,
      );
    default:
      return [];
  }
}

/**
 * A crisis-flagged service is never auto-modified (spec 14): any change to it
 * lands in the editor's queue whatever the model's confidence. That includes a
 * change to a schedule, contact, eligibility rule, required document, language,
 * accessibility note or service-at-location row that belongs to the service.
 */
async function entityIsCrisis(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  entityId: number | null,
): Promise<boolean> {
  if (entityId === null) return false;
  const serviceIds = await linkedServiceIds(sql, newsroomId, change, entityId);
  if (serviceIds.length === 0) return false;
  const placeholders = serviceIds.map((_, index) => `$${index + 2}`).join(", ");
  const rows = await sql.query<{ crisis: boolean }>(
    `select crisis from services
      where newsroom_id = $1 and id in (${placeholders}) and crisis = true limit 1`,
    [newsroomId, ...serviceIds],
  );
  return rows.length > 0;
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

    const entityId = await resolveEntityId(sql, input.newsroomId, change, sourceId);
    const crisis = await entityIsCrisis(sql, input.newsroomId, change, entityId);
    const reviewState = crisis ? "needs-editor" : "pending";
    if (crisis) needsEditor += 1;

    await sql.query(
      `insert into resource_changes
         (newsroom_id, scan_run_id, source_id, source_capture_id, evidence_capture_id,
          evidence_tier, entity_type, entity_id, entity_name, entity_hsds_id,
          field_name, before_value, after_value,
          change_kind, summary, model_confidence, review_state, lead_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, null)`,
      [
        input.newsroomId,
        input.scanRunId,
        sourceId,
        snapshotId,
        evidenceTierForSource(input.tierBySourceId.get(sourceId)),
        change.entity_type,
        entityId,
        change.entity_name?.trim() || null,
        change.entity_hsds_id?.trim() || null,
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
