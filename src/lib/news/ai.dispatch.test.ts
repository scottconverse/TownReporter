import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { it } from "node:test";
import { RESEARCH_GUIDANCE } from "./research-guidance.ts";
import { grokChat } from "./ai.ts";
import { runForcedChat, type ForcedRuntimeSnapshot } from "./forced-runtime.server.ts";

// Replace only the three CLI module boundaries. No CLI, model or service runs.
const cliModules: Record<string, string> = {
  "ai-claude-code.server.ts": "claudeCodeChat",
  "ai-gemini-cli.server.ts": "geminiChat",
  "ai-codex.server.ts": "codexChat",
};
const hook = registerHooks({ load(url, context, next) {
  const name = url.split("/").at(-1) ?? "";
  const exported = cliModules[name];
  if (url.includes("/src/lib/news/") && exported) return {
    format: "module", shortCircuit: true,
    source: "export async function " + exported + "(request) { return {ok:true,text:JSON.stringify(request)}; }",
  };
  return next(url, context);
} });

const caller = "Editorial research voice.\nKeep this stage text exactly: café, JSON and citations.";
const user = "Read the supplied evidence.";
function check(system: string) {
  assert.equal(system, caller + "\n\n" + RESEARCH_GUIDANCE);
  assert.equal(system.split(RESEARCH_GUIDANCE).length - 1, 1);
}

it("ENG-4 grokChat sends preserved custom text and exactly one guidance to every adapter and CLI dispatch", async () => {
  const keys = ["ANTHROPIC_API_KEY", "TOWNREPORTER_CLAUDE_CODE", "TOWNREPORTER_CODEX"];
  const previous = keys.map(key => process.env[key]);
  delete process.env.ANTHROPIC_API_KEY;
  process.env.TOWNREPORTER_CLAUDE_CODE = "1";
  process.env.TOWNREPORTER_CODEX = "1";
  try {
    for (const supplied of [caller, caller + "\n\n" + RESEARCH_GUIDANCE]) {
      for (const [choice, kind] of [["claude-frontier", "claude-code"], ["gemini-flash", "gemini-cli"], ["codex-balanced", "codex"]] as const) {
        const result = await grokChat(supplied, user, 321, { choice, timeoutMs: 12345 });
        assert.ok(result.ok, result.ok ? "" : result.error);
        const request = JSON.parse(result.text);
        check(request.system);
        assert.equal(request.user, user);
        assert.equal(request.timeoutMs, 12345);
        let calls = 0;
        await grokChat(supplied, user, 321, { choice, timeoutMs: 12345 }, {
          [kind]: async (_provider: string, input: { system: string; user: string; maxTokens: number; model: string; timeoutMs: number }) => {
            calls++;
            check(input.system);
            assert.equal(input.user, user);
            assert.equal(input.maxTokens, 321);
            assert.equal(input.timeoutMs, 12345);
            return { ok: true as const, text: "adapter" };
          },
        });
        assert.equal(calls, 1);
      }
      for (const kind of ["openai", "anthropic"] as const) {
        if (kind === "anthropic") process.env.ANTHROPIC_API_KEY = "fixture";
        let calls = 0;
        const result = await grokChat(supplied, user, 321, {
          choice: kind === "anthropic" ? "claude-frontier" : "local-model",
          localModel: { baseUrl: "http://127.0.0.1:11999/v1", id: "fixture" },
        }, { [kind]: async (_provider: string, input: { system: string; user: string; maxTokens: number; model: string; timeoutMs: number }) => { calls++; check(input.system); return { ok: true as const, text: "adapter" }; } });
        assert.equal(result.ok, true);
        assert.equal(calls, 1);
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    hook.deregister();
  }
});

it("ENG-4 runForcedChat preserves custom text and supplies exactly one guidance on all five transports", async () => {
  const snapshots = [
    { runtime: "claude-frontier", modelChoice: "claude-frontier", transport: "claude-code", model: "fixture" },
    { runtime: "codex-balanced", modelChoice: "codex-balanced", transport: "codex", model: "fixture" },
    { runtime: "gemini-flash", modelChoice: "gemini-flash", transport: "gemini-cli", model: "fixture" },
    { runtime: "local", modelChoice: "local-model", transport: "local", localModel: { baseUrl: "http://127.0.0.1:11999/v1", id: "fixture" } },
    { runtime: "custom:11111111-1111-4111-8111-111111111111", modelChoice: "custom:11111111-1111-4111-8111-111111111111", transport: "custom", model: "fixture", newsroomId: 42 },
  ] as const satisfies readonly ForcedRuntimeSnapshot[];
  for (const supplied of [caller, caller + "\n\n" + RESEARCH_GUIDANCE]) {
    for (const snapshot of snapshots) {
      let calls = 0;
      const cli = async (input: { system: string; user: string; timeoutMs: number }) => {
        calls++;
        check(input.system);
        assert.equal(input.user, user);
        assert.equal(input.timeoutMs, 12345);
        return "done";
      };
      const local = async (system: string, request: string, tokens: number) => {
        calls++;
        check(system);
        assert.equal(request, user);
        assert.equal(tokens, 321);
        return "done";
      };
      assert.equal(await runForcedChat(snapshot, supplied, user, 321, { timeoutMs: 12345 }, {
        claude: cli, codex: cli, gemini: cli, local, custom: local,
      }), "done");
      assert.equal(calls, 1);
    }
  }
});
