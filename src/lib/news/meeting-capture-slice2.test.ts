import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const parserPath = new URL("./caption-parse.ts", import.meta.url);
const runnerPath = new URL("./meeting-capture-ytdlp.ts", import.meta.url);

describe("meeting capture Slice 2 captions-first parser", () => {
  it("parses srv3 into text and hashes the exact caption bytes", async () => {
    assert.equal(existsSync(parserPath), true, "caption-parse.ts must exist");
    const { parseCaptionFile } = await import("./caption-parse.ts");
    const raw = '<?xml version="1.0" encoding="utf-8"?><timedtext format="3"><body><p t="0" d="1000">Hello <s>council</s></p><p t="1000" d="1000">Second line</p></body></timedtext>';
    const parsed = parseCaptionFile(raw, "captions.en.srv3");
    assert.equal(parsed.format, "srv3");
    assert.match(parsed.text, /Hello council/);
    assert.match(parsed.text, /Second line/);
    assert.equal(parsed.sha256.length, 64);
    assert.equal(parsed.sourcePath, "captions.en.srv3");
  });

  it("falls back to VTT when srv3 is not present", async () => {
    const { parseCaptionFile } = await import("./caption-parse.ts");
    const raw = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello from VTT\n\n00:00:01.000 --> 00:00:02.000\nSecond VTT line\n";
    const parsed = parseCaptionFile(raw, "captions.en.vtt");
    assert.equal(parsed.format, "vtt");
    assert.match(parsed.text, /Hello from VTT/);
    assert.match(parsed.text, /Second VTT line/);
  });
});

describe("meeting capture Slice 2 yt-dlp runner", () => {
  it("uses python -m yt_dlp with the exact caption-only argv", async () => {
    assert.equal(existsSync(runnerPath), true, "meeting-capture-ytdlp.ts must exist");
    const { buildCaptionCaptureArgs } = await import("./meeting-capture-ytdlp.ts");
    const args = buildCaptionCaptureArgs({
      videoId: "L1AnMLsLwtk",
      outputDir: "C:\\meetings\\1",
      archivePath: "C:\\meetings\\1\\yt-dlp-archive.txt",
      sleepSubtitles: 2,
      sleepRequests: 1,
    });
    assert.deepEqual(args.slice(0, 2), ["-m", "yt_dlp"]);
    for (const flag of [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--write-info-json",
      "--js-runtimes",
      "--sleep-subtitles",
      "--sleep-requests",
      "--download-archive",
    ]) assert.ok(args.includes(flag), `missing ${flag}`);
    assert.equal(args[args.indexOf("--sub-langs") + 1], "en");
    assert.equal(args[args.indexOf("--sub-format") + 1], "srv3/vtt/best");
    assert.equal(args[args.indexOf("--js-runtimes") + 1], "node");
    assert.ok(!args.includes("en.*"));
    assert.ok(!args.some((a) => a.includes("en-orig")));
    assert.ok(!args.includes("-f"));
    assert.ok(!args.includes("-x"));
    assert.ok(!args.includes("--audio-format"));
  });

  it("turns HTTP 429 and non-zero exit into named failures, not success", async () => {
    const { classifyYtdlpFailure } = await import("./meeting-capture-ytdlp.ts");
    assert.equal(classifyYtdlpFailure({ exitCode: 1, stderr: "HTTP Error 429: Too Many Requests" }).ok, false);
    assert.match(classifyYtdlpFailure({ exitCode: 1, stderr: "HTTP Error 429: Too Many Requests" }).reason, /429/);
    assert.equal(classifyYtdlpFailure({ exitCode: 2, stderr: "bad extractor" }).ok, false);
  });
});
