import { pendingMigrations } from "../../scripts/migration-plan.mjs";
// Type-only: erased at build time, so the embedded driver is still imported
// lazily (see createPgliteSql) and never loads on the Neon path.
import type { PGlite } from "@electric-sql/pglite";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

function readEnv(key: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  // Bracket access so Vite cannot replace this with `undefined` at build time.
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

function isVercelRuntime(): boolean {
  return (
    typeof process !== "undefined" && Boolean(process.env["VERCEL"] || process.env["VERCEL_ENV"])
  );
}

function readDatabaseUrl(): string | undefined {
  return readEnv("DATABASE_URL");
}

/**
 * Neon when DATABASE_URL is set. PGLite only in the live preview.
 * Never PGLite on Vercel — the wasm file is not in the function and would 500
 * every route.
 */
export function getDbSource(): DbSource {
  if (readDatabaseUrl()) return "neon";
  if (isVercelRuntime()) return "neon";
  return "pglite";
}

/** Snapshot for older imports. Prefer getDbSource() — env is read at call time. */
export const dbSource: DbSource = getDbSource();

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __pgPool__?: import("pg").Pool;
};

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    // Regular Postgres driver: node-postgres (`pg`) — works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const connectionString = readDatabaseUrl();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new Pool({ connectionString });
    // pg's Pool emits 'error' on any IDLE client that dies -- a killed
    // connection, a restarted Postgres, a database dropped out from under it
    // (exactly the "rebuilt underneath a running process" case this file's
    // ensureSchemaOnce is written to survive). With no listener, Node treats
    // that as an unhandled 'error' event and crashes the whole process. The
    // pool already reconnects lazily on the next query; this only stops that
    // routine event from taking the server down with it.
    pool.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[db] pool error on an idle client (pool recovers on next query): ${message}`);
    });
    globalRef.__pgPool__ = pool;
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

/**
 * Apply every migration in `files` (path -> file contents) that `_migrations`
 * has not already recorded, in basename order, each file and its ledger row in
 * ONE transaction (parity with scripts/migrate.mjs) so a failed statement can
 * never leave a file half-applied but untracked. Returns the names it applied.
 *
 * ONE implementation, two sources of `files`:
 *
 *   - `createPgliteSql` below, where the bundler inlines them through
 *     `import.meta.glob` (dev server, preview, built server);
 *   - `src/lib/test-support/pglite-migrations.ts`, which reads the same
 *     directory with `node:fs` because the unit suite runs under plain
 *     `node --test` and has no bundler at all.
 *
 * They must agree on order, on the transaction, and on the ledger row, or the
 * test database stops predicting the one the paper runs on.
 */
export async function applyPendingMigrations(
  pg: PGlite,
  files: Record<string, string>,
): Promise<string[]> {
  const doneRows = await pg.query<{ name: string }>("select name from _migrations");
  const done = doneRows.rows.map((r) => r.name);
  const applied: string[] = [];
  for (const { name, path } of pendingMigrations(Object.keys(files), done)) {
    await pg.transaction(async (tx) => {
      await tx.exec(files[path]);
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
    applied.push(name);
  }
  return applied;
}

/**
 * The PGLite preview's migration SQL, as `path -> contents`.
 *
 * Normally the bundler inlines it (`import.meta.glob`, no runtime fs needed).
 * A plain `node --test` process has no bundler, so `src/lib/test-support/pglite-migrations.ts`
 * -- the preload `scripts/run-tests-safe.mjs` loads before every file in the
 * `src/**` group -- reads the SAME directory with `node:fs` and registers it
 * here first. Whichever source answers, the files go through the same applier
 * and land in the same `_migrations` ledger.
 *
 * Registration happens before this module is evaluated, and nothing is applied
 * until a database is actually opened, so a test file that never touches the
 * database pays nothing for it.
 */
function pgliteMigrationFiles(): Record<string, string> {
  const registered = (globalThis as typeof globalThis & {
    __pgliteMigrationFiles__?: Record<string, string>;
  }).__pgliteMigrationFiles__;
  if (registered) return registered;
  try {
    // Does not descend, so the opt-in auth schema under migrations/auth/ stays
    // out of an app that never asked for sign-in.
    return import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
  } catch {
    // No Vite transform and nothing registered: no schema source at all, which
    // is the `postgres-integration` lane's footing. It migrates its own scratch
    // databases (see src/lib/test-support/pg-admin.ts).
    return {};
  }
}

async function createPgliteSql(): Promise<Sql> {
  // Embedded Postgres, imported on demand so it never loads on the Neon path.
  // One in-memory instance per process, shared across HMR module instances, so
  // data survives source edits (it resets on dev-server restart).
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // Applied files are tracked in _migrations. Runs once per module instance —
  // so an HMR reload after adding a migration file applies it live — with
  // passes serialized on a global chain so concurrent callers never
  // double-apply.
  const migrate = async (): Promise<void> => {
    await applyPendingMigrations(pg, pgliteMigrationFiles());
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return getDbSource() === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when `DATABASE_URL` is set (that path uses Neon).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (getDbSource() !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/** Run fn on a single connection (BEGIN/COMMIT). Required for Neon pools. */
export async function withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (getDbSource() === "pglite") {
    const pg = await getPglite();
    return pg.transaction(async (tx) => {
      const sql = toSql(async <R>(text: string, params: unknown[]) => {
        const res = await tx.query(text, params);
        return res.rows as R[];
      });
      return fn(sql);
    });
  }
  await getSql();
  const pool = globalRef.__pgPool__;
  if (!pool) throw new Error("Postgres pool missing");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sql = toSql(async <R>(text: string, params: unknown[]) => {
      const res = await client.query(text, params);
      return res.rows as R[];
    });
    const result = await fn(sql);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create the marker table the fingerprint check reads, tolerating a caller
 * that creates it at the same moment.
 *
 * `create table if not exists` is NOT atomic against a concurrent creator:
 * both sessions pass the existence check, both try to register the row type,
 * and the loser gets `duplicate key value violates unique constraint
 * "pg_type_typname_nsp_index"` (SQLSTATE 23505) instead of a no-op. Two
 * schedulers converging on a database that has never been bootstrapped is
 * exactly the shape of `routine-notice-automation.postgres.test.ts`, and a
 * fresh production database gets the same two arrivals on its first requests.
 * Once the winner commits, the table is there, so the loser only has to ask
 * again -- the retry is the fix, not a workaround: nothing else in this file
 * is attempted until the marker table exists.
 */
async function createEnsureStateTable(sql: Sql, attemptsLeft = 4): Promise<void> {
  try {
    await sql.query(`
      create table if not exists _schema_ensure_state (
        name text primary key,
        fingerprint text not null,
        ensured_at timestamptz not null default now()
      )
    `);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "23505" || attemptsLeft <= 1) throw error;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await createEnsureStateTable(sql, attemptsLeft - 1);
  }
}

/**
 * Run a batch of idempotent DDL statements (`create table if not exists`,
 * `alter table ... add column if not exists`, etc.) at most once per
 * *database*, not once per process.
 *
 * Several modules under `src/lib/news/` declare their own tables inline and
 * re-run that DDL as the first line of every RPC handler — 111 statements on
 * the Dark Desk path alone, each a full round trip, replayed even though
 * every object already exists (ENG-104, `artifacts/gate-townreporter-2026-08-30/`).
 *
 * The obvious fix — a module-level boolean set after the first successful
 * run — is wrong on this codebase: PGLite's dev instance and this repo's own
 * integration tests routinely drop and recreate the database a long-lived
 * process is still pointed at (a fresh scratch DB per test file, a `db:reset`
 * against a running dev server). A boolean would keep reporting "ensured"
 * for a database that has none of these objects, and the first RPC after the
 * rebuild would fail against tables that were never recreated.
 *
 * So nothing is cached in process memory. Instead, the fact is recorded IN
 * the database itself, in `_schema_ensure_state`, keyed by `name` and a
 * fingerprint of the exact statement list. A rebuilt database loses that
 * table along with everything else, so the very next call sees no matching
 * row and reruns the batch — the check is only ever as stale as the
 * database it reads, which cannot be stale. Changing the statement list
 * (adding, removing, or reordering a DDL line) changes the fingerprint too,
 * so a code change that needs new objects is picked up on the next call
 * without anyone needing to remember to bump a version number by hand.
 *
 * Cost: two round trips (create-marker-table-if-needed, then a fingerprint
 * lookup) when the schema is already current, instead of `statements.length`
 * — down from 111 to 2 on the Dark Desk path. Every statement stays
 * idempotent and is still wrapped so one already-applied or unsupported
 * statement (older PGLite) can't abort the batch — unchanged from before.
 *
 * Returns `"skipped"` when the fingerprint already matched (no DDL ran) or
 * `"ran"` when the statement batch executed — the boot warm-up
 * (`src/lib/schema-warmup.ts`) logs this per module so a promote's log shows
 * which modules were already current and which one actually issued DDL.
 * Every existing caller discards the return value, so this is additive.
 */
export async function ensureSchemaOnce(
  sql: Sql,
  name: string,
  statements: readonly string[],
): Promise<"ran" | "skipped"> {
  await createEnsureStateTable(sql);
  const fingerprint = await fingerprintOf(statements);
  const [row] = await sql.query<{ fingerprint: string }>(
    `select fingerprint from _schema_ensure_state where name = $1`,
    [name],
  );
  if (row?.fingerprint === fingerprint) return "skipped";

  for (const stmt of statements) {
    try {
      await sql.query(stmt);
    } catch {
      /* already exists / older PGLite */
    }
  }

  await sql.query(
    `insert into _schema_ensure_state (name, fingerprint, ensured_at)
     values ($1, $2, now())
     on conflict (name) do update set fingerprint = excluded.fingerprint, ensured_at = now()`,
    [name, fingerprint],
  );
  return "ran";
}

/**
 * Read the `ensured_at` marker `ensureSchemaOnce` last wrote for `name`, as
 * text (avoids driver-specific timestamptz parsing -- see the OID_* parsers
 * above). `null` when the marker table or the row does not exist yet.
 *
 * Used by the boot warm-up (`src/lib/schema-warmup.ts`) to tell "ran" from
 * "skipped-by-marker" for modules whose own `ensure*Schema` wrapper discards
 * `ensureSchemaOnce`'s return value (most of them) -- read the marker before
 * and after calling the wrapper; unchanged means the DDL batch did not run.
 */
export async function readSchemaEnsureMarker(sql: Sql, name: string): Promise<string | null> {
  try {
    const [row] = await sql.query<{ ensured_at: string }>(
      `select ensured_at::text as ensured_at from _schema_ensure_state where name = $1`,
      [name],
    );
    return row?.ensured_at ?? null;
  } catch {
    return null;
  }
}

async function fingerprintOf(statements: readonly string[]): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(statements.join(" ")).digest("hex");
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (preview / no `DATABASE_URL`): open the in-memory DB and apply
 *   `migrations/*.sql`. Idempotent — concurrent callers share one promise.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  if (getDbSource() !== "pglite") return Promise.resolve();
  return getSql().then(() => undefined);
}

/**
 * Test-only escape hatch: end the pg `Pool` this process opened, if any.
 *
 * A test that talks to a real Postgres through `getSql()` -- rather than
 * spawning the built server as its own child process, the way the other
 * Postgres-integration tests do -- shares this module's memoized pool, which
 * this file otherwise never closes (a long-lived server is supposed to keep
 * it open for its own lifetime). Without this, such a test process hangs on
 * an open socket instead of exiting. No-op when no pool was ever created
 * (PGLite backend, or `getSql()` was never called).
 */
export async function closePoolForTests(): Promise<void> {
  await globalRef.__pgPool__?.end();
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && getDbSource() === "pglite") {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
  });
}
