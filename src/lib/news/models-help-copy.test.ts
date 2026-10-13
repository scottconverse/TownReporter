import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_FIELD_HELP,
  SETUP_FIELD_HELP,
  TEST_ALL_CONNECTIONS_LINE,
  effortChoiceLabel,
  setupFieldHelp,
  testAllCardNote,
} from "./models-help-copy.ts";
import { MODEL_EFFORT_LABELS } from "./provider-registry.ts";

/**
 * FB08 (walk step "4. Connections"): the editor pressed "Test all connections"
 * and its result said it only re-read sign-ins and looked for local servers,
 * asking no model anything -- while LM Studio and Ollama had no individual Test
 * and Codex had none while marked missing. The button keeps its name; a plain
 * line beside it now says what it checks and points at the per-card Test, and
 * every card without a Test says why and what to do instead.
 */
describe("FB08 — the Test-all line and the no-Test card notes are plain", () => {
  it("says Test all does NOT ask a model, and points at the card Test", () => {
    assert.match(TEST_ALL_CONNECTIONS_LINE, /does not ask any model/i);
    assert.match(TEST_ALL_CONNECTIONS_LINE, /Test on its card/i);
    // Plain words: the line an editor reads must not be one of the desk's own
    // internals.
    for (const jargon of ["OAuth", "endpoint", "transport", "LiteLLM"]) {
      assert.doesNotMatch(TEST_ALL_CONNECTIONS_LINE, new RegExp(jargon, "i"));
    }
  });

  it("gives every no-Test card a reason and a next step", () => {
    for (const scope of ["cloud", "local", "signin"] as const) {
      const note = testAllCardNote(scope);
      assert.ok(note.length > 0);
      assert.match(note, /No Test/);
      assert.match(note, /Test|check it|Use/);
    }
    // Codex's missing-command case and LM Studio / Ollama's read-only case are
    // different sentences, not one generic line.
    assert.notEqual(testAllCardNote("cloud"), testAllCardNote("local"));
  });
});

/**
 * FB22 (row B2-22): an owner setting up writing meets OAuth, an OpenAI-compatible
 * endpoint, LiteLLM, model ID, context, transport and the raw effort tokens
 * (low/medium/high/xhigh/max) with no explanation. Every field now carries a
 * plain line, and each effort choice shows the picker's plain word beside the
 * raw one.
 */
describe("FB22 — every setup field and effort choice has a plain line", () => {
  it("explains each field an owner meets while setting up writing", () => {
    const keys = [
      "connectionName",
      "baseUrl",
      "apiKey",
      "modelId",
      "context",
      "transport",
      "oauth",
      "openaiCompatible",
      "litellm",
    ] as const;
    for (const key of keys) {
      const line = setupFieldHelp(key);
      assert.ok(line.trim().length > 0, `${key} has no plain line`);
      assert.equal(line, SETUP_FIELD_HELP[key]);
    }
    // The walk's own example, kept verbatim.
    assert.equal(SETUP_FIELD_HELP.modelId, "Model ID: the exact model name your provider uses.");
  });

  it("shows the picker's plain word beside each raw effort token", () => {
    for (const effort of ["none", "low", "medium", "high", "xhigh", "max"] as const) {
      const label = effortChoiceLabel(effort);
      assert.match(label, new RegExp(`\\(${effort}\\)$`), `${effort} raw token missing`);
      assert.ok(
        label.includes(MODEL_EFFORT_LABELS[effort]) ||
          /Off — no extra thinking/.test(label),
        `${effort} plain word missing`,
      );
    }
    assert.equal(effortChoiceLabel("medium"), "Medium — balanced (medium)");
    assert.match(EFFORT_FIELD_HELP, /how hard the model thinks/i);
  });
});
