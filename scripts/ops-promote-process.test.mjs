import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPS = join(ROOT, "ops");
const onWindows = process.platform === "win32";

test(
  "promote recognizes this install's Windows server command line and rejects unrelated Node",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    const lib = readFileSync(join(OPS, "lib-port.ps1"), "utf8");
    assert.match(lib, /function Test-TownReporterServerProcess/);

    const libPath = join(OPS, "lib-port.ps1").replace(/'/g, "''");
    const appPath = ROOT.replace(/'/g, "''");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. '${libPath}'`,
      `$app = '${appPath}'`,
      `$serverPath = Join-Path $app '.output\\server\\index.mjs'`,
      `$actual = [pscustomobject]@{ Name = 'node.exe'; CommandLine = ('"' + $serverPath + '" --port 3000') }`,
      `$other = [pscustomobject]@{ Name = 'node.exe'; CommandLine = '"C:\\other\\.output\\server\\index.mjs" --port 3000' }`,
      "if (-not (Test-TownReporterServerProcess -Process $actual -App $app)) { throw 'actual Windows TownReporter command line was rejected' }",
      "if (Test-TownReporterServerProcess -Process $other -App $app) { throw 'unrelated Node command line was accepted' }",
      "Write-Output 'TARGETED-PASS'",
    ].join("; ");

    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.match(output, /TARGETED-PASS/);
  },
);

/**
 * The watchdog's own "is this app?" question, run for real.
 *
 * On 2026-09-26 the paper stopped answering while a ten-minute backup ran.
 * The watchdog's next pass found the app's own node.exe on the port and
 * logged "PID 35156 (node.exe), which is not this app -- not touching it",
 * so the stalled server was never repaired. The cause was the pattern it
 * tested with: an inline `-notlike "*.output/server/index.mjs*"` against a
 * command line Windows reports with BACKSLASHES, which can never match, so
 * every port owner -- including our own server -- took the "not this app"
 * branch. `Test-TownReporterServerProcess` normalizes slashes and was never
 * reached; the watchdog now asks `Test-TownReporterBuiltServerProcess`, which
 * is the same normalization shared with it.
 *
 * The distinctions this holds, in order of how much damage getting them
 * wrong does:
 *
 *  - our own server, as Windows actually reports it, must be recognized
 *    (this is the outage above);
 *  - a DIFFERENT install of this app is a built server but NOT this
 *    checkout, so the watchdog must refuse rather than repair it -- the
 *    operator's box runs the live paper and a dev copy side by side;
 *  - a node.exe running something else entirely, and a non-node process,
 *    are neither, so the watchdog must not touch them at all.
 */
test(
  "the watchdog's port-owner check recognizes this app however Windows spells the path",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    const libPath = join(OPS, "lib-port.ps1").replace(/'/g, "''");
    const appPath = ROOT.replace(/'/g, "''");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. '${libPath}'`,
      `$app = '${appPath}'`,
      `$serverPath = Join-Path $app '.output\\server\\index.mjs'`,
      // A live app, exactly as Win32_Process reports it (the 9:01 PM line).
      `$ours = [pscustomobject]@{ Name = 'node.exe'; CommandLine = ('"C:\\Program Files\\nodejs\\node.exe" ' + $serverPath) }`,
      `$oursForward = [pscustomobject]@{ Name = 'node.exe'; CommandLine = ($serverPath -replace '\\\\', '/') }`,
      `$oursMixed = [pscustomobject]@{ Name = 'node.exe'; CommandLine = ('"C:/Program Files/nodejs/node.exe" ' + ($serverPath -replace '\\\\', '/')) }`,
      // A second install of this app: a built server, but not this checkout.
      `$otherInstall = [pscustomobject]@{ Name = 'node.exe'; CommandLine = '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\scott\\Desktop\\Code\\townreporter-dev\\.output\\server\\index.mjs' }`,
      `$otherNode = [pscustomobject]@{ Name = 'node.exe'; CommandLine = '"C:\\Program Files\\nodejs\\node.exe" C:\\other-app\\server.js' }`,
      `$notNode = [pscustomobject]@{ Name = 'nginx.exe'; CommandLine = ('"' + $serverPath + '"') }`,
      "function Check($p, $ours, $label) { $b = Test-TownReporterBuiltServerProcess -Process $p; $e = Test-TownReporterServerProcess -Process $p -App $app; if ([bool]$ours -ne [bool]$b) { throw \"$label : built-server expected $ours, got $b\" } ; if ([bool]$ours -ne [bool]$e) { throw \"$label : this-checkout expected $ours, got $e\" } }",
      "$e = Test-TownReporterServerProcess -Process $otherInstall -App $app; if ($e) { throw 'another install was accepted as this exact checkout' }",
      "$b = Test-TownReporterBuiltServerProcess -Process $otherInstall; if (-not $b) { throw 'another install must still read as a built server, so the watchdog can name it' }",
      "Check $ours $true 'backslash command line'",
      "Check $oursForward $true 'forward-slash command line'",
      "Check $oursMixed $true 'mixed-slash command line'",
      "Check $otherNode $false 'unrelated node.exe'",
      "Check $notNode $false 'non-node port owner'",
      "Write-Output 'WATCHDOG-OWNER-PASS'",
    ].join("; ");

    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.match(output, /WATCHDOG-OWNER-PASS/);
  },
);