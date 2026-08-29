import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  plannerModel,
  GROK_UNAVAILABLE,
  grokChat,
  isGrokAvailable,
  parseJsonBlock,
  resolveAnthropic,
  resolveLlm,
  resolveProvider,
} from "./ai.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  const keys = ["XAI_API_KEY", "GROK_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "OPENAI_API_KEY", "XAI_MODEL", "XAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_EFFORT", "TOWNREPORTER_CLAUDE_CODE", "CLAUDE_CLI_PATH"];
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
    for (const k of ["XAI_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "GROK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TOWNREPORTER_CLAUDE_CODE"]) {
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
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:1234/v1", TOWNREPORTER_PLANNER_MODEL: "qwen3.6-35b" }, () => {
      assert.equal(plannerModel(), "qwen3.6-35b");
    });
  });
});
