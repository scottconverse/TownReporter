import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Shared plumbing for the handful of tests that need a REAL Postgres and a
 * REAL built server, not PGLite and not a source-text check (see
 * sign-in-throttle.test.ts, leave-desk.test.ts and search-index.test.ts for
 * why each of them needs that). Centralized so the three files cannot drift
 * out of sync on how they find a database or coordinate a shared build --
 * which is exactly how they drifted before: each file hardcoded its own copy
 * of `postgres://postgres@127.0.0.1:5433/postgres`, a port that exists on one
 * developer's machine and nowhere else, including CI.
 */

/**
 * The admin connection used to CREATE and DROP each file's scratch database.
 *
 * `TEST_POSTGRES_ADMIN_URL` is how CI (and any contributor whose Postgres
 * isn't on 5433 with no password) points these tests at a real server. With
 * it unset, this falls back to the one developer setup this repo assumes
 * locally. That fallback is not a guess about someone else's machine -- it is
 * the same value the previous hardcoded constant used, so a machine that used
 * to pass still passes without setting anything.
 */
export function resolveAdminUrl(): string {
  return process.env.TEST_POSTGRES_ADMIN_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";
}

/**
 * Should the heavyweight tests run in THIS process?
 *
 * Five test files build the app and boot a server. Node's test runner starts
 * files concurrently, so on a developer machine that happens to have Postgres
 * on the default port -- which is every machine this is developed on -- all
 * five did that at once during an ordinary `npm test`. The box could not carry
 * it: seven unrelated database tests timed out at eleven seconds each, none of
 * them broken, all of them starved. Diagnosing that costs an hour and teaches
 * nothing, and a suite that fails for reasons unrelated to the code is worse
 * than a slower one.
 *
 * So they are opt-in, and TEST_POSTGRES_ADMIN_URL is the switch: set it and
 * they run, leave it and they skip with a reason. The default above stays for
 * anyone who sets the variable to something other than this machine's server.
 *
 * A skip is only honest if something guarantees they run somewhere. The
 * `postgres-integration` CI job sets the variable and names every one of these
 * files, and `scripts/postgres-tests-are-covered.test.mjs` fails if a file
 * that can skip this way is missing from it.
 */
/*
  A note on why `npm test` runs the src group with --test-concurrency=1.

  Measured, not guessed. Run in parallel, eight files fail: dark.open,
  dark.preflight, delete, evidence.public, investigate.nongate, jobs,
  membership and their neighbours. Every one of them passes alone, and the
  whole group passes with concurrency 1 -- 579 tests, 0 failures. The failures
  carry no assertion message, only 'test failed' at file level, and they land
  at a uniform ~7.8s, which is the shape of a timeout rather than a defect.

  These tests share one embedded PGLite database and several of them probe for
  a model provider with its own timeout. Under parallel load the probes and
  the WASM database contend and something exceeds its budget. That is worth
  fixing properly one day; what is NOT acceptable is a suite that fails for
  reasons unrelated to the code, because the next real failure gets read as
  noise and waved through.

  Serial is slower and honest. The five heavyweight files below are excluded
  from the default run entirely, for the same reason at a larger scale.
*/
export function integrationRequested(): boolean {
  return Boolean(process.env.TEST_POSTGRES_ADMIN_URL?.trim());
}

/** Never log a connection string with a password in it. */
function redact(url: string): string {
  return url.replace(/:[^:@/]*@/, ":***@");
}

export type PgProbe = { ok: true } | { ok: false; reason: string };

/**
 * Is there actually a Postgres at `adminUrl`? A machine with no Postgres at
 * all -- the common case for a fresh clone -- must not fail this suite; it
 * must skip these tests with a reason someone can act on. `connectionTimeoutMillis`
 * keeps that skip fast: with nothing listening on the port, `pg` would
 * otherwise hang on the OS's own connect timeout (tens of seconds on Windows).
 */
export async function probePostgres(adminUrl: string, timeoutMs = 2000): Promise<PgProbe> {
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.end();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason:
        `no reachable PostgreSQL admin connection at ${redact(adminUrl)} (${message}). ` +
        "This test needs a real Postgres: run one locally and set TEST_POSTGRES_ADMIN_URL, " +
        "or run it in the CI job that provides one (see .github/workflows/ci.yml).",
    };
  }
}

/** Same admin connection, pointed at a different database name. */
export function withDatabase(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: "pipe", shell: false });
    let output = "";
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${output.slice(-4000)}`));
    });
    child.on("error", reject);
  });
}

export async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`server never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const LOCK_DIR = join(tmpdir(), "townreporter-dev-build.lock");
const DONE_MARKER = join(tmpdir(), "townreporter-dev-build.done");

function acquireBuildLock(): boolean {
  // A plain mkdir is atomic across processes on both NTFS and POSIX, which
  // makes it a correct cross-process mutex without a dependency.
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    return false;
  }
}

function releaseBuildLock(): void {
  try {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    /* another process already cleaned it up, or never will -- not fatal */
  }
}

async function waitForBuildDone(timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!existsSync(DONE_MARKER)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the other test file's build to finish");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Build the app once, shared by whichever of the three Postgres-integration
 * files gets there first in this `node --test` invocation. Deliberately built
 * with NO `DATABASE_URL` in its env (the build's own chained `db:migrate` step
 * then prints "skipping" and touches no database at all) -- each file migrates
 * its own scratch database separately, right after this returns, so the
 * shared build can never be the thing that writes to someone else's database.
 *
 * `DONE_MARKER` lives at a fixed path in the OS temp dir so it survives past
 * this process -- and that used to be the bug: a `npm test` run leaves the
 * marker behind forever (nothing ever deletes it), so a LATER, separate `npm
 * test` invocation could have one file win the lock and start a real rebuild
 * while a sibling file's `waitForBuildDone` saw the previous run's stale
 * marker, decided the build was already done, and launched a server against
 * `.output` while it was still being overwritten -- the exact shape of "server
 * never came up" this suite was seeing, and, because `npm run build`'s child
 * process tree keeps running even after its own test file gives up on it, the
 * orphaned build kept burning CPU across the whole rest of the suite, which is
 * how unrelated files far away from this one started failing too. The lock
 * holder now clears any stale marker before it starts building, so a waiter
 * can never observe "done" for a build that has not actually run yet in this
 * process group.
 */
/**
 * Newest mtime under a directory, or 0. Used to ask whether an existing
 * build is older than the source it was built from.
 */
function newestMtime(dir: string): number {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else {
      try {
        newest = Math.max(newest, statSync(full).mtimeMs);
      } catch {
        /* raced with a write; ignore */
      }
    }
  }
  return newest;
}

/**
 * Is the build on disk finished AND newer than the source it came from?
 *
 * The marker alone is not enough: it outlives the process that wrote it, so
 * a marker from an earlier `npm test` would vouch for a build that no
 * longer matches the tree. Comparing it against the newest source file is
 * the honest question -- "is what is in .output what this code builds?"
 */
function buildIsCurrent(repoRoot: string): boolean {
  if (!existsSync(DONE_MARKER)) return false;
  if (!existsSync(join(repoRoot, ".output", "server", "index.mjs"))) return false;
  let markerAt: number;
  try {
    markerAt = statSync(DONE_MARKER).mtimeMs;
  } catch {
    return false;
  }
  const newestSource = Math.max(
    newestMtime(join(repoRoot, "src")),
    newestMtime(join(repoRoot, "server")),
    newestMtime(join(repoRoot, "migrations")),
    ...["package.json", "vite.config.ts"].map((f) => {
      try {
        return statSync(join(repoRoot, f)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
  return markerAt >= newestSource;
}

export async function ensureBuilt(repoRoot: string): Promise<void> {
  /*
    Ask FIRST whether a current build already exists.

    This function used to go straight for the lock, and "I got the lock"
    meant "I build" -- with no check that the work was already done. The
    lock is released the moment the first build finishes, so a test file
    that reached this line LATE found the lock free and rebuilt, emptying
    .output underneath servers its siblings were already serving from. The
    victim saw ENOENT on a script chunk whose name was in HTML it had
    already sent: the same shape as the v0.5.4 production incident, where a
    watchdog restart landed mid-build.

    Five integration files hid this by all arriving during the first build.
    Adding a sixth (two-editors) put one of them past the finish line, and
    the stalled-run walk failed on a chunk that no longer existed.
  */
  if (buildIsCurrent(repoRoot)) return;

  const gotLock = acquireBuildLock();
  if (!gotLock) {
    await waitForBuildDone(120_000);
    return;
  }
  try {
    // Re-check under the lock: a build may have finished while we waited to
    // acquire it, and rebuilding on top of live servers is the whole bug.
    if (buildIsCurrent(repoRoot)) return;
    rmSync(DONE_MARKER, { force: true });
    const buildEnv: NodeJS.ProcessEnv = { ...process.env };
    delete buildEnv.DATABASE_URL;
    // npm on Windows is npm.cmd; shell:true resolves the .cmd shim.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["run", "build"], {
        cwd: repoRoot,
        env: buildEnv,
        stdio: "pipe",
        shell: true,
      });
      let output = "";
      child.stdout?.on("data", (d) => (output += d.toString()));
      child.stderr?.on("data", (d) => (output += d.toString()));
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm run build exited ${code}\n${output.slice(-4000)}`));
      });
      child.on("error", reject);
    });
    closeSync(openSync(DONE_MARKER, "w"));
  } finally {
    releaseBuildLock();
  }
}

/**
 * Spawn the just-built production server against `dbUrl`, on `port`.
 *
 * `extraEnv` lets a test override tuning that only exists to be shrunk for a
 * test -- e.g. `ACCOUNT_LOCKOUT_WINDOW_SECONDS` (see `account-lockout.server.ts`),
 * where the production default is minutes and no real test should wait that
 * long for a window to lapse. Anything not overridden inherits the parent
 * process's env, same as before this parameter existed.
 */
export function spawnBuiltServer(
  repoRoot: string,
  dbUrl: string,
  port: number,
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcess {
  return spawn(process.execPath, [join(repoRoot, ".output", "server", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PORT: String(port),
      HOST: "127.0.0.1",
      TOWNREPORTER_CLAUDE_CODE: "0",
      // The server refuses to start with a real DATABASE_URL and no session
      // secret (server/plugins/require-auth-secret.ts) -- correct for an
      // operator, a silent "server never came up" for a test. A scratch
      // database's sessions do not outlive the test, so a fixed test secret
      // is fine, and a caller's own value still wins via process.env/extraEnv.
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "pg-admin-test-secret",
      ...extraEnv,
    },
    // Silent by default; PG_TEST_SERVER_LOGS=1 streams the spawned server's
    // own output into the test log. Server-side failures inside a loader are
    // caught and degrade to an empty result on the page, so with stdio
    // ignored the only visible symptom is "the search found nothing" -- the
    // console.error naming the real cause went nowhere.
    stdio: process.env.PG_TEST_SERVER_LOGS === "1" ? "inherit" : "ignore",
  });
}

export type { ChildProcess };
