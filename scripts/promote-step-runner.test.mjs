import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

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
  return { root, app, fakes, hangChild };
}

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

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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
function cleanup(install) {
  const pid = Number(read(join(install.app, "hang-child-pid.txt")).trim());
  if (Number.isFinite(pid) && pid > 0 && isRunning(pid)) {
    try {
      killTree(pid);
    } catch {
      // best effort: the test has already failed, and this is only tidying
    }
  }
  rmSync(install.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
    cleanup(install);
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
    cleanup(install);
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
    cleanup(install);
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
    rmSync(failed.root, { recursive: true, force: true });
    rmSync(finished.root, { recursive: true, force: true });
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
      cleanup(install);
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
    rmSync(over.root, { recursive: true, force: true });
    rmSync(under.root, { recursive: true, force: true });
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
      cleanup(install);
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
      rmSync(migrated.root, { recursive: true, force: true });
      rmSync(bundler.root, { recursive: true, force: true });
    }
  },
);

test("the built-in limits are the ones the operator is told about", windowsOnly, async () => {
  const install = makeInstall();
  try {
    const harness = writeHarness(install, "limits.ps1", [
      `Set-Content -Path (Join-Path $app 'result.txt') -Value "deps=$(Get-PromoteChildTimeoutSeconds -Step 'deps');build=$(Get-PromoteChildTimeoutSeconds -Step 'build');verify=$(Get-PromoteChildTimeoutSeconds -Step 'verify');health=$(Get-PromoteHealthTimeoutSeconds)" -Encoding ASCII`,
    ]);
    await runPowerShell(harness);
    assert.equal(
      read(join(install.app, "result.txt")).trim(),
      // Twenty minutes for each of the two long steps -- under the watchdog's
      // 30-minute stand-down, so a hung step fails the promotion before the
      // watchdog can start the app on a half-written tree. One minute for the
      // health wait, which is what this install has always used and is shorter
      // than the five it is allowed.
      "deps=1200;build=1200;verify=0;health=60",
      "the step limits changed without the operator-facing docs changing with them",
    );
  } finally {
    cleanup(install);
  }
});

test("promote.ps1 tells the fallback what it knows about the database", () => {
  const src = readFileSync(join(OPS, "promote.ps1"), "utf8");

  // Step 8's fallback runs after the build step finished -- this run's or the
  // resumed one's -- and the build step ends in db:migrate, so the database is
  // on the new schema while the old build serves it. This has to say 'yes' and
  // carry the build's own output, or the note never appears where it matters.
  assert.match(
    src,
    /Invoke-PromoteFallback[^\n]*-MigrationsRan 'yes' -BuildOutput \$buildOutputFile/,
    "the fallback after a failed health check no longer says the database was migrated",
  );
  // The build's own failure path must NOT claim to know: it died part way, so
  // Invoke-PromoteBuild asks the build's output how far it got.
  assert.match(src, /\$buildOutputFile = \$built\.OutFile/, "the build's output is not kept for the fallback that follows it");
  assert.match(src, /Get-PromoteHealthTimeoutSeconds/, "the health wait is back to a bare number in promote.ps1");
});
