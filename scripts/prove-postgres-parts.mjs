#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";
import { selectPostgresTests } from "./run-postgres-integration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "origin/main";
const output = resolve(process.argv[3] || "docs/pg-split-evidence");
const baseCommit = execFileSync("git", ["rev-parse", base], { cwd: root, encoding: "utf8" }).trim();
// The old runner uses postgresTestFiles(root) when no positional paths are
// supplied. Load that exact committed discovery implementation, beside its
// original dependencies; do not use the split runner as the coverage baseline.
const baselineModule = join(root, "scripts", `.pg-baseline-${randomUUID()}.mjs`);
let oldFiles;
try {
  writeFileSync(baselineModule, execFileSync("git", ["show", `${baseCommit}:scripts/postgres-test-discovery.mjs`], { cwd: root }));
  const baseline = await import(pathToFileURL(baselineModule).href);
  oldFiles = baseline.postgresTestFiles(root);
} finally {
  unlinkSync(baselineModule);
}
const weights = JSON.parse(readFileSync(join(root, "scripts/postgres-integration-weights.json"), "utf8"));
const select = files => Array.from({ length: 4 }, (_, index) => selectPostgresTests(files, weights, [], {
  TOWNREPORTER_POSTGRES_PART: String(index + 1), TOWNREPORTER_POSTGRES_PARTS: "4",
}));
const parts = select(postgresTestFiles(root));
const union = parts.flat().sort();
assert.equal(new Set(union).size, union.length, "a file runs in more than one part");
assert.deepEqual(union, oldFiles, "old lane and split lane differ");

const probeFile = `src/lib/pg-split-unlisted-${randomUUID()}.test.ts`;
const probePath = join(root, probeFile);
let probe;
try {
  writeFileSync(probePath, 'import test from "node:test";\nimport pg from "pg";\ntest("unlisted discovery probe", () => { if (!pg.Client) throw new Error("missing pg"); });\n');
  assert.equal(Object.hasOwn(weights, probeFile), false);
  const discovered = postgresTestFiles(root);
  assert.ok(discovered.includes(probeFile), "new file was not discovered");
  const withProbe = select(discovered);
  const assigned = withProbe.flat();
  assert.deepEqual([...assigned].sort(), discovered);
  assert.equal(new Set(assigned).size, assigned.length);
  const assignedParts = withProbe.flatMap((files, index) => files.includes(probeFile) ? [index + 1] : []);
  assert.equal(assignedParts.length, 1, "new unlisted file must run exactly once");
  probe = { file: probeFile, listedInWeights: false, discovered: true, assignedParts };
  console.log(`Unlisted throwaway file selected in part ${assignedParts[0]}: ${probeFile}`);
} finally {
  unlinkSync(probePath);
}
assert.deepEqual(postgresTestFiles(root), oldFiles, "throwaway file was not removed cleanly");
probe.removed = true;
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "old-lane.txt"), oldFiles.join("\n") + "\n");
writeFileSync(join(output, "four-part-union.txt"), union.join("\n") + "\n");
writeFileSync(join(output, "parts.json"), JSON.stringify({ baseCommit, files: oldFiles.length, parts, equal: true, duplicates: 0 }, null, 2) + "\n");
writeFileSync(join(output, "new-file-probe.json"), JSON.stringify(probe, null, 2) + "\n");
console.log(`Coverage PASS: old=${oldFiles.length}; union=${union.length}; duplicates=0; parts=${parts.map(files => files.length).join("/")}; base=${baseCommit}`);
console.log(`Evidence: ${output}`);
