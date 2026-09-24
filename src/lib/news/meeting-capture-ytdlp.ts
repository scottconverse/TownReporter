import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseCaptionFile, type ParsedCaptionFile } from "./caption-parse.ts";
import { parseInfoSidecar, type ParsedInfoSidecar } from "./meeting-capture-info.ts";

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
  const { spawn } = await import("node:child_process");
  return await new Promise<{ code: number | null; stdout: string; stderr: string; stopped: boolean }>((resolvePromise, reject) => {
    const child = spawn("python", argv, {
      cwd,
      shell: false,
      windowsHide: true,
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
  const argv = buildCaptionCaptureArgs(input);
  const run = await runYtdlp(argv, outputDir, { signal: input.signal, onProgress: input.onProgress });

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
  };
}

export async function captureMeetingAudio(input: AudioCaptureInput): Promise<AudioCaptureResult> {
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const argv = buildAudioCaptureArgs(input);
  const run = await runYtdlp(argv, outputDir, { signal: input.signal, onProgress: input.onProgress });
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
  };
}

export function captionArtifactName(path: string): string {
  return basename(path);
}

export function hasCaptionArtifact(outputDir: string, videoId: string): boolean {
  return findCaptionFile(outputDir, videoId) !== null && existsSync(outputDir);
}
