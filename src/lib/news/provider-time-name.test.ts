import { test } from "node:test";
import assert from "node:assert/strict";
import { timeRowName } from "./provider-time-name.ts";

test("FB17: the two Local model time rows get different names", () => {
  const a = timeRowName({ providerId: "local-model", label: "Local model" });
  const b = timeRowName({ providerId: "qwen-local", label: "Local model" });
  assert.notEqual(a, b);
  assert.match(a, /^Local model/);
  assert.match(b, /^Local model/);
  assert.equal(timeRowName({ providerId: "codex", label: "Codex" }), "Codex");
});
