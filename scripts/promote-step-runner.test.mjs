import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
 * A fake `npm`. `ci` always succeeds; `run build` in FAKE_NPM_MODE=buildfail
 * deletes .output -- which is what a build that dies part way through leaves
 * behind -- and exits 1.
 *
 * Written without parenthesised blocks on purpose: a batch `if (...)` block
 * parses its whole body up front, and this file has enough ways to go wrong
 * already.
 */
const FAKE_NPM = [
  "@echo off",
  "if not \"%FAKE_NPM_MODE%\"==\"buildfail\" goto ok",
  "echo [fake npm] vite build starting",
  "rmdir /s /q .output",
  "echo [fake npm] the build exploded 1>&2",
  "exit /b 1",
  ":ok",
  "echo [fake npm] %*",
  "exit /b 0",
  "",
].join("\r\n");

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
  const fakes = join(root, "fakes");
  mkdirSync(fakes, { recursive: true });
  writeFileSync(join(fakes, "npm.cmd"), FAKE_NPM);
  writeFileSync(join(root, "slow-child.mjs"), SLOW_CHILD);
  return { root, app, fakes };
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

function runPowerShell(file, { timeout = 120_000, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
      cwd: ROOT,
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
    rmSync(install.root, { recursive: true, force: true });
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
    rmSync(install.root, { recursive: true, force: true });
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
    rmSync(install.root, { recursive: true, force: true });
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
