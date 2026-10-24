import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionError } from "./ai.ts";
import { plainServerWords } from "./server-answer-words.ts";

test("a connection error in a failover note keeps the trail and moves the cause to the detail", () => {
  const sentence = connectionError(
    "Local model",
    new Error("fetch failed", {
      cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:1299" },
    }),
  );
  const { text, detail } = plainServerWords(`${sentence} -> Codex Sol 6.1`);
  assert.equal(
    text,
    "Local model: the model server did not answer. Check that it is running and that this machine is online. -> Codex Sol 6.1",
  );
  assert.doesNotMatch(text, /127\.0\.0\.1/);
  assert.ok(detail && detail.includes("127.0.0.1:1299"), `detail was ${JSON.stringify(detail)}`);
});

test("a connection error with no cause gives no detail", () => {
  const sentence = connectionError("Local model", new Error(""));
  const { text, detail } = plainServerWords(sentence);
  assert.equal(detail, null);
  assert.equal(
    text,
    "Local model: the model server did not answer. Check that it is running and that this machine is online.",
  );
});

test("unrelated text comes back unchanged", () => {
  const text = "Codex Sol 6.1 timed out. This draft moved to Local model because it was unavailable.";
  const result = plainServerWords(text);
  assert.equal(result.text, text);
  assert.equal(result.detail, null);
});
