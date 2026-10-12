/*
  Release H, "Local model" shows a cloud DeepSeek model on the real screen
  (THT-1, THT-2, H06, DHG-3 -- failed twice after code fixes).

  Why two fixes missed it: the picker tests fed the picker a hand-written
  resolver answer (`source: "default"`, `storedPick: null`). The answer the
  real server gave on dev was `source: "stored"` with `storedPick` = the cloud
  model, because the newsroom still held an old UNSCOPED `provider_settings`
  row naming it and a scoped lookup falls back to that row. So this file runs
  the SAME path as the screen end to end: the real resolver
  (`readDeskLocalModelChoice`, the function behind the `getLocalModelChoice`
  server function) against a real (PGlite) newsroom and fake local servers,
  and hands exactly what it returns to the real picker markup.

  Every server is a stub. Nothing here loads, unloads or calls a model.
*/

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import {
  ensureProviderSettingsSchema,
  readDeskLocalModelChoice,
  readProviderOverrides,
} from "./provider-settings.ts";

const NEWSROOM_ID = 9102;
const LM_BASE = "http://127.0.0.1:1234/v1";
const LM_ROOT = "http://127.0.0.1:1234";
const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const OLLAMA_ROOT = "http://127.0.0.1:11434";
const LOADED = "halo/qwen3.8-27b-q6-fast";
const CLOUD = "deepseek-v4.1-flash:cloud";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/*
  The machine as it stood on dev: LM Studio has one vision-language model
  loaded and others on disk; Ollama has only cloud models and `/api/ps` is
  empty. `loaded: false` for every LM Studio model models "nothing loaded".
*/
function machine(options: { lmStudioLoaded: boolean }): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url === `${LM_BASE}/models`) {
      return jsonResponse({ data: [{ id: LOADED }, { id: "halo/qwen3.6-35b-a3b" }] });
    }
    if (url === `${LM_ROOT}/api/v0/models`) {
      return jsonResponse({
        data: [
          { id: LOADED, state: options.lmStudioLoaded ? "loaded" : "not-loaded", type: "vlm" },
          { id: "halo/qwen3.6-35b-a3b", state: "not-loaded", type: "llm" },
        ],
      });
    }
    if (url === `${OLLAMA_BASE}/models`) return jsonResponse({ data: [{ id: CLOUD }] });
    if (url === `${OLLAMA_ROOT}/api/ps`) return jsonResponse({ models: [] });
    if (url === `${OLLAMA_ROOT}/api/show` && init?.method === "POST") {
      return jsonResponse({ capabilities: ["completion"] });
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

async function storeUnscoped(baseUrl: string, id: string) {
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

async function storeScoped(scope: string, baseUrl: string, id: string) {
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

type Rendered = {
  optionText: string;
  /** The exact-model select under the picker: its value and the checked option's text. */
  subValue: string;
  subChecked: string;
  subOptions: string[];
  effortOptions: string[];
};

function options(selectHtml: string): { value: string; text: string; selected: boolean }[] {
  return [...selectHtml.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => ({
    value: /value="([^"]*)"/.exec(m[1])?.[1] ?? "",
    text: m[2].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, ""),
    selected: /\bselected(?:=|\s|$)/.test(m[1]),
  }));
}

/** Render the real picker from the real resolver's answer for `scope`. */
async function screen(scope: "story" | "scan", localAnswer: unknown): Promise<Rendered> {
  const harnessPath = "../../../scripts/model-picker-render.harness.mjs";
  const harness = await import(harnessPath);
  harness.availabilityStub.__setAvailability({});
  harness.availabilityStub.__setRole("owner");
  harness.availabilityStub.__setLocalChoice(localAnswer);
  const html: string = renderToStaticMarkup(
    createElement(harness.ModelPicker, {
      value: "local-model",
      scope,
      effort: null,
      onChange() {},
      onEffortChange() {},
    }),
  );
  const selects = [...html.matchAll(/<select[^>]*>[\s\S]*?<\/select>/g)].map((m) => m[0]);
  const writing = options(selects[0]);
  const sub = selects.find((s, i) => i > 0 && /spends credits|whatever model is loaded/.test(s)) ?? "";
  const subOptions = options(sub);
  const checked = subOptions.find((o) => o.selected);
  const effort = selects.find((s) => /aria-label="Thinking effort"|Thinking effort/.test(s)) ?? "";
  void effort;
  const effortSelect = selects.filter((s, i) => i > 0 && s !== sub)[0] ?? "";
  return {
    optionText: writing.find((o) => o.value === "local-model")?.text ?? "",
    subValue: checked?.value ?? "",
    subChecked: checked?.text ?? "",
    subOptions: subOptions.map((o) => o.text),
    effortOptions: options(effortSelect).map((o) => o.text),
  };
}

describe("Release H: Local model never shows a cloud default (same path as the screen)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ["LLM_BASE_URL", "LLM_MODEL", "TOWNREPORTER_LOCAL_DISCOVERY"] as const) {
      savedEnv[key] = process.env[key];
    }
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    process.env.TOWNREPORTER_LOCAL_DISCOVERY = "1";
    resetLocalCatalogCacheForTests();
    await ensureProviderSettingsSchema();
    const sql = await getSql();
    await sql.query(
      `insert into newsrooms (id, name) values ($1, 'Local pick screen path') on conflict (id) do nothing`,
      [NEWSROOM_ID],
    );
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from provider_settings where newsroom_id = $1`, [NEWSROOM_ID]);
  });

  afterEach(() => {
    for (const key of ["LLM_BASE_URL", "LLM_MODEL", "TOWNREPORTER_LOCAL_DISCOVERY"] as const) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetLocalCatalogCacheForTests();
  });

  it("an old unscoped cloud row does not become the story's Local model while LM Studio has one loaded", async () => {
    // The dev database: only the old unscoped row, naming the cloud model.
    await storeUnscoped(OLLAMA_BASE, CLOUD);
    await withFetch(machine({ lmStudioLoaded: true }), async () => {
      const answer = await readDeskLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(answer.storedPick ?? null, null, "an unscoped cloud row is not this screen's stored pick");
      assert.deepEqual(answer.override, { baseUrl: LM_BASE, id: LOADED });
      assert.equal(answer.source, "loaded");

      const shown = await screen("story", answer);
      assert.equal(shown.optionText, `Local model (${LOADED})`);
      assert.equal(shown.subValue, "* *");
      assert.equal(shown.subChecked, "Use whatever model is loaded (recommended)");
      assert.doesNotMatch(shown.subChecked, /cloud|deepseek/i);
      assert.equal(shown.effortOptions.length, 1, "a local model has one effort: off");
      assert.match(shown.effortOptions[0], /^Off/, "a local model runs with effort off");
      assert.ok(
        shown.subOptions.some((t) => t.startsWith(`${CLOUD} · cloud`)),
        "the cloud entry stays in the exact list",
      );
    });
  });

  it("the run path agrees: the same row does not send a story run to the cloud model", async () => {
    await storeUnscoped(OLLAMA_BASE, CLOUD);
    await withFetch(machine({ lmStudioLoaded: true }), async () => {
      const overrides = await readProviderOverrides(NEWSROOM_ID, "story");
      assert.deepEqual(overrides["local-model"]?.localModel, { baseUrl: LM_BASE, id: LOADED });
    });
  });

  it("an editor's own cloud pick for this screen is still honored (never removed)", async () => {
    await storeUnscoped(OLLAMA_BASE, CLOUD);
    await storeScoped("story", OLLAMA_BASE, CLOUD);
    await withFetch(machine({ lmStudioLoaded: true }), async () => {
      const answer = await readDeskLocalModelChoice(NEWSROOM_ID, "story");
      assert.deepEqual(answer.storedPick, { baseUrl: OLLAMA_BASE, id: CLOUD });
      assert.equal(answer.source, "stored");
      const shown = await screen("story", answer);
      assert.equal(shown.optionText, `Local model (${CLOUD})`);
      assert.match(shown.subChecked, new RegExp(`^${CLOUD} · cloud`));
    });
  });

  it("says nothing is loaded, and names no cloud model, when LM Studio has nothing in memory", async () => {
    await storeUnscoped(OLLAMA_BASE, CLOUD);
    await withFetch(machine({ lmStudioLoaded: false }), async () => {
      const answer = await readDeskLocalModelChoice(NEWSROOM_ID, "story");
      assert.equal(answer.storedPick ?? null, null);
      const shown = await screen("story", answer);
      assert.equal(shown.optionText, "Local model (nothing loaded)");
      assert.equal(shown.subValue, "* *");
      assert.equal(shown.subChecked, "Use whatever model is loaded (recommended)");
    });
  });
});
