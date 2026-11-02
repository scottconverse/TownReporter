#!/usr/bin/env node
/**
 * Fast tests for one change: run only the tests that reach the files you
 * changed, including the real-Postgres tests that `npm test` skips.
 *
 * Scott asked for this on Nov 1 2026 (Plan B): a fix should be checked in
 * minutes, and no test that covers the change may be left out. A test
 * "reaches" a file when it imports it (directly or through other files), or
 * when its text names the file (tests that read a script or a .ps1 by path).
 *
 *   node scripts/test-changed.mjs                 # changes since origin/main, plus uncommitted ones
 *   node scripts/test-changed.mjs --base <ref>    # changes since another ref
 *   node scripts/test-changed.mjs --list          # print the plan, run nothing
 *   node scripts/test-changed.mjs --no-postgres   # skip the Postgres group (said loudly)
 *
 * The Postgres group needs a throwaway server. Set TEST_POSTGRES_ADMIN_URL
 * (for example postgres://postgres@127.0.0.1:5549/postgres). The live
 * database port is refused by scripts/run-postgres-integration.mjs.
 * If Postgres tests reach the change and no URL is set, this run FAILS
 * instead of skipping them quietly.
 *
 * Browser scripts (scripts/*.mjs that use Playwright) need a running server,
 * so they are listed, not run. The list says which ones reach the change.
 *
 * Exit code: 0 all ran and passed, 1 a test failed, 3 a needed group could not run.
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { localImportsOf, postgresTestFiles } from "./postgres-test-discovery.mjs";
import { safeTestEnvironment } from "./test-environment.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const noPostgres = args.includes("--no-postgres");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";

const rel = (abs) => relative(root, abs).split("\\").join("/");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean);

/** Files whose change can move every test: run the whole suite (or CI) instead. */
const WIDE = [/^migrations\//, /^package(-lock)?\.json$/, /^tsconfig.*\.json$/, /^src\/lib\/test-support\//,
  /^scripts\/(run-tests-safe|test-environment|test-environment-guard|run-postgres-integration|postgres-integration-opt-in)\.mjs$/];

export function changedFiles() {
  const mergeBase = git("merge-base", base, "HEAD")[0];
  return [...new Set([
    ...git("diff", "--name-only", mergeBase),
    ...git("ls-files", "--others", "--exclude-standard"),
  ])].sort();
}

/** Map each test file to the changed files it reaches. */
export function plan(changed) {
  // Tracked files plus new ones not yet added, so a brand-new test is not missed.
  const code = [...new Set([
    ...git("ls-files", "src", "scripts"),
    ...git("ls-files", "--others", "--exclude-standard", "src", "scripts"),
  ])].filter((f) => /\.(ts|tsx|mjs)$/.test(f));
  const isTest = (f) => /^src\/.*\.test\.ts$/.test(f) || /^scripts\/.*\.test\.mjs$/.test(f);
  const tests = code.filter(isTest);
  const changedSet = new Set(changed);

  // Reverse import graph: file -> files that import it.
  const importedBy = new Map();
  for (const file of code) {
    for (const dep of localImportsOf(join(root, file), root)) {
      const key = rel(dep);
      if (!importedBy.has(key)) importedBy.set(key, new Set());
      importedBy.get(key).add(file);
    }
  }
  // Everything that reaches a changed file through imports.
  const reach = new Map(); // file -> Set(changed file)
  for (const start of changed) {
    const queue = [start];
    const seen = new Set(queue);
    while (queue.length) {
      const file = queue.shift();
      if (!reach.has(file)) reach.set(file, new Set());
      reach.get(file).add(start);
      for (const parent of importedBy.get(file) ?? []) {
        if (!seen.has(parent)) { seen.add(parent); queue.push(parent); }
      }
    }
  }
  // Tests that name a changed file in their text (they read it by path).
  const named = changed.filter((f) => !/^index\.|^README/i.test(basename(f)));
  for (const test of tests) {
    const text = readFileSync(join(root, test), "utf8");
    for (const f of named) {
      if (text.includes(basename(f))) {
        if (!reach.has(test)) reach.set(test, new Set());
        reach.get(test).add(f);
      }
    }
  }

  const hit = tests.filter((t) => reach.has(t) || changedSet.has(t));
  const pg = new Set(postgresTestFiles(root));
  const browser = code.filter((f) => /^scripts\/[^/]+\.mjs$/.test(f) && !isTest(f) && reach.has(f) &&
    /from ["']playwright["']/.test(readFileSync(join(root, f), "utf8")));
  return {
    wide: changed.filter((f) => WIDE.some((re) => re.test(f))),
    scripts: hit.filter((t) => t.startsWith("scripts/")),
    // Postgres tests skip in the unit run; they run once, in their own group.
    unit: hit.filter((t) => t.startsWith("src/") && !pg.has(t)),
    postgres: hit.filter((t) => pg.has(t)),
    browser,
    why: (t) => [...(reach.get(t) ?? [t])].slice(0, 3).join(", "),
  };
}

function run(label, argv, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n=== ${label} ===`);
    const child = spawn(process.execPath, argv, { cwd: root, env, stdio: "inherit", windowsHide: true });
    child.once("exit", (code) => resolve({ label, code: code ?? 1, seconds: Math.round((Date.now() - t0) / 1000) }));
  });
}

async function main() {
  const started = Date.now();
  const changed = changedFiles();
  const p = plan(changed);
  console.log(`Changed since ${base}: ${changed.length} file(s)`);
  for (const f of changed) console.log(`  ${f}`);
  if (p.wide.length) {
    console.log(`\nWIDE CHANGE: ${p.wide.join(", ")} can move every test. Run \`npm test\` and the full CI, not only this list.`);
  }
  const show = (name, list) => {
    console.log(`\n${name}: ${list.length}`);
    for (const t of list) console.log(`  ${t}   <- ${p.why(t)}`);
  };
  show("Script tests", p.scripts);
  show("Unit tests (src)", p.unit);
  show("Postgres tests (real database)", p.postgres);
  show("Browser scripts that reach the change (NOT RUN here: they need a running server)", p.browser);
  if (listOnly) return 0;

  const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;
  const seal = new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href;
  const migrations = new URL("../src/lib/test-support/pglite-migrations.ts", import.meta.url).href;
  const results = [];
  if (p.scripts.length) {
    results.push(await run("Script tests", ["--import", guard, "--test", "--import", seal, ...p.scripts], safeTestEnvironment()));
  }
  if (p.unit.length) {
    results.push(await run("Unit tests", ["--import", guard, "--experimental-strip-types", "--test", "--test-concurrency=1",
      "--import", seal, "--import", migrations, ...p.unit], safeTestEnvironment()));
  }
  let blocked = false;
  if (p.postgres.length) {
    const admin = process.env.TEST_POSTGRES_ADMIN_URL || process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL || "";
    if (noPostgres) {
      console.log(`\nPOSTGRES SKIPPED (--no-postgres): ${p.postgres.length} test file(s) reach this change and did NOT run.`);
      blocked = true;
    } else if (!admin) {
      console.log(`\nPOSTGRES NOT RUN: ${p.postgres.length} test file(s) reach this change. Set TEST_POSTGRES_ADMIN_URL to a throwaway server.`);
      blocked = true;
    } else {
      results.push(await run("Postgres tests", [join(root, "scripts", "run-postgres-integration.mjs"), ...p.postgres], {
        ...process.env,
        TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1",
        TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: admin,
      }));
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\n=== Summary (${seconds} s) ===`);
  for (const r of results) console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.label} (${r.seconds} s)`);
  if (blocked) console.log("  NOT RUN  Postgres tests (see above)");
  if (p.browser.length) console.log(`  NOT RUN  ${p.browser.length} browser script(s): ${p.browser.join(", ")}`);
  if (p.wide.length) console.log("  WIDE CHANGE: run the full suite too");
  if (results.some((r) => r.code !== 0)) return 1;
  return blocked ? 3 : 0;
}

if (normalize(process.argv[1] ?? "") === normalize(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
