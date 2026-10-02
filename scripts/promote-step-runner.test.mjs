import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, openSync, closeSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { copyDatabaseName, isCopyOf, parseCopyStamp } from "../ops/lib-promote-db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPS = join(ROOT, "ops");
const onWindows = process.platform === "win32";
const windowsOnly = { skip: !onWindows ? "the promotion step runner is Windows PowerShell" : false };

/**
 * ops\promote.ps1 died three times on the live machine -- twice at `npm ci`,
 * once at `npm run build` -- and left no evidence of why. Each time it had
 * already backed up, stopped the paper and fast-forwarded the checkout, so the
 * paper stayed down until somebody finished the job by hand. Every one of
 * those runs was started from an agent's shell tool rather than a scheduled
 * task, and that script wrote no log of its own.
 *
 * These tests run the real step runner (ops\lib-promote.ps1) and the real
 * build-with-fallback decision against fake npm, fake git output and a fake
 * start, in a throwaway directory. Nothing here touches a real port, a real
 * service, a real database or a scheduled task, and `npm` itself is only ever
 * a batch file this file writes.
 *
 * The one thing a fake cannot do is prove what kills a real `npm ci`. So the
 * second test does the killing for real: a 20-second child, and a launcher
 * whose stdout pipe is closed out from under it. See the header of
 * ops\lib-promote.ps1 for the mechanism, and for why $process.ExitCode cannot
 * be trusted on this platform.
 *
 * Runs on Windows only for the parts that execute PowerShell; the file is
 * discovered by `npm test` (scripts/**\/*.test.mjs) everywhere, and the
 * Windows CI job windows-watchdog-recovery runs it for real.
 */

/**
 * A fake `npm`, in four modes:
 *
 *   (unset)      ci, and anything else -- succeeds.
 *   buildfail    deletes .output (what a build that dies part way through
 *                leaves behind) and exits 1, having never reached the
 *                migration.
 *   migratefail  reaches the migration -- its own "[migrate] applied ..." line
 *                is in the output -- and then exits 1.
 *   hang         never returns, which is the step a promotion cannot afford:
 *                the paper is down while it runs.
 *
 * Written without parenthesised blocks on purpose: a batch `if (...)` block
 * parses its whole body up front, and this file has enough ways to go wrong
 * already.
 */
function fakeNpm(hangChildPath) {
  return [
    "@echo off",
    "if \"%FAKE_NPM_MODE%\"==\"hang\" goto hang",
    "if \"%FAKE_NPM_MODE%\"==\"migratefail\" goto migratefail",
    "if not \"%FAKE_NPM_MODE%\"==\"buildfail\" goto ok",
    "echo [fake npm] vite build starting",
    "rmdir /s /q .output",
    "echo [fake npm] the build exploded 1>&2",
    "exit /b 1",
    ":hang",
    "echo [fake npm] hanging on purpose",
    `node "${hangChildPath}" 60000`,
    "exit /b 0",
    ":migratefail",
    "echo [fake npm] the bundle is built",
    "echo [migrate] applied 0116_source_retry_after.sql",
    "echo [fake npm] the next migration exploded 1>&2",
    "exit /b 1",
    ":ok",
    "echo [fake npm] %*",
    "exit /b 0",
    "",
  ].join("\r\n");
}

/**
 * A fake `node`, standing in for ops\lib-promote-db.mjs (unit PR2).
 *
 * The promotion runs the database library as `node "<ops>\lib-promote-db.mjs"
 * <command>`, and this is what runs instead in these tests. It is a fake of the
 * LIBRARY, not of the ordering: the functions under test --
 * Invoke-PromoteDatabaseCopy, Invoke-PromoteDatabaseSwapBack and the recovery
 * that drives them -- are the real ones, and what they do with the answer is
 * what these tests are about. The real library is covered against a real
 * Postgres in src\lib\ops\promote-db.postgres.test.ts.
 *
 * Anything that is not one of the library's commands is handed to the real
 * node, because the same PATH runs the fake npm's hung child.
 *
 *   FAKE_DB_LOG   one line per command, in order, with the names it was given
 *   FAKE_DB_DIR   holds <command>.json: the answer to print
 *   FAKE_DB_EXIT  the exit code to leave behind (unset = 0)
 */
function fakeNode() {
  const commands = ["names", "preflight", "copy", "wait-for-zero", "swap-back", "rollback", "state"];
  return [
    "@echo off",
    ...commands.map((name) => `if "%2"=="${name}" goto db`),
    `"${process.execPath}" %*`,
    "exit /b %ERRORLEVEL%",
    ":db",
    // The command, then the names it was handed. The promotion's own log
    // records the command line; this is what proves the NAMES reached the
    // library through the environment, and never on the command line.
    "echo db %2 >> \"%FAKE_DB_LOG%\"",
    "echo env %PROMOTE_DB_DATABASE% %PROMOTE_DB_COPY% %PROMOTE_DB_FAILED% %PROMOTE_DB_STAMP% >> \"%FAKE_DB_LOG%\"",
    `if exist "%FAKE_DB_DIR%\\%2.json" type "%FAKE_DB_DIR%\\%2.json"`,
    "exit /b %FAKE_DB_EXIT%",
    "",
  ].join("\r\n");
}

/**
 * A child that will not finish on its own, and says so out loud.
 *
 * It writes its own PID the moment it starts, so a test can ask the operating
 * system whether it is still there rather than believing a log line; and it
 * writes a second file only if it ever reaches its end, so "was it actually
 * killed, or did it just take a while" is answerable too.
 */
const HANG_CHILD = [
  'import { writeFileSync } from "node:fs";',
  "const ms = Number(process.argv[2] ?? 60000);",
  "const t0 = Date.now();",
  'writeFileSync("hang-child-pid.txt", String(process.pid));',
  "setTimeout(() => {",
  '  writeFileSync("hang-child-survived.txt", `survived ${Date.now() - t0}ms\\n`);',
  "  process.exit(0);",
  "}, ms);",
  "",
].join("\n");

/**
 * The stand-in for npm at its chattiest: half a kilobyte ten times a second
 * for twenty seconds, then a file saying it got to the end.
 *
 * The steady writing is the point. It is what npm ci and vite build do, and it
 * is what makes the broken-pipe death reproducible: a single small write fits
 * in the pipe buffer and survives, so a short step can look perfectly healthy
 * while a long one dies.
 */
const SLOW_CHILD = [
  'import { writeFileSync } from "node:fs";',
  "const ms = Number(process.argv[2] ?? 20000);",
  "const t0 = Date.now();",
  "const ticker = setInterval(() => { process.stdout.write(\"x\".repeat(499) + \"\\n\"); }, 50);",
  "setTimeout(() => {",
  "  clearInterval(ticker);",
  '  writeFileSync("slow-done.txt", `completed after ${Date.now() - t0}ms\\n`);',
  "  process.exit(0);",
  "}, ms);",
  "",
].join("\n");

/** A throwaway install: a logs\ directory, and a .output that already works. */
function makeInstall() {
  const root = mkdtempSync(join(tmpdir(), "promote-runner-"));
  const app = join(root, "app");
  mkdirSync(join(app, "logs"), { recursive: true });
  mkdirSync(join(app, ".output", "server"), { recursive: true });
  writeFileSync(join(app, ".output", "server", "index.mjs"), "// the build that was running\n");
  writeFileSync(join(app, ".output", "server", "version.txt"), "old");
  // The migrations a real checkout carries. Two, so the newest can be told
  // apart from the one a build's own output names.
  mkdirSync(join(app, "migrations"), { recursive: true });
  writeFileSync(join(app, "migrations", "0116_source_retry_after.sql"), "-- a migration\n");
  writeFileSync(join(app, "migrations", "0117_source_replaces.sql"), "-- a later migration\n");
  const fakes = join(root, "fakes");
  mkdirSync(fakes, { recursive: true });
  const hangChild = join(root, "hang-child.mjs");
  writeFileSync(join(fakes, "npm.cmd"), fakeNpm(hangChild));
  writeFileSync(join(root, "slow-child.mjs"), SLOW_CHILD);
  writeFileSync(hangChild, HANG_CHILD);
  // The install's own ops\ directory, so the command the promotion builds
  // points at something that exists even though the fake `node` is what runs.
  mkdirSync(join(app, "ops"), { recursive: true });
  writeFileSync(join(app, "ops", "lib-promote-db.mjs"), "// this install's database library, replaced by the fake node\n");
  const dbDir = join(root, "db");
  mkdirSync(dbDir, { recursive: true });
  writeFileSync(join(fakes, "node.cmd"), fakeNode());
  const dbTrace = join(root, "db-trace.log");
  return { root, app, fakes, hangChild, dbDir, dbTrace };
}

/**
 * The answer the fake database library gives to one command.
 *
 * Written as a file rather than baked into the batch file so a test can set a
 * different answer per command in the same run -- a copy that succeeds and a
 * swap-back that refuses, for instance.
 */
function fakeDbAnswer(install, command, report) {
  writeFileSync(join(install.dbDir, `${command}.json`), `${JSON.stringify(report)}\n`);
}

/**
 * The names a promotion of the fake install would use, spelled out rather than
 * imported: what these tests check is that promote.ps1 PASSES the names it was
 * given to the library, and a name derived by the same code under test would
 * prove nothing about that.
 */
const FAKE_DB = "townreporter";
const FAKE_COPY = "townreporter_prerollout_20260110120000";
const FAKE_FAILED = "townreporter_failed_20260110120000";

function psLiteral(path) {
  return `'${path.replace(/'/g, "''")}'`;
}

/**
 * Write a harness that dot-sources the REAL ops\lib-promote.ps1 and drives it.
 *
 * The preamble matches ops\promote.ps1's own: $ErrorActionPreference = "Stop".
 * That matters for the pipe-closed test -- a console write that throws must not
 * be able to stop the script while it still has a child to wait on.
 */
function writeHarness(install, name, body) {
  const file = join(install.root, name);
  const lib = join(OPS, "lib-promote.ps1");
  const lines = [
    '$ErrorActionPreference = "Stop"',
    `. ${psLiteral(lib)}`,
    `$env:PATH = ${psLiteral(install.fakes)} + ';' + $env:PATH`,
    `$app = ${psLiteral(install.app)}`,
    // Where the fake database library writes what it was asked to do, and
    // where it reads the answer it should give.
    `$env:FAKE_DB_LOG = ${psLiteral(install.dbTrace)}`,
    `$env:FAKE_DB_DIR = ${psLiteral(install.dbDir)}`,
    ...body,
    "",
  ];
  writeFileSync(file, lines.join("\n"));
  return file;
}

function runPowerShell(file, { timeout = 120_000, onSpawn, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
      cwd: ROOT,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    // A destroyed stdout makes every later read error out; those errors are
    // the point of one of these tests, not a reason to fail the run.
    child.stdout.on("error", () => undefined);
    child.stderr.on("error", () => undefined);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // the kill is best effort; the timeout below is the real failure
      }
      reject(new Error(`powershell harness ${file} did not finish within ${timeout}ms`));
    }, timeout);
    if (onSpawn) onSpawn(child);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/**
 * Read a file, and treat "somebody has it open right now" as "not yet".
 *
 * These tests poll the run log WHILE the promotion appends to it, and on
 * Windows the two opens are mutual: a poll that lands in the instant of an
 * append used to throw EBUSY out of `readFileSync` and fail the test outright
 * in under a second. That is the test's bug and not the product's -- nothing
 * in production reads a log a promote is writing -- and the cure is the same
 * as for any other transient failure here: the next poll 100 ms later sees it.
 *
 * The other half of that race is the product's, and it is fixed in
 * `Add-PromoteLogLine` (ops\lib-promote.ps1): an append that collided with a
 * reader used to be silently dropped, which lost the `step=... child pid N`
 * line about one run in eleven. Both halves are needed -- a tolerant reader
 * cannot bring back a line the writer never wrote.
 */
function read(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * The newest promote-*.log under an install's logs directory.
 *
 * Read from disk rather than remembered, so the assertion is about what a
 * person would actually find in logs\ the morning after, not about a path the
 * test happened to keep.
 */
function newestLog(app) {
  const dir = join(app, "logs");
  // The run log only: a step's own output files sit beside it as
  // promote-<stamp>-<step>.out.log, and those are not runs.
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => /^promote-\d{8}-\d{6}\.log$/.test(n)) : [];
  assert.equal(files.length, 1, `expected exactly one promote log in ${dir}, found ${files.length}`);
  return join(dir, files[0]);
}

/** The sibling file a step's own output went to, named the way the log names it. */
function stepOutputFile(app, step) {
  return join(app, "logs", basename(newestLog(app)).replace(/\.log$/, "") + `-${step}.out.log`);
}

/**
 * What the fake database library was asked to do, in the order it was asked.
 *
 * The promotion's own stop and start append to the same file, so this is one
 * trace across both halves -- which is the only way to hold the ordering that
 * unit PR2 is about: stop, then the swap, then the old build, then start.
 */
function dbTrace(install) {
  return read(install.dbTrace)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Where a thing appears in a trace, failing loudly when it is not there at all. */
function traceIndex(trace, needle) {
  const at = trace.findIndex((line) => line.includes(needle));
  assert.ok(at > -1, `the trace never mentions ${JSON.stringify(needle)}; it holds:\n${trace.join("\n")}`);
  return at;
}

/**
 * Wait for a pattern to appear in a file a running harness is writing.
 *
 * The harnesses in this file log the PID of the process they started before
 * they wait on it, which is what lets a test kill that process the way the
 * machine's own tooling would -- from outside, without asking the script.
 */
async function waitForMatch(path, pattern, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = read(path).match(pattern);
    if (m) return m;
    await sleep(100);
  }
  throw new Error(`${path} never matched ${pattern} within ${timeoutMs}ms; it holds:\n${read(path)}`);
}

/** Is a PID still running? Asked of the operating system, not of a log. */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return true;
    await sleep(100);
  }
  return !isRunning(pid);
}

/** Kill a process and its children, the way the runner has to: by PID. */
function killTree(pid) {
  execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

/**
 * Tear an install down, without letting the teardown hide the failure.
 *
 * A test that fails while a fake child is still running leaves that child
 * holding its log file open, and Windows will not delete a directory out from
 * under it. Deleting anyway throws from the `finally`, and a throw there
 * REPLACES the assertion error -- so the run reports "EBUSY" instead of the
 * thing that actually went wrong. Killing the child first, then retrying the
 * delete, keeps the real failure on screen.
 */
/**
 * Wait until the operating system says a PID is gone.
 *
 * `taskkill /F` RETURNS BEFORE THE PROCESS IS ACTUALLY GONE. Measured on this
 * machine: the call comes back, `Get-Process` still resolves the PID for a
 * moment, and -- the part that matters here -- the file handles the process
 * held are still open. That is what made this suite flaky: the fixture
 * directory could not be deleted while a killed child's handle on its own log
 * file was still being torn down, so `rmdir` failed with EBUSY, and a throw
 * from a `finally` REPLACES the assertion error -- the run reported EBUSY
 * instead of whatever actually happened. Seen in 2 runs out of 6.
 */
async function waitUntilGone(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return true;
    await sleep(100);
  }
  return !isRunning(pid);
}

/**
 * Delete a fixture directory, retrying with backoff for several seconds.
 *
 * A teardown that gives up loudly is worse than one that gives up quietly: a
 * leftover directory in the OS temp folder is a tidiness problem, and an
 * EBUSY thrown from a `finally` is a red suite that says nothing about the
 * code under test. So this retries hard and then stops trying.
 */
async function removeTree(dir, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let delay = 100;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await sleep(delay);
      delay = Math.min(delay * 2, 1000);
    }
  }
}

/**
 * Tear an install down: the child first, WAIT for it to really be gone, then
 * the directory.
 *
 * The wait is the fix. Killing the process tree and deleting the directory in
 * the same breath is a race against Windows' own process teardown, and the
 * loser is whichever assertion happened to be in flight.
 */
async function cleanup(install) {
  const pid = Number(read(join(install.app, "hang-child-pid.txt")).trim());
  if (Number.isFinite(pid) && pid > 0) {
    try {
      if (isRunning(pid)) killTree(pid);
    } catch {
      // best effort: the test has already failed, and this is only tidying
    }
    await waitUntilGone(pid);
  }
  await removeTree(install.root);
}

// --- always: the script is wired the way the tests below assume -------------

test("promote.ps1 runs its long steps through the detached runner, never inline", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
  const lib = readFileSync(join(OPS, "lib-promote.ps1"), "utf8");

  // `& npm ci` as a COMMAND. Not `&&`, which is how the doc comments above the
  // build step quote package.json's own script.
  assert.doesNotMatch(
    src,
    /(^|\s)&\s*npm\b/,
    "promote.ps1 is back to running npm inline: the child inherits the console's stdout, and a closed pipe kills it mid-install (the three failures this unit exists for)",
  );
  assert.match(src, /Invoke-PromoteChild[^\n]*-Command 'npm ci'/, "npm ci no longer goes through the detached runner");
  assert.match(src, /Invoke-PromoteBuild[^\n]*-Command 'npm run build'/, "the build no longer goes through the detached runner");

  // Output redirected to files is what makes the child immune to the launcher's
  // console going away.
  assert.match(lib, /-RedirectStandardOutput\s+\$outFile/);
  assert.match(lib, /-RedirectStandardError\s+\$errFile/);

  // The exit code has to come from the child's own record: Start-Process
  // -PassThru's ExitCode is empty on Windows PowerShell 5.1 (measured), so a
  // failed npm step read from there looks like a success.
  assert.match(lib, /PROMOTE_EXIT=/, "the child no longer records its own exit code");
  assert.doesNotMatch(
    lib,
    /\$proc\.ExitCode/,
    "the runner is reading $process.ExitCode, which Start-Process -PassThru leaves empty on Windows PowerShell 5.1",
  );
});

test("promote.ps1 keeps a log, offers -Resume, and prints the way back up", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
  assert.match(src, /\[switch\]\$Resume/, "promote.ps1 no longer accepts -Resume");
  assert.match(src, /New-PromoteLog -App \$app/, "promote.ps1 no longer opens a log of its own");
  assert.match(src, /Get-PromoteResumePoint -App \$app/, "promote.ps1 no longer reads the previous run's log");

  // The recovery command is the LAST thing printed on a failure that leaves the
  // paper down. Checked structurally: nothing but the closing brace may follow
  // it inside Die.
  const die = src.slice(src.indexOf("function Die("), src.indexOf("function Get-OpenDeskJobs"));
  const marker = 'Show "  $recovery" Yellow';
  const at = die.indexOf(marker);
  assert.ok(at > -1, "Die no longer prints the command that brings the paper back");
  const after = die.slice(at + marker.length).trimStart();
  assert.ok(
    after.startsWith("}"),
    `something is printed after the recovery command, so it is no longer the last line: ${JSON.stringify(after.slice(0, 60))}`,
  );
});

// --- the log ----------------------------------------------------------------

test("-WhatIf lets only the READ-ONLY database commands carry the live-promote flag", windowsOnly, async () => {
  const install = makeInstall();
  try {
    // Under -WhatIf: names / preflight / state carry the flag; copy, the
    // connection wait, the swap and the hand rollback never do, so a dry run on
    // a 5433 install still cannot copy, rename or swap anything. Outside
    // -WhatIf every command carries the flag the real promotion set.
    const harness = writeHarness(install, "whatif-flag.ps1", [
      "$base = @{ PROMOTE_DB_LIVE_PROMOTE = '' }",
      "$rows = @()",
      "$WhatIfPreference = $true",
      "foreach ($c in 'names','preflight','state','copy','wait-for-zero','swap-back','rollback') {",
      "  $e = Get-PromoteDbCommandEnvironment -Command $c -Environment $base",
      "  $rows += \"whatif:$c=$($e['PROMOTE_DB_LIVE_PROMOTE'])\"",
      "}",
      "$WhatIfPreference = $false",
      "$real = @{ PROMOTE_DB_LIVE_PROMOTE = '1' }",
      "foreach ($c in 'names','copy','swap-back','rollback') {",
      "  $e = Get-PromoteDbCommandEnvironment -Command $c -Environment $real",
      "  $rows += \"real:$c=$($e['PROMOTE_DB_LIVE_PROMOTE'])\"",
      "}",
      "# the caller's table is not changed",
      "$WhatIfPreference = $true",
      "$null = Get-PromoteDbCommandEnvironment -Command 'preflight' -Environment $base",
      "$rows += \"caller-untouched=[$($base['PROMOTE_DB_LIVE_PROMOTE'])]\"",
      // -WhatIf is a preference every cmdlet honours, Set-Content included: turn
      // it off again or the result file is never written.
      "$WhatIfPreference = $false",
      "Set-Content -Path (Join-Path $app 'whatif.txt') -Value ($rows -join ';') -Encoding ASCII",
    ]);
    await runPowerShell(harness);
    const out = read(join(install.app, "whatif.txt")).trim();
    for (const c of ["names", "preflight", "state"]) {
      assert.ok(out.includes(`whatif:${c}=1`), `-WhatIf must let the read-only ${c} carry the flag: ${out}`);
    }
    for (const c of ["copy", "wait-for-zero", "swap-back", "rollback"]) {
      assert.ok(out.includes(`whatif:${c}=;`), `-WhatIf must NOT give ${c} the flag (a dry run may not touch 5433): ${out}`);
    }
    for (const c of ["names", "copy", "swap-back", "rollback"]) {
      assert.ok(out.includes(`real:${c}=1`), `a real run keeps the flag for ${c}: ${out}`);
    }
    assert.ok(out.endsWith("caller-untouched=[]"), `the caller's table was modified: ${out}`);
  } finally {
    await cleanup(install);
  }
});

test("a 5433 URL without the flag is refused by copy, swap-back and rollback; -WhatIf only opens the read-only commands", async () => {
  // The library half of the same guarantee, on the three commands -WhatIf must
  // never open: with the flag empty (what -WhatIf leaves in place for them) each
  // refuses before it dials anything. The host is .invalid so nothing is dialled
  // even if the guard were gone.
  const { runCommand } = await import("../ops/lib-promote-db.mjs");
  const url = "postgres://u:p@db.invalid:5433/townreporter";
  for (const command of ["copy", "wait-for-zero", "swap-back", "rollback"]) {
    const answer = await runCommand(command, { adminUrl: url, databaseUrl: url, livePromote: false });
    assert.equal(answer.ok, false, `${command} ran on a 5433 URL without the flag`);
    assert.match(answer.refusal, /port 5433/, `${command} was refused for some other reason: ${answer.refusal}`);
  }
});

test("every step lands in the log with its command, its exit code and its duration", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "log-lines.ps1", [
      '$log = New-PromoteLog -App $app',
      'Write-PromoteLog $log "promote started: $app (port 9999), pid 1, arguments: \'\'"',
      "Add-PromoteStep -Log $log -Name 'deps' -Detail 'npm ci'",
      "$first = Invoke-PromoteChild -Log $log -Step 'deps' -Command 'npm ci'",
      'Complete-PromoteStep -Log $log -Name \'deps\' -Seconds $first.Seconds -Detail "npm ci exit $($first.ExitCode)"',
      "Add-PromoteStep -Log $log -Name 'build' -Detail 'npm run build'",
      "$env:FAKE_NPM_MODE = 'buildfail'",
      "$second = Invoke-PromoteChild -Log $log -Step 'build' -Command 'npm run build'",
      'Fail-PromoteStep -Log $log -Name \'build\' -Detail "npm run build exit $($second.ExitCode)"',
      'Write-Output "CODES $($first.ExitCode) $($second.ExitCode)"',
    ]);

    const { out } = await runPowerShell(harness);
    assert.match(out, /CODES 0 1/, "the runner did not report the children's real exit codes (0 then 1)");

    const text = read(newestLog(install.app));
    assert.match(text, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] promote started:/m, "no timestamped start line");
    assert.match(text, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] step=deps started -- npm ci$/m);
    assert.match(text, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] step=deps child: npm ci$/m, "the child's command is not in the log");
    assert.match(text, /step=deps child: npm ci exit 0 \(\d+(\.\d+)?s\)/, "no exit code and duration for npm ci");
    assert.match(text, /step=deps ok \(\d+(\.\d+)?s\): npm ci exit 0/, "the deps step has no ok line");
    assert.match(text, /step=build FAILED: npm run build exit 1/, "the failed build is not named in the log");

    // npm's own output goes to the sibling file the log names, and that file
    // still records the exit code even if the promotion itself is killed.
    const childOutput = read(stepOutputFile(install.app, "deps"));
    assert.match(childOutput, /\[fake npm\] ci/, "npm's stdout is not in the file the log names");
    assert.match(childOutput, /PROMOTE_EXIT=0/, "the child did not record its own exit code in its output");
  } finally {
    await cleanup(install);
  }
});

// --- the 20 seconds that used to die ----------------------------------------

test("a 20-second child survives its launcher's stdout pipe being closed", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const slowChild = join(install.root, "slow-child.mjs");
    const harness = writeHarness(install, "pipe-closed.ps1", [
      '$log = New-PromoteLog -App $app',
      "Add-PromoteStep -Log $log -Name 'deps' -Detail 'a long step'",
      `$r = Invoke-PromoteChild -Log $log -Step 'deps' -Command ${psLiteral(`node "${slowChild}" 20000`)}`,
      'Complete-PromoteStep -Log $log -Name \'deps\' -Seconds $r.Seconds -Detail "the long step exit $($r.ExitCode)"',
      `Set-Content -Path (Join-Path $app 'launcher-done.txt') -Value "exit=$($r.ExitCode);completed=$($r.Completed)" -Encoding ASCII`,
    ]);

    // Close the pipes three seconds in: long enough for the child to be
    // running, long enough after for the launcher to have started writing.
    const { code } = await runPowerShell(harness, {
      timeout: 90_000,
      onSpawn: (child) => {
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, 3000).unref();
      },
    });

    assert.equal(code, 0, "the launcher itself died when its console went away");

    // The child ran its full twenty seconds: it reached its end and said so.
    // A lower bound, not a window -- a loaded CI runner can only make this
    // later, never earlier, and a timer that fired early would be a different
    // bug entirely.
    const done = read(join(install.app, "slow-done.txt"));
    const survivedMs = Number((done.match(/completed after (\d+)ms/) ?? [])[1]);
    assert.ok(
      survivedMs >= 19_000,
      `the child did not survive the closed pipe -- slow-done.txt says ${JSON.stringify(done)}`,
    );

    // ...and the launcher was still alive to record what it returned.
    assert.equal(read(join(install.app, "launcher-done.txt")).trim(), "exit=0;completed=True");
    const text = read(newestLog(install.app));
    assert.match(text, /step=deps child: node .* exit 0 \(/, "the log has no exit code for the long child");
    assert.match(text, /step=deps ok \(/, "the deps step never completed");
  } finally {
    await cleanup(install);
  }
});

// --- a build that fails after the stop --------------------------------------

test("a build that fails after the stop leaves the paper on the OLD build and reports failure", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const versionFile = join(install.app, ".output", "server", "version.txt");
    const startedFile = join(install.app, "started.txt");
    // Shaped exactly like ops\promote.ps1's own call: a function defined in
    // this script, handed to the library as a scriptblock. That resolution is
    // load-bearing -- it is what starts the old build on the one path where
    // the paper is down -- so it is exercised rather than assumed.
    const harness = writeHarness(install, "build-fails.ps1", [
      "$script:startCalls = 0",
      "function Start-TheApp {",
      "  $script:startCalls = $script:startCalls + 1",
      `  $version = Get-Content -Path ${psLiteral(versionFile)} -Raw`,
      `  Set-Content -Path ${psLiteral(startedFile)} -Value $version.Trim() -Encoding ASCII`,
      "  return $true",
      "}",
      "$env:FAKE_NPM_MODE = 'buildfail'",
      "$log = New-PromoteLog -App $app",
      "$res = Invoke-PromoteBuild -Log $log -App $app -Command 'npm run build' -StartTheApp { Start-TheApp }",
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "ok=$($res.Ok);exit=$($res.ExitCode);fallback=$($res.Fallback);paperUp=$($res.PaperUp);starts=$($script:startCalls)" -Encoding ASCII`,
      "if ($res.Ok) { exit 0 } else { exit 1 }",
    ]);

    const { code } = await runPowerShell(harness);
    assert.equal(code, 1, "a failed build must not report success");

    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "ok=False;exit=1;fallback=True;paperUp=True;starts=1",
      "the failed build did not fall back to the previous build and start it exactly once",
    );
    assert.equal(read(startedFile).trim(), "old", "the app was started on something other than the OLD build");
    assert.equal(read(versionFile).trim(), "old", ".output was not put back the way it was before the build");
    assert.ok(existsSync(join(install.app, ".output", "server", "index.mjs")), "the restored build has no server entry");

    const text = read(newestLog(install.app));
    assert.match(text, /step=build started/);
    assert.match(text, /the build from before has been put back at \.output/, "the log does not say the old build was restored");
    assert.match(
      text,
      /the paper is back on the OLD version\. The promote did NOT complete\./,
      "the log does not say, in plain words, that the paper is back on the old version and the promote failed",
    );
    // The failing build's own output is kept, which is the whole point of the log.
    const files = readdirSync(join(install.app, "logs"));
    assert.ok(
      files.some((n) => n.endsWith("-build.err.log") && read(join(install.app, "logs", n)).includes("the build exploded")),
      "the failed build's stderr was not kept",
    );
  } finally {
    await cleanup(install);
  }
});

// --- a leftover marker ------------------------------------------------------

test("a leftover marker leads to the resume path, and says which step to carry on from", windowsOnly, async () => {
  const failed = makeInstall();
  const finished = makeInstall();
  try {
    const failedHarness = writeHarness(failed, "resume-failed.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260101-000000'",
      "Write-PromoteLog $log \"promote started: $app (port 9999), pid 1, arguments: ''\"",
      "Add-PromoteStep -Log $log -Name 'backup' -Detail 'database townreporter'",
      "Complete-PromoteStep -Log $log -Name 'backup' -Seconds 2 -Detail 'C:\\backups\\townreporter_2026-01-01_0000.sql (12 MB)'",
      "Add-PromoteStep -Log $log -Name 'stop' -Detail 'the app on port 9999'",
      "Complete-PromoteStep -Log $log -Name 'stop' -Seconds 2 -Detail 'stopped PID 5'",
      "Add-PromoteStep -Log $log -Name 'ff' -Detail 'fetch and fast-forward to origin/main'",
      "Complete-PromoteStep -Log $log -Name 'ff' -Seconds 2 -Detail 'moved aaaaaaa -> bbbbbbb'",
      "Add-PromoteStep -Log $log -Name 'deps' -Detail 'npm ci'",
      "Fail-PromoteStep -Log $log -Name 'deps' -Detail 'npm ci did not succeed (exit 1)'",
      "New-PromoteMarker -App $app | Out-Null",
      "$p = Get-PromoteResumePoint -App $app",
      `Set-Content -Path (Join-Path $app 'resume.txt') -Value "step=$($p.Step);status=$($p.Status);next=$($p.NextStep);backup=$($p.Backup)" -Encoding ASCII`,
    ]);
    const finishedHarness = writeHarness(finished, "resume-finished.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260102-000000'",
      "Write-PromoteLog $log \"promote started: $app (port 9999), pid 1, arguments: ''\"",
      "Add-PromoteStep -Log $log -Name 'deps' -Detail 'npm ci'",
      "Complete-PromoteStep -Log $log -Name 'deps' -Seconds 70 -Detail 'npm ci exit 0'",
      "New-PromoteMarker -App $app | Out-Null",
      "$p = Get-PromoteResumePoint -App $app",
      `Set-Content -Path (Join-Path $app 'resume.txt') -Value "step=$($p.Step);status=$($p.Status);next=$($p.NextStep)" -Encoding ASCII`,
      "Set-Content -Path (Join-Path $app 'no-marker.txt') -Value \"$(if ($null -eq (Get-PromoteResumePoint -App (Join-Path $app 'nowhere'))) { 'null' } else { 'not-null' })\" -Encoding ASCII",
      "Clear-PromoteMarker -App $app",
      "$gone = Get-PromoteResumePoint -App $app",
      `Set-Content -Path (Join-Path $app 'cleared.txt') -Value "$(if ($null -eq $gone) { 'null' } else { 'not-null' })" -Encoding ASCII`,
    ]);

    await runPowerShell(failedHarness);
    await runPowerShell(finishedHarness);

    assert.equal(
      read(join(failed.app, "resume.txt")).trim(),
      "step=deps;status=failed;next=deps;backup=C:\\backups\\townreporter_2026-01-01_0000.sql (12 MB)",
      "a run that died at npm ci no longer resumes at npm ci with its backup remembered",
    );
    assert.equal(
      read(join(finished.app, "resume.txt")).trim(),
      "step=deps;status=ok;next=build",
      "a run that got past npm ci no longer resumes at the step after it",
    );
    assert.equal(read(join(finished.app, "no-marker.txt")).trim(), "null", "a place with no marker reported an unfinished run");
    assert.equal(read(join(finished.app, "cleared.txt")).trim(), "null", "the marker was not cleared");
  } finally {
    await removeTree(failed.root);
    await removeTree(finished.root);
  }
});

/*
  THE ORDER THAT MADE -Resume USELESS.

  promote.ps1 opens ITS OWN log as the very first thing it does -- deliberately,
  so a run that dies on its first check still leaves a file behind saying so --
  and it looks for an unfinished run much later, in the marker section. Those
  two facts together mean the newest promote-*.log in the directory is always
  the log of the run that is asking the question, which has done nothing yet.

  So `-Resume` read back an empty answer: no step, no backup, no next step. It
  then either refused ("its log does not say where it stopped") or, where the
  caller falls through on a null, started from the beginning on top of a run
  that had stopped half way -- including on top of an interrupted `npm ci`.

  Every earlier test called Get-PromoteResumePoint BEFORE any new log existed,
  which is exactly the state the bug cannot happen in. This one builds the
  three logs a real machine has at that moment, in the order promote.ps1 makes
  them: the interrupted run, a stray log that is not a run at all (a
  hand-rollback writes one), and the current run's own -- newest, and the one
  the answer must ignore.
*/
test("the run's own log is never mistaken for the run being resumed", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "resume-own-log.ps1", [
      // 1. The interrupted run: it got as far as `deps`, where npm ci died.
      "$old = New-PromoteLog -App $app -Stamp '20260104-000000'",
      "Write-PromoteLog $old \"promote started: $app (port 9999), pid 1, arguments: ''\"",
      "Add-PromoteStep -Log $old -Name 'backup' -Detail 'database townreporter'",
      "Complete-PromoteStep -Log $old -Name 'backup' -Seconds 2 -Detail 'C:\\backups\\townreporter_2026-01-04_0000.sql (12 MB)'",
      "Add-PromoteStep -Log $old -Name 'stop' -Detail 'the app on port 9999'",
      "Complete-PromoteStep -Log $old -Name 'stop' -Seconds 2 -Detail 'stopped PID 5'",
      "Add-PromoteStep -Log $old -Name 'deps' -Detail 'npm ci'",
      "Fail-PromoteStep -Log $old -Name 'deps' -Detail 'npm ci did not succeed (exit 1)'",
      "New-PromoteMarker -App $app | Out-Null",
      // 2. A stray promote-*.log that is not a promotion: no `promote started`
      // line and no step lines, exactly what a hand-rollback leaves behind.
      "$stray = Join-Path (Join-Path $app 'logs') 'promote-20260105-000000.log'",
      "Set-Content -Path $stray -Value '[2026-01-05 00:00:00] database rollback started: put townreporter_x back as townreporter (this is not a promotion)' -Encoding ASCII",
      // 3. This run's own log, opened the way promote.ps1 opens it -- before
      // anything has been looked at, let alone done.
      "$log = New-PromoteLog -App $app",
      "Write-PromoteLog $log \"promote started: $app (port 9999), pid 2, arguments: '-Resume'\"",
      // Pinned times rather than "whatever the clock said": the whole point is
      // that the current run's log is the NEWEST one in the directory.
      "(Get-Item $old.Path).LastWriteTime = [datetime]'2026-01-04 00:00:01'",
      "(Get-Item $stray).LastWriteTime = [datetime]'2026-01-05 00:00:01'",
      "(Get-Item $log.Path).LastWriteTime = [datetime]'2026-01-06 00:00:01'",
      "$p = Get-PromoteResumePoint -App $app -ExcludeLog $log.Path",
      `Set-Content -Path (Join-Path $app 'resume.txt') -Value "step=$($p.Step);status=$($p.Status);next=$($p.NextStep);backup=$($p.Backup);log=$([System.IO.Path]::GetFileName($p.LogPath))" -Encoding ASCII`,
    ]);

    const { code } = await runPowerShell(harness);
    assert.equal(code, 0, "asking for the resume point failed outright");
    assert.equal(
      read(join(install.app, "resume.txt")).trim(),
      "step=deps;status=failed;next=deps;backup=C:\\backups\\townreporter_2026-01-04_0000.sql (12 MB);log=promote-20260104-000000.log",
      "-Resume read this run's own empty log (or a stray one) instead of the interrupted run, so it cannot name the step to carry on from or the backup to keep",
    );
  } finally {
    await removeTree(install.root);
  }
});

test("promote.ps1 hands its own log to the resume lookup", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
  /*
    The ORDER is what broke -Resume, so the order is what this pins: the log
    has to still be opened first (a run that dies on its first check must leave
    a file), and the resume lookup has to be told which file that was.
  */
  const openAt = src.indexOf("$log = New-PromoteLog -App $app");
  const resumeAt = src.indexOf("$resumePoint = Get-PromoteResumePoint");
  assert.ok(openAt > -1, "promote.ps1 no longer opens a log of its own");
  assert.ok(resumeAt > -1, "promote.ps1 no longer looks for an unfinished run");
  assert.ok(
    openAt < resumeAt,
    "the log is now opened after the resume lookup, which is the opposite of why it is opened first",
  );
  assert.match(
    src,
    /Get-PromoteResumePoint -App \$app -ExcludeLog \$log\.Path/,
    "promote.ps1 asks for the resume point without saying which log is its own, so it reads back its own empty one",
  );
});

/*
  THE OTHER HALF OF THE FLAKE, ON PURPOSE AND WITHOUT A RACE.

  The `step=build child pid N` line went missing about one run in eleven, and
  the reason was not timing: `Add-Content` opens the run's log with no sharing
  at all, so an append that landed while ANYBODY had the file open failed with
  a sharing violation -- and Write-PromoteLog swallows that failure on purpose
  (losing the log is bad, losing the paper is worse), so the line was gone for
  good. The log simply stopped a line early.

  That is worth fixing on its own account, not only because it made a test
  flaky: an operator watching a promotion IS a reader, and a promotion whose
  log erases itself while they watch it is worse than no log at all.

  This holds the log open for the whole run -- the shape `tail -f`, a text
  editor and this test's own poller all have -- and asserts that every line
  landed anyway. Deterministic: with `Add-Content` the appends fail outright,
  so this fails every run rather than one in eleven.
*/
test("a promotion keeps writing its log while somebody is reading it", windowsOnly, async () => {
  const install = makeInstall();
  let reader = null;
  try {
    const logPath = join(install.app, "logs", "promote-20260104-000000.log");
    writeFileSync(logPath, "");
    /* Opened for reading and held open across the whole promotion. */
    reader = openSync(logPath, "r");

    const harness = writeHarness(install, "log-under-reader.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260104-000000'",
      "Write-PromoteLog $log 'promote started: somebody is reading this file'",
      "Add-PromoteStep -Log $log -Name 'build' -Detail 'npm run build'",
      "Write-PromoteLog $log 'step=build child pid 4242'",
      "Complete-PromoteStep -Log $log -Name 'build' -Seconds 2 -Detail 'exit 0'",
    ]);

    const { code } = await runPowerShell(harness);
    assert.equal(code, 0, "the promotion failed outright while its log was being read");

    const text = read(logPath);
    for (const line of [
      "promote started: somebody is reading this file",
      "step=build started -- npm run build",
      "step=build child pid 4242",
      "step=build ok",
    ]) {
      assert.ok(
        text.includes(line),
        `a line went missing because a reader had the log open: ${JSON.stringify(line)}; the log holds ${JSON.stringify(text)}`,
      );
    }
  } finally {
    if (reader !== null) closeSync(reader);
    await removeTree(install.root);
  }
});

// --- a child killed before it says how it ended ------------------------------

test(
  "a child killed before it writes its exit code fails the step and puts the old build back",
  windowsOnly,
  async () => {
    const install = makeInstall();
    try {
      const versionFile = join(install.app, ".output", "server", "version.txt");
      const startedFile = join(install.app, "started.txt");
      const logPath = join(install.app, "logs", "promote-20260104-000000.log");

      // Shaped like ops\promote.ps1's own call, with a build that never
      // returns. Nothing here kills it: the TEST does, from outside, the way
      // the shell tool that took the paper down three times did.
      const harness = writeHarness(install, "child-killed.ps1", [
        "function Start-TheApp {",
        `  $version = Get-Content -Path ${psLiteral(versionFile)} -Raw`,
        `  Set-Content -Path ${psLiteral(startedFile)} -Value $version.Trim() -Encoding ASCII`,
        "  return $true",
        "}",
        "$env:FAKE_NPM_MODE = 'hang'",
        "$log = New-PromoteLog -App $app -Stamp '20260104-000000'",
        "$res = Invoke-PromoteBuild -Log $log -App $app -Command 'npm run build' -StartTheApp { Start-TheApp }",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "ok=$($res.Ok);exit=$($res.ExitCode);fallback=$($res.Fallback);paperUp=$($res.PaperUp)" -Encoding ASCII`,
      ]);

      const run = runPowerShell(harness, { timeout: 90_000 });
      const [, pid] = await waitForMatch(logPath, /step=build child pid (\d+)/);
      killTree(Number(pid));

      const { code } = await run;
      assert.equal(code, 0, "the harness itself did not finish");

      // The child never reached its end, so there is no exit code -- NOT a zero.
      // A runner that defaulted to 0 would call this build a success and leave
      // a half-written tree being served.
      assert.equal(
        read(join(install.app, "result.txt")).trim(),
        "ok=False;exit=;fallback=True;paperUp=True",
        "a killed child was not treated as a failed step",
      );
      assert.equal(read(startedFile).trim(), "old", "the app was started on something other than the OLD build");
      assert.equal(read(versionFile).trim(), "old", ".output was not put back after the step failed");

      const text = read(newestLog(install.app));
      assert.match(text, /step=build FAILED: .*did not reach its end/, "the step is not recorded as FAILED in the log");
      assert.match(text, /the paper is back on the OLD version/, "the log does not say which version the paper is on");
    } finally {
      await cleanup(install);
    }
  },
);

// --- a step that never returns ----------------------------------------------

test("a step past its time limit is killed by PID; a step inside its limit is left alone", windowsOnly, async () => {
  const over = makeInstall();
  const under = makeInstall();
  try {
    // Over the limit: a real node process that would run for a minute, given
    // two seconds. The PID it reports is checked against the operating system,
    // not against the log -- a log line saying "killed" proves nothing.
    const overHarness = writeHarness(over, "timeout-over.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260105-000000'",
      `$r = Invoke-PromoteChild -Log $log -Step 'deps' -Command ${psLiteral(`node "${over.hangChild}" 60000`)} -TimeoutSeconds 2`,
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "exit=$($r.ExitCode);completed=$($r.Completed);timedOut=$($r.TimedOut);pid=$($r.Pid)" -Encoding ASCII`,
    ]);
    const started = Date.now();
    await runPowerShell(overHarness, { timeout: 90_000 });
    const elapsed = Date.now() - started;

    assert.equal(
      read(join(over.app, "result.txt")).trim().replace(/pid=\d+$/, "pid=<its own>"),
      "exit=;completed=False;timedOut=True;pid=<its own>",
      "a step past its limit was not reported as a timed-out failure",
    );
    const overText = read(newestLog(over.app));
    assert.match(
      overText,
      /step=deps TIMED OUT after 2s -- killed PID \d+ and its children/,
      "the timeout and the PID are not in the log",
    );

    // The kill reached the actual work: node, three levels down, is gone. The
    // runner started cmd.exe, which ran npm.cmd, which ran node.
    //
    // This pair is the assertion that matters, and it comes before the timing
    // one on purpose. A log line saying "killed" proves nothing; a runner that
    // logs the timeout and does not kill anything would still pass everything
    // above. Both halves are needed: "is it gone" catches a kill that never
    // happened, and "did it reach its own end" catches one that happened after
    // the child had already finished anyway.
    const childPid = Number(read(join(over.app, "hang-child-pid.txt")).trim());
    assert.ok(childPid > 0, "the fake npm never got as far as running the child");
    assert.ok(await waitUntilDead(childPid), `PID ${childPid} is still running: the process tree was not killed`);
    assert.equal(
      read(join(over.app, "hang-child-survived.txt")),
      "",
      "the child reached its own end, so it was never actually killed -- only reported as timed out",
    );
    assert.ok(elapsed < 30_000, `the limit did not stop the step; the harness took ${elapsed}ms`);

    // Under the limit: same shape, and none of it happens.
    const underHarness = writeHarness(under, "timeout-under.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260106-000000'",
      `$r = Invoke-PromoteChild -Log $log -Step 'deps' -Command ${psLiteral(`node "${under.hangChild}" 1500`)} -TimeoutSeconds 30`,
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "exit=$($r.ExitCode);completed=$($r.Completed);timedOut=$($r.TimedOut)" -Encoding ASCII`,
    ]);
    await runPowerShell(underHarness, { timeout: 90_000 });

    assert.equal(
      read(join(under.app, "result.txt")).trim(),
      "exit=0;completed=True;timedOut=False",
      "a step that finished inside its limit was treated as a timeout",
    );
    assert.notEqual(read(join(under.app, "hang-child-survived.txt")), "", "the child under the limit did not get to finish");
    assert.doesNotMatch(read(newestLog(under.app)), /TIMED OUT/, "a step inside its limit was logged as timed out");
  } finally {
    await removeTree(over.root);
    await removeTree(under.root);
  }
});

// --- what the database is at, when the old build goes back -------------------

test(
  "putting the old build back says what the database is at, and stays quiet when it did not move",
  windowsOnly,
  async () => {
    const install = makeInstall();
    try {
      // What a build that reached the migration leaves in its own output. It
      // names 0116; the newest file in migrations\ is 0117 -- so which source
      // answered is visible in the result.
      const buildOutput = join(install.root, "build.out.log");
      writeFileSync(buildOutput, "[fake npm] the bundle is built\n[migrate] applied 0116_source_retry_after.sql\n");

      const harness = writeHarness(install, "fallback-note.ps1", [
        "function Start-TheApp { return $true }",
        // Each fallback consumes .output-previous, so the install is put back
        // the way it was before the next one.
        "function Stage-Previous {",
        "  Remove-Item (Join-Path $app '.output') -Recurse -Force -ErrorAction SilentlyContinue",
        "  Remove-Item (Join-Path $app '.output-previous') -Recurse -Force -ErrorAction SilentlyContinue",
        "  New-Item -ItemType Directory -Force -Path (Join-Path $app '.output\\server') | Out-Null",
        "  Set-Content -Path (Join-Path $app '.output\\server\\index.mjs') -Value '// the old build' -Encoding ASCII",
        "  Copy-Item -Path (Join-Path $app '.output') -Destination (Join-Path $app '.output-previous') -Recurse -Force",
        "}",
        "$log = New-PromoteLog -App $app -Stamp '20260107-000000'",
        "Stage-Previous",
        "$before = Invoke-PromoteFallback -Log $log -App $app -StartTheApp { Start-TheApp }",
        "Stage-Previous",
        "$named = Invoke-PromoteFallback -Log $log -App $app -StartTheApp { Start-TheApp } -MigrationsRan 'yes' -BuildOutput $env:PROMOTE_TEST_BUILD_OUTPUT",
        "Stage-Previous",
        "$fromDirectory = Invoke-PromoteFallback -Log $log -App $app -StartTheApp { Start-TheApp } -MigrationsRan 'yes'",
        "Stage-Previous",
        "$maybe = Invoke-PromoteFallback -Log $log -App $app -StartTheApp { Start-TheApp } -MigrationsRan 'maybe'",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "before=$before;named=$named;fromDirectory=$fromDirectory;maybe=$maybe" -Encoding ASCII`,
      ]);

      await runPowerShell(harness, { env: { PROMOTE_TEST_BUILD_OUTPUT: buildOutput } });

      assert.equal(
        read(join(install.app, "result.txt")).trim(),
        "before=True;named=True;fromDirectory=True;maybe=True",
        "a fallback stopped starting the old build",
      );

      const text = read(newestLog(install.app));
      const count = (re) => (text.match(re) ?? []).length;

      assert.equal(count(/the database was already migrated to /g), 2, "the migration the database is at was not named exactly twice");
      assert.equal(
        count(/the database was already migrated to 0116_source_retry_after\.sql/g),
        1,
        "the migrate step's own output was not used when it was there",
      );
      assert.equal(
        count(/the database was already migrated to 0117_source_replaces\.sql/g),
        1,
        "the newest migration in the directory was not used as the fallback answer",
      );
      assert.equal(count(/but migrations may have run/g), 1, "a fallback that cannot name the migration did not say so");
      assert.equal(
        count(/the paper is back on the OLD version\. The promote did NOT complete\./g),
        1,
        "the plain sentence was not used for the one fallback with no migration to report",
      );
      assert.match(
        text,
        /if this build reads a table or column a migration removed, tell the developer before continuing/,
        "the note does not tell the operator what to do about it",
      );
    } finally {
      await cleanup(install);
    }
  },
);

test(
  "a build that died at the migration says migrations may have run; one that died before it says nothing",
  windowsOnly,
  async () => {
    const migrated = makeInstall();
    const bundler = makeInstall();
    try {
      // Same failing build twice. The only difference is how far the build's
      // own output says it got.
      const harnessFor = (install, name, mode, stamp) =>
        writeHarness(install, name, [
          `$env:FAKE_NPM_MODE = '${mode}'`,
          `$log = New-PromoteLog -App $app -Stamp '${stamp}'`,
          "$res = Invoke-PromoteBuild -Log $log -App $app -Command 'npm run build' -StartTheApp { return $true }",
          `Set-Content -Path (Join-Path $app 'result.txt') -Value "ok=$($res.Ok);fallback=$($res.Fallback)" -Encoding ASCII`,
        ]);

      await runPowerShell(harnessFor(migrated, "build-migratefail.ps1", "migratefail", "20260108-000000"));
      await runPowerShell(harnessFor(bundler, "build-buildfail.ps1", "buildfail", "20260109-000000"));

      assert.equal(read(join(migrated.app, "result.txt")).trim(), "ok=False;fallback=True", "the failing build did not fall back");
      assert.equal(read(join(bundler.app, "result.txt")).trim(), "ok=False;fallback=True", "the failing build did not fall back");

      const migratedText = read(newestLog(migrated.app));
      assert.match(
        migratedText,
        /The paper is back on the OLD version, but migrations may have run; if this build reads a table or column a migration removed, tell the developer before continuing/,
        "a build that died at the migration did not warn that the database may have moved on",
      );
      assert.match(migratedText, /step=build FAILED/, "the step is not recorded as FAILED in the log");

      // The step's own start line names the migration on purpose (it is why the
      // build runs with the server down), so this asks about the note, not the
      // word.
      const bundlerText = read(newestLog(bundler.app));
      assert.doesNotMatch(
        bundlerText,
        /migrations may have run|the database was already migrated to/,
        "a build that never reached the migration still warned about the database",
      );
      assert.match(bundlerText, /step=build FAILED/, "the step is not recorded as FAILED in the log");
    } finally {
      await removeTree(migrated.root);
      await removeTree(bundler.root);
    }
  },
);

test("the built-in limits are the ones the operator is told about", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "limits.ps1", [
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "deps=$(Get-PromoteChildTimeoutSeconds -Step 'deps');build=$(Get-PromoteChildTimeoutSeconds -Step 'build');verify=$(Get-PromoteChildTimeoutSeconds -Step 'verify');dbcopy=$(Get-PromoteChildTimeoutSeconds -Step 'dbcopy');dbswap=$(Get-PromoteChildTimeoutSeconds -Step 'dbswap');dbstate=$(Get-PromoteChildTimeoutSeconds -Step 'dbstate');dbcheck=$(Get-PromoteChildTimeoutSeconds -Step 'preflight');dbwait=$(Get-PromoteDbWaitSeconds);health=$(Get-PromoteHealthTimeoutSeconds)" -Encoding ASCII`,
    ]);
    await runPowerShell(harness);
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      // Twenty minutes for each of the two long steps -- under the watchdog's
      // 30-minute stand-down, so a hung step fails the promotion before the
      // watchdog can start the app on a half-written tree. One minute for the
      // health wait, which is what this install has always used and is shorter
      // than the five it is allowed.
      //
      // The database steps are much smaller because the work is a different
      // size: the auditor measured 4.4s to copy a 545 MB database and 0.47s
      // for the two renames, so ten minutes is a backstop rather than a
      // budget, and it is the number SELF-HOSTING.md tells the operator.
      // `dbwait` is how long the promotion waits for the app's connections to
      // close before it refuses -- inside the stop-the-app window, so it is
      // seconds and not minutes.
      "deps=1200;build=1200;verify=0;dbcopy=600;dbswap=600;dbstate=120;dbcheck=120;dbwait=30;health=60",
      "the step limits changed without the operator-facing docs changing with them",
    );
  } finally {
    await cleanup(install);
  }
});

// --- the database copy, and the swap that puts it back (unit PR2) -----------

test("the promotion order puts the copy inside the stop-the-app window, before anything can migrate", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "order.ps1", [
      `Set-Content -Path (Join-Path $app 'result.txt') -Value ((Get-PromoteStepOrder) -join ',') -Encoding ASCII`,
    ]);
    await runPowerShell(harness);

    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "backup,preflight,stop,dbcopy,ff,deps,build,start,verify",
      "the promotion's own step order changed, so -Resume, the docs and the operator's log no longer agree about where the copy happens",
    );

    /*
      The order the script ACTUALLY runs, read out of it rather than assumed
      from the list above. Three things have to be true and none of them is
      free: the copy is after the stop (PostgreSQL will not copy a database
      anybody is connected to, and the app is the connection), it is after the
      preflight (everything knowable earlier must fail before the paper goes
      down), and it is before the fast-forward and the build (the copy has to
      be a picture of the database from before this promotion touched
      anything, and `npm run build` is what migrates it).
    */
    const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
    const at = (needle, what) => {
      const index = src.indexOf(needle);
      assert.ok(index > -1, `${what} (${JSON.stringify(needle)}) is not in promote.ps1`);
      return index;
    };
    const preflightCheck = at("Invoke-PromoteDatabasePreflight", "the database preflight");
    const stop = at("--- 4. stop this install", "the stop section");
    const copy = at("Invoke-PromoteDatabaseCopy", "the copy");
    const ff = at("--- 5. fetch and fast-forward", "the fast-forward section");
    const build = at("Invoke-PromoteBuild", "the build");

    assert.ok(preflightCheck < stop, "the database is not checked before the paper is stopped");
    assert.ok(stop < copy, "the copy is not taken after the stop");
    assert.ok(copy < ff, "the copy is not taken before the fast-forward");
    assert.ok(copy < build, "the copy is not taken before the build (which is the migration)");

    // Every failure after the copy runs the same recovery, and it is the one
    // thing that puts the database back. One rule, no exceptions -- a rule
    // with exceptions is a rule that gets applied wrongly at 2 AM.
    /*
      EVERY failure path, one by one, and CALL SITES only.

      This used to count matches of /Invoke-PromoteRolloutFailure/g and ask for
      four -- which the function's own definition satisfied. Delete three of
      the four calls and the count is still 1 (the definition) plus the one
      left, so it passed with three quarters of the recovery gone. Each path
      is named here with the line that proves it, and the definition is
      excluded by requiring the call's own `-Why` argument to be on the line.
    */
    for (const [what, marker] of [
      ["the fast-forward", /\$recovered = Invoke-PromoteRolloutFailure -Why "the fast-forward could not run" -RestoreBuild \$false/],
      ["the dependency install", /\$recovered = Invoke-PromoteRolloutFailure -Why "npm ci did not succeed \(\$code\)" -RestoreBuild \$false/],
      ["the build", /Invoke-PromoteRolloutFailure -Why "the build did not succeed" -MigrationsRan \$migrations -BuildOutput \$output/],
      ["the start", /\$recovered = Invoke-PromoteRolloutFailure -Why "the new build did not answer on port \$port" -MigrationsRan 'yes' -BuildOutput \$buildOutputFile/],
    ]) {
      const calls = [...src.matchAll(new RegExp(marker.source, "g"))].length;
      assert.equal(calls, 1, `${what} no longer puts the database back through Invoke-PromoteRolloutFailure (found ${calls} call sites)`);
    }
    // ...and the definition itself is not counted as one of them: four call
    // sites and one definition, whatever anybody adds later.
    assert.equal([...src.matchAll(/^function Invoke-PromoteRolloutFailure/gm)].length, 1);
    assert.equal(
      [...src.matchAll(/Invoke-PromoteRolloutFailure/g)].length,
      5,
      "the number of mentions of the recovery changed: four call sites plus the definition",
    );
    assert.match(src, /if \(\$RollbackDatabase\)/, "promote.ps1 no longer has a way to put a copy back by hand");
  } finally {
    await cleanup(install);
  }
});

test("the copy is taken with the names, after a wait; a refused copy stops the promotion", windowsOnly, async () => {
  const install = makeInstall();
  try {
    fakeDbAnswer(install, "wait-for-zero", {
      command: "wait-for-zero",
      ok: true,
      connections: [],
      waitedSeconds: 1.2,
      refusal: "",
    });
    fakeDbAnswer(install, "copy", {
      command: "copy",
      ok: true,
      refusal: "",
      copy: FAKE_COPY,
      database: FAKE_DB,
      sizeBytes: 597688320,
      seconds: 4.4,
    });
    fakeDbAnswer(install, "swap-back", {
      command: "swap-back",
      ok: true,
      refusal: "",
      database: FAKE_DB,
      copy: FAKE_COPY,
      failed: FAKE_FAILED,
      steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`],
      sizeBytes: 597688320,
      seconds: 0.5,
    });

    const harness = writeHarness(install, "dbcopy.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
      "Add-PromoteStep -Log $log -Name 'dbcopy' -Detail 'copy townreporter to the copy'",
      "$r = Invoke-PromoteDatabaseCopy -Log $log -App $app -Database 'townreporter' -Copy 'townreporter_prerollout_20260110120000' -Failed 'townreporter_failed_20260110120000' -Stamp '20260110120000' -DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter'",
      "$s = Invoke-PromoteDatabaseSwapBack -Log $log -App $app -Database 'townreporter' -Copy 'townreporter_prerollout_20260110120000' -Failed 'townreporter_failed_20260110120000' -DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter'",
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "copy=$($r.Ok);swap=$($s.Swapped);why=$($s.Failure)" -Encoding ASCII`,
    ]);

    await runPowerShell(harness);
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "copy=True;swap=True;why=",
      "a successful copy or swap was reported as a failure",
    );

    const trace = dbTrace(install);
    // The names reach the library through the ENVIRONMENT -- never on the
    // command line, because the command line goes into the log. Every database
    // call carries them: the copy, the wait, and the swap.
    assert.deepEqual(
      trace.filter((line) => line.startsWith("env ")),
      [
        `env ${FAKE_DB} ${FAKE_COPY} ${FAKE_FAILED} 20260110120000`,
        `env ${FAKE_DB} ${FAKE_COPY} ${FAKE_FAILED}`,
        `env ${FAKE_DB} ${FAKE_COPY} ${FAKE_FAILED}`,
      ],
      "the names the promotion settled did not reach the database library",
    );
    assert.deepEqual(
      trace.filter((line) => line.startsWith("db ")),
      ["db copy", "db wait-for-zero", "db swap-back"],
      "the database calls are not the ones expected, in the order expected",
    );
    // ...and the swap waits for the connections BEFORE it renames anything.
    const waited = traceIndex(trace, "db wait-for-zero");
    const swapped = traceIndex(trace, "db swap-back");
    assert.ok(waited < swapped, "the swap does not wait for the app's connections to close first");

    // The password is in the admin URL, which is why it is not on a command
    // line. The log is the thing that gets read and pasted into a ticket.
    const log = read(newestLog(install.app));
    assert.doesNotMatch(log, /secret/, "the database connection string is in the promotion's log");
    assert.match(log, /step=dbcopy child: node /, "the copy's own command is not in the log");

    // Now the same copy, refused. The promotion must treat that as a failure
    // and carry the library's own sentence, which is what the operator reads.
    const refused = makeInstall();
    try {
      fakeDbAnswer(refused, "copy", {
        command: "copy",
        ok: false,
        refusal: "3 connection(s) are still open to townreporter. Nothing was changed and the paper was not touched.",
      });
      const refusalHarness = writeHarness(refused, "dbcopy-refused.ps1", [
        "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
        "$r = Invoke-PromoteDatabaseCopy -Log $log -App $app -Database 'townreporter' -Copy 'townreporter_prerollout_20260110120000' -Failed 'townreporter_failed_20260110120000' -Stamp '20260110120000'",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "ok=$($r.Ok);failure=$($r.Failure)" -Encoding ASCII`,
      ]);
      await runPowerShell(refusalHarness);
      const result = read(join(refused.app, "result.txt")).trim();
      assert.match(result, /^ok=False;/, "a refused copy was reported as a success");
      assert.match(result, /3 connection\(s\) are still open/, "the library's own sentence was not carried up to the operator");
      assert.match(result, /Nothing was changed and the paper was not touched\./);
    } finally {
      cleanup(refused);
    }
  } finally {
    await cleanup(install);
  }
});

test("a failed rollout stops the app, puts the database back, THEN starts the old build", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const versionFile = join(install.app, ".output", "server", "version.txt");
    // The build that was serving before this promotion, put aside the way
    // Invoke-PromoteBuild puts it aside, and a .output holding the new one.
    mkdirSync(join(install.app, ".output-previous", "server"), { recursive: true });
    writeFileSync(join(install.app, ".output-previous", "server", "index.mjs"), "// the build before\n");
    writeFileSync(join(install.app, ".output-previous", "server", "version.txt"), "old");
    writeFileSync(versionFile, "new");

    fakeDbAnswer(install, "wait-for-zero", { command: "wait-for-zero", ok: true, connections: [], refusal: "" });
    fakeDbAnswer(install, "swap-back", {
      command: "swap-back",
      ok: true,
      refusal: "",
      database: FAKE_DB,
      copy: FAKE_COPY,
      failed: FAKE_FAILED,
      steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`],
      sizeBytes: 597688320,
      seconds: 0.5,
    });

    const harness = writeHarness(install, "rollout-failed.ps1", [
      // One trace across both halves: what the promotion does to the app and
      // what it asks the database library to do, in the order it did them.
      "function Stop-TheApp {",
      "  Add-Content -Path $env:FAKE_DB_LOG -Value 'app stop' -Encoding ASCII",
      "  return [pscustomobject]@{ Stopped = @('PID 4242'); Foreign = '' }",
      "}",
      "function Start-TheApp {",
      `  $version = Get-Content -Path ${psLiteral(versionFile)} -Raw`,
      "  Add-Content -Path $env:FAKE_DB_LOG -Value \"app start $($version.Trim())\" -Encoding ASCII",
      "  return $true",
      "}",
      "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
      "$r = Invoke-PromoteFailedRollout -Log $log -App $app -StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } " +
        "-Database 'townreporter' -Copy 'townreporter_prerollout_20260110120000' -Failed 'townreporter_failed_20260110120000' " +
        "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter' -Why 'the build did not succeed' -MigrationsRan 'maybe'",
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "paperUp=$($r.PaperUp);swapped=$($r.Swapped);failed=$($r.Failed)" -Encoding ASCII`,
    ]);

    await runPowerShell(harness);
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "paperUp=True;swapped=True;failed=townreporter_failed_20260110120000",
      "the failed rollout did not put the database back and bring the paper up",
    );

    const trace = dbTrace(install);
    const stopped = traceIndex(trace, "app stop");
    const swapped = traceIndex(trace, "db swap-back");
    const started = traceIndex(trace, "app start old");
    // THE ORDER, which cannot be rearranged: the app has to be stopped before
    // the swap (PostgreSQL will not rename a database anything is connected
    // to), and the old build has to be started AFTER the swap (starting it
    // first would reconnect to the half-migrated database and hold it open,
    // so the swap would refuse -- correctly, and uselessly).
    assert.ok(stopped < swapped, "the app was not stopped before the database was swapped");
    assert.ok(swapped < started, "the old build was started before the database was put back");
    assert.ok(traceIndex(trace, "db wait-for-zero") < swapped, "the swap did not wait for the connections to close");

    // The build that went back on is the one from before, not the new one.
    assert.equal(read(versionFile).trim(), "old", ".output was not put back the way it was before the build");

    const log = read(newestLog(install.app));
    // The library's own rename lines, in the order it reported them.
    assert.ok(
      log.indexOf(`database: renamed ${FAKE_DB} -> ${FAKE_FAILED}`) < log.indexOf(`database: renamed ${FAKE_COPY} -> ${FAKE_DB}`),
      "the renames are logged out of order, which is the one thing about them that matters",
    );
    assert.match(log, new RegExp(`kept as ${FAKE_FAILED} \\(`), "the log does not say the failed database was kept");
    assert.match(
      log,
      /No data was lost: the paper was stopped from before the copy was taken until now, so nothing was written in between\./,
      "the log does not say, in plain words, that no data was lost",
    );
    // This failure is the build's, so the migration MAY have run -- and the
    // sentence must not claim the two databases are identical.
    assert.doesNotMatch(log, /nothing had been migrated/, "a build failure claimed nothing had migrated");
    /*
      ...and it does NOT say the database has moved on. The build reached the
      migration (that is what -MigrationsRan 'maybe' means), but the copy was
      put back, so the database is the picture from before this rollout -- an
      operator told "migrations may have run" here would go looking for a
      problem that is not there.
    */
    assert.doesNotMatch(
      log,
      /migrations may have run|the database was already migrated to/,
      "the log warns about a migrated database that was just put back",
    );
    assert.doesNotMatch(log, /secret/, "the database connection string is in the promotion's log");
  } finally {
    await cleanup(install);
  }
});

test("a swap that could not run renames nothing, and the paper still comes back", windowsOnly, async () => {
  const install = makeInstall();
  try {
    // What the wait looks like when the app's connections do not drain: the
    // library refuses rather than ending anybody's session, and it refuses
    // BEFORE the first rename.
    fakeDbAnswer(install, "wait-for-zero", {
      command: "wait-for-zero",
      ok: false,
      connections: [{ pid: 991, user: "postgres", application: "townreporter", host: "local", state: "idle" }],
      waitedSeconds: 30,
      refusal: "1 connection(s) are still open to townreporter after waiting 30s: pid 991. Nothing was copied and nothing was renamed. Nothing was changed and the paper was not touched.",
    });
    // Deliberately no swap-back answer: if the code got that far, the fake
    // would print nothing and the step would fail the other way, so the
    // absence is itself part of the assertion.

    mkdirSync(join(install.app, ".output-previous", "server"), { recursive: true });
    writeFileSync(join(install.app, ".output-previous", "server", "index.mjs"), "// the build before\n");
    writeFileSync(join(install.app, ".output-previous", "server", "version.txt"), "old");
    writeFileSync(join(install.app, ".output", "server", "version.txt"), "new");

    await runPowerShell(
      writeHarness(install, "swap-refused.ps1", [
        "function Stop-TheApp {",
        "  Add-Content -Path $env:FAKE_DB_LOG -Value 'app stop' -Encoding ASCII",
        "  return [pscustomobject]@{ Stopped = @('PID 4242'); Foreign = '' }",
        "}",
        "function Start-TheApp {",
        `  $version = Get-Content -Path ${psLiteral(join(install.app, ".output", "server", "version.txt"))} -Raw`,
        "  Add-Content -Path $env:FAKE_DB_LOG -Value \"app start $($version.Trim())\" -Encoding ASCII",
        "  return $true",
        "}",
        "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
        `$r = Invoke-PromoteFailedRollout -Log $log -App $app -StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } ` +
          `-Database '${FAKE_DB}' -Copy '${FAKE_COPY}' -Failed '${FAKE_FAILED}' ` +
          "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter' " +
          "-Why 'the build did not succeed' -MigrationsRan 'maybe'",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "swapped=$($r.Swapped);paperUp=$($r.PaperUp)" -Encoding ASCII`,
      ]),
    );
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "swapped=False;paperUp=True",
      "a swap that could not run did not bring the paper back on the old build",
    );

    // Nothing was renamed -- not even attempted.
    assert.deepEqual(
      dbTrace(install).filter((line) => line.startsWith("db ")),
      ["db wait-for-zero"],
      "the swap renamed something after the wait refused",
    );
    // The old build is back on disk and serving, so the operator is not left
    // with a stopped paper over a database that was never touched.
    assert.equal(read(join(install.app, ".output", "server", "version.txt")).trim(), "old");
    assert.deepEqual(dbTrace(install).filter((line) => line.startsWith("app ")), ["app stop", "app start old"]);

    const log = read(newestLog(install.app));
    assert.match(log, /the database was NOT swapped back: 1 connection\(s\) are still open/, "the log does not say the swap refused, or why");
    // The two facts an operator needs, in this order: the database was NOT put
    // back, and the paper is up anyway. The command that brings the paper back
    // is printed only when it is down -- which is Die's job in promote.ps1,
    // covered by the "prints the way back up" test above.
    assert.match(log, /The paper is back on the OLD version, but migrations may have run/, "a refused swap did not warn that the old build is on a migrated database");
  } finally {
    await cleanup(install);
  }
});

test("a failure before the build says the two databases hold the same data", windowsOnly, async () => {
  const install = makeInstall();
  try {
    fakeDbAnswer(install, "wait-for-zero", { command: "wait-for-zero", ok: true, connections: [], refusal: "" });
    fakeDbAnswer(install, "swap-back", {
      command: "swap-back",
      ok: true,
      refusal: "",
      steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`],
      sizeBytes: 597688320,
      seconds: 0.4,
    });

    /*
      The fast-forward failed, which is before the build -- and `npm run
      build` is what runs db:migrate, so the database was never touched. The
      swap still runs (one rule, no exceptions), and the copy it restores is
      byte-for-byte what the live database already was.

      The sentence has to SAY that. Without it, an operator looking at a
      `_failed_` database after a promote that died at `git merge` has no way
      to tell it from a half-migrated one, and the honest answer is "go and
      look" instead of "they are the same".
    */
    await runPowerShell(
      writeHarness(install, "ff-failed.ps1", [
        "function Stop-TheApp { return [pscustomobject]@{ Stopped = @(); Foreign = '' } }",
        "function Start-TheApp { return $true }",
        "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
        `$r = Invoke-PromoteFailedRollout -Log $log -App $app -StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } ` +
          `-Database '${FAKE_DB}' -Copy '${FAKE_COPY}' -Failed '${FAKE_FAILED}' ` +
          "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter' " +
          "-Why 'the fast-forward could not run' -RestoreBuild $false",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "swapped=$($r.Swapped);paperUp=$($r.PaperUp)" -Encoding ASCII`,
      ]),
    );
    assert.equal(read(join(install.app, "result.txt")).trim(), "swapped=True;paperUp=True");

    const log = read(newestLog(install.app));
    assert.match(log, /The build had not started, so nothing had been migrated:/, "a failure before the build does not say the database was never migrated");
    assert.match(log, /that database holds exactly the same data as the one the paper is serving\./);
    assert.doesNotMatch(log, /migrations may have run|the database was already migrated to/, "a failure before the build warned about a migration that never ran");
  } finally {
    await cleanup(install);
  }
});

test("the hand rollback refuses while the paper is answering, and says what it would do", windowsOnly, async () => {
  const install = makeInstall();
  try {
    // The state the plan is built from: the copy is on the server and so is
    // the database it would replace, and both have sizes.
    fakeDbAnswer(install, "state", {
      command: "state",
      ok: true,
      refusal: "",
      databases: {
        [FAKE_DB]: { exists: true, sizeBytes: 640000000 },
        [FAKE_COPY]: { exists: true, sizeBytes: 597688320 },
        [FAKE_FAILED]: { exists: false, sizeBytes: 0 },
      },
    });
    fakeDbAnswer(install, "wait-for-zero", { command: "wait-for-zero", ok: true, connections: [], refusal: "" });
    fakeDbAnswer(install, "swap-back", {
      command: "swap-back",
      ok: true,
      refusal: "",
      database: FAKE_DB,
      copy: FAKE_COPY,
      failed: FAKE_FAILED,
      steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`],
      sizeBytes: 597688320,
      seconds: 0.5,
    });

    const harnessFor = (name, answering, extra) =>
      writeHarness(install, name, [
        "function Stop-TheApp {",
        "  Add-Content -Path $env:FAKE_DB_LOG -Value 'app stop' -Encoding ASCII",
        "  return [pscustomobject]@{ Stopped = @('PID 4242'); Foreign = '' }",
        "}",
        "function Start-TheApp {",
        `  $version = Get-Content -Path ${psLiteral(join(install.app, ".output", "server", "version.txt"))} -Raw`,
        "  Add-Content -Path $env:FAKE_DB_LOG -Value \"app start $($version.Trim())\" -Encoding ASCII",
        "  return $true",
        "}",
        "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
        `$r = Invoke-PromoteDatabaseRollback -Log $log -App $app -Port 9999 -TestThePort { ${answering} } ` +
          "-StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } " +
          `-Copy '${FAKE_COPY}' -Database '${FAKE_DB}' -Stamp '20260110120000' ` +
          "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter' " +
          `${extra} ` +
          "-Announce { param($plan) Add-Content -Path $env:FAKE_DB_LOG -Value \"announce $plan\" -Encoding ASCII }",
        `Set-Content -Path (Join-Path $app 'result.txt') -Value "refused=$($r.Refused);dry=$($r.DryRun);swapped=$($r.Swapped);plan=$($r.Plan);failure=$($r.Failure)" -Encoding ASCII`,
      ]);

    // --- the paper is answering, and nobody said to stop it ------------------
    await runPowerShell(harnessFor("rollback-live.ps1", "$true", ""));
    const refused = read(join(install.app, "result.txt")).trim();
    assert.match(refused, /^refused=True;dry=False;swapped=False;/, `the rollback ran while the paper was answering: ${refused}`);
    assert.match(
      refused,
      /failure=The paper is answering on port 9999\. Stop it first, or run the promote's own recovery; nothing was changed\.$/,
      "the refusal is not the sentence the operator is promised",
    );
    // NOTHING was done. Not a rename, not a wait, not even a read of what is
    // on the server -- the guard above is the first thing this path does.
    assert.deepEqual(
      dbTrace(install),
      [],
      "the rollback touched the server, or stopped the app, before checking whether the paper was answering",
    );

    // --- -WhatIf: the same sentence, and still nothing -------------------------
    await runPowerShell(harnessFor("rollback-whatif.ps1", "$false", "-DryRun"));
    const dry = read(join(install.app, "result.txt")).trim();
    assert.match(dry, /^refused=False;dry=True;swapped=False;/, `-WhatIf did something: ${dry}`);
    // Names AND sizes, which is what tells an operator they have picked the
    // right copy.
    assert.match(
      dry,
      /plan=townreporter_prerollout_20260110120000 \(570 MB\) becomes townreporter; the current townreporter \(610\.4 MB\) is kept as townreporter_failed_20260110120000\./,
      "the plan does not name both databases with their sizes",
    );
    assert.deepEqual(
      dbTrace(install).filter((line) => line.startsWith("db ")),
      ["db state"],
      "-WhatIf renamed something: it may read what is there, and nothing else",
    );

    // --- not answering: it proceeds, and the same sentence is in the log ------
    const fresh = makeInstall();
    try {
      // `rollback`, not `swap-back`: the hand rollback is the manual mode of
      // the same library command, and the fake answers what it is asked.
      for (const [command, answer] of [
        ["state", { command: "state", ok: true, refusal: "", databases: { [FAKE_DB]: { exists: true, sizeBytes: 640000000 }, [FAKE_COPY]: { exists: true, sizeBytes: 597688320 } } }],
        ["wait-for-zero", { command: "wait-for-zero", ok: true, connections: [], refusal: "" }],
        ["rollback", { command: "rollback", ok: true, refusal: "", steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`], sizeBytes: 597688320, seconds: 0.5 }],
      ]) {
        fakeDbAnswer(fresh, command, answer);
      }
      writeFileSync(join(fresh.app, ".output", "server", "version.txt"), "serving now");
      mkdirSync(join(fresh.app, ".output-previous", "server"), { recursive: true });
      writeFileSync(join(fresh.app, ".output-previous", "server", "index.mjs"), "// the build before\n");
      writeFileSync(join(fresh.app, ".output-previous", "server", "version.txt"), "old");
      await runPowerShell(
        writeHarness(fresh, "rollback-down.ps1", [
          "function Stop-TheApp {",
          "  Add-Content -Path $env:FAKE_DB_LOG -Value 'app stop' -Encoding ASCII",
          "  return [pscustomobject]@{ Stopped = @(); Foreign = '' }",
          "}",
          "function Start-TheApp {",
          `  $version = Get-Content -Path ${psLiteral(join(fresh.app, ".output", "server", "version.txt"))} -Raw`,
          "  Add-Content -Path $env:FAKE_DB_LOG -Value \"app start $($version.Trim())\" -Encoding ASCII",
          "  return $true",
          "}",
          "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
          `$r = Invoke-PromoteDatabaseRollback -Log $log -App $app -Port 9999 -TestThePort { $false } ` +
            "-StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } " +
            `-Copy '${FAKE_COPY}' -Database '${FAKE_DB}' -Stamp '20260110120000' ` +
            "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter'",
          `Set-Content -Path (Join-Path $app 'result.txt') -Value "refused=$($r.Refused);swapped=$($r.Swapped);paperUp=$($r.PaperUp);failed=$($r.Failed);why=$($r.Failure)" -Encoding ASCII`,
        ]),
      );
      assert.equal(
        read(join(fresh.app, "result.txt")).trim(),
        `refused=False;swapped=True;paperUp=True;failed=${FAKE_FAILED};why=`,
        "a rollback with nothing answering on the port did not put the copy back",
      );
      const log = read(newestLog(fresh.app));
      assert.match(
        log,
        /townreporter_prerollout_20260110120000 \(570 MB\) becomes townreporter; the current townreporter \(610\.4 MB\) is kept as townreporter_failed_20260110120000\./,
        "the log does not say in plain words which database becomes live and which is set aside",
      );
      assert.ok(
        log.indexOf("becomes townreporter") < log.indexOf(`database: renamed ${FAKE_DB} -> ${FAKE_FAILED}`),
        "the plan was printed after the rename it describes",
      );
      // Nothing was stopped, because nothing was answering.
      assert.ok(!dbTrace(fresh).some((line) => line === "app stop"), "the rollback stopped an app that was not there");
      assert.equal(read(join(fresh.app, ".output", "server", "version.txt")).trim(), "old", "the build from before was not put back");
    } finally {
      await cleanup(fresh);
    }

    // --- -StopApp: the operator said so, and it stops by PID first ------------
    const stopping = makeInstall();
    try {
      for (const [command, answer] of [
        ["state", { command: "state", ok: true, refusal: "", databases: { [FAKE_DB]: { exists: true, sizeBytes: 640000000 }, [FAKE_COPY]: { exists: true, sizeBytes: 597688320 } } }],
        ["wait-for-zero", { command: "wait-for-zero", ok: true, connections: [], refusal: "" }],
        ["rollback", { command: "rollback", ok: true, refusal: "", steps: [`renamed ${FAKE_DB} -> ${FAKE_FAILED}`, `renamed ${FAKE_COPY} -> ${FAKE_DB}`], sizeBytes: 597688320, seconds: 0.5 }],
      ]) {
        fakeDbAnswer(stopping, command, answer);
      }
      writeFileSync(join(stopping.app, ".output", "server", "version.txt"), "serving now");
      mkdirSync(join(stopping.app, ".output-previous", "server"), { recursive: true });
      writeFileSync(join(stopping.app, ".output-previous", "server", "index.mjs"), "// the build before\n");
      writeFileSync(join(stopping.app, ".output-previous", "server", "version.txt"), "old");
      await runPowerShell(
        writeHarness(stopping, "rollback-stopapp.ps1", [
          "function Stop-TheApp {",
          "  Add-Content -Path $env:FAKE_DB_LOG -Value 'app stop' -Encoding ASCII",
          "  return [pscustomobject]@{ Stopped = @('PID 4242'); Foreign = '' }",
          "}",
          "function Start-TheApp {",
          `  $version = Get-Content -Path ${psLiteral(join(stopping.app, ".output", "server", "version.txt"))} -Raw`,
          "  Add-Content -Path $env:FAKE_DB_LOG -Value \"app start $($version.Trim())\" -Encoding ASCII",
          "  return $true",
          "}",
          "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
          `$r = Invoke-PromoteDatabaseRollback -Log $log -App $app -Port 9999 -TestThePort { $true } -StopApp ` +
            "-StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } " +
            `-Copy '${FAKE_COPY}' -Database '${FAKE_DB}' -Stamp '20260110120000' ` +
            "-DatabaseUrl 'postgres://promote:secret@127.0.0.1:5432/townreporter'",
          `Set-Content -Path (Join-Path $app 'result.txt') -Value "refused=$($r.Refused);swapped=$($r.Swapped);paperUp=$($r.PaperUp)" -Encoding ASCII`,
        ]),
      );
      assert.equal(
        read(join(stopping.app, "result.txt")).trim(),
        "refused=False;swapped=True;paperUp=True",
        "-StopApp did not carry on after stopping the app the operator pointed it at",
      );
      const trace = dbTrace(stopping);
      const stopped = traceIndex(trace, "app stop");
      const swapped = traceIndex(trace, "db rollback");
      const started = traceIndex(trace, "app start old");
      assert.ok(stopped < swapped, "the app was not stopped before the database was renamed under it");
      assert.ok(swapped < started, "the app was started before the database was put back");
    } finally {
      await cleanup(stopping);
    }
  } finally {
    await cleanup(install);
  }
});

test("the REAL database library, through the detached runner, refuses the live port with exit 3", windowsOnly, async () => {
  /*
    Every other test in this file drives a fake `node`. This one runs the real
    ops\lib-promote-db.mjs, as the promotion runs it -- through
    Invoke-PromoteChild, detached, output redirected to a file -- and reads
    what comes back the way the promotion reads it: the JSON on stdout and the
    real exit code.

    The URL is 5433 with a host that cannot resolve, and the live-promote flag
    is not set, so the guard refuses before anything is dialled. `.invalid` is
    RFC 2606 and no resolver answers for it: if the guard were missing, this
    would fail on the connection rather than reaching a real server.
  */
  const install = makeInstall();
  try {
    const lib = join(OPS, "lib-promote-db.mjs");
    const harness = writeHarness(install, "real-cli.ps1", [
      `$node = ${psLiteral(process.execPath)}`,
      `$lib = ${psLiteral(lib)}`,
      "$env:PROMOTE_DB_ADMIN_URL = 'postgres://promote:secret@townreporter-live.invalid:5433/townreporter'",
      "$env:PROMOTE_DB_DATABASE_URL = $env:PROMOTE_DB_ADMIN_URL",
      "$env:PROMOTE_DB_DATABASE = 'townreporter'",
      "$env:PROMOTE_DB_COPY = 'townreporter_prerollout_20260110120000'",
      "$env:PROMOTE_DB_FAILED = 'townreporter_failed_20260110120000'",
      "$env:PROMOTE_DB_STAMP = '20260110120000'",
      "$env:PROMOTE_DB_WAIT_SECONDS = '1'",
      "$env:PROMOTE_DB_TIMEOUT_SECONDS = '1'",
      "$env:PROMOTE_DB_LIVE_PROMOTE = ''",
      "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
      '$r = Invoke-PromoteChild -Log $log -Step \'dbcopy\' -Command "`"$node`" `"$lib`" preflight"',
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "exit=$($r.ExitCode);completed=$($r.Completed)" -Encoding ASCII`,
    ]);
    await runPowerShell(harness);

    // The exit code the promotion reads, which comes from the child's own
    // PROMOTE_EXIT line -- not from Start-Process, whose ExitCode is empty on
    // Windows PowerShell 5.1.
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      "exit=3;completed=True",
      "the real library did not refuse the live port with exit 3",
    );

    // ...and the JSON answer, read out of the file the log names.
    const out = read(stepOutputFile(install.app, "dbcopy"));
    const line = out.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop();
    assert.ok(line, `the real library printed no JSON: ${out}`);
    const report = JSON.parse(line);
    assert.equal(report.ok, false);
    assert.equal(report.command, "preflight");
    assert.match(String(report.refusal), /port 5433/);
    assert.match(String(report.refusal), /PROMOTE_DB_LIVE_PROMOTE=1/);
    assert.match(String(report.refusal), /Nothing was changed and the paper was not touched\./);
    // A refusal, not a crash: exit 1 is "it broke", 3 is "it refused".
    assert.match(out, /PROMOTE_EXIT=3/);
    assert.doesNotMatch(String(report.error ?? ""), /ECONNREFUSED|ENOTFOUND|getaddrinfo/, "the guard let the connection through");
  } finally {
    await cleanup(install);
  }
});

test("every rollback command the script or the docs print is one the parser accepts", windowsOnly, async () => {
  /*
    MAJOR M1. The script and the docs printed the copy's name with a HYPHEN in
    the stamp -- `..._prerollout_20261001-120000` -- and Get-PromoteCopyStamp
    looks for fourteen digits, so it returned nothing for the very name the
    operator had just been told to paste. The command refuses when the name is
    not a copy's, so the one thing the promotion offers an operator whose
    release went wrong did not work.

    This test does not read the strings and hope. It GENERATES the command the
    way the promotion generates it, from a copy name the library builds, and
    then parses that name back with the same parser the refusal uses.
  */
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "rollback-command.ps1", [
      // The name a real run would have: `<db>_prerollout_<yyyyMMddHHmmss>`.
      "$copy = 'townreporter_prerollout_' + (Get-Date -Format 'yyyyMMddHHmmss')",
      "$command = Get-PromoteRollbackCommand -App $app -Copy $copy",
      `Set-Content -Path (Join-Path $app 'command.txt') -Value $command -Encoding ASCII`,
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "copy=$copy;stamp=$(Get-PromoteCopyStamp -Copy $copy)" -Encoding ASCII`,
    ]);
    await runPowerShell(harness);

    const printed = read(join(install.app, "command.txt")).trim();
    const match = /-RollbackDatabase (\S+)\s*$/.exec(printed);
    assert.ok(match, `the printed command does not end with a copy name to paste: ${printed}`);
    /** @type {string} */
    const pasted = match[1];

    // The parser the rollback itself runs, over the name the operator pastes.
    const result = read(join(install.app, "result.txt")).trim();
    assert.match(result, /^copy=townreporter_prerollout_\d{14};stamp=\d{14}$/, `Get-PromoteCopyStamp rejects the name the promotion prints: ${result}`);
    const stamp = result.slice(result.indexOf("stamp=") + "stamp=".length);
    assert.equal(parseCopyStamp(pasted), stamp, "the library's parser disagrees with the script's about the printed name");
    assert.equal(isCopyOf(pasted, "townreporter"), true, "the printed name is not a copy of the database it replaces");
    // And the generated one is exactly what the library would build.
    assert.equal(pasted, copyDatabaseName("townreporter", stamp));

    // Everything ELSE the script or the docs print has to be the same shape.
    // A doc is where a name is most likely to be typed by hand and get it
    // wrong, and a doc is what an operator reads at 2 AM.
    for (const [label, text] of [
      ["SELF-HOSTING.md", readFileSync(join(ROOT, "SELF-HOSTING.md"), "utf8")],
      ["ops/promote.ps1", readFileSync(join(OPS, "promote.ps1"), "utf8")],
    ]) {
      const printedNames = [...text.matchAll(/townreporter[a-z_]*_prerollout_([0-9A-Za-z-]+)/g)];
      assert.ok(printedNames.length > 0, `${label} no longer shows a rollback command at all`);
      for (const found of printedNames) {
        assert.match(
          found[1],
          /^\d{14}$/,
          `${label} prints a copy name whose stamp is not fourteen digits (${found[0]}) -- Get-PromoteCopyStamp returns nothing for it, so the pasted command refuses`,
        );
      }
    }
  } finally {
    await cleanup(install);
  }
});

test("whether to install is decided by what node_modules was built from, not by this run's fast-forward", windowsOnly, async () => {
  /*
    THE LOCKFILE TRAP, which the auditor found and the coordinator confirmed.

    `$lockBefore -ne $lockAfter` answers "did THIS run move the lockfile". On
    the first production rollout the checkout is fast-forwarded BY HAND first
    -- it has to be, it is still running the old promote script -- so the
    before hash is already the new lockfile, the two are equal, and the
    promotion skips `npm ci` and builds the release on the previous
    node_modules. Nothing fails; the release is just built against the wrong
    dependency tree.

    So the decision is the marker npm ci leaves behind when it succeeds.
  */
  const install = makeInstall();
  try {
    const hashA = "A".repeat(64);
    const hashB = "B".repeat(64);
    writeFileSync(join(install.app, "package-lock.json"), "{}\n");
    const marker = join(install.app, "node_modules", ".promote-lock-hash");

    const harness = writeHarness(install, "lockfile.ps1", [
      "$log = New-PromoteLog -App $app -Stamp '20260110-120000'",
      `$a = ${psLiteral(hashA)}`,
      `$b = ${psLiteral(hashB)}`,
      "function Decide($lock, $resume) {",
      "  $d = Test-PromoteNeedsInstall -App $app -LockHash $lock -ResumeAt $resume",
      "  return \"$($d.Needed)|$($d.Reason)\"",
      "}",
      // 1: nothing recorded yet -- the checkout may have been fast-forwarded by
      // hand, so there is no way to know what node_modules holds.
      "$noMarker = Decide $a ''",
      // 2: recorded, and it is exactly this lockfile.
      "$wrote = Set-PromoteInstalledLockHash -App $app -Hash $a",
      "$same = Decide $a ''",
      // 3: recorded, and the lockfile is a different one.
      "$different = Decide $b ''",
      // 4: a marker holding something that is not a hash is not a marker.
      `Set-Content -Path ${psLiteral(marker)} -Value 'not-a-hash' -Encoding ASCII`,
      "$garbage = Decide $a ''",
      "$garbageRead = Get-PromoteInstalledLockHash -App $app",
      // 5: no lockfile at all -- nothing to install from, and never was.
      "$noLock = Decide '' ''",
      // 6: -Resume at the install means the install it started never finished.
      "$resumed = Decide $a 'deps'",
      // 7: the round trip, and what a written marker looks like.
      "$rewrote = Set-PromoteInstalledLockHash -App $app -Hash $b",
      "$readBack = Get-PromoteInstalledLockHash -App $app",
      `Set-Content -Path (Join-Path $app 'result.txt') -Encoding ASCII -Value (@(
        "noMarker=$noMarker",
        "wrote=$wrote",
        "same=$same",
        "different=$different",
        "garbage=$garbage",
        "garbageRead=$garbageRead",
        "noLock=$noLock",
        "resumed=$resumed",
        "rewrote=$rewrote",
        "readBack=$readBack"
      ) -join ([char]10))`,
    ]);

    await runPowerShell(harness);
    const result = read(join(install.app, "result.txt")).trim();
    const line = (name) => result.split("\n").find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1) ?? "(missing)";

    // NO MARKER -> INSTALL. This is the auditor's case: the checkout is
    // already at the target, so before and after are equal and the old rule
    // said "skip".
    assert.match(line("noMarker"), /^True\|/, `a missing marker did not mean "install": ${line("noMarker")}`);
    assert.match(line("noMarker"), /no record here of what node_modules was installed from/, "the reason does not say what was missing");

    // The marker that a successful install leaves behind: same lockfile -> skip.
    assert.equal(line("wrote"), "True", "the marker was not written");
    assert.match(line("same"), /^False\|node_modules was installed from exactly this lockfile$/, `an install was run for a lockfile that was already installed: ${line("same")}`);

    // A different lockfile -> install, and the reason names both hashes.
    assert.match(line("different"), /^True\|/, "a changed lockfile did not mean install");
    assert.match(line("different"), new RegExp(hashA), "the reason does not say what was installed");
    assert.match(line("different"), new RegExp(hashB), "the reason does not say what is on disk now");

    // A half-written or foreign marker is treated exactly like a missing one.
    assert.match(line("garbage"), /^True\|/, "a marker that is not a hash was trusted");
    assert.equal(line("garbageRead"), "", "a marker that is not a hash was read back as one");

    // No lockfile: nothing to install from, and that is not a change.
    assert.match(line("noLock"), /^False\|there is no package-lock\.json here/);

    // -Resume at the install: the previous run's install never finished.
    assert.match(line("resumed"), /^True\|the previous run stopped at this step/);

    // The round trip, and that the marker is stored as the hash it was given.
    assert.equal(line("readBack"), hashB, "the marker did not read back as the hash that was written");
    assert.equal(read(marker).trim(), hashB, "the marker on disk is not the hash");
  } finally {
    await cleanup(install);
  }
});

test("the install marker is written after a successful install, and nowhere a failure can reach", () => {
  /*
    The marker is the record of a FINISHED install. Written anywhere else it
    would be a guess, and the whole point of it is that it is not one -- a
    marker left over from an install that died half way would tell the next
    promotion that node_modules is built from a lockfile it never finished
    installing.
  */
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
  const at = (needle, what) => {
    const index = src.indexOf(needle);
    assert.ok(index > -1, `${what} (${JSON.stringify(needle)}) is not in promote.ps1`);
    return index;
  };
  const failed = at('Die "npm ci did not succeed', "the failed-install branch");
  const wrote = at("Set-PromoteInstalledLockHash -App $app -Hash $lockAfter", "the marker write");
  assert.ok(wrote > failed, "the marker is written before the failed install is reported, so a failed install can leave one behind");
  assert.equal(
    [...src.matchAll(/Set-PromoteInstalledLockHash/g)].length,
    1,
    "the marker is written from more than one place, which is how one of them ends up on a failure path",
  );
  // ...and the decision itself does not use the before/after pair any more.
  assert.match(src, /\$install = Test-PromoteNeedsInstall -App \$app -LockHash \$lockAfter -ResumeAt "\$resumeAt"/, "promote.ps1 no longer asks what node_modules was built from");
  assert.doesNotMatch(src, /\$mustInstall = \(\$lockBefore -ne \$lockAfter\)/, "the before/after comparison is back as the decider");
  // The two hash lines stay: scripts\ci-hash-no-module.ps1 lifts exactly these
  // two out and runs them in a session that cannot reach Get-FileHash.
  assert.equal([...src.matchAll(/^\$lock(Before|After) = if \(Test-Path/gm)].length, 2, "the two lockfile hash lines the CI fixture lifts out are gone");
});

test("a resumed run takes the copy's freshness from the copy step, not from the run's start second", windowsOnly, async () => {
  /*
    BLOCKER B3, and the timestamps here are the whole test.

    A promotion's copy is NAMED after the second the run started, and the stop
    happens later -- 41 seconds later in this fixture, which is what a real
    promotion's backup step costs. The freshness check used to compare the
    stamp inside that NAME with the stop's time, so it asked "12:00:00 >=
    12:00:41", answered no, and killed every `-Resume` that had reached the
    copy. Only a run whose backup finished inside the same second as its own
    start ever passed.

    So this writes the log by hand with the three times spelled out, and
    asserts BOTH answers: the old comparison says no (that is the bug, held
    here so it cannot come back) and the real one says yes.
  */
  const install = makeInstall();
  try {
    const runStart = "2026-01-10 12:00:00";
    const stopped = "2026-01-10 12:00:41";
    const copied = "2026-01-10 12:00:44";
    const copy = "townreporter_prerollout_20260110120000";
    const failed = "townreporter_failed_20260110120000";
    const logPath = join(install.app, "logs", "promote-20260110-120000.log");

    const harness = writeHarness(install, "resume-copy.ps1", [
      "$dir = Join-Path $app 'logs'",
      "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
      `$path = ${psLiteral(logPath)}`,
      "$started = @(",
      `  '[${runStart}] promote started: the install (port 9999), pid 1, arguments: ''-Resume'''`,
      `  '[${stopped}] step=stop ok (3s): stopped PID 5'`,
      `  '[${copied}] step=dbcopy ok (4s): copied townreporter -> ${copy} (570 MB)'`,
      `  '[${copied}] promote-db: database=townreporter copy=${copy} failed=${failed}'`,
      `  '[${copied}] step=ff started -- fetch and fast-forward to origin/main'`,
      ")",
      "Set-Content -Path $path -Value $started -Encoding ASCII",
      "New-PromoteMarker -App $app | Out-Null",
      "$p = Get-PromoteResumePoint -App $app",
      "$fresh = Test-PromoteCopyFreshness -CopyAt $p.CopyAt -StopAt $p.StopAt",
      // The bug, computed the way the old code computed it: the copy's NAME
      // stamp against the stop. It must still say no -- that is why it was
      // wrong, not a coincidence of this fixture.
      "$oldStamp = Get-PromoteCopyStamp -Copy $p.Copy",
      "$oldStyle = ([datetime]::ParseExact($oldStamp, 'yyyyMMddHHmmss', $null) -ge [datetime]::ParseExact($p.StopAt, 'yyyy-MM-dd HH:mm:ss', $null))",
      "$noCopyAt = Test-PromoteCopyFreshness -CopyAt '' -StopAt $p.StopAt",
      "$noStopAt = Test-PromoteCopyFreshness -CopyAt $p.CopyAt -StopAt ''",
      // A copy the log shows being taken BEFORE the stop: still refused.
      "$stale = @(",
      `  '[${runStart}] promote started: the install (port 9999), pid 1, arguments: ''-Resume'''`,
      `  '[2026-01-10 12:00:30] step=dbcopy ok (4s): copied townreporter -> ${copy} (570 MB)'`,
      `  '[${stopped}] step=stop ok (3s): stopped PID 5'`,
      ")",
      "Set-Content -Path $path -Value $stale -Encoding ASCII",
      "$p2 = Get-PromoteResumePoint -App $app",
      "$staleFresh = Test-PromoteCopyFreshness -CopyAt $p2.CopyAt -StopAt $p2.StopAt",
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "next=$($p.NextStep);db=$($p.Database);copy=$($p.Copy);failed=$($p.Failed);stop=$($p.StopAt);copyAt=$($p.CopyAt);fresh=$fresh;oldStamp=$oldStamp;oldStyle=$oldStyle;noCopyAt=$noCopyAt;noStopAt=$noStopAt;staleFresh=$staleFresh;staleNext=$($p2.NextStep)" -Encoding ASCII`,
    ]);

    await runPowerShell(harness);
    const result = read(join(install.app, "result.txt")).trim();

    // The names survive the run that took them: a resumed run has to know what
    // to put back, and where.
    assert.match(result, /^next=ff;db=townreporter;copy=townreporter_prerollout_\d{14};failed=townreporter_failed_\d{14};/);
    // The two times are the log's own step lines, and they are not the same
    // second -- which is the situation that used to be impossible to resume.
    assert.ok(
      result.includes(`stop=${stopped};copyAt=${copied}`),
      `the resume point is not reading the stop and copy step times: ${result}`,
    );

    /*
      The bug and the fix, side by side. `oldStyle` is the comparison that was
      there before: the copy's name stamp (the run's START second) against the
      stop. It says False. The real check, on the same log, says True.
    */
    assert.match(result, /oldStamp=20260110120000;oldStyle=False;/, `the fixture no longer reproduces B3: ${result}`);
    assert.match(result, /fresh=True;/, `a copy taken 3s after the stop is still refused: ${result}`);

    // Nothing to compare against is not a pass, and a copy the log shows being
    // taken before the stop is refused.
    assert.match(result, /noCopyAt=False;noStopAt=False;staleFresh=False;/, `the freshness check is wrong: ${result}`);
    // ...and the stale log's own resume point is still readable, so the
    // refusal above is about freshness and not about an unreadable log.
    assert.match(result, /staleNext=dbcopy$/, `the stale log did not parse: ${result}`);
  } finally {
    await cleanup(install);
  }
});

test("promote.ps1 tells the fallback what it knows about the database", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");

  // Step 8's failure path runs after the build step finished -- this run's or
  // the resumed one's -- and the build step ends in db:migrate, so the database
  // is on the new schema while the old build serves it. This has to say 'yes'
  // and carry the build's own output, or the note never appears where it
  // matters. Since PR2 it is the whole recovery that is called, because the
  // database has to go back before the old build is started.
  assert.match(
    src,
    /Invoke-PromoteRolloutFailure[^\n]*-MigrationsRan 'yes' -BuildOutput \$buildOutputFile/,
    "the recovery after a failed health check no longer says the database was migrated",
  );
  // The build's own failure path must NOT claim to know: it died part way, so
  // Invoke-PromoteBuild asks the build's output how far it got, and hands the
  // answer to the recovery through -Recover.
  assert.match(src, /\$buildOutputFile = \$built\.OutFile/, "the build's output is not kept for the fallback that follows it");
  assert.match(src, /Get-PromoteHealthTimeoutSeconds/, "the health wait is back to a bare number in promote.ps1");
  assert.match(src, /-Recover \{/, "the build's failure no longer runs the recovery");
  assert.match(src, /Invoke-PromoteRolloutFailure -Why "the build did not succeed" -MigrationsRan \$migrations -BuildOutput \$output/);
});

test("promote.ps1 carries the hand rollback the unit promised, wired to the same swap", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");
  const lib = readFileSync(join(OPS, "lib-promote.ps1"), "utf8");

  // The parameter exists and the script acts on it BEFORE its own flow: an
  // operator running this is mid-incident with a promotion that stopped half
  // way, and "an earlier promotion did not finish" must not be what stands
  // between them and the paper coming back.
  assert.match(src, /\[string\]\$RollbackDatabase = ""/, "promote.ps1 no longer accepts -RollbackDatabase");
  const at = (haystack, needle, what) => {
    const index = haystack.indexOf(needle);
    assert.ok(index > -1, `${what} (${JSON.stringify(needle)}) is not there`);
    return index;
  };
  assert.ok(
    at(src, "if ($RollbackDatabase)", "the rollback branch") < at(src, "--- 0. is there an unfinished run", "the resume check"),
    "the rollback runs after the unfinished-run check, so a stopped promotion would block it",
  );

  // The entry point is a thin one: the ordering lives in the library, where
  // the test above drives it with fakes. What has to be true here is that this
  // script hands it the things only this script has -- its port probe, its
  // stop, its start -- and that it carries the operator's two switches.
  assert.match(src, /\[switch\]\$StopApp/, "promote.ps1 no longer accepts -StopApp");
  assert.ok(
    // The call is written across several lines with backtick continuations, so
    // this asks for the one line that matters rather than a whole call.
    src.includes("-TestThePort { Test-PromotePaperUp -Port ([int]$port) }"),
    "the hand rollback no longer probes the port with the script's own check",
  );
  assert.match(src, /-StopApp:\$StopApp -DryRun:\$WhatIfPreference/, "the hand rollback does not carry the operator's -StopApp and -WhatIf");
  assert.match(src, /Invoke-PromoteRollback[^\n]*-StopApp:\$StopApp/, "the -StopApp switch is not passed to the rollback");

  // It is the SAME swap as the automatic one, in the same library, with the
  // wording turned to "manual" -- a second implementation of the renames is
  // how one of them ends up wrong.
  // It is the last function in the library, so this is the whole of it.
  const rollback = lib.slice(at(lib, "function Invoke-PromoteDatabaseRollback", "the rollback function"));
  const pos = (needle) => {
    const index = rollback.indexOf(needle);
    assert.ok(index > -1, `the hand rollback no longer mentions ${needle}`);
    return index;
  };
  /*
    The order, read out of the function rather than run: ask the port FIRST,
    plan with the sizes, stop the app only if the operator said so, swap, put
    the old build back, start it.

    Asking the port first is the whole of addendum (b) -- a promotion that
    failed its own health checks leaves the paper UP and serving, which is
    exactly the case this command is printed for, and swapping a database out
    from under a live app is not something to arrive at by accident.
  */
  const probed = pos("& $TestThePort");
  const announced = pos("if ($Announce)");
  const swapped = pos("Invoke-PromoteDatabaseSwapBack");
  const restored = pos("Resolve-PromotePreviousBuild");
  assert.ok(probed < swapped, "the hand rollback swaps before asking whether the paper is answering");
  assert.ok(probed < announced, "the hand rollback announces the plan before it has checked the port");
  assert.ok(announced < swapped, "the hand rollback renames before printing what it is about to do");
  assert.ok(swapped < restored, "the hand rollback puts the build back before the database, so it would start the old build on the new schema");
  assert.match(rollback, /-Mode 'manual'/, "the hand rollback is not the manual mode of the same swap");
  assert.match(
    rollback,
    /The paper is answering on port \$Port\. Stop it first, or run the promote's own recovery; nothing was changed\./,
    "the refusal while the paper is answering is not the sentence the unit promised",
  );
  assert.match(rollback, /\$paperUp -and -not \$StopApp/, "the port check no longer refuses unless -StopApp was passed");
  assert.match(lib, /Invoke-PromoteDatabaseSwapBack[^\n]*-Mode 'recovery'/, "the automatic recovery no longer goes through the same swap-back");

  // The one command the operator is told to run, and the warning that has to
  // come with it.
  assert.match(lib, /function Get-PromoteRollbackCommand/, "the rollback command is gone");
  assert.match(lib, /-RollbackDatabase \$Copy/, "the printed command does not carry the copy's name");
  assert.match(src, /ANYTHING WRITTEN SINCE THE NEW APP STARTED IS LOST/, "the cost of the hand rollback is no longer said out loud");
  assert.match(src, /Show-RollbackOffer \$rollbackCommand/, "a promotion that ends badly no longer offers the rollback");

  // And the last line of a failed run's log says which database holds what.
  // Log FILE only, through the library's own writer: the command that brings
  // the paper back is the last thing an operator SEES, and the test above
  // holds that. The record gets its closing line underneath it.
  assert.match(lib, /function Write-PromoteLogFileOnly/, "the log-only writer is gone");
  assert.doesNotMatch(
    lib.slice(lib.indexOf("function Write-PromoteLogFileOnly"), lib.indexOf("function Get-PromoteStepOrder")),
    /Write-Host/,
    "the log-only writer prints to the console, so the recovery command is no longer the last line an operator sees",
  );
  assert.match(src, /\$closing = "END\. \$msg"/, "the last line of a failed run's log no longer closes the record");
  assert.match(
    src,
    /\$closing \+= " Databases: \$dbNote\."/,
    "the last line of a failed run's log no longer says which database holds what",
  );
  assert.match(src, /Write-PromoteLogFileOnly \$log \$closing/, "the closing line is not written through the log-only writer");
  assert.match(src, /\$dbNote = "the paper's database is \$dbName"/, "the log no longer names the databases at the end of a failed run");
});
