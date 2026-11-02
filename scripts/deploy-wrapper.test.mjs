import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/*
 * Finding G01-DEP-1 (Nov 1 2026). ops/deploy-production.ps1 used to run
 * promote as `& powershell ... *> file`. The app that promote starts keeps a
 * copy of that output pipe open, so the wrapper waited forever: the elevated
 * helper killed it after an hour and the finally block (put .env back, turn
 * the watchdog back on) never ran.
 *
 * The Windows test below copies the wrapper into a temp folder and runs it the
 * way the helper does (pipes on, wait for the process to exit). A fake promote
 * starts a long-lived child the same way Start-PromoteApp does, prints a line
 * and exits 3. Fake watchdog commands replace the real scheduled task, and a
 * fake .env replaces the real one, so nothing on this machine is touched.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = join(ROOT, "ops", "deploy-production.ps1");
const onWindows = process.platform === "win32";

test("deploy-production.ps1 waits for promote by PID, never on its output pipe", () => {
  const text = readFileSync(WRAPPER, "utf8");
  const code = text.replace(/<#[\s\S]*?#>/g, "").split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /&\s*powershell(\.exe)?\b[^\n]*\*>/i, "promote must not run as `& powershell ... *> file`");
  assert.match(code, /Start-Process\s+-FilePath\s+'powershell\.exe'[\s\S]*?-PassThru/, "promote must run through Start-Process -PassThru");
  assert.match(code, /-RedirectStandardOutput[\s\S]*?-RedirectStandardError/, "promote output must go to files");
  assert.match(code, /Wait-Process\s+-Id\s+\$promote\.Id/, "the wrapper must wait for the promote process by PID");
  assert.match(code, /finally\s*\{[\s\S]*Enable-ScheduledTask/, "the finally block must turn the watchdog back on");
  const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
  assert.equal(bad.length, 0, "ops/deploy-production.ps1 must stay ASCII (PowerShell 5.1 mangles other characters)");
});

/** Runs a script the way the elevated helper does: pipes read, wait for the process only. */
function runLikeHelper(script, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      resolve({ timedOut: true, seconds: (Date.now() - started) / 1000 });
    }, timeoutMs);
    // "exit", not "close": "close" waits for the pipes, which is the hang itself.
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, seconds: (Date.now() - started) / 1000 });
    });
  });
}

test("deploy-production.ps1 ends when promote ends, even while the app keeps running", { skip: !onWindows ? "PowerShell only" : false, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tr-deploy-wrapper-"));
  const appPidFile = join(dir, "app.pid");
  try {
    copyFileSync(WRAPPER, join(dir, "deploy-production.ps1"));
    const envFile = join(dir, "fake.env");
    const envBody = "DATABASE_URL=postgres://u@localhost:5433/townreporter\r\nOTHER=1\r\n";
    writeFileSync(envFile, envBody);
    const fakePromote = join(dir, "fake-promote.ps1");
    writeFileSync(fakePromote, [
      "param([switch]$WaitForJobs)",
      "# Starts a long-lived child the way Start-PromoteApp starts the app.",
      `$p = Start-Process -FilePath powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 90' -WindowStyle Hidden -PassThru -RedirectStandardOutput '${join(dir, "app.out")}' -RedirectStandardError '${join(dir, "app.err")}'`,
      `Set-Content -LiteralPath '${appPidFile}' $p.Id`,
      "if (-not (Select-String -LiteralPath '" + envFile + "' -Pattern '^PROMOTE_ADMIN_DATABASE_URL=' -Quiet)) { exit 7 }",
      "Write-Host 'Promoted (fake).'",
      "exit 3",
      "",
    ].join("\r\n"));
    const launcher = join(dir, "launch.ps1");
    writeFileSync(launcher, [
      "$global:watchdogOn = $true",
      "function Get-ScheduledTask { param($TaskName) [pscustomobject]@{ Settings = [pscustomobject]@{ Enabled = $global:watchdogOn } } }",
      `function Disable-ScheduledTask { param($TaskName) $global:watchdogOn = $false; Add-Content -LiteralPath '${join(dir, "watchdog.log")}' 'off' }`,
      `function Enable-ScheduledTask { param($TaskName) $global:watchdogOn = $true; Add-Content -LiteralPath '${join(dir, "watchdog.log")}' 'on' }`,
      `. '${join(dir, "deploy-production.ps1")}' -EnvFile '${envFile}' -PromoteScript '${fakePromote}'`,
      "# `exit` in a dot-sourced script ends only that script; pass its code on.",
      "exit $LASTEXITCODE",
      "",
    ].join("\r\n"));

    const run = await runLikeHelper(launcher, [], 60_000);
    assert.equal(run.timedOut, false, `the wrapper did not end within 60 s (the G01-DEP-1 hang)`);
    assert.ok(run.seconds < 30, `the wrapper took ${run.seconds} s`);
    assert.equal(run.code, 3, "the wrapper must exit with promote's exit code");

    const result = JSON.parse(readFileSync(join(dir, "deploy-result.json"), "utf8").replace(/^﻿/, ""));
    assert.equal(result.promoteExitCode, 3);
    assert.equal(result.watchdogWasEnabled, true);
    assert.equal(result.watchdogEnabledAfter, true);
    assert.equal(result.originalEnvironmentRestored, true);
    assert.equal(readFileSync(envFile, "utf8"), envBody, ".env must be byte-for-byte what it was");
    assert.deepEqual(readFileSync(join(dir, "watchdog.log"), "utf8").trim().split(/\r?\n/), ["off", "on"]);
    assert.match(readFileSync(join(dir, "promote-output.txt"), "utf8"), /Promoted \(fake\)\./);

    const appPid = Number(readFileSync(appPidFile, "utf8").trim());
    let appAlive = true;
    try { process.kill(appPid, 0); } catch { appAlive = false; }
    assert.ok(appAlive, "the app-like child must still be running after the wrapper ends");
  } finally {
    if (existsSync(appPidFile)) {
      const pid = Number(readFileSync(appPidFile, "utf8").trim());
      try { process.kill(pid); } catch { /* already gone */ }
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* the app may still hold a file for a moment */ }
  }
});
