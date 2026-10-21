import assert from "node:assert/strict";
import { it } from "node:test";
import { grokChat, type GrokChatAdapters } from "./ai.ts";
import { PROVIDER_REGISTRY, defaultModelEffort, openAiCompatibleModelEfforts } from "./provider-registry.ts";

const PINNED = "deepseek-v4.1-flash:1017-cloud";

it("D160 the DeepSeek rung names the pinned Ollama tag, not the floating :cloud", () => {
  const rung = PROVIDER_REGISTRY.find((entry) => entry.id === "deepseek-flash");
  assert.equal(rung?.model, PINNED);
});

it("D160 the pinned tag still takes the full-tool Claude Code route", async () => {
  const seen: string[] = [];
  const adapters: GrokChatAdapters = {
    findClaudeCli: async () => "fake-claude",
    claudeCode: async (input) => {
      seen.push(input.model);
      return { ok: true, text: "ok", meta: { provider: "claude-code", model: input.model, durationMs: 1, timedOut: false } };
    },
    openai: async () => { throw new Error("the pinned DeepSeek tag bypassed the full-tool route"); },
  };
  const result = await grokChat("S", "U", 10, {
    choice: "local-model",
    localModel: { id: PINNED, baseUrl: "http://127.0.0.1:9/v1" },
    timeoutMs: 1000,
  }, adapters);
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [PINNED]);
  assert.equal(result.meta?.provider, "deepseek-flash");
});

it("D168 low thinking holds for the pinned tag, exactly as for the old :cloud tag", () => {
  assert.deepEqual(openAiCompatibleModelEfforts(PINNED), openAiCompatibleModelEfforts("deepseek-v4.1-flash:cloud"));
  assert.ok(openAiCompatibleModelEfforts(PINNED).includes("none"));
  assert.equal(defaultModelEffort("local-model", PINNED), "low");
  assert.equal(defaultModelEffort("deepseek-flash", PINNED), "low");
});
