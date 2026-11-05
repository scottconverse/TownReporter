/**
 * Import an HSDS 3.0 bundle into the resource registry (spec sections 15.1
 * and 15.3).
 *
 * What this does:
 *  - writes the whole bundle in one transaction; a failed import writes nothing;
 *  - stores the imported file as a `snapshots` row first, because every
 *    `resource_changes` row needs a `evidence_capture_id` (13.3);
 *  - writes every row unpublished, unverified, verification_method
 *    'imported', with the `resource_imports.id` as provenance;
 *  - is idempotent: a second import of the same directory matches on
 *    (newsroom_id, directory_name, hsds_id) and updates nothing that is equal;
 *  - never overwrites silently: a changed field becomes one pending
 *    `resource_changes` row and the old value stays.
 *
 * There is no public export here. `readRegistryBundle` exists for the
 * compatibility test and for any future internal caller (section 15.2's public
 * endpoint is Phase 2 and is not built in this slice).
 */

import { createHash } from "node:crypto";
import type { Sql } from "../../db.ts";
import type { HsdsBundle } from "./hsds-types.ts";
import {
  bundleToRows,
  rowsToBundle,
  REGISTRY_TABLE_NAMES,
  type RegistryRows,
  type RegistryTableName,
} from "./hsds-map.ts";

export interface ImportOptions {
  newsroomId: number;
  /** The directory's own name; part of the idempotency key. */
  directoryName: string;
  /** Where the bundle came from, for provenance. */
  sourceUrl?: string | null;
  /** Existing `sources.id` to record; one is created when absent. */
  sourceId?: number | null;
  /** `sources.user_id` for the source row this importer creates. */
  userId?: string;
}

export interface ImportConflict {
  entity_type: string;
  entity_id: number;
  hsds_id: string;
  field_name: string;
  before_value: string | null;
  after_value: string | null;
}

export interface ImportResult {
  importId: number;
  snapshotId: number;
  sourceId: number;
  recordCounts: Record<RegistryTableName, number>;
  conflicts: ImportConflict[];
}

/** Every table the importer writes, in dependency order. */
const TABLE_ORDER: RegistryTableName[] = [
  "taxonomies",
  "organizations",
  "services",
  "locations",
  "schedules",
  "contacts",
  "service_at_locations",
  "eligibilities",
  "required_documents",
  "languages",
  "accessibilities",
];

/** Data columns compared on re-import, per table (hsds_id is the key). */
const TABLE_COLUMNS: Record<RegistryTableName, string[]> = {
  taxonomies: ["name"],
  organizations: [
    "name",
    "alternate_name",
    "description",
    "email",
    "website",
    "legal_status",
    "status",
  ],
  services: [
    "organization_id",
    "name",
    "description",
    "url",
    "status",
    "taxonomy_id",
    "fees",
    "application_process",
    "crisis",
  ],
  locations: [
    "organization_id",
    "name",
    "description",
    "address_1",
    "address_2",
    "city",
    "state_province",
    "postal_code",
    "country",
    "latitude",
    "longitude",
    "accessibility_notes",
    "transportation_notes",
    "status",
  ],
  schedules: [
    "service_id",
    "location_id",
    "by_appointment",
    "days",
    "opens_at",
    "closes_at",
    "notes",
  ],
  contacts: [
    "organization_id",
    "service_id",
    "location_id",
    "name",
    "role",
    "department",
    "phone",
    "phone_extension",
    "email",
    "website",
  ],
  service_at_locations: ["service_id", "location_id", "description", "schedule_id"],
  eligibilities: ["service_id", "description", "criteria"],
  required_documents: ["service_id", "document", "description", "required"],
  languages: ["service_id", "language", "note"],
  accessibilities: ["service_id", "location_id", "accessibility", "details"],
};

/**
 * Tables that carry the field-level provenance columns (7.2). The join and
 * lookup tables do not, so they take only the import id.
 */
const TABLES_WITH_SOURCE_PROVENANCE = new Set<RegistryTableName>([
  "organizations",
  "services",
  "locations",
  "schedules",
  "contacts",
  "eligibilities",
  "required_documents",
]);

/** Table -> entity_type written on a resource_changes row. */
const ENTITY_TYPE: Record<RegistryTableName, string> = {
  taxonomies: "taxonomy",
  organizations: "organization",
  services: "service",
  locations: "location",
  schedules: "schedule",
  contacts: "contact",
  service_at_locations: "service_at_location",
  eligibilities: "eligibility",
  required_documents: "required_document",
  languages: "language",
  accessibilities: "accessibility",
};

/**
 * An imported file is a direct, retained copy of what the directory published,
 * so a conflict against it is tier B evidence (section 9.3 tiers).
 */
const IMPORT_EVIDENCE_TIER = "B";

type RowValues = Record<string, unknown>;

interface ResolvedRows {
  taxonomies: RowValues[];
  organizations: RowValues[];
  services: RowValues[];
  locations: RowValues[];
  schedules: RowValues[];
  contacts: RowValues[];
  service_at_locations: RowValues[];
  eligibilities: RowValues[];
  required_documents: RowValues[];
  languages: RowValues[];
  accessibilities: RowValues[];
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** jsonb columns take a JSON string, everything else goes as-is. */
function parameterValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/** Key-order-independent JSON, because Postgres jsonb reorders object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return stableStringify(a) === stableStringify(b);
  }
  return String(a) === String(b);
}

async function ensureSource(
  sql: Sql,
  options: ImportOptions,
): Promise<number> {
  if (options.sourceId) return options.sourceId;
  const userId = options.userId ?? "";
  const url = options.sourceUrl?.trim() || `hsds://${options.directoryName}`;
  const existing = await sql.query<{ id: number }>(
    "select id from sources where user_id = $1 and url = $2",
    [userId, url],
  );
  if (existing[0]) return existing[0].id;
  const inserted = await sql.query<{ id: number }>(
    `insert into sources (user_id, url, title, kind, tier)
     values ($1, $2, $3, 'official', 'B') returning id`,
    [userId, url, options.directoryName],
  );
  return inserted[0]!.id;
}

/** Numeric ids resolved from HSDS ids, per table, for one import. */
type IdMaps = Partial<Record<RegistryTableName, Map<string, number>>>;

function lookup(maps: IdMaps, table: RegistryTableName, hsdsId: string | null): number | null {
  if (!hsdsId) return null;
  return maps[table]?.get(hsdsId) ?? null;
}

/**
 * Turn the pure mapped rows into DB-shaped values, resolving parent HSDS ids
 * to the numeric ids this import just assigned.
 */
function resolveRows(rows: RegistryRows, maps: IdMaps): ResolvedRows {
  return {
    taxonomies: rows.taxonomies.map((row) => ({
      hsds_id: row.hsds_id,
      name: row.name,
      parent_id: lookup(maps, "taxonomies", row.parent_hsds_id),
    })),
    organizations: rows.organizations.map((row) => ({
      hsds_id: row.hsds_id,
      name: row.name,
      alternate_name: row.alternate_name,
      description: row.description,
      email: row.email,
      website: row.website,
      legal_status: row.legal_status,
      status: row.status,
    })),
    services: rows.services.map((row) => ({
      hsds_id: row.hsds_id,
      organization_id: lookup(maps, "organizations", row.organization_hsds_id),
      name: row.name,
      description: row.description,
      url: row.url,
      status: row.status,
      taxonomy_id: lookup(maps, "taxonomies", row.taxonomy_hsds_id),
      fees: row.fees,
      application_process: row.application_process,
      crisis: row.crisis,
    })),
    locations: rows.locations.map((row) => ({
      hsds_id: row.hsds_id,
      organization_id: lookup(maps, "organizations", row.organization_hsds_id),
      name: row.name,
      description: row.description,
      address_1: row.address_1,
      address_2: row.address_2,
      city: row.city,
      state_province: row.state_province,
      postal_code: row.postal_code,
      country: row.country,
      latitude: row.latitude,
      longitude: row.longitude,
      accessibility_notes: row.accessibility_notes,
      transportation_notes: row.transportation_notes,
      status: row.status,
    })),
    schedules: rows.schedules.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      location_id: lookup(maps, "locations", row.location_hsds_id),
      by_appointment: row.by_appointment,
      days: row.days,
      opens_at: row.opens_at,
      closes_at: row.closes_at,
      notes: row.notes,
    })),
    contacts: rows.contacts.map((row) => ({
      hsds_id: row.hsds_id,
      organization_id: lookup(maps, "organizations", row.organization_hsds_id),
      service_id: lookup(maps, "services", row.service_hsds_id),
      location_id: lookup(maps, "locations", row.location_hsds_id),
      name: row.name,
      role: row.role,
      department: row.department,
      phone: row.phone,
      phone_extension: row.phone_extension,
      email: row.email,
      website: row.website,
    })),
    service_at_locations: rows.service_at_locations.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      location_id: lookup(maps, "locations", row.location_hsds_id),
      description: row.description,
      schedule_id: lookup(maps, "schedules", row.schedule_hsds_id),
    })),
    eligibilities: rows.eligibilities.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      description: row.description,
      criteria: row.criteria,
    })),
    required_documents: rows.required_documents.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      document: row.document,
      description: row.description,
      required: row.required,
    })),
    languages: rows.languages.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      language: row.language,
      note: row.note,
    })),
    accessibilities: rows.accessibilities.map((row) => ({
      hsds_id: row.hsds_id,
      service_id: lookup(maps, "services", row.service_hsds_id),
      location_id: lookup(maps, "locations", row.location_hsds_id),
      accessibility: row.accessibility,
      details: row.details,
    })),
  };
}

interface TableWrite {
  inserted: number;
  ids: Map<string, number>;
  conflicts: ImportConflict[];
}

async function writeTable(
  sql: Sql,
  table: RegistryTableName,
  rows: RowValues[],
  context: {
    newsroomId: number;
    directoryName: string;
    importId: number;
    sourceId: number;
    snapshotId: number;
  },
): Promise<TableWrite> {
  const columns = TABLE_COLUMNS[table];
  const ids = new Map<string, number>();
  const conflicts: ImportConflict[] = [];
  if (!rows.length) return { inserted: 0, ids, conflicts };

  const hsdsIds = rows.map((row) => row.hsds_id as string);
  const existing = await sql.query<Record<string, unknown>>(
    `select id, hsds_id, ${columns.join(", ")}
       from ${table}
      where newsroom_id = $1 and directory_name = $2 and hsds_id = any($3::text[])`,
    [context.newsroomId, context.directoryName, hsdsIds],
  );
  const byHsdsId = new Map(existing.map((row) => [String(row.hsds_id), row]));

  let inserted = 0;
  for (const row of rows) {
    const hsdsId = row.hsds_id as string;
    const prior = byHsdsId.get(hsdsId);

    if (!prior) {
      const provenance = TABLES_WITH_SOURCE_PROVENANCE.has(table)
        ? ", resource_import_id, source_id, source_capture_id, verification_method"
        : ", resource_import_id";
      const provenanceValues = TABLES_WITH_SOURCE_PROVENANCE.has(table)
        ? [context.importId, context.sourceId, context.snapshotId, "imported"]
        : [context.importId];
      const values = [
        context.newsroomId,
        hsdsId,
        context.directoryName,
        ...columns.map((column) => parameterValue(row[column])),
        ...provenanceValues,
      ];
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const returned = await sql.query<{ id: number }>(
        `insert into ${table} (newsroom_id, hsds_id, directory_name, ${columns.join(", ")}${provenance})
         values (${placeholders}) returning id`,
        values,
      );
      const id = returned[0]!.id;
      ids.set(hsdsId, id);
      inserted += 1;
      continue;
    }

    const id = Number(prior.id);
    ids.set(hsdsId, id);
    for (const column of columns) {
      if (sameValue(prior[column], row[column])) continue;
      await sql.query(
        `insert into resource_changes
           (newsroom_id, source_id, source_capture_id, evidence_capture_id, evidence_tier,
            entity_type, entity_id, field_name, before_value, after_value, change_kind,
            summary, review_state)
         values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, 'field_change', $10, 'pending')`,
        [
          context.newsroomId,
          context.sourceId,
          context.snapshotId,
          IMPORT_EVIDENCE_TIER,
          ENTITY_TYPE[table],
          id,
          column,
          asText(prior[column]),
          asText(row[column]),
          `Re-import of ${context.directoryName} changes ${column}.`,
        ],
      );
      conflicts.push({
        entity_type: ENTITY_TYPE[table],
        entity_id: id,
        hsds_id: hsdsId,
        field_name: column,
        before_value: asText(prior[column]),
        after_value: asText(row[column]),
      });
    }
  }

  return { inserted, ids, conflicts };
}

/**
 * Import a bundle. One transaction: a throw anywhere rolls the whole import
 * back and nothing is written.
 */
export async function importHsdsBundle(
  sql: Sql,
  bundle: HsdsBundle,
  options: ImportOptions,
): Promise<ImportResult> {
  const payload = JSON.stringify(bundle);
  const recordCounts = Object.fromEntries(
    REGISTRY_TABLE_NAMES.map((name) => [name, 0]),
  ) as Record<RegistryTableName, number>;

  await sql.query("begin");
  try {
    const sourceId = await ensureSource(sql, options);
    const snapshot = await sql.query<{ id: number }>(
      `insert into snapshots (user_id, source_id, content_hash, excerpt)
       values ($1, $2, $3, $4) returning id`,
      [
        options.userId ?? "",
        sourceId,
        createHash("sha256").update(payload).digest("hex"),
        payload.slice(0, 2000),
      ],
    );
    const snapshotId = snapshot[0]!.id;

    const importRow = await sql.query<{ id: number }>(
      `insert into resource_imports (newsroom_id, directory_name, format, source_url)
       values ($1, $2, 'json', $3) returning id`,
      [options.newsroomId, options.directoryName, options.sourceUrl ?? null],
    );
    const importId = Number(importRow[0]!.id);

    const context = {
      newsroomId: options.newsroomId,
      directoryName: options.directoryName,
      importId,
      sourceId,
      snapshotId,
    };

    const mapped = bundleToRows(bundle);
    const maps: IdMaps = {};
    const conflicts: ImportConflict[] = [];

    // Taxonomies first so a service can point at one; parents are wired in a
    // second pass because a child may name a parent that comes later.
    const taxonomyRows = mapped.taxonomies.map((row) => ({
      hsds_id: row.hsds_id,
      name: row.name,
      parent_id: null as number | null,
    }));
    const taxonomyWrite = await writeTable(sql, "taxonomies", taxonomyRows, context);
    maps.taxonomies = taxonomyWrite.ids;
    recordCounts.taxonomies = taxonomyWrite.inserted;
    conflicts.push(...taxonomyWrite.conflicts);
    for (const row of mapped.taxonomies) {
      if (!row.parent_hsds_id) continue;
      const parentId = taxonomyWrite.ids.get(row.parent_hsds_id);
      const selfId = taxonomyWrite.ids.get(row.hsds_id);
      if (parentId === undefined || selfId === undefined) continue;
      const current = await sql.query<{ parent_id: number | null }>(
        "select parent_id from taxonomies where id = $1",
        [selfId],
      );
      const priorParent = current[0]?.parent_id ?? null;
      if (priorParent === parentId) continue;
      if (priorParent !== null) {
        // A changed parent is a conflict, not an overwrite.
        await sql.query(
          `insert into resource_changes
             (newsroom_id, source_id, source_capture_id, evidence_capture_id, evidence_tier,
              entity_type, entity_id, field_name, before_value, after_value, change_kind,
              summary, review_state)
           values ($1, $2, $3, $3, $4, 'taxonomy', $5, 'parent_id', $6, $7, 'field_change', $8, 'pending')`,
          [
            context.newsroomId,
            context.sourceId,
            context.snapshotId,
            IMPORT_EVIDENCE_TIER,
            selfId,
            String(priorParent),
            String(parentId),
            `Re-import of ${context.directoryName} changes the taxonomy parent.`,
          ],
        );
        conflicts.push({
          entity_type: "taxonomy",
          entity_id: selfId,
          hsds_id: row.hsds_id,
          field_name: "parent_id",
          before_value: String(priorParent),
          after_value: String(parentId),
        });
        continue;
      }
      await sql.query("update taxonomies set parent_id = $1, updated_at = now() where id = $2", [
        parentId,
        selfId,
      ]);
    }

    // Parent tables, each resolved before the tables that reference it.
    for (const table of ["organizations", "services", "locations"] as const) {
      const resolved = resolveRows(mapped, maps);
      const write = await writeTable(sql, table, resolved[table], context);
      maps[table] = write.ids;
      recordCounts[table] = write.inserted;
      conflicts.push(...write.conflicts);
    }

    const afterParents = resolveRows(mapped, maps);
    const scheduleWrite = await writeTable(sql, "schedules", afterParents.schedules, context);
    maps.schedules = scheduleWrite.ids;
    recordCounts.schedules = scheduleWrite.inserted;
    conflicts.push(...scheduleWrite.conflicts);

    const final = resolveRows(mapped, maps);
    for (const table of TABLE_ORDER) {
      if (
        table === "taxonomies" ||
        table === "organizations" ||
        table === "services" ||
        table === "locations" ||
        table === "schedules"
      ) {
        continue;
      }
      const write = await writeTable(sql, table, final[table], context);
      recordCounts[table] = write.inserted;
      conflicts.push(...write.conflicts);
    }

    await sql.query(
      `update resource_imports
          set record_counts = $1::jsonb, conflicts = $2::jsonb, report = $3
        where id = $4`,
      [
        JSON.stringify(recordCounts),
        JSON.stringify(conflicts),
        `${Object.values(recordCounts).reduce((sum, count) => sum + count, 0)} rows from ${options.directoryName}, ${conflicts.length} conflicts.`,
        importId,
      ],
    );

    await sql.query("commit");
    return { importId, snapshotId, sourceId, recordCounts, conflicts };
  } catch (error) {
    await sql.query("rollback").catch(() => undefined);
    throw error;
  }
}

interface StoredRow {
  hsds_id: string;
  [column: string]: unknown;
}

/**
 * Read one directory's rows back into the mapped shape, for the compatibility
 * round-trip. Internal only: there is no route in front of this.
 */
export async function readRegistryRows(
  sql: Sql,
  newsroomId: number,
  directoryName: string,
): Promise<RegistryRows> {
  const read = async (table: RegistryTableName): Promise<StoredRow[]> =>
    sql.query<StoredRow>(
      `select * from ${table} where newsroom_id = $1 and directory_name = $2 order by id`,
      [newsroomId, directoryName],
    );

  const [taxonomies, organizations, services, locations, schedules, contacts] =
    await Promise.all([
      read("taxonomies"),
      read("organizations"),
      read("services"),
      read("locations"),
      read("schedules"),
      read("contacts"),
    ]);
  const [serviceAtLocations, eligibilities, requiredDocuments, languages, accessibilities] =
    await Promise.all([
      read("service_at_locations"),
      read("eligibilities"),
      read("required_documents"),
      read("languages"),
      read("accessibilities"),
    ]);

  const orgById = new Map(organizations.map((row) => [Number(row.id), row.hsds_id]));
  const serviceById = new Map(services.map((row) => [Number(row.id), row.hsds_id]));
  const locationById = new Map(locations.map((row) => [Number(row.id), row.hsds_id]));
  const scheduleById = new Map(schedules.map((row) => [Number(row.id), row.hsds_id]));
  const taxonomyById = new Map(taxonomies.map((row) => [Number(row.id), row.hsds_id]));

  const hsdsOf = (
    map: Map<number, string>,
    value: unknown,
  ): string | null => (value == null ? null : map.get(Number(value)) ?? null);

  const text = (value: unknown): string | null =>
    typeof value === "string" ? value : value == null ? null : String(value);

  return {
    taxonomies: taxonomies.map((row) => ({
      hsds_id: row.hsds_id,
      name: row.name as string,
      parent_hsds_id: hsdsOf(taxonomyById, row.parent_id),
    })),
    organizations: organizations.map((row) => ({
      hsds_id: row.hsds_id,
      name: row.name as string,
      alternate_name: text(row.alternate_name),
      description: text(row.description),
      email: text(row.email),
      website: text(row.website),
      legal_status: text(row.legal_status),
      status: row.status as RegistryRows["organizations"][number]["status"],
    })),
    services: services.map((row) => ({
      hsds_id: row.hsds_id,
      organization_hsds_id: hsdsOf(orgById, row.organization_id) ?? "",
      name: row.name as string,
      description: text(row.description),
      url: text(row.url),
      status: row.status as RegistryRows["services"][number]["status"],
      taxonomy_hsds_id: hsdsOf(taxonomyById, row.taxonomy_id),
      fees: text(row.fees),
      application_process: text(row.application_process),
      crisis: Boolean(row.crisis),
    })),
    locations: locations.map((row) => ({
      hsds_id: row.hsds_id,
      organization_hsds_id: hsdsOf(orgById, row.organization_id) ?? "",
      name: text(row.name),
      description: text(row.description),
      address_1: text(row.address_1),
      address_2: text(row.address_2),
      city: text(row.city),
      state_province: text(row.state_province),
      postal_code: text(row.postal_code),
      country: text(row.country),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      accessibility_notes: text(row.accessibility_notes),
      transportation_notes: text(row.transportation_notes),
      status: row.status as RegistryRows["locations"][number]["status"],
    })),
    schedules: schedules.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id),
      location_hsds_id: hsdsOf(locationById, row.location_id),
      by_appointment: Boolean(row.by_appointment),
      days: text(row.days),
      opens_at: text(row.opens_at),
      closes_at: text(row.closes_at),
      notes: text(row.notes),
    })),
    contacts: contacts.map((row) => ({
      hsds_id: row.hsds_id,
      organization_hsds_id: hsdsOf(orgById, row.organization_id),
      service_hsds_id: hsdsOf(serviceById, row.service_id),
      location_hsds_id: hsdsOf(locationById, row.location_id),
      name: text(row.name),
      role: text(row.role),
      department: text(row.department),
      phone: text(row.phone),
      phone_extension: text(row.phone_extension),
      email: text(row.email),
      website: text(row.website),
    })),
    service_at_locations: serviceAtLocations.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id) ?? "",
      location_hsds_id: hsdsOf(locationById, row.location_id) ?? "",
      description: text(row.description),
      schedule_hsds_id: hsdsOf(scheduleById, row.schedule_id),
    })),
    eligibilities: eligibilities.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id) ?? "",
      description: text(row.description),
      criteria: (row.criteria ?? {}) as Record<string, unknown>,
    })),
    required_documents: requiredDocuments.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id) ?? "",
      document: row.document as string,
      description: text(row.description),
      required: Boolean(row.required),
    })),
    languages: languages.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id) ?? "",
      language: row.language as string,
      note: text(row.note),
    })),
    accessibilities: accessibilities.map((row) => ({
      hsds_id: row.hsds_id,
      service_hsds_id: hsdsOf(serviceById, row.service_id),
      location_hsds_id: hsdsOf(locationById, row.location_id),
      accessibility: row.accessibility as string,
      details: text(row.details),
    })),
  };
}

/** Read one directory back out as the bundle it came in as. Internal only. */
export async function readRegistryBundle(
  sql: Sql,
  newsroomId: number,
  directoryName: string,
): Promise<HsdsBundle> {
  return rowsToBundle(await readRegistryRows(sql, newsroomId, directoryName));
}
