// guards: a captionless meeting loses its transcript when Whistle receives a Whisper model size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTextflowkitArgs, resolveTextflowkitConfig } from "./textflowkit.ts";
test("meeting transcription names its engine and uses only that engine's model", () => {
  const args = (env: NodeJS.ProcessEnv) => buildTextflowkitArgs({ audioPath: "vote.wav", outputDir: "out", ...resolveTextflowkitConfig(env) });
  const base = ["transcribe", "vote.wav", "--formats", "json", "--output-dir", "out", "--engine", "whistle"];
  assert.deepEqual(args({}), [...base, "--language", "en"]);
  assert.deepEqual(args({ TEXTFLOWKIT_MODEL: "small" }), [...base, "--language", "en"]);
  assert.deepEqual(args({ TEXTFLOWKIT_MODEL: "whistle" }), [...base, "--model", "whistle", "--language", "en"]);
  for (const engine of ["whisper", "faster-whisper"]) {
    const prefix = [...base.slice(0, -1), engine, "--model"];
    assert.deepEqual(args({ TEXTFLOWKIT_ENGINE: engine }), [...prefix, "small", "--language", "en"]);
    assert.deepEqual(args({ TEXTFLOWKIT_ENGINE: engine, TEXTFLOWKIT_MODEL: "medium" }), [...prefix, "medium", "--language", "en"]);
  }
  assert.throws(() => args({ TEXTFLOWKIT_ENGINE: "typo" }), /TEXTFLOWKIT_ENGINE.*whistle.*whisper.*faster-whisper/);
});
