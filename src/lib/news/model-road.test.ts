/*
  Behavior tests for the model-road backlog rows (Oct 26 2026):
  G24-FO-3 (a 429 that ran into the clock reads as a usage limit, not "timed
  out"), G23-ENG-6 / G24-FO-1 (a Local pin never carries the cloud DeepSeek
  rung's call), G24-FO-2 (TOWNREPORTER_CLAUDE_CODE=0 also takes the CLI off the
  DeepSeek road) and TXB-2 (the chat path records the tools it used).
  Every model here is a fake: temp CLI scripts or injected adapters.
*/
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokChat, resolveProvider, type GrokChatAdapters } from "./ai.ts";
import { CLI_QUOTA_RETRY_NOTE, claudeCodeChat, resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { automaticFailoverReason } from "./automatic-failover.ts";

const DEEPSEEK = "deepseek-v4.1-flash:1017-cloud";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** A throwaway fake Claude CLI: `body` is the script's code. */
async function fakeCli(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tr-model-road-"));
  dirs.push(dir);
  const file = join(dir, "fake-claude.mjs");
  await writeFile(file, `${body}\n`, "utf8");
  return file;
}

async function withEnv<T>(vars: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetClaudeCliCache();
  try {
    return await work();
  } finally {
    resetClaudeCliCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Prints its lines, then never exits: the desk's own clock must end it.
const HANG = "setInterval(() => {}, 1000);";

describe("G24-FO-3: a CLI timeout after a 429 is a usage-limit failover", () => {
  it("a stream api_retry 429 before the clock ran out gives the quota reason", async () => {
    const cli = await fakeCli([
      `process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");`,
      `process.stdout.write(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 1, error_status: 429, error: "rate_limit" }) + "\\n");`,
      HANG,
    ].join("\n"));
    const result = await withEnv({ CLAUDE_CLI_PATH: cli }, () =>
      claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", timeoutMs: 1500 }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /timed out/);
    assert.ok(result.error.includes(CLI_QUOTA_RETRY_NOTE), result.error);
    assert.equal(automaticFailoverReason(result.error), "quota");
  });

  it("a 429 on the CLI's stderr before the clock ran out gives the quota reason", async () => {
    const cli = await fakeCli([
      `process.stderr.write("API Error: 429 Too Many Requests, retrying in 30s\\n");`,
      HANG,
    ].join("\n"));
    const result = await withEnv({ CLAUDE_CLI_PATH: cli }, () =>
      claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", timeoutMs: 1500 }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(automaticFailoverReason(result.error), "quota");
  });

  it("with no quota sign a timeout still reads as a timeout", async () => {
    const cli = await fakeCli([
      `process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");`,
      HANG,
    ].join("\n"));
    const result = await withEnv({ CLAUDE_CLI_PATH: cli }, () =>
      claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", timeoutMs: 1500 }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /timed out after 2s/, "the timeout length is unchanged");
    assert.equal(result.error.includes(CLI_QUOTA_RETRY_NOTE), false);
    assert.equal(automaticFailoverReason(result.error), "timeout");
  });

  it("the desk's own counters are never read as an HTTP 429", () => {
    assert.equal(automaticFailoverReason("Claude Code request timed out after 429s, 429 bytes out"), "timeout");
    assert.equal(automaticFailoverReason("The writer timed out after 429 seconds"), "timeout");
    assert.equal(automaticFailoverReason(`Claude Code request timed out after 45s, 0 bytes out — ${CLI_QUOTA_RETRY_NOTE}`), "quota");
  });
});

describe("G23-ENG-6 / G24-FO-1: a Local pin never takes over the cloud DeepSeek rung", () => {
  const CLOUD = "http://127.0.0.1:11434/v1";
  const LM_STUDIO = "http://127.0.0.1:1234/v1";

  it("a pin with DeepSeek's own model id keeps TOWNREPORTER_DEEPSEEK_BASE_URL", async () => {
    const seen: string[] = [];
    const adapters: GrokChatAdapters = {
      findClaudeCli: async () => "fake-claude",
      claudeCode: async (input) => {
        seen.push(input.deepSeek?.baseUrl ?? "no relay");
        return { ok: true, text: "ok", meta: { provider: "claude-code", model: input.model, durationMs: 1, timedOut: false } };
      },
      openai: async () => assert.fail("DeepSeek must stay on the Claude Code road"),
    };
    await withEnv({ TOWNREPORTER_DEEPSEEK: "1", TOWNREPORTER_DEEPSEEK_BASE_URL: CLOUD, TOWNREPORTER_CLAUDE_CODE: undefined }, async () => {
      const result = await grokChat("S", "U", 10, {
        choice: "deepseek-flash",
        // The newsroom's Local pick, passed on every call: a local engine
        // that lists a model with DeepSeek's exact name.
        localModel: { id: DEEPSEEK, baseUrl: LM_STUDIO },
        timeoutMs: 1000,
      }, adapters);
      assert.equal(result.ok, true);
      const direct = resolveProvider("deepseek-flash", { id: DEEPSEEK, baseUrl: LM_STUDIO }, DEEPSEEK);
      assert.ok(direct && "baseUrl" in direct);
      assert.equal(direct.baseUrl.replace(/\/+$/, ""), CLOUD);
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.replace(/\/+$/, ""), CLOUD);
  });

  it("the Local model rung (qwen-local) still runs on the pinned engine and model (MUL-1)", () => {
    const pinned = { baseUrl: LM_STUDIO, id: "pinned-qwen" };
    const provider = resolveProvider("qwen-local", pinned);
    assert.ok(provider && provider.kind === "openai");
    assert.equal(provider.baseUrl, pinned.baseUrl);
    assert.equal(provider.model, pinned.id);
  });
});

describe("G24-FO-2: TOWNREPORTER_CLAUDE_CODE=0 takes the CLI off the DeepSeek road", () => {
  function adapters(log: string[]): GrokChatAdapters {
    return {
      findClaudeCli: async () => "fake-claude",
      claudeCode: async (input) => {
        log.push(`cli:${input.model}`);
        return { ok: true, text: "cli", meta: { provider: "claude-code", model: input.model, durationMs: 1, timedOut: false } };
      },
      openai: async (provider, request) => {
        log.push(`http:${request.model}:${"baseUrl" in provider ? provider.baseUrl : ""}`);
        return { ok: true, text: "http" };
      },
    };
  }
  const options = { choice: "local-model", localModel: { id: DEEPSEEK, baseUrl: "http://127.0.0.1:11434/v1" }, timeoutMs: 1000 } as const;

  it("with the switch at 0, DeepSeek goes by HTTP even though a CLI is installed", async () => {
    const log: string[] = [];
    const result = await withEnv({ TOWNREPORTER_CLAUDE_CODE: "0" }, () => grokChat("S", "U", 10, options, adapters(log)));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "http");
    assert.deepEqual(log, [`http:${DEEPSEEK}:http://127.0.0.1:11434/v1`]);
  });

  it("with the switch unset, DeepSeek still runs inside the Claude Code CLI (rule 24)", async () => {
    const log: string[] = [];
    const result = await withEnv({ TOWNREPORTER_CLAUDE_CODE: undefined }, () => grokChat("S", "U", 10, options, adapters(log)));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "cli");
    assert.deepEqual(log, [`cli:${DEEPSEEK}`]);
  });
});

describe("TXB-2: the chat path records the tools it used", () => {
  it("counts each tool_use in the stream and keeps the CLI's turn count", async () => {
    const events = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "WebSearch", input: {} }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "results" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "WebFetch", input: {} }, { type: "tool_use", id: "t3", name: "WebFetch", input: {} }] } },
      { type: "result", subtype: "success", is_error: false, result: "The answer.", num_turns: 3 },
    ];
    const cli = await fakeCli(
      `for (const event of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(event) + "\\n");`,
    );
    const result = await withEnv({ CLAUDE_CLI_PATH: cli }, () =>
      claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", timeoutMs: 10_000 }));
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (!result.ok) return;
    assert.equal(result.text, "The answer.");
    assert.equal(result.meta?.toolRounds, 3);
    assert.deepEqual(result.meta?.toolExecutions, { WebSearch: 1, WebFetch: 2 });
  });

  it("a stream with no tool use records no tool names", async () => {
    const cli = await fakeCli(
      `process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "Plain.", num_turns: 1 }));`,
    );
    const result = await withEnv({ CLAUDE_CLI_PATH: cli }, () =>
      claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", timeoutMs: 10_000 }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.text, "Plain.");
    assert.equal(result.meta?.toolExecutions, undefined);
  });
});
