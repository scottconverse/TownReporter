/**
 * The read-only desk view of the registry (spec 24, Phase 1).
 *
 * Phase 1 has no review actions: spec 24 puts accept / reject / needs-editor /
 * redraft in Phase 2. So everything here is a read. The three lists the desk
 * page draws are:
 *
 *  - the changes the scan detected (`resource_changes`), newest first, with the
 *    entity they name, the before and after values, the evidence tier, the
 *    source and the capture the change rests on;
 *  - the HSDS imports (`resource_imports`);
 *  - the registry sources (`resource_sources` joined to `sources`).
 *
 * The query functions take the `Sql` they should use so a test can drive them
 * against PGlite and a server function can drive them against the live desk.
 * Nothing is written anywhere in this module.
 */

import type { Sql } from "../../db.ts";
import { STARTER_LIST_DIRECTORY } from "./starter-list.ts";

/** A timestamp as the driver hands it back: pg gives a Date, PGlite a Date. */
export type WhenValue = string | Date | null;

export interface DeskRegistryChange {
  id: number;
  reviewState: string;
  entityType: string;
  entityId: number | null;
  /** The entity's own name when it has one; null for a new-entry proposal. */
  entityName: string | null;
  fieldName: string;
  beforeValue: string | null;
  afterValue: string | null;
  changeKind: string;
  summary: string | null;
  evidenceTier: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  captureDate: WhenValue;
  scanRunId: number | null;
  createdAt: WhenValue;
}

export interface DeskRegistryImport {
  id: number;
  directoryName: string;
  format: string;
  sourceUrl: string | null;
  importedAt: WhenValue;
  recordCount: number;
  conflictCount: number;
  report: string | null;
}

export interface DeskRegistrySource {
  id: number;
  registryRole: string;
  directoryName: string | null;
  title: string;
  url: string;
  lastFetchedAt: WhenValue;
  lastError: string | null;
}

/**
 * Every detected change in one newsroom, newest first.
 *
 * The entity's name is read with a `case` of scalar subqueries rather than a
 * join per entity type: `entity_type` decides which table holds the row, and a
 * scan of eleven left joins would be both wider and slower than the eleven
 * short lookups Postgres actually evaluates (one case branch runs). A child row
 * that has no name of its own -- a schedule, an eligibility rule -- shows the
 * name of the service it belongs to, which is the thing the editor needs to
 * recognise.
 */
export async function listDeskChanges(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistryChange[]> {
  const rows = await sql.query<{
    id: number;
    review_state: string;
    entity_type: string;
    entity_id: number | null;
    entity_name: string | null;
    stored_entity_name: string | null;
    field_name: string;
    before_value: string | null;
    after_value: string | null;
    change_kind: string;
    summary: string | null;
    evidence_tier: string;
    source_title: string | null;
    source_url: string | null;
    capture_date: WhenValue;
    scan_run_id: number | null;
    created_at: WhenValue;
  }>(
    `select rc.id, rc.review_state, rc.entity_type, rc.entity_id,
            case rc.entity_type
              when 'organization' then (select o.name from organizations o
                 where o.id = rc.entity_id and o.newsroom_id = rc.newsroom_id)
              when 'service' then (select sv.name from services sv
                 where sv.id = rc.entity_id and sv.newsroom_id = rc.newsroom_id)
              when 'location' then (select l.name from locations l
                 where l.id = rc.entity_id and l.newsroom_id = rc.newsroom_id)
              when 'contact' then (select c.name from contacts c
                 where c.id = rc.entity_id and c.newsroom_id = rc.newsroom_id)
              when 'taxonomy' then (select t.name from taxonomies t
                 where t.id = rc.entity_id and t.newsroom_id = rc.newsroom_id)
              when 'service_at_location' then (
                 select sv.name from service_at_locations sal
                   join services sv on sv.id = sal.service_id and sv.newsroom_id = sal.newsroom_id
                  where sal.id = rc.entity_id and sal.newsroom_id = rc.newsroom_id)
              when 'schedule' then (
                 select sv.name from schedules sc
                   join services sv on sv.id = sc.service_id and sv.newsroom_id = sc.newsroom_id
                  where sc.id = rc.entity_id and sc.newsroom_id = rc.newsroom_id)
              when 'eligibility' then (
                 select sv.name from eligibilities e
                   join services sv on sv.id = e.service_id and sv.newsroom_id = e.newsroom_id
                  where e.id = rc.entity_id and e.newsroom_id = rc.newsroom_id)
              when 'required_document' then (
                 select sv.name from required_documents d
                   join services sv on sv.id = d.service_id and sv.newsroom_id = d.newsroom_id
                  where d.id = rc.entity_id and d.newsroom_id = rc.newsroom_id)
              when 'language' then (
                 select sv.name from languages lg
                   join services sv on sv.id = lg.service_id and sv.newsroom_id = lg.newsroom_id
                  where lg.id = rc.entity_id and lg.newsroom_id = rc.newsroom_id)
            end as entity_name,
            rc.entity_name as stored_entity_name,
            rc.field_name, rc.before_value, rc.after_value, rc.change_kind, rc.summary,
            rc.evidence_tier, rc.created_at, rc.scan_run_id,
            src.title as source_title, src.url as source_url,
            snap.created_at as capture_date
       from resource_changes rc
       left join sources src
         on src.id = rc.source_id and src.newsroom_id = rc.newsroom_id
       left join snapshots snap on snap.id = rc.evidence_capture_id
      where rc.newsroom_id = $1
      order by rc.created_at desc, rc.id desc
      limit 500`,
    [newsroomId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    reviewState: row.review_state,
    entityType: row.entity_type,
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    // An unresolved proposal has no entity row to read a name from, so the
    // model's own name for the entity is the fallback the desk shows.
    entityName: row.entity_name ?? row.stored_entity_name ?? null,
    fieldName: row.field_name,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    changeKind: row.change_kind,
    summary: row.summary,
    evidenceTier: row.evidence_tier,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    captureDate: row.capture_date,
    scanRunId: row.scan_run_id == null ? null : Number(row.scan_run_id),
    createdAt: row.created_at,
  }));
}

/** One jsonb value that may arrive as an object, a string, or null. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asArrayLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Every HSDS import in this newsroom, newest first. */
export async function listRegistryImports(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistryImport[]> {
  const rows = await sql.query<{
    id: number;
    directory_name: string;
    format: string;
    source_url: string | null;
    imported_at: WhenValue;
    record_counts: unknown;
    conflicts: unknown;
    report: string | null;
  }>(
    `select id, directory_name, format, source_url, imported_at,
            record_counts, conflicts, report
       from resource_imports
      where newsroom_id = $1
      order by imported_at desc, id desc
      limit 50`,
    [newsroomId],
  );

  return rows.map((row) => {
    const counts = asRecord(row.record_counts);
    const recordCount = Object.values(counts).reduce<number>((total, value) => {
      const n = Number(value);
      return total + (Number.isFinite(n) ? n : 0);
    }, 0);
    return {
      id: Number(row.id),
      directoryName: row.directory_name,
      format: row.format,
      sourceUrl: row.source_url,
      importedAt: row.imported_at,
      recordCount,
      conflictCount: asArrayLength(row.conflicts),
      report: row.report,
    };
  });
}

/** Every source bound to a registry role, with its last fetch and last error. */
export async function listRegistrySourcesWithHealth(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistrySource[]> {
  const rows = await sql.query<{
    id: number;
    registry_role: string;
    directory_name: string | null;
    title: string;
    url: string;
    last_fetched_at: WhenValue;
    last_error: string | null;
  }>(
    `select r.id, r.registry_role, r.directory_name,
            s.title, s.url, s.last_fetched_at, s.last_error
       from resource_sources r
       join sources s on s.id = r.source_id and s.newsroom_id = r.newsroom_id
      where r.newsroom_id = $1
      order by s.title, r.registry_role`,
    [newsroomId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    registryRole: row.registry_role,
    directoryName: row.directory_name,
    title: row.title,
    url: row.url,
    lastFetchedAt: row.last_fetched_at,
    lastError: row.last_error,
  }));
}

/** One service an editor has loaded but not yet published. */
export interface DeskRegistryWaitingEntry {
  serviceId: number;
  /** The HSDS id the entry was imported under; matches the starter list. */
  serviceHsdsId: string;
  organizationName: string;
  serviceName: string;
  categoryName: string | null;
  phone: string | null;
  description: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
}

/**
 * One published service on the desk. The same shape as a waiting entry, so the
 * editor's form can be filled from either list without a second reader.
 */
export type DeskRegistryPublishedEntry = DeskRegistryWaitingEntry;

/**
 * The columns both desk entry lists read. `published` decides which list a row
 * lands in; everything else is what the editor's form is filled from.
 */
const ENTRY_COLUMNS = `s.id as service_id, s.hsds_id as service_hsds_id, s.name as service_name,
            s.description as service_description,
            o.name as organization_name,
            t.name as category_name,
            (select c.phone from contacts c
              where c.newsroom_id = s.newsroom_id and c.service_id = s.id
                and c.phone is not null and c.phone <> ''
              order by c.id limit 1) as phone,
            src.title as source_title, src.url as source_url`;

interface EntryRow {
  service_id: number;
  service_hsds_id: string;
  service_name: string;
  service_description: string | null;
  organization_name: string;
  category_name: string | null;
  phone: string | null;
  source_title: string | null;
  source_url: string | null;
}

function toEntry(row: EntryRow): DeskRegistryWaitingEntry {
  return {
    serviceId: Number(row.service_id),
    serviceHsdsId: row.service_hsds_id,
    organizationName: row.organization_name,
    serviceName: row.service_name,
    categoryName: row.category_name,
    phone: row.phone,
    description: row.service_description,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
  };
}

/**
 * Every unpublished service in this newsroom, any directory, newest import
 * first. This is the desk's "waiting to be published" list; publishing one
 * takes it off this list and onto the public page.
 */
export async function listUnpublishedRegistryEntries(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistryWaitingEntry[]> {
  const rows = await sql.query<EntryRow>(
    `select ${ENTRY_COLUMNS}
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       left join taxonomies t
         on t.id = s.taxonomy_id and t.newsroom_id = s.newsroom_id
       left join sources src
         on src.id = coalesce(s.source_id, o.source_id) and src.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.published = false
      order by s.created_at desc, s.id desc
      limit 200`,
    [newsroomId],
  );

  return rows.map(toEntry);
}

/**
 * Every published service in this newsroom, newest first, with the values the
 * editor's Edit form starts from. Listing them rather than only counting them
 * is what lets the editor fix one without taking it down first.
 */
export async function listPublishedRegistryEntries(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistryPublishedEntry[]> {
  const rows = await sql.query<EntryRow>(
    `select ${ENTRY_COLUMNS}
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       left join taxonomies t
         on t.id = s.taxonomy_id and t.newsroom_id = s.newsroom_id
       left join sources src
         on src.id = coalesce(s.source_id, o.source_id) and src.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.published = true
      order by s.updated_at desc, s.id desc
      limit 200`,
    [newsroomId],
  );

  return rows.map(toEntry);
}

/**
 * Every category name this newsroom already uses, for the form's datalist.
 *
 * The editor types a category; the list is an offer, not a rule. A name on it
 * is reused, and a name that is not on it creates a category.
 */
export async function listRegistryCategoryNames(
  sql: Sql,
  newsroomId: number,
): Promise<string[]> {
  const rows = await sql.query<{ name: string }>(
    `select distinct name from taxonomies
      where newsroom_id = $1
      order by name`,
    [newsroomId],
  );
  return rows.map((row) => row.name);
}

/** How many registry services in this newsroom are published. */
export async function countPublishedRegistryServices(
  sql: Sql,
  newsroomId: number,
): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    "select count(*)::text as count from services where newsroom_id = $1 and published = true",
    [newsroomId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Whether the starter list has been loaded into this newsroom. Any row from
 * its directory is proof; the load is all-or-nothing inside one transaction.
 */
export async function starterListIsLoaded(sql: Sql, newsroomId: number): Promise<boolean> {
  const rows = await sql.query<{ count: string }>(
    `select count(*)::text as count
       from services
      where newsroom_id = $1 and directory_name = $2`,
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

export interface RegistryDeskView {
  changes: DeskRegistryChange[];
  imports: DeskRegistryImport[];
  sources: DeskRegistrySource[];
  waiting: DeskRegistryWaitingEntry[];
  published: DeskRegistryPublishedEntry[];
  /** The newsroom's category names, for the edit and add forms' datalist. */
  categories: string[];
  publishedCount: number;
  starterLoaded: boolean;
}
