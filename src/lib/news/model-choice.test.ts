import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectiveStoryModelChoice,
  darkModelChoice,
  localModelOptionLabel,
  modelChoiceLabel,
  modelChoiceHelp,
  OPINION_MODEL_CHOICES,
  opinionModelChoice,
  opinionProviderProblem,
  STORY_MODEL_CHOICES,
  storyModelChoice,
  shouldHydrateDarkModel,
} from "./model-choice.ts";

const STORY_VALUES = [
  "auto",
  "codex-balanced",
  "codex-frontier",
  "claude-frontier",
  "local-model",
] as const;

describe("model choice contract", () => {
  it("never converts a missing or malformed custom connection into Automatic", () => {
    for (const value of ["custom:", "custom:deleted", "custom:untrusted/input"]) {
      for (const normalize of [storyModelChoice, opinionModelChoice, darkModelChoice]) {
        assert.equal(normalize(value), value);
      }
    }
  });
  it("preserves an explicit saved API connection in every workflow without changing built-in choices", () => {
    const choice = "custom:2ff67746-9c53-465d-9d63-fb96a7ec1175";
    for (const normalize of [storyModelChoice, opinionModelChoice, darkModelChoice, effectiveStoryModelChoice]) {
      assert.equal(normalize(choice), choice);
    }
    assert.match(modelChoiceLabel(choice), /custom api/i);
    assert.match(modelChoiceHelp(choice), /no fallback/i);
    assert.doesNotMatch(modelChoiceHelp(choice), /tries Claude/);
    assert.deepEqual(STORY_MODEL_CHOICES.map((option) => option.value), STORY_VALUES);
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
      ["auto", "codex-balanced", "codex-frontier", "claude-frontier", "local-model"],
    );
    assert.ok(OPINION_MODEL_CHOICES.every((choice) => STORY_MODEL_CHOICES.includes(choice)));
  });

  it("round-trips every valid Story choice and defaults invalid input safely", () => {
    for (const value of STORY_VALUES) assert.equal(storyModelChoice(value), value);
    for (const invalid of [undefined, null, "", "codex", "local; rm", 0, {}, []]) {
      assert.equal(storyModelChoice(invalid), "auto");
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

  it("round-trips Opinion choices and defaults missing or invalid input to Sol", () => {
    for (const value of ["auto", "claude-frontier", "codex-balanced", "codex-frontier", "local-model"] as const) {
      assert.equal(opinionModelChoice(value), value);
    }
    for (const invalid of ["local", "zen", "codex", undefined, null, {}]) {
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

  it("explains each automatic order and makes explicit choices no-fallback", () => {
    assert.equal(
      modelChoiceHelp("auto"),
      "Uses your configured gateway when set; otherwise tries Claude Opus, then Codex Terra. If the first one's login has lapsed or it does not respond in time, the draft moves to the next.",
    );
    assert.equal(
      modelChoiceHelp("auto", "opinion"),
      "Tries Claude Opus, then Codex Sol. If one reaches a usage limit or has a technical failure, the editorial moves to the next signed-in provider. A provider refusal stops the run, and an explicit pick never falls back.",
    );
    assert.equal(
      modelChoiceHelp("codex-frontier"),
      "Uses only Codex Sol for this run; no fallback.",
    );
  });

  it("names the local model in every picker, with no fallback when chosen explicitly", () => {
    assert.equal(modelChoiceLabel("local-model"), "Local model");
    assert.equal(
      modelChoiceHelp("local-model"),
      "Uses only Local model for this run; no fallback.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "opinion"),
      "Uses only Local model for this run; no fallback.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "dark"),
      "Uses only Local model for this run; no fallback.",
    );
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
    assert.match(guidance, /LLM_BASE_URL/);
    assert.match(guidance, /LLM_MODEL/);
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
    const label = localModelOptionLabel({ id: "gemma4:12b", loaded: true, thinking: true, vision: false });
    assert.doesNotMatch(label, /vision/);
    assert.equal(label, "gemma4:12b · loaded · thinking off");
  });
});
