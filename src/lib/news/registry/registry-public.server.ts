/**
 * The public Registry page's read (spec 15.1, 18.2 and 24, Phase 1).
 *
 * What a reader may see is deliberately narrow:
 *
 *  - only services with `published = true` and `status = 'active'`, under an
 *    organization that is also published and active. An imported row starts
 *    unpublished (15.1) and stays out of public view until an editor presses
 *    Publish on the desk;
 *  - every entry names the source it came from, and its last verified date
 *    when it has one (spec 11: change detection is not verification, and the
 *    public copy never claims a phone was called or a program is open);
 *  - an editor note is shown when an editor wrote one;
 *  - a row an editor removed from the entry (`removed_at` set) is never read,
 *    whatever its published flag says;
 *  - each published, active location keeps its own address, phones and hours.
 *    The organization's main phone and the service-wide phone and hours are
 *    listed apart, so nothing from one place shows under another.
 *
 * "Verified" is an explicit verification record an editor made (the latest one
 * for the service). The older `last_verified_at` (the service's own where it has
 * one, the organization's otherwise) is only a legacy date: it was set by saves
 * and publishes, so it is returned apart and worded "Last updated". Neither is
 * ever inferred from an import date.
 */

import type { Sql } from "../../db.ts";
import type { WhenValue } from "./registry-desk.server.ts";

/** One published, active place a service is offered, with what belongs to it. */
export interface PublicRegistryLocation {
  locationId: number;
  name: string | null;
  address: string | null;
  /** Phones of this place: the service's line here, or the place's own line. */
  phones: string[];
  /** Opening hours of this place only, one string per schedule. */
  hours: string[];
  /** Accessibility of this place only, one string per row. */
  accessibility: string[];
}

/** A document a service asks for. */
export interface PublicRegistryDocument {
  document: string;
  description: string | null;
  required: boolean;
}

/** A published source a reader can follow. `appliesTo` says whose it is. */
export interface PublicRegistrySource {
  url: string;
  title: string;
  appliesTo: "service" | "organization";
}

export interface PublicRegistryEntry {
  serviceId: number;
  /** The directory's own id for the service, for provenance. */
  hsdsId: string;
  /** The directory the service was imported from ('' when entered by hand). */
  directory: string;
  status: string;
  fees: string | null;
  applicationProcess: string | null;
  /** The service's own website. */
  serviceUrl: string | null;
  /** Emails of the service's own (service-wide) contacts. Never a person's name. */
  serviceEmails: string[];
  /** Eligibility text, as written. Shown when the row is not removed. */
  eligibility: string[];
  requiredDocuments: PublicRegistryDocument[];
  /** Accessibility of the service itself, not tied to a place. */
  accessibility: string[];
  /** The service's source, and the organization's when it differs. */
  sources: PublicRegistrySource[];
  organizationName: string;
  serviceName: string;
  description: string | null;
  /** The organization's main phones: shown as the organization's, not a place's. */
  organizationPhones: string[];
  /** The service's own phones, not tied to a place. */
  servicePhones: string[];
  /** The service's hours that are not tied to a place. */
  serviceHours: string[];
  locations: PublicRegistryLocation[];
  languages: string[];
  /**
   * The old "last verified" date, set by saves and publishes before Phase 3.
   * It is not a check. The page words it "Last updated", never "Verified".
   */
  lastVerifiedAt: WhenValue;
  /** The latest explicit verification an editor recorded; null when none. */
  verifiedAt: WhenValue;
  /** How that check was made (one of VERIFY_METHODS); null when none. */
  verifiedMethod: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  editorNote: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

export interface PublicRegistryCategory {
  id: number;
  name: string;
}

export interface PublicRegistryPage {
  entries: PublicRegistryEntry[];
  categories: PublicRegistryCategory[];
  /** True when at least one entry is published, in any category. */
  anyPublished: boolean;
}

/**
 * What the public page gets: the page, or `unavailable` when the database could
 * not be read. An unreadable registry is never reported as an empty one.
 */
export type PublicRegistryResult =
  ({ status: "ok" } & PublicRegistryPage) | { status: "unavailable" };

/** Join the address parts that are present, skipping empty ones. */
export function formatAddress(parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((part) => (part ?? "").trim()).filter(Boolean);
  return kept.length ? kept.join(", ") : null;
}

/**
 * One schedule in words: opening hours, or "By appointment" when the directory
 * says the service is arranged rather than open.
 */
export function formatHours(schedule: {
  by_appointment: boolean;
  days: string | null;
  opens_at: string | null;
  closes_at: string | null;
  notes: string | null;
}): string {
  if (schedule.by_appointment) return "By appointment";
  const times =
    schedule.opens_at && schedule.closes_at
      ? `${schedule.opens_at}–${schedule.closes_at}`
      : (schedule.opens_at ?? schedule.closes_at ?? "");
  const line = [schedule.days, times].filter(Boolean).join(", ");
  return [line, schedule.notes].filter(Boolean).join(". ");
}

/** The categories a published service is filed under, for the page's nav. */
export async function listPublicRegistryCategories(
  sql: Sql,
  newsroomId: number,
): Promise<PublicRegistryCategory[]> {
  const rows = await sql.query<{ id: number; name: string }>(
    `select distinct t.id, t.name
       from taxonomies t
       join services s
         on s.taxonomy_id = t.id and s.newsroom_id = t.newsroom_id
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where t.newsroom_id = $1
        and s.published = true and s.status = 'active'
        and o.published = true and o.status = 'active'
      order by t.name`,
    [newsroomId],
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

/** What a read narrows to. Every field is optional; null means "no filter". */
interface RegistryFilter {
  categoryId?: number | null;
  /** Search text, trimmed here; matched literally (no LIKE escapes). */
  q?: string | null;
  language?: string | null;
  serviceId?: number | null;
}

/** Escape `\`, `%` and `_` so user text is matched literally by ILIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/*
  The one rule for what is public: a published, active service under a
  published, active organization, in this newsroom. Every list and detail read
  goes through this, so a draft or an inactive row cannot appear by any route.
  Bound parameters only: the search text never joins the SQL string.
    $1 newsroom, $2 category, $3 ILIKE pattern, $4 language, $5 service id.
*/
const PUBLIC_FROM = `
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       left join taxonomies t
         on t.id = s.taxonomy_id and t.newsroom_id = s.newsroom_id
       left join sources src
         on src.id = coalesce(s.source_id, o.source_id) and src.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1
        and s.published = true and s.status = 'active'
        and o.published = true and o.status = 'active'
        and ($2::int is null or s.taxonomy_id = $2::int)
        and ($3::text is null
             or s.name ilike $3::text
             or o.name ilike $3::text
             or coalesce(s.description, '') ilike $3::text
             or coalesce(t.name, '') ilike $3::text)
        and ($4::text is null
             or exists (
               select 1 from languages lg
                where lg.service_id = s.id and lg.newsroom_id = s.newsroom_id
                  and lg.published = true and lg.removed_at is null
                  and lower(lg.language) = lower($4::text)))
        and ($5::int is null or s.id = $5::int)`;

function filterParams(newsroomId: number, filter: RegistryFilter) {
  const q = filter.q?.trim() ?? "";
  const language = filter.language?.trim() ?? "";
  return [
    newsroomId,
    filter.categoryId ?? null,
    q ? `%${escapeLike(q)}%` : null,
    language || null,
    filter.serviceId ?? null,
  ];
}

interface BaseRow {
  service_id: number;
  hsds_id: string;
  directory_name: string;
  service_name: string;
  service_description: string | null;
  service_note: string | null;
  service_status: string;
  fees: string | null;
  application_process: string | null;
  service_url: string | null;
  service_source_id: number | null;
  organization_source_id: number | null;
  organization_id: number;
  organization_name: string;
  organization_note: string | null;
  last_verified_at: WhenValue;
  source_url: string | null;
  source_title: string | null;
  category_id: number | null;
  category_name: string | null;
}

async function readBaseRows(
  sql: Sql,
  newsroomId: number,
  filter: RegistryFilter,
  paging: { limit: number; offset: number } | null,
): Promise<BaseRow[]> {
  return sql.query<BaseRow>(
    `select s.id as service_id, s.hsds_id, s.directory_name,
            s.name as service_name,
            s.description as service_description, s.editor_note as service_note,
            s.status as service_status, s.fees, s.application_process,
            s.url as service_url,
            s.source_id as service_source_id, o.source_id as organization_source_id,
            o.id as organization_id, o.name as organization_name,
            o.editor_note as organization_note,
            coalesce(s.last_verified_at, o.last_verified_at) as last_verified_at,
            src.url as source_url, src.title as source_title,
            t.id as category_id, t.name as category_name
       ${PUBLIC_FROM}
      order by t.name nulls last, o.name, s.name, s.id
      limit $6::int offset $7::int`,
    [...filterParams(newsroomId, filter), paging?.limit ?? null, paging?.offset ?? 0],
  );
}

async function anyPublishedService(sql: Sql, newsroomId: number): Promise<boolean> {
  const found = await sql.query<{ found: boolean }>(
    `select exists (
       select 1 from services s
         join organizations o
           on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
        where s.newsroom_id = $1
          and s.published = true and s.status = 'active'
          and o.published = true and o.status = 'active'
     ) as found`,
    [newsroomId],
  );
  return Boolean(found[0]?.found);
}

/**
 * The published services, with the organization and category each belongs to.
 *
 * `categoryId` narrows the list to one taxonomy. A category that matches
 * nothing returns an empty list rather than falling back to everything, so a
 * reader who follows a category link is never shown another category's rows.
 */
export async function listPublicRegistry(
  sql: Sql,
  newsroomId: number,
  categoryId: number | null = null,
): Promise<PublicRegistryPage> {
  const baseRows = await readBaseRows(sql, newsroomId, { categoryId }, null);
  const categories = await listPublicRegistryCategories(sql, newsroomId);
  if (baseRows.length === 0) {
    // With a category chosen, an empty list does not say whether anything is
    // published elsewhere; the page needs that to pick the right words.
    const anyPublished = categoryId != null ? await anyPublishedService(sql, newsroomId) : false;
    return { entries: [], categories, anyPublished };
  }
  return { entries: await buildEntries(sql, newsroomId, baseRows), categories, anyPublished: true };
}

export const PUBLIC_REGISTRY_PAGE_SIZE = 25;
/** The longest search text a caller may pass. */
export const PUBLIC_REGISTRY_MAX_Q = 200;

export interface PublicRegistrySearchInput {
  q?: string | null;
  categoryId?: number | null;
  language?: string | null;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface PublicRegistrySearchPage {
  entries: PublicRegistryEntry[];
  /** Every match, not just this page. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of the published services that match a search. Matching is
 * case-insensitive on the service name, organization name, description and
 * category name; `%` and `_` in the text are literal.
 */
export async function searchPublicRegistry(
  sql: Sql,
  newsroomId: number,
  input: PublicRegistrySearchInput,
): Promise<PublicRegistrySearchPage> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? PUBLIC_REGISTRY_PAGE_SIZE));
  const filter: RegistryFilter = {
    categoryId: input.categoryId ?? null,
    q: (input.q ?? "").slice(0, PUBLIC_REGISTRY_MAX_Q),
    language: input.language ?? null,
  };
  const counted = await sql.query<{ total: number | string }>(
    `select count(*) as total ${PUBLIC_FROM}`,
    filterParams(newsroomId, filter),
  );
  const total = Number(counted[0]?.total ?? 0);
  const baseRows = await readBaseRows(sql, newsroomId, filter, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const entries = baseRows.length ? await buildEntries(sql, newsroomId, baseRows) : [];
  return { entries, total, page, pageSize };
}

/** One published service by id, or null when it is unknown, unpublished or removed. */
export async function getPublicRegistryService(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
): Promise<PublicRegistryEntry | null> {
  const baseRows = await readBaseRows(sql, newsroomId, { serviceId }, null);
  if (baseRows.length === 0) return null;
  return (await buildEntries(sql, newsroomId, baseRows))[0] ?? null;
}

/** Turn the matched service rows into entries, reading what hangs off them. */
async function buildEntries(
  sql: Sql,
  newsroomId: number,
  baseRows: BaseRow[],
): Promise<PublicRegistryEntry[]> {
  const serviceIds = baseRows.map((row) => Number(row.service_id));
  const organizationIds = [...new Set(baseRows.map((row) => Number(row.organization_id)))];

  /*
    Child reads rather than one join: a service may have several locations,
    phones, schedules and languages, and joining them all at once multiplies
    rows and would duplicate the entry. Each read is bounded by the ids on the
    page, so this stays a handful of queries rather than one per entry.
  */
  const locations = await sql.query<{
    service_id: number;
    location_id: number;
    name: string | null;
    address_1: string | null;
    address_2: string | null;
    city: string | null;
    state_province: string | null;
    postal_code: string | null;
  }>(
    `select sal.service_id, l.id as location_id, l.name,
            l.address_1, l.address_2, l.city, l.state_province, l.postal_code
       from service_at_locations sal
       join locations l on l.id = sal.location_id and l.newsroom_id = sal.newsroom_id
      where sal.newsroom_id = $1 and sal.service_id = any($2::int[])
        and sal.published = true and sal.removed_at is null
        and l.published = true and l.status = 'active'
      order by sal.service_id, sal.id`,
    [newsroomId, serviceIds],
  );
  const locationIds = [...new Set(locations.map((row) => Number(row.location_id)))];

  const [contacts, schedules, languages, emails, eligibilities, documents, accessibilities] =
    await Promise.all([
      sql.query<{
        organization_id: number | null;
        service_id: number | null;
        location_id: number | null;
        phone: string;
      }>(
        `select organization_id, service_id, location_id, phone
         from contacts
        where newsroom_id = $1 and published = true and removed_at is null
          and phone is not null and phone <> ''
          and (service_id = any($2::int[])
               or (service_id is null and organization_id = any($3::int[]))
               or (service_id is null and location_id = any($4::int[])))
        order by id`,
        [newsroomId, serviceIds, organizationIds, locationIds],
      ),
      sql.query<{
        service_id: number;
        location_id: number | null;
        schedule_id: number;
        by_appointment: boolean;
        days: string | null;
        opens_at: string | null;
        closes_at: string | null;
        notes: string | null;
      }>(
        `select sc.service_id, sc.location_id, sc.id as schedule_id,
              sc.by_appointment, sc.days, sc.opens_at, sc.closes_at, sc.notes
         from schedules sc
        where sc.newsroom_id = $1 and sc.service_id = any($2::int[])
          and sc.published = true and sc.removed_at is null
        union all
       select sal.service_id, sal.location_id, sc.id as schedule_id,
              sc.by_appointment, sc.days, sc.opens_at, sc.closes_at, sc.notes
         from service_at_locations sal
         join schedules sc on sc.id = sal.schedule_id and sc.newsroom_id = sal.newsroom_id
        where sal.newsroom_id = $1 and sal.service_id = any($2::int[])
          and sal.published = true and sal.removed_at is null
          and sc.published = true and sc.removed_at is null
        order by service_id, days nulls last, opens_at nulls last, schedule_id`,
        [newsroomId, serviceIds],
      ),
      sql.query<{ service_id: number; language: string }>(
        `select service_id, language
         from languages
        where newsroom_id = $1 and service_id = any($2::int[])
          and published = true and removed_at is null
        order by id`,
        [newsroomId, serviceIds],
      ),
      // The service's own contacts' emails. The person's name is never read.
      sql.query<{ service_id: number; email: string }>(
        `select service_id, email
         from contacts
        where newsroom_id = $1 and service_id = any($2::int[]) and location_id is null
          and published = true and removed_at is null
          and email is not null and email <> ''
        order by id`,
        [newsroomId, serviceIds],
      ),
      // Eligibility, documents and accessibility show when the row is not
      // removed and its service is published (the services here all are). Their
      // own `published` flag is not set by Publish, so it is not part of the rule.
      sql.query<{ service_id: number; description: string | null }>(
        `select service_id, description
         from eligibilities
        where newsroom_id = $1 and service_id = any($2::int[]) and removed_at is null
          and description is not null and description <> ''
        order by id`,
        [newsroomId, serviceIds],
      ),
      sql.query<{
        service_id: number;
        document: string;
        description: string | null;
        required: boolean;
      }>(
        `select service_id, document, description, required
         from required_documents
        where newsroom_id = $1 and service_id = any($2::int[]) and removed_at is null
        order by id`,
        [newsroomId, serviceIds],
      ),
      sql.query<{
        service_id: number | null;
        location_id: number | null;
        accessibility: string;
        details: string | null;
      }>(
        `select service_id, location_id, accessibility, details
         from accessibilities
        where newsroom_id = $1 and removed_at is null
          and (service_id = any($2::int[])
               or (service_id is null and location_id = any($3::int[])))
        order by id`,
        [newsroomId, serviceIds, locationIds],
      ),
    ]);

  const pushUnique = <K>(map: Map<K, string[]>, key: K, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };

  // Phones are filed by what they belong to. A contact tied to a service that
  // is not on the page, or to a place the service is not linked to, is never
  // read here, so it cannot land under another entry.
  const serviceSet = new Set(serviceIds);
  const organizationPhones = new Map<number, string[]>();
  const servicePhones = new Map<number, string[]>();
  const servicePlacePhones = new Map<string, string[]>(); // `${service}:${location}`
  const placePhones = new Map<number, string[]>(); // a place's own line (no service)
  for (const row of contacts) {
    const phone = row.phone.trim();
    if (!phone) continue;
    const serviceId = row.service_id == null ? null : Number(row.service_id);
    const locationId = row.location_id == null ? null : Number(row.location_id);
    if (serviceId != null) {
      if (!serviceSet.has(serviceId)) continue;
      if (locationId == null) pushUnique(servicePhones, serviceId, phone);
      else pushUnique(servicePlacePhones, `${serviceId}:${locationId}`, phone);
    } else if (locationId != null) {
      pushUnique(placePhones, locationId, phone);
    } else if (row.organization_id != null) {
      pushUnique(organizationPhones, Number(row.organization_id), phone);
    }
  }

  // Hours: a schedule tied to a place stays with that place; one tied to the
  // service alone is service-wide. The query orders them by weekday / opening
  // time / id, so each list is stable. A schedule that a service's link to a
  // place also points to comes back twice, once service-wide and once through
  // the link. When the public sees that place (it is in `locations`), the
  // schedule belongs to the place, so the service-wide copy is dropped. When the
  // place is hidden (unpublished or inactive), the schedule is not shown under
  // it, so it stays service-wide.
  const shownPlaces = new Set<string>(); // `${service}:${location}`, as in `locations`
  for (const row of locations) {
    shownPlaces.add(`${Number(row.service_id)}:${Number(row.location_id)}`);
  }
  const placedSchedules = new Set<string>(); // `${service}:${schedule}` shown under a place
  for (const row of schedules) {
    const serviceId = Number(row.service_id);
    const locationId = row.location_id == null ? null : Number(row.location_id);
    if (locationId != null && shownPlaces.has(`${serviceId}:${locationId}`)) {
      placedSchedules.add(`${serviceId}:${Number(row.schedule_id)}`);
    }
  }
  const serviceHours = new Map<number, string[]>();
  const placeHours = new Map<string, string[]>(); // `${service}:${location}`
  for (const row of schedules) {
    const serviceId = Number(row.service_id);
    const locationId = row.location_id == null ? null : Number(row.location_id);
    const text = formatHours(row);
    if (!text) continue;
    if (locationId != null) {
      pushUnique(placeHours, `${serviceId}:${locationId}`, text);
    } else if (!placedSchedules.has(`${serviceId}:${Number(row.schedule_id)}`)) {
      pushUnique(serviceHours, serviceId, text);
    }
  }

  const accessText = (row: { accessibility: string; details: string | null }) =>
    [row.accessibility.trim(), row.details?.trim() ?? ""].filter(Boolean).join(": ");
  const serviceAccess = new Map<number, string[]>(); // the service, not tied to a place
  const serviceAtPlaceAccess = new Map<string, string[]>(); // `${service}:${location}`
  const placeAccess = new Map<number, string[]>(); // a place's own rows (no service)
  for (const row of accessibilities) {
    const text = accessText(row);
    if (!text) continue;
    const serviceId = row.service_id == null ? null : Number(row.service_id);
    const locationId = row.location_id == null ? null : Number(row.location_id);
    if (serviceId != null) {
      if (!serviceSet.has(serviceId)) continue;
      if (locationId == null) pushUnique(serviceAccess, serviceId, text);
      else pushUnique(serviceAtPlaceAccess, `${serviceId}:${locationId}`, text);
    } else if (locationId != null) {
      pushUnique(placeAccess, locationId, text);
    }
  }

  const locationsByService = new Map<number, PublicRegistryLocation[]>();
  for (const row of locations) {
    const serviceId = Number(row.service_id);
    const locationId = Number(row.location_id);
    const list = locationsByService.get(serviceId) ?? [];
    // A second link to the same place never makes a second card.
    if (list.some((item) => item.locationId === locationId)) continue;
    const key = `${serviceId}:${locationId}`;
    list.push({
      locationId,
      name: row.name?.trim() || null,
      address: formatAddress([
        row.address_1,
        row.address_2,
        row.city,
        row.state_province,
        row.postal_code,
      ]),
      phones: [
        ...new Set([
          ...(servicePlacePhones.get(key) ?? []),
          ...(placePhones.get(locationId) ?? []),
        ]),
      ],
      hours: placeHours.get(key) ?? [],
      accessibility: [
        ...new Set([
          ...(serviceAtPlaceAccess.get(key) ?? []),
          ...(placeAccess.get(locationId) ?? []),
        ]),
      ],
    });
    locationsByService.set(serviceId, list);
  }

  const languagesByService = new Map<number, string[]>();
  for (const row of languages) {
    const id = Number(row.service_id);
    languagesByService.set(id, [...(languagesByService.get(id) ?? []), row.language]);
  }

  // The latest explicit verification per service. The basis text is desk-only
  // and is not read here.
  const verifications = await sql.query<{
    service_id: number;
    checked_at: WhenValue;
    method: string;
  }>(
    `select distinct on (service_id) service_id, checked_at, method
       from resource_verifications
      where newsroom_id = $1 and service_id = any($2::int[])
      order by service_id, checked_at desc, id desc`,
    [newsroomId, serviceIds],
  );
  const verificationByService = new Map<number, { at: WhenValue; method: string }>();
  for (const row of verifications) {
    verificationByService.set(Number(row.service_id), { at: row.checked_at, method: row.method });
  }

  const emailsByService = new Map<number, string[]>();
  for (const row of emails) pushUnique(emailsByService, Number(row.service_id), row.email.trim());
  const eligibilityByService = new Map<number, string[]>();
  for (const row of eligibilities) {
    const text = row.description?.trim();
    if (text) pushUnique(eligibilityByService, Number(row.service_id), text);
  }
  const documentsByService = new Map<number, PublicRegistryDocument[]>();
  for (const row of documents) {
    const id = Number(row.service_id);
    documentsByService.set(id, [
      ...(documentsByService.get(id) ?? []),
      {
        document: row.document,
        description: row.description?.trim() || null,
        required: Boolean(row.required),
      },
    ]);
  }

  // Sources: the service's own, and the organization's when it is another one.
  const sourceIds = [
    ...new Set(
      baseRows
        .flatMap((row) => [row.service_source_id, row.organization_source_id])
        .filter((id): id is number => id != null),
    ),
  ];
  const sourceRows = sourceIds.length
    ? await sql.query<{ id: number; url: string; title: string }>(
        `select id, url, title from sources
          where newsroom_id = $1 and id = any($2::int[])`,
        [newsroomId, sourceIds],
      )
    : [];
  const sourceById = new Map(sourceRows.map((row) => [Number(row.id), row]));

  return baseRows.map((row): PublicRegistryEntry => {
    const serviceId = Number(row.service_id);
    const organizationId = Number(row.organization_id);
    const sources: PublicRegistrySource[] = [];
    const serviceSource =
      row.service_source_id == null ? undefined : sourceById.get(Number(row.service_source_id));
    if (serviceSource) {
      sources.push({ url: serviceSource.url, title: serviceSource.title, appliesTo: "service" });
    }
    const orgSource =
      row.organization_source_id == null
        ? undefined
        : sourceById.get(Number(row.organization_source_id));
    if (orgSource && orgSource.id !== serviceSource?.id) {
      sources.push({ url: orgSource.url, title: orgSource.title, appliesTo: "organization" });
    }
    return {
      serviceId,
      hsdsId: row.hsds_id,
      directory: row.directory_name,
      status: row.service_status,
      fees: row.fees?.trim() || null,
      applicationProcess: row.application_process?.trim() || null,
      serviceUrl: row.service_url?.trim() || null,
      serviceEmails: emailsByService.get(serviceId) ?? [],
      eligibility: eligibilityByService.get(serviceId) ?? [],
      requiredDocuments: documentsByService.get(serviceId) ?? [],
      accessibility: serviceAccess.get(serviceId) ?? [],
      sources,
      organizationName: row.organization_name,
      serviceName: row.service_name,
      description: row.service_description,
      organizationPhones: organizationPhones.get(organizationId) ?? [],
      servicePhones: servicePhones.get(serviceId) ?? [],
      serviceHours: serviceHours.get(serviceId) ?? [],
      locations: locationsByService.get(serviceId) ?? [],
      languages: languagesByService.get(serviceId) ?? [],
      lastVerifiedAt: row.last_verified_at,
      verifiedAt: verificationByService.get(serviceId)?.at ?? null,
      verifiedMethod: verificationByService.get(serviceId)?.method ?? null,
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      editorNote: row.service_note?.trim() || row.organization_note?.trim() || null,
      categoryId: row.category_id == null ? null : Number(row.category_id),
      categoryName: row.category_name,
    };
  });
}

/**
 * Read the public page through a getter for the database. Failing to get the
 * database, or to read from it, gives `unavailable`; the next call tries again.
 */
export async function readPublicRegistry(
  getSql: () => Promise<Sql>,
  newsroomId: number,
  categoryId: number | null,
): Promise<PublicRegistryResult> {
  try {
    const sql = await getSql();
    const page = await listPublicRegistry(sql, newsroomId, categoryId);
    return { status: "ok", ...page };
  } catch (err) {
    console.error("[registry] listPublicRegistry failed", err);
    return { status: "unavailable" };
  }
}

export type PublicRegistrySearchResult =
  | ({ status: "ok"; categories: PublicRegistryCategory[] } & PublicRegistrySearchPage)
  | { status: "unavailable" };

/** The search read, with the same "unavailable, never empty" rule as the page. */
export async function readPublicRegistrySearch(
  getSql: () => Promise<Sql>,
  newsroomId: number,
  input: PublicRegistrySearchInput,
): Promise<PublicRegistrySearchResult> {
  try {
    const sql = await getSql();
    const found = await searchPublicRegistry(sql, newsroomId, input);
    const categories = await listPublicRegistryCategories(sql, newsroomId);
    return { status: "ok", categories, ...found };
  } catch (err) {
    console.error("[registry] searchPublicRegistry failed", err);
    return { status: "unavailable" };
  }
}

export type PublicRegistryServiceResult =
  { status: "ok"; entry: PublicRegistryEntry | null } | { status: "unavailable" };

/** One service by id; `entry` is null when it is not listed. */
export async function readPublicRegistryService(
  getSql: () => Promise<Sql>,
  newsroomId: number,
  serviceId: number,
): Promise<PublicRegistryServiceResult> {
  try {
    const sql = await getSql();
    return { status: "ok", entry: await getPublicRegistryService(sql, newsroomId, serviceId) };
  } catch (err) {
    console.error("[registry] getPublicRegistryService failed", err);
    return { status: "unavailable" };
  }
}
