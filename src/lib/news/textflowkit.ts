import { createHash } from "node:crypto";
import type { ParsedCaptionFile, ParsedCaptionSegment } from "./caption-parse.ts";

/*
  R: speech-to-text for meetings that have no captions.

  textflowkit is the owner's own Apache-2.0 Python tool. It is NOT bundled with
  TownReporter and is never installed by the Windows installer -- it is an
  optional external CLI an operator installs themselves, exactly like the
  yt-dlp path the meeting capture already depends on. When it is absent,
  meetings without captions stay audio-only, which is what the product did
  before this unit existed.

  This module is the PURE half: what argv to build, what the JSON means, how
  long a run may take, and how to phrase a failure. Nothing here spawns,
  touches a database, or reads `process.env` at module scope -- the spawn lives
  in `textflowkit-cli.server.ts` and the job in `textflowkit-transcribe.server.ts`,
  so the parsing rules can be exercised without a Python interpreter present.
*/

/** What `meeting_transcript_artifacts.format` and `caption_format` record. */
export const TEXTFLOWKIT_SOURCE_METHOD = "textflowkit-json";

export const TEXTFLOWKIT_DEFAULT_MODEL = "small";
export const TEXTFLOWKIT_DEFAULT_LANGUAGE = "en";

/**
 * A transcription is bounded by the audio it is given, not by a flat wall
 * clock. Measured on this machine (CPU, model `small`): 790 s of council audio
 * in 167 s, about 0.21x realtime. The default allowance is far looser than
 * that measurement because the operator's machine is not this one: 1.5x the
 * audio plus ten minutes still refuses a hung process while never refusing a
 * slow laptop. Both numbers are configurable, because the right allowance is a
 * property of the host, not of the product.
 */
export const TEXTFLOWKIT_DEFAULT_TIMEOUT_FACTOR = 1.5;
export const TEXTFLOWKIT_DEFAULT_TIMEOUT_FLOOR_SECONDS = 600;
/** When the capture never recorded a duration, there is nothing to scale by. */
export const TEXTFLOWKIT_DEFAULT_TIMEOUT_UNKNOWN_SECONDS = 3600;

export type TextflowkitConfig = {
  /** The executable to spawn: the configured path, or the bare name for PATH lookup. */
  cliPath: string;
  /** True when `TEXTFLOWKIT_CLI_PATH` named it, which makes absence an operator error rather than a missing optional tool. */
  explicitPath: boolean;
  model: string;
  language: string;
  timeoutFactor: number;
  timeoutFloorSeconds: number;
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolve the settings from the environment.
 *
 * The env is a parameter rather than `process.env` so a test can state the
 * configuration it is asserting about instead of mutating the real one.
 */
export function resolveTextflowkitConfig(env: NodeJS.ProcessEnv = {}): TextflowkitConfig {
  const explicit = (env.TEXTFLOWKIT_CLI_PATH ?? "").trim();
  return {
    cliPath: explicit || "textflowkit",
    explicitPath: explicit.length > 0,
    model: (env.TEXTFLOWKIT_MODEL ?? "").trim() || TEXTFLOWKIT_DEFAULT_MODEL,
    language: (env.TEXTFLOWKIT_LANGUAGE ?? "").trim() || TEXTFLOWKIT_DEFAULT_LANGUAGE,
    timeoutFactor: positiveNumber(env.TEXTFLOWKIT_TIMEOUT_FACTOR, TEXTFLOWKIT_DEFAULT_TIMEOUT_FACTOR),
    timeoutFloorSeconds: positiveNumber(env.TEXTFLOWKIT_TIMEOUT_FLOOR_SECONDS, TEXTFLOWKIT_DEFAULT_TIMEOUT_FLOOR_SECONDS),
  };
}

/**
 * `textflowkit --version` was measured against the real CLI (0.1.6, Windows
 * venv): it prints one line, `textflowkit 0.1.6`, and exits 0. `doctor` is not
 * used -- `--version` is the smaller surface and it is what the tool's own
 * argparse defines as a top-level flag. A tool that answers with something
 * else still counts as installed; the line is recorded verbatim rather than
 * guessed at.
 */
export function parseTextflowkitVersion(stdout: string): string | null {
  const text = stdout.trim();
  if (!text) return null;
  const match = text.match(/\b(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/);
  return match ? match[1]! : text.split(/\r?\n/)[0]!.trim().slice(0, 80) || null;
}

/**
 * The argv handed to the CLI. An argument array, never a shell string: the
 * audio path comes from a capture directory an operator configured, and it can
 * contain spaces, quotes and ampersands.
 *
 * `--formats json` only. The SRT and TXT forms are derivable from the JSON the
 * run already wrote, and asking for them would write two more files whose
 * bytes nothing hashes or stores.
 */
export function buildTextflowkitArgs(input: {
  audioPath: string;
  outputDir: string;
  model: string;
  language: string;
}): string[] {
  return [
    "transcribe",
    input.audioPath,
    "--formats",
    "json",
    "--output-dir",
    input.outputDir,
    "--model",
    input.model,
    "--language",
    input.language,
  ];
}

/** 1.5x the audio plus ten minutes, or the flat allowance when the duration is unknown. */
export function transcriptionTimeoutSeconds(
  durationSeconds: number | null | undefined,
  config: Pick<TextflowkitConfig, "timeoutFactor" | "timeoutFloorSeconds">,
): number {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return TEXTFLOWKIT_DEFAULT_TIMEOUT_UNKNOWN_SECONDS;
  return Math.ceil(duration * config.timeoutFactor + config.timeoutFloorSeconds);
}

export type TextflowkitTranscript = {
  text: string;
  segments: ParsedCaptionSegment[];
  durationSeconds: number | null;
  language: string | null;
  model: string | null;
  device: string | null;
  /** Present when the CLI reported per-word timings; kept, not projected away. */
  wordCount: number;
};

type RawSegment = {
  start?: unknown; end?: unknown; text?: unknown; words?: unknown;
};

/**
 * Read the canonical transcript out of textflowkit's JSON.
 *
 * The shape that matters is `segments[] {start, end, text, words[]}` plus
 * `metadata {model, device}` -- measured against 0.1.6 output. There is no
 * top-level `text` in that version, so the plain text is the segments joined;
 * inventing one from anywhere else would be a second copy of the same fact.
 *
 * A file with no timestamped segment is a failure, not an empty transcript.
 * Storing an empty revision would publish "this meeting said nothing".
 */
export function parseTextflowkitJson(raw: string): TextflowkitTranscript {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`textflowkit wrote JSON that could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = (parsed ?? {}) as {
    segments?: unknown; duration?: unknown; language?: unknown; metadata?: unknown;
  };
  if (!Array.isArray(root.segments)) throw new Error("textflowkit JSON has no segments array.");

  const segments: ParsedCaptionSegment[] = [];
  let wordCount = 0;
  for (const item of root.segments as RawSegment[]) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text || !Number.isFinite(start)) continue;
    if (Array.isArray(item?.words)) wordCount += (item.words as unknown[]).length;
    segments.push({
      startSeconds: start,
      endSeconds: Number.isFinite(end) && end > start ? end : start,
      excerpt: text,
    });
  }
  if (!segments.length) throw new Error("textflowkit JSON has no timestamped segments with text.");

  const metadata = (root.metadata ?? {}) as { model?: unknown; device?: unknown };
  const duration = Number(root.duration);
  return {
    text: segments.map((segment) => segment.excerpt).join("\n").trim(),
    segments,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    language: typeof root.language === "string" ? root.language : null,
    model: typeof metadata.model === "string" ? metadata.model : null,
    device: typeof metadata.device === "string" ? metadata.device : null,
    wordCount,
  };
}

/**
 * Wrap a textflowkit JSON file as the `ParsedCaptionFile` the existing revision
 * storage already knows how to store.
 *
 * The hash is of the ORIGINAL JSON BYTES. That is what makes the stored
 * artifact content-addressed and verifiable in the same way a caption file is:
 * the artifact on disk is the tool's own output, byte for byte, and the hash
 * recorded against every segment is a hash of that file. `meeting_transcript_segments`
 * has no column for per-word timings, so they survive exactly there -- in the
 * retained JSON beside the segments, not projected away.
 */
export function textflowkitCaptionFile(jsonPath: string, raw: string): ParsedCaptionFile {
  const transcript = parseTextflowkitJson(raw);
  return {
    text: transcript.text,
    format: TEXTFLOWKIT_SOURCE_METHOD,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    sourcePath: jsonPath,
    segments: transcript.segments,
  };
}

/**
 * A named failure an operator can act on. "textflowkit failed" is not a
 * reason; each of these says which of the three things went wrong -- the tool
 * is missing, it ran longer than the allowance for this audio, or it exited
 * with its own message.
 */
export function classifyTextflowkitFailure(input: {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  timeoutSeconds: number;
}): string {
  if (input.timedOut) {
    return `textflowkit timed out after ${input.timeoutSeconds}s; the audio is kept and the transcription can be retried`;
  }
  const detail = input.stderr.trim().slice(0, 300);
  return detail
    ? `textflowkit exited ${input.exitCode ?? "without a status"}: ${detail}`
    : `textflowkit exited ${input.exitCode ?? "without a status"} with no message on stderr`;
}

/** The one line the desk shows under "Meeting capture". */
export function textflowkitStatusLine(input: {
  installed: boolean;
  version: string | null;
  cliPath: string;
  model: string;
  language: string;
  detail?: string | null;
}): string {
  if (!input.installed) {
    return input.detail
      ? `Speech-to-text: ${input.detail} — meetings without captions stay audio-only`
      : `Speech-to-text: textflowkit not installed (looked for ${input.cliPath} and on PATH) — meetings without captions stay audio-only`;
  }
  const version = input.version ? ` ${input.version}` : "";
  return `Speech-to-text: textflowkit${version} found at ${input.cliPath} — model ${input.model}, language ${input.language}`;
}
