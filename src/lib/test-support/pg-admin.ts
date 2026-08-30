import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
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
export async function ensureBuilt(repoRoot: string): Promise<void> {
  const gotLock = acquireBuildLock();
  if (!gotLock) {
    await waitForBuildDone(120_000);
    return;
  }
  try {
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
      ...extraEnv,
    },
    stdio: "ignore",
  });
}

export type { ChildProcess };
