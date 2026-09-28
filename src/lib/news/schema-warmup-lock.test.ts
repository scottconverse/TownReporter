import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "pg";
import { createServer, type ViteDevServer } from "vite";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  withDatabase,
} from "../test-support/pg-admin.ts";

/**
 * Proves the actual point of Unit CE: after the boot warm-up has run, a
 * `pg_dump`-shaped ACCESS SHARE lock held across several tables does not
 * block the request paths those tables' `ensure*Schema` modules cover.
 *
 * `paper-settings-read-lock.test.ts` proves this for one module
 * (`paper-settings`) by calling its public read once as the "warm it up"
 * step. This test proves the same property for the WARM-UP ITSELF: run
 * `runSchemaWarmup()` once (standing in for the built server's boot), THEN
 * hold ACCESS SHARE on tables spanning three different registry modules
 * (`paper-settings`, `dark`, `sections`) the way a nightly `pg_dump` would,
 * and confirm none of their `ensure*Schema` entry points wait behind it --
 * both by racing a budget (the same instrument as `paper-settings-read-lock.test.ts`)
 * and directly, by asking `pg_stat_activity`/`pg_locks` whether anything is
 * blocked on an `alter table` at all. Prior art: `bp-proof2.ps1` /
 * `bp-proof2.log` in `townreporter-deepseek-oversight/scratch` and `evidence/`
 * (a PowerShell probe of the same lock shape against a real cluster).
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` -- see pg-admin.ts); skips
 * with a reason otherwise. Discovered by `scripts/postgres-test-discovery.mjs`
 * (it imports `pg` transitively via `pg-admin.ts`) and run by the
 * `postgres-integration` CI job, which invokes `scripts/run-postgres-integration.mjs`
 * -- no CI file needs editing to include it.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const dbName = `townreporter_test_warmuplock_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (it needs a held lock on a real database; " +
        "the postgres-integration CI job runs it on every push -- see docs/postgres-integration-testing.md " +
        "for starting a throwaway local cluster on port 5544-5548)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** How long the request paths get while a dump is holding ACCESS SHARE. */
const READ_BUDGET_MS = 2000;

let vite: ViteDevServer;
let runSchemaWarmup: (opts?: { timeoutMs?: number; log?: (line: string) => void }) => Promise<unknown>;
let closePoolForTests: () => Promise<void>;
let getPublicPaperConfig: (newsroomId?: number) => Promise<unknown>;
let ensureDarkSchema: () => Promise<void>;
let ensureSectionsSchema: () => Promise<void>;

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    // Set BEFORE loading any module that touches ../db.ts: it reads
    // DATABASE_URL the moment it is first evaluated (see
    // paper-settings-read-lock.test.ts / dark-schema-rebuild.test.ts for the
    // same constraint).
    process.env.DATABASE_URL = dbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    // schema-warmup.ts pulls in desk.ts, which imports "@/lib/db" -- plain
    // `node --test` cannot resolve that alias, so load through Vite the same
    // way article-headline-edit.test.ts and schema-warmup.test.ts do.
    vite = await createServer({
      configFile: false,
      server: { middlewareMode: true },
      resolve: { alias: { "@": join(process.cwd(), "src") } },
    });
    ({ runSchemaWarmup } = await vite.ssrLoadModule("/src/lib/schema-warmup.ts"));
    ({ closePoolForTests } = await vite.ssrLoadModule("/src/lib/db.ts"));
    ({ getPublicPaperConfig } = await vite.ssrLoadModule("/src/lib/news/paper-settings.ts"));
    ({ ensureDarkSchema } = await vite.ssrLoadModule("/src/lib/news/dark.ts"));
    ({ ensureSectionsSchema } = await vite.ssrLoadModule("/src/lib/news/sections.server.ts"));
  }, { timeout: 60_000 });

  after(async () => {
    await vite?.close();
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

describe("after the boot warm-up, a pg_dump-shaped ACCESS SHARE lock blocks nothing", () => {
  it(
    "three different registry modules' request paths all return inside budget, and pg_stat_activity shows no waiting ALTER",
    { skip },
    async () => {
      const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);

      // Boot: run the warm-up once, standing in for the built server's own
      // boot sequence. Every module's marker is now written.
      const results = (await runSchemaWarmup({ timeoutMs: 30_000 })) as {
        name: string;
        status: string;
      }[];
      assert.ok(
        results.every((r) => r.status !== "failed"),
        `boot warm-up must succeed against a fresh migrated database: ${JSON.stringify(results)}`,
      );

      // The dump: a second connection holding ACCESS SHARE across tables that
      // span all three modules under test, held open for the whole test --
      // the same shape as `pg_dump`, per paper-settings-read-lock.test.ts.
      const dump = new Client({ connectionString: dbUrl });
      await dump.connect();
      await dump.query("BEGIN");
      await dump.query("select 1 from paper_settings limit 1");
      await dump.query("select 1 from dark_runs limit 1");
      await dump.query("select 1 from newsroom_sections limit 1");

      const dumpPid = (await dump.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!
        .pid;

      const started = Date.now();
      // These are the exact "first use after a schema-changing release" entry
      // points the warm-up exists to move off the request path: the public
      // paper read (which calls ensurePaperSettingsSchema internally) plus
      // the dark and sections ensure functions directly, exercised the way a
      // real request would call them.
      const calls = Promise.all([
        getPublicPaperConfig(),
        ensureDarkSchema(),
        ensureSectionsSchema(),
      ]);
      // A blocked ALTER does not fail, it waits -- so the budget has to be a
      // race, or a red run would hang until the test runner's own timeout.
      const raced = await Promise.race([
        calls.then(
          () => "returned" as const,
          () => "returned" as const,
        ),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), READ_BUDGET_MS).unref();
        }),
      ]);
      const elapsed = Date.now() - started;

      // While still holding the dump's lock, ask Postgres directly: is
      // anything waiting on a lock at all, and is it an ALTER? This is the
      // same instrument bp-proof2.ps1 used against a real cluster.
      const waitingAlters = await dump.query<{ pid: number; query: string }>(
        `select pid, query from pg_stat_activity
         where wait_event_type = 'Lock' and query ilike 'alter table%' and pid <> $1`,
        [dumpPid],
      );

      await dump.query("ROLLBACK");
      await dump.end();
      await calls.catch(() => undefined);

      assert.equal(
        waitingAlters.rows.length,
        0,
        `pg_stat_activity showed an ALTER waiting on a lock while the dump held ACCESS SHARE: ` +
          JSON.stringify(waitingAlters.rows),
      );
      assert.equal(
        raced,
        "returned",
        `at least one of getPublicPaperConfig/ensureDarkSchema/ensureSectionsSchema did not return ` +
          `within ${READ_BUDGET_MS}ms while another connection held ACCESS SHARE on their tables -- ` +
          `the boot warm-up did not actually prevent a first-use ALTER on these request paths. ` +
          `See src/lib/schema-warmup.ts and ensureSchemaOnce() in src/lib/db.ts.`,
      );
      assert.ok(
        elapsed < READ_BUDGET_MS,
        `the three request paths took ${elapsed}ms combined with a dump holding ACCESS SHARE ` +
          `(budget ${READ_BUDGET_MS}ms)`,
      );
    },
  );
});
