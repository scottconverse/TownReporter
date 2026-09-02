import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  plannerModel,
  GROK_UNAVAILABLE,
  grokChat,
  isGrokAvailable,
  parseJsonBlock,
  probeProvider,
  providerBudget,
  resolveAnthropic,
  resolveLlm,
  resolveProvider,
} from "./ai.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "XAI_API_KEY",
    "GROK_API_KEY",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "XAI_MODEL",
    "XAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_EFFORT",
    "TOWNREPORTER_CLAUDE_CODE",
    "CLAUDE_CLI_PATH",
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
    "XAI_API_KEY",
    "GROK_API_KEY",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "XAI_MODEL",
    "XAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_EFFORT",
    "TOWNREPORTER_CLAUDE_CODE",
    "CLAUDE_CLI_PATH",
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

describe("isGrokAvailable", () => {
  it("is false with no key and the local CLI ruled out", () => {
    withEnv(BARE, () => assert.equal(isGrokAvailable(), false));
  });

  it("is true when XAI_API_KEY is set", () => {
    withEnv({ ...BARE, XAI_API_KEY: "test-key-not-used" }, () =>
      assert.equal(isGrokAvailable(), true),
    );
  });

  it("is true on a bare server, because Claude Code is the default", () => {
    withEnv({}, () => assert.equal(isGrokAvailable(), true));
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
  it("honours deployment overrides for every picker-backed provider", () => {
    withEnv(
      {
        TOWNREPORTER_LOCAL_BASE_URL: "http://local.test/v1",
        TOWNREPORTER_LOCAL_MODEL: "local-model",
        TOWNREPORTER_ZEN_BASE_URL: "https://zen.test/v1",
        TOWNREPORTER_ZEN_MODEL: "zen-model",
        TOWNREPORTER_CODEX_TERRA_MODEL: "balanced-model",
        TOWNREPORTER_CODEX_SOL_MODEL: "frontier-model",
      },
      () => {
        const overrideKeys = [
          "TOWNREPORTER_LOCAL_BASE_URL",
          "TOWNREPORTER_LOCAL_MODEL",
          "TOWNREPORTER_ZEN_BASE_URL",
          "TOWNREPORTER_ZEN_MODEL",
          "TOWNREPORTER_CODEX_TERRA_MODEL",
          "TOWNREPORTER_CODEX_SOL_MODEL",
        ];
        try {
          const choose = resolveProvider as unknown as (
            choice: string,
          ) => ReturnType<typeof resolveProvider>;
          assert.equal(choose("local")?.baseUrl, "http://local.test/v1");
          assert.equal(choose("local")?.model, "local-model");
          assert.equal(choose("zen")?.baseUrl, "https://zen.test/v1");
          assert.equal(choose("zen")?.model, "zen-model");
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
      assert.deepEqual(choose("local"), {
        kind: "openai",
        apiKey: "not-needed",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "qwen/qwen3.6-35b-a3b",
        label: "Local Qwen",
      });
      assert.equal(choose("zen")?.model, "mimo-v2.5-free");
      assert.equal(choose("codex-balanced")?.model, "gpt-5.6-terra");
      assert.equal(choose("codex-frontier")?.model, "gpt-5.6-sol");
      assert.equal(choose("claude-frontier")?.model, "claude-opus-5");
    });
  });

  it("gives local, free-cloud, and CLI work enough wall clock", () => {
    const budget = providerBudget as unknown as (
      choice: string,
    ) => ReturnType<typeof providerBudget>;
    assert.ok(budget("local").callMs >= 180_000);
    assert.ok(budget("zen").callMs >= 120_000);
    assert.ok(budget("codex-frontier").wallMs >= 420_000);
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

  it("prefers Claude over Grok", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-ant-test", XAI_API_KEY: "xai-test" }, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "anthropic");
      assert.equal(p?.label, "Claude");
    });
  });

  it("puts the CLI ahead of Grok too", () => {
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

  it("falls back to Grok when the CLI is switched off", () => {
    withEnv({ ...BARE, XAI_API_KEY: "xai-test" }, () => {
      const p = resolveProvider();
      assert.equal(p?.kind, "openai");
      assert.equal(p?.label, "xAI");
    });
  });

  it("honours ANTHROPIC_MODEL on the CLI path", () => {
    withEnv({ ANTHROPIC_MODEL: "claude-sonnet-5" }, () =>
      assert.equal(resolveProvider()?.model, "claude-sonnet-5"),
    );
  });
});

describe("grokChat", () => {
  it("returns the desk-facing unavailable error when the key is missing", async () => {
    const prev: Record<string, string | undefined> = {};
    for (const k of [
      "XAI_API_KEY",
      "LLM_API_KEY",
      "LLM_BASE_URL",
      "GROK_API_KEY",
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
      { choice: "local", kind: "openai", label: "Local Qwen", vars: BARE },
      { choice: "zen", kind: "openai", label: "Zen MiMo", vars: BARE },
      { choice: "codex-balanced", kind: "codex", label: "Codex Terra", vars: BARE },
      { choice: "codex-frontier", kind: "codex", label: "Codex Sol", vars: BARE },
      {
        choice: "claude-frontier",
        kind: "anthropic",
        label: "Claude Opus",
        vars: { ...BARE, ANTHROPIC_API_KEY: "sk-ant-test" },
      },
      { choice: "claude-frontier", kind: "claude-code", label: "Claude Opus", vars: {} },
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
});

describe("model-picker provider readiness", () => {
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

  it("proves the selected local model is actually loaded", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "qwen/qwen3.6-35b-a3b" }] }), { status: 200 });
    try {
      await withEnvAsync(BARE, async () => {
        const result = await probeProvider("local");
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.choice, "local");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a running local server when the named model is not loaded", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "some-other-model" }] }), { status: 200 });
    try {
      const result = await probeProvider("local");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not loaded/i);
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

  it("keeps Local available explicitly but starts Automatic at proven hosted providers", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "mimo-v2.5-free" }] }), { status: 200 });
    };
    try {
      await withEnvAsync(BARE, async () => {
        const result = await probeProvider("auto");
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.choice, "zen");
      });
      assert.deepEqual(urls, ["https://opencode.ai/zen/v1/models"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("distinguishes an unreachable provider from a timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("connection refused");
    };
    try {
      const result = await probeProvider("local");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /unreachable/i);
        assert.doesNotMatch(result.error, /timed out/i);
      }
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
    "XAI_API_KEY",
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
    Grok only wins once the CLI is out of the chain. The precedence is
    LLM_BASE_URL > ANTHROPIC_API_KEY > Claude Code CLI > XAI_API_KEY, and this
    machine has the CLI installed — my first version of this test set
    XAI_API_KEY alone and failed, because the CLI legitimately outranked it.
    The test was wrong, not the code.
  */
  it("names no model on Grok either", () => {
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
