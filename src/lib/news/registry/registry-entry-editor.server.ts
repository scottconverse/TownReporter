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
 * is stamped as the editor's reading. Nothing here removes a row.
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
  validateContactDetails,
  validateOrganizationDetails,
  validateServiceDetails,
  type ContactDetailFields,
  type ContactScope,
  type FieldProblems,
  type OrganizationDetailFields,
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

export interface RegistryEntryDetail {
  service: ServiceDetailFields & { id: number; published: boolean };
  organization: OrganizationDetailFields & {
    id: number;
    /** Other services of the same organization. */
    sharedWith: SharedEntry[];
  };
  contacts: EntryDetailContact[];
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
 * exactly these, so the editor edits exactly what a reader would see.
 */
async function loadContactRows(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  organizationId: number,
): Promise<ContactRow[]> {
  return sql.query<ContactRow>(
    `select c.id, c.organization_id, c.service_id, c.location_id,
            l.name as location_name, c.name, c.role, c.department, c.phone,
            c.phone_extension, c.email, c.website
       from contacts c
       left join locations l
         on l.id = c.location_id and l.newsroom_id = c.newsroom_id
      where c.newsroom_id = $1
        and (
          c.service_id = $2
          or (c.organization_id = $3 and c.service_id is null and c.location_id is null)
          or (c.service_id is null and c.location_id in (
                select location_id from service_at_locations
                 where newsroom_id = $1 and service_id = $2))
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
      order by s.name, s.id`,
    [newsroomId, locationId, exceptServiceId],
  );
  return rows.map(sharedEntry);
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
 * the editor sent no field. The table name is one of three fixed names.
 */
async function writeChangedColumns<T extends object>(
  tx: Sql,
  table: "services" | "organizations" | "contacts",
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
