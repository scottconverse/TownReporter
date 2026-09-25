#!/usr/bin/env node
/**
 * A stand-in for the real `textflowkit` console script (unit R).
 *
 * Point `TEXTFLOWKIT_CLI_PATH` at this file. It answers the two invocations the
 * product makes, in the shapes the real 0.1.6 tool was measured to produce:
 *
 *   fake-textflowkit.mjs --version
 *     -> "textflowkit 0.1.6" on stdout, exit 0
 *
 *   fake-textflowkit.mjs transcribe <audio> --formats json --output-dir <dir> \
 *        --model small --language en
 *     -> writes `<stem>-<hex>.json` into <dir> and prints that path on stdout
 *
 * Everything steerable is a `FAKE_TEXTFLOWKIT_*` variable, because that prefix
 * is the one thing `cli-child-env.server.ts` passes through to every child --
 * so a test steers the fake through the same spawn path production uses,
 * without loosening the allow-list to make the test convenient. (The same
 * mechanism `scripts/fakes/fake-env-cli.mjs` uses to prove a child sees no
 * secrets.)
 *
 * The JSON is deliberately the 0.1.6 shape rather than a convenient one: no
 * top-level `text`, `metadata.{model,device}`, and segments carrying
 * `start`/`end`/`text` plus per-word timings. A fake that returns an easier
 * document would let a parser pass here and fail on a real recording.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);

// Report what this child was handed, when asked. Written before any exit so a
// failure path can still prove a negative about the environment.
const dump = process.env.FAKE_TEXTFLOWKIT_ENV_DUMP;
if (dump) writeFileSync(dump, JSON.stringify(process.env));

const mode = process.env.FAKE_TEXTFLOWKIT_MODE ?? "ok";

if (argv[0] === "--version" || argv.includes("--version")) {
  process.stdout.write(`textflowkit ${process.env.FAKE_TEXTFLOWKIT_VERSION ?? "0.1.6"}\n`);
  process.exit(mode === "version-fail" ? 1 : 0);
}

if (argv[0] === "doctor") {
  process.stdout.write("textflowkit doctor\n  ffmpeg: found\n  model: small\n");
  process.exit(0);
}

function argValue(name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

const audio = argv[1];
const outputDir = argValue("--output-dir");
if (!audio || !outputDir) {
  process.stderr.write("error: transcribe requires an audio file and --output-dir\n");
  process.exit(1);
}

if (mode === "hang") {
  // The parent's timeout is the only thing that ends this. Nothing is written,
  // which is what a real transcription killed mid-run leaves behind.
  setInterval(() => {}, 1 << 30);
} else if (mode === "fail") {
  process.stderr.write(`error: ${process.env.FAKE_TEXTFLOWKIT_MESSAGE ?? "ffmpeg could not decode the audio stream"}\n`);
  process.exit(1);
} else if (mode === "nojson") {
  process.stdout.write("");
  process.exit(0);
} else {
  const segments = process.env.FAKE_TEXTFLOWKIT_SEGMENTS
    ? JSON.parse(process.env.FAKE_TEXTFLOWKIT_SEGMENTS)
    : [
        { start: 0.0, end: 4.5, text: "Good evening, the council will come to order." },
        { start: 4.5, end: 9.25, text: "Item one is the minutes of the last meeting." },
        { start: 9.25, end: 15.0, text: "All in favour of adopting the minutes, please raise your hand." },
      ];
  const words = (segmentText, start) =>
    segmentText.split(" ").map((text, index) => ({
      start: Number((start + index * 0.4).toFixed(2)),
      end: Number((start + index * 0.4 + 0.35).toFixed(2)),
      text,
    }));
  const body = {
    source: audio,
    language: argValue("--language") ?? "en",
    platform: process.platform,
    duration: Number(process.env.FAKE_TEXTFLOWKIT_DURATION ?? "15.0"),
    engine: "whisper",
    metadata: {
      model: process.env.FAKE_TEXTFLOWKIT_MODEL ?? argValue("--model") ?? "small",
      device: process.env.FAKE_TEXTFLOWKIT_DEVICE ?? "cpu",
    },
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: null,
      translated_text: null,
      hidden: false,
      words: words(segment.text, segment.start),
    })),
  };
  if (mode === "garbage") {
    writeFileSync(join(outputDir, "broken.json"), "{ not json at all");
    process.exit(0);
  }
  mkdirSync(outputDir, { recursive: true });
  const digest = createHash("sha256").update(audio).digest("hex").slice(0, 8);
  const stem = basename(audio).replace(/\.[^.]+$/, "");
  const target = join(outputDir, `${stem}-${digest}.json`);
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
  // The real CLI prints every path it wrote, one per line, on stdout.
  process.stdout.write(`${target}\n`);
  process.exit(process.env.FAKE_TEXTFLOWKIT_EXIT_CODE ? Number(process.env.FAKE_TEXTFLOWKIT_EXIT_CODE) : 0);
}
