import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeTestEnvironment } from "./test-environment.mjs";

test("the ordinary suite strips inherited real-database and hosted-runtime settings", () => {
  const env = safeTestEnvironment({
    DATABASE_URL: "postgres://live.example/townreporter",
    VERCEL: "1",
    VERCEL_ENV: "production",
    RUN_LIVE_MODEL_TESTS: "1",
    KEEP_ME: "yes",
  });
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.VERCEL, undefined);
  assert.equal(env.VERCEL_ENV, undefined);
  assert.equal(env.RUN_LIVE_MODEL_TESTS, undefined);
  assert.equal(env.KEEP_ME, "yes");
  assert.equal(env.TOWNREPORTER_TEST_ENV_VERIFIED, "1");
});

test("the startup guard rejects an ordinary child that still has the live-model opt-in", () => {
  const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", guard, "--eval", ""], {
    env: {
      ...process.env,
      TOWNREPORTER_TEST_ENV_VERIFIED: "1",
      RUN_LIVE_MODEL_TESTS: "1",
    },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(child.status, 0);
  assert.match(`${child.stdout}\n${child.stderr}`, /live model evaluation enabled/i);
});

test("npm test can only enter through the safe runner and its startup guard", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts.test, "node scripts/run-tests-safe.mjs");
  const runner = await readFile(new URL("./test-environment.mjs", import.meta.url), "utf8");
  assert.match(runner, /delete env\.DATABASE_URL/);
  const launcher = await readFile(new URL("./run-tests-safe.mjs", import.meta.url), "utf8");
  assert.match(launcher, /--import/);
  const guard = await readFile(new URL("./test-environment-guard.mjs", import.meta.url), "utf8");
  assert.match(guard, /Refusing to start .* DATABASE_URL set/);
  assert.match(guard, /Refusing to start .* live model evaluation enabled/);
});
