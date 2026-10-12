import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeProviderAvailability, getProviderAvailability } from "./provider-availability.server.ts";
import { PICKER_PROVIDER_IDS, setLocalDiscoveryReachable } from "./provider-registry.ts";
import { recordOllamaCloudCall } from "./ollama-cloud-readiness.server.ts";
import { testOllamaCloudWarnings } from "./provider-availability.server.ts";

const ENV_KEYS = [
  "TOWNREPORTER_CODEX",
  "TOWNREPORTER_CLAUDE_CODE",
  "TOWNREPORTER_LOCAL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/**
 * The picker used to list every `PROVIDER_REGISTRY` entry as a plain,
 * always-selectable option regardless of `enabled()` -- `providersFor()`
 * filters by `offeredFor[surface]` only. With `LLM_BASE_URL` unset, "Local
 * model" still showed up and could be chosen, and the draft it started could
 * only fail (owner report 2026-09-05). This is the server-side function the
 * picker now calls instead, so this test proves the readiness answer itself
 * is correct without needing a browser to render the `<select>`.
 */
describe("provider availability for the picker", () => {
  it("warns both names for an exhausted cloud model and clears only after a successful explicit connection test", async () => {
    setLocalDiscoveryReachable(true);
    const url = "http://127.0.0.1:11434/v1";
    const model = "deepseek-v4.1-flash:cloud";
    const words = "you (sconverse) have reached your monthly usage limit";
    recordOllamaCloudCall(url, model, 429, words);
    const deps = {
      refreshLocalCatalog: async () => undefined,
      resolveLocal: async () => ({ baseUrl: url, id: model }),
      probeProvider: async () => ({ ok: true as const, choice: "claude-sonnet" as const, label: "Claude Sonnet" }),
    };
    let availability = await getProviderAvailability(1, deps);
    for (const id of ["deepseek-flash", "local-model"]) {
      assert.equal(availability[id], false);
      assert.match(availability.reasons![id], /Ollama says: you \(sconverse\).*Add credit at ollama.com\/settings/);
    }
    await testOllamaCloudWarnings(async () => new Response(JSON.stringify({ data: [{ id: model }] })));
    availability = await getProviderAvailability(1, deps);
    assert.equal(availability["deepseek-flash"], false, "a catalog response cannot prove usage is available");
    await testOllamaCloudWarnings(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
    availability = await getProviderAvailability(1, deps);
    assert.equal(availability.reasons?.["deepseek-flash"]?.includes("Ollama says:"), undefined);
    assert.equal(availability.reasons?.["local-model"]?.includes("Ollama says:"), undefined);
    setLocalDiscoveryReachable(false);
  });
  it("reports Haiku's actual signed-out state before a draft press", async () => {
    const availability = await getProviderAvailability(1, {
      refreshLocalCatalog: async () => undefined,
      probeProvider: async (choice) => choice === "claude-haiku"
        ? { ok: false, error: "Claude Code is signed out" }
        : { ok: true, choice: "claude-sonnet", label: "Claude Sonnet" },
    });
    assert.equal(availability["claude-haiku"], false);
    assert.equal(availability.reasons?.["claude-haiku"], "Claude is signed out on this server. Sign in once: run claude auth login on the server.");
  });
  it("retains the missing CLI reason from the existing probe", async () => {
    const availability = await getProviderAvailability(1, {
      refreshLocalCatalog: async () => undefined,
      probeProvider: async () => ({ ok: false, error: "Claude Code CLI not found. Install it." }),
    });
    assert.equal(availability["claude-sonnet"], false);
    assert.equal(availability.reasons?.["claude-sonnet"], "Claude Code is not installed on this server.");
  });
  it("uses one Codex sign-in probe for every Codex picker choice", async () => {
    const calls: string[] = [];
    const availability = await getProviderAvailability(1, {
      refreshLocalCatalog: async () => undefined,
      resolveLocal: async () => null,
      probeProvider: async (choice) => {
        const id = choice ?? "";
        calls.push(id);
        return id.startsWith("codex-")
          ? { ok: false as const, error: "Codex is not installed. Install the Codex CLI." }
          : { ok: true as const, choice: "claude-sonnet" as const, label: "Claude Sonnet" };
      },
    });
    const codexIds = PICKER_PROVIDER_IDS.filter((id) => id.startsWith("codex-"));
    assert.equal(calls.filter((id) => id.startsWith("codex-")).length, 1);
    for (const id of codexIds) {
      assert.equal(availability[id], false, `${id} must match the missing Codex CLI`);
      assert.match(availability.reasons?.[id] ?? "", /Codex is not ready|not installed/);
    }
  });
  it("marks Local model unavailable when LLM_BASE_URL is unset", () => {
    withEnv({}, () => {
      const availability = computeProviderAvailability();
      assert.equal(availability["local-model"], false);
    });
  });

  it("marks Local model available once LLM_BASE_URL is set", () => {
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:11434/v1" }, () => {
      const availability = computeProviderAvailability();
      assert.equal(availability["local-model"], true);
    });
  });

  it("answers for every picker-offered provider id", () => {
    withEnv({}, () => {
      const availability = computeProviderAvailability();
      for (const id of PICKER_PROVIDER_IDS) {
        assert.equal(typeof availability[id], "boolean", `${id} should have a boolean answer`);
      }
    });
  });

  it("respects the local off switch even with LLM_BASE_URL set", () => {
    withEnv({ LLM_BASE_URL: "http://127.0.0.1:11434/v1", TOWNREPORTER_LOCAL: "0" }, () => {
      const availability = computeProviderAvailability();
      assert.equal(availability["local-model"], false);
    });
  });
});
