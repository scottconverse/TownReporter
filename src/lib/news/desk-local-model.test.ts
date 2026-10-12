import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskLocalModelSentence, localServerStatus } from "./desk-local-model.ts";
const model = {
  id: "qwen3.8:27b-q6_K",
  label: "Qwen",
  loaded: true,
  cloud: false,
  kind: "chat" as const,
  thinking: false,
  vision: false,
  contextLength: null,
};
const server = {
  kind: "ollama" as const,
  baseUrl: "http://127.0.0.1:11434/v1",
  reachable: true,
  models: [model],
};
describe("Models page local choice words", () => {
  it("names the model and where it runs", () =>
    assert.match(
      deskLocalModelSentence({
        override: { baseUrl: server.baseUrl, id: model.id },
        catalog: { servers: [server], defaultModel: null, checkedAt: 0 },
      }),
      /qwen3\.8:27b-q6_K on Ollama, this computer/,
    ));
  it("warns that cloud spends credits even if missing from discovery", () =>
    assert.match(
      deskLocalModelSentence({
        override: { baseUrl: server.baseUrl, id: "deepseek-v4.1-flash:cloud" },
        catalog: { servers: [server], defaultModel: null, checkedAt: 0 },
      }),
      /Ollama Cloud.*not this computer.*spends credits/,
    ));
  it("says no model is loaded rather than promising cloud", () =>
    assert.match(
      deskLocalModelSentence({
        override: null,
        catalog: { servers: [], defaultModel: null, checkedAt: 0 },
      }),
      /No model is loaded on this computer/,
    ));
  it("only says Ready when a local model is loaded", () => {
    assert.equal(localServerStatus(server), "Ready");
    const unloaded = localServerStatus({ ...server, models: [{ ...model, loaded: false }] });
    assert.match(unloaded, /Server reachable.*no.*model.*loaded/i);
    assert.notEqual(unloaded, "Ready");
    assert.notEqual(localServerStatus({ ...server, models: [{ ...model, cloud: true }] }), "Ready");
    assert.equal(localServerStatus({ ...server, reachable: false }), "Could not reach");
  });
});
