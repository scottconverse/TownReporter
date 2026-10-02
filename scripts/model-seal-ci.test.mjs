import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The seal is only worth anything if it is loaded everywhere a test runs and
 * if the one way around it stays out of CI.
 *
 * Two failures this catches that no other check would:
 *
 *  - `TOWNREPORTER_TEST_ALLOW_REAL_MODELS=1` reaching a workflow. It exists so
 *    a developer can make one deliberate live call; a workflow that set it
 *    would turn every run on that machine back into the thing the seal was
 *    built to stop, and it would still look green.
 *  - A runner that stops loading the seal. `npm test`, the focused
 *    `with-app-env` command CONTRIBUTING.md tells people to use, and the
 *    real-Postgres lane are three separate entry points; a test that reaches a
 *    provider is only refused if the process it starts carries the preload.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

const OPT_IN = "TOWNREPORTER_TEST_ALLOW_REAL_MODELS";
const SEAL = "src/lib/test-support/model-seal.ts";

test("CI never opts the test suite into real model servers", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.ok(!ci.includes(OPT_IN), `.github/workflows/ci.yml must never mention ${OPT_IN}`);
  // The other half of the same property: the opt-in is a live value, so a
  // workflow cannot set it by accident through a matrix or a reusable env.
  for (const line of ci.split(/\r?\n/)) {
    assert.ok(
      !/^\s*RUN_LIVE_MODEL_TESTS\s*:/.test(line) || /""/.test(line),
      `CI must not enable live model evaluation: ${line.trim()}`,
    );
  }
});

test("every test entry point loads the model seal", () => {
  for (const runner of [
    "scripts/run-tests-safe.mjs",
    "scripts/with-app-env.mjs",
    "scripts/run-postgres-integration.mjs",
  ]) {
    assert.ok(read(runner).includes(SEAL), `${runner} must load ${SEAL}`);
  }
});

test("the seal refuses every address discovery actually probes", async () => {
  /*
    The drift check. `DISCOVERED_LOCAL_ADDRESSES` is the one list of default
    local ports, and `local-models.ts` walks all of it on every catalog
    refresh -- which is how a test that merely resolved a provider ended up
    calling a real Ollama. If a fourth default address is ever added there and
    not here, the seal would leave it open, so this asserts the two agree
    rather than trusting them to.
  */
  const { DISCOVERED_LOCAL_ADDRESSES } = await import("../src/lib/news/provider-registry.ts");
  const { modelSealRefusal } = await import("../src/lib/test-support/model-seal.ts");
  const env = { TOWNREPORTER_TEST_ENV_VERIFIED: "1" };

  assert.ok(DISCOVERED_LOCAL_ADDRESSES.length >= 3);
  for (const address of DISCOVERED_LOCAL_ADDRESSES) {
    assert.ok(
      modelSealRefusal(`${address}/models`, env),
      `${address} is probed by discovery but not refused by the seal`,
    );
  }
});
