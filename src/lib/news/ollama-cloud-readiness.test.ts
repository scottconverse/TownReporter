import { it } from "node:test";
import assert from "node:assert/strict";
import { recordOllamaCloudCall, ollamaCloudWarning } from "./ollama-cloud-readiness.server.ts";
import { writerIsReady, writerUnavailableReason, type ProviderAvailability } from "./writer-bar.ts";

it("retains Ollama's usage words through catalog reads and other failures until a successful model call", () => {
  const url = "http://127.0.0.1:11434/v1";
  const model = "release-h-test:cloud";
  const words = "you (sconverse) have reached your monthly usage limit, add usage credits: https://ollama.com/settings";
  recordOllamaCloudCall(url, model, 429, words);
  assert.equal(ollamaCloudWarning(`${url}/`, model), `Ollama says: ${words} Add credit at ollama.com/settings, or the desk moves to the next model.`);
  recordOllamaCloudCall(url, model, 503, "Service unavailable");
  assert.match(ollamaCloudWarning(url, model)!, /sconverse/);
  recordOllamaCloudCall(url, model, 200, "monthly usage limit");
  assert.match(ollamaCloudWarning(url, model)!, /monthly usage limit/);
  recordOllamaCloudCall(url, model, 200, "");
  assert.equal(ollamaCloudWarning(url, model), undefined);
  recordOllamaCloudCall(url, "on-device", 429, words);
  assert.equal(ollamaCloudWarning(url, "on-device"), undefined);
});

it("uses the selected scope's exact cloud pair for picker warnings without disabling another local model", () => {
  const reason = "Ollama says: monthly usage limit. Add credit at ollama.com/settings, or the desk moves to the next model.";
  const pair = { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek:cloud" };
  const availability = Object.assign({ "local-model": false }, {
    reasons: { "local-model": reason }, cloudWarnings: [{ ...pair, reason }],
  }) as unknown as ProviderAvailability;
  const input = { choice: "local-model", label: "Local model", customConnection: null, availability, localModel: pair };
  assert.equal(writerIsReady(input), false);
  assert.equal(writerUnavailableReason(input), reason);
  assert.equal(writerIsReady({ ...input, localModel: { ...pair, id: "local-qwen" } }), true);
});
