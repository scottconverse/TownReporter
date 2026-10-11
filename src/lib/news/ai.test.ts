import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import type { LocalCatalog, LocalModelEntry, LocalModelKind, LocalServerKind } from "./local-models.ts";
import {
  plannerModel,
  GROK_UNAVAILABLE,
  grokChat,
  isGrokAvailable,
  parseJsonBlock,
  probeProvider,
  readableReplyOrRetry,
  unreadableReplyError,
  providerBudget,
  resolveAnthropic,
  resolveLlm,
  resolveProvider,
} from "./ai.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_EFFORT",
    "TOWNREPORTER_CLAUDE_CODE",
    "TOWNREPORTER_CODEX",
    "TOWNREPORTER_LOCAL",
    "CLAUDE_CLI_PATH",
    // The two Automatic rungs added in 0.6.63 (Unit Y item 1). A rung's
    // enabledness reads its own off switch and its own endpoint, so a test
    // that means to control the ladder has to own both -- and clearing them
    // is also what keeps an ambient shell value out of every other test here.
    "TOWNREPORTER_DEEPSEEK",
    "TOWNREPORTER_QWEN",
    "TOWNREPORTER_DEEPSEEK_BASE_URL",
    "TOWNREPORTER_QWEN_BASE_URL",
    "TOWNREPORTER_DEEPSEEK_MODEL",
    "TOWNREPORTER_QWEN_MODEL",
    // The ladder's last rung is Codex, so a test that reaches it must point at
    // the fake CLI (scripts/fakes/fake-codex-cli.mjs, which never calls a
    // model) rather than at whatever `codex` this machine has.
    "CODEX_CLI_PATH",
    "FAKE_CODEX_SIGNED_IN",
  ];
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

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>) {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_EFFORT",
    "TOWNREPORTER_CLAUDE_CODE",
    "TOWNREPORTER_CODEX",
    "TOWNREPORTER_LOCAL",
    "CLAUDE_CLI_PATH",
    // The two Automatic rungs added in 0.6.63 (Unit Y item 1). A rung's
    // enabledness reads its own off switch and its own endpoint, so a test
    // that means to control the ladder has to own both -- and clearing them
    // is also what keeps an ambient shell value out of every other test here.
    "TOWNREPORTER_DEEPSEEK",
    "TOWNREPORTER_QWEN",
    "TOWNREPORTER_DEEPSEEK_BASE_URL",
    "TOWNREPORTER_QWEN_BASE_URL",
    "TOWNREPORTER_DEEPSEEK_MODEL",
    "TOWNREPORTER_QWEN_MODEL",
    // The ladder's last rung is Codex, so a test that reaches it must point at
    // the fake CLI (scripts/fakes/fake-codex-cli.mjs, which never calls a
    // model) rather than at whatever `codex` this machine has.
    "CODEX_CLI_PATH",
    "FAKE_CODEX_SIGNED_IN",
  ];
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** No keys AND no local CLI — the genuinely unconfigured desk. */
const BARE = { TOWNREPORTER_CLAUDE_CODE: "0" };

/**
 * The Codex rung's own stand-in. `probeCodex` runs `codex login status` and
 * nothing else, so pointing this at the fake is the difference between "the
 * ladder reached Codex Terra" and "this test started a real agent CLI on the
 * machine". Absolute, because the probe spawns with `cwd: tmpdir()`.
 */
const FAKE_CODEX = fileURLToPath(
  new URL("../../../scripts/fakes/fake-codex-cli.mjs", import.meta.url),
);

const LM_STUDIO_V1 = "http://127.0.0.1:1234/v1";

/**
 * A local catalog exactly as `discoverLocalModels` would report one, for the
 * rung tests below.
 *
 * They inject `resolveLocalCatalog` rather than starting an HTTP server, so no
 * test here talks to a real LM Studio on 1234 -- which matters twice over: the
 * owner's loaded model must not be disturbed, and `enrichLmStudio`'s
 * `/api/v0/models` call is what carries load state, so a fixture is the only
 * way to say "loaded", "not loaded" and "this server cannot say" in one file.
 * The separate `probeProvider`-against-a-fake-server coverage lives in
 * scripts/ and the failover walks.
 */
function localCatalog(models: LocalModelEntry[], kind: LocalServerKind = "lmstudio"): LocalCatalog {
  return {
    servers: [{ kind, baseUrl: LM_STUDIO_V1, reachable: true, models }],
    defaultModel: null,
    checkedAt: Date.now(),
  };
}

/** One model as LM Studio's list reports it. */
function localEntry(
  id: string,
  loaded: boolean | null,
  kind: LocalModelKind = "chat",
): LocalModelEntry {
  return { id, label: id, loaded, kind, thinking: false, vision: false, cloud: false, contextLength: null };
}

describe("isGrokAvailable", () => {
  it("is false with no key and the local CLI ruled out", () => {
    withEnv(BARE, () => assert.equal(isGrokAvailable(), false));
  });

  /*
    GR-C removed xAI entirely: `XAI_API_KEY` is ignored, so it cannot make a
    provider appear. This used to assert the opposite.
  */
  it("ignores XAI_API_KEY, which no longer names a provider", () => {
    withEnv({ ...BARE, XAI_API_KEY: "test-key-not-used" }, () =>
      assert.equal(isGrokAvailable(), false),
    );
  });

  it("is true on a bare server, because Claude Code is the default", () => {
    withEnv({}, () => assert.equal(isGrokAvailable(), true));
  });
});

describe("resolveLlm", () => {
  /*
    The OpenAI-compatible leg is the operator's own gateway and nothing else.
    An `XAI_API_KEY` alone used to resolve `https://api.x.ai/v1` here; it now
    resolves nothing, and the caller falls to the Claude ladder.
  */
  it("resolves nothing when only XAI_API_KEY is set", () => {
    withEnv({ XAI_API_KEY: "xai-test" }, () => assert.equal(resolveLlm(), null));
  });

  it("resolves the gateway the operator named", () => {
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

describe("resolveAnthropic", () => {
  it("is null without a key", () => {
    withEnv({}, () => assert.equal(resolveAnthropic(), null));
  });

  it("defaults to Opus 5 at high effort", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
      const c = resolveAnthropic();
      assert.equal(c?.model, "claude-opus-5");
      assert.equal(c?.effort, "high");
      assert.equal(c?.label, "Claude");
    });
  });

  it("takes an effort override and ignores a bogus one", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_EFFORT: "low" }, () => {
      assert.equal(resolveAnthropic()?.effort, "low");
    });
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_EFFORT: "turbo" }, () => {
      assert.equal(resolveAnthropic()?.effort, "high");
    });
  });
});

describe("resolveProvider", () => {
  it("routes each named subscription choice to its own model", async () => {
    await withEnv({ ANTHROPIC_API_KEY: undefined, TOWNREPORTER_CLAUDE_CODE: undefined, TOWNREPORTER_CODEX: undefined }, () => {
      for (const [choice, model] of [
        ["codex-astra", "gpt-6-astra"],
        ["codex-frontier", "gpt-6.1-sol"],
        ["codex-balanced", "gpt-6.1-sol"],
        ["codex-luna", "gpt-6-luna"],
        ["claude-fable", "fable"],
        ["claude-frontier", "claude-opus-5"],
        ["claude-sonnet", "sonnet"],
        ["claude-haiku", "haiku"],
      ] as const) {
        const provider = resolveProvider(choice);
        assert.equal(provider?.model, model, choice);
      }
    });
  });
  it("honours deployment overrides for every picker-backed provider", () => {
    withEnv(
      {
        TOWNREPORTER_CODEX_TERRA_MODEL: "balanced-model",
        TOWNREPORTER_CODEX_SOL_MODEL: "frontier-model",
      },
      () => {
        const overrideKeys = ["TOWNREPORTER_CODEX_TERRA_MODEL", "TOWNREPORTER_CODEX_SOL_MODEL"];
        try {
          const choose = resolveProvider as unknown as (
            choice: string,
          ) => ReturnType<typeof resolveProvider>;
          assert.equal(choose("codex-balanced")?.model, "balanced-model");
          assert.equal(choose("codex-frontier")?.model, "frontier-model");
        } finally {
          for (const key of overrideKeys) delete process.env[key];
        }
      },
    );
  });

  it("resolves the editor's explicit free and frontier choices independently of env precedence", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
      const choose = resolveProvider as unknown as (
        choice: string,
      ) => ReturnType<typeof resolveProvider>;
      assert.equal(choose("codex-balanced")?.model, "gpt-6.1-sol");
      assert.equal(choose("codex-frontier")?.model, "gpt-6.1-sol");
      assert.equal(choose("claude-frontier")?.model, "claude-opus-5");
    });
  });

  it("gives Codex and CLI work enough wall clock", () => {
    const budget = providerBudget as unknown as (
      choice: string,
    ) => ReturnType<typeof providerBudget>;
    assert.ok(budget("codex-frontier").wallMs >= 420_000);
  });

  it("gives a local model enough wall clock to draft from a long meeting", () => {
    const budget = providerBudget as unknown as (
      choice: string,
    ) => ReturnType<typeof providerBudget>;
    const local = budget("local-model");
    // The real four-hour-meeting acceptance path took 1,209,024 ms across
    // transcript retrieval, planning, writing, editing, and name checking.
    // Keep a bounded cushion above that measured path while retaining the
    // separate per-answer ceiling.
    assert.ok(local.wallMs >= 2_400_000);
    assert.equal(local.callMs, 600_000);
  });

  it("keeps Automatic's configured gateway on the conservative pipeline budget", () => {
    withEnv(
      {
        LLM_BASE_URL: "http://127.0.0.1:1234/v1",
        LLM_MODEL: "local-capable-model",
      },
      () => {
        assert.deepEqual(providerBudget("configured"), {
          wallMs: 660_000,
          callMs: 180_000,
          reserveMs: 180_000,
        });
      },
    );
  });

  it("is null when nothing is configured and the CLI is ruled out", () => {
    withEnv(BARE, () => assert.equal(resolveProvider(), null));
  });

  it("defaults to the local Claude Code login — no API key needed", () => {
    withEnv({}, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "claude-code");
      assert.equal(p?.label, "Claude Code");
      assert.equal(p?.model, "claude-opus-5");
    });
  });

  it("prefers an API key over the CLI when one is set", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "anthropic");
      assert.equal(p?.label, "Claude");
    });
  });

  it("prefers Claude over a stray XAI_API_KEY, which names nothing now", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test", XAI_API_KEY: "xai-test" }, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "anthropic");
      assert.equal(p?.label, "Claude");
    });
  });

  it("puts the CLI ahead of a stray XAI_API_KEY too", () => {
    withEnv({ XAI_API_KEY: "xai-test" }, () => {
      assert.equal(resolveProvider()?.kind, "claude-code");
    });
  });

  it("lets an explicit gateway beat everything, so a local model can take over", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test", LLM_BASE_URL: "http://127.0.0.1:1234/v1" }, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "openai");
      assert.equal(p?.label, "LLM");
    });
  });

  /*
    The last rung of this ladder used to be an xAI gateway built from
    XAI_API_KEY. GR-C removed it: with the CLI switched off and nothing else
    configured there is no provider at all, rather than a silent fall back to
    api.x.ai. The behaviour change is the point -- the startup warning in
    scripts/with-app-env.mjs is what tells the operator why.
  */
  it("resolves nothing at all when the CLI is switched off and only XAI_API_KEY is set", () => {
    withEnv({ ...BARE, XAI_API_KEY: "xai-test" }, () => {
      assert.equal(resolveProvider(), null);
    });
  });

  it("honours ANTHROPIC_MODEL on the CLI path", () => {
    withEnv({ ANTHROPIC_MODEL: "claude-sonnet-5" }, () =>
      assert.equal(resolveProvider()?.model, "claude-sonnet-5"),
    );
  });

  it("resolves the explicit 'local-model' pick to the OpenAI-compatible transport, built from envOverrides", () => {
    /*
      0.6.10: kind "local" is a NAME an editor can pick, not a new transport,
      and the local-model registry entry's envOverrides name exactly
      LLM_BASE_URL / LLM_MODEL / LLM_API_KEY -- the same variables
      docs/local-models.md already tells an operator to set. When all three
      are set, this still resolves through the same shape "openai" does.
      0.6.13: `explicitProvider()`'s "local" branch now calls a dedicated
      `localGateway()` rather than sharing `customGateway()` with "openai" --
      see the "refuses ... no local base URL" test below for why (audit
      finding "a 'local' pick can hit the real paid OpenAI cloud").
    */
    withEnv(
      {
        ...BARE,
        LLM_BASE_URL: "http://127.0.0.1:1234/v1",
        LLM_MODEL: "qwen/qwen3.6-35b-a3b",
        LLM_API_KEY: "sk-local-test",
      },
      () => {
        const p = resolveProvider("local-model");
        assert.equal(p?.kind, "openai");
        if (p?.kind === "openai") {
          assert.equal(p.baseUrl, "http://127.0.0.1:1234/v1");
          assert.equal(p.model, "qwen/qwen3.6-35b-a3b");
          assert.equal(p.apiKey, "sk-local-test");
        }
      },
    );
  });

  it("is unavailable when no local base URL is configured, and honours its own off switch", () => {
    withEnv(BARE, () => assert.equal(resolveProvider("local-model"), null));
    withEnv({ ...BARE, LLM_BASE_URL: "http://127.0.0.1:1234/v1", TOWNREPORTER_LOCAL: "0" }, () =>
      assert.equal(resolveProvider("local-model"), null),
    );
  });

  /*
    Audit finding "a 'local' pick can hit the real paid OpenAI cloud":
    LLM_API_KEY + LLM_MODEL alone (no LLM_BASE_URL) used to be enough for
    `customGateway()` to build a config, and `explicitProvider`'s "local"
    branch called `customGateway()` directly -- so a "Local model" pick with
    only a key and a model name silently fell back to baseUrl
    "https://api.openai.com/v1" and sent the editor's content to OpenAI's
    paid cloud. A local pick must refuse instead: no local endpoint, no
    provider, never a silent cloud fallback.
  */
  it("refuses an explicit local-model pick that has a key and a model but no local base URL, rather than falling back to OpenAI's cloud", () => {
    withEnv({ ...BARE, LLM_API_KEY: "sk-looks-real", LLM_MODEL: "gpt-4o-mini" }, () => {
      const p = resolveProvider("local-model");
      assert.equal(
        p,
        null,
        "a local-model pick with no LLM_BASE_URL must be refused, not routed to a default gateway",
      );
    });
    withEnv(
      { ...BARE, OPENAI_API_KEY: "sk-looks-real-too", LLM_MODEL: "gpt-4o-mini" },
      () => {
        const p = resolveProvider("local-model");
        assert.equal(p, null);
      },
    );
  });
});

describe("grokChat", () => {
  it("returns the desk-facing unavailable error when the key is missing", async () => {
    const prev: Record<string, string | undefined> = {};
    for (const k of [
      "LLM_API_KEY",
      "LLM_BASE_URL",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "TOWNREPORTER_CLAUDE_CODE",
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    // Captured above so the restore below puts it back. Without this the test
    // spawns the real CLI and makes a live billed call.
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";
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

  it("uses only the explicitly selected Story picker adapter", async () => {
    const cases = [
      { choice: "codex-balanced", kind: "codex", label: "Codex Sol 6.1 (balanced)", vars: BARE },
      { choice: "codex-frontier", kind: "codex", label: "Codex Sol 6.1", vars: BARE },
      {
        choice: "claude-frontier",
        kind: "anthropic",
        label: "Claude Opus",
        vars: { ...BARE, ANTHROPIC_API_KEY: "sk-ant-test" },
      },
      { choice: "claude-frontier", kind: "claude-code", label: "Claude Opus", vars: {} },
      {
        choice: "local-model",
        kind: "openai",
        label: "LLM",
        vars: { ...BARE, LLM_BASE_URL: "http://127.0.0.1:1234/v1", LLM_MODEL: "local-test" },
      },
    ] as const;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("an explicit picker choice must not probe or call another provider");
    };
    try {
      for (const selected of cases) {
        await withEnvAsync(selected.vars, async () => {
          const calls: string[] = [];
          const sentinel = {
            ok: false as const,
            error: `sentinel:${selected.kind}:${selected.label}`,
          };
          const adapter = (kind: string) => async (provider: { kind: string; label: string }) => {
            calls.push(`${kind}:${provider.kind}:${provider.label}`);
            return kind === selected.kind
              ? sentinel
              : { ok: false as const, error: `wrong-adapter:${kind}` };
          };
          const result = await grokChat(
            "system",
            "user",
            8,
            { choice: selected.choice },
            {
              probe: async () => {
                calls.push("probe");
                return { ok: false as const, error: "unexpected-probe" };
              },
              openai: adapter("openai"),
              codex: adapter("codex"),
              anthropic: adapter("anthropic"),
              "claude-code": adapter("claude-code"),
            },
          );

          assert.equal(result, sentinel);
          assert.deepEqual(calls, [`${selected.kind}:${selected.kind}:${selected.label}`]);
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gives a custom connection enough time for research, writing and name checks", () => {
    const budget = providerBudget("custom:9ce9a944-f444-4a69-8927-7c7705c07a35");
    assert.deepEqual(budget, {
      wallMs: 420_000,
      callMs: 150_000,
      reserveMs: 170_000,
    });
  });

  it("routes an explicit custom connection through only its resolved OpenAI-compatible transport", async () => {
    const calls: string[] = [];
    const result = await grokChat(
      "system",
      "user",
      8,
      { choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35", newsroomId: 44 },
      {
        resolveCustom: async (newsroomId: number, id: string) => {
          calls.push(`resolve:${newsroomId}:${id}`);
          return { baseUrl: "https://custom.example/v1", modelId: "custom-model", apiKey: "test-secret" };
        },
        openai: async (provider: { baseUrl: string; model: string; label: string }) => {
          calls.push(`openai:${provider.baseUrl}:${provider.model}:${provider.label}`);
          return { ok: true as const, text: "custom answer" };
        },
        codex: async () => {
          calls.push("wrong:codex");
          return { ok: false as const, error: "wrong provider" };
        },
      } as any,
    );
    assert.deepEqual(result, { ok: true, text: "custom answer" });
    assert.deepEqual(calls, [
      "resolve:44:9ce9a944-f444-4a69-8927-7c7705c07a35",
      "openai:https://custom.example/v1:custom-model:Custom AI",
    ]);
  });

  it("fails an explicit unavailable custom connection without falling back to another provider", async () => {
    const calls: string[] = [];
    const result = await grokChat(
      "system",
      "user",
      8,
      { choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35", newsroomId: 44 },
      {
        resolveCustom: async () => {
          calls.push("resolve");
          throw new Error("The selected custom AI connection is disabled, deleted, or has no model. Choose another model; TownReporter will not fall back automatically.");
        },
        openai: async () => {
          calls.push("wrong:openai");
          return { ok: false as const, error: "wrong provider" };
        },
        codex: async () => {
          calls.push("wrong:codex");
          return { ok: false as const, error: "wrong provider" };
        },
      } as any,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /disabled, deleted, or has no model/i);
    assert.deepEqual(calls, ["resolve"]);
  });

  it("shows a custom provider's own error message while redacting its API key", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "bad credential test-only-key" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    try {
      const result = await grokChat(
        "system",
        "user",
        8,
        { choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35", newsroomId: 44 },
        {
          resolveCustom: async () => ({
            baseUrl: "https://custom.example/v1",
            modelId: "manual-model",
            apiKey: "test-only-key",
          }),
        },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error, "Custom provider Custom AI (manual-model) API error 400\n\nbad credential [redacted]");
        assert.equal(result.meta?.provider, "openai-compatible");
        assert.equal(result.meta?.model, "manual-model");
      }
      assert.doesNotMatch(JSON.stringify(result), /test-only-key/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("turns a loopback model context rejection into an actionable desk error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "exceed_context_size_error",
            message: "request (35018 tokens) exceeds the available context size (32768 tokens)",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    try {
      const result = await grokChat("system", "user", 8, {
        choice: "local-model",
        localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "qwen3.8-27b" },
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /context window/i);
        assert.doesNotMatch(result.error, /35018|32768/);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("model-picker provider readiness", () => {
  it("sends the exact DeepSeek Off default as Ollama's explicit none disable", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        model: "deepseek-v4.1-flash:cloud",
        choices: [{ message: { content: "ok" } }],
      }), { status: 200 });
    };
    try {
      await withEnvAsync(BARE, async () => {
        const localModel = {
          baseUrl: "http://127.0.0.1:11434/v1",
          id: "deepseek-v4.1-flash:cloud",
        };
        assert.equal((await grokChat("S", "U", 8, {
          choice: "local-model",
          localModel,
        })).ok, true);
        assert.equal((await grokChat("S", "U", 8, {
          choice: "local-model",
          localModel,
          reasoningEffort: "high",
        })).ok, true);
        assert.equal((await grokChat("S", "U", 8, {
          choice: "local-model",
          localModel,
          reasoningEffort: "max",
        })).ok, true);
      });
      assert.equal(bodies[0]!.reasoning_effort, "none", "Off must disable thinking explicitly");
      assert.equal(bodies[1]!.reasoning_effort, "high");
      assert.equal(bodies[2]!.reasoning_effort, "max");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("carries custom DeepSeek Off, High, and Max through the exact saved model", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        model: "deepseek-v4.1-flash:cloud",
        choices: [{ message: { content: "ok" } }],
      }), { status: 200 });
    };
    try {
      for (const effort of ["none", "high", "max"] as const) {
        const result = await grokChat("S", "U", 8, {
          choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35",
          newsroomId: 44,
          reasoningEffort: effort,
        }, {
          resolveCustom: async () => ({
            baseUrl: "http://127.0.0.1:11434/v1",
            modelId: "deepseek-v4.1-flash:cloud",
            apiKey: "test-key",
          }),
        });
        assert.equal(result.ok, true);
      }
      assert.deepEqual(
        bodies.map((body) => body.reasoning_effort),
        ["none", "high", "max"],
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("drafts JSON with the exact Gemini 3.5 Flash connection and provider-default effort", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "gemini-3.5-flash",
        choices: [{ message: { content: JSON.stringify({ headline: "City announces meeting", body: "The city announced a public meeting." }) } }],
      }), { status: 200 });
    };
    try {
      const result = await grokChat("S", "U", 8, {
        choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35",
        newsroomId: 44,
        reasoningEffort: "high",
      }, {
        resolveCustom: async () => ({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          modelId: "gemini-3.5-flash",
          apiKey: "test-key",
        }),
      });
      assert.equal(result.ok, true);
      assert.equal((body as Record<string, unknown> | null)?.model, "gemini-3.5-flash");
      if (result.ok) assert.equal(parseJsonBlock<{ body: string }>(result.text)?.body, "The city announced a public meeting.");
      assert.equal(body == null ? true : !("reasoning_effort" in body), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /*
    GR-C removed Grok (xAI) as a provider, so there is no longer a SuperGrok
    transport to preflight or to call. A job that STILL holds the retired id
    must keep working rather than erroring: `storyModelChoice` normalises it to
    Automatic, so a stored choice probes and runs on the ladder like any other
    unrecognised value. These two tests used to assert the OAuth transport; they
    now assert the fallback, which is the behaviour an existing install sees.
  */
  it("probes a stored grok-oauth choice as Automatic, not as a SuperGrok transport", async () => {
    await withEnvAsync(BARE, async () => {
      const result = await probeProvider("grok-oauth", 44);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error, GROK_UNAVAILABLE);
    });
  });

  it("sends no call at all for a stored grok-oauth choice, and names no removed provider", async () => {
    await withEnvAsync(BARE, async () => {
      const result = await grokChat("system prompt", "user prompt", 32, {
        choice: "grok-oauth",
        newsroomId: 44,
        timeoutMs: 12_345,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error, GROK_UNAVAILABLE);
    });
  });

  it("preflights the discovered newsroom local model without requiring environment variables", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "halo-brain-35b" }] }), { status: 200 });
    };
    try {
      await withEnvAsync(BARE, async () => {
        const result = await probeProvider("local-model", 44, {
          resolveLocal: async () => ({
            baseUrl: "http://127.0.0.1:1234/v1",
            id: "halo-brain-35b",
          }),
        });
        assert.deepEqual(result, {
          ok: true,
          label: "LLM",
          choice: "local-model",
          localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "halo-brain-35b" },
        });
      });
      assert.deepEqual(calls, ["http://127.0.0.1:1234/v1/models"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts a saved custom manual model when its endpoint does not implement /models", async () => {
    const originalFetch = globalThis.fetch;
    const calls: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(null, { status: 404 });
    };
    try {
      const result = await probeProvider(
        "custom:9ce9a944-f444-4a69-8927-7c7705c07a35",
        44,
        {
          resolveCustom: async () => ({
            baseUrl: "https://custom.example/v1",
            modelId: "manual-model",
            apiKey: "test-only-key",
          }),
        },
      );
      assert.deepEqual(result, { ok: true, label: "Custom AI", choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35" });
      assert.deepEqual(calls, [
        { url: "https://custom.example/v1/models", authorization: "Bearer test-only-key" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("still reports rejected custom credentials rather than accepting an unavailable manual model", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 401 });
    try {
      const result = await probeProvider(
        "custom:9ce9a944-f444-4a69-8927-7c7705c07a35",
        44,
        {
          resolveCustom: async () => ({
            baseUrl: "https://custom.example/v1",
            modelId: "manual-model",
            apiKey: "test-only-key",
          }),
        },
      );
      assert.deepEqual(result, {
        ok: false,
        error: "Custom AI rejected its credentials. Sign in or update its key.",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates an Anthropic key before a Claude job can be enqueued", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
        status: 401,
      });
    };
    try {
      await withEnvAsync({ ...BARE, ANTHROPIC_API_KEY: "invalid-test-key" }, async () => {
        const result = await probeProvider("claude-frontier");
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error, /Claude.*credential|ANTHROPIC_API_KEY/i);
      });
      assert.deepEqual(urls, ["https://api.anthropic.com/v1/models?limit=1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the editor's named Claude model after API-key preflight", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    try {
      await withEnvAsync({ ...BARE, ANTHROPIC_API_KEY: "test-key" }, async () => {
        for (const choice of ["claude-fable", "claude-sonnet", "claude-haiku"] as const) {
          const result = await probeProvider(choice);
          assert.equal(result.ok, true);
          if (result.ok) assert.equal(result.choice, choice);
        }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proves the selected configured gateway model is actually loaded", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "desk-model" }] }), { status: 200 });
    try {
      await withEnvAsync(
        { ...BARE, LLM_BASE_URL: "http://gateway.test/v1", LLM_MODEL: "desk-model" },
        async () => {
          const result = await probeProvider("configured");
          assert.equal(result.ok, true);
          if (result.ok) assert.equal(result.choice, "configured");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a running configured gateway when the named model is not loaded", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "some-other-model" }] }), { status: 200 });
    try {
      await withEnvAsync(
        { ...BARE, LLM_BASE_URL: "http://gateway.test/v1", LLM_MODEL: "desk-model" },
        async () => {
          const result = await probeProvider("configured");
          assert.equal(result.ok, false);
          if (!result.ok) assert.match(result.error, /not loaded/i);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when a successful model-list response cannot prove the selected model exists", async () => {
    const originalFetch = globalThis.fetch;
    const malformedBodies = ["<html>not a model catalog</html>", JSON.stringify({ models: [{ name: "desk-model" }] }), JSON.stringify({ data: "desk-model" })];
    try {
      for (const body of malformedBodies) {
        globalThis.fetch = async () => new Response(body, { status: 200 });
        await withEnvAsync(
          { ...BARE, LLM_BASE_URL: "http://gateway.test/v1", LLM_MODEL: "desk-model" },
          async () => {
            const result = await probeProvider("configured");
            assert.equal(result.ok, false);
            if (!result.ok) assert.match(result.error, /invalid model list.*could not verify/i);
          },
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("matches a bare Gemini model against Google's prefixed catalog only", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "models/gemini-3.8-flash" }] }), { status: 200 });
    try {
      await withEnvAsync(
        {
          ...BARE,
          LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
          LLM_MODEL: "gemini-3.8-flash",
        },
        async () => {
          const gemini = await probeProvider("configured");
          assert.deepEqual(gemini, {
            ok: true,
            label: "LLM",
            choice: "configured",
          });
        },
      );
      await withEnvAsync(
        { ...BARE, LLM_BASE_URL: "https://other.example/v1", LLM_MODEL: "gemini-3.8-flash" },
        async () => {
          const other = await probeProvider("configured");
          assert.equal(other.ok, false);
          if (!other.ok) assert.match(other.error, /not loaded/i);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preflights the explicit local-model pick against its own /models, and drafts through /chat/completions", async () => {
    // 0.6.10: the local entry is a NAME an editor picks, resolved to the same
    // OpenAI-compatible transport the configured gateway already uses -- so
    // preflight and a real draft round-trip work with no ai.ts change.
    const originalFetch = globalThis.fetch;
    const calls: { url: string; body?: unknown }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "local-test-model" }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          model: "local-test-model",
          usage: { prompt_tokens: 41, completion_tokens: 9, total_tokens: 50 },
          choices: [{ message: { content: "drafted locally" } }],
        }),
        { status: 200 },
      );
    };
    try {
      await withEnvAsync(
        {
          ...BARE,
          LLM_BASE_URL: "http://127.0.0.1:1234/v1",
          LLM_MODEL: "local-test-model",
        },
        async () => {
          const preflight = await probeProvider("local-model");
          assert.equal(preflight.ok, true);
          if (preflight.ok) assert.equal(preflight.choice, "local-model");

          const draft = await grokChat("system prompt", "user prompt", 32, {
            choice: "local-model",
          });
          assert.equal(draft.ok, true);
          if (draft.ok) {
            assert.equal(draft.text, "drafted locally");
            assert.equal(draft.meta?.provider, "openai-compatible");
            assert.equal(draft.meta?.model, "local-test-model");
            assert.equal(draft.meta?.inputTokens, 41);
            assert.equal(draft.meta?.outputTokens, 9);
            assert.equal(draft.meta?.totalTokens, 50);
          }
        },
      );
      assert.equal(calls[0]!.url, "http://127.0.0.1:1234/v1/models");
      assert.equal(calls[1]!.url, "http://127.0.0.1:1234/v1/chat/completions");
      assert.equal((calls[1]!.body as { model?: string })?.model, "local-test-model");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats an explicit configured gateway as Automatic's forced provider", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "desk-model" }] }), { status: 200 });
    };
    try {
      await withEnvAsync(
        { ...BARE, LLM_BASE_URL: "http://gateway.test/v1", LLM_MODEL: "desk-model" },
        async () => {
          const result = await probeProvider("auto");
          assert.equal(result.ok, true);
          if (result.ok) assert.equal(result.choice, "configured");
        },
      );
      assert.deepEqual(urls, ["http://gateway.test/v1/models"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("TOWNREPORTER_CODEX=0 takes both Codex choices out of the chain", () => {
    withEnv({ ...BARE, TOWNREPORTER_CODEX: "0" }, () => {
      assert.equal(resolveProvider("codex-balanced"), null);
      assert.equal(resolveProvider("codex-frontier"), null);
    });
    withEnv(BARE, () => {
      assert.equal(resolveProvider("codex-balanced")?.kind, "codex");
    });
  });

  /*
    Unit Y item 2: a rung that must already be loaded is passed over BEFORE it
    is probed, and the job's receipt records why.

    Before this, the ladder asked the Qwen endpoint "did you answer?" -- and
    LM Studio answers that with every model it has on DISK, loaded or not. The
    probe would therefore pin a draft to a 35B that then has to be paged into
    memory while the editor watches a job that looks stuck. The desk never
    loads a model (owner rule: "if it is loaded"), so the rung is skipped and
    the ladder moves to Codex Terra.

    0.6.69 (Unit AL item 4): the rung names no model either -- it runs whatever
    LM Studio reports loaded. The three tests here are the three refusals in
    the new words (nothing loaded, load state unknown, server did not answer),
    which are `resolveRungLocalModel`'s own sentences; the three after them
    cover the pick itself, the pin, and a pin that is not the loaded one.
  */
  it("skips a rung when nothing is loaded in LM Studio and runs the next one instead", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async () => {
      fetched += 1;
      throw new TypeError("connection refused");
    };
    try {
      await withEnvAsync(
        {
          ...BARE,
          // Rung 1 out of the way by its own off switch, so rung 2 is the one
          // under test; rung 3 is Codex, reached through the fake CLI.
          TOWNREPORTER_DEEPSEEK: "0",
          TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
          CODEX_CLI_PATH: FAKE_CODEX,
          FAKE_CODEX_SIGNED_IN: "1",
        },
        async () => {
          const result = await probeProvider("auto", undefined, {
            resolveLocalCatalog: async () =>
              localCatalog([localEntry("halo/qwen3.6-35b-a3b", false)]),
          });
          assert.equal(result.ok, true);
          if (result.ok) {
            assert.equal(result.choice, "codex-balanced");
            assert.equal(result.label, "Codex Sol 6.1 (balanced)");
            // The brief's own words, verbatim.
            assert.deepEqual(result.skippedRungs, [
              "Local model skipped: nothing loaded in LM Studio",
            ]);
          }
        },
      );
      // The skipped rung was never asked anything: not its catalog, and not
      // its endpoint. A probe of the Qwen rung is what used to pin the draft.
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runs the lowest-id loaded model, never an embedding, and names it on the probe", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          data: [
            { id: "halo/qwen3.6-35b-a3b" },
            { id: "google/gemma-4-12b-qat" },
            { id: "all-minilm-l6-v2" },
          ],
        }),
        { status: 200 },
      );
    };
    try {
      await withEnvAsync(
        { ...BARE, TOWNREPORTER_DEEPSEEK: "0", TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1 },
        async () => {
          const result = await probeProvider("qwen-local", undefined, {
            resolveLocalCatalog: async () =>
              localCatalog([
                // Listed first, and loaded -- but not the lowest id, so a pick
                // that took LM Studio's own list order would take this one.
                localEntry("halo/qwen3.6-35b-a3b", true),
                localEntry("google/gemma-4-12b-qat", true),
                // Loaded, lowest id of the three, and cannot write a sentence:
                // only its kind keeps it out of the running.
                localEntry("all-minilm-l6-v2", true, "embedding"),
                // On disk and not in memory, so it is not a candidate at all.
                localEntry("halo/qwen3.6-35b-a3b-gguf", false),
              ]),
          });
          assert.deepEqual(result, {
            ok: true,
            label: "Local model (google/gemma-4-12b-qat)",
            choice: "qwen-local",
            localModel: { baseUrl: LM_STUDIO_V1, id: "google/gemma-4-12b-qat" },
          });
          // The one model the probe asked the endpoint to confirm is the one
          // the catalog said was loaded -- and the pair a caller pins is it.
          assert.deepEqual(urls, [`${LM_STUDIO_V1}/models`]);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads the load state off LM Studio's own model list, with no catalog handed in", async () => {
    /*
      The two tests above inject the catalog; this one proves the wire the real
      machine uses, against a stubbed LM Studio the way the preflight test
      around line 810 does. `/v1/models` is what the picker's default model
      comes from and lists everything on DISK; `/api/v0/models` is the endpoint
      the code already reads for `state` and `type` (local-models.ts's
      `enrichLmStudio`), and it is the only one that can say what is loaded.
    */
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === `${LM_STUDIO_V1}/models`) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "aaa-embedding-model" },
              { id: "halo/qwen3.6-35b-a3b" },
              { id: "google/gemma-4-12b-qat" },
            ],
          }),
          // Discovery refuses a 200 that is not JSON (port 8080 on this machine
          // serves an HTML app), so a stub has to say what it is.
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://127.0.0.1:1234/api/v0/models") {
        return new Response(
          JSON.stringify({
            data: [
              // Lowest id of all, loaded, and an embedding: never a candidate.
              { id: "aaa-embedding-model", state: "loaded", type: "embeddings" },
              // On disk, not in memory: the rung must not ask for it.
              { id: "halo/qwen3.6-35b-a3b", state: "not-loaded", type: "llm" },
              { id: "google/gemma-4-12b-qat", state: "loaded", type: "llm" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new TypeError(`connection refused: ${url}`);
    };
    try {
      await withEnvAsync(
        {
          ...BARE,
          TOWNREPORTER_DEEPSEEK: "0",
          // The rung's own endpoint. On the live machine the rung is also
          // enabled by discovery's reachable flag; a test process has no
          // background refresh, so the endpoint is named here.
          TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
        },
        async () => {
          resetLocalCatalogCacheForTests();
          const result = await probeProvider("qwen-local", undefined, {});
          assert.deepEqual(result, {
            ok: true,
            label: "Local model (google/gemma-4-12b-qat)",
            choice: "qwen-local",
            localModel: { baseUrl: LM_STUDIO_V1, id: "google/gemma-4-12b-qat" },
          });
        },
      );
      // Discovery read both lists; the confirmation probe asked /v1/models for
      // the one model it had just been told was loaded.
      assert.deepEqual(urls.filter((u) => u === `${LM_STUDIO_V1}/models`).length, 2);
      assert.ok(urls.includes("http://127.0.0.1:1234/api/v0/models"));
    } finally {
      resetLocalCatalogCacheForTests();
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps sending the pinned TOWNREPORTER_QWEN_MODEL when the operator set one", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "halo/qwen3.6-35b-a3b" }, { id: "google/gemma-4-12b-qat" }],
        }),
        { status: 200 },
      );
    try {
      await withEnvAsync(
        {
          ...BARE,
          TOWNREPORTER_DEEPSEEK: "0",
          TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
          // Set on purpose: a pin is not a suggestion. Both models are loaded,
          // and the pin is deliberately NOT the lowest id -- so a rung that
          // picked instead of pinning would ask for google/gemma-4-12b-qat.
          TOWNREPORTER_QWEN_MODEL: "halo/qwen3.6-35b-a3b",
        },
        async () => {
          const result = await probeProvider("qwen-local", undefined, {
            resolveLocalCatalog: async () =>
              localCatalog([
                localEntry("halo/qwen3.6-35b-a3b", true),
                localEntry("google/gemma-4-12b-qat", true),
              ]),
          });
          assert.deepEqual(result, {
            ok: true,
            label: "Local model (halo/qwen3.6-35b-a3b)",
            choice: "qwen-local",
            localModel: { baseUrl: LM_STUDIO_V1, id: "halo/qwen3.6-35b-a3b" },
          });
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips the rung when the pinned model is not the one that is loaded", async () => {
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK: "0",
        TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
        TOWNREPORTER_QWEN_MODEL: "halo/qwen3.6-35b-a3b",
        TOWNREPORTER_CODEX: "0",
      },
      async () => {
        const result = await probeProvider("auto", undefined, {
          // Something is loaded -- just not the pinned model. A pin that
          // quietly ran the other one would be worse than a skip, because the
          // receipt would name a model the operator never asked for.
          resolveLocalCatalog: async () =>
            localCatalog([
              localEntry("halo/qwen3.6-35b-a3b", false),
              localEntry("google/gemma-4-12b-qat", true),
            ]),
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.deepEqual(result.skippedRungs, ["Local model skipped: not loaded"]);
        }
      },
    );
  });

  it("keeps saying which rungs Automatic passed over when the ladder runs out", async () => {
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK: "0",
        TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
        TOWNREPORTER_CODEX: "0",
      },
      async () => {
        const result = await probeProvider("auto", undefined, {
          // A server that cannot say whether anything is loaded cannot answer
          // the question, and the rule is "only when one IS loaded" -- so
          // unknown skips too rather than guessing at a model to page in.
          resolveLocalCatalog: async () => localCatalog([localEntry("halo/qwen3.6-35b-a3b", null)]),
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.match(result.error, /No model in the Automatic ladder is ready/);
          assert.match(result.error, /Local model skipped: load state unknown/);
          assert.deepEqual(result.skippedRungs, ["Local model skipped: load state unknown"]);
        }
      },
    );
  });

  it("skips a rung whose own server is not answering at all", async () => {
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK: "0",
        TOWNREPORTER_QWEN_BASE_URL: LM_STUDIO_V1,
        TOWNREPORTER_CODEX: "0",
      },
      async () => {
        const result = await probeProvider("auto", undefined, {
          // The catalog was read, and it holds no server at that address.
          resolveLocalCatalog: async () => ({
            servers: [],
            defaultModel: null,
            checkedAt: Date.now(),
          }),
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.deepEqual(result.skippedRungs, [
            "Local model skipped: its server did not answer",
          ]);
        }
      },
    );
  });

  it("Automatic reports failure once the operator's own providers are all out", async () => {
    // Claude off (BARE) and Codex off, and neither local rung has an endpoint
    // named for it (Unit Y's rungs are enabled by their own base URL or by a
    // discovery probe, and a test process has neither): nothing is left.
    await withEnvAsync({ ...BARE, TOWNREPORTER_CODEX: "0" }, async () => {
      const result = await probeProvider("auto");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /No model in the Automatic ladder is ready/);
    });
  });

  it("distinguishes an unreachable provider from a timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("connection refused");
    };
    try {
      await withEnvAsync({ LLM_BASE_URL: "http://gateway.test/v1", LLM_MODEL: "desk-model" }, async () => {
        const result = await probeProvider("configured");
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.match(result.error, /unreachable/i);
          assert.doesNotMatch(result.error, /timed out/i);
        }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseJsonBlock", () => {
  it("parses a fenced object", () => {
    const raw = '```json\n{"headline":"Hi"}\n```';
    assert.deepEqual(parseJsonBlock<{ headline: string }>(raw), { headline: "Hi" });
  });

  /**
   * The bake-off (2026-09-24) recorded DeepSeek emitting JSON with one missing
   * comma. Unit Y item 3 asks for that reply to be usable, and the repair has
   * to be string-aware: a draft body is a JSON string that may itself contain
   * braces, digits and prose, and a repair that inserts commas there would
   * rewrite the sentence on its way to publication.
   */
  it("repairs a missing comma between two values", () => {
    assert.deepEqual(parseJsonBlock<{ headline: string; dek: string }>('{"headline":"Hi" "dek":"There"}'), {
      headline: "Hi",
      dek: "There",
    });
    assert.deepEqual(parseJsonBlock<number[]>("[1 2 3]"), [1, 2, 3]);
    assert.deepEqual(
      parseJsonBlock<{ claims: unknown[]; form: string }>('{"claims":[] "form":"news"}'),
      { claims: [], form: "news" },
    );
  });

  it("never inserts a comma inside a string, and leaves valid JSON alone", () => {
    const body = '{"body":"The council met 4 2 and left {a b} 1 2"}';
    assert.deepEqual(parseJsonBlock<{ body: string }>(body), {
      body: "The council met 4 2 and left {a b} 1 2",
    });
    // A missing comma INSIDE the prose is still only repaired if a strict
    // parse failed -- and here it must be, because the value is a string.
    const broken = '{"headline":"Hi" "body":"He said \\"no\\" 1 2 {x}"}';
    assert.deepEqual(parseJsonBlock<{ headline: string; body: string }>(broken), {
      headline: "Hi",
      body: 'He said "no" 1 2 {x}',
    });
  });

  it("still returns null for a reply that is not JSON at all", () => {
    assert.equal(parseJsonBlock("I could not write that draft."), null);
    assert.equal(parseJsonBlock('{"headline": '), null);
  });
});

/**
 * Unit Y item 3's first half: a malformed reply retries ONCE on the same
 * provider, and the failure it finally reports is the wording the failover
 * classifier reads ("unreadable" -- see automatic-failover.ts).
 */
describe("readableReplyOrRetry", () => {
  const readObject = (text: string) => parseJsonBlock<{ headline: string }>(text);

  it("uses the first reply when it is readable, without a second call", async () => {
    let calls = 0;
    const reply = await readableReplyOrRetry({
      attempt: async () => {
        calls += 1;
        return { ok: true as const, text: '{"headline":"Hi"}' };
      },
      read: readObject,
      label: "DeepSeek v4.1 Flash",
    });
    assert.equal(calls, 1);
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.ok && reply.value, { headline: "Hi" });
    assert.equal(reply.retried, false);
  });

  it("retries the same provider once when the first reply cannot be read", async () => {
    let calls = 0;
    const instructions: (string | undefined)[] = [];
    let notified = false;
    const reply = await readableReplyOrRetry({
      attempt: async (instruction) => {
        instructions.push(instruction);
        if (instruction) assert.equal(notified, true, "notify progress before making the retry call");
        calls += 1;
        return calls === 1
          ? { ok: true as const, text: '{"headline":"Hi" "dek"' }
          : { ok: true as const, text: '{"headline":"Hi","dek":"There"}' };
      },
      read: readObject,
      label: "DeepSeek v4.1 Flash",
      onRetry: () => { notified = true; },
    });
    assert.equal(calls, 2);
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.ok && reply.value, { headline: "Hi", dek: "There" });
    assert.equal(reply.retried, true);
    assert.equal(instructions[0], undefined);
    assert.match(instructions[1]!, /Reply with JSON only/);
  });

  it("reports unreadable after two replies the reader cannot use, in the classifier's words", async () => {
    let calls = 0;
    const reply = await readableReplyOrRetry({
      attempt: async () => {
        calls += 1;
        return { ok: true as const, text: "I could not write that draft." };
      },
      read: readObject,
      label: "DeepSeek v4.1 Flash",
    });
    assert.equal(calls, 2);
    assert.equal(reply.ok, false);
    assert.equal(reply.retried, true);
    assert.equal(
      reply.ok === false && reply.error,
      "DeepSeek v4.1 Flash sent a reply the desk could not read (unreadable JSON).",
    );
    assert.equal(unreadableReplyError("DeepSeek v4.1 Flash"), reply.ok === false && reply.error);
  });

  it("passes a transport failure straight through without retrying it", async () => {
    let calls = 0;
    const reply = await readableReplyOrRetry({
      attempt: async () => {
        calls += 1;
        return { ok: false as const, error: "DeepSeek v4.1 Flash request timed out" };
      },
      read: readObject,
      label: "DeepSeek v4.1 Flash",
    });
    assert.equal(calls, 1);
    assert.equal(reply.ok, false);
    assert.equal(reply.retried, false);
    assert.equal(reply.ok === false && reply.error, "DeepSeek v4.1 Flash request timed out");
  });

  it("keeps the second attempt's own transport error rather than inventing one", async () => {
    let calls = 0;
    const reply = await readableReplyOrRetry({
      attempt: async () => {
        calls += 1;
        return calls === 1
          ? { ok: true as const, text: "not json" }
          : { ok: false as const, error: "DeepSeek v4.1 Flash was unavailable" };
      },
      read: readObject,
      label: "DeepSeek v4.1 Flash",
    });
    assert.equal(calls, 2);
    assert.equal(reply.ok === false && reply.error, "DeepSeek v4.1 Flash was unavailable");
  });
});

/**
 * A Claude model id must not be handed to a provider that has never heard of it.
 *
 * `plannerModel()` returned "claude-haiku-4-5-20251001" unconditionally. That
 * is right on the Claude paths, where the Haiku/Opus split saves about
 * three-quarters of the planning cost. It is wrong everywhere else: point
 * LLM_BASE_URL at LM Studio, Ollama or any gateway and every Dark Desk hop
 * asks for a model that endpoint does not serve. The call fails, and the
 * planner falls back to keyword matching without a word — the exact silent
 * failure that once left the whole database with zero entities, claims and
 * hypotheses.
 *
 * An outside audit filed this as part of TW-001: the docs promise the selected
 * provider controls everything, and Dark planning substituted a Claude
 * identifier regardless.
 */
describe("the planner model respects the provider", () => {
  const KEYS = [
    "TOWNREPORTER_PLANNER_MODEL",
    "TOWNREPORTER_CLAUDE_CODE",
    "ANTHROPIC_API_KEY",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
  ];
  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const prev: Record<string, string | undefined> = {};
    for (const k of KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
      fn();
    } finally {
      for (const k of KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  it("splits to Haiku on an Anthropic key", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
      assert.match(plannerModel(), /haiku/i);
    });
  });

  it("names no model at all on an OpenAI-compatible endpoint", () => {
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:1234/v1", LLM_MODEL: "local-thing" }, () => {
      assert.equal(
        plannerModel(),
        "",
        "an empty string means grokChat keeps the provider's own model",
      );
    });
  });

  /*
    Precedence is LLM_BASE_URL > ANTHROPIC_API_KEY > Claude Code CLI. There is
    no fourth rung any more: GR-C removed the xAI gateway, so a machine with
    the CLI switched off and a stray XAI_API_KEY has NO provider, and naming no
    planner model is the only honest answer.
  */
  it("names no model when there is no provider left at all", () => {
    withEnv({ XAI_API_KEY: "xai-test", TOWNREPORTER_CLAUDE_CODE: "0" }, () => {
      assert.equal(plannerModel(), "");
    });
  });

  /** An explicit override is the operator's business, whatever the provider. */
  it("always honours an explicit override", () => {
    withEnv(
      { LLM_BASE_URL: "http://127.0.0.1:1234/v1", TOWNREPORTER_PLANNER_MODEL: "qwen3.6-35b" },
      () => {
        assert.equal(plannerModel(), "qwen3.6-35b");
      },
    );
  });
});

/*
  UNIT U29 -- THE OPINION WRITING CALL ON THE DEEPSEEK RUNG.

  Opinion's Automatic starts on DeepSeek v4.1 Flash, and this is the wire the
  writing pass sends when it does. Three properties, all of them the reason
  this path is a ONE-PASS pair rather than a pair:

   - the voice travels as the request's `system` message and nowhere else;
   - there is no tool surface at all (no `tools`, no allow-list), because an
     OpenAI-compatible endpoint has none to offer -- which is what makes SEC-3
     hold by construction on this path;
   - the call goes to the RUNG's own endpoint, never to whatever LLM_BASE_URL
     the operator pointed the desk's local pick at.
*/
describe("the DeepSeek rung's writing call", () => {
  const VOICE = "the operator's editorial voice, in prose.";
  const RUNG_BASE = "http://127.0.0.1:11434/v1";

  it("sends the voice as the system message, with no tool surface, to the rung's own endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          model: "deepseek-v4.1-flash:cloud",
          choices: [{ message: { content: "an editorial" } }],
        }),
        { status: 200 },
      );
    };
    try {
      await withEnvAsync(
        {
          TOWNREPORTER_DEEPSEEK_BASE_URL: RUNG_BASE,
          // A DIFFERENT endpoint for the desk's own local pick, so a call that
          // read this one would be visible rather than silent.
          LLM_BASE_URL: "http://127.0.0.1:9999/v1",
          LLM_MODEL: "some-other-model",
          TOWNREPORTER_CLAUDE_CODE: "0",
          TOWNREPORTER_CODEX: "0",
        },
        async () => {
          const result = await grokChat(VOICE, "the writing pack", 4_000, {
            choice: "deepseek-flash",
          });
          assert.equal(result.ok, true, result.ok ? "" : result.error);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(requests.length, 1, "one writing call, not a pair");
    const [request] = requests;
    assert.equal(
      request!.url,
      `${RUNG_BASE}/chat/completions`,
      "the rung carries its own endpoint; it must never read LLM_BASE_URL",
    );
    assert.equal(request!.body.model, "deepseek-v4.1-flash:cloud");
    assert.deepEqual(
      request!.body.messages,
      [
        { role: "system", content: VOICE },
        { role: "user", content: "the writing pack" },
      ],
      "the voice is the system message, and there is nothing before it",
    );
    assert.equal(
      "tools" in request!.body,
      false,
      "an OpenAI-compatible endpoint has no tool surface: nothing may be offered one",
    );
    assert.equal(
      request!.body.reasoning_effort,
      "none",
      "the rung's Off default is sent explicitly, or Ollama re-enables thinking",
    );
  });
});


describe("custom provider failure detail", () => {
  for (const mode of ["timeout", "quota", "body-error"] as const) it(`names Gemini and preserves ${mode}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      if (mode === "timeout") throw new DOMException("Timed out", "TimeoutError");
      return new Response(JSON.stringify({error:{message:"Google provider says quota exhausted"}}), {status: mode === "quota" ? 429 : 200});
    };
    try {
      const result = await grokChat("system", "user", 8, { choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35", newsroomId: 1, timeoutMs: 500 }, {
        resolveCustom: async () => ({name:"Gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",modelId:"gemini-3.5-flash",apiKey:"test-key"}),
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /Gemini/);
      assert.match(result.error, mode === "timeout" ? /timed out after 0.5 seconds/ : /Google provider says quota exhausted/);
    } finally { globalThis.fetch = original; }
  });
});


for (const retry of [false, true]) it(`preserves custom provider detail when ${retry ? "the retry" : "the response body"} times out`, async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (retry && calls === 1) return new Response(JSON.stringify({error:{message:"Google says quota exhausted"}}),{status:429});
    if (retry) throw new DOMException("Operation timed out", "TimeoutError");
    const response = new Response("body");
    response.text = async () => { throw new DOMException("The operation was aborted", "AbortError"); };
    return response;
  };
  try {
    const result=await grokChat("S","U",8,{choice:"custom:9ce9a944-f444-4a69-8927-7c7705c07a35",newsroomId:1,timeoutMs:30000},{resolveCustom:async()=>({name:"Gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",modelId:"gemini-3.5-flash",apiKey:"test-key"})});
    assert.equal(result.ok,false);
    if(result.ok)return;
    assert.match(result.error,/Gemini.*timed out after 30 seconds/);
    if(retry)assert.match(result.error,/Google says quota exhausted/);
    assert.equal(result.meta?.timedOut,true);
  }finally{globalThis.fetch=original;}
});
