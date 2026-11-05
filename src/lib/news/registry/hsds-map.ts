/**
 * HSDS bundle <-> registry rows. Pure functions, no database.
 *
 * `bundleToRows` maps a directory's HSDS JSON into the shape the tables in
 * `migrations/0160_resource_registry.sql` take. `rowsToBundle` rebuilds the
 * bundle from those rows. Neither is exported to the public (section 15.2's
 * export endpoint is Phase 2 and is deliberately not built here).
 *
 * The field names on both sides are HSDS's own (section 7.3). Every row the
 * importer writes is unpublished and unverified (section 15.1); `published`
 * and the verification columns are not part of the bundle and never round-trip.
 *
 * Deliberate divergences are listed in `divergences.ts` and excluded from the
 * compatibility assertion.
 */

import type {
  HsdsBundle,
  HsdsOrganization,
  HsdsService,
  HsdsLocation,
  HsdsPhone,
  HsdsStatus,
} from "./hsds-types.ts";

export interface MapOptions {
  newsroomId: number;
  directoryName: string;
  /** `resource_imports.id`; null before the import row is written. */
  importId: number | null;
}

export interface OrganizationRow {
  hsds_id: string;
  name: string;
  alternate_name: string | null;
  description: string | null;
  email: string | null;
  website: string | null;
  legal_status: string | null;
  status: HsdsStatus;
}

export interface ServiceRow {
  hsds_id: string;
  organization_hsds_id: string;
  name: string;
  description: string | null;
  url: string | null;
  status: HsdsStatus;
  taxonomy_hsds_id: string | null;
  fees: string | null;
  application_process: string | null;
  crisis: boolean;
}

export interface LocationRow {
  hsds_id: string;
  organization_hsds_id: string;
  name: string | null;
  description: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  accessibility_notes: string | null;
  transportation_notes: string | null;
  status: HsdsStatus;
}

export interface ScheduleRow {
  hsds_id: string;
  service_hsds_id: string | null;
  location_hsds_id: string | null;
  by_appointment: boolean;
  days: string | null;
  opens_at: string | null;
  closes_at: string | null;
  notes: string | null;
}

export interface ContactRow {
  hsds_id: string;
  organization_hsds_id: string | null;
  service_hsds_id: string | null;
  location_hsds_id: string | null;
  name: string | null;
  role: string | null;
  department: string | null;
  phone: string | null;
  phone_extension: string | null;
  email: string | null;
  website: string | null;
}

export interface ServiceAtLocationRow {
  hsds_id: string;
  service_hsds_id: string;
  location_hsds_id: string;
  description: string | null;
  schedule_hsds_id: string | null;
}

export interface EligibilityRow {
  hsds_id: string;
  service_hsds_id: string;
  description: string | null;
  criteria: Record<string, unknown>;
}

export interface RequiredDocumentRow {
  hsds_id: string;
  service_hsds_id: string;
  document: string;
  description: string | null;
  required: boolean;
}

export interface LanguageRow {
  hsds_id: string;
  service_hsds_id: string;
  language: string;
  note: string | null;
}

export interface AccessibilityRow {
  hsds_id: string;
  service_hsds_id: string | null;
  location_hsds_id: string | null;
  accessibility: string;
  details: string | null;
}

export interface TaxonomyRow {
  hsds_id: string;
  name: string;
  parent_hsds_id: string | null;
}

export interface RegistryRows {
  taxonomies: TaxonomyRow[];
  organizations: OrganizationRow[];
  services: ServiceRow[];
  locations: LocationRow[];
  schedules: ScheduleRow[];
  contacts: ContactRow[];
  service_at_locations: ServiceAtLocationRow[];
  eligibilities: EligibilityRow[];
  required_documents: RequiredDocumentRow[];
  languages: LanguageRow[];
  accessibilities: AccessibilityRow[];
}

export const REGISTRY_TABLE_NAMES = [
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
] as const;

export type RegistryTableName = (typeof REGISTRY_TABLE_NAMES)[number];

/** Every imported row is unverified until a scan or an editor confirms it. */
const IMPORTED_STATUS: HsdsStatus = "unverified";

/**
 * A nested HSDS phone usually carries no id. Give it a stable one derived from
 * its parent and position so a re-import matches the same row.
 */
function phoneId(parentId: string, phone: HsdsPhone, index: number): string {
  return phone.id ?? `${parentId}:phone:${index}`;
}

export function emptyRegistryRows(): RegistryRows {
  return {
    taxonomies: [],
    organizations: [],
    services: [],
    locations: [],
    schedules: [],
    contacts: [],
    service_at_locations: [],
    eligibilities: [],
    required_documents: [],
    languages: [],
    accessibilities: [],
  };
}

function mapPhones(
  rows: RegistryRows,
  phones: HsdsPhone[] | undefined,
  parentId: string,
  parent: { organization?: string; service?: string; location?: string },
): void {
  (phones ?? []).forEach((phone, index) => {
    rows.contacts.push({
      hsds_id: phoneId(parentId, phone, index),
      organization_hsds_id: parent.organization ?? null,
      service_hsds_id: parent.service ?? null,
      location_hsds_id: parent.location ?? null,
      name: phone.name ?? null,
      role: phone.role ?? null,
      department: phone.department ?? null,
      phone: phone.phone ?? null,
      phone_extension: phone.phone_extension ?? null,
      email: phone.email ?? null,
      website: phone.website ?? null,
    });
  });
}

function mapService(rows: RegistryRows, org: HsdsOrganization, service: HsdsService): void {
  rows.services.push({
    hsds_id: service.id,
    organization_hsds_id: org.id,
    name: service.name,
    description: service.description ?? null,
    url: service.url ?? null,
    status: service.status ?? IMPORTED_STATUS,
    taxonomy_hsds_id: service.taxonomy_id ?? null,
    fees: service.fees ?? null,
    application_process: service.application_process ?? null,
    crisis: service.crisis ?? false,
  });

  for (const schedule of service.schedules ?? []) {
    rows.schedules.push({
      hsds_id: schedule.id,
      service_hsds_id: service.id,
      location_hsds_id: null,
      by_appointment: schedule.by_appointment ?? false,
      days: schedule.days ?? null,
      opens_at: schedule.opens_at ?? null,
      closes_at: schedule.closes_at ?? null,
      notes: schedule.notes ?? null,
    });
  }

  mapPhones(rows, service.phones, service.id, { service: service.id });

  for (const eligibility of service.eligibilities ?? []) {
    rows.eligibilities.push({
      hsds_id: eligibility.id,
      service_hsds_id: service.id,
      description: eligibility.description ?? null,
      criteria: eligibility.criteria ?? {},
    });
  }

  for (const document of service.required_documents ?? []) {
    rows.required_documents.push({
      hsds_id: document.id,
      service_hsds_id: service.id,
      document: document.document,
      description: document.description ?? null,
      required: document.required ?? true,
    });
  }

  for (const language of service.languages ?? []) {
    rows.languages.push({
      hsds_id: language.id,
      service_hsds_id: service.id,
      language: language.language,
      note: language.note ?? null,
    });
  }

  for (const accessibility of service.accessibilities ?? []) {
    rows.accessibilities.push({
      hsds_id: accessibility.id,
      service_hsds_id: service.id,
      location_hsds_id: null,
      accessibility: accessibility.accessibility,
      details: accessibility.details ?? null,
    });
  }

  for (const join of service.service_at_locations ?? []) {
    rows.service_at_locations.push({
      hsds_id: join.id,
      service_hsds_id: service.id,
      location_hsds_id: join.location_id,
      description: join.description ?? null,
      schedule_hsds_id: join.schedule_id ?? null,
    });
  }
}

function mapLocation(rows: RegistryRows, org: HsdsOrganization, location: HsdsLocation): void {
  rows.locations.push({
    hsds_id: location.id,
    organization_hsds_id: org.id,
    name: location.name ?? null,
    description: location.description ?? null,
    address_1: location.address_1 ?? null,
    address_2: location.address_2 ?? null,
    city: location.city ?? null,
    state_province: location.state_province ?? null,
    postal_code: location.postal_code ?? null,
    country: location.country ?? null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    accessibility_notes: location.accessibility_notes ?? null,
    transportation_notes: location.transportation_notes ?? null,
    status: location.status ?? IMPORTED_STATUS,
  });

  for (const schedule of location.schedules ?? []) {
    rows.schedules.push({
      hsds_id: schedule.id,
      service_hsds_id: null,
      location_hsds_id: location.id,
      by_appointment: schedule.by_appointment ?? false,
      days: schedule.days ?? null,
      opens_at: schedule.opens_at ?? null,
      closes_at: schedule.closes_at ?? null,
      notes: schedule.notes ?? null,
    });
  }

  mapPhones(rows, location.phones, location.id, { location: location.id });

  for (const accessibility of location.accessibilities ?? []) {
    rows.accessibilities.push({
      hsds_id: accessibility.id,
      service_hsds_id: null,
      location_hsds_id: location.id,
      accessibility: accessibility.accessibility,
      details: accessibility.details ?? null,
    });
  }
}

/** Map one HSDS bundle to rows ready to write. Pure; safe to unit test. */
export function bundleToRows(bundle: HsdsBundle): RegistryRows {
  const rows = emptyRegistryRows();

  for (const taxonomy of bundle.taxonomies ?? []) {
    rows.taxonomies.push({
      hsds_id: taxonomy.id,
      name: taxonomy.name,
      parent_hsds_id: taxonomy.parent_id ?? null,
    });
  }

  for (const org of bundle.organizations ?? []) {
    rows.organizations.push({
      hsds_id: org.id,
      name: org.name,
      alternate_name: org.alternate_name ?? null,
      description: org.description ?? null,
      email: org.email ?? null,
      website: org.website ?? null,
      legal_status: org.legal_status ?? null,
      status: org.status ?? IMPORTED_STATUS,
    });

    mapPhones(rows, org.phones, org.id, { organization: org.id });

    for (const service of org.services ?? []) mapService(rows, org, service);
    for (const location of org.locations ?? []) mapLocation(rows, org, location);
  }

  return rows;
}

// --- back to a bundle -------------------------------------------------------

function phonesFor(
  rows: RegistryRows,
  match: (row: RegistryRows["contacts"][number]) => boolean,
): HsdsPhone[] {
  return rows.contacts
    .filter(match)
    .map((contact) => ({
      id: contact.hsds_id,
      name: contact.name,
      role: contact.role,
      department: contact.department,
      phone: contact.phone,
      phone_extension: contact.phone_extension,
      email: contact.email,
      website: contact.website,
    }));
}

/** Rebuild the same nested HSDS bundle from mapped rows. */
export function rowsToBundle(rows: RegistryRows): HsdsBundle {
  const organizations: HsdsOrganization[] = rows.organizations.map((org) => {
    const services: HsdsService[] = rows.services
      .filter((service) => service.organization_hsds_id === org.hsds_id)
      .map((service) => ({
        id: service.hsds_id,
        name: service.name,
        description: service.description,
        url: service.url,
        status: service.status,
        taxonomy_id: service.taxonomy_hsds_id,
        fees: service.fees,
        application_process: service.application_process,
        crisis: service.crisis,
        phones: phonesFor(rows, (contact) => contact.service_hsds_id === service.hsds_id),
        schedules: rows.schedules
          .filter(
            (schedule) =>
              schedule.service_hsds_id === service.hsds_id && schedule.location_hsds_id === null,
          )
          .map((schedule) => ({
            id: schedule.hsds_id,
            by_appointment: schedule.by_appointment,
            days: schedule.days,
            opens_at: schedule.opens_at,
            closes_at: schedule.closes_at,
            notes: schedule.notes,
          })),
        eligibilities: rows.eligibilities
          .filter((row) => row.service_hsds_id === service.hsds_id)
          .map((row) => ({
            id: row.hsds_id,
            description: row.description,
            criteria: row.criteria,
          })),
        required_documents: rows.required_documents
          .filter((row) => row.service_hsds_id === service.hsds_id)
          .map((row) => ({
            id: row.hsds_id,
            document: row.document,
            description: row.description,
            required: row.required,
          })),
        languages: rows.languages
          .filter((row) => row.service_hsds_id === service.hsds_id)
          .map((row) => ({ id: row.hsds_id, language: row.language, note: row.note })),
        accessibilities: rows.accessibilities
          .filter((row) => row.service_hsds_id === service.hsds_id)
          .map((row) => ({
            id: row.hsds_id,
            accessibility: row.accessibility,
            details: row.details,
          })),
        service_at_locations: rows.service_at_locations
          .filter((row) => row.service_hsds_id === service.hsds_id)
          .map((row) => ({
            id: row.hsds_id,
            location_id: row.location_hsds_id,
            description: row.description,
            schedule_id: row.schedule_hsds_id,
          })),
      }));

    const locations: HsdsLocation[] = rows.locations
      .filter((location) => location.organization_hsds_id === org.hsds_id)
      .map((location) => ({
        id: location.hsds_id,
        name: location.name,
        description: location.description,
        address_1: location.address_1,
        address_2: location.address_2,
        city: location.city,
        state_province: location.state_province,
        postal_code: location.postal_code,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
        accessibility_notes: location.accessibility_notes,
        transportation_notes: location.transportation_notes,
        status: location.status,
        phones: phonesFor(rows, (contact) => contact.location_hsds_id === location.hsds_id),
        schedules: rows.schedules
          .filter(
            (schedule) =>
              schedule.location_hsds_id === location.hsds_id && schedule.service_hsds_id === null,
          )
          .map((schedule) => ({
            id: schedule.hsds_id,
            by_appointment: schedule.by_appointment,
            days: schedule.days,
            opens_at: schedule.opens_at,
            closes_at: schedule.closes_at,
            notes: schedule.notes,
          })),
        accessibilities: rows.accessibilities
          .filter(
            (row) =>
              row.location_hsds_id === location.hsds_id && row.service_hsds_id === null,
          )
          .map((row) => ({
            id: row.hsds_id,
            accessibility: row.accessibility,
            details: row.details,
          })),
      }));

    return {
      id: org.hsds_id,
      name: org.name,
      alternate_name: org.alternate_name,
      description: org.description,
      email: org.email,
      website: org.website,
      legal_status: org.legal_status,
      status: org.status,
      phones: phonesFor(
        rows,
        (contact) =>
          contact.organization_hsds_id === org.hsds_id &&
          contact.service_hsds_id === null &&
          contact.location_hsds_id === null,
      ),
      services,
      locations,
    };
  });

  const bundle: HsdsBundle = { organizations };
  if (rows.taxonomies.length) {
    bundle.taxonomies = rows.taxonomies.map((taxonomy) => ({
      id: taxonomy.hsds_id,
      name: taxonomy.name,
      parent_id: taxonomy.parent_hsds_id,
    }));
  }
  return bundle;
}
