import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobs } from "./ci-yaml.mjs";
import { postgresTestFiles, postgresTestsMissingFromCi } from "./postgres-test-discovery.mjs";

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
 * This does not hardcode a list of helpers or test filenames. It parses test
 * imports and follows their local static and dynamic import graph, then checks
 * test source itself for dynamic `import("pg")`, `require("pg")`, or use of
 * `TEST_POSTGRES_ADMIN_URL`. The resulting paths must run through the
 * explicit PostgreSQL integration runner in a CI job with its separate opt-in.
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
    .filter(([, body]) => {
      const lines = body.map((line) => line.split("#", 1)[0]).filter((line) => line.trim());
      return lines.some((line) => /^\s*TOWNREPORTER_RUN_POSTGRES_INTEGRATION:\s*["']?1["']?\s*$/.test(line)) &&
        lines.some((line) => /^\s*TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL:\s*\S/.test(line));
    })
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

  const offenders = postgresTestsMissingFromCi(files, ci);
  assert.deepEqual(
    offenders,
    [],
    `these test files can skip for a missing database but are not referenced by any CI job ` +
      `that provides one (checked: ${dbJobs.join(", ") || "none"}): ${offenders.join(", ")}`,
  );
});

test("database discovery catches static helper imports and direct dynamic pg imports, then fails on CI omission", () => {
  const root = mkdtempSync(join(tmpdir(), "townreporter-pg-discovery-"));
  const lib = join(root, "src", "lib");
  mkdirSync(lib, { recursive: true });
  try {
    writeFileSync(join(lib, "odd-helper.ts"), `export { Client as StrangeConnection } from "pg";\n`);
    writeFileSync(join(lib, "transitive.test.ts"), `import { StrangeConnection } from "./odd-helper.ts";\nvoid StrangeConnection;\n`);
    writeFileSync(join(lib, "dynamic-local.test.ts"), `const helper = await import("./odd-helper.ts");\nvoid helper;\n`);
    writeFileSync(join(lib, "dynamic.test.ts"), `const driver = await import("pg");\nvoid driver;\n`);
    const files = postgresTestFiles(root);
    assert.deepEqual(files, ["src/lib/dynamic-local.test.ts", "src/lib/dynamic.test.ts", "src/lib/transitive.test.ts"]);

    const ciThatListsOnlyOne = `jobs:\n  postgres-integration:\n    env:\n      TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1"\n      TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: postgres://postgres:ci@127.0.0.1/postgres\n    steps:\n      - name: Run one database test\n        run: |\n          node --test src/lib/transitive.test.ts\n`;
    assert.deepEqual(postgresTestsMissingFromCi(files, ciThatListsOnlyOne), ["src/lib/dynamic-local.test.ts", "src/lib/dynamic.test.ts"]);

    const ciWithDiscoveredRunner = `jobs:\n  postgres-integration:\n    env:\n      TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1"\n      TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: postgres://postgres:ci@127.0.0.1/postgres\n    steps:\n      - name: Run all discovered database tests\n        run: node scripts/run-postgres-integration.mjs\n`;
    assert.deepEqual(postgresTestsMissingFromCi(files, ciWithDiscoveredRunner), []);

    const ciThatOnlyMentionsRunnerInComments = `jobs:\n  postgres-integration:\n    env:\n      # TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1"\n      # TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: postgres://postgres:ci@127.0.0.1/postgres\n    steps:\n      # run: node scripts/run-postgres-integration.mjs\n`;
    assert.deepEqual(postgresTestsMissingFromCi(files, ciThatOnlyMentionsRunnerInComments), files);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
