import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultModelEffort,
  modelEffort,
  modelEffortLabel,
  modelEffortsFor,
  pickerShownEffort,
} from "./provider-registry.ts";
import { cleanJobEffort, resolveJobModel, type ModelAssignmentRow } from "./model-assignments.ts";
import { grokChat } from "./ai.ts";

/*
  DeepSeek v4.1 Flash runs with thinking OFF everywhere (Scott's standing
  rule, Oct 11). Thinking spends the output budget before the draft starts, so
  an unset effort must resolve to "none", never to provider default and never
  to "medium" carried over from Automatic.
*/

const ENV_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_REASONING_EFFORT", "TOWNREPORTER_CLAUDE_CODE"];

async function withEnvAndFetch<T>(
  vars: Record<string, string>,
  sentBodies: Record<string, unknown>[],
  fn: () => Promise<T>,
): Promise<T> {
  const prevEnv: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ TOWNREPORTER_CLAUDE_CODE: "0", ...vars })) {
    process.env[key] = value;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: "A draft." } }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
  }
}

describe("DeepSeek v4.1 Flash effort defaults to None", () => {
  it("defaults the deepseek-flash door to none with no exact model passed", () => {
    assert.equal(defaultModelEffort("deepseek-flash"), "none");
    assert.equal(defaultModelEffort("deepseek-flash", null), "none");
  });

  it("labels the Off level as the picker's None choice for DeepSeek", () => {
    assert.equal(modelEffortLabel("none", "deepseek-v4.1-flash:cloud"), "Off — no extra thinking");
  });

  it("keeps DeepSeek on none when Automatic carries medium into its rung", () => {
    // forced-runtime.server.ts passes the rung's own resolved local model id
    // as the exact model. A medium carried from Automatic must not survive.
    assert.equal(modelEffort("deepseek-flash", "medium", "deepseek-v4.1-flash:cloud"), "none");
    assert.equal(modelEffort("deepseek-flash", "medium", "some-served-deepseek-id"), "none");
  });

  it("resolves a saved DeepSeek story-draft row with no effort to none", () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: null },
    ];
    const resolution = resolveJobModel({ jobKey: "story-draft", assignments });
    assert.equal(resolution.providerId, "deepseek-flash");
    assert.equal(resolution.source, "assignment");
    assert.equal(resolution.effort, "none");
    assert.equal(cleanJobEffort("deepseek-flash", null), "none");
  });

  it("honors a DeepSeek effort an editor picked by hand", () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: "high" },
    ];
    assert.equal(resolveJobModel({ jobKey: "story-draft", assignments }).effort, "high");
  });

  it("sends Ollama an explicit off for a saved DeepSeek draft with no effort", async () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: null },
    ];
    const effort = resolveJobModel({ jobKey: "story-draft", assignments }).effort;
    const bodies: Record<string, unknown>[] = [];
    const result = await withEnvAndFetch(
      { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "deepseek-v4.1-flash:cloud" },
      bodies,
      () => grokChat("write a draft", "story facts", 2_200, { choice: "local-model", reasoningEffort: effort }),
    );
    assert.equal(result.ok, true);
    assert.equal(bodies[0]?.reasoning_effort, "none");
  });

  it("never leaves the provider default in place for an undeclared effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    await withEnvAndFetch(
      { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "deepseek-v4.1-flash:cloud" },
      bodies,
      () => grokChat("write a draft", "story facts", 2_200, { choice: "local-model", reasoningEffort: "medium" }),
    );
    assert.equal(bodies[0]?.reasoning_effort, "none");
  });
});

describe("the shared model picker shows None for DeepSeek", () => {
  it("shows None, not the editor's stale Medium, when DeepSeek is selected", () => {
    const shown = pickerShownEffort("deepseek-flash", null, "medium");
    assert.equal(shown, "none");
    assert.equal(modelEffortLabel(shown!, null), "None — fastest");
    assert.equal(modelEffortsFor("deepseek-flash", null).includes("medium"), false);
  });

  it("shows None when DeepSeek is selected with no effort set", () => {
    assert.equal(pickerShownEffort("deepseek-flash", null, null), "none");
  });

  it("keeps an effort the editor picked by hand on screen", () => {
    assert.equal(pickerShownEffort("deepseek-flash", null, "high"), "high");
  });
});
