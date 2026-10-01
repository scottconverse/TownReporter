import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import {
  checkOpinionReadiness,
  firstReadyOpinionRung,
  OPINION_MODEL_UNIVERSE,
} from "./opinion-readiness.ts";
import { modelChoiceLabel, OPINION_AUTOMATIC_LADDER } from "./model-choice.ts";
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

/*
  UNIT U24 -- THE OPINION DESK SAYS WHOSE MODELS IT MEANS.

  The stand-in editorial day: /desk/opinion read "AI is not available. No model
  is set up yet: open Claude Code or Codex on this machine and log in, or set
  LLM_BASE_URL for an OpenAI-compatible gateway" minutes after the story desk
  had written a draft with DeepSeek. The sentence was true of Opinion and read
  as true of the whole desk, because nothing in it said which models it was
  talking about. These tests hold the fix: the message names Opinion's own
  models, in the order Opinion tries them, and says what is missing for each.

  U24's own choice was to change the COPY and leave the ladder alone. Unit U29
  (owner decision 2026-09-30) then changed the ladder too -- Opinion's
  Automatic now starts on DeepSeek v4.1 Flash -- so the sentence that said
  "the desk's story writer is not used for Opinion" would now be false. The
  tests below pin the sentence that replaced it, rung by rung, in order.
*/
describe("U24: Opinion says which models it writes with", () => {
  it("names Automatic's own three, in the order Automatic walks them", () => {
    assert.match(OPINION_MODEL_UNIVERSE, /DeepSeek/);
    assert.match(OPINION_MODEL_UNIVERSE, /Codex/);
    assert.match(OPINION_MODEL_UNIVERSE, /Claude/);
    // The order in the sentence is the ladder's order, not a sentence someone
    // typed once: DeepSeek first, then Codex Sol, then Claude Sonnet.
    const deepseek = OPINION_MODEL_UNIVERSE.indexOf("DeepSeek");
    const codex = OPINION_MODEL_UNIVERSE.indexOf("Codex");
    const claude = OPINION_MODEL_UNIVERSE.indexOf("Claude");
    assert.ok(
      deepseek > -1 && deepseek < codex && codex < claude,
      `the sentence must name the rungs in ladder order, got: ${OPINION_MODEL_UNIVERSE}`,
    );
    for (const rung of OPINION_AUTOMATIC_LADDER) {
      assert.ok(
        OPINION_MODEL_UNIVERSE.includes(modelChoiceLabel(rung)),
        `the sentence must name every rung it means: ${rung}`,
      );
    }
    // The one true thing that replaced U24's "a different list" sentence.
    assert.match(OPINION_MODEL_UNIVERSE, /DeepSeek is also the model the desk's story writer drafts with/);
  });

  /*
    UNIT U24b -- THE OTHER TWO ARE CHOICES, NOT MISSING PIECES.

    U24's first sentence listed four paths and said none of them was set up.
    That was too broad in the other direction: a local model and a saved
    connection are EXPLICIT PICKS (`OPINION_MODEL_CHOICES`), never walked by
    Automatic, so "a local model is not set up" reads as a verdict on a path
    this failure never tried. What the editor needs is Automatic's own two
    named, and the other two offered as what they are.
  */
  it("offers the local model and the saved connection as picks, not as failures", () => {
    const picks = OPINION_MODEL_UNIVERSE.slice(OPINION_MODEL_UNIVERSE.indexOf("pick by name"));
    assert.ok(picks.length > 0, "the sentence must offer the two explicit picks");
    assert.match(picks, /local model/);
    assert.match(picks, /saved connection/);
    assert.doesNotMatch(
      picks,
      /not set up|none of them|no model/i,
      "a path Automatic never walks must not be reported as missing",
    );
  });

  it("says it on the page when Automatic finds nothing", async () => {
    const result = await withEnv({ TOWNREPORTER_CLAUDE_CODE: "0", TOWNREPORTER_CODEX: "0" }, () =>
      checkOpinionReadiness("auto", {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        probeCandidate: async () => ({
          ok: false as const,
          error:
            "AI is not available. No model is set up yet: open Claude Code or Codex on this machine and log in, or set LLM_BASE_URL for an OpenAI-compatible gateway.",
        }),
      }),
    );
    assert.equal(result.ready, false);
    assert.match(
      result.why,
      /Opinion's Automatic writes with DeepSeek v4\.1 Flash, then Codex Sol, then Claude Sonnet/,
    );
    /* The generic sentence that started this is gone from what the editor reads. */
    assert.doesNotMatch(result.why, /No model is set up yet/);
    /* And each rung Automatic walked says what is missing for itself. */
    assert.match(result.why, /Opinion can write with DeepSeek v4\.1 Flash/);
    assert.match(result.why, /Opinion can write with Codex Sol/);
    assert.match(result.why, /Opinion can write with Claude, and Claude Code is not signed in/);
  });

  /*
    Unit U29: a readiness sentence per state, each one true of the state it is
    shown in. The DeepSeek rung is an Ollama endpoint rather than a login, so
    it gets its own line -- the generic copy names Claude Code and Codex logins
    and neither is what is missing when this rung cannot answer.
  */
  it("explains the DeepSeek rung in its own words, and does not send the editor to a login", async () => {
    const result = await withEnv({}, () =>
      checkOpinionReadiness("deepseek-flash", {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        probeCandidate: async () => ({
          ok: false as const,
          error:
            "AI is not available. No model is set up yet: open Claude Code or Codex on this machine and log in, or set LLM_BASE_URL for an OpenAI-compatible gateway.",
        }),
      }),
    );
    assert.equal(result.ready, false);
    assert.match(result.why, /Opinion can write with DeepSeek v4\.1 Flash/);
    assert.match(result.why, /start Ollama|TOWNREPORTER_DEEPSEEK_BASE_URL/);
    assert.doesNotMatch(result.why, /open Claude Code|Codex on this machine and log in/);
    // A DeepSeek pick is not silently rewritten into the page default, and it
    // is an explicit pick, so the other rungs are not listed at it.
    assert.equal(result.effectiveChoice, "deepseek-flash");
    assert.doesNotMatch(result.why, /Opinion's Automatic writes with/);
  });

  it("keeps a generic failure that is not about setup exactly as the provider said it", async () => {
    const result = await withEnv({}, () =>
      checkOpinionReadiness("deepseek-flash", {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        probeCandidate: async () => ({
          ok: false as const,
          error: "Ollama is unreachable. Check that it is running and that this machine is online.",
        }),
      }),
    );
    assert.equal(result.ready, false);
    assert.match(result.why, /Ollama is unreachable/);
    assert.doesNotMatch(
      result.why,
      /Opinion can write with DeepSeek/,
      "a failure that is already specific must pass through untouched",
    );
  });

  it("does not list the other models to an editor who picked one on purpose", async () => {
    const result = await withEnv({}, () =>
      checkOpinionReadiness("claude-sonnet", {
        findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        probeCandidate: async () => ({
          ok: false as const,
          error:
            "AI is not available. No model is set up yet: open Claude Code or Codex on this machine and log in, or set LLM_BASE_URL for an OpenAI-compatible gateway.",
        }),
      }),
    );
    assert.equal(result.ready, false);
    assert.match(result.why, /Opinion can write with Claude/);
    assert.doesNotMatch(result.why, /Automatic writes with Codex Sol, then Claude Sonnet/);
  });

  it("walks exactly the three rungs it names, in that order", () => {
    assert.deepEqual(
      [...OPINION_AUTOMATIC_LADDER],
      ["deepseek-flash", "codex-frontier", "claude-sonnet"],
    );
  });

  /*
    Unit U29: which rung a RUN starts on. `firstReadyOpinionRung` is what
    `performEditorialWork` asks before it begins an Automatic editorial, and
    the reason it exists is that the head of this ladder is now an Ollama
    endpoint a given machine may not have -- starting on it blindly would
    begin every Automatic piece on a rung that cannot answer.
  */
  it("resolves Automatic to the first rung that answers, in ladder order", async () => {
    const asked: string[] = [];
    const resolved = await firstReadyOpinionRung(async (choice) => {
      asked.push(choice);
      return { ok: choice === "codex-frontier" };
    });
    assert.equal(resolved, "codex-frontier");
    assert.deepEqual(asked, ["deepseek-flash", "codex-frontier"]);

    const none = await firstReadyOpinionRung(async () => ({ ok: false }));
    assert.equal(none, null, "nothing ready is reported as nothing ready, not as a guess");

    const first = await firstReadyOpinionRung(async () => ({ ok: true }));
    assert.equal(first, "deepseek-flash", "a ready DeepSeek is where an Automatic editoral starts");
  });
});

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

  it("Automatic starts on DeepSeek and does not probe the rungs behind it", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("auto", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: true as const, label: "DeepSeek v4.1 Flash", choice };
      },
    });
    assert.equal(result.ready, true);
    // Automatic stays Automatic on the queued request; the rung it resolved to
    // is the run's business, not the row's.
    assert.equal(result.effectiveChoice, "auto");
    assert.deepEqual(probed, ["deepseek-flash"]);
  });

  it("Automatic falls through to Codex Sol when DeepSeek cannot answer", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("auto", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return choice === "deepseek-flash"
          ? { ok: false as const, error: "Ollama is unreachable. Check that it is running." }
          : { ok: true as const, label: "Codex Sol", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.effectiveChoice, "auto");
    assert.deepEqual(probed, ["deepseek-flash", "codex-frontier"]);
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
