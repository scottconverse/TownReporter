import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNAL_PROVIDER_IDS,
  KIND_BUDGETS,
  MAX_BUDGET_MS,
  MIN_BUDGET_MS,
  PICKER_PROVIDER_IDS,
  PIPELINE_BUDGET,
  PROVIDER_REGISTRY,
  automaticLadder,
  clampBudgetMs,
  effectiveBudget,
  enabledAutomaticLadder,
  plannerModelFor,
  providerEnabled,
  providerEntry,
  providerModel,
  providersFor,
  validateProviderSeconds,
  type ProviderSurface,
} from "./provider-registry.ts";

const ENV_KEYS = [
  "TOWNREPORTER_CODEX",
  "TOWNREPORTER_CLAUDE_CODE",
  "TOWNREPORTER_LOCAL",
  "TOWNREPORTER_CODEX_TERRA_MODEL",
  "TOWNREPORTER_CODEX_SOL_MODEL",
  "ANTHROPIC_MODEL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

const SURFACES: ProviderSurface[] = ["story", "scan", "opinion", "dark"];

describe("the provider registry is the one description of a writing model", () => {
  it("gives every entry the fields the rest of the desk reads off it", () => {
    for (const entry of PROVIDER_REGISTRY) {
      assert.ok(entry.label.trim(), `${entry.id} needs a label the picker can show`);
      assert.ok(entry.detail.trim(), `${entry.id} needs the half-line under its label`);
      assert.ok(entry.model.trim(), `${entry.id} needs a default model identifier`);
      assert.ok(KIND_BUDGETS[entry.kind], `${entry.id} has a kind with no default budget`);
      for (const field of ["wallMs", "callMs", "reserveMs"] as const) {
        assert.equal(
          typeof entry.budget[field],
          "number",
          `${entry.id}.budget.${field} must be a number of milliseconds`,
        );
        assert.ok(entry.budget[field] > 0, `${entry.id}.budget.${field} must be positive`);
      }
      assert.equal(typeof entry.enabled, "function");
      for (const surface of SURFACES) {
        assert.equal(
          typeof entry.offeredFor[surface],
          "boolean",
          `${entry.id} must say whether it is offered for ${surface}`,
        );
      }
    }
  });

  it("keeps unique ids, and the id lists agree with the registry itself", () => {
    const ids = PROVIDER_REGISTRY.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "two entries share an id");
    assert.deepEqual(
      [...ids].sort(),
      [...PICKER_PROVIDER_IDS, ...INTERNAL_PROVIDER_IDS].sort(),
      "PICKER_PROVIDER_IDS + INTERNAL_PROVIDER_IDS must name exactly the registry's entries",
    );
    // An INTERNAL id is one no picker offers; that is what makes it internal.
    for (const id of INTERNAL_PROVIDER_IDS) {
      const entry = providerEntry(id)!;
      assert.ok(
        SURFACES.every((surface) => !entry.offeredFor[surface]),
        `${id} is an internal provider but some picker offers it`,
      );
    }
  });

  it("offers Opinion Claude and the local model, because Codex alone declines to write editorials", () => {
    // The provider's own policy, recorded on the entries: gpt-5.6-sol returned
    // "EDITORIAL_REFUSAL: I can't provide an editorial that advocates a
    // position on a local government policy issue" -- twice, on a real subject.
    // The local model has no such policy, and "anywhere an AI acts, the editor
    // can pick the model" applies to Opinion too -- it is offered everywhere.
    assert.deepEqual(
      providersFor("opinion").map((entry) => entry.id),
      ["claude-frontier", "local-model"],
    );
    // Everything Opinion offers, Story and Dark offer too.
    for (const entry of providersFor("opinion")) {
      assert.ok(entry.offeredFor.story && entry.offeredFor.dark);
    }
  });

  it("gives Dark Desk the same providers Story has -- every model that drafts can dig", () => {
    assert.deepEqual(
      providersFor("dark").map((entry) => entry.id),
      providersFor("story").map((entry) => entry.id),
    );
  });
});

describe("the Automatic ladder is derived, not typed out", () => {
  it("orders the ladder by ladderRank, which is not the picker's order", () => {
    const ladder = automaticLadder();
    assert.deepEqual(ladder, ["claude-frontier", "codex-balanced"]);
    // The picker reads Codex, Codex, Claude; the ladder tries Claude first.
    // Two different orders on purpose -- see ProviderEntry.ladderRank.
    assert.notDeepEqual(
      ladder,
      providersFor("story")
        .map((entry) => entry.id)
        .filter((id) => automaticLadder().includes(id)),
    );
    for (const id of ladder) {
      assert.ok(providerEntry(id), `ladder names ${id}, which is not in the registry`);
    }
  });

  it("leaves the frontier model and the gateway out of the ladder", () => {
    // Codex Sol is a deliberate, expensive choice; the gateway is resolved
    // before the ladder runs at all.
    assert.ok(!automaticLadder().includes("codex-frontier"));
    assert.ok(!automaticLadder().includes("configured"));
  });

  it("drops a rung the machine has switched off, without changing the static ladder", () => {
    withEnv({ TOWNREPORTER_CODEX: "0" }, () => {
      assert.deepEqual(enabledAutomaticLadder(), ["claude-frontier"]);
      // The static list is unchanged: it is read at module load by ai.ts, and
      // the probe loop already copes with a rung that turns out to be gone.
      assert.deepEqual(automaticLadder(), ["claude-frontier", "codex-balanced"]);
    });
    withEnv({ TOWNREPORTER_CLAUDE_CODE: "0", TOWNREPORTER_CODEX: "0" }, () => {
      assert.deepEqual(enabledAutomaticLadder(), []);
    });
  });
});

describe("environment overrides are config, not code", () => {
  it("lets an install rename the model behind an entry", () => {
    withEnv({ TOWNREPORTER_CODEX_TERRA_MODEL: "gpt-9-terra" }, () => {
      assert.equal(providerModel(providerEntry("codex-balanced")!), "gpt-9-terra");
    });
    withEnv({}, () => {
      assert.equal(providerModel(providerEntry("codex-balanced")!), "gpt-5.6-terra");
    });
  });

  it("does not let ANTHROPIC_MODEL redefine the entry called Claude Opus", () => {
    // The menu says "Claude Opus". An install that points ANTHROPIC_MODEL at
    // Sonnet must not make that label a lie; the variable still steers the
    // no-explicit-choice default path in resolveProvider().
    withEnv({ ANTHROPIC_MODEL: "claude-sonnet-5" }, () => {
      assert.equal(providerModel(providerEntry("claude-frontier")!), "claude-opus-5");
    });
  });

  it("reads the off switch through enabled(), and the paper's switch on top of it", () => {
    withEnv({ TOWNREPORTER_CODEX: "0" }, () => {
      assert.equal(providerEnabled("codex-balanced"), false);
      // The paper cannot turn on what the machine does not have.
      assert.equal(providerEnabled("codex-balanced", { "codex-balanced": { enabled: true } }), false);
    });
    withEnv({}, () => {
      assert.equal(providerEnabled("codex-balanced"), true);
      // ...and the machine having it does not force it onto this desk.
      assert.equal(
        providerEnabled("codex-balanced", { "codex-balanced": { enabled: false } }),
        false,
      );
    });
    assert.equal(providerEnabled("not-a-provider"), false);
  });
});

describe("the planner substitution rule", () => {
  it("substitutes a cheaper model from the SAME provider, never another's", () => {
    withEnv({}, () => {
      // Claude plans on Haiku: same searches as Opus, more claims, a quarter
      // of the cost. Both Codex entries plan on Terra.
      assert.match(plannerModelFor("claude-frontier"), /haiku/i);
      assert.equal(plannerModelFor("codex-balanced"), "gpt-5.6-terra");
      assert.equal(plannerModelFor("codex-frontier"), "gpt-5.6-terra");
      /*
        Audit finding TW-001: the gateway gets NO opinion. Returning a Claude
        identifier here meant every Dark Desk hop against LM Studio or Ollama
        asked for a model that endpoint had never heard of; the call failed and
        the planner fell back to keyword matching without a word.
      */
      assert.equal(plannerModelFor("configured"), "");
      assert.equal(plannerModelFor("not-a-provider"), "");
      assert.equal(plannerModelFor(undefined), "");
    });
  });

  it("honours the same rename the entry's own model honours", () => {
    withEnv({ TOWNREPORTER_CODEX_TERRA_MODEL: "gpt-9-terra" }, () => {
      assert.equal(plannerModelFor("codex-frontier"), "gpt-9-terra");
    });
  });
});

describe("effectiveBudget merges the paper's override over the shipped default", () => {
  it("returns the entry's own numbers when the paper has said nothing", () => {
    assert.deepEqual(effectiveBudget("claude-frontier"), KIND_BUDGETS["claude-code"]);
    assert.deepEqual(effectiveBudget("codex-balanced"), KIND_BUDGETS.codex);
    // The gateway keeps the generous pipeline budget, not the fast-HTTP one.
    assert.deepEqual(effectiveBudget("configured"), PIPELINE_BUDGET);
    assert.deepEqual(effectiveBudget("not-a-provider"), PIPELINE_BUDGET);
  });

  it("takes a per-call override and leaves the reserve alone", () => {
    const merged = effectiveBudget("claude-frontier", {
      "claude-frontier": { callMs: 300_000 },
    });
    assert.equal(merged.callMs, 300_000);
    assert.equal(merged.reserveMs, KIND_BUDGETS["claude-code"].reserveMs);
  });

  it("never lets the wall budget fall below one call's own ceiling", () => {
    /*
      A pipeline given less wall clock than one of its own calls cannot make
      that call at all. An editor raising only the per-call number must not
      thereby break the pipeline around it.
    */
    const merged = effectiveBudget("claude-frontier", {
      "claude-frontier": { callMs: 900_000, wallMs: 60_000 },
    });
    assert.equal(merged.callMs, 900_000);
    assert.equal(merged.wallMs, 900_000);
  });

  it("clamps a number outside the allowed range rather than trusting it", () => {
    assert.equal(clampBudgetMs(1), MIN_BUDGET_MS);
    assert.equal(clampBudgetMs(999_999_999), MAX_BUDGET_MS);
    assert.equal(
      effectiveBudget("codex-balanced", { "codex-balanced": { callMs: 1 } }).callMs,
      MIN_BUDGET_MS,
    );
    assert.equal(
      effectiveBudget("codex-balanced", { "codex-balanced": { callMs: 99_999_999 } }).callMs,
      MAX_BUDGET_MS,
    );
  });

  it("ignores a missing, null, zero or nonsense override instead of reading it as a budget", () => {
    const shipped = KIND_BUDGETS.codex;
    for (const bad of [
      { callMs: null },
      { callMs: 0 },
      { callMs: Number.NaN },
      { callMs: undefined },
      {},
    ]) {
      assert.deepEqual(
        effectiveBudget("codex-balanced", { "codex-balanced": bad }),
        shipped,
        `override ${JSON.stringify(bad)} must not be read as a number`,
      );
    }
    assert.deepEqual(effectiveBudget("codex-balanced", null), shipped);
    // Another provider's override is not this provider's business.
    assert.deepEqual(
      effectiveBudget("codex-balanced", { "claude-frontier": { callMs: 300_000 } }),
      shipped,
    );
  });

  it("reserves a generous default for the local entry", () => {
    /*
      The operator's rule: "next we'll be adding local LLMs (llama.cpp / LM
      Studio) -- build the pickers so that is config, not code", and "timeouts
      are likely too short for local models". A 30B on this box answers a
      20,000-character pack in minutes, so the local kind gets ten minutes for
      one call rather than the CLI's two and a half.
    */
    assert.deepEqual(effectiveBudget("local-model"), KIND_BUDGETS.local);
    assert.ok(KIND_BUDGETS.local.callMs >= 600_000);
    assert.ok(KIND_BUDGETS.local.callMs > KIND_BUDGETS["claude-code"].callMs);
    assert.ok(KIND_BUDGETS.local.callMs <= MAX_BUDGET_MS);
  });
});

describe("what the editor is allowed to type", () => {
  it("accepts the whole range and refuses either side of it, in words", () => {
    assert.equal(validateProviderSeconds(10), null);
    assert.equal(validateProviderSeconds(150), null);
    assert.equal(validateProviderSeconds(3_600), null);
    for (const bad of [9, 0, -1, 3_601, Number.NaN, Number.POSITIVE_INFINITY]) {
      const problem = validateProviderSeconds(bad);
      assert.ok(problem, `${bad} seconds must be refused`);
      // Says what IS allowed, so the editor knows what to type next. The old
      // habit here would be to clamp silently, which tells them nothing.
      assert.match(problem, /number of seconds|between 10 seconds and 3600 seconds/);
    }
  });

  it("names the ceiling in minutes as well as seconds, because 3600 is not a duration anyone reads", () => {
    assert.match(validateProviderSeconds(99_999)!, /60 minutes/);
  });
});

describe("the local model is a named pick, everywhere an AI acts", () => {
  it("is offered on all four surfaces", () => {
    const entry = providerEntry("local-model")!;
    for (const surface of SURFACES) {
      assert.equal(entry.offeredFor[surface], true, `local-model must be offered for ${surface}`);
    }
  });

  it("reuses the documented LLM_BASE_URL / LLM_MODEL / LLM_API_KEY wiring, not a split env", () => {
    // docs/local-models.md already tells an operator to point LLM_BASE_URL at
    // llama.cpp / LM Studio for the `configured` gateway. A second, separate
    // LOCAL_BASE_URL for this named pick would split one server's config
    // across two variable names for no reason -- so this entry reads the
    // exact same three variables.
    const entry = providerEntry("local-model")!;
    assert.deepEqual(entry.envOverrides, {
      model: "LLM_MODEL",
      baseUrl: "LLM_BASE_URL",
      apiKey: "LLM_API_KEY",
    });
  });

  /*
    Audit finding "a 'local' pick can hit the real paid OpenAI cloud": a key
    plus a model with no LLM_BASE_URL used to be enough to mark this entry
    enabled, and ai.ts's old resolution path for it fell back to
    "https://api.openai.com/v1" -- so an editor's "Local model" pick could be
    ready and yet quietly draft on OpenAI's paid cloud. This entry is named
    "Local model": it must require an actual local endpoint, full stop.
  */
  it("is disabled until LLM_BASE_URL is configured -- a key plus a model alone is not enough", () => {
    withEnv({}, () => assert.equal(providerEnabled("local-model"), false));
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:1234/v1" }, () =>
      assert.equal(providerEnabled("local-model"), true),
    );
    withEnv({ LLM_API_KEY: "sk-test", LLM_MODEL: "qwen" }, () =>
      assert.equal(
        providerEnabled("local-model"),
        false,
        "LLM_API_KEY + LLM_MODEL alone must not make a 'local' pick ready -- it has no local endpoint",
      ),
    );
  });

  it("honours its own off switch even when a base URL is configured", () => {
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:1234/v1", TOWNREPORTER_LOCAL: "0" }, () =>
      assert.equal(providerEnabled("local-model"), false),
    );
  });

  it("is not in the Automatic ladder -- the configured gateway already pins Automatic to it", () => {
    assert.ok(!automaticLadder().includes("local-model"));
  });

  it("has no planner substitution -- a local server has never heard of another provider's model", () => {
    assert.equal(plannerModelFor("local-model"), "");
  });
});
