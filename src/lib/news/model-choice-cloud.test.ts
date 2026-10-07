// guards: hosted Ollama picks could spend credits without warning the editor.
import assert from "node:assert/strict";
import { it } from "node:test";
import { localModelOptionText } from "./model-choice.ts";

it("warns that an Ollama cloud pick spends credits before selection", () => {
  const text = localModelOptionText({ id: "deepseek-v4.1-flash:cloud", loaded: null });
  assert.match(text, /cloud.*spends credits/i);
});
