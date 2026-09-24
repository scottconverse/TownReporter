#!/usr/bin/env node
/**
 * Prove the scan-refresh regression test catches the exact pre-fix merge.
 * The temporary fixture uses the historical first-seen-wins algorithm from
 * before 0984e9f and runs the real scan-history tests against it. No checkout
 * source is edited; this is a negative control for the assertions in CI.
 */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "townreporter-scan-refresh-old-merge-"));
const fixture = join(temp, "src");
const originalModule = join(repo, "src/lib/news/scan-history.ts");
const moduleCopy = join(fixture, "lib/news/scan-history.ts");
const testCopy = join(fixture, "lib/news/scan-history.test.ts");
const routeCopy = join(fixture, "routes/desk.scan.tsx");

const oldFunction = `export function accumulateScanPages<T extends { id: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const out = existing.slice();
  const seen = new Set(out.map((row) => row.id));
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}`;

try {
  mkdirSync(join(fixture, "lib/news"), { recursive: true });
  mkdirSync(join(fixture, "routes"), { recursive: true });
  cpSync(join(repo, "src/lib/news/scan-history.test.ts"), testCopy, { recursive: true });
  cpSync(join(repo, "src/routes/desk.scan.tsx"), routeCopy, { recursive: true });
  let source = readFileSync(originalModule, "utf8");
  const functionPattern = /export function accumulateScanPages[\s\S]*?\n}/;
  assert.match(source, functionPattern, "could not locate the production merge helper for mutation");
  source = source.replace(functionPattern, oldFunction);
  writeFileSync(moduleCopy, source, "utf8");

  // Pin the child's reporter. Node's default is chosen from the TTY: a pipe
  // gets TAP ("not ok 4", "# fail 4"), a terminal gets spec ("✖ ...",
  // "ℹ fail 4"). CI pipes the output, so the spec-shaped assertions below
  // passed on a dev machine and failed on the runner. Asking for spec
  // explicitly makes the format identical everywhere.
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-reporter=spec", testCopy],
    { cwd: repo, encoding: "utf8", timeout: 30_000 },
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.error, undefined, `mutation test process error: ${result.error?.message || ""}`);
  assert.notEqual(result.status, 0, "the exact old merge unexpectedly passed the regression tests");
  assert.match(output, /takes the newer values when the same run is refetched/);
  assert.match(output, /✖ takes the newer values when the same run is refetched/);
  assert.match(output, /ℹ fail [1-9]/);
  console.log("PASS: the historical first-seen-wins merge makes the real scan-history regression test fail");
  console.log(output.split(/\r?\n/).filter((line) => /not ok|fail [1-9]|ERR_ASSERTION/.test(line)).join("\n"));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
