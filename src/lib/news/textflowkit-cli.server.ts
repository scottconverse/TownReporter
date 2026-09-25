import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedCaptionFile } from "./caption-parse.ts";
import { resolveCliPath, spawnPlan } from "./cli-spawn.server.ts";
import { textflowkitChildEnv } from "./cli-child-env.server.ts";
import {
  buildTextflowkitArgs,
  classifyTextflowkitFailure,
  parseTextflowkitJson,
  parseTextflowkitVersion,
  resolveTextflowkitConfig,
  textflowkitCaptionFile,
  transcriptionTimeoutSeconds,
  type TextflowkitConfig,
} from "./textflowkit.ts";

/*
  The spawn half of unit R -- SERVER ONLY.

  Every run here is an argument array with `shell: false`, the same shape
  `meeting-capture-ytdlp.ts` uses for yt-dlp. The audio path is operator data
  (it lives under a storage root the operator chose, and a meeting title can
  end up in a filename), so it is never interpolated into a command line.
*/

export type TextflowkitProbe = {
  installed: boolean;
  version: string | null;
  cliPath: string;
  model: string;
  language: string;
  /** Why it is not installed, when that is the answer. Never a silent false. */
  detail: string | null;
};

type ChildRun = { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: string | null };

/**
 * One place that spawns this CLI, so the version probe and the transcription
 * cannot drift apart in how they hand over an environment or a timeout.
 */
async function runTextflowkit(
  executable: string,
  argv: string[],
  opts: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<ChildRun> {
  const { spawn } = await import("node:child_process");
  /*
    The same two decisions the provider CLIs go through (cli-spawn.server.ts): a
    relative operator path is made absolute while a copy of their own value is
    still in hand -- the call itself runs with a different `cwd` on purpose --
    and a path that is obviously a Node script is run BY Node, because Windows
    cannot exec a `.mjs`. A `.exe` (the real textflowkit, a console script or a
    venv shim) takes neither branch and is spawned exactly as before.
  */
  const plan = spawnPlan(resolveCliPath(executable), argv);
  return await new Promise<ChildRun>((resolvePromise) => {
    let settled = false;
    const finish = (value: ChildRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };
    const child = spawn(plan.command, plan.args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: textflowkitChildEnv(),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, opts.timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    const onAbort = () => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error: unknown) => {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error instanceof Error ? error.message : String(error),
      });
    });
    child.once("close", (code) => finish({ code, stdout, stderr, timedOut, spawnError: null }));
  });
}

/**
 * Is textflowkit there, and what does it say it is?
 *
 * Measured against the real CLI (0.1.6): `--version` prints `textflowkit 0.1.6`
 * on stdout and exits 0. `doctor` exists in the tool but is not used here --
 * `--version` is a top-level flag that answers in one line without loading a
 * model or a device, and a probe must not be expensive.
 *
 * Absence is normal. An operator who has not installed this tool gets the
 * product's original behaviour, not an error.
 */
export async function probeTextflowkit(
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<TextflowkitProbe> {
  const config = resolveTextflowkitConfig(opts.env ?? process.env);
  const base = { cliPath: config.cliPath, model: config.model, language: config.language };
  const run = await runTextflowkit(config.cliPath, ["--version"], { timeoutMs: opts.timeoutMs ?? 15_000 });
  if (run.spawnError) {
    return {
      ...base, installed: false, version: null,
      detail: config.explicitPath
        ? `the configured textflowkit path could not be run (${config.cliPath}): ${run.spawnError}`
        : `textflowkit was not found on PATH: ${run.spawnError}`,
    };
  }
  if (run.timedOut) {
    return { ...base, installed: false, version: null, detail: `textflowkit ${config.cliPath} --version did not answer within 15s` };
  }
  if (run.code !== 0) {
    return {
      ...base, installed: false, version: null,
      detail: `textflowkit ${config.cliPath} --version exited ${run.code ?? "without a status"}: ${run.stderr.trim().slice(0, 200)}`,
    };
  }
  return { ...base, installed: true, version: parseTextflowkitVersion(run.stdout), detail: null };
}

export type TextflowkitTranscribeSuccess = {
  ok: true;
  parsed: ParsedCaptionFile;
  /** Where the tool's own JSON was written; the caller stores it, then removes the temp directory. */
  jsonPath: string;
  jsonBytes: number;
  model: string | null;
  device: string | null;
  durationSeconds: number | null;
  wordCount: number;
  argv: string[];
  stdout: string;
  stderr: string;
};

export type TextflowkitTranscribeFailure = {
  ok: false;
  reason: string;
  timedOut: boolean;
  argv: string[];
  stderr: string;
};

export type TextflowkitTranscribeResult = TextflowkitTranscribeSuccess | TextflowkitTranscribeFailure;

/**
 * The one JSON file a run wrote. The caller hands a directory it created for
 * this run alone, so there is exactly one; picking the newest is the tie-break
 * that keeps a leftover file from an interrupted run from being stored as if
 * it were this run's answer.
 */
function findTranscriptJson(outputDir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(outputDir).filter((name) => /\.json$/i.test(name));
  } catch {
    return null;
  }
  if (!names.length) return null;
  const scored = names
    .map((name) => {
      const path = join(outputDir, name);
      let mtime = 0;
      try { mtime = statSync(path).mtimeMs; } catch { /* vanished between listing and stat */ }
      return { path, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return scored[0]!.path;
}

/**
 * Run textflowkit over one captured audio file.
 *
 * The timeout is derived from the audio's own duration, not a flat wall clock:
 * a 4-hour council meeting and a 60-second clip cannot share one number, and a
 * timeout that is too short is indistinguishable from a tool that does not
 * work. The allowance is recorded in the failure reason when it is hit.
 */
export async function transcribeAudioWithTextflowkit(input: {
  audioPath: string;
  outputDir: string;
  durationSeconds?: number | null;
  signal?: AbortSignal;
  config?: TextflowkitConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<TextflowkitTranscribeResult> {
  const config = input.config ?? resolveTextflowkitConfig(input.env ?? process.env);
  const timeoutSeconds = transcriptionTimeoutSeconds(input.durationSeconds, config);
  const argv = buildTextflowkitArgs({
    audioPath: resolve(input.audioPath),
    outputDir: resolve(input.outputDir),
    model: config.model,
    language: config.language,
  });
  const run = await runTextflowkit(config.cliPath, argv, {
    timeoutMs: timeoutSeconds * 1000,
    signal: input.signal,
    cwd: resolve(input.outputDir),
  });
  if (run.spawnError) {
    return {
      ok: false,
      reason: config.explicitPath
        ? `the configured textflowkit path could not be run (${config.cliPath}): ${run.spawnError}`
        : `textflowkit was not found on PATH: ${run.spawnError}`,
      timedOut: false,
      argv,
      stderr: run.stderr,
    };
  }
  if (run.timedOut || run.code !== 0) {
    return {
      ok: false,
      reason: classifyTextflowkitFailure({
        exitCode: run.code,
        stderr: run.stderr,
        timedOut: run.timedOut,
        timeoutSeconds,
      }),
      timedOut: run.timedOut,
      argv,
      stderr: run.stderr,
    };
  }
  const jsonPath = findTranscriptJson(resolve(input.outputDir));
  if (!jsonPath) {
    return {
      ok: false,
      reason: "textflowkit exited 0 but wrote no JSON transcript into its output directory",
      timedOut: false,
      argv,
      stderr: run.stderr,
    };
  }
  if (!existsSync(input.audioPath)) {
    return { ok: false, reason: `captured audio is missing: ${input.audioPath}`, timedOut: false, argv, stderr: run.stderr };
  }
  const raw = readFileSync(jsonPath, "utf8");
  let parsed: ParsedCaptionFile;
  let details: ReturnType<typeof parseTextflowkitJson>;
  try {
    details = parseTextflowkitJson(raw);
    parsed = textflowkitCaptionFile(jsonPath, raw);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      timedOut: false,
      argv,
      stderr: run.stderr,
    };
  }
  return {
    ok: true,
    parsed,
    jsonPath,
    jsonBytes: Buffer.byteLength(raw, "utf8"),
    model: details.model,
    device: details.device,
    durationSeconds: details.durationSeconds,
    wordCount: details.wordCount,
    argv,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}
