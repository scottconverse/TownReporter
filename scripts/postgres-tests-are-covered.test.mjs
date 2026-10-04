import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
