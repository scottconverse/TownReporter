import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn as spawnCp } from "node:child_process";
import {
  LOGIN_LIMIT_MS,
  cancelProviderLogin,
  ensureProviderLoginsSchema,
  firstHttpsUrl,
  getProviderLogin,
  isProviderId,
  lastLine,
  latestProviderLogin,
  parseClaudeLogin,
  parseCodexLogin,
  redactSecrets,
  resetProviderLoginStartupSweepForTest,
  startProviderLogin,
  stripAnsi,
} from "./provider-login.server.ts";
import { assertOwner } from "./provider-login.ts";
import { ForbiddenError } from "./membership.ts";
import { isNodeScript, spawnPlan } from "./cli-spawn.server.ts";
import { getSql } from "../db.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/*
  The escape byte, built rather than typed.

  scripts/no-control-characters.test.mjs refuses a raw control character in any
  source file, and it is right to: the last one that reached disk was a literal
  backspace inside a regex that could therefore never match. The captured Codex
  output below is coloured, so the colour codes are assembled here.
*/
const ESC = String.fromCharCode(27);
const dim = (text: string) => `${ESC}[90m${text}${ESC}[0m`;
const blue = (text: string) => `${ESC}[94m${text}${ESC}[0m`;

/*
  What the real CLIs printed on this machine, 2026-09-02
  (artifacts/signin-spike-2026-09-02/). The one-time code is the redaction that
  was captured -- which is a fair test of a POSITIONAL parser and a deliberately
  unfair one for a parser that guesses the code's alphabet. That is the point:
  the shape of a device code is not something this codebase gets to assume.
*/
const CLAUDE_LOGIN_STDOUT = [
  "Opening browser to sign in…",
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile&code_challenge=dXKsY9Tnjk2bQE8fJAcmF8GgY8Z8-pShuNna8Cbfi_I&code_challenge_method=S256&state=YtNqvlaGw76DnqMPNEeqG5z73-9MVCZ-II18ovbUnfs",
  "Paste code here if prompted >",
].join("\n");

const CODEX_DEVICE_STDOUT = [
  "",
  `Welcome to Codex [v${dim("0.147.0")}]`,
  dim("OpenAI's command-line coding agent"),
  "",
  "Follow these steps to sign in with ChatGPT using device code authorization:",
  "",
  "1. Open this link in your browser and sign in to your account",
  `   ${blue("https://auth.openai.com/codex/device")}`,
  "",
  `2. Enter this one-time code ${dim("(expires in 15 minutes)")}`,
  `   ${blue("[REDACTED-DEVICE-CODE]")}`,
  "",
  dim(
    "Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.",
  ),
].join("\n");

/** The FIXED-port flow the desk must never use. Kept so a regression is loud. */
const CODEX_LOOPBACK_STDERR = [
  "Starting local login server on http://localhost:1455.",
  "If your browser did not open, navigate to this URL to authenticate:",
  "",
  "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
  "",
  "On a remote or headless machine? Use `codex login --device-auth` instead.",
].join("\n");

describe("what the CLIs actually printed", () => {
  it("finds the Claude authorize URL in the real captured stdout", () => {
    const { url } = parseClaudeLogin(CLAUDE_LOGIN_STDOUT);
    assert.ok(url);
    assert.match(url!, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    // The whole query string, not a prefix: a truncated authorize URL is a
    // link that opens and then fails, which is worse than no link.
    assert.match(url!, /state=YtNqvlaGw76DnqMPNEeqG5z73-9MVCZ-II18ovbUnfs$/);
  });

  it("does not mistake the prompt line for a URL", () => {
    const { url } = parseClaudeLogin(CLAUDE_LOGIN_STDOUT);
    assert.doesNotMatch(url!, /Paste/);
  });

  it("finds the Codex device URL and code through the colour codes", () => {
    const { url, code } = parseCodexLogin(CODEX_DEVICE_STDOUT);
    assert.equal(url, "https://auth.openai.com/codex/device");
    assert.equal(code, "[REDACTED-DEVICE-CODE]");
  });

  it("does not return the version number from the banner as the code", () => {
    const { code } = parseCodexLogin(CODEX_DEVICE_STDOUT);
    assert.doesNotMatch(code!, /0\.147/);
  });

  it("reads a device code of an ordinary shape too", () => {
    const { code } = parseCodexLogin(
      CODEX_DEVICE_STDOUT.replace("[REDACTED-DEVICE-CODE]", "H7KP-2QXR"),
    );
    assert.equal(code, "H7KP-2QXR");
  });

  it("falls back to the code's shape when the announcement line changes", () => {
    const { code } = parseCodexLogin("something new here\n\n   H7KP-2QXR\n");
    assert.equal(code, "H7KP-2QXR");
  });

  it("says nothing when there is nothing to say", () => {
    assert.deepEqual(parseCodexLogin("starting up"), { url: null, code: null });
    assert.deepEqual(parseClaudeLogin(""), { url: null });
  });

  it("reads the loopback flow's URL out of stderr, for the record", () => {
    // The desk does not use this mode, but stderr is parsed defensively and a
    // future CLI could move its output there.
    assert.match(firstHttpsUrl(CODEX_LOOPBACK_STDERR)!, /auth\.openai\.com\/oauth\/authorize/);
  });

  it("trims trailing punctuation off a URL printed inside a sentence", () => {
    assert.equal(firstHttpsUrl("go to https://example.org/a/b."), "https://example.org/a/b");
  });

  it("strips ANSI without touching square brackets in the text", () => {
    assert.equal(stripAnsi(blue("[REDACTED-DEVICE-CODE]")), "[REDACTED-DEVICE-CODE]");
  });
});

describe("nothing that looks like a secret is kept", () => {
  it("redacts an api-key shape", () => {
    assert.equal(redactSecrets("used sk-ant-abcdefghijkl"), "used [redacted]");
  });

  it("redacts a long opaque run", () => {
    assert.match(redactSecrets(`token ${"a".repeat(40)}`), /\[redacted\]/);
  });

  it("redacts a device code, which is shown live and never stored", () => {
    assert.equal(redactSecrets("code H7KP-2QXR expired"), "code [redacted] expired");
  });

  it("keeps an ordinary error sentence readable", () => {
    assert.equal(
      lastLine("first line\nSign-in was refused by the server.\n"),
      "Sign-in was refused by the server.",
    );
  });
});

describe("running a CLI whose path is a JavaScript entry point", () => {
  it("hands a .mjs to Node, not to the operating system", () => {
    assert.equal(isNodeScript("C:\\x\\fake-claude-cli.mjs"), true);
    const plan = spawnPlan("C:\\x\\fake.mjs", ["auth", "login"]);
    assert.equal(plan.command, process.execPath);
    assert.deepEqual(plan.args, ["C:\\x\\fake.mjs", "auth", "login"]);
  });

  it("leaves a real binary alone", () => {
    assert.deepEqual(spawnPlan("C:\\x\\claude.exe", ["auth"]), {
      command: "C:\\x\\claude.exe",
      args: ["auth"],
    });
  });
});

describe("owner-only", () => {
  it("refuses an invited editor", () => {
    assert.throws(() => assertOwner("editor"), ForbiddenError);
    assert.throws(() => assertOwner("editor"), /Only the owner/);
  });

  it("lets the owner through", () => {
    assert.doesNotThrow(() => assertOwner("owner"));
  });

  it("every server function here is gated by deskMiddleware AND the owner check", () => {
    const src = readFileSync(join(ROOT, "src/lib/news/provider-login.ts"), "utf8");
    const names = [...src.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);
    assert.ok(names.length >= 5, `expected the five panel calls, found ${names.join(", ")}`);
    for (const name of names) {
      const start = src.indexOf(`export const ${name} = createServerFn`);
      const next = names
        .map((n) => src.indexOf(`export const ${n} = createServerFn`))
        .filter((i) => i > start);
      const body = src.slice(start, next.length ? Math.min(...next) : src.length);
      assert.match(body, /\.middleware\(\[deskMiddleware\]\)/, `${name} has no deskMiddleware`);
      assert.match(body, /assertOwner\(context\.role\)/, `${name} has no owner check`);
    }
  });

  it("there is no sign-out anywhere in the panel or its calls", () => {
    // A deliberate product decision, not an omission: one mis-click would stop
    // the live paper, and a stale login is fixed by signing in again.
    for (const file of ["src/lib/news/provider-login.ts", "src/routes/desk.ops.tsx"]) {
      const src = readFileSync(join(ROOT, file), "utf8");
      assert.doesNotMatch(src, /signOutProvider|providerSignOut|"Sign out"/);
    }
  });
});

describe("the migration and the PGLite ensure agree", () => {
  it("declares the same columns in both places", () => {
    const migration = readFileSync(join(ROOT, "migrations/0027_provider_logins.sql"), "utf8");
    const runtime = readFileSync(join(ROOT, "src/lib/news/provider-login.server.ts"), "utf8");
    for (const column of [
      "newsroom_id",
      "provider",
      "status",
      "url",
      "code",
      "detail",
      "pid",
      "started_at",
      "updated_at",
      "finished_at",
    ]) {
      assert.match(migration, new RegExp(`\\b${column}\\b`), `migration lacks ${column}`);
      assert.match(runtime, new RegExp(`\\b${column}\\b`), `ensure lacks ${column}`);
    }
    assert.match(migration, /provider_logins_open_idx/);
    assert.match(runtime, /provider_logins_open_idx/);
  });
});

describe("the sign-in state machine, driven by a fake CLI", () => {
  const FAKE_CLAUDE = join(ROOT, "scripts/fakes/fake-claude-cli.mjs");
  const FAKE_CODEX = join(ROOT, "scripts/fakes/fake-codex-cli.mjs");
  const NEWSROOM = 1;

  function withEnv(vars: Record<string, string | undefined>) {
    const before: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      before[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return () => {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
  }

  /** Wait for the row to leave the open states, or give up. */
  async function settle(id: number, ms = 20_000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const sql = await getSql();
      const rows = await sql.query<{ status: string; url: string | null; code: string | null }>(
        "select status, url, code from provider_logins where id = $1",
        [id],
      );
      const row = rows[0];
      if (row && row.status !== "starting" && row.status !== "awaiting_user") return row;
      if (Date.now() > deadline) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("a login that exits after signing in ends done", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-signin-"));
    const state = join(dir, "signed-in");
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_STATE_FILE: state,
      FAKE_CLAUDE_MODE: "exit-ok",
      FAKE_CLAUDE_SIGNED_IN: undefined,
    });
    const { resetClaudeCliCache } = await import("./ai-claude-code.server.ts");
    resetClaudeCliCache();
    try {
      await ensureProviderLoginsSchema();
      const started = await startProviderLogin("claude", NEWSROOM);
      assert.ok(started.id > 0);
      const settled = await settle(started.id);
      assert.equal(settled?.status, "done");
      assert.ok(existsSync(state), "the fake CLI should have recorded the sign-in");
    } finally {
      restore();
      resetClaudeCliCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a login that exits without signing in ends failed, and says why", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_STATE_FILE: undefined,
      FAKE_CLAUDE_SIGNED_IN: undefined,
      FAKE_CLAUDE_MODE: "exit-fail",
    });
    const { resetClaudeCliCache } = await import("./ai-claude-code.server.ts");
    resetClaudeCliCache();
    try {
      const started = await startProviderLogin("claude", NEWSROOM);
      const settled = await settle(started.id);
      assert.equal(settled?.status, "failed");
      const row = await latestProviderLogin("claude", NEWSROOM);
      assert.match(row!.detail, /refused/i);
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("Codex publishes its URL and its code, and one attempt at a time", async () => {
    const restore = withEnv({
      CODEX_CLI_PATH: FAKE_CODEX,
      FAKE_CODEX_SIGNED_IN: undefined,
      FAKE_CODEX_STATE_FILE: undefined,
      FAKE_CODEX_MODE: "hang",
    });
    try {
      const started = await startProviderLogin("codex", NEWSROOM);
      // The URL and code arrive on the child's first write, not at start.
      const deadline = Date.now() + 20_000;
      let row = started;
      while (!row.code && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        row = (await latestProviderLogin("codex", NEWSROOM))!;
      }
      assert.equal(row.status, "awaiting_user");
      assert.equal(row.url, "https://auth.openai.com/codex/device");
      assert.equal(row.code, "FAKE-CODE");
      assert.ok(row.expiresInSeconds > 0);
      assert.ok(row.expiresInSeconds <= LOGIN_LIMIT_MS.codex / 1000);

      // A second press must not print a second code. Two live device codes and
      // no way to tell which one works is worse than a button that does nothing.
      const again = await startProviderLogin("codex", NEWSROOM);
      assert.equal(again.id, row.id);

      const cancelled = await cancelProviderLogin(row.id, NEWSROOM);
      assert.equal(cancelled?.status, "cancelled");
    } finally {
      restore();
    }
  });

  it("a provider that is not installed fails immediately rather than hanging", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: join(ROOT, "scripts/fakes/no-such-cli.mjs"),
      FAKE_CLAUDE_SIGNED_IN: undefined,
    });
    const { resetClaudeCliCache } = await import("./ai-claude-code.server.ts");
    resetClaudeCliCache();
    try {
      const started = await startProviderLogin("claude", NEWSROOM);
      assert.equal(started.status, "failed");
      assert.match(started.detail, /not installed/i);
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("only knows two providers", () => {
    assert.equal(isProviderId("claude"), true);
    assert.equal(isProviderId("codex"), true);
    assert.equal(isProviderId("gpt"), false);
    assert.equal(isProviderId(null), false);
  });
});

describe("ENG-06: never taskkill a PID this process does not still hold", () => {
  const NEWSROOM = 1;

  /*
    node:child_process's own `spawn` export cannot be replaced with
    node:test's `mock.method` (it is a non-configurable property on the
    built-in module), so "no taskkill happened" is proven the direct way
    instead: point a row at a REAL process this test spawned itself, run the
    code path under test, and then prove that process is still alive. If
    killTree had reached for a DB-read pid the way it used to, this dummy
    process — which is never added to the module's own `live` map — would be
    dead afterwards.
  */
  function spawnDummy(): { pid: number; kill: () => void } {
    const child = spawnCp(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (!child.pid) throw new Error("dummy process did not get a pid");
    return {
      pid: child.pid,
      kill: () => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      },
    };
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("cancelling a row absent from the live map performs no kill", async () => {
    // Consume any pending one-time startup sweep first, so it does not touch
    // the row this test is about to insert.
    await ensureProviderLoginsSchema();
    const dummy = spawnDummy();
    try {
      const sql = await getSql();
      const inserted = await sql.query<{ id: number }>(
        `insert into provider_logins (newsroom_id, provider, status, pid)
         values ($1, 'claude', 'awaiting_user', $2) returning id`,
        [NEWSROOM, dummy.pid],
      );
      const id = inserted[0]!.id;

      const result = await cancelProviderLogin(id, NEWSROOM);
      assert.equal(result?.status, "cancelled");
      assert.ok(
        isAlive(dummy.pid),
        "cancelling a row this process never spawned must not kill the pid it names",
      );
    } finally {
      dummy.kill();
    }
  });

  it("expiring a row absent from the live map performs no kill", async () => {
    await ensureProviderLoginsSchema();
    const dummy = spawnDummy();
    try {
      const sql = await getSql();
      const inserted = await sql.query<{ id: number }>(
        `insert into provider_logins (newsroom_id, provider, status, pid, started_at)
         values ($1, 'codex', 'awaiting_user', $2, now() - interval '1 hour') returning id`,
        [NEWSROOM, dummy.pid],
      );
      const id = inserted[0]!.id;

      // expiresInSeconds is 0 (started an hour ago), so polling it expires it.
      const { pollProviderLogin } = await import("./provider-login.server.ts");
      const result = await pollProviderLogin(id, NEWSROOM);
      assert.equal(result?.status, "expired");
      assert.ok(
        isAlive(dummy.pid),
        "expiring a row this process never spawned must not kill the pid it names",
      );
    } finally {
      dummy.kill();
    }
  });

  it("a startup sweep retires a pre-existing open row without a kill", async () => {
    await ensureProviderLoginsSchema();
    const dummy = spawnDummy();
    try {
      const sql = await getSql();
      const inserted = await sql.query<{ id: number }>(
        `insert into provider_logins (newsroom_id, provider, status, pid)
         values ($1, 'codex', 'awaiting_user', $2) returning id`,
        [NEWSROOM, dummy.pid],
      );
      const id = inserted[0]!.id;

      // Simulate this row surviving into a new process: the one-time sweep
      // has not run yet in this "process".
      resetProviderLoginStartupSweepForTest();

      await ensureProviderLoginsSchema(); // this is where the sweep fires
      const row = await getProviderLogin(id, NEWSROOM);
      assert.equal(row?.status, "expired");
      assert.ok(
        isAlive(dummy.pid),
        "the startup sweep must retire stale rows without ever killing the pid they name",
      );
    } finally {
      dummy.kill();
    }
  });

  it("the happy path still kills the real child this process holds", async () => {
    const restore = (() => {
      const before = {
        CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
        FAKE_CODEX_SIGNED_IN: process.env.FAKE_CODEX_SIGNED_IN,
        FAKE_CODEX_STATE_FILE: process.env.FAKE_CODEX_STATE_FILE,
        FAKE_CODEX_MODE: process.env.FAKE_CODEX_MODE,
      };
      process.env.CODEX_CLI_PATH = join(ROOT, "scripts/fakes/fake-codex-cli.mjs");
      delete process.env.FAKE_CODEX_SIGNED_IN;
      delete process.env.FAKE_CODEX_STATE_FILE;
      process.env.FAKE_CODEX_MODE = "hang";
      return () => {
        for (const [k, v] of Object.entries(before)) {
          if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
          else (process.env as Record<string, string>)[k] = v;
        }
      };
    })();
    try {
      const started = await startProviderLogin("codex", NEWSROOM);
      const cancelled = await cancelProviderLogin(started.id, NEWSROOM);
      assert.equal(cancelled?.status, "cancelled");
    } finally {
      restore();
    }
  });
});
