import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  APP_ENV_REL_PATH,
  mergeAppEnv,
  parseAppEnv,
  projectRoot,
  readAppEnv,
} from "./with-app-env.mjs";

/**
 * Windows refuses symlink creation to unprivileged processes unless Developer
 * Mode is on, so this fixture cannot be built there. That is an environment
 * limit, not a defect — skip rather than fail, so the whole suite is not held
 * hostage by it.
 */
function symlinkSupported() {
  try {
    const dir = mkdtempSync(join(tmpdir(), "symlink-probe-"));
    symlinkSync(dir, join(dir, "self"), "dir");
    return true;
  } catch {
    return false;
  }
}
const SKIP_SYMLINK = symlinkSupported()
  ? undefined
  : { skip: "symlinks not permitted on this platform (Windows Developer Mode is off)" };


const execFileAsync = promisify(execFile);
const WRAPPER = join(projectRoot(), "scripts/with-app-env.mjs");
const PRINT_FLAG = "process.stdout.write(String(process.env.VITE_AUTH_ENABLED));";

function childOutputAfterDatabaseDiagnostic(stdout) {
  const [diagnostic, ...childOutput] = stdout.split("\n");
  assert.match(diagnostic, /^\[with-app-env\] DATABASE_URL (?:-> |is set but unparseable|unset )/);
  return childOutput.join("\n");
}

function environmentOutsideNodeTestRunner(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function makeWorkspace(appEnvJson) {
  const root = mkdtempSync(join(tmpdir(), "app-env-"));
  if (appEnvJson !== undefined) {
    mkdirSync(join(root, ".grok"), { recursive: true });
    writeFileSync(join(root, APP_ENV_REL_PATH), appEnvJson);
  }
  return root;
}

test("keeps VITE_-prefixed string entries", () => {
  assert.deepEqual(parseAppEnv('{"VITE_AUTH_ENABLED":"false"}'), {
    VITE_AUTH_ENABLED: "false",
  });
});

test("drops non-VITE keys, non-string values and malformed documents", () => {
  assert.deepEqual(parseAppEnv('{"DATABASE_URL":"postgres://x","VITE_N":1,"VITE_OK":"y"}'), {
    VITE_OK: "y",
  });
  assert.deepEqual(parseAppEnv("not json"), {});
  assert.deepEqual(parseAppEnv('["VITE_AUTH_ENABLED"]'), {});
  assert.deepEqual(parseAppEnv("null"), {});
});

test("a missing app-env.json is a clean no-op", () => {
  assert.deepEqual(readAppEnv(makeWorkspace()), {});
});

test("reads the app env from a workspace", () => {
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  assert.deepEqual(readAppEnv(root), { VITE_AUTH_ENABLED: "false" });
});

test("an explicit process-env override wins over the file", () => {
  const merged = mergeAppEnv(
    { VITE_AUTH_ENABLED: "false" },
    { VITE_AUTH_ENABLED: "true", PATH: "/usr/bin" },
  );
  assert.equal(merged.VITE_AUTH_ENABLED, "true");
  assert.equal(merged.PATH, "/usr/bin");
});

test("this app does not ship VITE_AUTH_ENABLED=false", () => {
  assert.deepEqual(readAppEnv(projectRoot()), {});
});

test("vite loadEnv resolves the wrapped value", () => {
  // What `import.meta.env.VITE_AUTH_ENABLED` becomes: loadEnv prefix-matches
  // process.env, so the wrapper's merge has to land before Vite starts.
  // Do not `import { loadEnv } from "vite"` here — Vite 8 loads rolldown
  // native bindings that SIGSEGV the test worker under qemu-user.
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  const merged = mergeAppEnv(readAppEnv(root), { PATH: "/usr/bin" });
  assert.equal(merged.VITE_AUTH_ENABLED, "false");
});

test("the wrapped command reports its database and runs with the app env applied", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    WRAPPER,
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(childOutputAfterDatabaseDiagnostic(stdout), "undefined");
});

test("the wrapper reports its database and the command sees an explicit override", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", PRINT_FLAG],
    { env: { ...process.env, VITE_AUTH_ENABLED: "true" } },
  );
  assert.equal(childOutputAfterDatabaseDiagnostic(stdout), "true");
});

test("the wrapper propagates the command's exit code", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]),
    (err) => err.code === 3,
  );
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal:
  // a cancelled build reporting exit 0 is a silently passing gate.
  await assert.rejects(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');setTimeout(() => {}, 1000);",
    ]),
    (err) => err.signal === "SIGTERM" || err.code !== 0,
  );
});

test("the CLI still runs when invoked through a symlinked path", SKIP_SYMLINK, async () => {
  // node realpaths import.meta.url but not process.argv[1], so a raw comparison
  // turns the wrapper into a no-op that exits 0 without starting anything.
  const link = join(mkdtempSync(join(tmpdir(), "app-env-link-")), "scripts");
  symlinkSync(join(projectRoot(), "scripts"), link);
  const { stdout } = await execFileAsync(process.execPath, [
    join(link, "with-app-env.mjs"),
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(childOutputAfterDatabaseDiagnostic(stdout), "undefined");
});

test("a direct Node test through the wrapper cannot inherit a checkout or parent database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "with-app-env-test-"));
  const fixture = join(dir, "environment.test.mjs");
  writeFileSync(
    fixture,
    `import assert from "node:assert/strict";
     import test from "node:test";
     test("isolated", () => {
       assert.equal(process.env.DATABASE_URL, "");
       assert.equal(process.env.TOWNREPORTER_TEST_ENV_VERIFIED, "1");
     });`,
  );
  try {
    const parentDatabaseRun = await execFileAsync(
      process.execPath,
      [WRAPPER, process.execPath, "--test", fixture],
      {
        env: environmentOutsideNodeTestRunner({
          DATABASE_URL: "postgres://sentinel.invalid/must-not-reach-test",
        }),
      },
    );
    assert.match(`${parentDatabaseRun.stdout}\n${parentDatabaseRun.stderr}`, /pass 1/);

    const checkoutEnvironment = environmentOutsideNodeTestRunner();
    delete checkoutEnvironment.DATABASE_URL;
    const checkoutDatabaseRun = await execFileAsync(
      process.execPath,
      [WRAPPER, process.execPath, "--test", fixture],
      { env: checkoutEnvironment },
    );
    assert.match(`${checkoutDatabaseRun.stdout}\n${checkoutDatabaseRun.stderr}`, /pass 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicitly opted-in live-model test keeps its opt-in but not a database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "with-app-env-live-test-"));
  const fixture = join(dir, "live-environment.test.mjs");
  writeFileSync(
    fixture,
    `import assert from "node:assert/strict";
     import test from "node:test";
     test("isolated live opt-in", () => {
       assert.equal(process.env.DATABASE_URL, "");
       assert.equal(process.env.RUN_LIVE_MODEL_TESTS, "1");
     });`,
  );
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [WRAPPER, process.execPath, "--test", fixture],
      {
        env: environmentOutsideNodeTestRunner({
          DATABASE_URL: "postgres://sentinel.invalid/must-not-reach-live-test",
          RUN_LIVE_MODEL_TESTS: "1",
        }),
      },
    );
    assert.match(`${stdout}\n${stderr}`, /pass 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ordinary wrapped app command retains its explicit database environment", async () => {
  const sentinel = "postgres://sentinel.invalid/ordinary-app";
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", "process.stdout.write(process.env.DATABASE_URL)"],
    { env: { ...process.env, DATABASE_URL: sentinel } },
  );
  assert.equal(childOutputAfterDatabaseDiagnostic(stdout), sentinel);
});
