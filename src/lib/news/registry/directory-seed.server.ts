/**
 * The shipped Longmont directory seed (Scott, Nov 20 2026, part 5).
 *
 * Another worker produces `__fixtures__/longmont-directory-2026-11.json` on
 * the `data/longmont-registry-list` branch. When that file is present, newsroom
 * setup imports it through the same HSDS importer an editor's upload uses, then
 * publishes its services, so a fresh newsroom starts with the directory rather
 * than an empty registry.
 *
 * When the file is absent this does nothing at all -- it is not an error, and
 * no placeholder is invented here.
 *
 * Idempotent: the importer keys rows on (newsroom, directory, HSDS id) and
 * writes nothing on a second run; the publish step only touches services still
 * unpublished, so running it twice adds no row and writes no duplicate audit
 * event.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withTransaction, type Sql } from "../../db.ts";
import { publishRegistryEntryTx } from "./registry-desk-write.server.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
import { parseHsdsJson } from "./hsds-validate.ts";

/** The directory name every row from the shipped seed is keyed on. */
export const LONGMONT_DIRECTORY_SEED_NAME = "Longmont community directory 2026-11";

/** The provenance URL stored on the import; not a fetchable page. */
export const LONGMONT_DIRECTORY_SEED_SOURCE_URL = "hsds://longmont-directory-2026-11";

/** Where the other worker's file lands. */
const SEED_FILE_URL = new URL("./__fixtures__/longmont-directory-2026-11.json", import.meta.url);

export interface DirectorySeedResult {
  /** False when the file is not present; nothing was read or written. */
  present: boolean;
  /** Rows the import inserted (0 on a second run). */
  inserted: number;
  /** Services this call published (0 on a second run). */
  published: number;
  /** Problems when the file is present but not a valid HSDS bundle. */
  problems: string[];
}

/** The seed file's text, or null when it is not there. */
export function readLongmontDirectorySeed(): string | null {
  try {
    return readFileSync(fileURLToPath(SEED_FILE_URL), "utf8");
  } catch {
    return null;
  }
}

/**
 * Import and publish the shipped directory, once.
 *
 * `json` overrides the file read; it exists so a test can drive the loader
 * with the repo's own sample bundle without creating the real seed file.
 */
export async function importRegistryDirectorySeedIn(
  sql: Sql,
  newsroomId: number,
  userId: string,
  json?: string | null,
): Promise<DirectorySeedResult> {
  const text = json === undefined ? readLongmontDirectorySeed() : json;
  if (text === null) return { present: false, inserted: 0, published: 0, problems: [] };

  const parsed = parseHsdsJson(text);
  if (!parsed.ok) return { present: true, inserted: 0, published: 0, problems: parsed.problems };

  return withTransaction(async (tx) => {
    /*
      The desk calls this on many requests. If another request is loading the
      list now, this one returns at once instead of holding a database
      connection while it waits. Same key as the importer's own lock.
    */
    const lock = await tx.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock($1, hashtext($2)) as locked",
      [newsroomId, LONGMONT_DIRECTORY_SEED_NAME],
    );
    if (!lock[0]?.locked) return { present: true, inserted: 0, published: 0, problems: [] };

    /*
      "Once": if the directory is already loaded, do not parse and re-import it
      on every newsroom setup. The importer would write nothing anyway; this
      just avoids the work.
    */
    const loaded = await tx.query<{ count: string }>(
      `select count(*)::text as count from services
        where newsroom_id = $1 and directory_name = $2`,
      [newsroomId, LONGMONT_DIRECTORY_SEED_NAME],
    );
    if (Number(loaded[0]?.count ?? 0) > 0) {
      return { present: true, inserted: 0, published: 0, problems: [] };
    }

    const result = await importHsdsBundle(parsed.bundle, {
      newsroomId,
      directoryName: LONGMONT_DIRECTORY_SEED_NAME,
      sourceUrl: LONGMONT_DIRECTORY_SEED_SOURCE_URL,
      userId,
      tx,
    });

    const unpublished = await tx.query<{ id: number; name: string }>(
      `select id, name from services
        where newsroom_id = $1 and directory_name = $2 and published = false
        order by id`,
      [newsroomId, LONGMONT_DIRECTORY_SEED_NAME],
    );
    for (const service of unpublished) {
      const serviceId = Number(service.id);
      await publishRegistryEntryTx(tx, newsroomId, serviceId, userId, {
        action: "registry.service.autopublish",
        detail: `Published "${service.name}" from the shipped Longmont directory seed.`,
      });
    }
    const inserted = Object.values(result.tables).reduce((sum, counts) => sum + counts.inserted, 0);
    return { present: true, inserted, published: unpublished.length, problems: [] };
  });
}

/** The newsroom-setup entry point; does nothing when the file is absent. */
export async function ensureRegistryDirectorySeed(
  sql: Sql,
  newsroomId: number,
  userId: string,
): Promise<DirectorySeedResult> {
  return importRegistryDirectorySeedIn(sql, newsroomId, userId);
}
