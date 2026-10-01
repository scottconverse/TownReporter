import { pendingMigrations as pendingFromPlan } from "../../scripts/migration-plan.mjs";
import { appliedMigrations, migrationFileNames } from "./db.ts";

/**
 * Is this database's schema current? (ENG-5, U18a-3.)
 *
 * `migrations/*.sql` is the single schema authority (see `src/lib/db.ts`), and
 * every applier -- `scripts/migrate.mjs` on deploy, the PGlite preview, the
 * logon task in `ops/` -- records what it applied in `_migrations`. What was
 * missing until this module is anything that *reads* that ledger back. Nothing
 * at runtime ever compared `_migrations` against `migrations/*.sql`: the
 * production Neon path (`createNeonSql`) opens a pool and does nothing else, so
 * a server started any way other than `installer/Start.ps1` (which migrates
 * first) or `ops/start-townreporter.ps1` (same) served a stale schema silently.
 * Column-not-found errors on an editor's first save is what that looks like
 * from the desk.
 *
 * `assertMigrationsCurrent()` is that read, and it is called from the TWO
 * server-boot places only -- `server/plugins/schema-warmup.ts` (starts it) and
 * `server/middleware/00-schema-current.ts` (awaits it, and refuses the request
 * when it fails). Deliberately NOT inside `getSql()`:
 * `dark-schema-rebuild.test.ts` drops and recreates a database underneath a
 * live pool on purpose, and every scratch database in this repo's own
 * integration tests is built by its own `create table` fixture rather than by
 * a migration replay. A guard on the query path would turn both into hard
 * failures and would be measuring the test harness, not the installation.
 *
 * The message names the missing files rather than counting them, because the
 * person reading it at 6am is deciding whether to run the migration or to
 * restore last night's backup, and "3 migrations pending" answers neither.
 */

/**
 * Migration names present in `names` but not in `applied`, in apply order.
 *
 * Names may be bare (`0111_story_documents_reading_key.sql`) or glob paths
 * (`/migrations/0111_story_documents_reading_key.sql`); they are keyed by
 * basename, which is exactly the key `_migrations` stores and the same rule
 * `scripts/migrate.mjs` applies. The comparison itself lives in
 * `scripts/migration-plan.mjs` -- the deploy applier and this guard must agree
 * on what "pending" means, so there is one implementation, not two.
 */
export function pendingMigrations(names: Iterable<string>, applied: Iterable<string>): string[] {
  return pendingFromPlan(names, applied).map((entry) => entry.name);
}

/**
 * The operator-facing message for a database behind `migrations/`: every
 * missing file by name, then the command that fixes it. Plain text on purpose
 * -- it is both thrown as an `Error` message and written to the log verbatim,
 * so nothing downstream has to reformat it.
 */
export function formatBehind(missing: readonly string[]): string {
  return [
    `[db] schema is BEHIND: ${missing.length} migration file(s) in migrations/ are not applied ` +
      `to this database:`,
    ...missing.map((name) => `  ${name}`),
    "Refusing to serve the desk on a half-migrated database.",
    "Apply them, then start the server again: npm run db:migrate",
    "(self-hosted: node scripts/with-app-env.mjs node scripts/migrate.mjs)",
  ].join("\n");
}

/** The migrations `migrations/` has and this database's ledger does not. */
export async function migrationsBehind(): Promise<string[]> {
  // Both reads are needed on the Neon path too: the names come from the build
  // (`migrationFileNames`, hoisted out of the PGlite-only opener for exactly
  // this), the applied set from `_migrations`.
  return pendingMigrations(migrationFileNames(), await appliedMigrations());
}

/**
 * Throw with {@link formatBehind} when this database is behind `migrations/`.
 * Resolves silently on an empty name list (a process with no bundler and no
 * test preload has nothing to compare -- see `migrationFileNames`).
 */
export async function assertMigrationsCurrent(): Promise<void> {
  const missing = await migrationsBehind();
  if (missing.length > 0) throw new Error(formatBehind(missing));
}

/**
 * Process-wide, memoized {@link assertMigrationsCurrent}, shared by the boot
 * plugin and the request-gating middleware so one boot checks the ledger once,
 * not once per request.
 *
 * A FAILED check is logged loudly ONCE and then forgotten, matching
 * `getSchemaWarmupPromise` and `getSql`: the next request re-runs it, so a
 * database that was merely unreachable for a moment at boot starts serving as
 * soon as it is reachable, and one that is genuinely behind keeps saying so.
 */
const globalRef = globalThis as typeof globalThis & {
  __migrationGuardPromise__?: Promise<void>;
};

export function getMigrationGuardPromise(): Promise<void> {
  globalRef.__migrationGuardPromise__ ??= assertMigrationsCurrent().catch((error: unknown) => {
    globalRef.__migrationGuardPromise__ = undefined;
    console.error(error instanceof Error ? error.message : String(error));
    throw error;
  });
  return globalRef.__migrationGuardPromise__;
}
