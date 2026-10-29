import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { grokChat, type GrokChatAdapters } from "./ai.ts";
import { claudeCodeChat, resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { darkFailoverEffort, darkVerificationTimeoutMs } from "./dark.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { modelChoiceLabel, type EffectiveStoryModelChoice } from "./model-choice.ts";
import { modelEffort as validatedModelEffort, type ModelEffort } from "./provider-registry.ts";

type RunSnapshot = { modelChoice: EffectiveStoryModelChoice; modelEffort: ModelEffort | null };
type ChatResult = Awaited<ReturnType<typeof grokChat>>;

const DEEPSEEK_MODEL = "deepseek-v4.1-flash:1017-cloud";
const fake = fileURLToPath(new URL("../../../scripts/fakes/fake-deepseek-claude-cli.mjs", import.meta.url));

async function endpoint(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

async function withEnv(vars: Record<string, string>, work: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  resetClaudeCliCache();
  try {
    await work();
  } finally {
    resetClaudeCliCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

it("a Dark failover to DeepSeek uses the same runtime as a direct DeepSeek pick", async () => {
  const upstreamBodies: Array<Record<string, unknown>> = [];
  const upstream = await endpoint((_req, res, body) => {
    upstreamBodies.push(JSON.parse(body) as Record<string, unknown>);
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  const calls: Array<Parameters<NonNullable<GrokChatAdapters["claudeCode"]>>[0]> = [];
  const adapters: GrokChatAdapters = {
    findClaudeCli: async () => fake,
    claudeCode: async (input) => {
      calls.push(input);
      return claudeCodeChat(input);
    },
  };
  try {
    await withEnv({
      CLAUDE_CLI_PATH: fake,
      FAKE_D153_RELAY: "1",
      FAKE_D153_EXPECTED_TOKEN: "fixture-rung",
      ANTHROPIC_AUTH_TOKEN: "fixture-operator-login",
      ANTHROPIC_API_KEY: "fixture-operator-key",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9/operator",
      ANTHROPIC_MODEL: "operator-model",
      TOWNREPORTER_DEEPSEEK: "1",
      TOWNREPORTER_DEEPSEEK_BASE_URL: `${upstream.baseUrl}/v1`,
      TOWNREPORTER_DEEPSEEK_API_KEY: "fixture-rung",
      TOWNREPORTER_DEEPSEEK_MODEL: DEEPSEEK_MODEL,
    }, async () => {
      const directEffort = validatedModelEffort("deepseek-flash", null);
      const direct = await grokChat("S", "U", 10, {
        choice: "deepseek-flash",
        reasoningEffort: directEffort,
        timeoutMs: darkVerificationTimeoutMs("deepseek-flash", {}),
      }, adapters);
      assert.equal(direct.ok, true);

      const attempted = await runPinnedCallWithFailover<RunSnapshot, ChatResult>({
        snapshot: { modelChoice: "claude-frontier", modelEffort: "high" },
        source: "editor",
        ladder: ["deepseek-flash", "qwen-local"],
        run: async (snapshot) => {
          if (snapshot.modelChoice === "claude-frontier") {
            return { ok: false, error: "Claude Code request timed out after 45s, 0 bytes out" } as ChatResult;
          }
          return grokChat("S", "U", 10, {
            choice: snapshot.modelChoice,
            reasoningEffort: snapshot.modelEffort,
            timeoutMs: darkVerificationTimeoutMs(snapshot.modelChoice, {}),
          }, adapters);
        },
        probe: async (choice) => ({
          ok: true,
          choice: choice as "deepseek-flash",
          label: modelChoiceLabel(choice as "deepseek-flash"),
        }),
        resolve: async (choice) => ({
          modelChoice: choice,
          modelEffort: darkFailoverEffort(choice),
        }),
        onSwitch: async () => undefined,
      });
      assert.equal(attempted.result.ok, true);

      assert.equal(calls.length, 2);
      assert.equal(calls[1]!.model, calls[0]!.model);
      assert.equal(new URL(calls[1]!.deepSeek!.baseUrl).origin, new URL(calls[0]!.deepSeek!.baseUrl).origin);
      assert.equal(calls[1]!.deepSeek!.effort, calls[0]!.deepSeek!.effort);
      assert.equal(calls[1]!.timeoutMs, calls[0]!.timeoutMs);
      assert.equal(calls[1]!.timeoutMs, darkVerificationTimeoutMs("deepseek-flash", {}));

      const directChild = JSON.parse(direct.text) as Record<string, unknown>;
      const failoverChild = JSON.parse(attempted.result.text) as Record<string, unknown>;
      assert.equal(failoverChild.model, directChild.model);
      assert.equal(failoverChild.modelsPinned, directChild.modelsPinned);
      assert.equal(failoverChild.apiKeyEmpty, directChild.apiKeyEmpty);
      assert.equal(failoverChild.contextWindow, directChild.contextWindow);
      assert.equal(failoverChild.relayOrigin, directChild.relayOrigin);
      assert.equal(upstreamBodies.length, 2);
      assert.equal(upstreamBodies[1]!.model, upstreamBodies[0]!.model);
      assert.deepEqual(upstreamBodies[1]!.thinking, upstreamBodies[0]!.thinking);
      assert.deepEqual(upstreamBodies[1]!.output_config, upstreamBodies[0]!.output_config);
    });
  } finally {
    await upstream.close();
  }
});
