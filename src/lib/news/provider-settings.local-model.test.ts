import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { probeProvider } from "./ai.ts";
import {
  ensureProviderSettingsSchema,
  readProviderOverrides,
  resolveLocalModelChoice,
  saveLocalModel,
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
const CLOUD_MODELS = [
  "deepseek-v4.1-flash:cloud",
  "glm-5.2:cloud",
  "glm-5.3-flash:cloud",
  "qwen3.5:397b-cloud",
];

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

function fetchWithModels(ids: string[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url === `${OLLAMA_BASE}/models`) return jsonResponse({ data: ids.map((id) => ({ id })) });
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/ps`) return jsonResponse({ models: [] });
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/show` && init?.method === "POST") {
      return jsonResponse({ capabilities: ["completion"] });
    }
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
    const sql = await getSql();
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_members where user_id = 'scoped-model-editor'`);
    resetLocalCatalogCacheForTests();
  });

  it("keeps scan and story Ollama choices separate while preserving the legacy fallback", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_members (user_id, role, newsroom_id) values ('scoped-model-editor', 'editor', $1) on conflict (user_id) do update set newsroom_id = excluded.newsroom_id`, [NEWSROOM_ID]);
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:12b");
    assert.deepEqual(await saveLocalModel("scoped-model-editor", { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" }, "scan"), { ok: true });
    const result = await withFetch(fetchWithModels([...CLOUD_MODELS, "gemma4:12b", "gemma4:e4b"]), async () => ({
      scan: await readProviderOverrides(NEWSROOM_ID, "scan"),
      story: await readProviderOverrides(NEWSROOM_ID, "story"),
      picker: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.equal(result.scan["local-model"]?.localModel?.id, "gemma4:e4b");
    assert.equal(result.story["local-model"]?.localModel?.id, "gemma4:12b");
    assert.equal(result.picker.override?.id, "gemma4:e4b");
  });

  it("prefers DeepSeek across scopes while every requested cloud model remains selectable", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_members (user_id, role, newsroom_id) values ('scoped-model-editor', 'editor', $1) on conflict (user_id) do update set newsroom_id = excluded.newsroom_id`, [NEWSROOM_ID]);
    const scopes = ["story", "scan", "opinion", "dark", "forced"] as const;
    const expectedDefault: Record<(typeof scopes)[number], string> = {
      story: "deepseek-v4.1-flash:cloud",
      scan: "deepseek-v4.1-flash:cloud",
      opinion: "deepseek-v4.1-flash:cloud",
      dark: "deepseek-v4.1-flash:cloud",
      forced: "deepseek-v4.1-flash:cloud",
    };

    await withFetch(fetchWithModels(CLOUD_MODELS), async () => {
      for (const scope of scopes) {
        const firstRun = await resolveLocalModelChoice(NEWSROOM_ID, scope);
        assert.equal(firstRun.override?.id, expectedDefault[scope], `${scope} first-run preference`);
      }

      for (const scope of scopes) {
        for (const id of CLOUD_MODELS) {
          assert.deepEqual(await saveLocalModel("scoped-model-editor", { baseUrl: OLLAMA_BASE, id }, scope), { ok: true });
          const saved = await resolveLocalModelChoice(NEWSROOM_ID, scope);
          assert.deepEqual(saved.override, { baseUrl: OLLAMA_BASE, id }, `${scope} must retain ${id}`);
          const ready = await probeProvider("local-model", NEWSROOM_ID, undefined, scope);
          assert.equal(ready.ok, true, `${scope} must preflight exact selected model ${id}`);
        }
      }
    });
  });

  it("does not replace an unavailable scoped cloud choice with the catalog default", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'deepseek-v4.1-flash:cloud')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const result = await withFetch(fetchWithOllamaOnly(), async () => ({
      scan: await readProviderOverrides(NEWSROOM_ID, "scan"),
      picker: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.equal(result.scan["local-model"]?.localModel?.id, "deepseek-v4.1-flash:cloud");
    assert.equal(result.picker.override?.id, "deepseek-v4.1-flash:cloud");
    assert.match(result.picker.notice ?? "", /not reachable or listed/);
  });

  it("preflights the scoped Ollama pick even when LM Studio is configured globally", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'gemma4:e4b')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const oldBase = process.env.LLM_BASE_URL;
    const oldModel = process.env.LLM_MODEL;
    process.env.LLM_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.LLM_MODEL = "a-local-model";
    try {
      const result = await withFetch(fetchWithOllamaOnly(), () => probeProvider("local-model", NEWSROOM_ID, undefined, "scan"));
      assert.equal(result.ok, true);
    } finally {
      if (oldBase === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBase;
      if (oldModel === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = oldModel;
    }
  });

  it("fails a saved scoped Ollama pick closed when /models returns malformed data", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'deepseek-v4.1-flash:cloud')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "deepseek-v4.1-flash:cloud" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    try {
      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "scan");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /invalid model list.*could not verify/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    const result = await withFetch(fetchWithOllamaOnly(), async () => ({
      global: await resolveLocalModelChoice(NEWSROOM_ID),
      scan: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.deepEqual(result.global.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.equal(result.global.notice, null);
    assert.deepEqual(result.scan.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" }, "when the preferred cloud model is absent, keep the normal discovered fallback");
  });
});
