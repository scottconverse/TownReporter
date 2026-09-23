import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobs } from "./ci-yaml.mjs";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";

/**
 * A test that can skip for a missing database is only honest if CI runs it
 * for real somewhere. It is easy to lose that guarantee quietly: rename a
 * file, retire a CI job, or trim a step during an unrelated cleanup, and the
 * test keeps passing everywhere -- forever green, because it is always
 * skipping. That is exactly how sign-in-throttle.test.ts, leave-desk.test.ts
 * and search-index.test.ts drifted before: each one grew its own hardcoded
 * `postgres://postgres@127.0.0.1:5433/postgres`, which is not reachable in
 * CI, so the properties they prove were only ever checked on one developer's
 * machine and nobody's pipeline said so.
 *
 * This does not hardcode a list of helpers or test filenames. It follows each
 * test's static local imports and finds any test that can reach a direct `pg`
 * import or reads `TEST_POSTGRES_ADMIN_URL`. It then checks that the test's
 * path appears inside a CI job whose environment provides that URL. A future
 * test using another helper or a direct `pg` import is covered automatically.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Every `src/**\/*.test.ts` file with statically discoverable Postgres capability. */
const dbSkippableTestFiles = () => postgresTestFiles(ROOT);

/**
 * Jobs whose env actually hands these tests a real connection to use.
 *
 * Matches the YAML key form (`TEST_POSTGRES_ADMIN_URL: <value>`), not a bare
 * substring -- a job's own leading comment block is attributed to whichever
 * job precedes it by this file's line-based `jobs()` split (see ci-yaml.mjs),
 * and prose that merely mentions the variable's name would otherwise credit
 * the wrong job with providing a database.
 */
function jobsThatProvideADatabase() {
  return Object.entries(jobs(ci))
    .filter(([, body]) => /TEST_POSTGRES_ADMIN_URL:\s*\S/.test(body.join("\n")))
    .map(([name]) => name);
}

test("every DB-skippable test file is run by a CI job that provides a database", () => {
  const files = dbSkippableTestFiles();
  assert.ok(
    files.length > 0,
    "found zero test files with statically discoverable Postgres capability -- this gate's own detection " +
      "is broken, or every Postgres-integration test has been deleted",
  );

  const dbJobs = jobsThatProvideADatabase();
  assert.ok(
    dbJobs.length > 0,
    "no CI job sets TEST_POSTGRES_ADMIN_URL -- nothing in .github/workflows/ci.yml gives these " +
      "tests a real database to run against",
  );

  const jobBodies = dbJobs.map((name) => jobs(ci)[name].join("\n"));
  const offenders = files.filter((f) => !jobBodies.some((body) => body.includes(f)));
  assert.deepEqual(
    offenders,
    [],
    `these test files can skip for a missing database but are not referenced by any CI job ` +
      `that provides one (checked: ${dbJobs.join(", ") || "none"}): ${offenders.join(", ")}`,
  );
});

test("database-test discovery follows a differently named helper down to direct pg capability", () => {
  const root = mkdtempSync(join(tmpdir(), "townreporter-pg-discovery-"));
  const lib = join(root, "src", "lib");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, "odd-helper.ts"), `export { Client as StrangeConnection } from "pg";\n`);
  writeFileSync(join(lib, "surprise.test.ts"), `import { StrangeConnection } from "./odd-helper.ts";\nvoid StrangeConnection;\n`);
  assert.deepEqual(postgresTestFiles(root), ["src/lib/surprise.test.ts"]);
});
