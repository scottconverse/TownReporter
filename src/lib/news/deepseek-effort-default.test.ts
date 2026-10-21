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
  DeepSeek v4.1 Flash 1017 runs with LOW thinking everywhere (D168, Scott
  Oct 20 2026: "Low EVERYWHERE including inside townreporter"). This replaces
  the earlier standing "thinking OFF" rule (D153): an unset effort must resolve
  to "low", never to provider default and never to "medium" carried over
  from Automatic.
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

describe("DeepSeek v4.1 Flash 1017 effort defaults to Low", () => {
  it("defaults the deepseek-flash door to low with no exact model passed", () => {
    assert.equal(defaultModelEffort("deepseek-flash"), "low");
    assert.equal(defaultModelEffort("deepseek-flash", null), "low");
  });

  it("labels the Off level as the picker's None choice for DeepSeek", () => {
    assert.equal(modelEffortLabel("none", "deepseek-v4.1-flash:cloud"), "None — fastest");
  });

  it("keeps DeepSeek on low when Automatic carries medium into its rung", () => {
    // forced-runtime.server.ts passes the rung's own resolved local model id
    // as the exact model. A medium carried from Automatic must not survive.
    assert.equal(modelEffort("deepseek-flash", "medium", "deepseek-v4.1-flash:cloud"), "low");
    assert.equal(modelEffort("deepseek-flash", "medium", "some-served-deepseek-id"), "low");
  });

  it("resolves a saved DeepSeek story-draft row with no effort to low", () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: null },
    ];
    const resolution = resolveJobModel({ jobKey: "story-draft", assignments });
    assert.equal(resolution.providerId, "deepseek-flash");
    assert.equal(resolution.source, "assignment");
    assert.equal(resolution.effort, "low");
    assert.equal(cleanJobEffort("deepseek-flash", null), "low");
  });

  it("honors a DeepSeek effort an editor picked by hand", () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: "high" },
    ];
    assert.equal(resolveJobModel({ jobKey: "story-draft", assignments }).effort, "high");
  });

  it("sends Ollama an explicit low for a saved DeepSeek draft with no effort", async () => {
    const assignments: ModelAssignmentRow[] = [
      { jobKey: "story-draft", rank: 1, providerId: "deepseek-flash", effort: null },
    ];
    const effort = resolveJobModel({ jobKey: "story-draft", assignments }).effort;
    const bodies: Record<string, unknown>[] = [];
    const result = await withEnvAndFetch(
      { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "deepseek-v4.1-flash:cloud" },
      bodies,
      () => grokChat("write a draft", "story facts", 2_200, { choice: "local-model", reasoningEffort: effort }, { findClaudeCli: async () => null }),
    );
    assert.equal(result.ok, true);
    assert.equal(bodies[0]?.reasoning_effort, "low");
  });

  it("never leaves the provider default in place for an undeclared effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    await withEnvAndFetch(
      { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "deepseek-v4.1-flash:cloud" },
      bodies,
      () => grokChat("write a draft", "story facts", 2_200, { choice: "local-model", reasoningEffort: "medium" }, { findClaudeCli: async () => null }),
    );
    assert.equal(bodies[0]?.reasoning_effort, "low");
  });
});

describe("the shared model picker shows Low for DeepSeek", () => {
  it("shows Low, not the editor's stale Medium, when DeepSeek is selected", () => {
    const shown = pickerShownEffort("deepseek-flash", null, "medium");
    assert.equal(shown, "low");
    assert.equal(modelEffortLabel(shown!, null), "Low — faster");
    assert.equal(modelEffortsFor("deepseek-flash", null).includes("medium"), false);
  });

  it("shows Low when DeepSeek is selected with no effort set", () => {
    assert.equal(pickerShownEffort("deepseek-flash", null, null), "low");
  });

  it("shows Low even when the editor picked High by hand, because the run is low", () => {
    assert.equal(pickerShownEffort("deepseek-flash", null, "high"), "low");
    assert.equal(pickerShownEffort("deepseek-flash", null, "max"), "low");
  });
});
