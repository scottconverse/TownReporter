/**
 * Writing a scan's registry changes into `resource_changes` (spec 14) and, since
 * Scott's Nov 20 2026 order, applying and publishing them.
 *
 * What changed and why:
 *
 *  - A change whose page this run retained a capture for is applied to the
 *    registry and the entry is PUBLISHED in the scan's own commit. The order is
 *    "Publishing everything it finds that's relevant automatically."
 *  - A change that matches no entity of its own now CREATES the organization,
 *    service or location row (part 3), using the same column mapping the HSDS
 *    importer uses (`TABLE_COLUMNS`/`ENTITY_TYPE`), instead of leaving an
 *    editor-only proposal with `entity_id` null.
 *  - Crisis services are published too. Their audit row is marked `[Crisis]` so
 *    the desk lists them first and an editor can still take one down.
 *  - A change with no retained capture for the page it cites is still rejected,
 *    not stored unverified (13.3: `evidence_capture_id` is NOT NULL).
 *
 * `scan_run_id`, `source_id` and `evidence_tier` are the desk's facts, not the
 * model's: the model names the source URL, and the caller's maps turn that into
 * this run's source id, this fetch's snapshot, and the source's tier.
 */

import type { Sql } from "../../db.ts";
import type { ParsedResourceChange } from "../schema.ts";
import { deskSlug } from "./registry-entry-fields.ts";
import { ENTITY_TYPE, TABLE_COLUMNS } from "./hsds-import.server.ts";
import type { RegistryTableName } from "./hsds-map.ts";
import { recordRegistryEvent } from "./registry-audit.server.ts";
import { publishRegistryEntryTx } from "./registry-desk-write.server.ts";

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

/** The same mapping, the other way round: entity_type -> registry table. */
const TABLE_FOR_ENTITY = new Map<string, RegistryTableName>(
  (Object.entries(ENTITY_TYPE) as [RegistryTableName, string][]).map(([table, type]) => [type, table]),
);

/** Only these tables have a `name` column to match `entity_name` against. */
const TABLES_WITH_NAME = new Set([
  "organizations",
  "services",
  "locations",
  "taxonomies",
  "contacts",
]);

/** The directory new scan-created rows land in when their source names none. */
export const SCAN_CREATED_DIRECTORY = "Scan finds";

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
 * Whether a change states a fact at all (Scott, Nov 20 2026).
 *
 * A proposal with a name and nothing else is useless on the desk: an editor
 * cannot check it and accepting it changes nothing. The model could send
 * `field_name: "name"` with neither value, so the scan now stores only a
 * change that names a value -- the old one in `before_value` or the new one in
 * `after_value` -- and drops the rest. This is the root of the empty proposal
 * Scott saw on the registry desk.
 */
export function changeHasFact(
  change: Pick<ParsedResourceChange, "before_value" | "after_value">,
): boolean {
  return [change.before_value, change.after_value].some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
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
): Promise<{ id: number | null; ambiguous: boolean }> {
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
    if (rows.length === 1) return { id: Number(rows[0]!.id), ambiguous: false };
    if (rows.length > 1) return { id: null, ambiguous: true };
  }
  if (change.entity_name && TABLES_WITH_NAME.has(table)) {
    const rows = await find("name", change.entity_name, true);
    if (rows.length === 1) return { id: Number(rows[0]!.id), ambiguous: false };
    if (rows.length > 1) return { id: null, ambiguous: true };
  }
  return { id: null, ambiguous: false };
}

/**
 * The service ids a changed child row belongs to.
 *
 * A schedule, contact, eligibility, required document, language, accessibility
 * or service-at-location row carries no crisis flag of its own -- the flag is
 * on the service, and spec 14's rule applies to every row beneath it. So the
 * row's own link is followed to its service: directly where the table has a
 * `service_id`, and through `service_at_locations` when the row hangs off a
 * location or a schedule instead.
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
 * A crisis-flagged service is listed first on the desk. Scott's Nov 20 order
 * keeps it published automatically; the flag only changes where the desk puts
 * the row, not whether it is applied.
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

/** The columns a change may apply to: the importer's data columns, minus links. */
function applicableColumns(table: RegistryTableName): string[] {
  return TABLE_COLUMNS[table].filter((column) => !column.endsWith("_id"));
}

/** A boolean column from the model's text, or null when it is not one. */
function booleanValue(value: string | null): boolean | null {
  if (value == null) return null;
  const text = value.trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(text)) return true;
  if (["false", "no", "0", "n"].includes(text)) return false;
  return null;
}

function numericValue(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Columns that are booleans or numbers in the registry tables. */
const BOOLEAN_COLUMNS = new Set(["crisis", "by_appointment", "required"]);
const NUMERIC_COLUMNS = new Set(["latitude", "longitude"]);

/** Columns a row cannot hold a null in; a null proposal must not blank them. */
const NOT_NULL_COLUMNS = new Set(["name", "document", "language", "accessibility"]);

/** The value a column takes, coerced to the column's type. */
function columnValue(column: string, value: string | null): unknown {
  if (BOOLEAN_COLUMNS.has(column)) return booleanValue(value);
  if (NUMERIC_COLUMNS.has(column)) return numericValue(value);
  return value;
}

/** A short, stable-ish id for a row the scan created. */
function scanHsdsId(entityType: string, name: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `scan-${entityType}-${deskSlug(name || "entry")}-${suffix}`;
}

/** The organization a scan-created service or location hangs off. */
async function findOrCreateOrganization(
  sql: Sql,
  newsroomId: number,
  sourceId: number,
  snapshotId: number,
  directoryName: string,
  name: string,
): Promise<number> {
  const existing = await sql.query<{ id: number }>(
    `select id from organizations
      where newsroom_id = $1 and lower(name) = lower($2)
      order by id limit 1`,
    [newsroomId, name],
  );
  if (existing[0]) return Number(existing[0].id);
  const inserted = await sql.query<{ id: number }>(
    `insert into organizations
       (newsroom_id, hsds_id, directory_name, name, status, published,
        source_id, source_capture_id, verification_method)
     values ($1, $2, $3, $4, 'unverified', false, $5, $6, 'scan')
     returning id`,
    [newsroomId, scanHsdsId("org", name), directoryName, name, sourceId, snapshotId],
  );
  return Number(inserted[0]!.id);
}

/**
 * Create the organization, service or location a new-entity change names
 * (part 3), using the importer's table and column names. Child entity types
 * (a schedule, a contact) still cannot be created without their parent, so
 * they stay a proposal for an editor.
 *
 * Returns the new row's id, or null for a type this does not create.
 */
async function createEntityForChange(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  sourceId: number,
  snapshotId: number,
  directoryName: string,
): Promise<number | null> {
  const name = (change.entity_name || change.after_value || "").trim();
  if (!name) return null;

  if (change.entity_type === "organization") {
    const inserted = await sql.query<{ id: number }>(
      `insert into organizations
         (newsroom_id, hsds_id, directory_name, name, status, published,
          source_id, source_capture_id, verification_method)
       values ($1, $2, $3, $4, 'unverified', false, $5, $6, 'scan')
       returning id`,
      [newsroomId, scanHsdsId("org", name), directoryName, name, sourceId, snapshotId],
    );
    return Number(inserted[0]!.id);
  }

  if (change.entity_type === "service") {
    const organizationId = await findOrCreateOrganization(
      sql,
      newsroomId,
      sourceId,
      snapshotId,
      directoryName,
      name,
    );
    const inserted = await sql.query<{ id: number }>(
      `insert into services
         (newsroom_id, hsds_id, directory_name, organization_id, name, status, published,
          source_id, source_capture_id, verification_method)
       values ($1, $2, $3, $4, $5, 'unverified', false, $6, $7, 'scan')
       returning id`,
      [
        newsroomId,
        scanHsdsId("svc", name),
        directoryName,
        organizationId,
        name,
        sourceId,
        snapshotId,
      ],
    );
    return Number(inserted[0]!.id);
  }

  if (change.entity_type === "location") {
    const organizationId = await findOrCreateOrganization(
      sql,
      newsroomId,
      sourceId,
      snapshotId,
      directoryName,
      name,
    );
    const inserted = await sql.query<{ id: number }>(
      `insert into locations
         (newsroom_id, hsds_id, organization_id, name, status, published,
          source_id, source_capture_id, verification_method)
       values ($1, $2, $3, $4, 'unverified', false, $5, $6, 'scan')
       returning id`,
      [newsroomId, scanHsdsId("loc", name), organizationId, name, sourceId, snapshotId],
    );
    return Number(inserted[0]!.id);
  }

  return null;
}

/** Put a phone, email or website on the entity's own contact row. */
async function saveEntityContactField(
  sql: Sql,
  newsroomId: number,
  entityType: "service" | "organization",
  entityId: number,
  column: "phone" | "email" | "website",
  value: string | null,
): Promise<void> {
  const scope = entityType === "service" ? "service_id" : "organization_id";
  const existing = await sql.query<{ id: number }>(
    `select id from contacts
      where newsroom_id = $1 and ${scope} = $2 and removed_at is null
      order by id limit 1`,
    [newsroomId, entityId],
  );
  if (existing[0]) {
    await sql.query(
      `update contacts set ${column} = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [value, Number(existing[0].id), newsroomId],
    );
    return;
  }
  if (!value) return;
  await sql.query(
    `insert into contacts
       (newsroom_id, hsds_id, directory_name, ${scope}, ${column}, published)
     values ($1, $2, $3, $4, $5, false)`,
    [
      newsroomId,
      `scan-contact-${entityId}-${Math.random().toString(36).slice(2, 8)}`,
      SCAN_CREATED_DIRECTORY,
      entityId,
      value,
    ],
  );
}

/** Put a schedule column on the service's first schedule row. */
async function saveServiceScheduleField(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  column: string,
  value: unknown,
): Promise<void> {
  const existing = await sql.query<{ id: number }>(
    `select id from schedules
      where newsroom_id = $1 and service_id = $2 and removed_at is null
      order by id limit 1`,
    [newsroomId, serviceId],
  );
  if (existing[0]) {
    await sql.query(
      `update schedules set ${column} = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [value, Number(existing[0].id), newsroomId],
    );
    return;
  }
  if (value == null || value === "") return;
  await sql.query(
    `insert into schedules
       (newsroom_id, hsds_id, directory_name, service_id, ${column}, published)
     values ($1, $2, $3, $4, $5, false)`,
    [
      newsroomId,
      `scan-schedule-${serviceId}-${Math.random().toString(36).slice(2, 8)}`,
      SCAN_CREATED_DIRECTORY,
      serviceId,
      value,
    ],
  );
}

/**
 * Apply one change's proposed value to its row. Returns true when a value was
 * written. A field that does not map to a stored fact is left for the editor
 * and returns false; the change is still recorded as auto-published.
 */
async function applyChangeValue(
  sql: Sql,
  newsroomId: number,
  change: ParsedResourceChange,
  entityId: number,
): Promise<boolean> {
  const table = TABLE_FOR_ENTITY.get(change.entity_type);
  if (!table) return false;
  const field = change.field_name.trim().toLowerCase();
  const columns = applicableColumns(table);

  if (columns.includes(field)) {
    const value = columnValue(field, change.after_value);
    if (NOT_NULL_COLUMNS.has(field) && value == null) return false;
    await sql.query(
      `update ${table} set ${field} = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [value, entityId, newsroomId],
    );
    return true;
  }

  if (
    (table === "services" || table === "organizations") &&
    (field === "phone" || field === "email" || field === "website")
  ) {
    await saveEntityContactField(
      sql,
      newsroomId,
      table === "services" ? "service" : "organization",
      entityId,
      field,
      change.after_value,
    );
    return true;
  }

  if (
    table === "services" &&
    ["days", "opens_at", "closes_at", "by_appointment", "notes"].includes(field)
  ) {
    await saveServiceScheduleField(
      sql,
      newsroomId,
      entityId,
      field,
      columnValue(field, change.after_value),
    );
    return true;
  }

  return false;
}

/** The sentence stored on every auto-published change row. */
function autoPublishNote(change: ParsedResourceChange, applied: boolean): string {
  const source = change.source_url || "the registry source";
  return applied
    ? `Auto-published by the scan from ${source}.`
    : `Auto-published by the scan from ${source}; this field was not applied automatically, so check it.`;
}

export interface ScanResourceChangeCommitInput {
  newsroomId: number;
  /** The scan run that read the page; null for a robot recheck outside a run. */
  scanRunId: number | null;
  /** The scan's own user; the actor on every auto-publish audit row. */
  userId: string;
  changes: ParsedResourceChange[];
  /** Normalized source URL -> this newsroom's source id. */
  sourceIdByUrl: Map<string, number>;
  /** Source id -> the snapshot this run retained for it (changed or weekly re-read). */
  snapshotIdBySourceId: Map<number, number>;
  /** Source id -> its `sources.tier`. */
  tierBySourceId: Map<number, string>;
  /**
   * True by default: a change naming no existing entity creates one (part 3).
   * A robot recheck sets this false -- rechecking a page must never grow the
   * registry, so an unmatched change stays a proposal for an editor.
   */
  createMissing?: boolean;
}

export interface ScanResourceChangeCommitResult {
  /** Change rows written (published or still waiting for an editor). */
  stored: number;
  /** Changes dropped because their cited page has no retained capture. */
  rejected: number;
  /** Entries the scan published by itself. */
  published: number;
  /** Organization, service or location rows the scan created. */
  created: number;
  /** Auto-published changes on a crisis service (`[Crisis]` in the audit row). */
  crisis: number;
}

/**
 * Publish the entry a change belongs to. Services take the editor's own publish
 * path (`publishRegistryEntryTx`); an organization or location is published in
 * place; a child row publishes the services it hangs off.
 *
 * Every one of them writes an audit row whose actor is the scan, carrying the
 * source URL, so the desk can list what was auto-published and an editor can
 * take it down.
 */
async function publishChangeEntity(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    change: ParsedResourceChange;
    entityId: number;
    changeRowId: number;
    crisis: boolean;
  },
): Promise<boolean> {
  const { newsroomId, userId, change, entityId, changeRowId, crisis } = input;
  const marker = crisis ? "[Crisis] " : "";
  const source = change.source_url || "an unnamed registry page";

  if (change.entity_type === "service") {
    await publishRegistryEntryTx(sql, newsroomId, entityId, userId, {
      action: "registry.service.autopublish",
      detail: `${marker}Auto-published a service from ${source}.`,
    });
    return true;
  }

  if (change.entity_type === "organization" || change.entity_type === "location") {
    const table = change.entity_type === "organization" ? "organizations" : "locations";
    await sql.query(
      `update ${table}
          set published = true,
              status = case when status = 'unverified' then 'active' else status end,
              updated_at = now()
        where id = $1 and newsroom_id = $2`,
      [entityId, newsroomId],
    );
    await recordRegistryEvent(sql, {
      newsroomId,
      userId,
      action: "registry.change.autopublish",
      subjectKind: "registry-change",
      subjectId: changeRowId,
      detail: `${marker}Auto-published a ${change.entity_type} from ${source}.`,
    });
    return true;
  }

  const serviceIds = await linkedServiceIds(sql, newsroomId, change, entityId);
  for (const serviceId of serviceIds) {
    await publishRegistryEntryTx(sql, newsroomId, serviceId, userId, {
      action: "registry.service.autopublish",
      detail: `${marker}Auto-published a service after a ${change.entity_type} change from ${source}.`,
    });
  }
  return serviceIds.length > 0;
}

export async function commitScanResourceChanges(
  sql: Sql,
  input: ScanResourceChangeCommitInput,
): Promise<ScanResourceChangeCommitResult> {
  let stored = 0;
  let rejected = 0;
  let published = 0;
  let created = 0;
  let crisisCount = 0;

  for (const change of input.changes) {
    const sourceId = input.sourceIdByUrl.get(normalizeSourceUrl(change.source_url));
    const snapshotId = sourceId === undefined ? undefined : input.snapshotIdBySourceId.get(sourceId);
    /*
      Capture-or-reject (guardrail 1). No source, or a source this run did not
      retain a capture for, is not something an editor could check -- and a
      published row nobody can check is exactly the unverified row 13.3 forbids.
    */
    if (sourceId === undefined || snapshotId === undefined) {
      rejected += 1;
      continue;
    }

    /*
      A change with a name and no value is not a fact an editor can check or
      apply. It is dropped here rather than stored as an empty proposal.
    */
    if (!changeHasFact(change)) {
      rejected += 1;
      continue;
    }

    const directoryName =
      (await directoryNameForSource(sql, input.newsroomId, sourceId)) ?? SCAN_CREATED_DIRECTORY;

    const resolved = await resolveEntityId(sql, input.newsroomId, change, sourceId);
    let entityId = resolved.id;
    /*
      An ambiguous name is never treated as a new entity: creating a second
      "Ambiguous Pantry" because two rows share the name would grow the registry
      with a duplicate. Only a name that matches nothing is created.
    */
    if (entityId === null && !resolved.ambiguous && input.createMissing !== false) {
      entityId = await createEntityForChange(
        sql,
        input.newsroomId,
        change,
        sourceId,
        snapshotId,
        directoryName,
      );
      if (entityId !== null) {
        created += 1;
        /*
          The new row starts as a name. Whatever else this change states about
          it -- a description, a phone, a fee, hours -- is applied now, so the
          entry does not reach the desk as a name and nothing else.
        */
        await applyChangeValue(sql, input.newsroomId, change, entityId);
      }
    }

    /*
      A child row (schedule, contact, eligibility, ...) cannot be created
      without its parent, and an ambiguous name has no single parent. Either
      way it stays a pending proposal, so the editor can attach it to the
      right service.
    */
    if (entityId === null) {
      await sql.query(
        `insert into resource_changes
           (newsroom_id, scan_run_id, source_id, source_capture_id, evidence_capture_id,
            evidence_tier, entity_type, entity_id, entity_name, entity_hsds_id,
            field_name, before_value, after_value,
            change_kind, summary, evidence_quote, model_confidence, review_state, lead_id)
         values ($1, $2, $3, $4, $4, $5, $6, null, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending', null)`,
        [
          input.newsroomId,
          input.scanRunId,
          sourceId,
          snapshotId,
          evidenceTierForSource(input.tierBySourceId.get(sourceId)),
          change.entity_type,
          change.entity_name?.trim() || null,
          change.entity_hsds_id?.trim() || null,
          change.field_name,
          change.before_value,
          change.after_value,
          change.change_kind,
          change.summary || null,
          change.quote?.trim() || null,
          change.model_confidence,
        ],
      );
      stored += 1;
      continue;
    }

    const applied = await applyChangeValue(sql, input.newsroomId, change, entityId);
    const crisis = await entityIsCrisis(sql, input.newsroomId, change, entityId);
    if (crisis) crisisCount += 1;

    const [row] = await sql.query<{ id: number }>(
      `insert into resource_changes
         (newsroom_id, scan_run_id, source_id, source_capture_id, evidence_capture_id,
          evidence_tier, entity_type, entity_id, entity_name, entity_hsds_id,
          field_name, before_value, after_value,
          change_kind, summary, evidence_quote, model_confidence, review_state,
          applied_at, review_note, lead_id)
       values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               'accepted', ${applied ? "now()" : "null"}, $17, null)
       returning id`,
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
        change.quote?.trim() || null,
        change.model_confidence,
        autoPublishNote(change, applied),
      ],
    );
    stored += 1;

    const didPublish = await publishChangeEntity(sql, {
      newsroomId: input.newsroomId,
      userId: input.userId,
      change,
      entityId,
      changeRowId: Number(row!.id),
      crisis,
    });
    if (didPublish) published += 1;
  }

  return { stored, rejected, published, created, crisis: crisisCount };
}

/** The run's own sentence about its registry changes, or "". */
export function registryChangeSentence(counts: ScanResourceChangeCommitResult): string {
  if (counts.stored === 0 && counts.rejected === 0) return "";
  const parts: string[] = [];
  if (counts.stored > 0) {
    const created = counts.created > 0 ? `, ${counts.created} new` : "";
    parts.push(
      `${counts.stored} registry change${counts.stored === 1 ? "" : "s"} auto-published${created}`,
    );
  }
  if (counts.crisis > 0) {
    parts.push(
      `${counts.crisis} crisis service change${counts.crisis === 1 ? "" : "s"} listed first on the desk`,
    );
  }
  if (counts.rejected > 0) {
    parts.push(
      `${counts.rejected} registry change${counts.rejected === 1 ? "" : "s"} rejected for lack of a retained capture or a stated fact`,
    );
  }
  return `${parts.join("; ")}.`;
}
