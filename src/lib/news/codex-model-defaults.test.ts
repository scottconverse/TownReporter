// guards: an editor's Codex choice silently runs an old model or has no effort choices.
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROVIDER_REGISTRY,
  providerModel,
  plannerModelFor,
  modelEffortsForModel,
  defaultModelEffort,
} from "./provider-registry.ts";
import { testProvider, resetProviderTestsForTest } from "./provider-login.server.ts";

it("runs current Codex models with usable effort choices for every editor choice", async () => {
  const keys = ["CODEX_CLI_PATH", "TOWNREPORTER_CODEX_SOL_MODEL", "TOWNREPORTER_CODEX_TERRA_MODEL"];
  const saved = keys.map((key) => process.env[key]);
  const dir = await mkdtemp(join(tmpdir(), "codex-model-defaults-"));
  try {
    const cli = join(dir, "codex.mjs");
    await writeFile(
      cli,
      `const model = process.argv[process.argv.indexOf('--model') + 1];
process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:model}}));`,
    );
    process.env.CODEX_CLI_PATH = cli;
    delete process.env.TOWNREPORTER_CODEX_SOL_MODEL;
    delete process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
    const signIn = await testProvider("codex");
    assert.equal(signIn.ok, true);
    for (const entry of PROVIDER_REGISTRY.filter((entry) => entry.kind === "codex")) {
      const model = providerModel(entry);
      for (const resolved of [model, plannerModelFor(entry.id), signIn.detail]) {
        assert.doesNotMatch(resolved, /^gpt-5\.6-/, entry.id);
      }
      const efforts = modelEffortsForModel(model);
      assert.ok(efforts.length > 0, entry.id);
      assert.ok(efforts.includes(defaultModelEffort(entry.id)!), entry.id);
    }
    for (const [sol, terra, expected] of [
      [undefined, undefined, "gpt-6.1-sol"],
      [" ", "gpt-6-sol", "gpt-6-sol"],
      [" gpt-6.1-sol ", "gpt-6-sol", "gpt-6.1-sol"],
    ]) {
      process.env.TOWNREPORTER_CODEX_SOL_MODEL = sol ?? "";
      process.env.TOWNREPORTER_CODEX_TERRA_MODEL = terra ?? "";
      assert.equal((await testProvider("codex")).detail, expected);
      for (const entry of PROVIDER_REGISTRY.filter((entry) => entry.kind === "codex")) {
        assert.equal(plannerModelFor(entry.id), expected);
      }
    }
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
    resetProviderTestsForTest();
    await rm(dir, { recursive: true });
  }
});
