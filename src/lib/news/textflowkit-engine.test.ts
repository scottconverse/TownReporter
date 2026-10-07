// guards: a captionless meeting loses its transcript when Whistle receives a Whisper model size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTextflowkitArgs, resolveTextflowkitConfig } from "./textflowkit.ts";
test("meeting transcription names its engine and uses only that engine's model", () => {
  const args = (env: NodeJS.ProcessEnv) => buildTextflowkitArgs({ audioPath: "vote.wav", outputDir: "out", ...resolveTextflowkitConfig(env) });
  const base = ["transcribe", "vote.wav", "--formats", "json", "--output-dir", "out", "--engine", "whistle"];
  assert.deepEqual(args({}), [...base, "--language", "en"]);
  assert.deepEqual(args({ TEXTFLOWKIT_ENGINE: "whistle", TEXTFLOWKIT_MODEL: "small" }), [...base, "--language", "en"]);
  assert.deepEqual(args({ TEXTFLOWKIT_MODEL: "whistle" }), [...base, "--model", "whistle", "--language", "en"]);
  for (const engine of ["whisper", "faster-whisper"]) {
    const prefix = [...base.slice(0, -1), engine, "--model"];
    assert.deepEqual(args({ TEXTFLOWKIT_ENGINE: engine }), [...prefix, "small", "--language", "en"]);
    assert.deepEqual(args({ TEXTFLOWKIT_ENGINE: engine, TEXTFLOWKIT_MODEL: "medium" }), [...prefix, "medium", "--language", "en"]);
  }
  assert.throws(() => args({ TEXTFLOWKIT_ENGINE: "typo" }), /TEXTFLOWKIT_ENGINE.*whistle.*whisper.*faster-whisper/);
});
// guards: legacy model settings silently change the engine used for meeting transcripts.
test("a model-only setting preserves the Whisper engine and model", () => {
  const config = resolveTextflowkitConfig({ TEXTFLOWKIT_MODEL: "medium" });
  assert.equal(config.engine, "whisper");
  assert.equal(config.model, "medium");
});
// guards: captionless meetings on older CLIs lose their transcripts to an unsupported engine.
test("older CLIs transcribe with Whisper and disclose the fallback on the desk", async () => {
  const { probeTextflowkit, transcribeAudioWithTextflowkit } = await import("./textflowkit-cli.server.ts");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const saved = process.env.FAKE_TEXTFLOWKIT_VERSION;
  const dir = mkdtempSync(join(tmpdir(), "textflowkit-legacy-"));
  try {
    process.env.FAKE_TEXTFLOWKIT_VERSION = "0.1.8";
    const env = { TEXTFLOWKIT_CLI_PATH: join(process.cwd(), "scripts/fakes/fake-textflowkit.mjs"), TEXTFLOWKIT_MODEL: "whistle" };
    const probe = await probeTextflowkit({ env });
    const { textflowkitStatusLine } = await import("./textflowkit.ts");
    assert.match(textflowkitStatusLine(probe), /no Whistle.*whisper/i);
    const audioPath = join(dir, "vote.wav");
    writeFileSync(audioPath, "audio");
    const run = await transcribeAudioWithTextflowkit({ env, audioPath, outputDir: dir });
    assert.equal(run.ok && run.engine, "whisper");
    assert.equal(run.ok && run.model, "small");
  } finally {
    if (saved === undefined) delete process.env.FAKE_TEXTFLOWKIT_VERSION;
    else process.env.FAKE_TEXTFLOWKIT_VERSION = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
