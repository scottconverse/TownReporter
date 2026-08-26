import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GROK_UNAVAILABLE, grokChat, isGrokAvailable, parseJsonBlock } from "./ai.ts";

describe("isGrokAvailable", () => {
  it("is false when XAI_API_KEY is unset", () => {
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      assert.equal(isGrokAvailable(), false);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });

  it("is true when XAI_API_KEY is a non-empty string", () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key-not-used";
    try {
      assert.equal(isGrokAvailable(), true);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});

describe("grokChat", () => {
  it("returns the desk-facing unavailable error when the key is missing", async () => {
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      const res = await grokChat("sys", "user", 8);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error, GROK_UNAVAILABLE);
        assert.match(res.error, /not available/i);
      }
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});

describe("parseJsonBlock", () => {
  it("parses a fenced object", () => {
    const raw = '```json\n{"headline":"Hi"}\n```';
    assert.deepEqual(parseJsonBlock<{ headline: string }>(raw), { headline: "Hi" });
  });
});
