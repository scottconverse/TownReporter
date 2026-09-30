import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  XAI_REMOVED_WARNING,
  parseDotEnv,
  projectRoot,
  readDotEnv,
  xaiRemovedWarning,
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

/**
 * The diagnostic line plus whatever the child command printed.
 *
 * The wrapper's own WARNING lines are dropped: they depend on the AMBIENT
 * environment (an operator's `XAI_API_KEY` must not change what these tests
 * assert about the child's output), and the warning has its own tests below.
 */
function childOutputAfterDatabaseDiagnostic(stdout) {
  const [diagnostic, ...childOutput] = stdout.split("\n");
  assert.match(diagnostic, /^\[with-app-env\] DATABASE_URL (?:-> |is set but unparseable|unset )/);
  return childOutput.filter((line) => !line.startsWith("[with-app-env] WARNING:")).join("\n");
}

function environmentOutsideNodeTestRunner(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** A workspace with the `.env` the wrapper merges, or none when absent. */
function makeWorkspace(dotEnvText) {
  const root = mkdtempSync(join(tmpdir(), "app-env-"));
  if (dotEnvText !== undefined) writeFileSync(join(root, ".env"), dotEnvText);
  return root;
}

test("parses KEY=value, strips quotes, skips comments and blanks", () => {
  assert.deepEqual(parseDotEnv('A=1\n# B=2\n\nC="three"\nD=\'four\'\nE=\n'), {
    A: "1",
    C: "three",
    D: "four",
    E: "",
  });
});

test("a missing .env is a clean no-op", () => {
  assert.deepEqual(readDotEnv(makeWorkspace()), {});
});

test("reads the environment from a workspace .env", () => {
  const root = makeWorkspace("VITE_AUTH_ENABLED=false\nDATABASE_URL=postgres://x\n");
  assert.deepEqual(readDotEnv(root), {
    VITE_AUTH_ENABLED: "false",
    DATABASE_URL: "postgres://x",
  });
});

test("this app's tracked env template does not switch sign-in off", () => {
  // `VITE_AUTH_ENABLED=false` is the documented off-switch and the only one.
  // The template ships it commented out, so a fresh install has sign-in on.
  assert.equal(readDotEnv(projectRoot()).VITE_AUTH_ENABLED, undefined);
  const template = parseDotEnv(readFileSync(join(projectRoot(), ".env.example"), "utf8"));
  assert.equal(template.VITE_AUTH_ENABLED, undefined);
});

test("the wrapped command reports its database and inherits the workspace .env", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    WRAPPER,
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  // The wrapper merges `.env` under `process.env`, so an explicit override in
  // the caller's environment wins over the file. Nothing in this checkout sets
  // the flag, so a run reaches the child without one.
  const expected =
    process.env.VITE_AUTH_ENABLED ?? readDotEnv(projectRoot()).VITE_AUTH_ENABLED ?? "undefined";
  assert.equal(childOutputAfterDatabaseDiagnostic(stdout), expected);
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

/*
  GR-C removed Grok (xAI) as a provider. An install whose only writing model was
  `XAI_API_KEY` loses it, so the desk has to say so at start-up rather than
  silently refusing to draft. These three tests own the sentence, the trigger,
  and the fact that it reaches stdout (the production start script dies on the
  first byte of native stderr -- see the comment in with-app-env.mjs).
*/
test("warns when XAI_API_KEY or GROK_API_KEY is set, and stays quiet otherwise", () => {
  assert.equal(xaiRemovedWarning({}), null);
  assert.equal(xaiRemovedWarning({ XAI_API_KEY: "" }), null, "an empty value is not set");
  assert.equal(xaiRemovedWarning({ XAI_API_KEY: "xai-test" }), XAI_REMOVED_WARNING);
  assert.equal(xaiRemovedWarning({ GROK_API_KEY: "grok-test" }), XAI_REMOVED_WARNING);
  assert.match(XAI_REMOVED_WARNING, /no longer supported/);
  assert.match(XAI_REMOVED_WARNING, /XAI_API_KEY is ignored/);
  assert.match(XAI_REMOVED_WARNING, /Models screen/);
});

test("the wrapper prints the xAI removal warning for a command that starts the app", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", "0"],
    {
      env: environmentOutsideNodeTestRunner({
        XAI_API_KEY: "xai-test",
        DATABASE_URL: "postgres://sentinel.invalid/xai-warning",
      }),
    },
  );
  assert.match(stdout, /^\[with-app-env\] DATABASE_URL -> sentinel\.invalid:5432/);
  assert.ok(
    stdout.split("\n").includes(`[with-app-env] WARNING: ${XAI_REMOVED_WARNING}`),
    `the warning must be on stdout; got:\n${stdout}`,
  );
});

test("the wrapper prints no warning for an install that has no xAI key", async () => {
  const env = environmentOutsideNodeTestRunner({ DATABASE_URL: "postgres://sentinel.invalid/quiet" });
  delete env.XAI_API_KEY;
  delete env.GROK_API_KEY;
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", "0"],
    { env },
  );
  assert.doesNotMatch(stdout, /WARNING/);
});
