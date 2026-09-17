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