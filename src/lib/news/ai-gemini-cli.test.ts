import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ChatResult, ChatResultMetadata } from "./ai-result-metadata.ts";
import {
  findGeminiCli,
  geminiCliCandidates,
  geminiModelForEffort,
  geminiChat,
  probeGeminiCli,
  resetGeminiCliCache,
} from "./ai-gemini-cli.server.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const fakeCli = path.join(repoRoot, "scripts", "fakes", "fake-gemini-cli.mjs");

const MISSING_ERROR =
  "The Gemini program was not found on this server. Install it or set GEMINI_CLI_PATH.";
const SIGNED_OUT_ERROR =
  "The Gemini program is not signed in. Open a terminal on the server and run agy, then sign in with your Google account.";

type Env = Record<string, string | undefined>;

async function withEnv<T>(env: Env, fn: () => T | Promise<T>): Promise<T> {
  const keys = Object.keys(env);
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetGeminiCliCache();
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetGeminiCliCache();
  }
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

type Echo = {
  prompt: string;
  argv: string[];
  cwd: string;
  files: string[];
  events: number;
  env: { codexHome: string | null; apiKeyNames: string[]; hasServerSecret: boolean };
};

function echoOf(result: ChatResult): { echo: Echo; meta: ChatResultMetadata | undefined } {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return { echo: JSON.parse(result.text) as Echo, meta: result.meta };
}

const CHAT = {
  system: "system",
  user: "user",
  model: "gemini-3.8-flash-medium",
  timeoutMs: 10_000,
  reasoningEffort: "low",
} as const;

function fakeEnv(tmp: string, extra: Env = {}): Env {
  return {
    GEMINI_CLI_PATH: fakeCli,
    USERPROFILE: tmp,
    PATH: tmp,
    FAKE_GEMINI_SIGNED_OUT: undefined,
    FAKE_GEMINI_ERROR: undefined,
    FAKE_GEMINI_ECHO: undefined,
    FAKE_GEMINI_DELAY_MS: undefined,
    FAKE_GEMINI_NO_USAGE: undefined,
    FAKE_GEMINI_EXIT_CODE: undefined,
    FAKE_GEMINI_MODELS_COUNT_FILE: undefined,
    FAKE_GEMINI_PID_FILE: undefined,
    FAKE_GEMINI_CWD_FILE: undefined,
    ...extra,
  };
}

async function inTemp<T>(prefix: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = makeTempDir(prefix);
  try {
    return await fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function writeExecutable(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\nexit 0\n");
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}

async function waitFor(check: () => boolean, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test(
  "geminiCliCandidates orders explicit, USERPROFILE, then bare agy",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-candidates-", async (tmp) => {
      await withEnv({ GEMINI_CLI_PATH: fakeCli, USERPROFILE: tmp, PATH: tmp }, () => {
        assert.deepEqual(geminiCliCandidates(), [
          fakeCli,
          path.join(tmp, "Tools", "agy", "bin", "agy.exe"),
          "agy",
        ]);
      });
    });
  },
);

test(
  "findGeminiCli prefers USERPROFILE agy over PATH and falls back to PATH",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-find-", async (tmp) => {
      const binDir = path.join(tmp, "bin");
      const pathAgy = path.join(binDir, process.platform === "win32" ? "agy.exe" : "agy");
      writeExecutable(pathAgy);
      const profile = path.join(tmp, "profile");
      const profileAgy = path.join(profile, "Tools", "agy", "bin", "agy.exe");

      await withEnv(
        { GEMINI_CLI_PATH: undefined, USERPROFILE: profile, HOME: undefined, PATH: binDir },
        async () => {
          assert.equal(await findGeminiCli(), pathAgy);
          writeExecutable(profileAgy);
          assert.equal(await findGeminiCli(), profileAgy);
        },
      );
    });
  },
);

test(
  "an explicit missing path reports missing without falling back",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-missing-", async (tmp) => {
      const binDir = path.join(tmp, "bin");
      writeExecutable(path.join(binDir, process.platform === "win32" ? "agy.exe" : "agy"));
      await withEnv(
        { GEMINI_CLI_PATH: path.join(tmp, "missing-agy"), USERPROFILE: tmp, PATH: binDir },
        async () => {
          assert.equal(await findGeminiCli(), null);
          assert.deepEqual(await probeGeminiCli(), { ok: false, error: MISSING_ERROR });
          const chat = await geminiChat(CHAT);
          assert.equal(chat.ok, false);
          if (!chat.ok) {
            assert.equal(chat.error, MISSING_ERROR);
            assert.equal(chat.meta?.provider, "gemini-cli");
            assert.equal(chat.meta?.model, "gemini-3.8-flash-low");
            assert.equal(chat.meta?.timedOut, false);
          }
        },
      );
    });
  },
);

test("probeGeminiCli reports signed-out program", { concurrency: false }, async () => {
  await inTemp("gemini-cli-signedout-", async (tmp) => {
    await withEnv(fakeEnv(tmp, { FAKE_GEMINI_SIGNED_OUT: "1" }), async () => {
      assert.deepEqual(await probeGeminiCli(), { ok: false, error: SIGNED_OUT_ERROR });
    });
  });
});

test(
  "probeGeminiCli returns ok with the label for a ready fake CLI",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-ready-", async (tmp) => {
      await withEnv(fakeEnv(tmp), async () => {
        assert.deepEqual(await probeGeminiCli("Gemini (Pro plan)"), {
          ok: true,
          label: "Gemini (Pro plan)",
        });
      });
    });
  },
);

test("probeGeminiCli caches a result until forced", { concurrency: false }, async () => {
  await inTemp("gemini-cli-cache-", async (tmp) => {
    await withEnv(fakeEnv(tmp), async () => {
      assert.equal((await probeGeminiCli("G")).ok, true);

      process.env.FAKE_GEMINI_SIGNED_OUT = "1";
      assert.equal((await probeGeminiCli("G")).ok, true, "served from the cache");
      assert.deepEqual(await probeGeminiCli("G", true), { ok: false, error: SIGNED_OUT_ERROR });
      assert.equal((await probeGeminiCli("G")).ok, false, "the forced result replaces the cache");
    });
  });
});

test(
  "geminiModelForEffort maps effort onto the base, ignoring the catalog suffix",
  { concurrency: false },
  () => {
    for (const suffix of ["low", "medium", "high"]) {
      const flash = `gemini-3.8-flash-${suffix}`;
      assert.equal(geminiModelForEffort(flash, "low"), "gemini-3.8-flash-low");
      assert.equal(geminiModelForEffort(flash, "medium"), "gemini-3.8-flash-medium");
      assert.equal(geminiModelForEffort(flash, "high"), "gemini-3.8-flash-high");
      assert.equal(geminiModelForEffort(flash, undefined), flash);
    }
    for (const suffix of ["low", "high"]) {
      const pro = `gemini-3.1-pro-${suffix}`;
      assert.equal(geminiModelForEffort(pro, "low"), "gemini-3.1-pro-low");
      assert.equal(geminiModelForEffort(pro, "medium"), "gemini-3.1-pro-high");
      assert.equal(geminiModelForEffort(pro, "high"), "gemini-3.1-pro-high");
      assert.equal(geminiModelForEffort(pro, undefined), pro);
    }
    assert.equal(geminiModelForEffort("gemini-2.0-nope", "high"), null);
  },
);

test(
  "geminiChat sends one stdin user event, a 60k prompt off argv, in an empty temp cwd",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-chat-", async (tmp) => {
      const system = "SYS_" + "s".repeat(9996);
      const user = "USER_" + "u".repeat(49995);
      const result = await withEnv(
        fakeEnv(tmp, {
          FAKE_GEMINI_ECHO: "1",
          CODEX_HOME: path.join(tmp, "codex"),
          GEMINI_API_KEY: "k",
          OPENAI_API_KEY: "k",
          BETTER_AUTH_SECRET: "s",
        }),
        () => geminiChat({ ...CHAT, system, user }),
      );
      const { echo, meta } = echoOf(result);

      assert.equal(echo.events, 1, "exactly one NDJSON user event");
      assert.ok(echo.prompt.includes(user) && echo.prompt.includes(system));
      assert.ok(echo.prompt.length > 60_000);
      assert.ok(
        echo.argv.every((arg) => arg.length < 200),
        "no argument carries the prompt",
      );
      assert.deepEqual(echo.argv, [
        "--model",
        "gemini-3.8-flash-low",
        "--disable-slash-commands",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--print-timeout",
        "10s",
        "--print=",
      ]);

      assert.equal(
        fs.realpathSync(path.dirname(echo.cwd)),
        fs.realpathSync(os.tmpdir()),
        "cwd is a new directory directly under the temp root",
      );
      assert.ok(!path.resolve(echo.cwd).startsWith(repoRoot + path.sep));
      assert.deepEqual(echo.files, []);
      assert.equal(
        fs.existsSync(echo.cwd),
        false,
        "temporary cwd removed before the call resolved",
      );

      assert.equal(echo.env.codexHome, null, "CODEX_HOME is not passed");
      assert.deepEqual(echo.env.apiKeyNames, [], "no provider API key reaches the child");
      assert.equal(echo.env.hasServerSecret, false);

      assert.deepEqual(meta, {
        provider: "gemini-cli",
        model: "gemini-3.8-flash-low",
        durationMs: 10,
        timedOut: false,
        inputTokens: 12,
        outputTokens: 24,
        totalTokens: 36,
      });
    });
  },
);

test("geminiChat maps Pro medium to high", { concurrency: false }, async () => {
  await inTemp("gemini-cli-pro-", async (tmp) => {
    const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_ECHO: "1" }), () =>
      geminiChat({ ...CHAT, model: "gemini-3.1-pro-high", reasoningEffort: "medium" }),
    );
    const { echo, meta } = echoOf(result);
    assert.equal(echo.argv[1], "gemini-3.1-pro-high");
    assert.equal(meta?.model, "gemini-3.1-pro-high");
  });
});

test("geminiChat reports no counters the CLI did not report", { concurrency: false }, async () => {
  await inTemp("gemini-cli-nousage-", async (tmp) => {
    const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_NO_USAGE: "1" }), () =>
      geminiChat(CHAT),
    );
    assert.equal(result.ok, true);
    assert.ok(result.meta);
    for (const name of ["inputTokens", "outputTokens", "totalTokens"]) {
      assert.equal(name in result.meta, false, `${name} must be absent`);
    }
  });
});

test(
  "geminiChat returns the provider error words and does not throw",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-error-", async (tmp) => {
      const words = "provider error words exact preserved";
      const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_ERROR: words }), () =>
        geminiChat(CHAT),
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error, "Gemini says: " + words);
        assert.equal(result.meta?.provider, "gemini-cli");
        assert.equal(result.meta?.timedOut, false);
      }
    });
  },
);

test(
  "geminiChat reports an unsupported model without throwing",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-unsupported-", async (tmp) => {
      const result = await withEnv(fakeEnv(tmp), () =>
        geminiChat({ ...CHAT, model: "gemini-2.0-nope" }),
      );
      assert.equal(result.ok, false);
    });
  },
);

test(
  "geminiChat keeps the CLI sign-in words when no result was reported",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-chat-signedout-", async (tmp) => {
      const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_SIGNED_OUT: "1" }), () =>
        geminiChat(CHAT),
      );
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.equal(result.error, "Gemini says: Please sign in with your Google account.");
    });
  },
);

test(
  "geminiChat treats a success envelope with a non-zero exit as a failure",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-exit-", async (tmp) => {
      const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_EXIT_CODE: "1" }), () =>
        geminiChat(CHAT),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.meta?.provider, "gemini-cli");
    });
  },
);

test(
  "geminiChat passes fractional seconds to --print-timeout",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-fraction-", async (tmp) => {
      const result = await withEnv(fakeEnv(tmp, { FAKE_GEMINI_ECHO: "1" }), () =>
        geminiChat({ ...CHAT, timeoutMs: 1500 }),
      );
      const { echo } = echoOf(result);
      assert.equal(echo.argv[8], "1.5s");
    });
  },
);

test(
  "concurrent probes with different labels share one models process",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-shared-", async (tmp) => {
      const countFile = path.join(tmp, "models-count");
      await withEnv(fakeEnv(tmp, { FAKE_GEMINI_MODELS_COUNT_FILE: countFile }), async () => {
        const runs = () =>
          fs.existsSync(countFile) ? fs.readFileSync(countFile, "utf8").length / 2 : 0;
        const [flash, pro] = await Promise.all([probeGeminiCli("Flash"), probeGeminiCli("Pro")]);
        assert.deepEqual(flash, { ok: true, label: "Flash" });
        assert.deepEqual(pro, { ok: true, label: "Pro" });
        assert.equal(runs(), 1, "one models process for both labels");

        assert.deepEqual(await probeGeminiCli("Other"), { ok: true, label: "Other" });
        assert.equal(runs(), 1, "a third label is served from the cache");
      });
    });
  },
);

test(
  "geminiChat fails at the deadline, ends the owned process, then removes its cwd",
  { concurrency: false },
  async () => {
    await inTemp("gemini-cli-timeout-", async (tmp) => {
      const pidFile = path.join(tmp, "pid");
      const cwdFile = path.join(tmp, "cwd");
      const startedAt = Date.now();
      const result = await withEnv(
        fakeEnv(tmp, {
          FAKE_GEMINI_DELAY_MS: "60000",
          FAKE_GEMINI_PID_FILE: pidFile,
          FAKE_GEMINI_CWD_FILE: cwdFile,
        }),
        () => geminiChat({ ...CHAT, timeoutMs: 1500 }),
      );
      assert.ok(Date.now() - startedAt < 10_000, "returned near the deadline, not the fake delay");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.meta?.timedOut, true);
        assert.equal(result.meta?.provider, "gemini-cli");
      }

      assert.equal(await waitFor(() => fs.existsSync(pidFile) && fs.existsSync(cwdFile)), true);
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      const cwd = fs.readFileSync(cwdFile, "utf8");
      assert.equal(await waitFor(() => !alive(pid)), true, "owned process terminated");
      assert.equal(
        await waitFor(() => !fs.existsSync(cwd)),
        true,
        "cwd removed after the process closed",
      );
    });
  },
);
