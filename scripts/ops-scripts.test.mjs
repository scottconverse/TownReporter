import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPS = join(ROOT, "ops");

/**
 * The Windows operations layer ran in no automated check of any kind.
 *
 * These scripts keep the paper online: the watchdog restarts what has stopped,
 * the control panel is the operator's only non-terminal way in, and the tunnel
 * scripts are the difference between a public paper and a dark one. They are
 * also where three defects have already happened this week — a truthy single
 * CIM object, em-dash mojibake under PowerShell 5.1, and an inline start that
 * inherited console handles and hung for seven minutes.
 *
 * CI runs on Linux and cannot execute PowerShell meaningfully, so this checks
 * what is checkable everywhere: that the files exist, that they parse, and
 * that the specific mistakes already made cannot come back. Audit finding
 * TE-06.
 */

/** Every script the docs and the Server page depend on. */
const REQUIRED = [
  "watchdog.ps1",
  "run-tunnel.ps1",
  "restart-app.ps1",
  "restart-tunnel.ps1",
  "rotate-logs.ps1",
  "start-townreporter.ps1",
  "stop-townreporter.ps1",
  "status.ps1",
  "cron-tick.ps1",
  "run-hidden.vbs",
  "TownReporter Control.cmd",
];

test("every ops script the docs promise actually exists", () => {
  for (const name of REQUIRED) {
    assert.ok(existsSync(join(OPS, name)), `ops/${name} is referenced but missing`);
  }
});

test("no doc references an ops script that is not there", () => {
  const docs = [
    join(ROOT, "README.md"),
    join(ROOT, "SELF-HOSTING.md"),
    join(ROOT, "docs", "manual.md"),
    join(ROOT, "docs", "setup.md"),
  ].filter((p) => existsSync(p));
  const present = new Set(readdirSync(OPS));
  for (const doc of docs) {
    const text = readFileSync(doc, "utf8");
    for (const m of text.matchAll(/ops\/([A-Za-z0-9._ -]+\.(?:ps1|vbs|cmd|mjs))/g)) {
      assert.ok(
        present.has(m[1]),
        `${doc.split(/[\/]/).pop()} references ops/${m[1]}, which does not exist`,
      );
    }
  }
});

/**
 * Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so a non-ASCII
 * character comes out as mojibake and can truncate the line. The watchdog's
 * first version logged em-dashes and produced unreadable log entries — a log
 * nobody can read is the same as no log.
 */
test("PowerShell ops scripts stay ASCII", () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    const text = readFileSync(join(OPS, name), "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `ops/${name} has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) — PS 5.1 will mangle them`,
    );
  }
});

/**
 * A blanket Stop-Process by image name has taken down unrelated software on
 * this machine before. Ops scripts must match by command line, never by name
 * alone.
 */
test("nothing stops a process by image name alone", () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    const text = readFileSync(join(OPS, name), "utf8");
    for (const line of text.split("\n")) {
      if (!/Stop-Process/.test(line)) continue;
      assert.doesNotMatch(
        line,
        /Stop-Process\s+-Name/i,
        `ops/${name}: Stop-Process -Name kills by image name — match the command line instead`,
      );
    }
  }
});

/** A single CIM result is truthy on its own; only @() makes .Count reliable. */
test("CIM queries that are counted are wrapped in @()", () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    const text = readFileSync(join(OPS, name), "utf8");
    for (const line of text.split("\n")) {
      if (!/Get-CimInstance/.test(line)) continue;
      if (!/\.Count|\bcount\b/i.test(text.slice(text.indexOf(line), text.indexOf(line) + 300))) continue;
      assert.match(
        line,
        /@\(/,
        `ops/${name}: a counted Get-CimInstance must be wrapped in @() — one result is truthy but has no .Count`,
      );
    }
  }
});

/** On this machine PowerShell is available, so parse them for real. */
const onWindows = process.platform === "win32";
test("PowerShell ops scripts parse", { skip: !onWindows ? "PowerShell only" : false }, () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    const script = join(OPS, name).replace(/'/g, "''");
    const cmd = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$e); if ($e -and $e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`;
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
        encoding: "utf8",
        timeout: 60_000,
      });
    } catch (err) {
      assert.fail(`ops/${name} does not parse: ${String(err?.stdout || err?.message).slice(0, 400)}`);
    }
  }
});

/**
 * The wait for Postgres must survive a cold boot.
 *
 * Measured on this machine on 2026-08-29: the logon task ran at 17:40:15, gave
 * up after thirty seconds, and Postgres accepted connections at 17:41:08. The
 * task exited 1 and the paper served 502 until someone looked. The number is
 * therefore load-bearing, and it is one character away from being wrong again.
 */
test("both start paths wait long enough for a cold Postgres", () => {
  for (const name of ["start-townreporter.ps1", "watchdog.ps1"]) {
    const text = readFileSync(join(OPS, name), "utf8");
    const waits = [...text.matchAll(/\$i -lt (\d+) -and -not \(Test-Port 5433\)/g)];
    assert.ok(waits.length > 0, `ops/${name}: no wait loop for Postgres on 5433 found`);
    for (const [, seconds] of waits) {
      assert.ok(
        Number(seconds) >= 120,
        `ops/${name}: waits only ${seconds}s for Postgres — a cold boot took 53s here, ` +
          `and crash recovery on a larger database takes longer`,
      );
    }
  }
});
