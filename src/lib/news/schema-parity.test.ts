import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  withDatabase,
} from "../test-support/pg-admin.ts";

/**
 * GauntletGate ENG-03: migration/ensure drift runs in both directions, and
 * only 4 of 10 `ensure*` functions had a parity test before this one. This
 * is the generalised test the finding asked for -- it builds one database
 * from `migrations/*.sql` alone (`scripts/migrate.mjs`, the deploy path) and
 * a second from the hand-mirrored runtime `ensure*` functions alone (the
 * path a plain `node --test` run and a rebuilt PGLite instance actually take
 * -- see `src/lib/db.ts`'s `createPgliteSql`, whose migration glob throws
 * under Node and falls back to nothing but these functions), then diffs the
 * column set of every table the ensure side creates against the same table
 * in the migrations side.
 *
 * A table that ONLY migrations define (never mirrored by any `ensure*`
 * function -- `leads`, `drafts`, `snapshots`, `sources`, `scan_runs`,
 * `articles`, `beat_memory`, `corrections`: see the allowlist below) is not
 * a drift case. There is nothing to compare: those tables are reached only
 * through a real migration replay (Vite's PGLite glob, or `db:migrate`
 * against Postgres), never through hand-mirrored DDL, so their "runtime"
 * column set and their migration column set are the same code path by
 * construction. Test files that need one of them under plain `node --test`
 * (where the migration glob is unavailable) each define their own scratch
 * table inline for exactly this reason -- grep `create table if not exists
 * leads` across `src/lib/news/*.test.ts`.
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` -- see pg-admin.ts); skips
 * with a reason otherwise. Named in the `postgres-integration` CI job in
 * `.github/workflows/ci.yml`.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const suffix = `${process.pid}_${Date.now()}`;
const migrationsDbName = `townreporter_test_parity_migrations_${suffix}`;
const ensureDbName = `townreporter_test_parity_ensure_${suffix}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (it builds two real scratch databases; " +
        "the postgres-integration CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Tables with a documented, intentional gap on one side. Every entry needs a
 * reason -- this is the "small explicit allowlist for any genuinely
 * intentional exception" GauntletGate ENG-03 asked for, not a place to hide
 * an unreviewed mismatch.
 *
 * `columnsOnlyIn` names the side (`"migrations"` or `"ensure"`) where extra
 * columns are expected and why. Leave it undefined to allow the table's
 * entire presence on one side only (no counterpart at all).
 */
const ALLOWLIST: Record<string, { reason: string }> = {
  // No runtime ensure* function ever creates these -- see the file docstring.
  // They exist in the ensure-only database not at all (not even the base
  // table), so they are skipped rather than diffed.
  leads: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  drafts: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  snapshots: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  sources: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  scan_runs: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  articles: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  beat_memory: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  corrections: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  // Better Auth's own tables (migrations/0001_auth.sql, applied only when an
  // app turns sign-in on) have no ensure* mirror; out of scope for this desk
  // schema check.
  user: { reason: "Better Auth table, not part of the desk schema this test covers" },
  session: { reason: "Better Auth table, not part of the desk schema this test covers" },
  account: { reason: "Better Auth table, not part of the desk schema this test covers" },
  verification: { reason: "Better Auth table, not part of the desk schema this test covers" },
};

let closePoolForTests: () => Promise<void>;

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${migrationsDbName}`);
    await admin.query(`CREATE DATABASE ${ensureDbName}`);
    await admin.end();

    // Side A: migrations/*.sql alone, via the real deploy applier.
    const migrationsDbUrl = withDatabase(PSQL_ADMIN_URL, migrationsDbName);
    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: migrationsDbUrl,
    });

    // Side B: every runtime ensure* function, alone, against a bare database.
    // Set BEFORE importing anything that touches ../db.ts -- it reads
    // DATABASE_URL the moment it is first evaluated (see
    // dark-schema-rebuild.test.ts for the same constraint).
    const ensureDbUrl = withDatabase(PSQL_ADMIN_URL, ensureDbName);
    process.env.DATABASE_URL = ensureDbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    const dark = await import("./dark.ts");
    const investigate = await import("./investigate.ts");
    const jobs = await import("./jobs.ts");
    const membership = await import("./membership.ts");
    const paperSettings = await import("./paper-settings.ts");
    const providerLoginServer = await import("./provider-login.server.ts");
    const providerSettings = await import("./provider-settings.ts");
    const editorialServer = await import("./editorial.server.ts");
    const ops = await import("./ops.ts");
    const db = await import("../db.ts");
    closePoolForTests = db.closePoolForTests;

    await membership.ensureNewsroomSchema();
    await membership.ensureInviteSchema();
    await paperSettings.ensurePaperSettingsSchema();
    await providerLoginServer.ensureProviderLoginsSchema();
    await providerSettings.ensureProviderSettingsSchema();
    await jobs.ensureJobsSchema();
    await editorialServer.ensureEditorialSchema();
    await editorialServer.ensureEditorialRequestSchema();
    await dark.ensureDarkSchema(); // also calls ensureInvestigateSchema
    await investigate.ensureInvestigateSchema();
    // desk_rate / audit_events: no ensure*Schema name, but the same
    // create-table-if-not-exists-on-every-call shape (ENG-09) -- a real call
    // each creates the table.
    await ops.assertRate("schema-parity-smoke-user", "scan");
    await ops.audit("schema-parity-smoke-user", "smoke", "schema-parity test");
  }, 60_000);

  after(async () => {
    await closePoolForTests?.();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    for (const name of [migrationsDbName, ensureDbName]) {
      await admin
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        )
        .catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    await admin.end();
  }, 30_000);
}

/** table -> sorted column names, for every base table in the public schema. */
async function tableColumns(url: string): Promise<Map<string, string[]>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = await c.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name
    `);
    const map = new Map<string, string[]>();
    for (const row of rows.rows) {
      const cols = map.get(row.table_name) ?? [];
      cols.push(row.column_name);
      map.set(row.table_name, cols);
    }
    return map;
  } finally {
    await c.end();
  }
}

const INTERNAL_TABLES = new Set(["_migrations", "_schema_ensure_state"]);

describe("every runtime ensure* schema agrees with migrations/*.sql (ENG-03 capstone)", () => {
  it(
    "the ensure-only column set and the migrations-only column set match, table by table",
    { skip },
    async () => {
      const migrationsCols = await tableColumns(withDatabase(PSQL_ADMIN_URL, migrationsDbName));
      const ensureCols = await tableColumns(withDatabase(PSQL_ADMIN_URL, ensureDbName));

      const allTables = new Set([...migrationsCols.keys(), ...ensureCols.keys()]);
      const mismatches: string[] = [];

      for (const table of allTables) {
        if (INTERNAL_TABLES.has(table)) continue;
        if (ALLOWLIST[table]) continue;

        const inMigrations = migrationsCols.get(table);
        const inEnsure = ensureCols.get(table);

        if (!inMigrations) {
          mismatches.push(
            `${table}: created by an ensure* function but has no migration at all ` +
              `(columns: ${inEnsure?.join(", ")}) -- add a migration, or add it to ALLOWLIST with a reason`,
          );
          continue;
        }
        if (!inEnsure) {
          // A table migrations define but no ensure* function ever creates is
          // only a drift risk if some OTHER ensure* function tries to ALTER
          // it (which would have thrown above, during setup) -- it did not
          // throw, so this table is simply untouched by the ensure side, the
          // same as the allowlisted migrations-only tables. Not a mismatch.
          continue;
        }

        const onlyInMigrations = inMigrations.filter((c) => !inEnsure.includes(c));
        const onlyInEnsure = inEnsure.filter((c) => !inMigrations.includes(c));
        if (onlyInMigrations.length || onlyInEnsure.length) {
          mismatches.push(
            `${table}: ` +
              (onlyInMigrations.length
                ? `in migrations, missing from ensure: [${onlyInMigrations.join(", ")}]. `
                : "") +
              (onlyInEnsure.length
                ? `in ensure, missing from migrations: [${onlyInEnsure.join(", ")}].`
                : ""),
          );
        }
      }

      assert.deepEqual(
        mismatches,
        [],
        `schema drift between migrations/*.sql and the runtime ensure* functions:\n` +
          mismatches.join("\n"),
      );
    },
  );
});
