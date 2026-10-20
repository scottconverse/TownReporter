import assert from "node:assert/strict";
import { it } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { grokChat, type GrokChatAdapters } from "./ai.ts";
import { claudeCodeChat, parseCliEnvelope, resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { deepSeekRelayRoute, type DeepSeekRelayEvidence } from "./deepseek-relay.server.ts";
import { researchSystem, RESEARCH_GUIDANCE } from "./research-guidance.ts";
import { runForcedChat } from "./forced-runtime.server.ts";

const model = "deepseek-v4.1-flash:cloud";
const fake = fileURLToPath(new URL("../../../scripts/fakes/fake-deepseek-claude-cli.mjs", import.meta.url));
async function withEnv(vars: Record<string, string>, work: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  resetClaudeCliCache();
  try { await work(); } finally {
    resetClaudeCliCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
async function endpoint(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(req, res, body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

it("D153 DeepSeek actually spawns full-tool Claude CLI with relay, exact model and isolated rung auth", async () => {
  const seen: Array<{ path?: string; authMatches: boolean; apiKeyAbsent: boolean; body: Record<string, unknown> }> = [];
  const upstream = await endpoint((req, res, body) => {
    seen.push({ path: req.url, authMatches: req.headers.authorization === "Bearer fixture-rung", apiKeyAbsent: !req.headers["x-api-key"], body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"fixture-webfetch-1","name":"WebFetch"}}\n\n');
  });
  try {
    await withEnv({
      CLAUDE_CLI_PATH: fake, FAKE_D153_RELAY: "1", FAKE_D153_EXPECTED_TOKEN: "fixture-rung",
      ANTHROPIC_AUTH_TOKEN: "fixture-operator-login", ANTHROPIC_API_KEY: "fixture-operator-key",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9/operator", ANTHROPIC_MODEL: "operator-model",
      TOWNREPORTER_DEEPSEEK: "1", TOWNREPORTER_DEEPSEEK_BASE_URL: upstream.baseUrl + "/custom/v1/",
      TOWNREPORTER_DEEPSEEK_API_KEY: "fixture-rung", TOWNREPORTER_DEEPSEEK_MODEL: model,
    }, async () => {
      const result = await grokChat("Research facts", "Unchanged " + RESEARCH_GUIDANCE, 1, {
        choice: "deepseek-flash", rungModel: null, reasoningEffort: "high", timeoutMs: 5000,
      });
      assert.ok(result.ok);
      const child = JSON.parse(result.text);
      assert.equal(child.model, model);
      assert.equal(child.modelsPinned, true);
      assert.equal(child.authMatchesExpected, true);
      assert.equal(child.apiKeyEmpty, true);
      assert.equal(child.nonessentialDisabled, true);
      assert.equal(child.system, researchSystem("Research facts", true));
      assert.equal(child.user, "Unchanged " + RESEARCH_GUIDANCE);
      assert.equal(child.relayStatus, 200);
      assert.ok(child.args.includes("--dangerously-skip-permissions"));
      assert.equal(child.args.includes("--effort"), false);
      assert.equal(child.args.includes("--tools"), false);
      assert.equal(child.args.includes("--allowed-tools"), false);
      assert.equal(child.args[child.args.indexOf("--output-format") + 1], "json");
      assert.equal(result.meta?.provider, "deepseek-flash");
      assert.equal(result.meta?.model, model);
      assert.equal(result.meta?.toolRounds, 3);
      assert.equal(result.meta?.toolExecutions, undefined);
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, "/custom/v1/messages");
    assert.equal(seen[0].authMatches, true);
    assert.equal(seen[0].apiKeyAbsent, true);
    assert.deepEqual(seen[0].body.thinking, { type: "disabled" });
    assert.deepEqual(seen[0].body.output_config, { format: "kept" });
  } finally { await upstream.close(); }
});

it("D153 an unkeyed DeepSeek endpoint spawns with ollama auth rather than the no-key sentinel", async () => {
  await withEnv({ CLAUDE_CLI_PATH: fake, FAKE_D153_RELAY: "0", FAKE_D153_EXPECTED_TOKEN: "ollama", LLM_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "fixture-operator-login", ANTHROPIC_API_KEY: "fixture-operator-key" }, async () => {
    const result = await grokChat("S", "U", 1, { choice: "local-model", localModel: { id: model, baseUrl: "http://127.0.0.1:9/v1" }, timeoutMs: 5000 });
    assert.ok(result.ok);
    const child = JSON.parse(result.text);
    assert.equal(child.authMatchesExpected, true);
    assert.equal(child.apiKeyEmpty, true);
    assert.equal(child.modelsPinned, true);
  });
});

it("D153 every picker, local, custom, model override, automatic and forced route uses the DeepSeek adapter", async () => {
  await withEnv({ TOWNREPORTER_DEEPSEEK: "1", TOWNREPORTER_DEEPSEEK_BASE_URL: "http://127.0.0.1:9/v1", TOWNREPORTER_DEEPSEEK_API_KEY: "fixture-rung" }, async () => {
    let calls = 0;
    const adapters: GrokChatAdapters = {
      findClaudeCli: async () => fake,
      probe: async () => ({ ok: true, choice: "deepseek-flash", label: "DeepSeek v4.1 Flash 1017" }),
      resolveCustom: async () => ({ baseUrl: "http://127.0.0.1:9/custom/v1", modelId: model, apiKey: "custom-fixture" }),
      claudeCode: async input => {
        calls++;
        assert.match(input.model, /deepseek-v4\.1-flash/i);
        assert.equal(input.system, researchSystem("S", true));
        assert.equal(input.user, "U");
        assert.equal(input.reasoningEffort, undefined);
        assert.equal(input.timeoutMs, 1234);
        assert.ok(input.deepSeek);
        assert.ok(input.deepSeek.baseUrl.includes("127.0.0.1:9"));
        return { ok: true, text: "ok", meta: { provider: "claude-code", model: "cli-alias", durationMs: 1, timedOut: false } };
      },
      openai: async () => { throw new Error("DeepSeek bypassed the full-tool adapter"); },
    };
    for (const options of [
      { choice: "deepseek-flash", rungModel: null },
      { choice: "local-model", localModel: { id: model, baseUrl: "http://127.0.0.1:9/local/v1" } },
      { choice: "custom:11111111-1111-4111-8111-111111111111", newsroomId: 1 },
      { choice: "local-model", localModel: { id: "other-model", baseUrl: "http://127.0.0.1:9/v1" }, model: "models/deepseek-v4.1-flash" },
      { choice: "auto" },
    ] as const) {
      const result = await grokChat("S", "U", 10, { ...options, timeoutMs: 1234 }, adapters);
      assert.equal(result.ok, true);
      assert.equal(result.meta?.provider, "deepseek-flash");
      assert.match(result.meta!.model, /deepseek/);
    }
    const result = await runForcedChat({ runtime: "deepseek-flash", modelChoice: "deepseek-flash", transport: "local", localModel: { baseUrl: "http://127.0.0.1:9/v1", id: model }, modelEffort: "none" }, "S", "U", 10, { timeoutMs: 1234 }, {
      local: (system, user, maxTokens, options) => grokChat(system, user, maxTokens, options, adapters),
      claude: async () => { throw new Error("unexpected forced transport"); },
      codex: async () => { throw new Error("unexpected forced transport"); },
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 6);
  });
});

it("D153 CLI errors return to failover without any direct HTTP fallback", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected direct fallback"); };
  try {
    const result = await grokChat("S", "U", 1, { choice: "local-model", localModel: { id: model, baseUrl: "http://127.0.0.1:9/v1" } }, {
      findClaudeCli: async () => fake,
      claudeCode: async () => ({ ok: false, error: "fixture CLI failure" }),
    });
    assert.deepEqual(result, { ok: false, error: "fixture CLI failure" });
    const thrown = await grokChat("S", "U", 1, { choice: "local-model", localModel: { id: model, baseUrl: "http://127.0.0.1:9/v1" } }, {
      findClaudeCli: async () => fake, claudeCode: async () => { throw new Error("fixture error"); },
    });
    assert.equal(thrown.ok, false);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

it("D153 ordinary Claude retains its environment and effort without DeepSeek overrides", async () => {
  await withEnv({ CLAUDE_CLI_PATH: fake, ANTHROPIC_AUTH_TOKEN: "fixture-operator-login", FAKE_D153_EXPECTED_TOKEN: "fixture-operator-login", FAKE_D153_RELAY: "0" }, async () => {
    const result = await claudeCodeChat({ system: "S", user: "U", model: "claude-sonnet-4-5", reasoningEffort: "medium", timeoutMs: 5000 });
    assert.ok(result.ok);
    const child = JSON.parse(result.text);
    assert.equal(child.hasDeepSeekDefaults, false);
    assert.equal(child.authMatchesExpected, true);
    assert.equal(child.apiKeyEmpty, false);
    assert.equal(child.nonessentialDisabled, false);
    assert.equal(child.args[child.args.indexOf("--effort") + 1], "medium");
  });
});

it("D153 relay reuses one listener, isolates concurrent endpoints, streams and emits sanitized evidence", async () => {
  const evidence: DeepSeekRelayEvidence[] = [];
  const received: Array<{ path?: string; body: string; authMatches: boolean }> = [];
  let finishStream: (() => void) | undefined;
  const first = await endpoint((req, res, body) => {
    received.push({ path: req.url, body, authMatches: req.headers.authorization === "Bearer fixture-one" && !req.headers["x-api-key"] && !req.headers.cookie });
    res.writeHead(200, { "content-type": "text/event-stream", "x-fixture": "kept" });
    res.write('data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"fixture-webfetch-1","name":"WebFetch"}}\n\n');
    finishStream = () => res.end('data: {"type":"message_stop"}\n\n');
  });
  const second = await endpoint((req, res, body) => {
    received.push({ path: req.url, body, authMatches: req.headers.authorization === "Bearer ollama" });
    res.writeHead(201, { "x-fixture": "second" }).end("unmodified response");
  });
  const [a, b] = await Promise.all([
    deepSeekRelayRoute({ baseUrl: first.baseUrl + "/custom/v1/", apiKey: "fixture-one", onEvidence: item => evidence.push(item) }),
    deepSeekRelayRoute({ baseUrl: second.baseUrl + "/other", onEvidence: item => evidence.push(item) }),
  ]);
  try {
    assert.equal(new URL(a.baseUrl).origin, new URL(b.baseUrl).origin);
    const body = { model, thinking: { type: "enabled" }, output_config: { effort: "max", other: true }, stream: true, messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "fixture", content: "ok" }] }], extra: { kept: true } };
    const [stream, untouched] = await Promise.all([
      fetch(a.baseUrl + "/v1/messages?beta=true", { method: "POST", headers: { authorization: "Bearer fixture-one", "x-api-key": "fixture-operator-key", cookie: "operator-session" }, body: JSON.stringify(body) }),
      fetch(b.baseUrl + "/v1/models?limit=1", { method: "POST", body: "unchanged bytes" }),
    ]);
    assert.equal(stream.headers.get("x-fixture"), "kept");
    const reader = stream.body!.getReader();
    const initial = await reader.read();
    assert.ok(new TextDecoder().decode(initial.value).includes("tool_use"));
    // Receipt of the first chunk precedes the upstream's final write.
    assert.ok(finishStream);
    finishStream();
    while (!(await reader.read()).done) { /* drain */ }
    assert.equal(untouched.status, 201);
    assert.equal(await untouched.text(), "unmodified response");
    assert.deepEqual(received.find(item => item.path?.includes("messages")), {
      path: "/custom/v1/messages?beta=true", authMatches: true,
      body: JSON.stringify({ ...body, thinking: { type: "disabled" }, output_config: { other: true } }),
    });
    assert.deepEqual(received.find(item => item.path?.includes("models")), { path: "/other/v1/models?limit=1", body: "unchanged bytes", authMatches: true });
    assert.deepEqual(evidence, [
      { kind: "messages", thinkingDisabled: true, effortAbsent: true, authMatchesExpected: true, forwardedAuthMatchesExpected: true, toolUses: 0, toolResults: 1 },
      { kind: "tool-use", thinkingDisabled: true, effortAbsent: true, authMatchesExpected: true, forwardedAuthMatchesExpected: true, toolUses: 1, toolResults: 1, toolId: "fixture-webfetch-1", toolName: "WebFetch" },
    ]);
    assert.equal(JSON.stringify(evidence).includes("fixture-one"), false);
    // Inbound mismatch is distinct from the outgoing rung credential evidence.
    const unkeyed = await fetch(b.baseUrl + "/v1/messages", {
      method: "POST", headers: { authorization: "Bearer fixture-wrong" }, body: JSON.stringify({ messages: [] }),
    });
    await unkeyed.text();
    assert.deepEqual(evidence.at(-1), {
      kind: "messages", thinkingDisabled: true, effortAbsent: true,
      authMatchesExpected: false, forwardedAuthMatchesExpected: true,
      forwardedAuthorization: "Bearer ollama", toolUses: 0, toolResults: 0,
    });
    a.release();
    assert.equal((await fetch(a.baseUrl + "/v1/messages")).status, 404);
  } finally { finishStream?.(); a.release(); b.release(); await Promise.all([first.close(), second.close()]); }
});

it("D153 CLI metadata copies exposed counts without fabricating tool executions", () => {
  const context = { provider: "claude-code", model, durationMs: 1, timedOut: false };
  const counted = parseCliEnvelope(JSON.stringify({ result: "ok", num_turns: 4, toolExecutions: { WebFetch: 2, invalid: -1 } }), context);
  assert.equal(counted.meta?.toolRounds, 4);
  assert.deepEqual(counted.meta?.toolExecutions, { WebFetch: 2 });
  const absent = parseCliEnvelope(JSON.stringify({ result: "ok" }), context);
  assert.equal(absent.meta?.toolRounds, undefined);
  assert.equal(absent.meta?.toolExecutions, undefined);
});
