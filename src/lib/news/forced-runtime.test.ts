import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { productionOcr } from "./ocr.ts";
import { singleRenderedPdfFixture } from "./pdf-test-fixture.ts";
import {
  forcedOcrOptions,
  parseForcedRuntimeSnapshot,
  runForcedChat,
  validateForcedRuntime,
  type ForcedRuntimeSnapshot,
} from "./forced-runtime.server.ts";
import { ensureProviderSettingsSchema } from "./provider-settings.ts";

const claude = {
  runtime: "claude-cli",
  modelChoice: "claude-sonnet",
  transport: "claude-code",
  model: "selected-claude",
} as const satisfies ForcedRuntimeSnapshot;

describe("forced runtime snapshots", () => {
  it("rejects a runtime paired with another provider choice", () => {
    assert.equal(parseForcedRuntimeSnapshot({ ...claude, modelChoice: "codex-balanced" }), null);
  });

  for (const malformed of [
    { runtime: "claude-cli", modelChoice: "claude-sonnet", transport: "claude-code" },
    { runtime: "local", modelChoice: "local-model", transport: "local" },
    { ...claude, transport: "codex" },
  ]) {
    it("refuses malformed snapshots before an adapter call", async () => {
      let calls = 0;
      await assert.rejects(
        runForcedChat(malformed as ForcedRuntimeSnapshot, "system", "user", 100, undefined, {
          claude: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
          codex: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
          local: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
        }),
        /snapshot is invalid/,
      );
      assert.equal(calls, 0);
    });
  }

  it("preserves noTools on forced Claude Code calls", async () => {
    let received: unknown;
    const result = await runForcedChat(
      claude,
      "system",
      "user",
      100,
      { noTools: true },
      {
        claude: async (input) => {
          received = input;
          return { ok: true as const, text: "done" };
        },
        codex: async () => {
          throw new Error("wrong transport");
        },
        local: async () => {
          throw new Error("wrong transport");
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal((received as { noTools?: boolean }).noTools, true);
  });

  for (const [modelChoice, transport, model] of [
    ["codex-astra", "codex", "gpt-6-astra"],
    ["codex-frontier", "codex", "gpt-5.6-sol"],
    ["codex-balanced", "codex", "gpt-5.6-terra"],
    ["codex-luna", "codex", "gpt-5.6-luna"],
    ["claude-fable", "claude-code", "fable"],
    ["claude-frontier", "claude-code", "claude-opus-5"],
    ["claude-sonnet", "claude-code", "sonnet"],
    ["claude-haiku", "claude-code", "haiku"],
  ] as const) {
    it(`keeps ${modelChoice} pinned to its exact model and transport`, async () => {
      const snapshot = {
        runtime: modelChoice,
        modelChoice,
        transport,
        model,
      } as const satisfies ForcedRuntimeSnapshot;
      assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
      const calls: Array<{ transport: string; model: string }> = [];
      await runForcedChat(snapshot, "system", "user", 100, undefined, {
        claude: async (input) => {
          calls.push({ transport: "claude-code", model: input.model });
          return { ok: true };
        },
        codex: async (input) => {
          calls.push({ transport: "codex", model: input.model });
          return { ok: true };
        },
        local: async () => {
          throw new Error("named cloud models must not use Local model");
        },
      });
      assert.deepEqual(calls, [{ transport, model }]);
    });
  }

  it("uses forced Claude Code OCR when a metered Anthropic key is present", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "must-not-be-used";
    const calls: string[] = [];
    try {
      const result = await productionOcr(
        singleRenderedPdfFixture(),
        forcedOcrOptions(claude, undefined, {
          anthropic: async () => {
            calls.push("anthropic");
            return "wrong";
          },
          "claude-code": async () => {
            calls.push("claude-code");
            return "Recorded passage";
          },
        }),
      );
      assert.deepEqual(calls, ["claude-code"]);
      assert.match(result.text, /Recorded passage/);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("keeps saved Custom AI credentials out of the batch snapshot and resolves them at call time", async () => {
    const snapshot = {
      runtime: "custom:11111111-1111-4111-8111-111111111111",
      modelChoice: "custom:11111111-1111-4111-8111-111111111111",
      transport: "custom",
      model: "gemini-2.5-flash",
      newsroomId: 42,
      label: "Gemini",
    } as const satisfies ForcedRuntimeSnapshot;
    assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
    assert.doesNotMatch(JSON.stringify(snapshot), /api.?key|secret|base.?url/i);
    let received: unknown;
    const result = await runForcedChat(snapshot, "system", "user", 100, undefined, {
      claude: async () => { throw new Error("wrong transport"); },
      codex: async () => { throw new Error("wrong transport"); },
      local: async () => { throw new Error("wrong transport"); },
      custom: async (_system, _user, _maxTokens, options) => {
        received = options;
        return { ok: true as const, text: "done" };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(received, {
      choice: snapshot.modelChoice,
      newsroomId: 42,
      model: "gemini-2.5-flash",
    });
    assert.deepEqual(forcedOcrOptions(snapshot), {
      provider: snapshot.modelChoice,
      newsroomId: "42",
      localModel: undefined,
      forcedPlan: undefined,
      beforeModelCall: undefined,
      adapters: undefined,
    });
  });

  it("keeps SuperGrok credentials out of the batch snapshot and resolves them at call time", async () => {
    const snapshot = {
      runtime: "grok-oauth",
      modelChoice: "grok-oauth",
      transport: "xai-oauth",
      model: "grok-4.6",
      newsroomId: 42,
    } as const satisfies ForcedRuntimeSnapshot;
    assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
    assert.doesNotMatch(JSON.stringify(snapshot), /access.?token|refresh.?token|secret/i);
    let received: unknown;
    const result = await runForcedChat(snapshot, "system", "user", 100, undefined, {
      claude: async () => { throw new Error("wrong transport"); },
      codex: async () => { throw new Error("wrong transport"); },
      local: async () => { throw new Error("wrong transport"); },
      xai: async (_system, _user, _maxTokens, options) => {
        received = options;
        return { ok: true as const, text: "done" };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(received, {
      choice: "grok-oauth",
      newsroomId: 42,
      model: "grok-4.6",
    });
    assert.equal(forcedOcrOptions(snapshot).provider, "grok-oauth");
    assert.equal(forcedOcrOptions(snapshot).newsroomId, "42");
  });

  it("preflights the exact saved Forced model and preserves the legacy LM Studio choice", async () => {
    const newsroomId = 9063;
    const globalBase = "http://127.0.0.1:1234/v1";
    const scopedBase = "http://127.0.0.1:11434/v1";
    const legacyModel = "legacy-lmstudio-model";
    const forcedModel = "deepseek-v4.1-flash:cloud";
    const sql = await getSql();
    await ensureProviderSettingsSchema();
    await sql.query(
      "insert into newsrooms(id,name) values($1,'Forced scoped preflight test') on conflict(id) do nothing",
      [newsroomId],
    );
    await sql.query(
      "insert into provider_settings(newsroom_id,provider_id,local_model_base_url,local_model_id) values($1,'local-model',$2,$3) on conflict(newsroom_id,provider_id) do update set local_model_base_url=excluded.local_model_base_url,local_model_id=excluded.local_model_id",
      [newsroomId, globalBase, legacyModel],
    );
    await sql.query(
      "insert into newsroom_local_model_choices(newsroom_id,scope,base_url,model_id) values($1,'forced',$2,$3) on conflict(newsroom_id,scope) do update set base_url=excluded.base_url,model_id=excluded.model_id",
      [newsroomId, scopedBase, forcedModel],
    );

    const originalFetch = globalThis.fetch;
    const originalEnv = {
      base: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
      discovery: process.env.TOWNREPORTER_LOCAL_DISCOVERY,
    };
    const requests: string[] = [];
    let forcedModels = [forcedModel];
    process.env.LLM_BASE_URL = globalBase;
    process.env.LLM_MODEL = legacyModel;
    process.env.TOWNREPORTER_LOCAL_DISCOVERY = "0";
    resetLocalCatalogCacheForTests();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      const models = url.startsWith(`${scopedBase}/`)
        ? forcedModels
        : [legacyModel];
      return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const scoped = await validateForcedRuntime(newsroomId, "local-model");
      assert.deepEqual(scoped, {
        runtime: "local",
        modelChoice: "local-model",
        transport: "local",
        localModel: { baseUrl: scopedBase, id: forcedModel },
        modelEffort: "none",
      });
      assert.equal(
        requests.at(-1),
        `${scopedBase}/models`,
        "the selected Forced endpoint and model must be probed, not the global LM Studio model",
      );

      forcedModels = ["another-cloud-model"];
      await assert.rejects(
        validateForcedRuntime(newsroomId, "local-model"),
        new RegExp(`model ${forcedModel} is not loaded`),
        "a scoped model missing from its exact server must block forced-run enqueue",
      );
      assert.equal(requests.at(-1), `${scopedBase}/models`);

      await sql.query(
        "delete from newsroom_local_model_choices where newsroom_id=$1 and scope='forced'",
        [newsroomId],
      );
      const legacy = await validateForcedRuntime(newsroomId, "local-model");
      assert.deepEqual(legacy, {
        runtime: "local",
        modelChoice: "local-model",
        transport: "local",
        localModel: { baseUrl: globalBase, id: legacyModel },
      });
      assert.equal(
        requests.at(-1),
        `${globalBase}/models`,
        "without a scoped choice, the existing LM Studio setting remains the selected model",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries({
        LLM_BASE_URL: originalEnv.base,
        LLM_MODEL: originalEnv.model,
        TOWNREPORTER_LOCAL_DISCOVERY: originalEnv.discovery,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetLocalCatalogCacheForTests();
      await sql.query("delete from newsroom_local_model_choices where newsroom_id=$1 and scope='forced'", [newsroomId]);
      await sql.query("delete from provider_settings where newsroom_id=$1 and provider_id='local-model'", [newsroomId]);
      await sql.query("delete from newsrooms where id=$1", [newsroomId]);
    }
  });
});
