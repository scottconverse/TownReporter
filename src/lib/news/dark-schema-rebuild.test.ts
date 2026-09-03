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
 * `ensureDarkSchema()` used to replay 111 DDL statements -- 6 inline in this
 * desk plus 105 more in `ensureInvestigateSchema()` -- on every one of the 20
 * Dark Desk RPCs, measured at ~1.8s per call on a warm, empty database
 * (ENG-104, `artifacts/gate-townreporter-2026-08-30/01-engineering-deepdive.md`).
 * The fix (`ensureSchemaOnce` in `src/lib/db.ts`) records completion IN the
 * database itself rather than in process memory, specifically so it cannot
 * go stale.
 *
 * That specific property -- not just "it's memoized" -- is what this test
 * holds. The obvious alternative fix is a module-level boolean set after the
 * first successful run, and it is wrong on this codebase: this repo's own
 * integration tests, and an operator resetting a scratch database while a
 * dev server stays up, routinely drop and recreate the database a
 * long-lived process is still pointed at. A boolean cache would report
 * "ensured" for a database that has none of these tables, and the next real
 * request would fail against schema that was never recreated.
 *
 * This reproduces that scenario directly: ensure the schema once, then --
 * WITHOUT restarting the process or touching its `pg` pool -- drop and
 * recreate the exact same database out from under it, the way
 * `pg_terminate_backend` + `DROP DATABASE` + `CREATE DATABASE` do in
 * `leave-desk.test.ts`'s own `after()`. A stale cache fails this by either
 * throwing (querying tables that no longer exist) or by silently succeeding
 * while `dark_runs` stays missing; the fix must do neither.
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` — see pg-admin.ts); skips
 * with a reason otherwise. Named in the `postgres-integration` CI job in
 * `.github/workflows/ci.yml`, enforced by `scripts/postgres-tests-are-covered.test.mjs`.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const dbName = `townreporter_test_darkschema_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (it drops and recreates a real database " +
        "under a live process; the postgres-integration CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let ensureDarkSchema: () => Promise<void>;
let closePoolForTests: () => Promise<void>;

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    // Set BEFORE importing anything that touches ../db.ts: that module reads
    // DATABASE_URL the moment it is first evaluated and would otherwise fall
    // back to PGLite (see search-index.test.ts for the same constraint).
    process.env.DATABASE_URL = dbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    const dark = await import("./dark.ts");
    const db = await import("../db.ts");
    ensureDarkSchema = dark.ensureDarkSchema;
    closePoolForTests = db.closePoolForTests;
  }, 60_000);

  after(async () => {
    await closePoolForTests?.();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      )
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }, 30_000);
}

/** Does the database at `url` (a fresh connection, never the app's own pool) have `dark_runs`? */
async function darkRunsExists(url: string): Promise<boolean> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = await c.query<{ exists: boolean }>(
      `select to_regclass('dark_runs') is not null as exists`,
    );
    return rows.rows[0]?.exists ?? false;
  } finally {
    await c.end();
  }
}

/**
 * The column set migrations/0012_newsroom_appliance.sql (newsroom_id) and
 * migrations/0003_dark_desk.sql / 0030_dark_model_choice.sql (everything
 * else) define for these three tables. GauntletGate ENG-02: the rebuild
 * path used to recreate these tables in their pre-0012 shape -- the table
 * came back, but every query dark.ts makes against it (all of which filter
 * on newsroom_id) failed. A `to_regclass` existence check alone cannot see
 * that; this compares the actual column set.
 */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  dark_runs: [
    "error",
    "finished_at",
    "id",
    "model_choice",
    "newsroom_id",
    "started_at",
    "summary",
    "user_id",
  ].sort(),
  dark_signals: [
    "alternatives",
    "confidence",
    "counter_narrative",
    "created_at",
    "handoff",
    "id",
    "investigation_id",
    "linkage_map",
    "name",
    "newsroom_id",
    "observation",
    "pathway",
    "pattern",
    "posture",
    "privacy_review",
    "run_id",
    "signal_type",
    "strength",
    "user_id",
    "what_would_kill",
  ].sort(),
  dark_promises: [
    "created_at",
    "id",
    "newsroom_id",
    "source_cite",
    "status",
    "user_id",
    "what",
    "when_due",
    "who_promised",
  ].sort(),
};

/** The live column set for `table` at `url` (a fresh connection). */
async function columnsOf(url: string, table: string): Promise<string[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = await c.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = $1`,
      [table],
    );
    return rows.rows.map((r) => r.column_name).sort();
  } finally {
    await c.end();
  }
}

describe("ensureDarkSchema survives a database rebuilt underneath the running process", () => {
  it(
    "recreates the schema after the same database is dropped and recreated, without a stale-success report",
    { skip },
    async () => {
      const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);

      // Warm the schema through the app's own long-lived pool.
      await ensureDarkSchema();
      assert.equal(
        await darkRunsExists(dbUrl),
        true,
        "sanity check: ensureDarkSchema() did not create dark_runs on the first call",
      );

      // An outside actor rebuilds the SAME database this process's pool is
      // still connected to -- same name, same URL, empty inside. The pool
      // object is untouched; only the data behind it changes.
      const admin = new Client({ connectionString: PSQL_ADMIN_URL });
      await admin.connect();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await admin.query(`DROP DATABASE ${dbName}`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      await admin.end();

      // The property under test: the SAME process, calling the SAME function
      // through the SAME pool, must not report success while leaving the
      // schema missing. A process-memory cache ("already ensured, skip")
      // would pass the call below without error yet leave dark_runs absent.
      await ensureDarkSchema();
      assert.equal(
        await darkRunsExists(dbUrl),
        true,
        "ensureDarkSchema() reported success (or at least didn't throw) after the database was " +
          "rebuilt underneath the process, but dark_runs is still missing -- this is exactly the " +
          "stale-cache failure ENG-104's fix exists to prevent",
      );

      // ENG-02: the table coming back is not enough -- it must come back
      // USABLE. Assert the actual column set (not just existence) for all
      // three tables DARK_SCHEMA_STATEMENTS recreates.
      for (const table of Object.keys(EXPECTED_COLUMNS)) {
        const cols = await columnsOf(dbUrl, table);
        assert.deepEqual(
          cols,
          EXPECTED_COLUMNS[table],
          `${table} came back from the rebuild with the wrong column set -- expected ` +
            `${JSON.stringify(EXPECTED_COLUMNS[table])}, got ${JSON.stringify(cols)}`,
        );
      }

      // And the smoke query ENG-02 asked for directly: every dark.ts read
      // filters on newsroom_id, so a rebuilt dark_runs that has the column
      // but the query still can't use is exactly the failure a to_regclass
      // check would miss.
      const c = new Client({ connectionString: dbUrl });
      await c.connect();
      try {
        await c.query(`insert into dark_runs (user_id, newsroom_id) values ('smoke', 1)`);
        const smoke = await c.query(`select id from dark_runs where newsroom_id = 1`);
        assert.ok(
          smoke.rows.length > 0,
          "select id from dark_runs where newsroom_id = 1 returned nothing after the rebuild",
        );
      } finally {
        await c.end();
      }
    },
  );
});
