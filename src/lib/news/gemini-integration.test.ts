import { test } from "node:test";
import assert from "node:assert/strict";
import { automaticLadder, providersFor, providerEntry, modelEffort } from "./provider-registry.ts";
import { grokChat } from "./ai.ts";
import { fileURLToPath } from "node:url";
import { planAutomaticFailover, automaticFailoverReason } from "./automatic-failover.ts";
import { validateForcedRuntime, runForcedChat } from "./forced-runtime.server.ts";
import { resetGeminiCliCache } from "./ai-gemini-cli.server.ts";

test("Gemini Pro plan models are named picks on every writing surface", () => {
  for (const surface of ["story", "scan", "follow-up", "opinion", "dark", "forced"] as const) {
    assert.ok(providersFor(surface).some(entry => entry.id === "gemini-flash"));
    assert.ok(providersFor(surface).some(entry => entry.id === "gemini-pro"));
  }
  assert.equal(providerEntry("gemini-flash")?.label, "Gemini 3.8 Flash (Pro plan)");
  assert.equal(modelEffort("gemini-pro", "medium"), "medium");
});
test("Automatic never puts Gemini on its ladder (Scott, Oct 26 2026)", () => {
  assert.deepEqual(automaticLadder(), ["deepseek-flash", "qwen-local", "codex-balanced", "claude-sonnet"]);
  for (const id of automaticLadder()) {
    assert.notEqual(providerEntry(id)?.kind, "gemini-cli", `${id} is a Gemini rung`);
  }
});
test("a failing run never moves to Gemini, even when Gemini is the only ready model", async () => {
  // Scan 97 (Oct 26 2026) went DeepSeek -> Codex Sol -> Gemini Flash. Every
  // starting point and every source must now skip Gemini.
  const geminiOnlyProbe = async (choice: string) => choice.startsWith("gemini-")
    ? { ok: true as const, choice: "gemini-flash" as const, label: "Gemini" }
    : { ok: false as const, error: "not available" };
  for (const current of ["deepseek-flash", "qwen-local", "codex-balanced", "local-model", "claude-sonnet"]) {
    for (const source of ["auto", "editor", "scheduled"] as const) {
      const hop = await planAutomaticFailover({
        source, current, error: "Codex usage limit reached", probe: geminiOnlyProbe,
        allowExplicitLocalFailover: source === "scheduled",
      });
      assert.ok(!hop?.next.startsWith("gemini-"), `${current} (${source}) moved to ${hop?.next}`);
    }
  }
});
test("the selected Gemini program returns its own failure words to the hop", async () => {
  let called = false;
  const result = await grokChat("system", "draft", 100, { choice: "gemini-pro", reasoningEffort: "medium" }, {
    "gemini-cli": async (provider, request) => {
      called = true;
      assert.equal(provider.kind, "gemini-cli");
      assert.equal(request.model, "gemini-3.1-pro-high");
      assert.equal(request.reasoningEffort, "medium");
      return { ok: false, error: "Gemini says: Google Pro usage limit reached" };
    },
  });
  assert.equal(called, true);
  assert.deepEqual(result, { ok: false, error: "Gemini says: Google Pro usage limit reached" });
});


test("a real fake-Gemini transport failure hops with Gemini's own reason", async () => {
  const saved = { path: process.env.GEMINI_CLI_PATH, error: process.env.FAKE_GEMINI_ERROR, signedOut: process.env.FAKE_GEMINI_SIGNED_OUT };
  process.env.GEMINI_CLI_PATH = fileURLToPath(new URL("../../../scripts/fakes/fake-gemini-cli.mjs", import.meta.url));
  process.env.FAKE_GEMINI_ERROR = "Google Pro usage limit reached";
  delete process.env.FAKE_GEMINI_SIGNED_OUT;
  resetGeminiCliCache();
  try {
    const failed = await grokChat("Write JSON", "Longmont council meeting", 100, { choice: "gemini-pro", timeoutMs: 120000 });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.match(failed.error, /Google Pro usage limit reached/);
    const hop = await planAutomaticFailover({ source: "editor", current: "gemini-pro", error: failed.error,
      probe: async (choice) => choice === "codex-balanced"
        ? { ok: true, choice: "codex-balanced", label: "Codex Sol 6.1 (balanced)" }
        : { ok: false, error: "not available" },
    });
    assert.equal(hop?.next, "codex-balanced");
    assert.equal(hop?.reason, "quota");
  } finally {
    if (saved.path === undefined) delete process.env.GEMINI_CLI_PATH; else process.env.GEMINI_CLI_PATH = saved.path;
    if (saved.error === undefined) delete process.env.FAKE_GEMINI_ERROR; else process.env.FAKE_GEMINI_ERROR = saved.error;
    if (saved.signedOut === undefined) delete process.env.FAKE_GEMINI_SIGNED_OUT; else process.env.FAKE_GEMINI_SIGNED_OUT = saved.signedOut;
    resetGeminiCliCache();
  }
});
test("Gemini missing and signed out are technical failures, but content refusals stay terminal", () => {
  assert.equal(automaticFailoverReason("The Gemini program was not found on this server. Install it or set GEMINI_CLI_PATH."), "unavailable");
  assert.equal(automaticFailoverReason("The Gemini program is not signed in."), "auth");
  assert.equal(automaticFailoverReason("Gemini says: backend connection dropped"), "unavailable");
  assert.equal(automaticFailoverReason("Gemini says: I cannot write this request"), null);
});


test("an unavailable Gemini program stays a named forced choice and reports its own failure", async () => {
  const saved = process.env.GEMINI_CLI_PATH;
  process.env.GEMINI_CLI_PATH = "C:/missing-release-h-gemini.exe";
  resetGeminiCliCache();
  try {
    const snapshot = await validateForcedRuntime(1, "gemini-pro", "low");
    assert.equal(snapshot.modelChoice, "gemini-pro");
    assert.equal(snapshot.transport, "gemini-cli");
    if (snapshot.transport !== "gemini-cli") return;
    assert.equal(snapshot.model, "gemini-3.1-pro-low");
    const result = await runForcedChat<import("./ai.ts").GrokOk | import("./ai.ts").GrokErr>(snapshot, "JSON", "Draft", 100, undefined, {
      codex: async () => { throw new Error("Unexpected Codex"); },
      claude: async () => { throw new Error("Unexpected Claude"); },
      local: async () => { throw new Error("Unexpected local"); },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Gemini program was not found/);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_CLI_PATH; else process.env.GEMINI_CLI_PATH = saved;
    resetGeminiCliCache();
  }
});
