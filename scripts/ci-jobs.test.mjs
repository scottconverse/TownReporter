import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";
import { selectPostgresTests } from "./run-postgres-integration.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

test("the real-Postgres matrix uses the explicit runner for every discovered test", () => {
  const workflow = yaml.load(ci);
  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  const job = workflow.jobs["postgres-integration"];
  assert.equal(job.needs, "changes", "Postgres waits for the change filter, not other jobs");
  assert.equal(job.if, "needs.changes.outputs.run_db == 'true'", "Postgres runs only when the change filter sees database files");
  const changes = workflow.jobs["changes"];
  assert.ok(changes, "the change filter job must exist");
  assert.equal(Object.hasOwn(changes.outputs, "run_db"), true, "the change filter must publish the run_db output");
  assert.equal(changes.outputs.run_db, "${{ steps.pick.outputs.run_db }}", "run_db comes from the filter step's pick");
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job.strategy["max-parallel"], 4);
  assert.deepEqual(job.strategy.matrix.part, [1, 2, 3, 4]);
  assert.equal(job.env.TOWNREPORTER_POSTGRES_PART, "${{ matrix.part }}");
  assert.equal(job.env.TOWNREPORTER_POSTGRES_PARTS, "4");
  assert.equal(job.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION, "1");
  assert.ok(job.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL);
  assert.equal(Object.hasOwn(job.env, "TEST_POSTGRES_ADMIN_URL"), false);
  const runs = job.steps.filter(step => step.run);
  const integration = runs.filter(step => step.run === "node scripts/run-postgres-integration.mjs");
  assert.equal(integration.length, 1);
  assert.equal(integration[0].if, undefined, "every matrix part must execute its selection");
  assert.equal(runs.filter(step => step.run === "node scripts/migrate.mjs").length, 1);
  const benchmark = runs.filter(step => step.run === "node scripts/search-index-proof.mjs");
  assert.equal(benchmark.length, 1);
  assert.equal(benchmark[0].if, "matrix.part == 1");

  const discovered = postgresTestFiles(ROOT);
  const weights = JSON.parse(readFileSync(join(ROOT, "scripts/postgres-integration-weights.json"), "utf8"));
  const assigned = job.strategy.matrix.part.flatMap(part => selectPostgresTests(discovered, weights, [], {
    ...job.env, TOWNREPORTER_POSTGRES_PART: String(part),
  }));
  assert.deepEqual([...assigned].sort(), discovered);
  assert.equal(new Set(assigned).size, assigned.length);
  const names = job.strategy.matrix.part.map(part => job.name.replace("${{ matrix.part }}", String(part)));
  assert.equal(new Set(names).size, 4, "rulesets need four distinct check names");
});
