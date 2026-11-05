/**
 * The public Registry page's read (spec 15.1, 18.2 and 24, Phase 1).
 *
 * What a reader may see is deliberately narrow:
 *
 *  - only services with `published = true` and `status = 'active'`, under an
 *    organization that is also published and active. An imported row starts
 *    unpublished (15.1) and stays out of public view until an editor confirms
 *    it, and Phase 1 has no confirm button, so today this list is empty;
 *  - every entry names the source it came from, and its last verified date
 *    when it has one (spec 11: change detection is not verification, and the
 *    public copy never claims a phone was called or a program is open);
 *  - an editor note is shown when an editor wrote one.
 *
 * "Last verified" is `last_verified_at`, the service's own where it has one and
 * the organization's otherwise. It is never inferred from an import date.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../../db.ts";
import { DEFAULT_NEWSROOM_ID } from "../membership.ts";
import type { WhenValue } from "./registry-desk.server.ts";

export interface PublicRegistryEntry {
  serviceId: number;
  organizationName: string;
  serviceName: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
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
}

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
  if (baseRows.length === 0) return { entries: [], categories };

  const serviceIds = baseRows.map((row) => Number(row.service_id));
  const organizationIds = [...new Set(baseRows.map((row) => Number(row.organization_id)))];

  /*
    Four child reads rather than a join: a service may have several locations,
    phones, schedules and languages, and joining them all at once multiplies
    rows and would duplicate the entry. Each read is bounded by the ids on the
    page, so this stays a handful of queries rather than one per entry.
  */
  const [locations, servicePhones, organizationPhones, schedules, languages] = await Promise.all([
    sql.query<{
      service_id: number;
      name: string | null;
      address_1: string | null;
      address_2: string | null;
      city: string | null;
      state_province: string | null;
      postal_code: string | null;
    }>(
      `select sal.service_id, l.name, l.address_1, l.address_2,
              l.city, l.state_province, l.postal_code
         from service_at_locations sal
         join locations l on l.id = sal.location_id and l.newsroom_id = sal.newsroom_id
        where sal.newsroom_id = $1 and sal.service_id = any($2::int[])
          and sal.published = true and l.published = true
        order by sal.id`,
      [newsroomId, serviceIds],
    ),
    sql.query<{ service_id: number; phone: string }>(
      `select service_id, phone
         from contacts
        where newsroom_id = $1 and service_id = any($2::int[])
          and published = true
          and phone is not null and phone <> ''
        order by id`,
      [newsroomId, serviceIds],
    ),
    sql.query<{ organization_id: number; phone: string }>(
      `select organization_id, phone
         from contacts
        where newsroom_id = $1 and service_id is null
          and organization_id = any($2::int[])
          and published = true
          and phone is not null and phone <> ''
        order by id`,
      [newsroomId, organizationIds],
    ),
    sql.query<{
      service_id: number;
      by_appointment: boolean;
      days: string | null;
      opens_at: string | null;
      closes_at: string | null;
      notes: string | null;
    }>(
      `select sc.service_id, sc.by_appointment, sc.days, sc.opens_at, sc.closes_at, sc.notes
         from schedules sc
        where sc.newsroom_id = $1 and sc.service_id = any($2::int[])
          and sc.published = true
        union
       select sal.service_id, sc.by_appointment, sc.days, sc.opens_at, sc.closes_at, sc.notes
         from service_at_locations sal
         join schedules sc on sc.id = sal.schedule_id and sc.newsroom_id = sal.newsroom_id
        where sal.newsroom_id = $1 and sal.service_id = any($2::int[])
          and sal.published = true and sc.published = true
        order by service_id`,
      [newsroomId, serviceIds],
    ),
    sql.query<{ service_id: number; language: string }>(
      `select service_id, language
         from languages
        where newsroom_id = $1 and service_id = any($2::int[])
          and published = true
        order by id`,
      [newsroomId, serviceIds],
    ),
  ]);

  const firstBy = <T>(rows: T[], key: (row: T) => number) => {
    const map = new Map<number, T>();
    for (const row of rows) {
      const id = key(row);
      if (!map.has(id)) map.set(id, row);
    }
    return map;
  };
  const locationByService = firstBy(locations, (row) => Number(row.service_id));
  const servicePhoneByService = firstBy(servicePhones, (row) => Number(row.service_id));
  const phoneByOrganization = firstBy(organizationPhones, (row) => Number(row.organization_id));
  const scheduleByService = firstBy(schedules, (row) => Number(row.service_id));
  const languagesByService = new Map<number, string[]>();
  for (const row of languages) {
    const id = Number(row.service_id);
    languagesByService.set(id, [...(languagesByService.get(id) ?? []), row.language]);
  }

  const entries = baseRows.map((row) => {
    const serviceId = Number(row.service_id);
    const organizationId = Number(row.organization_id);
    const location = locationByService.get(serviceId);
    const phone =
      servicePhoneByService.get(serviceId)?.phone ??
      phoneByOrganization.get(organizationId)?.phone ??
      null;
    const schedule = scheduleByService.get(serviceId);
    return {
      serviceId,
      organizationName: row.organization_name,
      serviceName: row.service_name,
      description: row.service_description,
      address: location
        ? formatAddress([
            location.address_1,
            location.address_2,
            location.city,
            location.state_province,
            location.postal_code,
          ])
        : null,
      phone: phone ?? null,
      hours: schedule ? formatHours(schedule) : null,
      languages: languagesByService.get(serviceId) ?? [],
      lastVerifiedAt: row.last_verified_at,
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      editorNote: row.service_note?.trim() || row.organization_note?.trim() || null,
      categoryId: row.category_id == null ? null : Number(row.category_id),
      categoryName: row.category_name,
    };
  });

  return { entries, categories };
}

/** The page's one read. Public: no middleware, and no desk data in it. */
export const listPublicRegistryPage = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const category = Number((input as { category?: unknown } | null)?.category);
    return {
      category: Number.isInteger(category) && category > 0 ? category : null,
    };
  })
  .handler(async ({ data }): Promise<PublicRegistryPage> => {
    try {
      const sql = await getSql();
      return await listPublicRegistry(sql, DEFAULT_NEWSROOM_ID, data.category);
    } catch (err) {
      // A registry that cannot be read is an empty registry, not a broken
      // page: the reader gets the honest empty state rather than a 500.
      console.error("[registry] listPublicRegistry failed", err);
      return { entries: [], categories: [] };
    }
  });
