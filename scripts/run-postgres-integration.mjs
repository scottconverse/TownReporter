#!/usr/bin/env node
/**
 * Explicit entry point for real-Postgres tests. Unlike the ordinary suite,
 * this runner first sanitizes the environment, then a later preload restores
 * the admin URL only after the ordinary test guard has executed.
 *
 * Usage (PowerShell):
 *   $env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION='1'
 *   $env:TEST_POSTGRES_ADMIN_URL='postgres://...@127.0.0.1:5432/postgres'
 *   node scripts/run-postgres-integration.mjs
 *   Remove-Item Env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION,Env:TEST_POSTGRES_ADMIN_URL
 *
 * Optional positional args select a subset of discovered DB-capable tests.
 * Alternatively, TOWNREPORTER_POSTGRES_PART=2 and TOWNREPORTER_POSTGRES_PARTS=4
 * select one part, balanced by measured seconds in postgres-integration-weights.json.
 * With neither selector set, this runs the complete discovered set.
 * For an interrupted process's leftover scratch database, use the exact-name
 * recovery procedure in docs/postgres-integration-testing.md.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_POSTGRES_PORT, targetsLivePostgres } from "../ops/lib-postgres-url.mjs";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";
import { safeTestEnvironment } from "./test-environment.mjs";

export function parsePostgresPart(env = process.env) {
  const index = (env.TOWNREPORTER_POSTGRES_PART ?? "").trim();
  const total = (env.TOWNREPORTER_POSTGRES_PARTS ?? "").trim();
  if (!index && !total) return null;
  if (!index || !total) {
    throw new Error("TOWNREPORTER_POSTGRES_PART and TOWNREPORTER_POSTGRES_PARTS must be set together; a half-set selector could silently omit tests.");
  }
  const wholeNumber = (name, raw) => {
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive whole number, not "${raw}".`);
    }
    return value;
  };
  const part = {
    index: wholeNumber("TOWNREPORTER_POSTGRES_PART", index),
    total: wholeNumber("TOWNREPORTER_POSTGRES_PARTS", total),
  };
  if (part.index > part.total) {
    throw new Error(`TOWNREPORTER_POSTGRES_PART must be between 1 and TOWNREPORTER_POSTGRES_PARTS (${part.total}), not ${part.index}.`);
  }
  return part;
}

/** Longest processing time first; ties use file path, then lowest part number. */
export function partitionPostgresTests(files, weights, total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > files.length) {
    throw new Error("PostgreSQL parts must be a positive whole number no greater than the discovered file count; refusing an empty part.");
  }
  const times = Object.values(weights).sort((a, b) => a - b);
  if (!times.length || times.some(time => !Number.isFinite(time) || time <= 0)) {
    throw new Error("PostgreSQL weights must contain positive measured seconds so unmeasured files can use the median.");
  }
  const median = (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2;
  const weightedFiles = files.map(file => ({ file, seconds: Object.hasOwn(weights, file) ? weights[file] : median }));
  weightedFiles.sort((a, b) => b.seconds - a.seconds || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const parts = Array.from({ length: total }, () => ({ files: [], seconds: 0 }));
  for (const { file, seconds } of weightedFiles) {
    const lightest = parts.reduce((best, part) => part.seconds < best.seconds ? part : best);
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  return parts;
}

export function selectPostgresTests(discovered, weights, requested = [], env = process.env) {
  const part = parsePostgresPart(env);
  if (part && requested.length) {
    throw new Error("Use either a PostgreSQL part selector or positional test paths, not both.");
  }
  if (part) return partitionPostgresTests(discovered, weights, part.total)[part.index - 1].files;
  const files = (requested.length ? requested : discovered).map(file => file.replace(/\\/g, "/"));
  const unknown = files.filter(file => !discovered.includes(file));
  if (unknown.length) throw new Error(`Requested tests are not in PostgreSQL discovery: ${unknown.join(", ")}`);
  if (new Set(files).size !== files.length) throw new Error("Duplicate test paths are not allowed.");
  return files;
}

export function parseTapSummary(output) {
  const number = (name) => {
    const match = new RegExp(`^# ${name} (\\d+)$`, "m").exec(output);
    return match ? Number(match[1]) : null;
  };
  return {
    tests: number("tests"),
    pass: number("pass"),
    fail: number("fail"),
    skipped: number("skipped"),
    todo: number("todo"),
  };
}

export function assertPassingIntegrationSummary(summary, file = "PostgreSQL integration") {
  if (summary.tests === null || summary.tests < 1 || summary.pass === null || summary.pass < 1 || summary.fail !== 0) {
    throw new Error(
      `${file} did not produce a passing nonzero test run ` +
      `(tests=${summary.tests}, pass=${summary.pass}, fail=${summary.fail}, skipped=${summary.skipped}).`,
    );
  }
  return summary;
}

function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function endpointLabel(value) {
  const url = new URL(value);
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

function runFile(file, env, root, index, total) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`[postgres-integration] RUN ${index}/${total} ${file}`);
    const child = spawn(process.execPath, [
      "--import", new URL("./test-environment-guard.mjs", import.meta.url).href,
      "--import", new URL("./postgres-integration-opt-in.mjs", import.meta.url).href,
      // Loaded last, so the opt-in preload above has already decided what this
      // process is allowed to be; the seal only ever narrows.
      "--import", new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href,
      // The same migrated PGlite the unit runner gives every file. Without it a test that does not make its own
      // database ran on an EMPTY schema, which only passed while ensureSchemaOnce swallowed the missing tables.
      "--import", new URL("../src/lib/test-support/pglite-migrations.ts", import.meta.url).href,
      "--experimental-strip-types", "--test", "--test-reporter=tap", file,
    ], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      const summary = parseTapSummary(output);
      if (code !== 0 || signal) {
        rejectRun(new Error(`[postgres-integration] ${file} exited ${code ?? signal ?? "unknown"}.`));
        return;
      }
      try {
        resolveRun(assertPassingIntegrationSummary(summary, file));
      } catch (error) {
        rejectRun(error);
      }
    });
  });
}

async function main() {
  const root = projectRoot();
  const discovered = postgresTestFiles(root);
  if (!discovered.length) throw new Error("Discovered zero PostgreSQL-capable test files; refusing a vacuous pass.");
  if (process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION !== "1") {
    throw new Error("Set TOWNREPORTER_RUN_POSTGRES_INTEGRATION=1 to run real-Postgres integration tests.");
  }
  const requestedAdminUrl = process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL?.trim() ||
    process.env.TEST_POSTGRES_ADMIN_URL?.trim();
  if (!requestedAdminUrl) throw new Error("Set TEST_POSTGRES_ADMIN_URL to a disposable local/CI Postgres admin database.");

  // The lane's own guard, before anything is spawned. The same rule as the
  // late preload in postgres-integration-opt-in.mjs, deliberately: this one
  // stops the run early, that one is the last line of defence, and both read
  // the port through ops\lib-postgres-url.mjs so they cannot disagree.
  if (targetsLivePostgres(requestedAdminUrl)) {
    throw new Error(
      `Refusing a PostgreSQL integration admin URL on port ${LIVE_POSTGRES_PORT}: that is the live paper's ` +
        "database on the machine that runs it, and this lane creates and drops databases. Point " +
        "TEST_POSTGRES_ADMIN_URL at a throwaway server.",
    );
  }
  let target;
  try {
    target = new URL(requestedAdminUrl);
  } catch {
    throw new Error("TEST_POSTGRES_ADMIN_URL is not a valid URL.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol) ||
      !["127.0.0.1", "localhost", "[::1]", "postgres"].includes(target.hostname) ||
      !["/postgres", "/townreporter_dev"].includes(target.pathname) || target.search || target.hash) {
    throw new Error("Refusing a non-local or unexpected PostgreSQL admin target; use loopback/CI Postgres and `/postgres` or `/townreporter_dev`.");
  }

  const weights = JSON.parse(readFileSync(new URL("./postgres-integration-weights.json", import.meta.url), "utf8"));
  const files = selectPostgresTests(discovered, weights, process.argv.slice(2));
  const part = parsePostgresPart();

  const env = safeTestEnvironment({
    ...process.env,
    TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1",
    TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: requestedAdminUrl,
  });
  env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION = "1";
  env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL = requestedAdminUrl;
  // This launcher starts a fresh node --test process per file. An inherited
  // node:test context would make Node silently decline that fresh run as recursive.
  delete env.NODE_TEST_CONTEXT;
  console.log(`[postgres-integration] discovered=${discovered.length}; selected=${files.length}; part=${part ? `${part.index}/${part.total}` : "all"}; target=${endpointLabel(requestedAdminUrl)}`);
  let testCount = 0;
  let passCount = 0;
  let skipCount = 0;
  let todoCount = 0;
  for (let index = 0; index < files.length; index += 1) {
    const summary = await runFile(files[index], env, root, index + 1, files.length);
    testCount += summary.tests;
    passCount += summary.pass;
    skipCount += summary.skipped ?? 0;
    todoCount += summary.todo ?? 0;
  }
  if (!testCount || !passCount || passCount + skipCount + todoCount !== testCount) {
    throw new Error(`Unexpected aggregate test accounting: tests=${testCount}, pass=${passCount}, skipped=${skipCount}, todo=${todoCount}.`);
  }
  console.log(`[postgres-integration] PASS executed=${files.length}/${files.length} files; tests=${testCount}; passed=${passCount}; skipped=${skipCount}; todo=${todoCount}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
