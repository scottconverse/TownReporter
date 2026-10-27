import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionError } from "./ai.ts";
import { plainServerWords, hideServerAddresses } from "./server-answer-words.ts";
import { deskLocalModelNextStep, withLocalModelNextStep } from "./desk-local-model.ts";

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
  /* The code stays in the technical-detail fold; the address does not. */
  assert.ok(detail && detail.includes("ECONNREFUSED"), `detail was ${JSON.stringify(detail)}`);
  assert.doesNotMatch(detail ?? "", /127\.0\.0\.1|1299/);
  assert.match(detail ?? "", /the model server/);
});

test("a known port is named for the server it belongs to", () => {
  assert.equal(hideServerAddresses("connect ECONNREFUSED 127.0.0.1:1234"), "connect ECONNREFUSED LM Studio");
  assert.equal(hideServerAddresses("failed at http://localhost:11434/v1/models"), "failed at Ollama");
  assert.equal(hideServerAddresses("no route to gw.example.com:8317"), "no route to the model server");
});

test("model ids that look like host:port are left alone", () => {
  assert.equal(hideServerAddresses("qwen2.5:14b and gemma4:12b"), "qwen2.5:14b and gemma4:12b");
});

test("a failed job's own text never shows a host:port", () => {
  const { text } = plainServerWords("Model switch: Local model skipped (connect ECONNREFUSED 127.0.0.1:1299)");
  assert.doesNotMatch(text, /127\.0\.0\.1|:1299/);
});

test("no model loaded always carries the same next step the Models page uses", () => {
  const next = deskLocalModelNextStep({ override: null });
  assert.ok(next);
  const { text } = plainServerWords("Skipped: No model is loaded on this computer..");
  assert.equal(text, `Skipped: No model is loaded on this computer. ${next}`);
  assert.equal(withLocalModelNextStep(`No model is loaded on this computer. ${next}`), `No model is loaded on this computer. ${next}`);
  assert.equal(withLocalModelNextStep("Codex timed out."), "Codex timed out.");
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
