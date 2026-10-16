/**
 * Get-TownReporterClusterPort (ops/lib-ownership.ps1) reads the port a cluster
 * will listen on from its config files. A boot-start task runs with a full
 * administrator token, and postgres.exe refuses to run under one, so the
 * legacy ownership check cannot ask postgres.exe for the port any more.
 *
 * These tests drive the REAL function in a fresh PowerShell against temp
 * fixture folders. Nothing here starts, stops or connects to Postgres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "ops", "lib-ownership.ps1");
const onWindows = process.platform === "win32";
const SKIP = !onWindows ? "PowerShell only" : false;

const FIXTURE_TEXT = [
  "param([string]$Lib, [string]$DataDir, [string]$PgBin)",
  "$ErrorActionPreference = 'Stop'",
  ". $Lib",
  "try {",
  "  Write-Output ('PORT=' + (Get-TownReporterClusterPort -DataDir $DataDir -PgBin $PgBin))",
  "} catch {",
  "  Write-Output ('THREW=' + $_.Exception.Message)",
  "}",
  "",
].join("\r\n");

/**
 * Runs the fixture once and returns its single result line: "PORT=<n>" when
 * the function returned, or "THREW=<message>" when it refused.
 *
 * withStub: a postgres.exe that is really a copy of powershell.exe. It rejects
 * the `-D` switch and exits non-zero, which is how a failing postgres.exe looks
 * from here, so a test can prove the fallback ran and failed.
 */
function readPort({ conf, auto, withStub = false }) {
  const dataDir = mkdtempSync(join(tmpdir(), "cluster-port-"));
  const harness = mkdtempSync(join(tmpdir(), "cluster-port-harness-"));
  const bin = mkdtempSync(join(tmpdir(), "cluster-port-bin-"));
  try {
    if (conf !== undefined) writeFileSync(join(dataDir, "postgresql.conf"), conf);
    if (auto !== undefined) writeFileSync(join(dataDir, "postgresql.auto.conf"), auto);
    const fixture = join(harness, "read-port.ps1");
    writeFileSync(fixture, FIXTURE_TEXT);
    const args = [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", fixture, "-Lib", LIB, "-DataDir", dataDir,
    ];
    if (withStub) {
      const powershellExe = join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      copyFileSync(powershellExe, join(bin, "postgres.exe"));
      args.push("-PgBin", bin);
    }
    let out = "";
    try {
      out = execFileSync("powershell.exe", args, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    const line = out.split(/\r?\n/).find((l) => /^(PORT|THREW)=/.test(l));
    assert.ok(line, `the fixture printed no result line:\n${out}`);
    return line;
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
}

test("an active port line in postgresql.conf is the port", { skip: SKIP }, () => {
  assert.equal(readPort({ conf: "listen_addresses = '127.0.0.1'\nport = 5433\n" }), "PORT=5433");
});

test("a commented port line is not a setting, so the 5432 default applies", { skip: SKIP }, () => {
  assert.equal(readPort({ conf: "#port = 5433\n" }), "PORT=5432");
});

test("postgresql.auto.conf is read after postgresql.conf and wins", { skip: SKIP }, () => {
  assert.equal(readPort({ conf: "port = 5433\n", auto: "port = '5544'\n" }), "PORT=5544");
});

test("with two active port lines in one file the last one wins", { skip: SKIP }, () => {
  assert.equal(readPort({ conf: "port = 5433 # live\nport = 5435  # moved\n" }), "PORT=5435");
});

test("no port setting anywhere means the 5432 default", { skip: SKIP }, () => {
  assert.equal(readPort({ conf: "shared_buffers = 128MB\n" }), "PORT=5432");
});

test("a port value that is not a number is refused, not guessed", { skip: SKIP }, () => {
  assert.match(readPort({ conf: "port = abc\n" }), /^THREW=.*not a whole number/);
});

test("an active include is not followed: with no postgres.exe the refusal names the include", { skip: SKIP }, () => {
  const line = readPort({ conf: "include 'x.conf'\nport = 5433\n" });
  assert.match(line, /^THREW=/);
  assert.match(line, /include 'x\.conf'/);
});

test("an active include falls back to postgres.exe, and a failing postgres.exe is named with the include", { skip: SKIP }, () => {
  const line = readPort({ conf: "include 'x.conf'\nport = 5433\n", withStub: true });
  assert.match(line, /^THREW=/, "the fallback must run and fail here, not return a port");
  assert.match(line, /include 'x\.conf'/);
  assert.match(line, /postgres\.exe/);
});
