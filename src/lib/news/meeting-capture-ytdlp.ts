import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseCaptionFile, type ParsedCaptionFile } from "./caption-parse.ts";
import { parseInfoSidecar, type ParsedInfoSidecar } from "./meeting-capture-info.ts";

export type CaptionCaptureInput = {
  videoId: string;
  outputDir: string;
  archivePath: string;
  sleepSubtitles?: number;
  sleepRequests?: number;
};

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
};

export type CaptionCaptureResult = CaptionCaptureSuccess | CaptionCaptureFailure;

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

export async function captureMeetingCaptions(input: CaptionCaptureInput): Promise<CaptionCaptureResult> {
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const argv = buildCaptionCaptureArgs(input);
  const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("python", argv, {
      cwd: outputDir,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  }).catch((error: unknown) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

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
  const parsed = parseCaptionFile(readFileSync(captionPath, "utf8"), captionPath);
  const infoPath = findInfoFile(outputDir, input.videoId);
  let info: ParsedInfoSidecar = { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null };
  if (infoPath) {
    try {
      info = parseInfoSidecar(JSON.parse(readFileSync(infoPath, "utf8")));
    } catch {
      info = { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null };
    }
  }
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

export function captionArtifactName(path: string): string {
  return basename(path);
}

export function hasCaptionArtifact(outputDir: string, videoId: string): boolean {
  return findCaptionFile(outputDir, videoId) !== null && existsSync(outputDir);
}
