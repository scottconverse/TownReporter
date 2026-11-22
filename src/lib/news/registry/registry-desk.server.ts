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
import { asText, REMOVABLE_TABLES } from "./hsds-import.server.ts";
import { editorLabel, editorLabels } from "./registry-editor-names.server.ts";
import { applyTargetFor } from "./registry-review.server.ts";
import {
  getRegistryEntryDetail,
  type RegistryEntryDetail,
} from "./registry-entry-editor.server.ts";
import { DESK_DIRECTORY } from "./registry-entry-fields.ts";
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
  /**
   * The sentence, copied from the source page, that states the change (Scott,
   * Nov 20 2026). Null when the scan stored none; the desk says so.
   */
  quote: string | null;
  evidenceTier: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  captureDate: WhenValue;
  /**
   * The published entry this proposal belongs to, when it can be named. A new
   * entry proposal has none yet; a child row is followed to its service.
   */
  serviceId: number | null;
  servicePublished: boolean;
  scanRunId: number | null;
  createdAt: WhenValue;
  /**
   * Who accepted or rejected it, by name: the account's name, else its email,
   * else "an editor" when no account matches. Null while it waits.
   */
  reviewedBy: string | null;
  reviewedAt: WhenValue;
  reviewNote: string | null;
  /** When the value was applied to the entry; null if it was not. */
  appliedAt: WhenValue;
  /**
   * The value the target field holds now, as text, so the desk can show a
   * stale proposal before the editor acts. Null when the proposal does not
   * point at one live applicable field (see `targetLive`) or the field is empty.
   */
  currentValue: string | null;
  /** True when the proposal points at one live row and an applicable field. */
  targetLive: boolean;
}

/** Row outcomes of one import, summed over every table. */
export interface ImportOutcomes {
  inserted: number;
  unchanged: number;
  changed: number;
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
  /** Null for an import that stored no per-table breakdown; no totals are invented. */
  outcomes: ImportOutcomes | null;
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
    evidence_quote: string | null;
    service_id: number | null;
    evidence_tier: string;
    source_title: string | null;
    source_url: string | null;
    capture_date: WhenValue;
    scan_run_id: number | null;
    created_at: WhenValue;
    reviewed_by: string | null;
    reviewed_at: WhenValue;
    review_note: string | null;
    applied_at: WhenValue;
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
            rc.evidence_quote,
            case rc.entity_type
              when 'service' then rc.entity_id
              when 'service_at_location' then (select sal.service_id from service_at_locations sal
                 where sal.id = rc.entity_id and sal.newsroom_id = rc.newsroom_id)
              when 'schedule' then (select sc.service_id from schedules sc
                 where sc.id = rc.entity_id and sc.newsroom_id = rc.newsroom_id)
              when 'contact' then (select ct.service_id from contacts ct
                 where ct.id = rc.entity_id and ct.newsroom_id = rc.newsroom_id)
              when 'eligibility' then (select el.service_id from eligibilities el
                 where el.id = rc.entity_id and el.newsroom_id = rc.newsroom_id)
              when 'required_document' then (select rd.service_id from required_documents rd
                 where rd.id = rc.entity_id and rd.newsroom_id = rc.newsroom_id)
              when 'language' then (select lg.service_id from languages lg
                 where lg.id = rc.entity_id and lg.newsroom_id = rc.newsroom_id)
              when 'accessibility' then (
                 coalesce(
                   (select a.service_id from accessibilities a
                     where a.id = rc.entity_id and a.newsroom_id = rc.newsroom_id),
                   (select min(sx.id) from accessibilities a
                      join service_at_locations x
                        on x.newsroom_id = a.newsroom_id and x.location_id = a.location_id
                       and x.removed_at is null
                      join services sx on sx.id = x.service_id and sx.newsroom_id = x.newsroom_id
                     where a.id = rc.entity_id and a.newsroom_id = rc.newsroom_id)))
              when 'location' then (
                 select min(x.service_id) from service_at_locations x
                  where x.newsroom_id = rc.newsroom_id and x.location_id = rc.entity_id
                    and x.removed_at is null)
              when 'organization' then (
                 select min(sx.id) from services sx
                  where sx.newsroom_id = rc.newsroom_id and sx.organization_id = rc.entity_id)
            end as service_id,
            rc.evidence_tier, rc.created_at, rc.scan_run_id,
            src.title as source_title, src.url as source_url,
            snap.created_at as capture_date,
            rc.reviewed_by, rc.reviewed_at, rc.review_note, rc.applied_at
       from resource_changes rc
       left join sources src
         on src.id = rc.source_id and src.newsroom_id = rc.newsroom_id
       left join snapshots snap on snap.id = rc.evidence_capture_id
      where rc.newsroom_id = $1
      order by rc.created_at desc, rc.id desc
      limit 500`,
    [newsroomId],
  );

  const reviewers = await editorLabels(sql, rows.map((row) => row.reviewed_by));

  // The current value of each proposal's target field, one query per
  // table and column. Table and column come from the importer's fixed maps.
  const groups = new Map<string, { table: string; column: string; ids: Set<number> }>();
  for (const row of rows) {
    if (row.entity_id == null) continue;
    const target = applyTargetFor(row.entity_type, row.field_name);
    if (!target) continue;
    const key = `${target.table}.${target.column}`;
    const group = groups.get(key) ?? { table: target.table, column: target.column, ids: new Set<number>() };
    group.ids.add(Number(row.entity_id));
    groups.set(key, group);
  }
  const current = new Map<string, string | null>();
  for (const { table, column, ids } of groups.values()) {
    const removable = REMOVABLE_TABLES.has(table as Parameters<typeof REMOVABLE_TABLES.has>[0]);
    const live = await sql.query<Record<string, unknown>>(
      `select id, ${column} as current_value${removable ? ", removed_at" : ""}
         from ${table} where newsroom_id = $1 and id = any($2::int[])`,
      [newsroomId, [...ids]],
    );
    for (const found of live) {
      if (removable && found.removed_at !== null && found.removed_at !== undefined) continue;
      current.set(`${table}.${column}.${Number(found.id)}`, asText(found.current_value));
    }
  }

  // Whether the service a proposal belongs to is on the public page, so the
  // card can link to it only when the link would open something.
  const serviceIds = [...new Set(rows.map((row) => row.service_id).filter((id): id is number => id != null))];
  const publishedServices = new Set<number>();
  if (serviceIds.length > 0) {
    const live = await sql.query<{ id: number }>(
      `select id from services
        where newsroom_id = $1 and published = true and id = any($2::int[])`,
      [newsroomId, serviceIds],
    );
    for (const found of live) publishedServices.add(Number(found.id));
  }

  return rows.map((row) => {
    const target = row.entity_id == null ? null : applyTargetFor(row.entity_type, row.field_name);
    const key = target && row.entity_id != null ? `${target.table}.${target.column}.${Number(row.entity_id)}` : null;
    const targetLive = key !== null && current.has(key);
    return {
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
    quote: row.evidence_quote,
    serviceId: row.service_id == null ? null : Number(row.service_id),
    servicePublished: row.service_id != null && publishedServices.has(Number(row.service_id)),
    evidenceTier: row.evidence_tier,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    captureDate: row.capture_date,
    scanRunId: row.scan_run_id == null ? null : Number(row.scan_run_id),
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by == null ? null : editorLabel(reviewers, row.reviewed_by),
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    appliedAt: row.applied_at,
    currentValue: targetLive && key !== null ? (current.get(key) ?? null) : null,
    targetLive,
    };
  });
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

/**
 * The per-table breakdown an import stored under `record_counts.byTable`,
 * summed over the tables. Null when none was stored.
 */
function outcomesOf(byTable: unknown): ImportOutcomes | null {
  const tables = asRecord(byTable);
  if (Object.keys(tables).length === 0) return null;
  const totals: ImportOutcomes = { inserted: 0, unchanged: 0, changed: 0 };
  for (const counts of Object.values(tables)) {
    const table = asRecord(counts);
    for (const key of ["inserted", "unchanged", "changed"] as const) {
      const n = Number(table[key]);
      if (Number.isFinite(n)) totals[key] += n;
    }
  }
  return totals;
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
    // `byTable` is the breakdown, not a table count: it is kept out of the sum.
    const { byTable, ...counts } = asRecord(row.record_counts);
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
      outcomes: outcomesOf(byTable),
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

/**
 * Everything the desk knows about one entry, in the words a person reads
 * (Scott, Nov 20 2026). Every field is here, so a card can show the entry
 * instead of its name; a field the source did not state is null or empty and
 * the card says "Not listed on the source page." rather than leaving a blank.
 */
export interface DeskEntryFacts {
  serviceId: number;
  /** The HSDS id the entry was imported under; matches the starter list. */
  serviceHsdsId: string;
  organizationName: string;
  serviceName: string;
  categoryName: string | null;
  /** The first phone, kept for the editor's one-line form. */
  phone: string | null;
  /** Every phone the entry has, in the order they were stored. */
  phones: string[];
  description: string | null;
  /** One readable line per place: "12 Main St, Boulder, CO 80302". */
  address: string | null;
  /** One readable line per set of hours. */
  hours: string[];
  /** The entry's own web address, else the organization's, else a contact's. */
  website: string | null;
  /** The eligibility rules, joined into one line. */
  eligibility: string | null;
  fees: string | null;
  applicationProcess: string | null;
  languages: string[];
  crisis: boolean;
  sourceTitle: string | null;
  sourceUrl: string | null;
  /** When the capture this entry rests on was taken. */
  sourceCapturedAt: WhenValue;
  robotCheckedAt: WhenValue;
  robotCheckResult: string | null;
  published: boolean;
  createdAt: WhenValue;
  updatedAt: WhenValue;
}

/** One service an editor has loaded but not yet published. */
export type DeskRegistryWaitingEntry = DeskEntryFacts;

/**
 * One published service on the desk. The same shape as a waiting entry, so the
 * editor's form can be filled from either list without a second reader.
 */
export type DeskRegistryPublishedEntry = DeskEntryFacts;

/**
 * The columns both desk entry lists read. `published` decides which list a row
 * lands in; everything else is what the card shows and the editor's form is
 * filled from.
 *
 * The child rows (phones, hours, eligibility, languages) are gathered with
 * `jsonb_agg` in one statement rather than one query per entry: the desk draws
 * up to 200 entries a list, and a query per field per entry would be 800
 * round trips to draw one screen. `loc` picks the entry's first linked place.
 */
const ENTRY_COLUMNS = `s.id as service_id, s.hsds_id as service_hsds_id, s.name as service_name,
            s.description as service_description, s.url as service_url, s.fees as service_fees,
            s.application_process as service_application_process, s.crisis as service_crisis,
            s.published as service_published, s.created_at as service_created_at,
            s.updated_at as service_updated_at, s.robot_checked_at, s.robot_check_result,
            o.name as organization_name, o.website as organization_website,
            t.name as category_name,
            src.title as source_title, src.url as source_url,
            cap.created_at as source_captured_at,
            loc.address_1, loc.address_2, loc.city, loc.state_province, loc.postal_code,
            (select coalesce(jsonb_agg(c.phone order by c.id), '[]'::jsonb)
               from contacts c
              where c.newsroom_id = s.newsroom_id and c.removed_at is null
                and c.phone is not null and trim(c.phone) <> ''
                and (c.service_id = s.id
                     or (c.organization_id = o.id and c.service_id is null and c.location_id is null)
                     or exists (select 1 from service_at_locations x
                                 where x.newsroom_id = c.newsroom_id and x.service_id = s.id
                                   and x.location_id = c.location_id and x.removed_at is null))) as phones,
            (select coalesce(jsonb_agg(c.website order by c.id), '[]'::jsonb)
               from contacts c
              where c.newsroom_id = s.newsroom_id and c.removed_at is null
                and c.website is not null and trim(c.website) <> ''
                and (c.service_id = s.id or c.organization_id = o.id)) as contact_websites,
            (select coalesce(jsonb_agg(jsonb_build_object(
                       'days', sc.days, 'opensAt', sc.opens_at, 'closesAt', sc.closes_at,
                       'byAppointment', sc.by_appointment, 'notes', sc.notes) order by sc.id), '[]'::jsonb)
               from schedules sc
              where sc.newsroom_id = s.newsroom_id and sc.removed_at is null
                and (sc.service_id = s.id
                     or exists (select 1 from service_at_locations x
                                 where x.newsroom_id = sc.newsroom_id and x.service_id = s.id
                                   and x.removed_at is null
                                   and (x.schedule_id = sc.id
                                        or (sc.service_id is null and x.location_id = sc.location_id))))) as hour_rows,
            (select string_agg(e.description, ' · ' order by e.id)
               from eligibilities e
              where e.newsroom_id = s.newsroom_id and e.service_id = s.id and e.removed_at is null
                and e.description is not null and trim(e.description) <> '') as eligibility_text,
            (select coalesce(jsonb_agg(lg.language order by lg.id), '[]'::jsonb)
               from languages lg
              where lg.newsroom_id = s.newsroom_id and lg.service_id = s.id
                and lg.removed_at is null) as languages`;

/** The joins `ENTRY_COLUMNS` needs, from a services row aliased `s`. */
const ENTRY_JOINS = `join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       left join taxonomies t
         on t.id = s.taxonomy_id and t.newsroom_id = s.newsroom_id
       left join sources src
         on src.id = coalesce(s.source_id, o.source_id) and src.newsroom_id = s.newsroom_id
       left join snapshots cap
         on cap.id = coalesce(s.source_capture_id, o.source_capture_id)
       left join lateral (
         select l.address_1, l.address_2, l.city, l.state_province, l.postal_code
           from service_at_locations sal
           join locations l on l.id = sal.location_id and l.newsroom_id = sal.newsroom_id
          where sal.newsroom_id = s.newsroom_id and sal.service_id = s.id
            and sal.removed_at is null
          order by sal.id limit 1
       ) loc on true`;

interface EntryRow {
  service_id: number;
  service_hsds_id: string;
  service_name: string;
  service_description: string | null;
  service_url: string | null;
  service_fees: string | null;
  service_application_process: string | null;
  service_crisis: boolean;
  service_published: boolean;
  service_created_at: WhenValue;
  service_updated_at: WhenValue;
  robot_checked_at: WhenValue;
  robot_check_result: string | null;
  organization_name: string;
  organization_website: string | null;
  category_name: string | null;
  source_title: string | null;
  source_url: string | null;
  source_captured_at: WhenValue;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  phones: unknown;
  contact_websites: unknown;
  hour_rows: unknown;
  eligibility_text: string | null;
  languages: unknown;
}

/** A jsonb array from the driver: parsed already, or a string that parses. */
function asJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asStringArray(value: unknown): string[] {
  return asJsonArray(value)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item !== "");
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** One readable line per set of hours, from the stored columns. */
function hoursLine(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const hours = row as Record<string, unknown>;
  const text = (key: string) =>
    typeof hours[key] === "string" ? (hours[key] as string).trim() : "";
  if (hours.byAppointment === true) {
    return [text("days"), "By appointment", text("notes")].filter(Boolean).join(" · ");
  }
  const times = [text("opensAt"), text("closesAt")].filter(Boolean).join(" to ");
  const main = [text("days"), times].filter(Boolean).join(": ");
  return text("notes") ? [main, `(${text("notes")})`].filter(Boolean).join(" ") : main;
}

/** One address line from the entry's first place. */
function addressLine(row: EntryRow): string | null {
  const street = [textOrNull(row.address_1), textOrNull(row.address_2)].filter(Boolean).join(", ");
  // "Longmont, CO 80501": the state and ZIP read as one part of the line.
  const stateAndZip = [textOrNull(row.state_province), textOrNull(row.postal_code)]
    .filter(Boolean)
    .join(" ");
  const place = [textOrNull(row.city), stateAndZip].filter(Boolean).join(", ");
  const line = [street, place].filter(Boolean).join(", ");
  return line || null;
}

/** The first web address the entry has: its own, then the organization's, then a contact's. */
function websiteOf(row: EntryRow): string | null {
  return (
    textOrNull(row.service_url) ??
    textOrNull(row.organization_website) ??
    asStringArray(row.contact_websites)[0] ??
    null
  );
}

function toEntry(row: EntryRow): DeskEntryFacts {
  const phones = [...new Set(asStringArray(row.phones))];
  return {
    serviceId: Number(row.service_id),
    serviceHsdsId: row.service_hsds_id,
    organizationName: row.organization_name,
    serviceName: row.service_name,
    categoryName: row.category_name,
    phone: phones[0] ?? null,
    phones,
    description: row.service_description,
    address: addressLine(row),
    hours: asJsonArray(row.hour_rows).map(hoursLine).filter(Boolean),
    website: websiteOf(row),
    eligibility: row.eligibility_text,
    fees: row.service_fees,
    applicationProcess: row.service_application_process,
    languages: asStringArray(row.languages),
    crisis: Boolean(row.service_crisis),
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourceCapturedAt: row.source_captured_at,
    robotCheckedAt: row.robot_checked_at,
    robotCheckResult: row.robot_check_result,
    published: Boolean(row.service_published),
    createdAt: row.service_created_at,
    updatedAt: row.service_updated_at,
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
       ${ENTRY_JOINS}
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
       ${ENTRY_JOINS}
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

/**
 * The directory names earlier imports used in this newsroom, for the import
 * panel's name box. The desk's own list and the starter list are not imports
 * the editor made, so both are left out.
 */
export async function listRegistryDirectoryNames(
  sql: Sql,
  newsroomId: number,
): Promise<string[]> {
  const rows = await sql.query<{ directory_name: string }>(
    `select distinct directory_name from resource_imports
      where newsroom_id = $1 and directory_name <> $2 and directory_name <> $3
      order by directory_name`,
    [newsroomId, DESK_DIRECTORY, STARTER_LIST_DIRECTORY],
  );
  return rows.map((row) => row.directory_name);
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

/** One entry the scan published by itself (Scott, Nov 20 2026, part 6). */
export interface DeskAutoPublishedEntry extends DeskEntryFacts {
  /** The newest audit row's id; the stable key for the list. */
  auditId: number;
  /** A crisis entry is listed first when any of its audit rows is a `[Crisis]` row. */
  crisis: boolean;
  publishedAt: WhenValue;
}

/**
 * Entries the scan applied and published by itself, newest first, crisis first.
 *
 * The source of truth is the audit log the scan wrote (`registry.service
 * .autopublish`), not a separate table: the log is what the desk already shows
 * for every other registry action, and it survives an editor taking the entry
 * down. The join to `services` names the entry and shows whether it is still
 * published, which is what the Unpublish button acts on. A row whose service
 * was deleted is left out rather than shown as a dead button.
 *
 * One card per service (Nov 22 2026). A rechecked entry writes a second
 * autopublish row, and listing audit rows drew it twice and counted it twice.
 * The rows are folded per service: the card takes the newest publish time and
 * the newest audit id, and the entry is a crisis entry when any of its rows is
 * a crisis row. The 100 limit is entries, not audit rows.
 */
export async function listAutoPublishedRegistryEntries(
  sql: Sql,
  newsroomId: number,
): Promise<DeskAutoPublishedEntry[]> {
  const rows = await sql.query<EntryRow & { audit_id: number; crisis: boolean; published_at: WhenValue }>(
    `select latest.audit_id, latest.crisis, latest.published_at,
            ${ENTRY_COLUMNS}
       from (
              select distinct on (ae.subject_id)
                     ae.subject_id,
                     ae.id as audit_id,
                     bool_or(ae.detail like '[Crisis]%')
                       over (partition by ae.subject_id) as crisis,
                     max(ae.created_at)
                       over (partition by ae.subject_id) as published_at
                from audit_events ae
               where ae.newsroom_id = $1
                 and ae.action = 'registry.service.autopublish'
                 and ae.subject_kind = 'registry-service'
               order by ae.subject_id, ae.created_at desc, ae.id desc
            ) latest
       join services s
         on s.id = latest.subject_id and s.newsroom_id = $1
       ${ENTRY_JOINS}
      order by latest.crisis desc, latest.published_at desc, latest.audit_id desc
      limit 100`,
    [newsroomId],
  );
  return rows.map((row) => ({
    ...toEntry(row),
    auditId: Number(row.audit_id),
    crisis: Boolean(row.crisis),
    publishedAt: row.published_at,
  }));
}

/** One entry on the desk's freshness panel and its lists. */
export interface DeskFreshnessEntry {
  serviceId: number;
  organizationName: string;
  serviceName: string;
  /** The last robot recheck; null when it has never been rechecked. */
  robotCheckedAt: WhenValue;
  /** 'same', 'changed' or 'source_gone'; null before the first settled check. */
  robotCheckResult: string | null;
  /** When the entry was first loaded into the registry (for the oldest one). */
  createdAt: WhenValue;
}

/**
 * The desk's "Freshness" panel at the top of the page (Scott, Nov 20 2026).
 *
 * Five numbers about the robot's own rechecks and the lists behind four of
 * them, so every number can jump to the entries it counts. The fifth (the
 * oldest unchecked entry) links to the entry itself. This is the robot's
 * record only: an editor's verification is the "Needs checking" list and is
 * never counted here as a recheck.
 */
export interface DeskRegistryFreshness {
  published: number;
  recheckedLast30Days: number;
  changed: number;
  sourceGone: number;
  oldestUnchecked: DeskFreshnessEntry | null;
  rechecked: DeskFreshnessEntry[];
  changedEntries: DeskFreshnessEntry[];
  sourceGoneEntries: DeskFreshnessEntry[];
}

const FRESHNESS_COLUMNS = `s.id as service_id, o.name as organization_name,
            s.name as service_name, s.robot_checked_at, s.robot_check_result,
            s.created_at`;

function toFreshnessEntry(row: {
  service_id: number;
  organization_name: string;
  service_name: string;
  robot_checked_at: WhenValue;
  robot_check_result: string | null;
  created_at: WhenValue;
}): DeskFreshnessEntry {
  return {
    serviceId: Number(row.service_id),
    organizationName: row.organization_name,
    serviceName: row.service_name,
    robotCheckedAt: row.robot_checked_at,
    robotCheckResult: row.robot_check_result,
    createdAt: row.created_at,
  };
}

export async function readRegistryFreshness(
  sql: Sql,
  newsroomId: number,
): Promise<DeskRegistryFreshness> {
  const counts = await sql.query<{
    published: string;
    rechecked_last_30: string;
    changed: string;
    source_gone: string;
  }>(
    `select
       count(*) filter (where s.published = true)::text as published,
       count(*) filter (where s.published = true
                          and s.robot_checked_at >= now() - interval '30 days')::text as rechecked_last_30,
       count(*) filter (where s.robot_check_result = 'changed')::text as changed,
       count(*) filter (where s.robot_check_result = 'source_gone')::text as source_gone
     from services s
    where s.newsroom_id = $1`,
    [newsroomId],
  );
  const row = counts[0];

  const rechecked = await sql.query<Parameters<typeof toFreshnessEntry>[0]>(
    `select ${FRESHNESS_COLUMNS}
       from services s
       join organizations o on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.published = true
        and s.robot_checked_at >= now() - interval '30 days'
      order by s.robot_checked_at desc, s.id desc
      limit 100`,
    [newsroomId],
  );
  const changed = await sql.query<Parameters<typeof toFreshnessEntry>[0]>(
    `select ${FRESHNESS_COLUMNS}
       from services s
       join organizations o on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.robot_check_result = 'changed'
      order by s.robot_checked_at desc nulls last, s.id desc
      limit 100`,
    [newsroomId],
  );
  const sourceGone = await sql.query<Parameters<typeof toFreshnessEntry>[0]>(
    `select ${FRESHNESS_COLUMNS}
       from services s
       join organizations o on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.robot_check_result = 'source_gone'
      order by s.robot_checked_at desc nulls last, s.id desc
      limit 100`,
    [newsroomId],
  );
  const oldest = await sql.query<Parameters<typeof toFreshnessEntry>[0]>(
    `select ${FRESHNESS_COLUMNS}
       from services s
       join organizations o on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.published = true and s.robot_checked_at is null
      order by s.created_at asc, s.id asc
      limit 1`,
    [newsroomId],
  );

  return {
    published: Number(row?.published ?? 0),
    recheckedLast30Days: Number(row?.rechecked_last_30 ?? 0),
    changed: Number(row?.changed ?? 0),
    sourceGone: Number(row?.source_gone ?? 0),
    oldestUnchecked: oldest[0] ? toFreshnessEntry(oldest[0]) : null,
    rechecked: rechecked.map(toFreshnessEntry),
    changedEntries: changed.map(toFreshnessEntry),
    sourceGoneEntries: sourceGone.map(toFreshnessEntry),
  };
}

/* ---- One entry, one page (Scott, Nov 20 2026) ---- */

/** One line of an entry's history, in the desk's own words. */
export interface DeskEntryHistoryRow {
  id: number;
  /** `audit` rows are actions; `change` rows are what the scan proposed. */
  source: "audit" | "change";
  action: string;
  detail: string;
  at: WhenValue;
  by: string | null;
}

/** One page an entry came from, and what the registry uses it for. */
export interface DeskEntrySourceRow {
  id: number;
  title: string;
  url: string;
  registryRole: string | null;
  capturedAt: WhenValue;
  lastFetchedAt: WhenValue;
  lastError: string | null;
}

export interface DeskEntryPanelView {
  entry: DeskEntryFacts;
  /** The same detail the editor loads: every place, hours, contact and rule. */
  detail: RegistryEntryDetail;
  history: DeskEntryHistoryRow[];
  sources: DeskEntrySourceRow[];
}

/**
 * Everything one entry's own desk page shows: every field, its history and its
 * sources. Read-only; the editor's save paths are unchanged. Null when the
 * service is not in this newsroom.
 */
export async function readDeskEntryPanel(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
): Promise<DeskEntryPanelView | null> {
  const rows = await sql.query<EntryRow>(
    `select ${ENTRY_COLUMNS}
       from services s
       ${ENTRY_JOINS}
      where s.newsroom_id = $1 and s.id = $2`,
    [newsroomId, serviceId],
  );
  if (!rows[0]) return null;
  const entry = toEntry(rows[0]);

  const detail = await getRegistryEntryDetail(sql, newsroomId, serviceId);
  if (!detail) return null;

  const audits = await sql.query<{
    id: number;
    action: string;
    detail: string;
    created_at: WhenValue;
    user_id: string | null;
  }>(
    `select id, action, detail, created_at, user_id
       from audit_events
      where newsroom_id = $1 and subject_kind = 'registry-service' and subject_id = $2
      order by created_at desc, id desc
      limit 100`,
    [newsroomId, serviceId],
  );
  const changes = await sql.query<{
    id: number;
    review_state: string;
    field_name: string;
    before_value: string | null;
    after_value: string | null;
    change_kind: string;
    created_at: WhenValue;
  }>(
    `select id, review_state, field_name, before_value, after_value, change_kind, created_at
       from resource_changes
      where newsroom_id = $1 and entity_type = 'service' and entity_id = $2
      order by created_at desc, id desc
      limit 100`,
    [newsroomId, serviceId],
  );

  const names = await editorLabels(sql, [
    ...audits.map((row) => row.user_id),
    ...changes.map(() => null),
  ]);

  const history: DeskEntryHistoryRow[] = [
    ...audits.map((row) => ({
      id: Number(row.id),
      source: "audit" as const,
      action: row.action,
      detail: row.detail,
      at: row.created_at,
      by: row.user_id == null ? null : editorLabel(names, row.user_id),
    })),
    ...changes.map((row) => ({
      id: Number(row.id),
      source: "change" as const,
      action: row.review_state,
      detail: `${row.field_name}: ${row.before_value ?? "nothing recorded"} → ${
        row.after_value ?? "nothing recorded"
      } (${row.change_kind})`,
      at: row.created_at,
      by: null,
    })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  const sources = await sql.query<{
    id: number;
    title: string;
    url: string;
    registry_role: string | null;
    captured_at: WhenValue;
    last_fetched_at: WhenValue;
    last_error: string | null;
  }>(
    `select s.id, s.title, s.url, rs.registry_role,
            cap.created_at as captured_at, s.last_fetched_at, s.last_error
       from services sv
       join organizations o
         on o.id = sv.organization_id and o.newsroom_id = sv.newsroom_id
       join sources s
         on s.id = coalesce(sv.source_id, o.source_id) and s.newsroom_id = sv.newsroom_id
       left join resource_sources rs
         on rs.source_id = s.id and rs.newsroom_id = s.newsroom_id
       left join snapshots cap
         on cap.id = coalesce(sv.source_capture_id, o.source_capture_id)
      where sv.newsroom_id = $1 and sv.id = $2
      order by rs.registry_role nulls last`,
    [newsroomId, serviceId],
  );

  return {
    entry,
    detail,
    history,
    sources: sources.map((row) => ({
      id: Number(row.id),
      title: row.title,
      url: row.url,
      registryRole: row.registry_role,
      capturedAt: row.captured_at,
      lastFetchedAt: row.last_fetched_at,
      lastError: row.last_error,
    })),
  };
}

export interface RegistryDeskView {
  changes: DeskRegistryChange[];
  imports: DeskRegistryImport[];
  sources: DeskRegistrySource[];
  waiting: DeskRegistryWaitingEntry[];
  published: DeskRegistryPublishedEntry[];
  /** Entries the scan published by itself, newest first, crisis first. */
  autoPublished: DeskAutoPublishedEntry[];
  /** The newsroom's category names, for the edit and add forms' datalist. */
  categories: string[];
  /** Directory names earlier imports used, for the import panel's name box. */
  directoryNames: string[];
  publishedCount: number;
  starterLoaded: boolean;
  /** The robot recheck panel at the top of the desk page. */
  freshness: DeskRegistryFreshness;
}
