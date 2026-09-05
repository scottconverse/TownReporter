import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeProviderAvailability } from "./provider-availability.ts";
import { PICKER_PROVIDER_IDS } from "./provider-registry.ts";

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
