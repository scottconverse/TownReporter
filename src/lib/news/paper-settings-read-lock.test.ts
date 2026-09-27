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
 * The incident this test exists for: the paper hangs while a backup runs.
 *
 * `ops/backup.ps1` takes a `pg_dump` every night, and a `pg_dump` holds ACCESS
 * SHARE on every table it reads. `alter table ... add column if not exists` --
 * which several modules used to run as the first line of a READ path -- needs
 * ACCESS EXCLUSIVE, and ACCESS EXCLUSIVE queues behind ACCESS SHARE. So for as
 * long as the dump ran, every reader-facing page whose loader touched one of
 * those modules waited on a lock nobody had told it about, and the paper looked
 * hung to the public.
 *
 * Measured on a scratch cluster (`questions/BP.md`):
 *
 *   held:  begin; select 1 from probe_t limit 1; pg_sleep(12); commit;
 *     alter  table probe_t add column if not exists probe_col int;
 *       -> ERROR: canceling statement due to statement timeout        (blocks)
 *     create table if not exists probe_t (...);
 *       -> NOTICE: relation "probe_t" already exists, skipping        (free)
 *
 * So the hazard is specifically the ALTER (and any other ACCESS EXCLUSIVE DDL)
 * on a read path -- `create table if not exists` against a table that already
 * exists takes no conflicting lock at all, which is why the fix is allowed to
 * keep that one statement.
 *
 * This test holds ACCESS SHARE on `paper_settings` from a SECOND connection,
 * warms the read up once (so any marker the fix writes is already written),
 * then calls the public read again and requires it to come back inside 2s.
 * Before the fix the second call's first ALTER blocks until the lock is
 * released; after it there is no ALTER on that path at all.
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` -- see pg-admin.ts); skips
 * with a reason otherwise. Discovered by `scripts/postgres-test-discovery.mjs`
 * and run by the `postgres-integration` CI job, which invokes
 * `scripts/run-postgres-integration.mjs` and so needs no edit to include it.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const dbName = `townreporter_test_paperlock_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (it needs two real connections and a held " +
        "lock; the postgres-integration CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** How long the public read gets while a dump is holding ACCESS SHARE. */
const READ_BUDGET_MS = 2000;

let getPublicPaperConfig: (newsroomId?: number) => Promise<unknown>;
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

    const paper = await import("./paper-settings.ts");
    const db = await import("../db.ts");
    getPublicPaperConfig = paper.getPublicPaperConfig;
    closePoolForTests = db.closePoolForTests;
  }, { timeout: 60_000 });

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
  }, { timeout: 30_000 });
}

describe("the public paper read while a backup holds ACCESS SHARE", () => {
  it(
    "returns inside 2s instead of queueing behind the dump's lock",
    { skip },
    async () => {
      const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);

      // Warm up: the first call is allowed to do whatever DDL it wants. What
      // is under test is the SECOND call -- the one a reader's page load makes
      // while the nightly dump is running.
      await getPublicPaperConfig();

      // The dump: a second connection holding ACCESS SHARE on the table the
      // read path touches, held open for the whole test.
      const dump = new Client({ connectionString: dbUrl });
      await dump.connect();
      await dump.query("BEGIN");
      await dump.query("select 1 from paper_settings limit 1");

      const started = Date.now();
      const read = getPublicPaperConfig();
      // A blocked ALTER does not fail, it waits -- so the budget has to be a
      // race, or a red run would hang until the test runner's own timeout and
      // report nothing useful. A rejection counts as "returned": this test is
      // about the read not QUEUEING, and what it answers is other tests' job.
      const raced = await Promise.race([
        read.then(
          () => "returned" as const,
          () => "returned" as const,
        ),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), READ_BUDGET_MS).unref();
        }),
      ]);
      const elapsed = Date.now() - started;

      // Let the blocked read finish before the assertions: release the dump's
      // lock first, then wait for whatever the read was stuck on.
      await dump.query("ROLLBACK");
      await dump.end();
      await read.catch(() => undefined);

      assert.equal(
        raced,
        "returned",
        `the public paper read did not return within ${READ_BUDGET_MS}ms while another ` +
          `connection held ACCESS SHARE on paper_settings -- it is still issuing ACCESS ` +
          `EXCLUSIVE DDL (an "alter table ... add column if not exists") on a read path, ` +
          `so it queues behind the nightly pg_dump and the paper hangs for the public. ` +
          `See questions/BP.md and ensureSchemaOnce() in src/lib/db.ts.`,
      );
      assert.ok(
        elapsed < READ_BUDGET_MS,
        `the public paper read took ${elapsed}ms with a dump holding ACCESS SHARE on ` +
          `paper_settings (budget ${READ_BUDGET_MS}ms)`,
      );
    },
  );
});
