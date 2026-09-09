import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.equal(env.DATABASE_URL, "");
  assert.equal(env.VERCEL, "");
  assert.equal(env.VERCEL_ENV, "");
  assert.equal(env.RUN_LIVE_MODEL_TESTS, "");
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
  assert.match(runner, /env\.DATABASE_URL = ""/);
  const launcher = await readFile(new URL("./run-tests-safe.mjs", import.meta.url), "utf8");
  assert.match(launcher, /--import/);
  const guard = await readFile(new URL("./test-environment-guard.mjs", import.meta.url), "utf8");
  assert.match(guard, /Refusing to start .* DATABASE_URL set/);
  assert.match(guard, /Refusing to start .* live model evaluation enabled/);
});

test("TanStack Vite env reload cannot revive a database or live-provider opt-in in an ordinary child", async () => {
  const root = await mkdtemp(join(tmpdir(), "townreporter-env-sentinel-"));
  try {
    await writeFile(join(root, ".env"), "DATABASE_URL=postgres://sentinel.invalid/never-dial\nVERCEL=1\nVERCEL_ENV=production\nRUN_LIVE_MODEL_TESTS=1\n");
    const pluginUrl = new URL("../node_modules/@tanstack/start-plugin-core/dist/esm/vite/load-env-plugin/plugin.js", import.meta.url).href;
    const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;
    const code = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      net.Socket.prototype.connect = function () { throw new Error('NETWORK FORBIDDEN in env sentinel'); };
      const {loadEnvPlugin} = await import(${JSON.stringify(pluginUrl)});
      const hook = loadEnvPlugin().configResolved;
      await (typeof hook === 'function' ? hook : hook.handler)({mode:'test',root:${JSON.stringify(root)}});
      for (const key of ['DATABASE_URL','VERCEL','VERCEL_ENV','RUN_LIVE_MODEL_TESTS']) assert.equal(process.env[key], '', key+' revived from .env');
      console.log('ENV SENTINEL PASS: no database module loaded or socket allowed');
    `;
    const omitted = safeTestEnvironment();
    for (const key of ["DATABASE_URL", "VERCEL", "VERCEL_ENV", "RUN_LIVE_MODEL_TESTS"]) delete omitted[key];
    for (const env of [safeTestEnvironment(), omitted]) {
      const child = spawnSync(process.execPath, ["--import", guard, "--input-type=module", "--eval", code], {
        env, encoding: "utf8", windowsHide: true, timeout: 15000,
      });
      assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
      assert.match(child.stdout, /ENV SENTINEL PASS/);
    }
  } finally {
    await rm(root, {recursive:true,force:true});
  }
});
