import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GROK_UNAVAILABLE, grokChat, isGrokAvailable, parseJsonBlock, resolveLlm } from "./ai.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  const keys = ["XAI_API_KEY", "GROK_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENAI_API_KEY", "XAI_MODEL", "XAI_BASE_URL"];
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe("isGrokAvailable", () => {
  it("is false when no model key is set", () => {
    withEnv({}, () => assert.equal(isGrokAvailable(), false));
  });

  it("is true when XAI_API_KEY is set", () => {
    withEnv({ XAI_API_KEY: "test-key-not-used" }, () => assert.equal(isGrokAvailable(), true));
  });
});

describe("resolveLlm", () => {
  it("defaults to Grok when only XAI_API_KEY is set", () => {
    withEnv({ XAI_API_KEY: "xai-test" }, () => {
      const llm = resolveLlm();
      assert.equal(llm?.label, "xAI");
      assert.equal(llm?.baseUrl, "https://api.x.ai/v1");
      assert.equal(llm?.model, "grok-4.5");
    });
  });

  it("lets a gateway win over Grok", () => {
    withEnv(
      {
        XAI_API_KEY: "xai-test",
        LLM_BASE_URL: "http://127.0.0.1:4000/v1",
        LLM_API_KEY: "sk-test",
        LLM_MODEL: "claude-sonnet-4-5",
      },
      () => {
        const llm = resolveLlm();
        assert.equal(llm?.label, "LLM");
        assert.equal(llm?.baseUrl, "http://127.0.0.1:4000/v1");
        assert.equal(llm?.model, "claude-sonnet-4-5");
      },
    );
  });
});

describe("grokChat", () => {
  it("returns the desk-facing unavailable error when the key is missing", async () => {
    const prev: Record<string, string | undefined> = {};
    for (const k of ["XAI_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "GROK_API_KEY", "OPENAI_API_KEY"]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      const res = await grokChat("sys", "user", 8);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error, GROK_UNAVAILABLE);
        assert.match(res.error, /not available/i);
      }
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("parseJsonBlock", () => {
  it("parses a fenced object", () => {
    const raw = '```json\n{"headline":"Hi"}\n```';
    assert.deepEqual(parseJsonBlock<{ headline: string }>(raw), { headline: "Hi" });
  });
});
