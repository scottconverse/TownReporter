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
 * Optional positional args select a subset of discovered DB-capable tests;
 * CI omits args and therefore runs the complete discovered set.
 * For an interrupted process's leftover scratch database, use the exact-name
 * recovery procedure in docs/postgres-integration-testing.md.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";
import { safeTestEnvironment } from "./test-environment.mjs";

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

  const selected = process.argv.slice(2).length ? process.argv.slice(2) : discovered;
  const unknown = selected.filter((file) => !discovered.includes(file.replace(/\\/g, "/")));
  if (unknown.length) throw new Error(`Requested tests are not in PostgreSQL discovery: ${unknown.join(", ")}`);
  const files = selected.map((file) => file.replace(/\\/g, "/"));
  if (new Set(files).size !== files.length) throw new Error("Duplicate test paths are not allowed.");

  const env = safeTestEnvironment({
    ...process.env,
    TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1",
    TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: requestedAdminUrl,
  });
  env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION = "1";
  env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL = requestedAdminUrl;
  console.log(`[postgres-integration] discovered=${discovered.length}; selected=${files.length}; target=${endpointLabel(requestedAdminUrl)}`);
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
