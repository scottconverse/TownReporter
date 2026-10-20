import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getPglite } from "../db.ts";
after(async () => { await (await getPglite()).close(); });

import { grokChat } from "./ai.ts";

// Output ceilings the draft job passes per stage (report.ts): planning, writer,
// edit, citation repair, name check. Each stage is a separate call.
const DRAFT_STAGE_CAPS = [900, 2200, 1800, 2600, 4000];

type Reply = { finish: string; content: string };

async function runCalls(opts: {
  modelId: string;
  baseUrl: string;
  maxTokens: number;
  replies: Reply[];
}): Promise<{ requests: Record<string, unknown>[]; result: Awaited<ReturnType<typeof grokChat>> }> {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  let n = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const reply = opts.replies[Math.min(n++, opts.replies.length - 1)];
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: reply.finish, message: { content: reply.content } }] }),
    );
  };
  try {
    const result = await grokChat(
      "System",
      "User",
      opts.maxTokens,
      { choice: "custom:probe", newsroomId: 1 },
      {
        resolveCustom: async () => ({
          name: "Probe",
          modelId: opts.modelId,
          apiKey: "not-needed",
          baseUrl: opts.baseUrl,
        }),
      },
    );
    return { requests, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("every draft stage on DeepSeek v4.1 Flash 1017 gets the 16,384 floor with thinking off", async () => {
  for (const maxTokens of DRAFT_STAGE_CAPS) {
    const { requests } = await runCalls({
      modelId: "deepseek-v4.1-flash:cloud",
      baseUrl: "http://127.0.0.1:11434/v1",
      maxTokens,
      replies: [{ finish: "stop", content: "{}" }],
    });
    assert.ok(Number(requests[0].max_tokens) >= 32_768, `stage cap ${maxTokens}`);
    assert.equal(requests[0].reasoning_effort, "none", `stage cap ${maxTokens}`);
  }
});

test("every draft stage on the Local model gets the 16,384 floor with thinking off", async () => {
  for (const maxTokens of DRAFT_STAGE_CAPS) {
    const { requests } = await runCalls({
      modelId: "halo/qwen3.8-27b-q6-fast",
      baseUrl: "http://127.0.0.1:1234/v1",
      maxTokens,
      replies: [{ finish: "stop", content: "{}" }],
    });
    assert.ok(Number(requests[0].max_tokens) >= 32_768, `stage cap ${maxTokens}`);
    assert.equal(requests[0].reasoning_effort, "none", `stage cap ${maxTokens}`);
  }
});

test("a hosted OpenAI-compatible model keeps the stage's own output cap", async () => {
  const { requests } = await runCalls({
    modelId: "some-hosted-model",
    baseUrl: "https://llm.example.test/v1",
    maxTokens: 2200,
    replies: [{ finish: "stop", content: "{}" }],
  });
  assert.equal(requests[0].max_tokens, 2200);
});

test("a DeepSeek reply that runs to the ceiling is retried once, warmer, and the retry's draft is used", async () => {
  const { requests, result } = await runCalls({
    modelId: "deepseek-v4.1-flash:cloud",
    baseUrl: "http://127.0.0.1:11434/v1",
    maxTokens: 1800,
    replies: [
      { finish: "length", content: '{"integrity_notes":["The release does not state' },
      { finish: "stop", content: '{"headline":"A Line runs every 30 minutes"}' },
    ],
  });
  assert.equal(requests.length, 2);
  assert.ok(Number(requests[1].temperature) > Number(requests[0].temperature));
  assert.equal(requests[1].reasoning_effort, "none");
  assert.ok(Number(requests[1].max_tokens) >= 32_768);
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.text, /A Line runs every 30 minutes/);
});

test("two cut-off DeepSeek replies still report the cut-off so the failover ladder runs", async () => {
  const { requests, result } = await runCalls({
    modelId: "deepseek-v4.1-flash:cloud",
    baseUrl: "http://127.0.0.1:11434/v1",
    maxTokens: 1800,
    replies: [{ finish: "length", content: '{"integrity_notes":["x' }],
  });
  assert.equal(requests.length, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /finish reason: length/);
});

test("a cut-off Local reply is not retried on the same model", async () => {
  const { requests, result } = await runCalls({
    modelId: "halo/qwen3.8-27b-q6-fast",
    baseUrl: "http://127.0.0.1:1234/v1",
    maxTokens: 1800,
    replies: [{ finish: "length", content: '{"headline":"x' }],
  });
  assert.equal(requests.length, 1);
  assert.equal(result.ok, false);
});
