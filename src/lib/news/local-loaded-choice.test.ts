/*
  Unit BB items 2, 3 and 4 against a real (PGlite) choice row and fake local
  servers: "Use whatever is loaded" resolves at call time, and a pick that is
  not loaded stops the run BEFORE any model call.

  Every server here is a stub -- nothing in this file loads, unloads, or even
  reaches a real LM Studio or Ollama, and no call is made to a model endpoint
  that the stub has not been told about. "No fetch to the model endpoint" is
  asserted against the URL log the stub itself records (`log`), never against
  a message.

  The load-state rule these tests pin, in Scott's words from 2026-09-26: the
  desk must show what is loaded, offer to use it, and never pull a model in.
*/

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { probeProvider } from "./ai.ts";
import {
  ensureProviderSettingsSchema,
  readProviderOverrides,
  resolveLocalModelChoice,
} from "./provider-settings.ts";
import { cleanLocalModelInput } from "./request-input.ts";
import {
  USE_LOADED_LOCAL_MODEL,
  USE_LOADED_LOCAL_MODEL_LABEL,
} from "./model-choice.ts";
import { LOCAL_MODEL_NOTHING_LOADED } from "./preflight.ts";

const NEWSROOM_ID = 9101;
const LM_BASE = "http://127.0.0.1:1234/v1";
const LM_ROOT = "http://127.0.0.1:1234";
const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const OLLAMA_ROOT = "http://127.0.0.1:11434";
const CLOUD_IDS = ["deepseek-v4.1-flash:cloud", "glm-5.3-flash:cloud"];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/*
  A fake pair of local servers. `lmStudio` / `ollama` are absent when that
  server is down (the stub throws, discovery treats it as not there, exactly
  as it treats a real closed port).
*/
type FakeServers = {
  lmStudio?: { id: string; loaded: boolean }[];
  ollama?: { ids: string[]; running?: string[] };
  log: string[];
};

function fakeFetch(servers: FakeServers): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    servers.log.push(url);
    if (servers.lmStudio && url === `${LM_BASE}/models`) {
      return jsonResponse({ data: servers.lmStudio.map((m) => ({ id: m.id })) });
    }
    if (servers.lmStudio && url === `${LM_ROOT}/api/v0/models`) {
      return jsonResponse({
        data: servers.lmStudio.map((m) => ({
          id: m.id,
          state: m.loaded ? "loaded" : "not-loaded",
          type: "llm",
        })),
      });
    }
    if (servers.ollama && url === `${OLLAMA_BASE}/models`) {
      return jsonResponse({ data: servers.ollama.ids.map((id) => ({ id })) });
    }
    if (servers.ollama && url === `${OLLAMA_ROOT}/api/ps`) {
      return jsonResponse({ models: (servers.ollama.running ?? []).map((name) => ({ name })) });
    }
    if (url === `${OLLAMA_ROOT}/api/show` && init?.method === "POST") {
      return jsonResponse({ capabilities: ["completion"] });
    }
    if (url.includes("/chat/completions")) {
      // A refusal test that reaches here has already failed; recording the
      // call in `log` is what lets the assertion say so by name.
      return jsonResponse({ choices: [{ message: { content: "unexpected" } }] });
    }
    throw new Error(`unreachable: ${url}`);
  }) as typeof fetch;
}

function withFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

async function storeRawScopedChoice(scope: string, baseUrl: string, id: string) {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  await sql.query(
    `
      insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id)
      values ($1, $2, $3, $4)
      on conflict (newsroom_id, scope) do update
        set base_url = excluded.base_url, model_id = excluded.model_id
    `,
    [NEWSROOM_ID, scope, baseUrl, id],
  );
}

async function storeRawUnscoped(baseUrl: string | null, id: string | null) {
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

async function clearScopedChoices() {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
}

function wroteChatCall(log: string[]): boolean {
  return log.some((url) => url.includes("/chat/completions"));
}

/** LM Studio with ONE model in memory and one on disk but not loaded. */
function lmStudioHalfLoaded(loadedId: string, idleId: string): FakeServers {
  return {
    lmStudio: [
      { id: loadedId, loaded: true },
      { id: idleId, loaded: false },
    ],
    ollama: { ids: CLOUD_IDS, running: [] },
    log: [],
  };
}

describe("Unit BB: local model picker load state", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    savedEnv.LLM_BASE_URL = process.env.LLM_BASE_URL;
    savedEnv.LLM_MODEL = process.env.LLM_MODEL;
    savedEnv.TOWNREPORTER_LOCAL_DISCOVERY = process.env.TOWNREPORTER_LOCAL_DISCOVERY;
    // Discovery must not pick up this machine's own configuration: these
    // tests are about the fake ports above and nothing else.
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    process.env.TOWNREPORTER_LOCAL_DISCOVERY = "1";
    resetLocalCatalogCacheForTests();
    await clearScopedChoices();
    await storeRawUnscoped(null, null);
    // `newsroom_local_model_choices.newsroom_id` is a foreign key in
    // production too, so the row has to exist for the same reason it does
    // there (PROJECT-BRIEF rule 14).
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Local loaded test') on conflict (id) do nothing`, [
      NEWSROOM_ID,
    ]);
  });

  afterEach(() => {
    for (const key of ["LLM_BASE_URL", "LLM_MODEL", "TOWNREPORTER_LOCAL_DISCOVERY"] as const) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetLocalCatalogCacheForTests();
  });

  it("stores the sentinel through the real save validator, in the columns that already exist", () => {
    const cleaned = cleanLocalModelInput({
      baseUrl: USE_LOADED_LOCAL_MODEL,
      id: USE_LOADED_LOCAL_MODEL,
      scope: "story",
    });
    assert.equal(cleaned.invalidScope, false);
    assert.equal(cleaned.invalidInput, false, "no migration: the sentinel is a pair of ordinary short strings");
    assert.deepEqual(cleaned.choice, { baseUrl: "*", id: "*" });
    assert.equal(USE_LOADED_LOCAL_MODEL_LABEL, "Use whatever is loaded");
  });

  it("resolves 'Use whatever is loaded' to the model in memory, and names it on the receipt", async () => {
    await storeRawScopedChoice("story", "*", "*");
    const servers = lmStudioHalfLoaded("halo-brain-35b", "qwen3.6-35b-a3b");
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(choice.source, "loaded");
      assert.deepEqual(choice.override, { baseUrl: LM_BASE, id: "halo-brain-35b" });
      assert.equal(choice.notice, null);

      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "story");
      assert.equal(result.ok, true);
      assert.equal(result.label, "Local model (halo-brain-35b)");
      assert.deepEqual(result.localModel, { baseUrl: LM_BASE, id: "halo-brain-35b" });
      assert.equal(wroteChatCall(servers.log), false, "probing a model must not call it");
    });
  });

  it("refuses, with the exact words, when 'Use whatever is loaded' finds nothing loaded", async () => {
    await storeRawScopedChoice("story", "*", "*");
    const servers: FakeServers = {
      lmStudio: [
        { id: "halo-brain-35b", loaded: false },
        { id: "qwen3.6-35b-a3b", loaded: false },
      ],
      ollama: { ids: ["gemma4:12b"], running: [] },
      log: [],
    };
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(choice.source, "loaded");
      assert.equal(choice.override, null, "nothing loaded means no model -- not the cloud default");
      assert.equal(choice.notice, null);

      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "story");
      assert.deepEqual(result, { ok: false, error: LOCAL_MODEL_NOTHING_LOADED });
      assert.equal(wroteChatCall(servers.log), false);
    });
  });

  it("refuses a hand-picked model that is on disk but not loaded, before the call", async () => {
    await storeRawScopedChoice("story", LM_BASE, "qwen3.6-35b-a3b");
    const servers = lmStudioHalfLoaded("halo-brain-35b", "qwen3.6-35b-a3b");
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(choice.source, "stored");
      assert.deepEqual(choice.override, { baseUrl: LM_BASE, id: "qwen3.6-35b-a3b" });

      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "story");
      assert.deepEqual(result, {
        ok: false,
        error: "qwen3.6-35b-a3b is not loaded in LM Studio. Load it there, or pick Use whatever is loaded.",
      });
      assert.equal(wroteChatCall(servers.log), false);
    });
  });

  it("allows a hand-picked model on a server that reports no load state at all", async () => {
    await storeRawScopedChoice("story", OLLAMA_BASE, "gemma4:12b");
    const servers: FakeServers = { ollama: { ids: ["gemma4:12b"], running: [] }, log: [] };
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.deepEqual(choice.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });

      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "story");
      assert.equal(result.ok, true, "loaded === null is today's behavior: not blocked");
      assert.deepEqual(result.localModel, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    });
  });

  it("never blocks an Ollama Cloud pick, even when it is not held in memory", async () => {
    await storeRawScopedChoice("story", OLLAMA_BASE, "deepseek-v4.1-flash:cloud");
    // /api/ps names a different model, so every cloud id reports loaded: false.
    const servers: FakeServers = {
      ollama: { ids: CLOUD_IDS, running: ["gemma4:12b"] },
      log: [],
    };
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.deepEqual(choice.override, { baseUrl: OLLAMA_BASE, id: "deepseek-v4.1-flash:cloud" });

      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "story");
      assert.equal(result.ok, true, "a hosted model is never 'not loaded' in the local sense");
      assert.deepEqual(result.localModel, { baseUrl: OLLAMA_BASE, id: "deepseek-v4.1-flash:cloud" });
    });
  });

  it("defaults to 'Use whatever is loaded' when something is loaded and nothing was stored", async () => {
    const servers = lmStudioHalfLoaded("halo-brain-35b", "qwen3.6-35b-a3b");
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(choice.source, "loaded");
      assert.deepEqual(choice.override, { baseUrl: LM_BASE, id: "halo-brain-35b" });
      assert.equal(choice.notice, null);
    });
  });

  it("keeps the preferred cloud default when nothing is loaded and nothing was stored", async () => {
    const servers: FakeServers = { ollama: { ids: CLOUD_IDS, running: [] }, log: [] };
    await withFetch(fakeFetch(servers), async () => {
      const choice = await resolveLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(choice.source, "default", "the picker's help line needs to say why");
      assert.deepEqual(choice.override, { baseUrl: OLLAMA_BASE, id: "deepseek-v4.1-flash:cloud" });
    });
  });

  it("hands every model call a real model, never the sentinel", async () => {
    await storeRawScopedChoice("story", "*", "*");
    const loaded = lmStudioHalfLoaded("halo-brain-35b", "qwen3.6-35b-a3b");
    await withFetch(fakeFetch(loaded), async () => {
      const overrides = await readProviderOverrides(NEWSROOM_ID, "story");
      assert.deepEqual(overrides["local-model"]?.localModel, { baseUrl: LM_BASE, id: "halo-brain-35b" });
    });

    resetLocalCatalogCacheForTests();
    const none: FakeServers = {
      lmStudio: [{ id: "halo-brain-35b", loaded: false }],
      ollama: { ids: CLOUD_IDS, running: [] },
      log: [],
    };
    await withFetch(fakeFetch(none), async () => {
      const overrides = await readProviderOverrides(NEWSROOM_ID, "story");
      assert.equal(
        overrides["local-model"]?.localModel ?? null,
        null,
        "with nothing loaded the sentinel must resolve to null, never to a literal '*'",
      );
    });
  });
});
