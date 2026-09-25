import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, linkSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnMediaTool } from "./media-tool-process.server.ts";

/*
  yt-dlp is a python program started as a child of this server, and its input is
  a URL fetched from the open web. It belongs to the same class as the agent
  CLIs: it must be handed a named allow-list, not a copy of the environment this
  server was started with.

  The measurement has to be taken inside the child. A parent that spreads
  `process.env` and one that hands over an allow-list look identical from inside
  the parent, so the stand-in `python` below writes its own environment out and
  the assertions read that dump. (`scripts/fakes/fake-env-cli.mjs` is the same
  trick for the provider CLIs.)

  The stand-in is this runtime: the fake `python` on PATH is a link to the Node
  binary, so the argv below is a Node expression rather than the yt-dlp argv.
  What is under test is the spawn, not the arguments -- and the real argv cannot
  be used here, because `python` resolves from PATH with no `*_CLI_PATH`-style
  seam to point at a fake and no yt-dlp installed in this environment.
*/

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What a leaked environment would carry in production.
 *
 * `DATABASE_URL` is here because the paper's connection string is the leak that
 * matters most, and the port is deliberately NOT the one the live paper uses:
 * nothing in this path opens a database, and a canary that could never be
 * dialled keeps it that way even if a future caller does.
 */
const SECRETS: Record<string, string> = {
  BETTER_AUTH_SECRET: "k-test-better-auth-secret",
  DATABASE_URL: "postgres://k-test-user:k-test-password@127.0.0.1:5999/k-test",
  GROK_AUTH_CLIENT_SECRET: "k-test-grok-client-secret",
  ANTHROPIC_API_KEY: "k-test-anthropic-key",
  OPENAI_API_KEY: "k-test-openai-key",
  TOWNREPORTER_SECRET: "k-test-townreporter-secret",
};

/** Names a media tool genuinely needs, pinned so they cannot be dropped. */
const KEPT: Record<string, string> = {
  HTTP_PROXY: "http://proxy.test.invalid:3128",
  HTTPS_PROXY: "http://proxy.test.invalid:3128",
  SSL_CERT_FILE: "/pinned/ca-bundle.crt",
  REQUESTS_CA_BUNDLE: "/pinned/ca-bundle.crt",
  LANG: "en_US.UTF-8",
  TZ: "America/Denver",
  PYTHONUTF8: "1",
  PYTHONPATH: "/pinned/py-modules",
  VIRTUAL_ENV: "/pinned/venv",
};

const DUMP_ENV = 'require("node:fs").writeFileSync(process.env.FAKE_ENV_DUMP, JSON.stringify(process.env))';

async function withEnv<T>(
  changes: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(changes)) {
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * A directory holding a `python` that is this runtime, for PATH to find.
 *
 * Linked rather than copied where the filesystem allows it: the point is a file
 * the OS will execute under the name `python`, and the Node binary is already
 * on this machine.
 */
function fakePythonDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tr-media-tool-bin-"));
  const target = join(dir, process.platform === "win32" ? "python.exe" : "python");
  try {
    linkSync(process.execPath, target);
  } catch {
    copyFileSync(process.execPath, target);
  }
  if (process.platform !== "win32") chmodSync(target, 0o755);
  return dir;
}

/** Spawn once through the real runner and return the environment the child saw. */
async function childEnvOf(argv: string[]): Promise<Record<string, string>> {
  const binDir = fakePythonDir();
  const dir = mkdtempSync(join(tmpdir(), "tr-media-tool-dump-"));
  const dump = join(dir, "env.json");
  try {
    await withEnv(
      {
        ...SECRETS,
        ...KEPT,
        FAKE_ENV_DUMP: dump,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      async () => {
        const child = spawnMediaTool(argv, { stdio: ["ignore", "pipe", "pipe"] });
        const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
          let stderr = "";
          child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
          child.on("error", (error) => resolve({ code: null, stderr: String(error) }));
          child.on("close", (code) => resolve({ code, stderr }));
        });
        assert.equal(result.code, 0, `the stand-in python failed to run: ${result.stderr}`);
      },
    );
    return JSON.parse(readFileSync(dump, "utf8")) as Record<string, string>;
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a spawned media tool gets an allow-list, not this server's environment", () => {
  it("hands the python child no credential, and keeps what yt-dlp cannot run without", async () => {
    const env = await childEnvOf(["-e", DUMP_ENV]);

    assert.ok(Object.keys(env).length > 0, "the stand-in python should have dumped its environment");

    for (const name of Object.keys(SECRETS)) {
      assert.equal(env[name], undefined, `the python child was handed ${name}`);
    }
    // The rule, not just the list: nothing credential-shaped gets through.
    for (const name of Object.keys(env)) {
      assert.doesNotMatch(
        name,
        /^GROK_|_API_KEY$|_SECRET$|_TOKEN$/,
        `the python child was handed ${name}, and that name is credential-shaped`,
      );
    }

    // yt-dlp is a python program that downloads from the open web: without
    // these it cannot resolve itself, fetch, verify a certificate, or write its
    // scratch files.
    for (const [name, value] of Object.entries(KEPT)) {
      assert.equal(env[name], value, `a media tool must keep ${name}`);
    }
    assert.ok(env.PATH, "a child that cannot resolve a command cannot start");
    assert.ok(
      env.TEMP || env.TMP || env.TMPDIR,
      "yt-dlp writes its fragments and its cache through the temp directory",
    );
    assert.ok(
      env.USERPROFILE || env.HOME,
      "yt-dlp resolves its cache and its cookies file from the user's home",
    );
    assert.ok(env.FAKE_ENV_DUMP, "the harness seam FAKE_* must pass through");
  });

  it("keeps the lowercase proxy names yt-dlp and ffmpeg actually read", async () => {
    // ffmpeg and yt-dlp both consult `http_proxy` in lowercase, and the
    // allow-list has to match names case-insensitively or the uppercase-only
    // corporate proxy configuration would work for the agent CLIs and not here.
    const binDir = fakePythonDir();
    const dir = mkdtempSync(join(tmpdir(), "tr-media-tool-lower-"));
    const dump = join(dir, "env.json");
    try {
      await withEnv(
        {
          http_proxy: "http://lower.test.invalid:3128",
          FAKE_ENV_DUMP: dump,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        },
        async () => {
          const child = spawnMediaTool(["-e", DUMP_ENV], { stdio: ["ignore", "pipe", "pipe"] });
          await new Promise<void>((resolve) => {
            child.on("error", () => resolve());
            child.on("close", () => resolve());
          });
        },
      );
      const env = JSON.parse(readFileSync(dump, "utf8")) as Record<string, string>;
      assert.equal(env.http_proxy, "http://lower.test.invalid:3128");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is the only place the desk starts python, so no call site can skip the allow-list", () => {
    /*
      The behavioural cases above measure the child this one function starts.
      This one pins that the three yt-dlp call sites go through it: a spawn
      written again at a call site would hand the child this server's whole
      environment again, and the dump above would never see it.
    */
    for (const file of ["youtube.ts", "meeting-capture-ytdlp.ts"]) {
      const source = readFileSync(join(SRC_DIR, file), "utf8");
      assert.doesNotMatch(source, /spawn\(\s*"python"/, `${file} spawns python outside the runner`);
      assert.match(source, /spawnMediaTool\(/, `${file} must start python through the runner`);
    }
    const runner = readFileSync(join(SRC_DIR, "media-tool-process.server.ts"), "utf8");
    assert.match(runner, /spawn\(MEDIA_TOOL/, "the runner is where the python child is started");
  });
});
