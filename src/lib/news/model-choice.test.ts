import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveStoryModelChoice,
  darkModelChoice,
  localModelOptionLabel,
  modelChoiceLabel,
  modelChoiceHelp,
  OPINION_MODEL_CHOICES,
  FORCED_MODEL_CHOICES,
  opinionModelChoice,
  opinionProviderProblem,
  rememberedStoryModelChoice,
  retiredModelChoiceNote,
  STORY_MODEL_CHOICES,
  storyModelChoice,
  shouldHydrateDarkModel,
} from "./model-choice.ts";
import { LOCAL_MODEL_UNCONFIGURED } from "./preflight.ts";
import { automaticLadder, providersFor } from "./provider-registry.ts";

const STORY_VALUES = [
  "auto",
  "codex-astra",
  "codex-frontier",
  "codex-balanced",
  "codex-luna",
  "claude-fable",
  "claude-frontier",
  "claude-sonnet",
  "claude-haiku",
  "local-model",
] as const;

/**
 * Automatic's own rungs: not options in any menu, but valid on a job row
 * (0.6.63, Unit Y item 1). A job Automatic pinned to one has to keep it.
 */
const RUNG_VALUES = ["deepseek-flash", "qwen-local"] as const;

describe("model choice contract", () => {
  it("offers every named subscription model in the shared Story picker", () => {
    assert.deepEqual(
      STORY_MODEL_CHOICES.map((choice) => choice.label),
      [
        "Automatic",
        "Codex Astra",
        "Codex Sol",
        "Codex Terra",
        "Codex Luna",
        "Claude Fable",
        "Claude Opus",
        "Claude Sonnet",
        "Claude Haiku",
        "Local model",
      ],
    );
  });
  it("runs Automatic on DeepSeek, then Qwen, then Codex Terra", () => {
    assert.deepEqual([...automaticLadder()], [
      "deepseek-flash",
      "qwen-local",
      "codex-balanced",
    ]);
    // Claude Sonnet left the ladder in 0.6.63 (Unit Y item 1) and is a hand
    // pick only; the frontier Codex stays off it as it always has.
    assert.ok(!automaticLadder().includes("claude-sonnet"));
    assert.ok(!automaticLadder().includes("codex-frontier"));
  });
  it("never converts a missing or malformed custom connection into Automatic", () => {
    for (const value of ["custom:", "custom:deleted", "custom:untrusted/input"]) {
      for (const normalize of [storyModelChoice, opinionModelChoice, darkModelChoice]) {
        assert.equal(normalize(value), value);
      }
    }
  });
  it("preserves an explicit saved API connection in every workflow without changing built-in choices", () => {
    const choice = "custom:2ff67746-9c53-465d-9d63-fb96a7ec1175";
    for (const normalize of [
      storyModelChoice,
      opinionModelChoice,
      darkModelChoice,
      effectiveStoryModelChoice,
    ]) {
      assert.equal(normalize(choice), choice);
    }
    assert.match(modelChoiceLabel(choice), /custom api/i);
    assert.match(modelChoiceHelp(choice), /technical failure/i);
    assert.doesNotMatch(modelChoiceHelp(choice), /tries Claude/);
    assert.deepEqual(
      STORY_MODEL_CHOICES.map((option) => option.value),
      STORY_VALUES,
    );
  });
  it("ignores stale Dark Desk detail, then hydrates when the selected file's detail arrives", () => {
    assert.equal(shouldHydrateDarkModel(8, 7, "codex-balanced", "briefed"), false);
    assert.equal(shouldHydrateDarkModel(8, 8, null, "investigating"), false);
    assert.equal(shouldHydrateDarkModel(8, 8, "codex-balanced", "investigating"), true);
    assert.equal(shouldHydrateDarkModel(8, 8, null, "briefed"), true);
  });

  it("keeps unique Story values in the intended order with Automatic first", () => {
    const values = STORY_MODEL_CHOICES.map((choice) => choice.value);
    assert.deepEqual(values, STORY_VALUES);
    assert.equal(new Set(values).size, values.length);
    assert.equal(STORY_MODEL_CHOICES[0].label, "Automatic");
    assert.match(STORY_MODEL_CHOICES[0].detail, /recommended/i);
  });

  it("offers the signed-in Codex providers on Opinion", () => {
    assert.deepEqual(
      OPINION_MODEL_CHOICES.map((choice) => choice.value),
      STORY_VALUES,
    );
    assert.deepEqual(
      OPINION_MODEL_CHOICES.map((choice) => choice.value),
      STORY_MODEL_CHOICES.map((choice) => choice.value),
    );
  });

  it("derives the forced batch list directly and excludes Automatic", () => {
    assert.deepEqual(
      FORCED_MODEL_CHOICES.map((choice) => choice.value),
      providersFor("forced").map((entry) => entry.id),
    );
    assert.ok(!FORCED_MODEL_CHOICES.some((choice) => choice.value === "auto"));
    assert.equal(modelChoiceLabel("codex-balanced", "forced"), "Codex Terra");
  });

  it("round-trips every valid Story choice and defaults invalid input safely", () => {
    for (const value of [...STORY_VALUES, ...RUNG_VALUES]) {
      assert.equal(storyModelChoice(value), value);
    }
    for (const invalid of [undefined, null, "", "codex", "local; rm", 0, {}, []]) {
      assert.equal(storyModelChoice(invalid), "auto");
    }
  });

  it("labels a pinned rung with the model that actually wrote the draft", () => {
    // "Automatic" would be a lie on the line the editor reads to find out.
    assert.equal(modelChoiceLabel("deepseek-flash"), "DeepSeek v4.1 Flash");
    assert.equal(modelChoiceLabel("qwen-local"), "Qwen 3.6 35B");
  });

  it("falls a stored SuperGrok choice back to Automatic and says so", () => {
    // Sign-in is untouched by the retirement, so the note says so.
    assert.equal(modelChoiceLabel("grok-oauth"), "Automatic");
    assert.equal(storyModelChoice("grok-oauth"), "auto");
    assert.equal(opinionModelChoice("grok-oauth"), "codex-frontier");
    assert.equal(darkModelChoice("grok-oauth"), "auto");
    assert.equal(
      retiredModelChoiceNote("grok-oauth"),
      "SuperGrok is no longer offered as a writing model, so this falls back to Automatic. SuperGrok sign-in is unaffected.",
    );
    for (const value of [...STORY_VALUES, ...RUNG_VALUES, undefined, null, "custom:x"]) {
      assert.equal(retiredModelChoiceNote(value), null);
    }
    // Retired means retired: no menu offers it on any surface.
    for (const surface of ["story", "scan", "opinion", "dark", "forced"] as const) {
      assert.ok(!providersFor(surface).some((entry) => entry.id === "grok-oauth"));
    }
  });

  it("normalises stored 'local' and 'zen' choices (from old jobs) to Automatic", () => {
    // Zen and Local Qwen were removed from the picker 2026-09-02. A job queued
    // before the removal can still have "local" or "zen" persisted for it; that
    // must fall back to Automatic exactly like any other unrecognized value.
    assert.equal(storyModelChoice("local"), "auto");
    assert.equal(storyModelChoice("zen"), "auto");
  });

  it("preserves Automatic's configured-gateway selection for the whole queued run", () => {
    assert.equal(effectiveStoryModelChoice("configured"), "configured");
    assert.equal(effectiveStoryModelChoice("codex-balanced"), "codex-balanced");
    assert.equal(effectiveStoryModelChoice("not-a-provider"), "auto");
    assert.equal(modelChoiceLabel("configured"), "Configured gateway");
  });

  it("restores the editor's visible Story choice from the latest job", () => {
    assert.equal(rememberedStoryModelChoice("claude-frontier", "auto"), "auto");
    assert.equal(rememberedStoryModelChoice("codex-frontier", "editor"), "codex-frontier");
    assert.equal(rememberedStoryModelChoice("local-model", "editor"), "local-model");
  });

  it("round-trips Opinion choices and defaults missing or invalid input to Sol", () => {
    for (const value of [
      "auto",
      "claude-frontier",
      "codex-balanced",
      "codex-frontier",
      "local-model",
    ] as const) {
      assert.equal(opinionModelChoice(value), value);
    }
    for (const invalid of ["local", "zen", "codex", "grok-oauth", undefined, null, {}]) {
      assert.equal(opinionModelChoice(invalid), "codex-frontier");
    }
  });

  it("maps every valid value to its visible label and invalid input to Automatic", () => {
    for (const choice of STORY_MODEL_CHOICES) {
      assert.equal(modelChoiceLabel(choice.value), choice.label);
    }
    assert.equal(modelChoiceLabel("not-a-model"), "Automatic");
    assert.equal(modelChoiceLabel(undefined), "Automatic");
  });

  it("explains each automatic order and technical fallback for explicit choices", () => {
    assert.equal(
      modelChoiceHelp("auto"),
      "Uses your configured gateway when set; otherwise tries DeepSeek v4.1 Flash, Qwen 3.6 35B, then Codex Terra. A model on this computer is used only when it is already loaded. If the first provider reaches a usage limit, becomes unavailable, loses its login, or does not respond in time, the unfinished call moves to the next. A content refusal stops the run.",
    );
    assert.equal(
      modelChoiceHelp("auto", "opinion"),
      "Tries Codex Sol, then Claude Sonnet. If one reaches a usage limit or has a technical failure, the editorial moves to the next signed-in provider. A provider refusal stops the run.",
    );
    assert.equal(
      modelChoiceHelp("auto", "dark"),
      "Uses your configured gateway when set; otherwise tries Codex Terra, then Claude Sonnet. Planning uses the selected provider's faster planning model. If the first provider's login has lapsed or synthesis does not respond in time, only the unfinished stage moves to the next provider.",
    );
    assert.equal(
      modelChoiceHelp("codex-frontier"),
      "Prefers Codex Sol for this run. If it has a technical failure, the unfinished call can move to the next ready writing model; a content refusal stops the run.",
    );
  });

  it("names the local model in every picker and says an unavailable selection stops", () => {
    assert.equal(modelChoiceLabel("local-model"), "Local model");
    assert.equal(
      modelChoiceHelp("local-model"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "opinion"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "dark"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
  });

  it("no longer names SuperGrok as a writing model in any picker", () => {
    // Retired 0.6.63, Unit Y item 4. A stored choice reads as Automatic and
    // the help says why, rather than describing a provider the menu dropped.
    for (const surface of [undefined, "opinion", "dark"] as const) {
      const help = modelChoiceHelp("grok-oauth", surface);
      assert.doesNotMatch(help, /Prefers Grok/);
    }
    assert.match(modelChoiceHelp("grok-oauth"), /^Uses your configured gateway/);
  });

  it("gives Opinion setup steps for its one provider, and does not send anyone to Codex", () => {
    const guidance = opinionProviderProblem(
      "AI is not available. Set ANTHROPIC_API_KEY, XAI_API_KEY, or LLM_BASE_URL.",
    );
    assert.doesNotMatch(guidance, /Codex/);
    assert.match(guidance, /Claude Code/);
    assert.doesNotMatch(guidance, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(guidance, /set .*XAI_API_KEY|set .*LLM_BASE_URL/i);
  });

  it("gives an unconfigured Local model pick the same single local-specific message preflight uses", () => {
    const guidance = opinionProviderProblem(
      "AI is not available. Set ANTHROPIC_API_KEY, XAI_API_KEY, or LLM_BASE_URL.",
      "local-model",
    );
    assert.equal(guidance, LOCAL_MODEL_UNCONFIGURED);
    assert.match(guidance, /Start LM Studio's local server or Ollama/);
    assert.match(guidance, /click Refresh/);
    assert.doesNotMatch(guidance, /set LLM_MODEL/);
    assert.doesNotMatch(guidance, /Claude Code/);
  });
});

describe("localModelOptionLabel", () => {
  it("appends ' · vision' for a vision-capable model, alongside loaded/thinking", () => {
    assert.equal(
      localModelOptionLabel({ id: "qwen2.5vl-7b", loaded: true, thinking: false, vision: true }),
      "qwen2.5vl-7b · loaded · vision",
    );
  });

  it("shows the bare id when nothing else applies", () => {
    assert.equal(
      localModelOptionLabel({ id: "gemma4:12b", loaded: null, thinking: false, vision: false }),
      "gemma4:12b",
    );
  });

  it("never claims vision for a plain chat model", () => {
    const label = localModelOptionLabel({
      id: "gemma4:12b",
      loaded: true,
      thinking: true,
      vision: false,
    });
    assert.doesNotMatch(label, /vision/);
    assert.equal(label, "gemma4:12b · loaded · thinking off");
  });

  it("labels hosted Ollama models and their large context window", () => {
    assert.equal(
      localModelOptionLabel({
        id: "deepseek-v4.1-flash:cloud",
        loaded: null,
        thinking: true,
        vision: true,
        cloud: true,
        contextLength: 1_048_576,
      }),
      "deepseek-v4.1-flash:cloud · Ollama Cloud · 1M context · thinking off · vision",
    );
  });
});

/*
  0.6.63 (Unit Y item 5). The Server page's Writing models panel has to say
  the order in plain words, and it reads the sentence from here so the panel
  cannot describe a ladder the desk no longer has. The word "Qwen" is the
  owner's -- plain rather than the picker's full model id -- because what the
  operator has to check is that a Qwen is LOADED on this machine, not which
  version number the label carries.

  Imported through a variable on purpose: the test runner loads this file
  whole, so a name that does not exist yet would fail every test in it rather
  than the one that is actually red.
*/
const ORDER_MODULE = "./model-choice.ts";

async function orderSentenceFn(): Promise<(ladder?: readonly string[]) => string> {
  const module = (await import(ORDER_MODULE)) as unknown as Record<string, unknown>;
  const fn = module.automaticOrderSentence;
  assert.equal(typeof fn, "function", "model-choice.ts must export automaticOrderSentence");
  return fn as (ladder?: readonly string[]) => string;
}

describe("the Writing models panel's ladder sentence", () => {
  it("says the order in plain words, first to last", async () => {
    const sentence = await orderSentenceFn();
    assert.equal(
      sentence(),
      "Automatic uses DeepSeek v4.1 Flash first, then Qwen on this computer if it is loaded, then Codex Terra.",
    );
  });

  it("follows the ladder it is given, and says so when there is none", async () => {
    const sentence = await orderSentenceFn();
    assert.equal(sentence(["codex-balanced"]), "Automatic uses Codex Terra.");
    assert.equal(
      sentence(["codex-balanced", "deepseek-flash"]),
      "Automatic uses Codex Terra first, then DeepSeek v4.1 Flash.",
    );
    assert.equal(sentence([]), "Automatic has no writing model set up on this machine.");
  });
});
