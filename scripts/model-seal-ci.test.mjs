import test from "node:test";
import assert from "node:assert/strict";

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
