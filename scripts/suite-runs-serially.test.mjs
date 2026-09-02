import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The src test group must run one file at a time.
 *
 * A gate audit filed TEST-04: the full suite intermittently failed four files
 * with `RangeError: WebAssembly.Memory(): could not allocate memory`, every one
 * of them passing alone. The cause is not a bug in those tests -- it is several
 * of them standing up an embedded PGLite (a WebAssembly database) at once and
 * exhausting memory. A flake that fails for reasons unrelated to the code is
 * worse than a slow suite, because the next real failure gets read as noise and
 * waved through.
 *
 * The fix is `--test-concurrency=1` on the `src/**` group. This is the one
 * check in the repository that is legitimately about a command's SHAPE rather
 * than its behaviour, and the reason is honest: flakiness under memory pressure
 * cannot be reproduced deterministically on a machine that happens to have
 * memory free, so there is nothing to assert behaviourally. What CAN be held is
 * the configuration that prevents it -- the same way a CI-job-exists check
 * guards a thing you cannot run here. It is anchored to the real `test` script,
 * so a comment mentioning concurrency cannot satisfy it.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the src test group runs with concurrency 1", () => {
  const script = pkg.scripts?.test ?? "";
  assert.equal(script, "node scripts/run-tests-safe.mjs", "npm test must enter the safe launcher");
  const launcher = readFileSync(join(ROOT, "scripts/run-tests-safe.mjs"), "utf8");
  // The command that runs the strip-types src group, isolated from the scripts
  // group so a flag on the wrong half cannot pass this by accident. The safe
  // launcher holds the argv as an array instead of a shell command.
  const srcCommand = launcher.split("\n").find((line) => line.includes("experimental-strip-types"));
  assert.ok(
    srcCommand,
    `the 'test' script no longer runs the src group with strip-types; got: ${script}`,
  );
  assert.match(
    srcCommand,
    /--test-concurrency=1\b/,
    "the src group is not pinned to --test-concurrency=1; it will flake under " +
      "WASM memory pressure again (TEST-04). If you have made the tests safe to " +
      "run in parallel, delete this test in the same change and say why.",
  );
});
