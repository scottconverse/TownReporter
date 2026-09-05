import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import {
  ensureProviderSettingsSchema,
  readProviderOverrides,
  resolveLocalModelChoice,
} from "./provider-settings.ts";

const NEWSROOM_ID = 9001;

async function storeRawLocalModel(baseUrl: string | null, id: string | null) {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  await sql.query(
    `
      insert into provider_settings (newsroom_id, provider_id, local_model_base_url, local_model_id)
      values ($1, 'local-model', $2, $3)
      on conflict (newsroom_id, provider_id) do update
        set local_model_base_url = excluded.local_model_base_url,
            local_model_id = excluded.local_model_id
    `,
    [NEWSROOM_ID, baseUrl, id],
  );
}

function withFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const CURRENT_MODELS = { data: [{ id: "gemma4:12b" }, { id: "gemma4:e4b" }] };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchWithOllamaOnly(): typeof fetch {
  return (async (input) => {
    const url = String(input);
    if (url === `${OLLAMA_BASE}/models`) return jsonResponse(CURRENT_MODELS);
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/ps`) return jsonResponse({ models: [] });
    throw new Error(`unreachable: ${url}`);
  }) as typeof fetch;
}

describe("the per-newsroom local-model override resolves against the live catalog", () => {
  beforeEach(async () => {
    resetLocalCatalogCacheForTests();
    await storeRawLocalModel(null, null);
  });
  afterEach(async () => {
    await storeRawLocalModel(null, null);
    resetLocalCatalogCacheForTests();
  });

  it("keeps the stored pick when it is still on the server's model list", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:e4b");
    const result = await withFetch(fetchWithOllamaOnly(), () => resolveLocalModelChoice(NEWSROOM_ID));
    assert.deepEqual(result.override, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" });
    assert.equal(result.notice, null);
  });

  it("falls back to the discovered default and returns a notice when the stored model vanished", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "a-model-that-was-removed");
    const result = await withFetch(fetchWithOllamaOnly(), () => resolveLocalModelChoice(NEWSROOM_ID));
    assert.equal(result.override?.id, "gemma4:12b"); // first model in the list = the default
    assert.match(result.notice ?? "", /a-model-that-was-removed is no longer on the server/);
    assert.match(result.notice ?? "", /using gemma4:12b/);
  });

  it("readProviderOverrides applies the same resolution for every model-calling caller", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "a-model-that-was-removed");
    const overrides = await withFetch(fetchWithOllamaOnly(), () => readProviderOverrides(NEWSROOM_ID));
    assert.deepEqual(overrides["local-model"]?.localModel, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
  });

  it("uses the discovered default when nothing has ever been stored", async () => {
    const result = await withFetch(fetchWithOllamaOnly(), () => resolveLocalModelChoice(NEWSROOM_ID));
    assert.deepEqual(result.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.equal(result.notice, null);
  });
});
