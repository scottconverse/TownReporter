/*
  Ollama supervision for every newsroom (DEF-2, Scott's design Nov 4 2026).

  Ollama is the local program that runs DeepSeek and the local models. Until
  now the desk only looked for a running Ollama; when it was not there the
  ladder quietly moved to a paid model. Scott's machine had a watchdog
  (ops/watchdog.ps1); other newsrooms had nothing.

  What this module does, in the order it does it:

    1. Ask the ordinary Ollama first -- http://127.0.0.1:11434/api/version.
       If it answers, use it and change nothing. That is Scott's rule and the
       reason the app never competes with the Ollama app the user installed.
    2. If nothing answers there and `ollama` is installed (on PATH, or the
       normal Windows folder %LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe),
       start a COPY of our own on 11435 with OLLAMA_HOST=127.0.0.1:11435.
       Detached, hidden, output to <data root>/logs/ollama-own.log, PID kept in
       <data root>/logs/ollama-own.json. Wait up to 60 seconds for it to
       answer, then go on either way.
    3. If 11434 answers again later (the Ollama app was started), use 11434
       again. Our copy may stay up; nothing kills it except app shutdown.
    4. On app shutdown, stop ONLY the copy this process started, and only by
       the PID it saved. Never a process by image name. Never an Ollama we did
       not start.

  It NEVER installs or downloads Ollama (Scott's decision), never loads a
  model, and never makes a job fail: every caller gets an answer and goes on.

  SERVER-ONLY by the `.server.ts` suffix: it spawns processes, reads and writes
  files and probes loopback ports.

  THE TEST ENVIRONMENT IS INERT. `TOWNREPORTER_TEST_ENV_VERIFIED=1` is set by
  scripts/test-environment-guard.mjs, which also replaces fetch with a
  default-deny seal. Left alone, `ensureOllama()` would read that refusal as
  "nothing answered" and spawn the real Ollama during a test run. So in that
  environment it answers "skipped" without a probe or a spawn. The functions
  below take their side effects as arguments, so the tests that DO exercise
  this module pass fakes and never touch the machine.
*/

import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { OllamaStatus } from "./ollama-status.ts";
import {
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_OWN_ENDPOINT,
  setLocalDiscoveryReachable,
  setSupervisedOllamaBaseUrl,
} from "./provider-registry.ts";

/** Roots, without `/v1`: the Ollama native API lives at the root. */
export const OLLAMA_DEFAULT_ROOT = OLLAMA_DEFAULT_ENDPOINT.replace(/\/v1$/, "");
export const OLLAMA_OWN_ROOT = OLLAMA_OWN_ENDPOINT.replace(/\/v1$/, "");

/** Scott's ceiling: "wait up to 60 seconds for it to answer, then go on". */
export const OLLAMA_START_WAIT_MS = 60_000;
/** "Do not check more than once every 30 seconds (cache the answer)." */
export const OLLAMA_CHECK_CACHE_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_500;
/** A second, slower look at 11434 just before we would start a copy of our own. */
const RECHECK_TIMEOUT_MS = 5_000;
const START_POLL_MS = 1_000;

const TEST_ENV = "TOWNREPORTER_TEST_ENV_VERIFIED";

export type OllamaOutcome = "running" | "started" | "failed" | "absent" | "not-installed" | "skipped";

export type OllamaEnsureResult = {
  outcome: OllamaOutcome;
  /** Something answers on 11434 or 11435 right now. */
  running: boolean;
  /** Root URL that answers, without `/v1`, or null. */
  root: string | null;
  /** OpenAI-compatible endpoint (`<root>/v1`) for the DeepSeek rung, or null. */
  endpoint: string | null;
  /** True when the answering copy is the one THIS app started. */
  supervised: boolean;
  /** `ollama` is on PATH or in the normal Windows folder. */
  installed: boolean;
  /** Epoch ms the supervised copy was started, else null. */
  startedAt: number | null;
  /** The one line the desk shows, or null when there is nothing to say. */
  note: string | null;
};

export type { OllamaStatus };

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>;

export type OllamaDeps = {
  fetch?: FetchLike;
  spawn?: typeof spawn;
  exists?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Skip the 30s cache (the "Check again" button and tests). */
  force?: boolean;
  /** How long to wait for a just-started copy. Tests shorten this. */
  waitMs?: number;
  /** How often to ask while waiting. Tests shorten this. */
  pollMs?: number;
  /** Where the log and the PID state file go. Defaults to the app's logs folder. */
  dataRoot?: string;
};

type OwnState = { pid: number; port: number; startedAt: number };

/** The child THIS process started, so shutdown can stop it and only it. */
let ownChild: { pid: number; startedAt: number } | null = null;
let shutdownHooked = false;
let cache: { at: number; result: OllamaEnsureResult } | null = null;
/**
 * The check that is running right now, if any. Job lanes run several jobs at
 * once; without this, two callers that both miss the cache would both start a
 * copy on 11435, and the losing one would overwrite the PID we need to stop.
 */
let inFlight: Promise<OllamaEnsureResult> | null = null;

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Same data root the installer, setup code and stats reports already use.
 * Re-implemented here (three lines) rather than imported from
 * setup-code.server.ts, which pulls the database and the auth tables in.
 */
export function ollamaDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.TOWNREPORTER_DATA_ROOT?.trim() || join(process.cwd(), ".townreporter-data");
}

export function ownStatePath(dataRoot = ollamaDataRoot()): string {
  return join(dataRoot, "logs", "ollama-own.json");
}

export function ownLogPath(dataRoot = ollamaDataRoot()): string {
  return join(dataRoot, "logs", "ollama-own.log");
}

function result(partial: Partial<OllamaEnsureResult> & { outcome: OllamaOutcome }): OllamaEnsureResult {
  return {
    running: false,
    root: null,
    endpoint: null,
    supervised: false,
    installed: false,
    startedAt: null,
    note: null,
    ...partial,
  };
}

/** "6:52 AM" -- the desk's own house time, and the one Scott asked for. */
export function ollamaStartTimeWords(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function ollamaStartedNote(at: number): string {
  return `Ollama was down. TownReporter started it at ${ollamaStartTimeWords(at)}.`;
}

export const OLLAMA_DID_NOT_START_NOTE = "Ollama was down and did not start. The desk used the next model.";

/**
 * Find the `ollama` program without running it.
 *
 * PATH first, then the folder the Windows installer uses. Scott's rule: the
 * app never downloads or installs Ollama, so "not found" is a warning, never
 * an error.
 */
export function resolveOllamaExecutable(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
  } = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const names = platform === "win32" ? ["ollama.exe", "ollama.cmd", "ollama"] : ["ollama"];
  const dirs = (envValue(env, "PATH") ?? "").split(delimiter).filter(Boolean);
  const localAppData = envValue(env, "LOCALAPPDATA");
  if (platform === "win32" && localAppData) {
    dirs.push(join(localAppData, "Programs", "Ollama"));
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** A plain GET that never throws: answers, timeout and refusal all mean "no". */
async function answers(fetchImpl: FetchLike, root: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetchImpl(`${root}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return true;
  } catch {
    /* try the second endpoint below */
  }
  try {
    const res = await fetchImpl(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

function readOwnState(path: string): OwnState | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OwnState>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.startedAt === "number"
    ) {
      return { pid: parsed.pid, port: typeof parsed.port === "number" ? parsed.port : 11435, startedAt: parsed.startedAt };
    }
  } catch {
    /* no state file, or a torn write -- both mean "we do not know of a copy" */
  }
  return null;
}

function writeOwnState(path: string, state: OwnState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state), "utf8");
  } catch (err) {
    console.error(`[ollama] could not write ${path}: ${String(err)}`);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The read-only answer: is something answering, is it our copy, is `ollama`
 * installed? Never starts anything and never spawns. Used by the Today and
 * Models warning boxes.
 */
export async function ollamaStatus(options: OllamaDeps = {}): Promise<OllamaStatus> {
  const fetchImpl = options.fetch ?? (fetch as unknown as FetchLike);
  const exists = options.exists ?? existsSync;
  const env = options.env ?? process.env;
  const installed = Boolean(resolveOllamaExecutable({ env, platform: options.platform, exists }));
  const state = readOwnState(ownStatePath(options.dataRoot ?? ollamaDataRoot(env)));

  if (await answers(fetchImpl, OLLAMA_DEFAULT_ROOT)) {
    return { running: true, root: OLLAMA_DEFAULT_ROOT, endpoint: OLLAMA_DEFAULT_ENDPOINT, supervised: false, installed, startedAt: null };
  }
  const supervisedNow = Boolean(state && isAlive(state.pid));
  if (supervisedNow && (await answers(fetchImpl, OLLAMA_OWN_ROOT))) {
    return {
      running: true,
      root: OLLAMA_OWN_ROOT,
      endpoint: OLLAMA_OWN_ENDPOINT,
      supervised: true,
      installed,
      startedAt: state!.startedAt,
    };
  }
  return { running: false, root: null, endpoint: null, supervised: false, installed, startedAt: null };
}

function recordSupervision(result: OllamaEnsureResult): void {
  setSupervisedOllamaBaseUrl(result.supervised ? result.endpoint : null);
  if (result.running) setLocalDiscoveryReachable(true);
}

/**
 * Start our own copy on 11435. Returns its PID and start time, or null when
 * the spawn itself failed (no permission, missing file, bad environment).
 */
function startOwnCopy(
  executable: string,
  options: OllamaDeps,
  logPath: string,
): { pid: number; startedAt: number } | null {
  const env = options.env ?? process.env;
  const spawnFn = options.spawn ?? spawn;
  const now = options.now ?? Date.now;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const fd = openSync(logPath, "a");
    let child: ChildProcess;
    try {
      child = spawnFn(executable, ["serve"], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
        env: { ...env, OLLAMA_HOST: "127.0.0.1:11435" },
      });
    } finally {
      // The child holds its own copy of the descriptor; the parent does not.
      closeSync(fd);
    }
    child.unref?.();
    if (!child.pid) return null;
    const startedAt = now();
    ownChild = { pid: child.pid, startedAt };
    writeOwnState(ownStatePath(options.dataRoot ?? ollamaDataRoot(env)), {
      pid: child.pid,
      port: 11435,
      startedAt,
    });
    hookShutdown();
    return { pid: child.pid, startedAt };
  } catch (err) {
    console.error(`[ollama] could not start its own copy: ${String(err)}`);
    return null;
  }
}

/**
 * Stop ONLY the copy this process started, by the PID it saved.
 *
 * Called from the app's shutdown hook. Never by program name, never a PID we
 * did not record. A copy left by an earlier process is left alone: it is not
 * ours to kill, and the next check reuses it on 11435.
 */
export function stopOwnedOllama(options: { env?: NodeJS.ProcessEnv; dataRoot?: string } = {}): boolean {
  const env = options.env ?? process.env;
  const path = ownStatePath(options.dataRoot ?? ollamaDataRoot(env));
  const saved = readOwnState(path);
  const pid = ownChild?.pid ?? null;
  if (!pid || !saved || saved.pid !== pid) {
    ownChild = null;
    return false;
  }
  try {
    if (isAlive(pid)) process.kill(pid, "SIGTERM");
  } catch (err) {
    console.error(`[ollama] could not stop its own copy (pid ${pid}): ${String(err)}`);
  }
  ownChild = null;
  try {
    rmSync(path, { force: true });
  } catch {
    /* the file is a convenience; failing to remove it is not a failure */
  }
  return true;
}

function hookShutdown(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  // `exit` handlers may only run synchronous work, which `stopOwnedOllama` is.
  process.once("exit", () => {
    stopOwnedOllama();
  });
  /*
    A signal-terminated Node process does NOT emit `exit`. The launcher
    (scripts/with-app-env.mjs) forwards SIGINT/SIGTERM/SIGHUP to the server, so
    each one stops our copy and then re-raises the same signal with the
    default behaviour, which is what every other shutdown path expects.
  */
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      stopOwnedOllama();
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(0);
      }
    });
  }
}

/**
 * The one call a job makes before it runs (see `executeJob` in jobs.ts).
 *
 * Cached for 30 seconds. Never throws. Never blocks past `waitMs` (60s, or
 * less in tests). The returned `note` is the one desk line to record:
 *
 *   - "Ollama was down. TownReporter started it at 6:52 AM."  (started)
 *   - "Ollama was down and did not start. The desk used the next model." (failed)
 *   - null when Ollama was already running or was not installed.
 */
export async function ensureOllama(options: OllamaDeps = {}): Promise<OllamaEnsureResult> {
  const env = options.env ?? process.env;
  if (env[TEST_ENV] === "1") {
    return result({ outcome: "skipped" });
  }
  // One check at a time: a second caller (including "Check again") waits for
  // the check already running rather than probing and spawning its own copy.
  if (inFlight) return inFlight;
  const now = options.now ?? Date.now;
  if (!options.force && cache && now() - cache.at < OLLAMA_CHECK_CACHE_MS) {
    return cache.result;
  }

  const run = runOllamaCheck(options, env, now);
  inFlight = run;
  void run
    .catch(() => undefined)
    .finally(() => {
      if (inFlight === run) inFlight = null;
    });
  return run;
}

async function runOllamaCheck(
  options: OllamaDeps,
  env: NodeJS.ProcessEnv,
  now: () => number,
): Promise<OllamaEnsureResult> {
  const fetchImpl = options.fetch ?? (fetch as unknown as FetchLike);
  const dataRoot = options.dataRoot ?? ollamaDataRoot(env);
  const statePath = ownStatePath(dataRoot);
  const executable = resolveOllamaExecutable({
    env,
    platform: options.platform,
    exists: options.exists,
  });
  const installed = Boolean(executable);

  // 1. The Ollama the user installed, on its normal port. Use it, change nothing.
  if (await answers(fetchImpl, OLLAMA_DEFAULT_ROOT)) {
    const answer = result({
      outcome: "running",
      running: true,
      root: OLLAMA_DEFAULT_ROOT,
      endpoint: OLLAMA_DEFAULT_ENDPOINT,
      installed,
    });
    recordSupervision(answer);
    cache = { at: now(), result: answer };
    return answer;
  }

  // 2. A copy this app started earlier (or in an earlier process) on 11435.
  const saved = readOwnState(statePath);
  if (saved && isAlive(saved.pid) && (await answers(fetchImpl, OLLAMA_OWN_ROOT))) {
    const answer = result({
      outcome: "running",
      running: true,
      root: OLLAMA_OWN_ROOT,
      endpoint: OLLAMA_OWN_ENDPOINT,
      supervised: true,
      installed,
      startedAt: saved.startedAt,
    });
    recordSupervision(answer);
    cache = { at: now(), result: answer };
    return answer;
  }

  // 3. Installed but stopped: start our own copy on 11435 and wait for it.
  if (!executable) {
    const answer = result({ outcome: "not-installed", installed: false });
    recordSupervision(answer);
    cache = { at: now(), result: answer };
    return answer;
  }

  // A busy machine can make the 1.5s first probe time out even though the
  // user's own Ollama is there. Look once more, patiently, before starting a
  // second copy nobody needs.
  if (await answers(fetchImpl, OLLAMA_DEFAULT_ROOT, RECHECK_TIMEOUT_MS)) {
    const answer = result({
      outcome: "running",
      running: true,
      root: OLLAMA_DEFAULT_ROOT,
      endpoint: OLLAMA_DEFAULT_ENDPOINT,
      installed,
    });
    recordSupervision(answer);
    cache = { at: now(), result: answer };
    return answer;
  }

  const started = startOwnCopy(executable, options, ownLogPath(dataRoot));
  if (!started) {
    const answer = result({
      outcome: "failed",
      installed,
      note: OLLAMA_DID_NOT_START_NOTE,
    });
    recordSupervision(answer);
    cache = { at: now(), result: answer };
    return answer;
  }

  const waitMs = options.waitMs ?? OLLAMA_START_WAIT_MS;
  const pollMs = options.pollMs ?? START_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + waitMs;
  let up = false;
  while (now() < deadline) {
    if (await answers(fetchImpl, OLLAMA_OWN_ROOT)) {
      up = true;
      break;
    }
    await sleep(pollMs);
  }

  if (up) {
    const answer = result({
      outcome: "started",
      running: true,
      root: OLLAMA_OWN_ROOT,
      endpoint: OLLAMA_OWN_ENDPOINT,
      supervised: true,
      installed,
      startedAt: started.startedAt,
      note: ollamaStartedNote(started.startedAt),
    });
    recordSupervision(answer);
    // The catalog may hold a 20-second-old "nothing answered" from before the
    // start. Forget it so the very next lookup can see 11435.
    const { forgetLocalCatalogCache } = await import("./local-models.ts");
    forgetLocalCatalogCache();
    cache = { at: now(), result: answer };
    return answer;
  }

  const answer = result({ outcome: "failed", installed, note: OLLAMA_DID_NOT_START_NOTE });
  recordSupervision(answer);
  cache = { at: now(), result: answer };
  return answer;
}

/** Test-only: clear the 30s cache and the shutdown hook between test files. */
export function resetOllamaSupervisionForTests(): void {
  cache = null;
  ownChild = null;
  inFlight = null;
  shutdownHooked = false;
}
