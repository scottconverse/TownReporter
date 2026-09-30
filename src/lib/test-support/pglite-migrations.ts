import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// NOTE: `../db.ts` is deliberately NOT imported here, not even for its types.
// Loading it stands up PGlite, and this module is loaded by every file in the
// `src/**` group -- see the cost note below.

/**
 * The test suite's schema source.
 *
 * `migrations/*.sql` is the only schema this repository has (see
 * `src/lib/db.ts`): the preview applies those files through a bundler
 * (`import.meta.glob`), and `scripts/migrate.mjs` applies them to Postgres on
 * every deploy and every boot. The ordinary unit suite had no such source --
 * under plain `node --test` there is no Vite transform, so `createPgliteSql`'s
 * glob throws, is caught, and applies nothing. Its schema was whatever the
 * runtime `ensure*Schema` helpers and each test file's own inline fixtures
 * happened to build, which is why 54 of the 109 migrated tables -- `leads`,
 * `articles`, `story_documents`, `draft_batches`, `owner_setup_code` -- did not
 * exist there at all.
 *
 * This module is imported as a preload by `scripts/run-tests-safe.mjs` before
 * every file in the `src/**` group. It reads the directory with `node:fs` --
 * the one thing a preload can do that a bundler macro cannot -- and REGISTERS
 * it on the global `src/lib/db.ts` reads first (`pgliteMigrationFiles`), so
 * the ordinary bundled preview and the test process take the same field of
 * `_migrations` through the same applier.
 *
 * It registers rather than applies, on purpose. Registration is free and
 * happens before any test file is loaded; APPLYING happens when a database is
 * actually opened, which most `src/**` files never do. Applying eagerly instead
 * would stand up PGlite in all ~367 of them: a process that has issued DDL does
 * not exit until PGlite's embedded Postgres lets go of its 10-second
 * `setitimer`, measured here at 11.3 s per file against 0.3 s without it, which
 * was +6 minutes on a shard that had taken 6. A test file that never touches
 * the database should not pay for one.
 *
 * A test file that declares its own `create table if not exists` fixture still
 * works: those are all `if not exists`, so they now no-op against the real
 * table instead of standing in for it. A fixture that inserted a row relying on
 * a column the real table makes `not null` is the case that breaks, and the
 * fix is in the fixture, never in the migration.
 */

/** The repo's `migrations/` directory, from this file's own location. */
export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

/**
 * Every `migrations/*.sql` as `path -> contents`, keyed the way the bundler
 * keys the glob so both sources are interchangeable to the applier. The read
 * is non-recursive -- `migrations/auth/*.sql` is an opt-in schema that no
 * applier descends into (see scripts/migration-plan.mjs).
 */
export function migrationFilesOnDisk(dir: string = MIGRATIONS_DIR): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => [`/migrations/${name}`, readFileSync(join(dir, name), "utf8")]),
  );
}

/**
 * Bring the process-wide test PGlite up to `migrations/*.sql` and return the
 * names applied. Idempotent: a file already in `_migrations` is skipped, so
 * calling this after the database has been opened applies nothing.
 *
 * A test file may call this, and several do. `scripts/run-tests-safe.mjs` is
 * not the only way this repository's `src/**` tests are run: the ordinary suite
 * runs them under PGlite with this preload, while
 * `scripts/run-postgres-integration.mjs` (the `postgres-integration` CI job)
 * runs 94 of the same files without it, so a fixture that expects a migrated
 * database has to be able to say so. Calling this is how it says so, and it is
 * the same `applyPendingMigrations` the bundled preview and every applier run:
 * on an already migrated database it does nothing, on a bare one it applies the
 * whole set.
 */
export async function applyMigrationsToTestPglite(): Promise<string[]> {
  const { applyPendingMigrations, getPglite } = await import("../db.ts");
  const pg = await getPglite();
  return applyPendingMigrations(pg, migrationFilesOnDisk());
}

// Preload entry point: registration, and nothing else. It must run BEFORE
// `../db.ts` is evaluated -- `db.ts` reads this the moment it loads, and the
// test file's own import of `db.ts` comes after this module has finished.
(globalThis as typeof globalThis & { __pgliteMigrationFiles__?: Record<string, string> })[
  "__pgliteMigrationFiles__"
] = migrationFilesOnDisk();
