/**
 * The two writes the registry desk has in Phase 1 (spec 24): load the starter
 * list, and publish one entry.
 *
 * Both run in one transaction through `withTransaction`, so a failure halfway
 * writes nothing. Neither publishes anything by loading: every row an import
 * writes starts unpublished and unverified (spec 15.1), and only
 * `publishRegistryEntryIn` sets `published`.
 *
 * The caller passes the `Sql` so a test can drive these against PGlite and the
 * server function can drive them against the live desk.
 */

import { withTransaction, type Sql } from "../../db.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
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
async function ensureEntrySource(
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
