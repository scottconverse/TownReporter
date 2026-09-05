import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { grokChat } from "./ai.ts";

const ENV_KEYS = [
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_API_KEY",
  "LLM_REASONING_EFFORT",
  "TOWNREPORTER_CLAUDE_CODE",
];

// This file only ever exercises the OpenAI-compatible (local/gateway) path
// with `globalThis.fetch` mocked below -- no test here reaches a live model.
// Claude Code is also switched off explicitly (TOWNREPORTER_CLAUDE_CODE="0"),
// which the newsroom-security "no test can reach a live model unasked" gate
// checks for by name.
async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries({ TOWNREPORTER_CLAUDE_CODE: "0", ...vars })) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function withFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

describe("reasoning_effort on the OpenAI-compatible (local/gateway) path", () => {
  it("sends reasoning_effort: none by default for a model flagged thinking", async () => {
    let sentBody: Record<string, unknown> | undefined;
    await withFetch(
      (async (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "gemma4:12b" },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal(sentBody?.reasoning_effort, "none");
  });

  it("omits reasoning_effort for an ordinary (non-thinking) model", async () => {
    let sentBody: Record<string, unknown> | undefined;
    await withFetch(
      (async (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "llama3.1" },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal("reasoning_effort" in (sentBody ?? {}), false);
  });

  it("honours an explicit LLM_REASONING_EFFORT override", async () => {
    let sentBody: Record<string, unknown> | undefined;
    await withFetch(
      (async (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }) as typeof fetch,
      () =>
        withEnvAsync(
          {
            LLM_BASE_URL: "http://127.0.0.1:11434/v1",
            LLM_MODEL: "llama3.1",
            LLM_REASONING_EFFORT: "low",
          },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal(sentBody?.reasoning_effort, "low");
  });

  it("never sends reasoning_effort to the real OpenAI cloud API", async () => {
    let sentBody: Record<string, unknown> | undefined;
    await withFetch(
      (async (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }) as typeof fetch,
      () =>
        withEnvAsync(
          {
            LLM_BASE_URL: "https://api.openai.com/v1",
            LLM_MODEL: "o1-mini",
            LLM_API_KEY: "sk-test",
            LLM_REASONING_EFFORT: "high",
          },
          () => grokChat("sys", "user", 200, { choice: "configured" }),
        ),
    );
    assert.equal("reasoning_effort" in (sentBody ?? {}), false);
  });

  it("reports the specific thinking-only error instead of 'Empty model response'", async () => {
    const result = await withFetch(
      (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "", reasoning: "thinking really hard..." } }],
          }),
          { status: 200 },
        )) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "gemma4:12b" },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /spent its whole answer thinking/);
  });

  it("also reads reasoning_content (most OpenAI-compatible servers), not just reasoning (Ollama)", async () => {
    const result = await withFetch(
      (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "..." } }] }),
          { status: 200 },
        )) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:1234/v1", LLM_MODEL: "qwen3.6-35b-a3b" },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /spent its whole answer thinking/);
  });

  it("still says 'Empty model response' when there is no reasoning text either", async () => {
    const result = await withFetch(
      (async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "llama3.1" },
          () => grokChat("sys", "user", 200, { choice: "local-model" }),
        ),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Empty model response");
  });
});

describe("the local-model per-newsroom override", () => {
  it("uses the override's baseUrl/model instead of LLM_BASE_URL/LLM_MODEL when present", async () => {
    let calledUrl = "";
    let sentModel = "";
    await withFetch(
      (async (url, init) => {
        calledUrl = String(url);
        sentModel = (JSON.parse(String(init?.body)) as { model?: string }).model ?? "";
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }) as typeof fetch,
      () =>
        withEnvAsync(
          { LLM_BASE_URL: "http://127.0.0.1:1234/v1", LLM_MODEL: "env-model" },
          () =>
            grokChat("sys", "user", 200, {
              choice: "local-model",
              localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "gemma4:12b" },
            }),
        ),
    );
    assert.equal(calledUrl, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(sentModel, "gemma4:12b");
  });
});
