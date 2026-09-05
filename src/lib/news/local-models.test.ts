import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  discoverLocalModels,
  resetLocalCatalogCacheForTests,
  type LocalCatalog,
} from "./local-models.ts";
import { resetLocalDiscoveryReachableForTests } from "./provider-registry.ts";

const ENV_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "TOWNREPORTER_LOCAL_DISCOVERY"];

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  return fn().finally(() => {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

const LM_STUDIO_MODELS = {
  data: [{ id: "halo/qwen3-coder-30b-a3b-q6k" }, { id: "google/gemma-4-12b-qat" }, { id: "text-embedding-nomic" }],
};
const LM_STUDIO_NATIVE = {
  data: [
    { id: "halo/qwen3-coder-30b-a3b-q6k", state: "not-loaded", type: "llm" },
    { id: "google/gemma-4-12b-qat", state: "loaded", type: "llm" },
    { id: "text-embedding-nomic", state: "loaded", type: "embeddings" },
  ],
};
const OLLAMA_MODELS = {
  data: [{ id: "gemma4:12b" }, { id: "gemma4:e4b" }, { id: "translategemma:4b" }],
};
const OLLAMA_PS = { models: [{ name: "gemma4:12b" }] };

function fakeFetch(handlers: Record<string, unknown | (() => unknown) | "html" | "timeout">) {
  return async (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input);
    const match = Object.keys(handlers).find((k) => url.startsWith(k));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    const value = handlers[match];
    if (value === "timeout") {
      // Simulate the real AbortSignal.timeout() firing.
      const err = new Error("The operation was aborted");
      err.name = "TimeoutError";
      if (init?.signal?.aborted) throw err;
      throw err;
    }
    if (value === "html") {
      return new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    const body = typeof value === "function" ? value() : value;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("local model discovery", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetLocalCatalogCacheForTests();
    resetLocalDiscoveryReachableForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetLocalCatalogCacheForTests();
    resetLocalDiscoveryReachableForTests();
  });

  it("parses LM Studio's list plus native state/type, and drops embeddings", async () => {
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": LM_STUDIO_MODELS,
      "http://127.0.0.1:1234/api/v0/models": LM_STUDIO_NATIVE,
      "http://127.0.0.1:11434/v1/models": "timeout",
    }) as typeof fetch;

    const catalog: LocalCatalog = await withEnv({}, () => discoverLocalModels(true));
    const lmstudio = catalog.servers.find((s) => s.kind === "lmstudio");
    assert.ok(lmstudio?.reachable);
    const ids = lmstudio!.models.map((m) => m.id);
    assert.deepEqual(ids.sort(), ["google/gemma-4-12b-qat", "halo/qwen3-coder-30b-a3b-q6k"].sort());
    const gemma = lmstudio!.models.find((m) => m.id === "google/gemma-4-12b-qat")!;
    assert.equal(gemma.loaded, true);
    assert.equal(gemma.thinking, true);
    const qwen = lmstudio!.models.find((m) => m.id === "halo/qwen3-coder-30b-a3b-q6k")!;
    assert.equal(qwen.loaded, false);
    // Ollama did not answer -- omitted entirely, not reported unreachable.
    assert.ok(!catalog.servers.some((s) => s.kind === "ollama"));
  });

  it("parses Ollama's list plus /api/ps loaded state", async () => {
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": "timeout",
      "http://127.0.0.1:11434/v1/models": OLLAMA_MODELS,
      "http://127.0.0.1:11434/api/ps": OLLAMA_PS,
    }) as typeof fetch;

    const catalog = await withEnv({}, () => discoverLocalModels(true));
    const ollama = catalog.servers.find((s) => s.kind === "ollama");
    assert.ok(ollama?.reachable);
    assert.equal(ollama!.models.length, 3);
    const loaded = ollama!.models.find((m) => m.id === "gemma4:12b")!;
    assert.equal(loaded.loaded, true);
    const notLoaded = ollama!.models.find((m) => m.id === "translategemma:4b")!;
    assert.equal(notLoaded.loaded, false);
  });

  it("drops a non-JSON 200 (an unrelated web app on the same port)", async () => {
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": "timeout",
      "http://127.0.0.1:11434/v1/models": "timeout",
      "http://localhost:8080/v1/models": "html",
    }) as typeof fetch;

    const catalog = await withEnv({ LLM_BASE_URL: "http://localhost:8080/v1" }, () =>
      discoverLocalModels(true),
    );
    // Configured explicitly, so it stays in the list -- but unreachable,
    // because its body did not parse as the expected shape.
    const configured = catalog.servers.find((s) => s.baseUrl === "http://localhost:8080/v1");
    assert.ok(configured);
    assert.equal(configured!.reachable, false);
  });

  it("omits a probed default port that does not answer, rather than reporting it down", async () => {
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": "timeout",
      "http://127.0.0.1:11434/v1/models": "timeout",
    }) as typeof fetch;
    const catalog = await withEnv({}, () => discoverLocalModels(true));
    assert.deepEqual(catalog.servers, []);
    assert.equal(catalog.defaultModel, null);
  });

  it("respects TOWNREPORTER_LOCAL_DISCOVERY=0 by never probing the default ports", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    const catalog = await withEnv({ TOWNREPORTER_LOCAL_DISCOVERY: "0" }, () =>
      discoverLocalModels(true),
    );
    assert.equal(called, false);
    assert.deepEqual(catalog.servers, []);
  });

  it("picks the default: first loaded chat model, LM Studio before Ollama", async () => {
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": LM_STUDIO_MODELS,
      "http://127.0.0.1:1234/api/v0/models": LM_STUDIO_NATIVE,
      "http://127.0.0.1:11434/v1/models": OLLAMA_MODELS,
      "http://127.0.0.1:11434/api/ps": OLLAMA_PS,
    }) as typeof fetch;
    const catalog = await withEnv({}, () => discoverLocalModels(true));
    assert.deepEqual(catalog.defaultModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "google/gemma-4-12b-qat",
    });
  });

  it("falls back to LLM_MODEL when nothing is loaded, else the first chat model", async () => {
    const unloadedLmStudioNative = {
      data: [
        { id: "halo/qwen3-coder-30b-a3b-q6k", state: "not-loaded", type: "llm" },
        { id: "google/gemma-4-12b-qat", state: "not-loaded", type: "llm" },
        { id: "text-embedding-nomic", state: "loaded", type: "embeddings" },
      ],
    };
    globalThis.fetch = fakeFetch({
      "http://127.0.0.1:1234/v1/models": LM_STUDIO_MODELS,
      "http://127.0.0.1:1234/api/v0/models": unloadedLmStudioNative,
      "http://127.0.0.1:11434/v1/models": "timeout",
    }) as typeof fetch;

    const byModel = await withEnv({ LLM_MODEL: "google/gemma-4-12b-qat" }, () =>
      discoverLocalModels(true),
    );
    assert.deepEqual(byModel.defaultModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "google/gemma-4-12b-qat",
    });

    const byFirst = await withEnv({}, () => discoverLocalModels(true));
    assert.equal(byFirst.defaultModel?.id, "halo/qwen3-coder-30b-a3b-q6k");
  });
});
