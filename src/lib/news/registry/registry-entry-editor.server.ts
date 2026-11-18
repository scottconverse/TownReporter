/**
 * The registry entry editor's reader and writers (spec 24, Phase 2, job C1).
 *
 * The reader returns one service with its organization and contacts, and for
 * every row that other services also use, the list of those services. The
 * writers save one group at a time -- the service's details, its
 * organization's details, one contact -- each in one transaction, each checked
 * against the newsroom, each validated before anything is written.
 *
 * Published state follows the desk's existing edit (`updateRegistryEntryIn`): a
 * save never changes `published`. Only a save of the service's own details
 * stamps the service as verified by this editor, as that writer does. Saving
 * the organization or a contact does not restamp the service: nobody verified
 * the service by editing a shared row. A contact the editor adds takes the
 * `published` of the thing it hangs on, as the existing phone writer does, and
 * is stamped as the editor's reading.
 *
 * The same holds for the rest of the entry's rows (job C2): places (the
 * service's links to locations, and the location rows), hours, eligibility,
 * required documents, languages and accessibility. A save writes only the
 * fields sent and never stamps the service; a new row takes the `published` of
 * the service and, where its table has the columns, its own editor stamp.
 *
 * A row can be removed from the entry and restored (migration 0165). Removing
 * sets `removed_at` and `removed_by` on the row; nothing is deleted. A removed
 * row is not on the public page and is not published by Publish; the reader
 * lists it apart so it can be restored. A place is never removed itself, since
 * other entries may use it: removing a place from an entry removes the entry's
 * link to it.
 *
 * Each save sends only the fields the editor changed. The writer checks the
 * whole record (the stored values with those changes laid over them), so a
 * rule that spans fields holds, but it writes only the columns that were sent:
 * a stale form cannot overwrite another editor's change to a field it did not
 * touch.
 *
 * A save that names an entry from another newsroom, or one that does not
 * exist, throws and writes nothing; a save whose fields are not valid returns
 * the problems, field by field, and writes nothing.
 */

import { withTransaction, type Sql } from "../../db.ts";
import { DESK_DIRECTORY } from "./registry-entry-fields.ts";
import {
  REMOVABLE_KINDS,
  ROW_SPECS,
  emptyRow,
  validateContactDetails,
  validateOrganizationDetails,
  validateRow,
  validateServiceDetails,
  type ContactDetailFields,
  type ContactScope,
  type FieldProblems,
  type OrganizationDetailFields,
  type RemovableKind,
  type RowKind,
  type RowValues,
  type ServiceDetailFields,
  type SharedEntry,
} from "./registry-entry-editor-fields.ts";

export interface EntryDetailContact extends ContactDetailFields {
  id: number;
  scope: ContactScope;
  /** The location's name for a location contact; null otherwise. */
  locationName: string | null;
  /** Other services that use this contact; empty for the service's own. */
  sharedWith: SharedEntry[];
}

/** One row of the entry other than a contact, as the editor shows it. */
export interface EntryRow {
  /**
   * The row's id for saving and removing. For a place this is the id of the
   * service's link to the place (service_at_locations), not of the location.
   */
  id: number;
  fields: RowValues;
  /** Other services that use this row; empty for the service's own. */
  sharedWith: SharedEntry[];
  /** A place's location id; a schedule's place id when it is tied to one. */
  locationId: number | null;
  /** The name of the place a schedule is tied to; null for service-wide hours. */
  locationName: string | null;
}

/** A row that was removed from the entry, with words to recognise it by. */
export interface EntryRemovedRow {
  kind: RemovableKind;
  id: number;
  label: string;
  sharedWith: SharedEntry[];
}

/** A place the entry's organization has that this entry is not linked to. */
export interface LinkablePlace {
  locationId: number;
  name: string;
}

export interface RegistryEntryDetail {
  service: ServiceDetailFields & { id: number; published: boolean };
  organization: OrganizationDetailFields & {
    id: number;
    /** Other services of the same organization. */
    sharedWith: SharedEntry[];
  };
  contacts: EntryDetailContact[];
  places: EntryRow[];
  schedules: EntryRow[];
  eligibilities: EntryRow[];
  requiredDocuments: EntryRow[];
  languages: EntryRow[];
  accessibilities: EntryRow[];
  linkablePlaces: LinkablePlace[];
  removed: EntryRemovedRow[];
}

const NOT_IN_NEWSROOM = "That entry is not in this newsroom. Nothing was changed.";

interface ServiceRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  url: string | null;
  fees: string | null;
  application_process: string | null;
  crisis: boolean;
  published: boolean;
  org_name: string;
  org_alternate_name: string | null;
  org_description: string | null;
  org_email: string | null;
  org_website: string | null;
  org_legal_status: string | null;
}

/**
 * The service with its organization's details. `lock` takes the service row
 * for update, so a publish or take-down waits for the save to finish before
 * it reads or writes `published`.
 */
async function loadServiceRow(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  lock = false,
): Promise<ServiceRow | null> {
  const rows = await sql.query<ServiceRow>(
    `select s.id, s.organization_id, s.name, s.description, s.url, s.fees,
            s.application_process, s.crisis, s.published,
            o.name as org_name, o.alternate_name as org_alternate_name,
            o.description as org_description, o.email as org_email,
            o.website as org_website, o.legal_status as org_legal_status
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.id = $1 and s.newsroom_id = $2
      ${lock ? "for update of s" : ""}`,
    [serviceId, newsroomId],
  );
  return rows[0] ?? null;
}

interface ContactRow {
  id: number;
  organization_id: number | null;
  service_id: number | null;
  location_id: number | null;
  location_name: string | null;
  name: string | null;
  role: string | null;
  department: string | null;
  phone: string | null;
  phone_extension: string | null;
  email: string | null;
  website: string | null;
}

/**
 * The contacts the editor may see and change for one service: its own, the
 * organization's main-line contacts (no service, no location), and the contacts
 * of the locations the service is linked to (no service). Publishing reaches
 * exactly these, so the editor edits exactly what a reader would see. Removed
 * contacts are left out, or are the only ones returned with `removed`.
 */
async function loadContactRows(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  organizationId: number,
  removed = false,
): Promise<ContactRow[]> {
  return sql.query<ContactRow>(
    `select c.id, c.organization_id, c.service_id, c.location_id,
            l.name as location_name, c.name, c.role, c.department, c.phone,
            c.phone_extension, c.email, c.website
       from contacts c
       left join locations l
         on l.id = c.location_id and l.newsroom_id = c.newsroom_id
      where c.newsroom_id = $1
        and c.removed_at is ${removed ? "not null" : "null"}
        and (
          c.service_id = $2
          or (c.organization_id = $3 and c.service_id is null and c.location_id is null)
          or (c.service_id is null and c.location_id in (
                select location_id from service_at_locations
                 where newsroom_id = $1 and service_id = $2 and removed_at is null))
        )
      order by c.id`,
    [newsroomId, serviceId, organizationId],
  );
}

function scopeOf(row: ContactRow): ContactScope {
  if (row.service_id !== null) return "service";
  if (row.location_id !== null) return "location";
  return "organization";
}

interface SharedRow {
  id: number;
  org_name: string;
  name: string;
}

const sharedEntry = (row: SharedRow): SharedEntry => ({
  serviceId: Number(row.id),
  name: `${row.org_name} — ${row.name}`,
});

async function servicesOfOrganization(
  sql: Sql,
  newsroomId: number,
  organizationId: number,
  exceptServiceId: number,
): Promise<SharedEntry[]> {
  const rows = await sql.query<SharedRow>(
    `select s.id, o.name as org_name, s.name
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.organization_id = $2 and s.id <> $3
      order by s.name, s.id`,
    [newsroomId, organizationId, exceptServiceId],
  );
  return rows.map(sharedEntry);
}

async function servicesAtLocation(
  sql: Sql,
  newsroomId: number,
  locationId: number,
  exceptServiceId: number,
): Promise<SharedEntry[]> {
  const rows = await sql.query<SharedRow>(
    `select distinct s.id, o.name as org_name, s.name
       from service_at_locations sal
       join services s
         on s.id = sal.service_id and s.newsroom_id = sal.newsroom_id
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where sal.newsroom_id = $1 and sal.location_id = $2 and sal.service_id <> $3
        and sal.removed_at is null
      order by s.name, s.id`,
    [newsroomId, locationId, exceptServiceId],
  );
  return rows.map(sharedEntry);
}

/*
  The entry's other rows. Each kind is described once: the table a save writes,
  the columns its fields go to, and how to find the entry's rows of that kind.
  Column and table names come from these fixed lists, never from a request.
*/

/** Field name -> column, per kind. */
const ROW_COLUMNS: Record<RowKind, Readonly<Record<string, string>>> = {
  location: {
    name: "name",
    address1: "address_1",
    address2: "address_2",
    city: "city",
    stateProvince: "state_province",
    postalCode: "postal_code",
    accessibilityNotes: "accessibility_notes",
    transportationNotes: "transportation_notes",
  },
  schedule: {
    byAppointment: "by_appointment",
    days: "days",
    opensAt: "opens_at",
    closesAt: "closes_at",
    notes: "notes",
  },
  eligibility: { description: "description" },
  requiredDocument: { document: "document", description: "description", required: "required" },
  language: { language: "language", note: "note" },
  accessibility: { accessibility: "accessibility", details: "details" },
};

/** The table each kind's fields are written to. */
const ROW_TABLE = {
  location: "locations",
  schedule: "schedules",
  eligibility: "eligibilities",
  requiredDocument: "required_documents",
  language: "languages",
  accessibility: "accessibilities",
} as const satisfies Record<RowKind, string>;

/** The table a removal marks. A place is removed from an entry by its link. */
const REMOVE_TABLE = {
  contact: "contacts",
  location: "service_at_locations",
  schedule: "schedules",
  eligibility: "eligibilities",
  requiredDocument: "required_documents",
  language: "languages",
  accessibility: "accessibilities",
} as const satisfies Record<RemovableKind, string>;

/** Tables whose rows carry the editor-stamp columns (the others do not). */
const STAMPED_ROW_TABLES = new Set<string>([
  "locations",
  "schedules",
  "eligibilities",
  "required_documents",
]);

const ROW_ID_PREFIX: Record<RowKind, string> = {
  location: "location",
  schedule: "schedule",
  eligibility: "eligibility",
  requiredDocument: "document",
  language: "language",
  accessibility: "accessibility",
};

function rowColumnMap(kind: RowKind): ColumnMap<RowValues> {
  const map: Record<string, readonly [string, (fields: RowValues) => unknown]> = {};
  for (const [key, column] of Object.entries(ROW_COLUMNS[kind])) {
    map[key] = [
      column,
      (fields) => {
        const value = fields[key];
        return typeof value === "string" ? value || null : value;
      },
    ];
  }
  return map as ColumnMap<RowValues>;
}

type RawRow = Record<string, unknown> & { id: number };

const removedClause = (removed: boolean) => (removed ? "is not null" : "is null");

/**
 * The entry's rows of one kind, as stored. `removed` picks the rows an editor
 * removed instead of the live ones. A place is the service's link to it.
 */
async function loadRows(
  sql: Sql,
  kind: RowKind,
  newsroomId: number,
  serviceId: number,
  removed: boolean,
): Promise<RawRow[]> {
  const is = removedClause(removed);
  if (kind === "location") {
    return sql.query<RawRow>(
      `select sal.id, l.id as location_id, l.name, l.address_1, l.address_2, l.city,
              l.state_province, l.postal_code, l.accessibility_notes,
              l.transportation_notes
         from service_at_locations sal
         join locations l on l.id = sal.location_id and l.newsroom_id = sal.newsroom_id
        where sal.newsroom_id = $1 and sal.service_id = $2 and sal.removed_at ${is}
        order by sal.id`,
      [newsroomId, serviceId],
    );
  }
  if (kind === "schedule") {
    return sql.query<RawRow>(
      `select sc.id, sc.location_id, l.name as location_name, sc.by_appointment,
              sc.days, sc.opens_at, sc.closes_at, sc.notes
         from schedules sc
         left join locations l on l.id = sc.location_id and l.newsroom_id = sc.newsroom_id
        where sc.newsroom_id = $1 and sc.removed_at ${is}
          and (sc.service_id = $2
               or sc.id in (select schedule_id from service_at_locations
                             where newsroom_id = $1 and service_id = $2
                               and removed_at is null and schedule_id is not null))
        order by sc.id`,
      [newsroomId, serviceId],
    );
  }
  const table = ROW_TABLE[kind];
  const columns = Object.values(ROW_COLUMNS[kind]).join(", ");
  return sql.query<RawRow>(
    `select id, ${columns}
       from ${table}
      where newsroom_id = $1 and service_id = $2 and removed_at ${is}
      order by id`,
    [newsroomId, serviceId],
  );
}

function rowFields(kind: RowKind, raw: RawRow): RowValues {
  const fields: RowValues = {};
  const spec = ROW_SPECS[kind];
  for (const field of spec.text) {
    const value = raw[ROW_COLUMNS[kind][field.key]!];
    fields[field.key] = typeof value === "string" ? value : "";
  }
  for (const flag of spec.flags) {
    fields[flag.key] = Boolean(raw[ROW_COLUMNS[kind][flag.key]!]);
  }
  return fields;
}

/** Other services that point at one schedule: its own, or through a place link. */
async function servicesUsingSchedule(
  sql: Sql,
  newsroomId: number,
  scheduleId: number,
  exceptServiceId: number,
): Promise<SharedEntry[]> {
  const rows = await sql.query<SharedRow>(
    `select s.id, o.name as org_name, s.name
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.id <> $3
        and (s.id = (select service_id from schedules where id = $2 and newsroom_id = $1)
             or s.id in (select service_id from service_at_locations
                          where newsroom_id = $1 and schedule_id = $2 and removed_at is null))
      order by s.name, s.id`,
    [newsroomId, scheduleId, exceptServiceId],
  );
  return rows.map(sharedEntry);
}

async function sharedWithRow(
  sql: Sql,
  kind: RowKind,
  raw: RawRow,
  newsroomId: number,
  serviceId: number,
): Promise<SharedEntry[]> {
  if (kind === "location") {
    return servicesAtLocation(sql, newsroomId, Number(raw.location_id), serviceId);
  }
  if (kind === "schedule") return servicesUsingSchedule(sql, newsroomId, Number(raw.id), serviceId);
  return [];
}

const shorten = (value: string, max = 80): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** A removed row in words: enough to know which one it was. */
function removedLabel(kind: RemovableKind, stored: object, raw?: RawRow): string {
  const fields = stored as Record<string, unknown>;
  const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
  switch (kind) {
    case "contact": {
      const phone = text("phone") ? `phone ${text("phone")}` : "";
      return [text("name"), phone, text("email")].filter(Boolean).join(", ") || "A contact";
    }
    case "location":
      return [text("name"), text("address1"), text("city")].filter(Boolean).join(", ") || "A place";
    case "schedule": {
      const times =
        text("opensAt") && text("closesAt")
          ? `${text("opensAt")} to ${text("closesAt")}`
          : text("opensAt") || text("closesAt");
      const hours =
        fields.byAppointment === true
          ? "By appointment"
          : [text("days"), times].filter(Boolean).join(", ");
      const where = raw && typeof raw.location_name === "string" ? ` at ${raw.location_name}` : "";
      return `${hours || shorten(text("notes")) || "Hours"}${where}`;
    }
    case "eligibility":
      return shorten(text("description") || "An eligibility rule");
    case "requiredDocument":
      return text("document") || "A required document";
    case "language":
      return text("language") || "A language";
    case "accessibility":
      return text("accessibility") || "An accessibility note";
  }
}

async function loadEntryRows(
  sql: Sql,
  kind: RowKind,
  newsroomId: number,
  serviceId: number,
): Promise<EntryRow[]> {
  const rows = await loadRows(sql, kind, newsroomId, serviceId, false);
  const out: EntryRow[] = [];
  for (const raw of rows) {
    out.push({
      id: Number(raw.id),
      fields: rowFields(kind, raw),
      sharedWith: await sharedWithRow(sql, kind, raw, newsroomId, serviceId),
      locationId: raw.location_id == null ? null : Number(raw.location_id),
      locationName: typeof raw.location_name === "string" ? raw.location_name : null,
    });
  }
  return out;
}

async function loadRemovedRows(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  organizationId: number,
): Promise<EntryRemovedRow[]> {
  const removed: EntryRemovedRow[] = [];
  const orgShared = await servicesOfOrganization(sql, newsroomId, organizationId, serviceId);
  for (const contact of await loadContactRows(sql, newsroomId, serviceId, organizationId, true)) {
    let sharedWith: SharedEntry[] = [];
    if (contact.service_id === null && contact.location_id === null) sharedWith = orgShared;
    else if (contact.service_id === null) {
      sharedWith = await servicesAtLocation(sql, newsroomId, Number(contact.location_id), serviceId);
    }
    removed.push({
      kind: "contact",
      id: Number(contact.id),
      label: removedLabel("contact", contactFields(contact)),
      sharedWith,
    });
  }
  for (const kind of Object.keys(ROW_SPECS) as RowKind[]) {
    for (const raw of await loadRows(sql, kind, newsroomId, serviceId, true)) {
      removed.push({
        kind,
        id: Number(raw.id),
        label: removedLabel(kind, rowFields(kind, raw), raw),
        sharedWith: await sharedWithRow(sql, kind, raw, newsroomId, serviceId),
      });
    }
  }
  return removed;
}

/** The organization's places this entry is not linked to (a removed link does not count). */
async function loadLinkablePlaces(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  organizationId: number,
): Promise<LinkablePlace[]> {
  const rows = await sql.query<{
    id: number;
    name: string | null;
    address_1: string | null;
    city: string | null;
  }>(
    `select l.id, l.name, l.address_1, l.city
       from locations l
      where l.newsroom_id = $1 and l.organization_id = $2
        and l.id not in (select location_id from service_at_locations
                          where newsroom_id = $1 and service_id = $3 and removed_at is null)
      order by l.id`,
    [newsroomId, organizationId, serviceId],
  );
  return rows.map((row) => ({
    locationId: Number(row.id),
    name: [row.name, row.address_1, row.city].filter(Boolean).join(", ") || "A place",
  }));
}

/**
 * One service with its organization and contacts, for the editor. Returns null
 * when the service is not in this newsroom (or does not exist): nothing about
 * another newsroom's rows is ever returned.
 */
export async function getRegistryEntryDetail(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
): Promise<RegistryEntryDetail | null> {
  const row = await loadServiceRow(sql, newsroomId, serviceId);
  if (!row) return null;
  const id = Number(row.id);
  const organizationId = Number(row.organization_id);

  const orgShared = await servicesOfOrganization(sql, newsroomId, organizationId, id);
  const contactRows = await loadContactRows(sql, newsroomId, id, organizationId);

  const contacts: EntryDetailContact[] = [];
  for (const contact of contactRows) {
    const scope = scopeOf(contact);
    let sharedWith: SharedEntry[] = [];
    if (scope === "organization") sharedWith = orgShared;
    else if (scope === "location") {
      sharedWith = await servicesAtLocation(sql, newsroomId, Number(contact.location_id), id);
    }
    contacts.push({
      id: Number(contact.id),
      scope,
      locationName: contact.location_name,
      name: contact.name ?? "",
      role: contact.role ?? "",
      department: contact.department ?? "",
      phone: contact.phone ?? "",
      phoneExtension: contact.phone_extension ?? "",
      email: contact.email ?? "",
      website: contact.website ?? "",
      sharedWith,
    });
  }

  return {
    service: {
      id,
      published: row.published,
      name: row.name,
      description: row.description ?? "",
      url: row.url ?? "",
      fees: row.fees ?? "",
      applicationProcess: row.application_process ?? "",
      crisis: row.crisis,
    },
    organization: {
      id: organizationId,
      name: row.org_name,
      alternateName: row.org_alternate_name ?? "",
      description: row.org_description ?? "",
      email: row.org_email ?? "",
      website: row.org_website ?? "",
      legalStatus: row.org_legal_status ?? "",
      sharedWith: orgShared,
    },
    contacts,
    places: await loadEntryRows(sql, "location", newsroomId, id),
    schedules: await loadEntryRows(sql, "schedule", newsroomId, id),
    eligibilities: await loadEntryRows(sql, "eligibility", newsroomId, id),
    requiredDocuments: await loadEntryRows(sql, "requiredDocument", newsroomId, id),
    languages: await loadEntryRows(sql, "language", newsroomId, id),
    accessibilities: await loadEntryRows(sql, "accessibility", newsroomId, id),
    linkablePlaces: await loadLinkablePlaces(sql, newsroomId, id, organizationId),
    removed: await loadRemovedRows(sql, newsroomId, id, organizationId),
  };
}

export type EntrySaveResult =
  | { ok: true; serviceId: number }
  | { ok: false; problems: FieldProblems };

/** The fields a save sent: only the ones the editor changed, by field name. */
type Changed = Record<string, unknown>;

/**
 * For each field: the column it is written to, and the value written (empty
 * text is stored as null). The column names are fixed here; a request never
 * names a column.
 */
type ColumnMap<T> = {
  readonly [K in keyof T]: readonly [column: string, value: (fields: T) => unknown];
};

const SERVICE_COLUMNS: ColumnMap<ServiceDetailFields> = {
  name: ["name", (f) => f.name],
  description: ["description", (f) => f.description || null],
  url: ["url", (f) => f.url || null],
  fees: ["fees", (f) => f.fees || null],
  applicationProcess: ["application_process", (f) => f.applicationProcess || null],
  crisis: ["crisis", (f) => f.crisis],
};

const ORGANIZATION_COLUMNS: ColumnMap<OrganizationDetailFields> = {
  name: ["name", (f) => f.name],
  alternateName: ["alternate_name", (f) => f.alternateName || null],
  description: ["description", (f) => f.description || null],
  email: ["email", (f) => f.email || null],
  website: ["website", (f) => f.website || null],
  legalStatus: ["legal_status", (f) => f.legalStatus || null],
};

const CONTACT_COLUMNS: ColumnMap<ContactDetailFields> = {
  name: ["name", (f) => f.name || null],
  role: ["role", (f) => f.role || null],
  department: ["department", (f) => f.department || null],
  phone: ["phone", (f) => f.phone || null],
  phoneExtension: ["phone_extension", (f) => f.phoneExtension || null],
  email: ["email", (f) => f.email || null],
  website: ["website", (f) => f.website || null],
};

const NO_CONTACT: ContactDetailFields = {
  name: "",
  role: "",
  department: "",
  phone: "",
  phoneExtension: "",
  email: "",
  website: "",
};

function serviceFields(row: ServiceRow): ServiceDetailFields {
  return {
    name: row.name,
    description: row.description ?? "",
    url: row.url ?? "",
    fees: row.fees ?? "",
    applicationProcess: row.application_process ?? "",
    crisis: row.crisis,
  };
}

function organizationFields(row: ServiceRow): OrganizationDetailFields {
  return {
    name: row.org_name,
    alternateName: row.org_alternate_name ?? "",
    description: row.org_description ?? "",
    email: row.org_email ?? "",
    website: row.org_website ?? "",
    legalStatus: row.org_legal_status ?? "",
  };
}

function contactFields(row: ContactRow): ContactDetailFields {
  return {
    name: row.name ?? "",
    role: row.role ?? "",
    department: row.department ?? "",
    phone: row.phone ?? "",
    phoneExtension: row.phone_extension ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
  };
}

function asChanged(input: unknown): Changed {
  return (input && typeof input === "object" ? input : {}) as Changed;
}

function hasField(changed: Changed, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(changed, key);
}

/**
 * The stored fields with the editor's changes laid over them: what the record
 * would hold after the save. Only the fields the map names are taken.
 */
function withChanges<T extends object>(
  stored: T,
  changed: Changed,
  map: ColumnMap<T>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  for (const key of Object.keys(map)) {
    if (hasField(changed, key)) next[key] = changed[key];
  }
  return next;
}

/**
 * Write only the columns of the fields the editor sent. Nothing is written when
 * the editor sent no field. The table name is one of the fixed names above.
 */
async function writeChangedColumns<T extends object>(
  tx: Sql,
  table: "services" | "organizations" | "contacts" | (typeof ROW_TABLE)[RowKind],
  map: ColumnMap<T>,
  changed: Changed,
  values: T,
  id: number,
  newsroomId: number,
): Promise<void> {
  const writes = (Object.keys(map) as (keyof T & string)[])
    .filter((key) => hasField(changed, key))
    .map((key) => {
      const [column, value] = map[key];
      return { column, value: value(values) };
    });
  if (writes.length === 0) return;
  const sets = writes.map((write, i) => `${write.column} = $${i + 1}`).join(", ");
  await tx.query(
    `update ${table}
        set ${sets}, updated_at = now()
      where id = $${writes.length + 1} and newsroom_id = $${writes.length + 2}`,
    [...writes.map((write) => write.value), id, newsroomId],
  );
}

/**
 * Stamp the service as verified by this editor now: what the desk's existing
 * edit does, and written only by the service save.
 */
async function stampService(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  userId: string,
): Promise<void> {
  await sql.query(
    `update services
        set last_verified_at = now(),
            verification_method = 'editor',
            last_verified_by = $1,
            updated_at = now()
      where id = $2 and newsroom_id = $3`,
    [userId, serviceId, newsroomId],
  );
}

/**
 * Save the service's own details: the fields the editor changed, then the
 * service's stamp. `published` is not touched.
 */
export async function saveServiceDetailsIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: unknown,
  userId: string,
): Promise<EntrySaveResult> {
  return withTransaction(async (tx) => {
    const row = await loadServiceRow(tx, newsroomId, serviceId);
    if (!row) throw new Error(NOT_IN_NEWSROOM);
    const changed = asChanged(input);
    const checked = validateServiceDetails(withChanges(serviceFields(row), changed, SERVICE_COLUMNS));
    if (!checked.ok) return checked;
    const id = Number(row.id);
    await writeChangedColumns(tx, "services", SERVICE_COLUMNS, changed, checked.values, id, newsroomId);
    await stampService(tx, newsroomId, id, userId);
    return { ok: true as const, serviceId: id };
  });
}

/**
 * Save the details of the service's organization: the fields the editor
 * changed, and nothing else. The organization may belong to other services
 * too; the reader says which, and this writes the one row. The service is not
 * restamped: an organization edit is not a verification of the service.
 */
export async function saveOrganizationDetailsIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: unknown,
  _userId: string,
): Promise<EntrySaveResult> {
  return withTransaction(async (tx) => {
    const row = await loadServiceRow(tx, newsroomId, serviceId);
    if (!row) throw new Error(NOT_IN_NEWSROOM);
    const changed = asChanged(input);
    const checked = validateOrganizationDetails(
      withChanges(organizationFields(row), changed, ORGANIZATION_COLUMNS),
    );
    if (!checked.ok) return checked;
    await writeChangedColumns(
      tx,
      "organizations",
      ORGANIZATION_COLUMNS,
      changed,
      checked.values,
      Number(row.organization_id),
      newsroomId,
    );
    return { ok: true as const, serviceId: Number(row.id) };
  });
}

export interface SaveContactInput {
  /** The contact to change; absent or null to add one. */
  contactId?: number | null;
  /** Where a new contact belongs. Ignored when changing one. */
  scope?: "service" | "organization";
  /** The fields the editor changed. */
  fields: unknown;
}

/**
 * Add one contact to the entry, or change one of the entry's contacts.
 *
 * A contact id that is not one of this entry's contacts (another newsroom's, or
 * another service's) throws and writes nothing. A changed contact keeps its
 * `published` and its own stamp, and only its changed columns are written; a
 * new one takes the `published` of what it hangs on (the service, or the
 * organization) and is stamped as the editor's reading, the way the desk's phone
 * writer stamps a new phone row. Neither touches the service's stamp.
 */
export async function saveContactIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: SaveContactInput,
  userId: string,
): Promise<EntrySaveResult> {
  return withTransaction(async (tx) => {
    // The service row is locked: the published state a new contact takes is
    // read below, and a publish must not change it while this save runs.
    const row = await loadServiceRow(tx, newsroomId, serviceId, true);
    if (!row) throw new Error(NOT_IN_NEWSROOM);
    const id = Number(row.id);
    const organizationId = Number(row.organization_id);

    let existing: ContactRow | undefined;
    const contactId = input?.contactId ?? null;
    if (contactId !== null) {
      const rows = await loadContactRows(tx, newsroomId, id, organizationId);
      existing = rows.find((candidate) => Number(candidate.id) === Number(contactId));
      if (!existing) {
        throw new Error("That contact is not part of this entry. Nothing was changed.");
      }
    }
    const changed = asChanged(input?.fields);
    const checked = validateContactDetails(
      withChanges(existing ? contactFields(existing) : NO_CONTACT, changed, CONTACT_COLUMNS),
    );
    if (!checked.ok) return checked;
    const v = checked.values;

    if (existing) {
      await writeChangedColumns(
        tx,
        "contacts",
        CONTACT_COLUMNS,
        changed,
        v,
        Number(existing.id),
        newsroomId,
      );
      return { ok: true as const, serviceId: id };
    }

    const onOrganization = input?.scope === "organization";
    let published = row.published;
    if (onOrganization) {
      const org = await tx.query<{ published: boolean }>(
        "select published from organizations where id = $1 and newsroom_id = $2 for update",
        [organizationId, newsroomId],
      );
      published = Boolean(org[0]?.published);
    }
    const suffix = Math.random().toString(36).slice(2, 10);
    await tx.query(
      `insert into contacts
         (newsroom_id, hsds_id, directory_name, organization_id, service_id,
          name, role, department, phone, phone_extension, email, website,
          published, last_verified_at, verification_method, last_verified_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(),
               'editor', $14)`,
      [
        newsroomId,
        `desk-contact-${id}-${suffix}`,
        DESK_DIRECTORY,
        onOrganization ? organizationId : null,
        onOrganization ? null : id,
        v.name || null,
        v.role || null,
        v.department || null,
        v.phone || null,
        v.phoneExtension || null,
        v.email || null,
        v.website || null,
        published,
        userId,
      ],
    );
    return { ok: true as const, serviceId: id };
  });
}

const NOT_IN_ENTRY = "That row is not part of this entry. Nothing was changed.";

export interface SaveRowInput {
  kind: RowKind;
  /** The row to change (a place's link id); absent or null to add one. */
  rowId?: number | null;
  /** The fields the editor changed. */
  fields: unknown;
  /**
   * When adding a place: link this place of the organization instead of making
   * a new one. When adding hours: tie them to this place of the entry. Ignored
   * when changing a row.
   */
  locationId?: number | null;
}

function isRowKind(kind: unknown): kind is RowKind {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(ROW_SPECS, kind);
}

function isRemovableKind(kind: unknown): kind is RemovableKind {
  return REMOVABLE_KINDS.includes(kind as RemovableKind);
}

async function insertLink(
  tx: Sql,
  newsroomId: number,
  serviceId: number,
  locationId: number,
  published: boolean,
): Promise<void> {
  await tx.query(
    `insert into service_at_locations
       (newsroom_id, hsds_id, directory_name, service_id, location_id, published)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      newsroomId,
      `desk-link-${serviceId}-${Math.random().toString(36).slice(2, 10)}`,
      DESK_DIRECTORY,
      serviceId,
      locationId,
      published,
    ],
  );
}

/**
 * Add one row to the entry, or change one of the entry's rows: a place, hours,
 * an eligibility rule, a required document, a language or an accessibility note.
 *
 * A row id that is not one of this entry's live rows throws and writes nothing.
 * A change writes only the fields sent, checks the whole record, and never
 * touches `published` or the service's stamp. A new row takes the service's
 * `published`; where its table has the columns it carries the editor's stamp, as
 * a contact the editor adds does. A new place is made under the entry's
 * organization and linked to the entry; a `locationId` with no row id links a
 * place the organization already has. Neither changes another entry's place.
 */
export async function saveEntryRowIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: SaveRowInput,
  userId: string,
): Promise<EntrySaveResult> {
  return withTransaction(async (tx) => {
    // Locked: the published state a new row takes is read here, and a publish
    // or a removal must not change it while this save runs.
    const service = await loadServiceRow(tx, newsroomId, serviceId, true);
    if (!service) throw new Error(NOT_IN_NEWSROOM);
    const id = Number(service.id);
    const organizationId = Number(service.organization_id);
    const kind = input?.kind;
    if (!isRowKind(kind)) {
      throw new Error("That kind of row cannot be saved here. Nothing was changed.");
    }

    let existing: RawRow | undefined;
    const rowId = input.rowId ?? null;
    if (rowId !== null) {
      const rows = await loadRows(tx, kind, newsroomId, id, false);
      existing = rows.find((candidate) => Number(candidate.id) === Number(rowId));
      if (!existing) throw new Error(NOT_IN_ENTRY);
    }
    const locationId = input.locationId ?? null;

    // Linking a place the organization already has: nothing to validate.
    if (kind === "location" && !existing && locationId !== null) {
      const place = await tx.query<{ id: number }>(
        `select id from locations
          where id = $1 and newsroom_id = $2 and organization_id = $3
          for share`,
        [locationId, newsroomId, organizationId],
      );
      if (!place[0]) {
        throw new Error("That place is not one of this organization's. Nothing was changed.");
      }
      const linked = await tx.query(
        `select 1 from service_at_locations
          where newsroom_id = $1 and service_id = $2 and location_id = $3
            and removed_at is null`,
        [newsroomId, id, locationId],
      );
      if (linked.length > 0) {
        throw new Error("That place is already part of this entry. Nothing was changed.");
      }
      await insertLink(tx, newsroomId, id, locationId, service.published);
      return { ok: true as const, serviceId: id };
    }

    const map = rowColumnMap(kind);
    const changed = asChanged(input.fields);
    const stored = existing ? rowFields(kind, existing) : emptyRow(kind);
    const checked = validateRow(kind, withChanges(stored, changed, map));
    if (!checked.ok) return checked;
    const values = checked.values;

    if (existing) {
      // A place's fields live on the location row; the entry's row is the link.
      const targetId = kind === "location" ? Number(existing.location_id) : Number(existing.id);
      await writeChangedColumns(tx, ROW_TABLE[kind], map, changed, values, targetId, newsroomId);
      return { ok: true as const, serviceId: id };
    }

    const table = ROW_TABLE[kind];
    const columns: string[] = ["newsroom_id", "hsds_id", "directory_name"];
    const params: unknown[] = [
      newsroomId,
      `desk-${ROW_ID_PREFIX[kind]}-${id}-${Math.random().toString(36).slice(2, 10)}`,
      DESK_DIRECTORY,
    ];
    const add = (column: string, value: unknown) => {
      columns.push(column);
      params.push(value);
    };
    if (kind === "location") {
      add("organization_id", organizationId);
      add("status", service.published ? "active" : "unverified");
    } else {
      add("service_id", id);
    }
    if (kind === "schedule" && locationId !== null) {
      const places = await loadRows(tx, "location", newsroomId, id, false);
      if (!places.some((place) => Number(place.location_id) === Number(locationId))) {
        throw new Error("That place is not part of this entry. Nothing was changed.");
      }
      add("location_id", locationId);
    }
    for (const key of Object.keys(map)) {
      const [column, value] = map[key]!;
      add(column, value(values));
    }
    add("published", service.published);
    const placeholders = params.map((_, index) => `$${index + 1}`);
    let stamp = "";
    if (STAMPED_ROW_TABLES.has(table)) {
      params.push(userId);
      stamp = ", last_verified_at, verification_method, last_verified_by";
      placeholders.push("now()", "'editor'", `$${params.length}`);
    }
    const inserted = await tx.query<{ id: number }>(
      `insert into ${table} (${columns.join(", ")}${stamp})
       values (${placeholders.join(", ")}) returning id`,
      params,
    );
    if (kind === "location") {
      await insertLink(tx, newsroomId, id, Number(inserted[0]!.id), service.published);
    }
    return { ok: true as const, serviceId: id };
  });
}

export interface RemoveRowInput {
  kind: RemovableKind;
  /** The row's id; for a place, the id of the entry's link to it. */
  rowId: number;
}

/** The ids of the entry's rows of a kind, live or removed. */
async function entryRowIds(
  tx: Sql,
  kind: RemovableKind,
  newsroomId: number,
  serviceId: number,
  organizationId: number,
  removed: boolean,
): Promise<number[]> {
  const rows =
    kind === "contact"
      ? await loadContactRows(tx, newsroomId, serviceId, organizationId, removed)
      : await loadRows(tx, kind, newsroomId, serviceId, removed);
  return rows.map((row) => Number(row.id));
}

/**
 * Mark one of the entry's rows removed, or clear the mark. Nothing is deleted.
 * A row id that is not one of this entry's rows throws and writes nothing; a row
 * already in the wanted state is left as it is and the call says it worked.
 */
async function setRemoved(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: RemoveRowInput,
  userId: string,
  remove: boolean,
): Promise<EntrySaveResult> {
  return withTransaction(async (tx) => {
    const service = await loadServiceRow(tx, newsroomId, serviceId, true);
    if (!service) throw new Error(NOT_IN_NEWSROOM);
    const id = Number(service.id);
    const organizationId = Number(service.organization_id);
    const kind = input?.kind;
    if (!isRemovableKind(kind)) {
      throw new Error("That kind of row cannot be changed here. Nothing was changed.");
    }
    const rowId = Number(input.rowId);
    // A row in the state we are leaving can be changed; a row already in the
    // wanted state needs nothing; anything else is not this entry's.
    const before = await entryRowIds(tx, kind, newsroomId, id, organizationId, !remove);
    if (!before.includes(rowId)) {
      const after = await entryRowIds(tx, kind, newsroomId, id, organizationId, remove);
      if (after.includes(rowId)) return { ok: true as const, serviceId: id };
      throw new Error(NOT_IN_ENTRY);
    }
    await tx.query(
      `update ${REMOVE_TABLE[kind]}
          set removed_at = ${remove ? "now()" : "null"},
              removed_by = ${remove ? "$3" : "null"},
              updated_at = now()
        where id = $1 and newsroom_id = $2`,
      remove ? [rowId, newsroomId, userId] : [rowId, newsroomId],
    );
    return { ok: true as const, serviceId: id };
  });
}

/** Remove one row from the entry (a marker, not a delete). */
export function removeEntryRowIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: RemoveRowInput,
  userId: string,
): Promise<EntrySaveResult> {
  return setRemoved(sql, newsroomId, serviceId, input, userId, true);
}

/** Bring a removed row back to the entry. */
export function restoreEntryRowIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: RemoveRowInput,
  userId: string,
): Promise<EntrySaveResult> {
  return setRemoved(sql, newsroomId, serviceId, input, userId, false);
}
