import { describe, it } from "node:test";
import assert from "node:assert/strict";

const runnerPath = new URL("./meeting-capture-ytdlp.ts", import.meta.url);

describe("meeting capture M-1 audio-required fallback", () => {
  it("builds an audio capture argv with -x, opus, and quality 5", async () => {
    const mod = await import("./meeting-capture-ytdlp.ts");
    assert.equal(typeof mod.buildAudioCaptureArgs, "function", "buildAudioCaptureArgs must exist for the audio fallback branch");
    const args = mod.buildAudioCaptureArgs({
      videoId: "AYkGlzLLIxc",
      outputDir: "C:\\meetings\\1",
      archivePath: "C:\\meetings\\1\\yt-dlp-archive.txt",
    });
    assert.deepEqual(args.slice(0, 2), ["-m", "yt_dlp"]);
    assert.ok(args.includes("-x"), "must extract audio");
    assert.equal(args[args.indexOf("--audio-format") + 1], "opus");
    assert.equal(args[args.indexOf("--audio-quality") + 1], "5");
    assert.ok(args.includes("--write-info-json"));
    assert.ok(args.includes("--download-archive"));
    assert.ok(!args.includes("--write-subs"), "audio branch must not request subtitles");
    assert.ok(!args.includes("--skip-download"), "audio branch must download audio");
  });

  it("normal caption path never captures audio", async () => {
    const mod = await import("./meeting-capture-ytdlp.ts");
    const args = mod.buildCaptionCaptureArgs({ videoId: "L1AnMLsLwtk", outputDir: "C:\\m\\1", archivePath: "C:\\m\\1\\a.txt" });
    assert.ok(!args.includes("-x"));
    assert.ok(!args.includes("--audio-format"));
  });

  it("detects the audio-required condition from a caption failure reason", async () => {
    const mod = await import("./meeting-capture-ytdlp.ts");
    assert.equal(typeof mod.requiresAudioFallback, "function", "requiresAudioFallback must exist");
    assert.equal(mod.requiresAudioFallback({ ok: false, reason: "yt-dlp exited 0 but wrote no srv3 or vtt caption file", argv: [], stderr: "" }), true);
    assert.equal(mod.requiresAudioFallback({ ok: false, reason: "caption file has no text", argv: [], stderr: "" }), true);
    assert.equal(mod.requiresAudioFallback({ ok: false, reason: "yt-dlp rate limited (HTTP 429)", argv: [], stderr: "" }), false);
  });
});
