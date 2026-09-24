import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexChat } from "./ai-codex.server.ts";
import { probeClaudeCode, claudeCodeChat } from "./ai-claude-code.server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAKE_ENV_CLI = join(ROOT, "scripts", "fakes", "fake-env-cli.mjs");

/**
 * Every name a spawned provider CLI must never see.
 *
 * These are the values a leaked environment would carry in production. They are
 * set in THIS provider's environment, then read back out of the CHILD -- which
 * is the only place the answer is meaningful: `env: { ...process.env }` leaves
 * the parent looking exactly the same as an allow-list does.
 */
const SECRETS: Record<string, string> = {
  BETTER_AUTH_SECRET: "k-test-better-auth-secret",
  GROK_AUTH_CLIENT_SECRET: "k-test-grok-client-secret",
  GROK_AUTH_CLIENT_ID: "k-test-grok-client-id",
  TOWNREPORTER_SECRET: "k-test-townreporter-secret",
  STRIPE_SECRET_KEY: "k-test-stripe-secret",
  OPENAI_API_KEY: "k-test-openai-key",
  OPENROUTER_API_KEY: "k-test-openrouter-key",
  AWS_SECRET_ACCESS_KEY: "k-test-aws-secret",
  SESSION_TOKEN: "k-test-session-token",
};

/**
 * The database URL, kept out of the set above on purpose.
 *
 * A fake `postgres://...:5433/...` in this process's environment is a realistic
 * leak to look for, but it is also a real connection string: the login test
 * below reaches `getSql()`, and PGlite is in use here precisely so that nothing
 * touches the PostgreSQL the live paper shares. So only the two drafting paths
 * -- which never open a database -- are handed it.
 */
const DATABASE_URL_SECRET = {
  DATABASE_URL: "postgres://k-test-user:k-test-password@127.0.0.1:5433/k-test",
};

/** `ANTHROPIC_API_KEY` is the one credential the Claude child is allowed. */
const CLAUDE_OWN_CREDENTIAL = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

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

/** Wait for a file a child writes, so a slow spawn is not read as "never ran". */
async function waitForFile(file: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await readFile(file, "utf8");
      return;
    } catch {
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Spawn one of the real provider paths with a fake CLI; return what it saw. */
async function childEnvOf(
  run: () => Promise<unknown>,
  extra: Record<string, string> = SECRETS,
): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "tr-child-env-"));
  const dump = join(dir, "env.json");
  try {
    await withEnv({ ...extra, FAKE_ENV_DUMP: dump }, run);
    // The login path returns as soon as the row is written, before its detached
    // child has done anything. Give the child a moment to write the dump.
    await waitForFile(dump, 15_000);
    return JSON.parse(await readFile(dump, "utf8")) as Record<string, string>;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertNoSecrets(
  env: Record<string, string>,
  who: string,
  allow: readonly string[] = [],
  watched: readonly string[] = Object.keys(SECRETS),
): void {
  for (const name of watched) {
    if (allow.includes(name)) continue;
    assert.equal(env[name], undefined, `${who} child was handed ${name}`);
  }
  // The rule, not just the list: nothing credential-shaped gets through.
  for (const name of Object.keys(env)) {
    if (allow.includes(name)) continue;
    assert.doesNotMatch(
      name,
      /^GROK_|_API_KEY$|_SECRET$|_TOKEN$/,
      `${who} child was handed ${name}, and that name is credential-shaped`,
    );
  }
}

/*
  Every case below pins CODEX_CLI_PATH / CLAUDE_CLI_PATH at
  scripts/fakes/fake-env-cli.mjs before it calls the real spawn path, so none of
  it can reach a live model or spend anything — no RUN_LIVE_MODEL_TESTS opt-in
  needed, on the same terms as the fake-CLI cases in ai-claude-code.test.ts. The
  fake reads its own environment and writes it out; that dump is the only place
  the answer to "what did the child get?" is meaningful, since a parent that
  spreads `process.env` and a parent that does not look identical from inside
  the parent.
*/
describe("a spawned provider CLI gets an allow-list, not this server's environment", () => {
  it("a Codex draft child never sees a secret, and can still find its login", async () => {
    const env = await childEnvOf(
      () =>
        withEnv({ CODEX_CLI_PATH: FAKE_ENV_CLI }, () =>
          codexChat({
            system: "System",
            user: "User",
            model: "gpt-5.6-sol",
            timeoutMs: 20_000,
          }).catch(() => undefined),
        ),
      { ...SECRETS, ...DATABASE_URL_SECRET },
    );

    assert.ok(Object.keys(env).length > 0, "the fake CLI should have dumped its environment");
    assertNoSecrets(env, "Codex", [], [...Object.keys(SECRETS), ...Object.keys(DATABASE_URL_SECRET)]);

    // Sign-in resolution: Codex finds its own credentials through these, so a
    // child missing them looks signed out no matter what the operator did.
    assert.ok(env.CODEX_HOME, "Codex needs CODEX_HOME to find the sign-in it already has");
    assert.ok(env.USERPROFILE || env.HOME, "Codex needs a home directory to resolve its state");
    assert.ok(env.PATH, "a child that cannot resolve a command cannot start");
    // The hermetic-harness seam: the fakes steer on `FAKE_*`, so those names
    // must survive the allow-list or no fake can be driven through the real
    // spawn path. (`FAKE_ENV_DUMP` itself is how this dump was written.)
    assert.ok(env.FAKE_ENV_DUMP, "the harness seam FAKE_* must pass through");
  });

  it("a Codex login child gets the same allow-list, so the sign-in lands where drafts look", async () => {
    const { startProviderLogin } = await import("./provider-login.server.ts");
    const env = await childEnvOf(() =>
      withEnv({ CODEX_CLI_PATH: FAKE_ENV_CLI }, () =>
        startProviderLogin("codex", 1).catch(() => undefined),
      ),
    );

    assert.ok(Object.keys(env).length > 0, "the fake CLI should have dumped its environment");
    assertNoSecrets(env, "Codex login");

    // The sign-in and the drafting calls must agree on where the home is, or a
    // login reports success and the draft still looks signed out.
    assert.ok(env.CODEX_HOME, "a login child needs the same CODEX_HOME the drafts use");
    assert.ok(env.USERPROFILE || env.HOME);
  });

  it("a Claude login child is allowed its own credential and nothing else", async () => {
    const env = await childEnvOf(() =>
      withEnv({ CLAUDE_CLI_PATH: FAKE_ENV_CLI, ANTHROPIC_API_KEY: "k-test-anthropic-key" }, () =>
        probeClaudeCode().catch(() => undefined),
      ),
    );

    assert.ok(Object.keys(env).length > 0, "the fake CLI should have dumped its environment");
    // ANTHROPIC_API_KEY is the documented alternative to signing in -- it is
    // the credential of the provider whose CLI this is, and only that one.
    assert.equal(env.ANTHROPIC_API_KEY, "k-test-anthropic-key");
    assertNoSecrets(env, "Claude", CLAUDE_OWN_CREDENTIAL);
    assert.ok(env.PATH);
  });

  it("a Claude draft child is allowed through with its credential and no other secret", async () => {
    const env = await childEnvOf(
      () =>
        withEnv({ CLAUDE_CLI_PATH: FAKE_ENV_CLI, ANTHROPIC_API_KEY: "k-test-anthropic-key" }, () =>
          claudeCodeChat({
            system: "System",
            user: "User",
            model: "claude-opus-5",
            timeoutMs: 20_000,
          }).catch(() => undefined),
        ),
      { ...SECRETS, ...DATABASE_URL_SECRET },
    );

    assert.ok(Object.keys(env).length > 0, "the fake CLI should have dumped its environment");
    assert.equal(env.ANTHROPIC_API_KEY, "k-test-anthropic-key");
    assertNoSecrets(env, "Claude draft", CLAUDE_OWN_CREDENTIAL, [
      ...Object.keys(SECRETS),
      ...Object.keys(DATABASE_URL_SECRET),
    ]);
    assert.ok(env.PATH);
    assert.ok(env.TEMP || env.TMP || env.TMPDIR, "a CLI needs scratch space");
  });

  it("passes NODE_OPTIONS through, which the CI harness drives the spawn path with", async () => {
    const env = await childEnvOf(() =>
      withEnv(
        { CODEX_CLI_PATH: FAKE_ENV_CLI, NODE_OPTIONS: "--max-old-space-size=512" },
        () =>
          codexChat({
            system: "System",
            user: "User",
            model: "gpt-5.6-sol",
            timeoutMs: 20_000,
          }).catch(() => undefined),
      ),
    );
    assert.equal(env.NODE_OPTIONS, "--max-old-space-size=512");
  });
});
