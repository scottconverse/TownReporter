#!/usr/bin/env node
/**
 * Run a command with this workspace's `.env` merged into its environment.
 *
 * `dev`, `build`, `preview` and `db:migrate` all route through this wrapper, so
 * the dev server, the built bundle and the preview server resolve `VITE_*`
 * flags from one place. A real `process.env` entry always wins, so an explicit
 * override still works.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { safeTestEnvironment } from "./test-environment.mjs";

/** Parse a `.env` document. */
export function parseDotEnv(text) {
  const env = {};
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function readDotEnv(root) {
  try {
    return parseDotEnv(readFileSync(join(root, ".env"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * What an install needs to be told when it still carries an xAI key.
 *
 * GR-C removed Grok (xAI) as a provider: the SuperGrok connection, its
 * transport and the `XAI_API_KEY` fallback are all gone. An operator who set
 * only `XAI_API_KEY` therefore loses their writing model and falls to the next
 * rung of the ladder -- which, on a machine with nothing else configured, is
 * no provider at all. That is a real behavioural change and it must not be a
 * silent one: this is the sentence the desk prints at start-up.
 *
 * Pure, and separate from the printing, so `with-app-env.test.mjs` can assert
 * the wording and the trigger without spawning a server.
 */
export const XAI_REMOVED_WARNING =
  "Grok (xAI) is no longer supported; XAI_API_KEY is ignored. Choose another model on the Models screen.";

/** The warning this environment needs, or null when it needs none. */
export function xaiRemovedWarning(env = process.env) {
  return env.XAI_API_KEY || env.GROK_API_KEY ? XAI_REMOVED_WARNING : null;
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/**
 * Whether `command` has to go through a shell to be executable.
 *
 * On Windows npm installs bin entries as `vite.cmd` / `vite.ps1` shims. Bare
 * `spawn("vite")` cannot execute either — it fails with ENOENT, which took
 * down `npm run dev` and `npm run build` on every Windows box. Node also
 * refuses to spawn a `.cmd` without a shell (CVE-2024-27980), so the shell is
 * the only route to a shim.
 *
 * Scope it to bare command NAMES: an absolute path is spawnable as-is, and
 * routing one through the shell would re-split it on spaces — which is exactly
 * how `C:\Program Files\nodejs\node.exe` breaks. POSIX never needs the shell.
 */
export function needsShell(command) {
  if (process.platform !== "win32") return false;
  return !/[\\/]/.test(command);
}

export function isDirectNodeTestInvocation(command, args) {
  const normalized = command.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
  if (normalized !== "node" && normalized !== "node.exe") return false;
  return args.some((arg) => arg === "--test" || arg.startsWith("--test="));
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  // `.env` values under the process environment: an explicit override wins.
  const inheritedEnv = {
    ...readDotEnv(projectRoot()),
    ...process.env,
  };
  const directNodeTest = isDirectNodeTestInvocation(command, args);
  // `test:live-model` is an explicit paid-provider entry point. Keep that
  // opt-in, while still preventing a checkout or parent database from
  // reaching its test process. Ordinary Node tests get the same fail-closed
  // environment and preload guard as `npm test`.
  const liveModelTest = directNodeTest && process.env.RUN_LIVE_MODEL_TESTS === "1";
  const env = directNodeTest ? safeTestEnvironment(inheritedEnv) : inheritedEnv;
  if (liveModelTest) env.RUN_LIVE_MODEL_TESTS = "1";
  /*
    Say which database this run resolved to, out loud.

    .env is merged in whole, so a run that does not explicitly override
    DATABASE_URL silently inherits the dev database from the file -- which is
    how a release audit briefly pointed its "isolated" server at the real dev
    Postgres before catching itself. One line at startup makes that mistake
    visible on the first screen instead of discoverable from suspicious data.
    Credentials are not printed; only where it points.

    stdout, NOT stderr. The production start script pipes this command with
    2>&1 under $ErrorActionPreference = "Stop", where one byte of native
    stderr is a terminating error -- the stderr version of this line stopped
    the start script after migrate and took the live paper down to a 502.
  */
  if (env.DATABASE_URL) {
    try {
      const u = new URL(env.DATABASE_URL);
      const from = process.env.DATABASE_URL !== undefined ? "environment" : ".env";
      console.log(`[with-app-env] DATABASE_URL -> ${u.hostname}:${u.port || "5432"}${u.pathname} (from ${from})`);
    } catch {
      console.log("[with-app-env] DATABASE_URL is set but unparseable");
    }
  } else {
    console.log("[with-app-env] DATABASE_URL unset -- PGLite in-memory");
  }
  /*
    Say the xAI removal out loud, on the same start-up line this wrapper already
    uses for the database it resolved.

    stdout, NOT stderr, for the same measured reason as the line above: the
    production start script pipes this command with 2>&1 under
    $ErrorActionPreference = "Stop", where one byte of native stderr is a
    terminating error -- the stderr version of the DATABASE_URL line stopped
    the start script after migrate and took the live paper down to a 502.
    A warning that cannot be printed is a warning that does not exist.
  */
  const xaiWarning = xaiRemovedWarning(env);
  if (xaiWarning) console.log(`[with-app-env] WARNING: ${xaiWarning}`);
  // `node` is this very runtime — use its real path rather than a PATH lookup.
  // Avoids the shell entirely (and its DEP0190 warning on every run).
  const resolved = command === "node" ? process.execPath : command;
  const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;
  // The focused-run command documented in CONTRIBUTING.md is this wrapper, so
  // it has to carry the model seal too -- `npm run test:live-model` is the one
  // deliberate exception, and it is the branch that skips both preloads.
  const modelSeal = new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href;
  const childArgs =
    directNodeTest && !liveModelTest ? ["--import", guard, "--import", modelSeal, ...args] : args;
  const child = spawn(resolved, childArgs, {
    stdio: "inherit",
    env,
    shell: needsShell(resolved),
  });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${command}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
