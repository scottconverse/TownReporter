import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { checkOpinionReadiness } from "./opinion-readiness.ts";
import { ensureProviderSettingsSchema } from "./provider-settings.ts";

async function withEnv<T>(changes: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(changes)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Opinion provider readiness", { concurrency: false }, () => {
  it("probes an explicitly selected custom connection in its newsroom", async () => {
    const custom = "custom:9ce9a944-f444-4a69-8927-7c7705c07a35" as const;
    const calls: Array<[string, number | undefined]> = [];
    const result = await checkOpinionReadiness(
      custom,
      {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        probeCandidate: async (choice, newsroomId) => {
          calls.push([choice, newsroomId]);
          return { ok: true as const, label: "Custom AI", choice };
        },
      },
      44,
    );
    assert.equal(result.ready, true);
    assert.equal(result.effectiveChoice, custom);
    assert.deepEqual(calls, [[custom, 44]]);
  });
  it("does not mistake an Anthropic API key for the Claude Code CLI Opinion path", async () => {
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("Opinion readiness must not probe the Anthropic API path");
    };
    try {
      const result = await withEnv(
        { TOWNREPORTER_CLAUDE_CODE: "0", ANTHROPIC_API_KEY: "present-but-not-an-opinion-path" },
        () =>
          checkOpinionReadiness("claude-frontier", {
            findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
          }),
      );
      assert.equal(result.ready, false);
      assert.match(result.why, /Claude Code.*unavailable|open Claude Code/i);
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Automatic accepts Codex Sol first without probing the Claude fallback", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("auto", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: true as const, label: "Codex Sol", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.effectiveChoice, "auto");
    assert.deepEqual(probed, ["codex-frontier"]);
  });

  it("a provider auth failure is reported as-is and probes nothing else", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("claude-frontier", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: false as const, error: "Claude Code OAuth session expired." };
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.why, /OAuth session expired/i);
    assert.deepEqual(probed, ["claude-frontier"]);
  });

  /*
    Audit finding "Opinion 'Local model' pick silently uses Claude":
    `checkOpinionReadiness` used to hardcode `candidates = ["claude-frontier"]`
    regardless of the `choice` argument, so an explicit "local-model" pick
    probed (and, via the commit boundary, persisted and queued) Claude
    instead. These pin the fix: an explicit pick probes only that candidate.
  */
  it("an explicit local-model pick probes ONLY local-model, never Claude", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("local-model", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: true as const, label: "Local model", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(
      result.effectiveChoice,
      "local-model",
      "a local-model pick must not be silently replaced by another provider",
    );
    assert.deepEqual(probed, ["local-model"]);
  });

  it("an unready local-model pick is reported as not-ready with the local probe's own message, and stays local-model", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("local-model", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: false as const, error: "LLM is unreachable. Check that it is running." };
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.why, /unreachable/i);
    assert.doesNotMatch(
      result.why,
      /Claude Code/i,
      "a local-model failure must never be reported as a Claude Code problem",
    );
    assert.equal(result.effectiveChoice, "local-model");
    assert.deepEqual(probed, ["local-model"]);
  });

  it("the real candidate probe keeps local-model on the local path when discovery is explicitly disabled", async () => {
    const result = await withEnv(
      {
        LLM_BASE_URL: undefined,
        LLM_API_KEY: undefined,
        LLM_MODEL: undefined,
        OPENAI_API_KEY: undefined,
        TOWNREPORTER_LOCAL_DISCOVERY: "0",
      },
      () =>
        checkOpinionReadiness("local-model", {
          findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        }),
    );
    assert.equal(result.ready, false);
    assert.doesNotMatch(
      result.why,
      /No Opinion model is available\. Open Claude Code on this machine and sign in\./,
      "an unconfigured local-model pick must not be rewritten into Opinion's Claude-only " +
        "sign-in message -- that message names no fix for a local server at all",
    );
    assert.match(
      result.why,
      /Start LM Studio's local server or Ollama.*click Refresh/,
      "the guidance for an unavailable local-model pick must explain how to make it reachable",
    );
  });

  it("preflights the saved Opinion model itself when a different global local model is configured", async () => {
    const newsroomId = 9062;
    const scopedBase = "http://127.0.0.1:11434/v1";
    const globalBase = "http://127.0.0.1:1234/v1";
    const selectedModel = "glm-5.2:cloud";
    const sql = await getSql();
    await ensureProviderSettingsSchema();
    await sql.query(
      "insert into newsrooms(id,name) values($1,'Opinion scoped preflight test') on conflict(id) do nothing",
      [newsroomId],
    );
    await sql.query(
      "insert into provider_settings(newsroom_id,provider_id,local_model_base_url,local_model_id) values($1,'local-model',$2,'global-lmstudio-model') on conflict(newsroom_id,provider_id) do update set local_model_base_url=excluded.local_model_base_url,local_model_id=excluded.local_model_id",
      [newsroomId, globalBase],
    );
    await sql.query(
      "insert into newsroom_local_model_choices(newsroom_id,scope,base_url,model_id) values($1,'opinion',$2,$3) on conflict(newsroom_id,scope) do update set base_url=excluded.base_url,model_id=excluded.model_id",
      [newsroomId, scopedBase, selectedModel],
    );

    const originalFetch = globalThis.fetch;
    const originalEnv = {
      base: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
      discovery: process.env.TOWNREPORTER_LOCAL_DISCOVERY,
    };
    const requests: string[] = [];
    process.env.LLM_BASE_URL = globalBase;
    process.env.LLM_MODEL = "global-lmstudio-model";
    process.env.TOWNREPORTER_LOCAL_DISCOVERY = "0";
    resetLocalCatalogCacheForTests();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      const models = url.startsWith(`${scopedBase}/`)
        ? [{ id: selectedModel }]
        : [{ id: "global-lmstudio-model" }];
      return new Response(JSON.stringify({ data: models }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const readiness = await checkOpinionReadiness("local-model", {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      }, newsroomId);
      assert.equal(readiness.ready, true, readiness.why);
      assert.ok(
        requests.includes(`${scopedBase}/models`),
        `readiness must query the saved Opinion endpoint; observed ${requests.join(", ")}`,
      );
      assert.equal(
        requests.at(-1),
        `${scopedBase}/models`,
        "the final readiness probe must target the scoped Ollama model, not global LM Studio",
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
      await sql.query("delete from newsroom_local_model_choices where newsroom_id=$1 and scope='opinion'", [newsroomId]);
      await sql.query("delete from provider_settings where newsroom_id=$1 and provider_id='local-model'", [newsroomId]);
      await sql.query("delete from newsrooms where id=$1", [newsroomId]);
    }
  });
});
