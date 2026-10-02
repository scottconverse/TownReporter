import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

/*
  Unit R, the pure half.

  Nothing here touches a database or a real transcription. What is exercised is
  the set of decisions that must be right before a job is allowed to spend an
  hour of CPU: what argv is handed to the tool, what its JSON means, how long a
  run may take, and how a failure is phrased. The one test that does spawn uses
  the fake and a one-second allowance, so a timeout is proven in a second
  rather than in ninety.
*/

const {
  TEXTFLOWKIT_DEFAULT_MODEL,
  TEXTFLOWKIT_DEFAULT_LANGUAGE,
  TEXTFLOWKIT_SOURCE_METHOD,
  buildTextflowkitArgs,
  classifyTextflowkitFailure,
  parseTextflowkitJson,
  parseTextflowkitVersion,
  resolveTextflowkitConfig,
  textflowkitCaptionFile,
  textflowkitStatusLine,
  transcriptionTimeoutSeconds,
} = await import("./textflowkit.ts");

/** The measured output shape (identical on 0.1.6 and 0.1.8): `metadata`, `segments` with `words`, no top-level `text`. */
function measuredJson(): string {
  return `${JSON.stringify({
    source: "C:\\meetings\\clip60b.webm",
    language: "en",
    platform: "win32",
    duration: 15.0,
    engine: "whisper",
    metadata: { model: "small", device: "cpu" },
    segments: [
      {
        start: 0.0, end: 4.5, text: "Good evening, the council will come to order.",
        speaker: null, translated_text: null, hidden: false,
        words: [
          { start: 0.0, end: 0.35, text: "Good" },
          { start: 0.4, end: 0.75, text: "evening," },
        ],
      },
      {
        start: 4.5, end: 9.25, text: "Item one is the minutes of the last meeting.",
        speaker: null, translated_text: null, hidden: false,
        words: [{ start: 4.5, end: 4.85, text: "Item" }],
      },
    ],
  }, null, 2)}\n`;
}

describe("the configuration an operator states", () => {
  it("falls back to on-PATH textflowkit with the documented defaults", () => {
    const config = resolveTextflowkitConfig({});
    assert.equal(config.cliPath, "textflowkit");
    assert.equal(config.explicitPath, false);
    assert.equal(config.model, TEXTFLOWKIT_DEFAULT_MODEL);
    assert.equal(config.language, TEXTFLOWKIT_DEFAULT_LANGUAGE);
  });

  it("takes an explicit path and marks it explicit, because absence is then an operator error", () => {
    const config = resolveTextflowkitConfig({ TEXTFLOWKIT_CLI_PATH: "  D:\\tools\\textflowkit.exe  " });
    assert.equal(config.cliPath, "D:\\tools\\textflowkit.exe");
    assert.equal(config.explicitPath, true);
  });

  it("honours model, language and the timeout knobs", () => {
    const config = resolveTextflowkitConfig({
      TEXTFLOWKIT_MODEL: "medium",
      TEXTFLOWKIT_LANGUAGE: "es",
      TEXTFLOWKIT_TIMEOUT_FACTOR: "2",
      TEXTFLOWKIT_TIMEOUT_FLOOR_SECONDS: "1800",
    });
    assert.equal(config.model, "medium");
    assert.equal(config.language, "es");
    assert.equal(config.timeoutFactor, 2);
    assert.equal(config.timeoutFloorSeconds, 1800);
  });

  it("ignores a timeout knob that is not a positive number rather than accepting a zero-second allowance", () => {
    for (const junk of ["", "0", "-3", "soon", "NaN"]) {
      const config = resolveTextflowkitConfig({ TEXTFLOWKIT_TIMEOUT_FACTOR: junk, TEXTFLOWKIT_TIMEOUT_FLOOR_SECONDS: junk });
      assert.equal(config.timeoutFactor, 1.5, `factor from ${JSON.stringify(junk)}`);
      assert.equal(config.timeoutFloorSeconds, 600, `floor from ${JSON.stringify(junk)}`);
    }
  });
});

describe("what the CLI is asked to do", () => {
  it("builds an argument array, with the audio path as one argument even when it holds spaces and an ampersand", () => {
    const argv = buildTextflowkitArgs({
      audioPath: "D:\\City Council\\2026-09-15 & minutes.opus",
      outputDir: "D:\\tmp\\run-1",
      model: "small",
      language: "en",
    });
    assert.deepEqual(argv, [
      "transcribe",
      "D:\\City Council\\2026-09-15 & minutes.opus",
      "--formats", "json",
      "--output-dir", "D:\\tmp\\run-1",
      "--model", "small",
      "--language", "en",
    ]);
    assert.equal(argv.filter((part) => part === "D:\\City Council\\2026-09-15 & minutes.opus").length, 1);
  });

  it("reads the version the real CLI prints, and still says something when the line is not what was expected", () => {
    assert.equal(parseTextflowkitVersion("textflowkit 0.1.8\n"), "0.1.8");
    assert.equal(parseTextflowkitVersion("0.1.8"), "0.1.8");
    // The version the install ran before 0.1.8 still reads the same way.
    assert.equal(parseTextflowkitVersion("textflowkit 0.1.6\n"), "0.1.6");
    assert.equal(parseTextflowkitVersion("textflowkit 0.2\n"), "0.2");
    assert.equal(parseTextflowkitVersion("   \n"), null);
    assert.equal(parseTextflowkitVersion("textflowkit (unknown build)\n"), "textflowkit (unknown build)");
  });
});

describe("how long a transcription may take", () => {
  it("scales with the audio, because a 4-hour meeting and a 60-second clip cannot share one number", () => {
    const config = resolveTextflowkitConfig({});
    assert.equal(transcriptionTimeoutSeconds(790, config), 1785); // 1.5x + 10 min
    assert.equal(transcriptionTimeoutSeconds(15, config), 623);
  });

  it("uses the flat allowance when the capture never recorded a duration", () => {
    const config = resolveTextflowkitConfig({});
    for (const unknown of [null, undefined, 0, -1, Number.NaN]) {
      assert.equal(transcriptionTimeoutSeconds(unknown, config), 3600, `duration ${String(unknown)}`);
    }
  });

  it("follows the operator's own numbers", () => {
    assert.equal(transcriptionTimeoutSeconds(100, { timeoutFactor: 1, timeoutFloorSeconds: 60 }), 160);
    assert.equal(transcriptionTimeoutSeconds(100, { timeoutFactor: 0.5, timeoutFloorSeconds: 0 }), 50);
  });
});

describe("what the tool's JSON means", () => {
  it("reads the measured shape (0.1.6 and 0.1.8), joining the segments because that version writes no top-level text", () => {
    const transcript = parseTextflowkitJson(measuredJson());
    assert.equal(transcript.text, "Good evening, the council will come to order.\nItem one is the minutes of the last meeting.");
    assert.equal(transcript.model, "small");
    assert.equal(transcript.device, "cpu");
    assert.equal(transcript.language, "en");
    assert.equal(transcript.durationSeconds, 15);
    assert.equal(transcript.wordCount, 3, "the per-word timings are counted, not dropped");
    assert.deepEqual(transcript.segments.map((s) => [s.startSeconds, s.endSeconds, s.excerpt]), [
      [0, 4.5, "Good evening, the council will come to order."],
      [4.5, 9.25, "Item one is the minutes of the last meeting."],
    ]);
  });

  it("treats a file with no timestamped segment as a failure, not as an empty transcript", () => {
    assert.throws(
      () => parseTextflowkitJson(JSON.stringify({ segments: [{ text: "no timings here" }] })),
      /no timestamped segments with text/,
    );
  });

  it("refuses a document with no segments array at all", () => {
    assert.throws(() => parseTextflowkitJson(JSON.stringify({ text: "a transcript with no timings" })), /no segments array/);
  });

  it("names unparseable output as unparseable", () => {
    assert.throws(() => parseTextflowkitJson("{ not json"), /could not be parsed/);
  });

  it("keeps a segment that ends where it starts from becoming a negative span", () => {
    const transcript = parseTextflowkitJson(JSON.stringify({ segments: [{ start: 3, end: 1, text: "one word" }] }));
    assert.deepEqual(transcript.segments.map((s) => [s.startSeconds, s.endSeconds]), [[3, 3]]);
  });

  it("wraps the JSON bytes as a caption file, hashing the bytes that are actually stored", () => {
    const raw = measuredJson();
    const file = textflowkitCaptionFile("D:\\tmp\\run-1\\clip60b-ab12cd34.json", raw);
    assert.equal(file.format, TEXTFLOWKIT_SOURCE_METHOD);
    assert.equal(file.sourcePath, "D:\\tmp\\run-1\\clip60b-ab12cd34.json");
    assert.equal(file.segments?.length, 2);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    // The hash is of the file, so the same bytes hash the same and one changed
    // character does not.
    assert.equal(textflowkitCaptionFile("x.json", raw).sha256, file.sha256);
    assert.notEqual(textflowkitCaptionFile("x.json", `${raw} `).sha256, file.sha256);
  });
});

describe("how a failure is worded for the operator", () => {
  it("says the allowance was exceeded, and says the audio survives", () => {
    const reason = classifyTextflowkitFailure({ exitCode: null, stderr: "", timedOut: true, timeoutSeconds: 1785 });
    assert.match(reason, /timed out after 1785s/);
    assert.match(reason, /audio is kept/);
    assert.match(reason, /retried/);
  });

  it("carries the tool's own message and exit code", () => {
    const reason = classifyTextflowkitFailure({
      exitCode: 2, stderr: "  error: ffmpeg could not decode the audio stream\n", timedOut: false, timeoutSeconds: 623,
    });
    assert.equal(reason, "textflowkit exited 2: error: ffmpeg could not decode the audio stream");
  });

  it("does not pretend silence is an explanation", () => {
    assert.match(classifyTextflowkitFailure({ exitCode: 1, stderr: "", timedOut: false, timeoutSeconds: 60 }), /no message on stderr/);
  });
});

describe("the one line the desk shows", () => {
  it("says a missing tool means captionless meetings stay audio-only", () => {
    const line = textflowkitStatusLine({ installed: false, version: null, cliPath: "textflowkit", model: "small", language: "en" });
    assert.match(line, /not installed/);
    assert.match(line, /PATH/);
    assert.match(line, /stay audio-only/);
  });

  it("says WHY it could not be used when the operator named a path", () => {
    const line = textflowkitStatusLine({
      installed: false, version: null, cliPath: "D:\\tools\\textflowkit.exe", model: "small", language: "en",
      detail: "the configured textflowkit path could not be run (D:\\tools\\textflowkit.exe): ENOENT",
    });
    assert.match(line, /ENOENT/);
    assert.match(line, /stay audio-only/);
  });

  it("names the version, the path, the model and the language when it is there", () => {
    const line = textflowkitStatusLine({ installed: true, version: "0.1.8", cliPath: "textflowkit", model: "small", language: "en" });
    assert.match(line, /textflowkit 0\.1\.8/);
    assert.match(line, /model small/);
    assert.match(line, /language en/);
    assert.doesNotMatch(line, /audio-only/);
  });
});

describe("a run that will not stop", () => {
  const FAKE_CLI = join(process.cwd(), "scripts", "fakes", "fake-textflowkit.mjs");
  const saved = { path: process.env.TEXTFLOWKIT_CLI_PATH, mode: process.env.FAKE_TEXTFLOWKIT_MODE };

  after(() => {
    if (saved.path === undefined) delete process.env.TEXTFLOWKIT_CLI_PATH;
    else process.env.TEXTFLOWKIT_CLI_PATH = saved.path;
    if (saved.mode === undefined) delete process.env.FAKE_TEXTFLOWKIT_MODE;
    else process.env.FAKE_TEXTFLOWKIT_MODE = saved.mode;
  });

  it("is killed at the allowance for the audio and reported as a timeout, not as an exit", async () => {
    // The child's environment comes from the allow-list, so the fake is steered
    // through the same spawn path production uses.
    process.env.TEXTFLOWKIT_CLI_PATH = FAKE_CLI;
    process.env.FAKE_TEXTFLOWKIT_MODE = "hang";
    const { transcribeAudioWithTextflowkit } = await import("./textflowkit-cli.server.ts");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const outputDir = mkdtempSync(join(tmpdir(), "textflowkit-hang-"));
    try {
      const started = Date.now();
      const run = await transcribeAudioWithTextflowkit({
        audioPath: join(outputDir, "audio.opus"),
        outputDir,
        durationSeconds: 15,
        // A one-second allowance, so this proves the ceiling without waiting
        // for the real one. Resolved from the real env so the fake is the
        // executable, then overridden.
        config: { ...resolveTextflowkitConfig(process.env), timeoutFactor: 0, timeoutFloorSeconds: 1 },
      });
      assert.equal(run.ok, false);
      if (run.ok) return;
      assert.equal(run.timedOut, true);
      assert.match(run.reason, /timed out after 1s/);
      assert.ok(Date.now() - started < 30_000, "the allowance, not the test runner, ended this");
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("names a missing executable as a missing executable, whether it was configured or looked up", async () => {
    process.env.TEXTFLOWKIT_CLI_PATH = join(process.cwd(), "scripts", "fakes", "not-a-real-textflowkit.exe");
    const { transcribeAudioWithTextflowkit } = await import("./textflowkit-cli.server.ts");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const outputDir = mkdtempSync(join(tmpdir(), "textflowkit-missing-"));
    try {
      const run = await transcribeAudioWithTextflowkit({ audioPath: join(outputDir, "audio.opus"), outputDir, durationSeconds: 15 });
      assert.equal(run.ok, false);
      if (run.ok) return;
      assert.match(run.reason, /could not be run|not found on PATH/);
      assert.equal(run.timedOut, false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

});

describe("a tool that talks on stderr while it works (0.1.7 and later)", () => {
  /*
    From 0.1.7 the real tool streams live progress lines ("transcribing...",
    "rendering...") to stderr on a successful run; the JSON file and stdout are
    exactly what 0.1.6 produced. Stderr on a run that exited 0 is therefore not
    a failure and not part of the result: it is carried on the run for the log
    and nothing else changes.
  */
  const FAKE_CLI = join(process.cwd(), "scripts", "fakes", "fake-textflowkit.mjs");
  const saved = {
    path: process.env.TEXTFLOWKIT_CLI_PATH,
    stderr: process.env.FAKE_TEXTFLOWKIT_STDERR,
    mode: process.env.FAKE_TEXTFLOWKIT_MODE,
  };

  after(() => {
    for (const [name, value] of [
      ["TEXTFLOWKIT_CLI_PATH", saved.path],
      ["FAKE_TEXTFLOWKIT_STDERR", saved.stderr],
      ["FAKE_TEXTFLOWKIT_MODE", saved.mode],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function transcribeWith(stderrMode: string | undefined) {
    process.env.TEXTFLOWKIT_CLI_PATH = FAKE_CLI;
    delete process.env.FAKE_TEXTFLOWKIT_MODE;
    if (stderrMode === undefined) delete process.env.FAKE_TEXTFLOWKIT_STDERR;
    else process.env.FAKE_TEXTFLOWKIT_STDERR = stderrMode;
    const { transcribeAudioWithTextflowkit } = await import("./textflowkit-cli.server.ts");
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const outputDir = mkdtempSync(join(tmpdir(), "textflowkit-stderr-"));
    try {
      const audioPath = join(outputDir, "audio.opus");
      writeFileSync(audioPath, "opus-bytes");
      const run = await transcribeAudioWithTextflowkit({ audioPath, outputDir, durationSeconds: 15 });
      if (!run.ok) throw new Error(`the stand-in run failed: ${run.reason}`);
      return { run, json: readFileSync(run.jsonPath, "utf8") };
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }

  it("carries the progress lines but gives the same transcript, counts and bytes as a silent run", async () => {
    const quiet = await transcribeWith(undefined);
    const chatty = await transcribeWith("progress");

    assert.equal(quiet.run.stderr, "", "the 0.1.6-style run says nothing on stderr");
    assert.match(chatty.run.stderr, /transcribing\.\.\./);
    assert.match(chatty.run.stderr, /rendering\.\.\./);

    // Everything the product reads is unchanged by the noise.
    // The one field that differs is `source`, the audio path inside each run's own temp folder.
    const withoutSource = (text: string) => {
      const { source: _source, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return rest;
    };
    assert.deepEqual(withoutSource(chatty.json), withoutSource(quiet.json), "the JSON the tool wrote is the same document");
    assert.equal(chatty.run.wordCount, quiet.run.wordCount);
    assert.equal(chatty.run.model, quiet.run.model);
    assert.equal(chatty.run.device, quiet.run.device);
    assert.equal(chatty.run.durationSeconds, quiet.run.durationSeconds);
    // stdout names the JSON path inside each run's own temp folder, so it is compared by shape.
    assert.match(chatty.run.stdout, /\.json/);
    assert.match(quiet.run.stdout, /\.json/);
  });

  it("still reads the version when the probe runs against the 0.1.8 stand-in", async () => {
    process.env.TEXTFLOWKIT_CLI_PATH = FAKE_CLI;
    delete process.env.FAKE_TEXTFLOWKIT_MODE;
    process.env.FAKE_TEXTFLOWKIT_STDERR = "progress";
    const { probeTextflowkit } = await import("./textflowkit-cli.server.ts");
    const probe = await probeTextflowkit();
    assert.equal(probe.installed, true);
    assert.equal(probe.version, "0.1.8");
  });
});
