/**
 * The writes the registry desk has (spec 24, Phase 1): load the starter list,
 * publish one entry, and the editor's own upkeep of the list -- edit an entry,
 * add one, take a published one back down.
 *
 * Every write runs in one transaction through `withTransaction`, so a failure
 * halfway writes nothing. None of them publishes anything by accident: every
 * row an import or an add writes starts unpublished and unverified (spec 15.1),
 * and only `publishRegistryEntryIn` sets `published`.
 *
 * The caller passes the `Sql` so a test can drive these against PGlite and the
 * server function can drive them against the live desk.
 */

import { withTransaction, type Sql } from "../../db.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
import {
  DESK_DIRECTORY,
  deskSlug,
  normalizeRegistryEntryFields,
  type RegistryEntryFields,
} from "./registry-entry-fields.ts";
import {
  STARTER_ENTRIES,
  STARTER_LIST_DIRECTORY,
  STARTER_LIST_SOURCE_URL,
  starterBundle,
  starterOrganizationId,
  starterServiceId,
} from "./starter-list.ts";

export interface LoadStarterListResult {
  /** How many entries the list holds. */
  entries: number;
  /** How many of them are still waiting to be published. */
  waiting: number;
}

/**
 * Find the source row for one entry's own page, creating it the way the
 * importer creates its bundle source. Keyed on the newsroom and the URL: a
 * source belongs to a newsroom, and two entries never share a page.
 */
export async function ensureEntrySource(
  sql: Sql,
  newsroomId: number,
  userId: string,
  entry: { sourceUrl: string; sourceTitle: string },
): Promise<number> {
  const existing = await sql.query<{ id: number }>(
    `select id from sources
      where newsroom_id = $1 and url = $2
      order by id
      limit 1`,
    [newsroomId, entry.sourceUrl],
  );
  if (existing[0]) return Number(existing[0].id);
  const inserted = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier)
     values ($1, $2, $3, $4, 'official', 'B')
     returning id`,
    [userId, newsroomId, entry.sourceUrl, entry.sourceTitle],
  );
  return Number(inserted[0]!.id);
}

/**
 * Import the approved starter list, then point each entry at its own page.
 *
 * The import itself is idempotent on (newsroom, directory, hsds id), so a
 * second press updates the same rows and adds no service or organization. The
 * bundle's own source (`hsds://…`) is only the provenance of the file; every
 * published entry must name the page an editor read, which is why each one's
 * service and organization are repointed here.
 */
export async function loadStarterListIn(
  sql: Sql,
  newsroomId: number,
  userId: string,
): Promise<LoadStarterListResult> {
  return withTransaction(async (tx) => {
    await importHsdsBundle(starterBundle(), {
      newsroomId,
      directoryName: STARTER_LIST_DIRECTORY,
      sourceUrl: STARTER_LIST_SOURCE_URL,
      userId,
      tx,
    });

    for (const entry of STARTER_ENTRIES) {
      const sourceId = await ensureEntrySource(tx, newsroomId, userId, entry);
      await tx.query(
        `update services
            set source_id = $1, updated_at = now()
          where newsroom_id = $2 and directory_name = $3 and hsds_id = $4`,
        [sourceId, newsroomId, STARTER_LIST_DIRECTORY, starterServiceId(entry.key)],
      );
      await tx.query(
        `update organizations
            set source_id = $1, updated_at = now()
          where newsroom_id = $2 and directory_name = $3 and hsds_id = $4`,
        [sourceId, newsroomId, STARTER_LIST_DIRECTORY, starterOrganizationId(entry.key)],
      );
    }

    const waiting = await tx.query<{ count: string }>(
      `select count(*)::text as count
         from services
        where newsroom_id = $1
          and directory_name = $2
          and hsds_id = any($3::text[])
          and published = false`,
      [
        newsroomId,
        STARTER_LIST_DIRECTORY,
        STARTER_ENTRIES.map((entry) => starterServiceId(entry.key)),
      ],
    );

    return { entries: STARTER_ENTRIES.length, waiting: Number(waiting[0]!.count) };
  });
}

export interface PublishRegistryEntryResult {
  serviceId: number;
}

/**
 * Publish one service and everything a reader needs beside it.
 *
 * The service is published and marked active when it was unverified, with the
 * editor's id and the time as its verification. Its organization is published
 * unless it already was. The service's contacts, languages, schedules and
 * service-at-location rows are published, and the locations those rows point
 * to become active when unverified.
 *
 * A service id from another newsroom, or one that does not exist, throws and
 * the transaction rolls back: nothing is changed.
 */
export async function publishRegistryEntryIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  userId: string,
): Promise<PublishRegistryEntryResult> {
  return withTransaction(async (tx) => {
    const found = await tx.query<{ id: number; organization_id: number }>(
      `select id, organization_id from services
        where id = $1 and newsroom_id = $2`,
      [serviceId, newsroomId],
    );
    if (!found[0]) {
      throw new Error("That entry is not in this newsroom. Nothing was changed.");
    }
    // `id` is a bigint on the live driver; the SQL below matches on text-free
    // integers, so normalize what was read back.
    const id = Number(found[0].id);
    const organizationId = Number(found[0].organization_id);

    await tx.query(
      `update services
          set published = true,
              status = case when status = 'unverified' then 'active' else status end,
              last_verified_at = now(),
              verification_method = 'editor',
              last_verified_by = $1,
              updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [userId, id, newsroomId],
    );

    // An organization that is already published is left exactly as it is.
    await tx.query(
      `update organizations
          set published = true,
              status = case when status = 'unverified' then 'active' else status end,
              updated_at = now()
        where id = $1 and newsroom_id = $2 and published = false`,
      [organizationId, newsroomId],
    );

    for (const table of ["contacts", "languages", "schedules", "service_at_locations"]) {
      await tx.query(
        `update ${table}
            set published = true, updated_at = now()
          where newsroom_id = $1 and service_id = $2`,
        [newsroomId, id],
      );
    }

    await tx.query(
      `update locations
          set published = true,
              status = case when status = 'unverified' then 'active' else status end,
              updated_at = now()
        where newsroom_id = $1
          and id in (
            select location_id from service_at_locations
             where newsroom_id = $1 and service_id = $2
          )`,
      [newsroomId, id],
    );

    return { serviceId: id };
  });
}

/**
 * The taxonomy row for a category name, creating it when the newsroom has no
 * row with that name.
 *
 * The match is case-insensitive and trimmed, so "food" reuses the row the
 * starter list created as "Food" and does not file the same category twice. A
 * new name becomes a published `TownReporter desk` taxonomy so a reader's
 * category link can reach the entry straight away; the HSDS id is derived from
 * the name, and a second row with the same slug updates that one instead of
 * failing the whole save.
 */
async function ensureDeskTaxonomy(
  sql: Sql,
  newsroomId: number,
  name: string,
): Promise<number> {
  const existing = await sql.query<{ id: number }>(
    `select id from taxonomies
      where newsroom_id = $1 and lower(name) = lower($2)
      order by id
      limit 1`,
    [newsroomId, name],
  );
  if (existing[0]) return Number(existing[0].id);

  const inserted = await sql.query<{ id: number }>(
    `insert into taxonomies (newsroom_id, hsds_id, directory_name, name, published)
     values ($1, $2, $3, $4, true)
     on conflict (newsroom_id, directory_name, hsds_id)
     do update set name = excluded.name, published = true, updated_at = now()
     returning id`,
    [newsroomId, `desk-tax-${deskSlug(name)}`, DESK_DIRECTORY, name],
  );
  return Number(inserted[0]!.id);
}

/**
 * Put the phone on the service's first contact row, creating that row when the
 * service has none and a phone was given.
 *
 * A contact is never deleted. Clearing the phone leaves the row in place with
 * no number, so anything else the row carries (a name, an email) survives. A
 * row created here takes the service's own `published`, so a phone added to a
 * published entry shows to readers and a phone added to a waiting one does not
 * show until the editor publishes the entry.
 */
async function saveServicePhone(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  phone: string,
  published: boolean,
  userId: string,
): Promise<void> {
  const existing = await sql.query<{ id: number }>(
    `select id from contacts
      where newsroom_id = $1 and service_id = $2
      order by id
      limit 1`,
    [newsroomId, serviceId],
  );
  if (existing[0]) {
    await sql.query(
      `update contacts
          set phone = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [phone || null, Number(existing[0].id), newsroomId],
    );
    return;
  }
  if (!phone) return;
  await sql.query(
    `insert into contacts
       (newsroom_id, hsds_id, directory_name, service_id, phone, published,
        last_verified_at, verification_method, last_verified_by)
     values ($1, $2, $3, $4, $5, $6, now(), 'editor', $7)`,
    [newsroomId, `desk-contact-${serviceId}`, DESK_DIRECTORY, serviceId, phone, published, userId],
  );
}

export interface UpdateRegistryEntryResult {
  serviceId: number;
}

/**
 * Save an editor's changes to one entry, waiting or published.
 *
 * The service's name, description, category and source are written, and the
 * name of the organization it belongs to. `published` is not touched: a
 * published entry stays published, and a waiting one stays waiting until the
 * editor presses Publish. The service is stamped as verified by this editor at
 * this moment, because an editor who read the page and saved is the source of
 * the values now stored.
 *
 * A service id from another newsroom, or one that does not exist, throws and
 * the transaction rolls back: nothing is changed.
 */
export async function updateRegistryEntryIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  input: RegistryEntryFields,
  userId: string,
): Promise<UpdateRegistryEntryResult> {
  // Normalised here as well as at the server function: the name match below is
  // case-insensitive but not space-insensitive, and a caller that forgot to trim
  // would quietly create a second organization or category.
  const fields = normalizeRegistryEntryFields(input);
  return withTransaction(async (tx) => {
    const found = await tx.query<{
      id: number;
      organization_id: number;
      published: boolean;
    }>(
      `select id, organization_id, published from services
        where id = $1 and newsroom_id = $2`,
      [serviceId, newsroomId],
    );
    if (!found[0]) {
      throw new Error("That entry is not in this newsroom. Nothing was changed.");
    }
    const id = Number(found[0].id);
    const organizationId = Number(found[0].organization_id);
    const published = found[0].published;

    const taxonomyId = await ensureDeskTaxonomy(tx, newsroomId, fields.categoryName);
    const sourceId = await ensureEntrySource(tx, newsroomId, userId, fields);
    // The source row is shared by every entry that cites the same page, so its
    // title is only rewritten when the editor actually gave one. An empty box
    // leaves whatever title the row already carries.
    if (fields.sourceTitle) {
      await tx.query(
        "update sources set title = $1 where id = $2 and newsroom_id = $3",
        [fields.sourceTitle, sourceId, newsroomId],
      );
    }

    await tx.query(
      `update services
          set name = $1,
              description = $2,
              taxonomy_id = $3,
              source_id = $4,
              last_verified_at = now(),
              verification_method = 'editor',
              last_verified_by = $5,
              updated_at = now()
        where id = $6 and newsroom_id = $7`,
      [
        fields.serviceName,
        fields.description || null,
        taxonomyId,
        sourceId,
        userId,
        id,
        newsroomId,
      ],
    );

    await tx.query(
      `update organizations
          set name = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [fields.organizationName, organizationId, newsroomId],
    );

    await saveServicePhone(tx, newsroomId, id, fields.phone, published, userId);

    return { serviceId: id };
  });
}

export interface AddRegistryEntryResult {
  serviceId: number;
}

/**
 * Add one entry to the newsroom's registry, waiting to be published.
 *
 * The organization is the newsroom's row with that name when one exists --
 * trimmed and matched without case, so "our center" joins "OUR Center" rather
 * than making a second one -- and otherwise a new unpublished row. The service
 * is always new and starts unpublished, unverified and stamped as the editor's
 * own reading, so it lands in the waiting list and nowhere a reader can see it
 * until the editor presses Publish.
 */
export async function addRegistryEntryIn(
  sql: Sql,
  newsroomId: number,
  input: RegistryEntryFields,
  userId: string,
): Promise<AddRegistryEntryResult> {
  const fields = normalizeRegistryEntryFields(input);
  return withTransaction(async (tx) => {
    const taxonomyId = await ensureDeskTaxonomy(tx, newsroomId, fields.categoryName);
    const sourceId = await ensureEntrySource(tx, newsroomId, userId, fields);
    if (fields.sourceTitle) {
      await tx.query(
        "update sources set title = $1 where id = $2 and newsroom_id = $3",
        [fields.sourceTitle, sourceId, newsroomId],
      );
    }

    const suffix = Math.random().toString(36).slice(2, 8);

    const existingOrganization = await tx.query<{ id: number }>(
      `select id from organizations
        where newsroom_id = $1 and lower(name) = lower($2)
        order by id
        limit 1`,
      [newsroomId, fields.organizationName],
    );
    let organizationId: number;
    if (existingOrganization[0]) {
      organizationId = Number(existingOrganization[0].id);
    } else {
      const organization = await tx.query<{ id: number }>(
        `insert into organizations
           (newsroom_id, hsds_id, directory_name, user_id, name, status, published, source_id)
         values ($1, $2, $3, $4, $5, 'unverified', false, $6)
         returning id`,
        [
          newsroomId,
          `desk-org-${deskSlug(fields.organizationName)}-${suffix}`,
          DESK_DIRECTORY,
          userId,
          fields.organizationName,
          sourceId,
        ],
      );
      organizationId = Number(organization[0]!.id);
    }

    const service = await tx.query<{ id: number }>(
      `insert into services
         (newsroom_id, hsds_id, directory_name, organization_id, name, description,
          status, taxonomy_id, published, source_id, last_verified_at,
          verification_method, last_verified_by)
       values ($1, $2, $3, $4, $5, $6, 'unverified', $7, false, $8, now(), 'editor', $9)
       returning id`,
      [
        newsroomId,
        `desk-svc-${deskSlug(fields.serviceName)}-${suffix}`,
        DESK_DIRECTORY,
        organizationId,
        fields.serviceName,
        fields.description || null,
        taxonomyId,
        sourceId,
        userId,
      ],
    );
    const serviceId = Number(service[0]!.id);

    await saveServicePhone(tx, newsroomId, serviceId, fields.phone, false, userId);

    return { serviceId };
  });
}

export interface TakeDownRegistryEntryResult {
  serviceId: number;
}

/**
 * Take one published entry back off the public page.
 *
 * Only the service's `published` is cleared. Its organization is left exactly
 * as it was, because other services may hang off it, and no row is deleted:
 * the entry returns to the waiting list, where the existing Publish button
 * brings it back.
 *
 * The editor's id is accepted for the same shape as the desk's other writes,
 * but it is not recorded: taking an entry down asserts nothing about the facts
 * in it, so it must not look like a verification.
 */
export async function takeDownRegistryEntryIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  _userId: string,
): Promise<TakeDownRegistryEntryResult> {
  return withTransaction(async (tx) => {
    const found = await tx.query<{ id: number }>(
      "select id from services where id = $1 and newsroom_id = $2",
      [serviceId, newsroomId],
    );
    if (!found[0]) {
      throw new Error("That entry is not in this newsroom. Nothing was changed.");
    }
    const id = Number(found[0].id);

    await tx.query(
      `update services
          set published = false, updated_at = now()
        where id = $1 and newsroom_id = $2`,
      [id, newsroomId],
    );

    return { serviceId: id };
  });
}
