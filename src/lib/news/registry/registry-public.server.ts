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
 * "Last verified" is `last_verified_at`, the service's own where it has one and
 * the organization's otherwise. It is never inferred from an import date.
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
}

export interface PublicRegistryEntry {
  serviceId: number;
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
  lastVerifiedAt: WhenValue;
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
  | ({ status: "ok" } & PublicRegistryPage)
  | { status: "unavailable" };

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
  const baseRows = await sql.query<{
    service_id: number;
    service_name: string;
    service_description: string | null;
    service_note: string | null;
    organization_id: number;
    organization_name: string;
    organization_note: string | null;
    last_verified_at: WhenValue;
    source_url: string | null;
    source_title: string | null;
    category_id: number | null;
    category_name: string | null;
  }>(
    `select s.id as service_id, s.name as service_name,
            s.description as service_description, s.editor_note as service_note,
            o.id as organization_id, o.name as organization_name,
            o.editor_note as organization_note,
            coalesce(s.last_verified_at, o.last_verified_at) as last_verified_at,
            src.url as source_url, src.title as source_title,
            t.id as category_id, t.name as category_name
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
      order by t.name nulls last, o.name, s.name`,
    [newsroomId, categoryId],
  );

  const categories = await listPublicRegistryCategories(sql, newsroomId);
  if (baseRows.length === 0) {
    // With a category chosen, an empty list does not say whether anything is
    // published elsewhere; the page needs that to pick the right words.
    let anyPublished = false;
    if (categoryId != null) {
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
      anyPublished = Boolean(found[0]?.found);
    }
    return { entries: [], categories, anyPublished };
  }

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

  const [contacts, schedules, languages] = await Promise.all([
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
        ...new Set([...(servicePlacePhones.get(key) ?? []), ...(placePhones.get(locationId) ?? [])]),
      ],
      hours: placeHours.get(key) ?? [],
    });
    locationsByService.set(serviceId, list);
  }

  const languagesByService = new Map<number, string[]>();
  for (const row of languages) {
    const id = Number(row.service_id);
    languagesByService.set(id, [...(languagesByService.get(id) ?? []), row.language]);
  }

  const entries: PublicRegistryEntry[] = baseRows.map((row) => {
    const serviceId = Number(row.service_id);
    const organizationId = Number(row.organization_id);
    return {
      serviceId,
      organizationName: row.organization_name,
      serviceName: row.service_name,
      description: row.service_description,
      organizationPhones: organizationPhones.get(organizationId) ?? [],
      servicePhones: servicePhones.get(serviceId) ?? [],
      serviceHours: serviceHours.get(serviceId) ?? [],
      locations: locationsByService.get(serviceId) ?? [],
      languages: languagesByService.get(serviceId) ?? [],
      lastVerifiedAt: row.last_verified_at,
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      editorNote: row.service_note?.trim() || row.organization_note?.trim() || null,
      categoryId: row.category_id == null ? null : Number(row.category_id),
      categoryName: row.category_name,
    };
  });

  return { entries, categories, anyPublished: true };
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
