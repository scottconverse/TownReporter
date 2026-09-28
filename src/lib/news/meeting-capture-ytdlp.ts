import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseCaptionFile, type ParsedCaptionFile } from "./caption-parse.ts";
import { parseInfoSidecar, type ParsedInfoSidecar } from "./meeting-capture-info.ts";
import { createServerOnlyFn } from "@tanstack/react-start";

/*
  The allow-listed python runner is a `.server` module, and this module is
  reachable from the browser through the /desk/ops settings component, so a
  plain `await import()` of the runner made the client build resolve a
  server-only file -- a build error in 0.6.63, and the same shape of leak the
  note at the top of meeting-manual-run.ts describes.

  createServerOnlyFn marks the boundary: the client build prunes this body and
  the runner is loaded on the server, where the capture actually runs.
*/
const loadMediaToolSpawner = createServerOnlyFn(
  async () => (await import("./media-tool-process.server.ts")).spawnMediaTool,
);

export type CaptureControl = {
  /** N-5 Stop: aborting kills the in-flight yt-dlp child. */
  signal?: AbortSignal;
  /** N-5 progress: called with the current bytes on disk under outputDir. */
  onProgress?: (bytes: number) => void;
};

export type CaptionCaptureInput = {
  videoId: string;
  outputDir: string;
  archivePath: string;
  sleepSubtitles?: number;
  sleepRequests?: number;
  /**
   * N-5 Continue: this run is resuming a capture the operator stopped.
   *
   * yt-dlp continues a partial `.part` file by default as long as the output
   * template is unchanged, so this does not change the download itself -- it
   * makes the intent explicit and lets the caller record that the run was a
   * resume rather than a fresh attempt.
   */
  resume?: boolean;
} & CaptureControl;

export type CaptionCaptureSuccess = {
  ok: true;
  parsed: ParsedCaptionFile;
  infoPath: string | null;
  info: ParsedInfoSidecar;
  argv: string[];
  stdout: string;
  stderr: string;
  /**
   * FEATURE-BACKLOG player_client retry: which alternate `player_client` yt-dlp
   * needed to get past YouTube's bot/sign-in challenge, or `null`/absent when
   * the plain request succeeded and no retry was needed. This is the existing
   * record path for a capture's outcome (alongside `argv`/`stdout`/`stderr`) --
   * there is no separate log call in this module to extend. Optional (rather
   * than required) so the other call sites that build a `CaptionCaptureSuccess`
   * by hand for their own tests don't all need updating for a field they have
   * no opinion about; treat a missing value the same as `null`.
   */
  playerClientUsed?: PlayerClientId | null;
};

export type CaptionCaptureFailure = {
  ok: false;
  reason: string;
  argv: string[];
  stderr: string;
  /** N-5: true when the capture was stopped by the operator rather than failing. */
  stopped?: boolean;
};

export type CaptionCaptureResult = CaptionCaptureSuccess | CaptionCaptureFailure;

export type AudioCaptureInput = {
  videoId: string;
  outputDir: string;
  archivePath: string;
  sleepRequests?: number;
  /** N-5 Continue: see CaptionCaptureInput.resume. */
  resume?: boolean;
} & CaptureControl;

export type AudioArtifact = {
  path: string;
  format: "opus";
  byteSize: number;
  sha256: string;
};

export type AudioCaptureSuccess = {
  ok: true;
  audio: AudioArtifact;
  infoPath: string | null;
  info: ParsedInfoSidecar;
  argv: string[];
  stdout: string;
  stderr: string;
  /** FEATURE-BACKLOG player_client retry: see CaptionCaptureSuccess.playerClientUsed. */
  playerClientUsed?: PlayerClientId | null;
};

export type AudioCaptureFailure = {
  ok: false;
  reason: string;
  argv: string[];
  stderr: string;
  stopped?: boolean;
};

export type AudioCaptureResult = AudioCaptureSuccess | AudioCaptureFailure;

const AUDIO_SOURCE_METHOD = "yt-dlp-audio-opus";
export function audioSourceMethod(): string {
  return AUDIO_SOURCE_METHOD;
}

export function buildCaptionCaptureArgs(input: CaptionCaptureInput): string[] {
  const outputDir = resolve(input.outputDir);
  const archivePath = resolve(input.archivePath);
  const outputTemplate = join(outputDir, "%(id)s.%(ext)s");
  return [
    "-m",
    "yt_dlp",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--write-info-json",
    "--sub-langs",
    "en",
    "--sub-format",
    "srv3/vtt/best",
    "--js-runtimes",
    "node",
    "--sleep-subtitles",
    String(input.sleepSubtitles ?? 2),
    "--sleep-requests",
    String(input.sleepRequests ?? 1),
    "--download-archive",
    archivePath,
    "--paths",
    outputDir,
    // N-5 Continue: keep (and resume) a partial rather than starting over.
    // yt-dlp continues a .part file by default; passing it explicitly makes
    // the intent visible in the recorded argv and pins the behaviour.
    ...(input.resume ? ["--continue"] : []),
    "-o",
    outputTemplate,
    `https://www.youtube.com/watch?v=${input.videoId}`,
  ];
}

/**
 * Audio-required branch (spec 3.2). Used only when the caption fetch returned no
 * usable track or produced a track the parser rejected. Extracts opus audio at
 * quality 5 and writes the info sidecar so duration/ended-at still resolve.
 * No subtitle flags here: captions already failed.
 */
export function buildAudioCaptureArgs(input: AudioCaptureInput): string[] {
  const outputDir = resolve(input.outputDir);
  const archivePath = resolve(input.archivePath);
  const outputTemplate = join(outputDir, "%(id)s.%(ext)s");
  return [
    "-m",
    "yt_dlp",
    "-x",
    "--audio-format",
    "opus",
    "--audio-quality",
    "5",
    "--write-info-json",
    "--js-runtimes",
    "node",
    "--sleep-requests",
    String(input.sleepRequests ?? 1),
    "--download-archive",
    archivePath,
    "--paths",
    outputDir,
    // N-5 Continue: keep (and resume) a partial rather than starting over.
    ...(input.resume ? ["--continue"] : []),
    "-o",
    outputTemplate,
    `https://www.youtube.com/watch?v=${input.videoId}`,
  ];
}

export function classifyYtdlpFailure(input: { exitCode: number | null; stderr: string }): CaptionCaptureFailure {
  const rateLimited = /\b429\b|too many requests/i.test(input.stderr);
  return {
    ok: false,
    reason: rateLimited
      ? `yt-dlp rate limited (HTTP 429): ${input.stderr.trim().slice(0, 300)}`
      : `yt-dlp exited ${input.exitCode ?? "without a status"}: ${input.stderr.trim().slice(0, 300)}`,
    argv: [],
    stderr: input.stderr,
  };
}

/**
 * Detection for M-1. Audio is required only when captions are genuinely
 * unavailable or unusable — never on a normal successful caption path, and
 * never for an HTTP 429 / transient transport failure (that is a paced retry,
 * not an audio condition).
 */
export function requiresAudioFallback(result: CaptionCaptureFailure): boolean {
  if (/\b429\b|too many requests/i.test(result.reason)) return false;
  const reason = result.reason.toLowerCase();
  return (
    reason.includes("wrote no srv3 or vtt caption file") ||
    reason.includes("no text") ||
    reason.includes("no usable") ||
    reason.includes("caption file has no text") ||
    reason.includes("parser rejected")
  );
}

/**
 * FEATURE-BACKLOG: yt-dlp player_client retry.
 *
 * YouTube sometimes answers yt-dlp's plain request with a bot/sign-in
 * challenge rather than the video's data, independent of the video itself --
 * the same URL can succeed a minute later, or succeed immediately with a
 * different `player_client`. This is the fixed retry order: each named client
 * is tried once, in order, and the first one that gets past the challenge
 * wins. Order chosen for cheapest-first: android_vr and visionos have shipped
 * without the challenge most consistently in reports of this failure mode;
 * tv_embedded is the last resort.
 */
export const PLAYER_CLIENT_RETRY_ORDER = ["android_vr", "visionos", "tv_embedded"] as const;
export type PlayerClientId = (typeof PLAYER_CLIENT_RETRY_ORDER)[number];

/**
 * Whether yt-dlp's stderr is YouTube's bot/sign-in challenge, rather than
 * some other failure (rate limiting, a network error, a genuinely missing
 * video). Only a challenge is worth retrying with a different player_client --
 * everything else would just fail again the same way three more times.
 */
export function looksLikeYoutubeBotChallenge(stderr: string): boolean {
  return /confirm you.?re not a bot|sign in to confirm/i.test(stderr);
}

/**
 * The same argv, with `--extractor-args youtube:player_client=<id>` inserted
 * right before the trailing positional URL (the last element every argv list
 * in this module ends with). Kept as a small pure function so the retry
 * orchestration below can build each attempt's argv without duplicating the
 * "insert before the URL" rule three times.
 */
export function withPlayerClientArgs(argv: string[], client: PlayerClientId): string[] {
  return [
    ...argv.slice(0, -1),
    "--extractor-args",
    `youtube:player_client=${client}`,
    ...argv.slice(-1),
  ];
}

export type YtdlpAttemptResult = { code: number | null; stdout: string; stderr: string; stopped: boolean };

/**
 * The retry itself, kept independent of `runYtdlp`/child-process spawning so
 * it can be driven by a fake in tests (real yt-dlp is a Python process this
 * repo cannot spawn portably in a unit test -- see meeting-capture-ytdlp.test.ts).
 *
 * `attempt(argv)` runs exactly one yt-dlp invocation. The base argv (no
 * `player_client` override) is always tried first, matching today's behavior
 * for the overwhelming majority of requests that never hit the challenge.
 * Only a bot-challenge failure triggers a retry; anything else (rate limit,
 * a real 404, a network error, `stopped` from an operator abort) is returned
 * as-is; a non-challenge failure from a RETRY client stops the loop early
 * too, rather than working through the rest of the list for no reason.
 */
export async function runWithPlayerClientRetry(
  baseArgv: string[],
  attempt: (argv: string[]) => Promise<YtdlpAttemptResult>,
): Promise<{ result: YtdlpAttemptResult; argv: string[]; playerClientUsed: PlayerClientId | null }> {
  let result = await attempt(baseArgv);
  if (result.stopped || result.code === 0 || !looksLikeYoutubeBotChallenge(result.stderr)) {
    return { result, argv: baseArgv, playerClientUsed: null };
  }
  for (const client of PLAYER_CLIENT_RETRY_ORDER) {
    const argv = withPlayerClientArgs(baseArgv, client);
    result = await attempt(argv);
    if (result.stopped || result.code === 0) return { result, argv, playerClientUsed: result.code === 0 ? client : null };
    if (!looksLikeYoutubeBotChallenge(result.stderr)) return { result, argv, playerClientUsed: null };
  }
  // Every client tried; the last attempt's argv and result stand as the
  // reported failure (still the bot challenge, from the last client tried).
  return {
    result,
    argv: withPlayerClientArgs(baseArgv, PLAYER_CLIENT_RETRY_ORDER[PLAYER_CLIENT_RETRY_ORDER.length - 1]!),
    playerClientUsed: null,
  };
}

function findCaptionFile(outputDir: string, videoId: string): string | null {
  const files = readdirSync(outputDir)
    .filter((name) => name.startsWith(`${videoId}.`) && /\.(srv3|vtt)$/i.test(name))
    .sort((a, b) => {
      const priority = (name: string) => (/\.srv3$/i.test(name) ? 0 : 1);
      return priority(a) - priority(b) || a.localeCompare(b);
    });
  return files.length ? join(outputDir, files[0]!) : null;
}

function findInfoFile(outputDir: string, videoId: string): string | null {
  const name = readdirSync(outputDir).find((n) => n === `${videoId}.info.json`);
  return name ? join(outputDir, name) : null;
}

function findAudioFile(outputDir: string, videoId: string): string | null {
  const files = readdirSync(outputDir)
    .filter((name) => name.startsWith(`${videoId}.`) && /\.(opus|m4a|webm|ogg|mp3|wav)$/i.test(name) && !/\.info\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.length ? join(outputDir, files[0]!) : null;
}

function readInfo(outputDir: string, videoId: string): { infoPath: string | null; info: ParsedInfoSidecar } {
  const infoPath = findInfoFile(outputDir, videoId);
  if (!infoPath) return { infoPath: null, info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null } };
  try {
    return { infoPath, info: parseInfoSidecar(JSON.parse(readFileSync(infoPath, "utf8"))) };
  } catch {
    return { infoPath, info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null } };
  }
}

function dirBytes(dir: string): number {
  try {
    let total = 0;
    for (const name of readdirSync(dir)) {
      try { total += statSync(join(dir, name)).size; } catch { /* racing writes */ }
    }
    return total;
  } catch {
    return 0;
  }
}

async function runYtdlp(
  argv: string[],
  cwd: string,
  control: CaptureControl = {},
): Promise<{ code: number | null; stdout: string; stderr: string; stopped: boolean }> {
  const spawnMediaTool = await loadMediaToolSpawner();
  return await new Promise<{ code: number | null; stdout: string; stderr: string; stopped: boolean }>((resolvePromise, reject) => {
    const child = spawnMediaTool(argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;

    // N-5 progress: poll the output directory for bytes written so far.
    const progressTimer = control.onProgress
      ? setInterval(() => { control.onProgress!(dirBytes(cwd)); }, 1000)
      : null;
    progressTimer?.unref?.();

    // N-5 Stop: aborting the signal kills the child in-flight.
    const onAbort = () => {
      stopped = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };
    if (control.signal) {
      if (control.signal.aborted) onAbort();
      else control.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (progressTimer) clearInterval(progressTimer);
      control.signal?.removeEventListener("abort", onAbort);
      resolvePromise({ code, stdout, stderr, stopped });
    });
  }).catch((error: unknown) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    stopped: false,
  }));
}

export async function captureMeetingCaptions(input: CaptionCaptureInput): Promise<CaptionCaptureResult> {
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const baseArgv = buildCaptionCaptureArgs(input);
  const { result: run, argv, playerClientUsed } = await runWithPlayerClientRetry(baseArgv, (attemptArgv) =>
    runYtdlp(attemptArgv, outputDir, { signal: input.signal, onProgress: input.onProgress }),
  );

  if (run.stopped) {
    return { ok: false, reason: "Capture stopped by the operator.", argv, stderr: run.stderr, stopped: true };
  }
  if (run.code !== 0) return classifyYtdlpFailure({ exitCode: run.code, stderr: run.stderr });
  const captionPath = findCaptionFile(outputDir, input.videoId);
  if (!captionPath) {
    return {
      ok: false,
      reason: "yt-dlp exited 0 but wrote no srv3 or vtt caption file",
      argv,
      stderr: run.stderr,
    };
  }
  let parsed: ParsedCaptionFile;
  try {
    parsed = parseCaptionFile(readFileSync(captionPath, "utf8"), captionPath);
  } catch (error) {
    return {
      ok: false,
      reason: `caption file has no text (parser rejected): ${error instanceof Error ? error.message : String(error)}`,
      argv,
      stderr: run.stderr,
    };
  }
  const { infoPath, info } = readInfo(outputDir, input.videoId);
  return {
    ok: true,
    parsed,
    infoPath,
    info,
    argv,
    stdout: run.stdout,
    stderr: run.stderr,
    playerClientUsed,
  };
}

export async function captureMeetingAudio(input: AudioCaptureInput): Promise<AudioCaptureResult> {
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const baseArgv = buildAudioCaptureArgs(input);
  const { result: run, argv, playerClientUsed } = await runWithPlayerClientRetry(baseArgv, (attemptArgv) =>
    runYtdlp(attemptArgv, outputDir, { signal: input.signal, onProgress: input.onProgress }),
  );
  if (run.stopped) {
    return { ok: false, reason: "Capture stopped by the operator.", argv, stderr: run.stderr, stopped: true };
  }
  if (run.code !== 0) {
    return {
      ok: false,
      reason: classifyYtdlpFailure({ exitCode: run.code, stderr: run.stderr }).reason,
      argv,
      stderr: run.stderr,
    };
  }
  const audioPath = findAudioFile(outputDir, input.videoId);
  if (!audioPath) {
    return {
      ok: false,
      reason: "yt-dlp exited 0 but wrote no audio file",
      argv,
      stderr: run.stderr,
    };
  }
  const bytes = readFileSync(audioPath);
  const { infoPath, info } = readInfo(outputDir, input.videoId);
  return {
    ok: true,
    audio: {
      path: audioPath,
      format: "opus",
      byteSize: statSync(audioPath).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    infoPath,
    info,
    argv,
    stdout: run.stdout,
    stderr: run.stderr,
    playerClientUsed,
  };
}

export function captionArtifactName(path: string): string {
  return basename(path);
}

export function hasCaptionArtifact(outputDir: string, videoId: string): boolean {
  return findCaptionFile(outputDir, videoId) !== null && existsSync(outputDir);
}
