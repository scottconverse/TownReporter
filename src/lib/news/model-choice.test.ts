import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  modelChoiceLabel,
  modelChoiceHelp,
  OPINION_MODEL_CHOICES,
  opinionModelChoice,
  opinionProviderProblem,
  STORY_MODEL_CHOICES,
  storyModelChoice,
} from "./model-choice.ts";

const STORY_VALUES = [
  "auto", "local", "zen", "codex-balanced", "codex-frontier", "claude-frontier",
] as const;

describe("model choice contract", () => {
  it("keeps unique Story values in the intended order with Automatic first", () => {
    const values = STORY_MODEL_CHOICES.map((choice) => choice.value);
    assert.deepEqual(values, STORY_VALUES);
    assert.equal(new Set(values).size, values.length);
    assert.equal(STORY_MODEL_CHOICES[0].label, "Automatic");
    assert.match(STORY_MODEL_CHOICES[0].detail, /recommended/i);
  });

  it("limits Opinion to Automatic and the two frontier choices", () => {
    assert.deepEqual(
      OPINION_MODEL_CHOICES.map((choice) => choice.value),
      ["auto", "codex-frontier", "claude-frontier"],
    );
    assert.ok(OPINION_MODEL_CHOICES.every((choice) => STORY_MODEL_CHOICES.includes(choice)));
  });

  it("round-trips every valid Story choice and defaults invalid input safely", () => {
    for (const value of STORY_VALUES) assert.equal(storyModelChoice(value), value);
    for (const invalid of [undefined, null, "", "codex", "local; rm", 0, {}, []]) {
      assert.equal(storyModelChoice(invalid), "auto");
    }
  });

  it("round-trips Opinion choices and narrows Story-only or invalid input to Automatic", () => {
    for (const value of ["auto", "codex-frontier", "claude-frontier"] as const) {
      assert.equal(opinionModelChoice(value), value);
    }
    for (const invalid of ["local", "zen", "codex-balanced", "codex", undefined, null, {}]) {
      assert.equal(opinionModelChoice(invalid), "auto");
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
      "Uses your configured gateway when set; otherwise tries Zen MiMo, Codex Terra, then Claude Opus. Local Qwen is available by explicit choice.",
    );
    assert.equal(
      modelChoiceHelp("auto", "opinion"),
      "Uses Claude Opus. Codex Opinion stays disabled until its separate voice-file authorization is granted.",
    );
    assert.equal(
      modelChoiceHelp("codex-frontier"),
      "Uses only Codex Sol for this run; no fallback.",
    );
  });

  it("gives Opinion only setup steps that can actually unlock Opinion", () => {
    const guidance = opinionProviderProblem(
      "AI is not available. Set ANTHROPIC_API_KEY, XAI_API_KEY, or LLM_BASE_URL.",
    );
    assert.match(guidance, /Claude Code/);
    assert.match(guidance, /ANTHROPIC_API_KEY/);
    assert.match(guidance, /cannot use xAI or a generic LLM gateway/i);
    assert.doesNotMatch(guidance, /set .*XAI_API_KEY|set .*LLM_BASE_URL/i);
  });
});
