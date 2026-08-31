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
        `${doc.split(/[/]/).pop()} references ops/${m[1]}, which does not exist`,
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
    // watchdog.ps1 checks $pgPort (TEST-003: overridable for CI, defaulting to
    // 5433 -- that default is asserted separately, in the seam test above);
    // start-townreporter.ps1 has no such override and still checks 5433 literally.
    const waits = [...text.matchAll(/\$i -lt (\d+) -and -not \(Test-Port (?:5433|\$pgPort)\)/g)];
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

test("the watchdog stands down while a promote is running, and the promote arranges it", () => {
  /*
    The v0.5.4 incident: promote stopped the app, the watchdog "repaired" it
    45 seconds before the build finished writing, and the paper served a
    half-written build. Three parts, each load-bearing: the watchdog honors
    the marker, the promote writes it BEFORE stopping anything, and the
    marker ages out so a dead promote cannot muzzle the watchdog forever.
  */
  const wd = readFileSync(join(OPS, "watchdog.ps1"), "utf8");
  const pr = readFileSync(join(OPS, "promote.ps1"), "utf8");
  assert.match(wd, /promote-in-progress/, "watchdog must know the marker");
  assert.match(wd, /standing down/i, "watchdog must stand down on a fresh marker");
  assert.match(wd, /30/, "the marker must age out");
  assert.match(pr, /promote-in-progress/, "promote must write the marker");
  const writeAt = pr.indexOf("promote-in-progress");
  const stopAt = pr.indexOf("stopping the app");
  assert.ok(writeAt > 0 && stopAt > 0 && writeAt < stopAt, "the marker must be written BEFORE the app is stopped");
  assert.match(pr, /assets\/\[A-Za-z0-9_.-\]\+\\.js/, "promote must verify a real script asset, not just the front page");
});

/**
 * TEST-003: the watchdog's port/start-mechanism overrides exist so a CI
 * runner can point it at a disposable app instead of the live one, but a
 * wrong default here would silently repoint the PRODUCTION watchdog at the
 * wrong socket or the wrong start script on the machine that runs the live
 * paper -- an unset environment (every real run) must still resolve to
 * exactly 5433, and to start-townreporter.ps1. Both are asserted, not just
 * that the env var names exist, because a seam with the wrong default is
 * worse than no seam: it looks safe and is not.
 */
test("the watchdog's CI override seam exists and its defaults are still production's values", () => {
  const wd = readFileSync(join(OPS, "watchdog.ps1"), "utf8");
  assert.match(wd, /WATCHDOG_APP_PORT/, "watchdog must accept an app-port override for CI");
  assert.match(wd, /WATCHDOG_PG_PORT/, "watchdog must accept a postgres-port override for CI");
  assert.match(wd, /WATCHDOG_START_SCRIPT/, "watchdog must accept a start-script override for CI");

  // The postgres-port default must still be 5433 wherever WATCHDOG_PG_PORT is
  // read: `else { "5433" }`, not some other literal.
  const pgPortAssign = wd.match(/\$pgPort\s*=\s*if\s*\(\$env:WATCHDOG_PG_PORT\)\s*\{[^}]*\}\s*else\s*\{\s*"(\d+)"\s*\}/);
  assert.ok(pgPortAssign, "could not find the $pgPort default assignment to check");
  assert.equal(pgPortAssign[1], "5433", "the postgres-port override's default drifted off production's 5433");

  // The start-script default must still resolve to start-townreporter.ps1,
  // the same script the logon task and every other production caller use.
  const startScriptAssign = wd.match(/\$startScript\s*=\s*if\s*\(\$env:WATCHDOG_START_SCRIPT\)\s*\{[^}]*\}\s*else\s*\{([^}]*)\}/);
  assert.ok(startScriptAssign, "could not find the $startScript default assignment to check");
  assert.match(
    startScriptAssign[1],
    /start-townreporter\.ps1/,
    "the start-script override's default drifted off production's start-townreporter.ps1",
  );

  // The app-port override must feed the SAME $port variable lib-port.ps1
  // already sets from .env, not a parallel variable the rest of the script
  // ignores -- otherwise overriding it would change what is checked but not
  // what is repaired, or vice versa.
  assert.match(
    wd,
    /if\s*\(\$env:WATCHDOG_APP_PORT\)\s*\{\s*\$port\s*=\s*\$env:WATCHDOG_APP_PORT\s*\}/,
    "WATCHDOG_APP_PORT must override the same $port variable used everywhere else in the script",
  );

  // The app health probe must follow $port, not a hardcoded port -- otherwise
  // WATCHDOG_APP_PORT would change what gets repaired but the health check
  // would still probe production's socket, which is exactly the kind of
  // three-answers-to-one-question bug lib-port.ps1 already exists to prevent.
  assert.match(
    wd,
    /Invoke-WebRequest\s+"http:\/\/localhost:\$port\//,
    "the app health probe must use $port, not a hardcoded port number",
  );
});

test("the shared test build asks whether it is needed before it rebuilds", () => {
  /*
    ensureBuilt used to treat "I got the lock" as "I build". The lock is
    released the moment the first build finishes, so a test file arriving
    late found it free and rebuilt -- emptying .output underneath servers
    its siblings were already serving from. The victim failed on ENOENT for
    a script chunk it had already named in HTML it had sent: the same shape
    as the v0.5.4 production incident, where a watchdog restart landed
    mid-build. Five integration files hid it; a sixth exposed it in CI.

    Two properties keep it shut: the freshness check exists, and it is
    consulted BOTH before taking the lock and again while holding it.
  */
  const src = readFileSync(join(ROOT, "src", "lib", "test-support", "pg-admin.ts"), "utf8");
  assert.match(src, /function buildIsCurrent/, "the freshness check must exist");
  const body = src.slice(src.indexOf("export async function ensureBuilt"));
  const checks = [...body.matchAll(/buildIsCurrent\(repoRoot\)/g)];
  assert.ok(
    checks.length >= 2,
    `ensureBuilt must consult buildIsCurrent before acquiring the lock AND again under it; found ${checks.length}`,
  );
  const firstCheck = body.indexOf("buildIsCurrent(repoRoot)");
  const lockAt = body.indexOf("acquireBuildLock()");
  assert.ok(
    firstCheck > 0 && lockAt > 0 && firstCheck < lockAt,
    "the first freshness check must come BEFORE the lock is acquired",
  );
});

test("the watchdog only stops the process holding the port it is repairing", () => {
  /*
    The stale-process sweep used to enumerate every node.exe whose command
    line contained ".output/server/index.mjs" and kill all of them -- which
    is every install of this app on the machine, not just the one being
    repaired. The operator's box runs the live paper and a development copy
    side by side, so an unhealthy app on one port would have taken the
    healthy one on the other down with it; and once WATCHDOG_APP_PORT could
    aim the watchdog at a test instance, a recovery test would have killed
    the live paper outright.

    The sweep must start from "who holds this port", and must still confirm
    the owner is this app before stopping it.
  */
  const wd = readFileSync(join(OPS, "watchdog.ps1"), "utf8");
  const sweep = wd.slice(wd.indexOf("Clear a process holding"), wd.indexOf("Launch the start script"));
  assert.match(
    sweep,
    /Get-NetTCPConnection -LocalPort \$port/,
    "the sweep must find its target by the port it is repairing",
  );
  assert.doesNotMatch(
    sweep,
    /Get-CimInstance Win32_Process -Filter "Name='node\.exe'"/,
    "the sweep must not enumerate every node process on the machine",
  );
  assert.match(sweep, /index\.mjs/, "it must still confirm the owner is this app, not just any port holder");
  assert.match(sweep, /Stop-Process -Id \$owner/, "it must stop the port's owner, not a list of matches");
});

test("the tunnel restart never sweeps cloudflared by image name", () => {
  /*
    The old script enumerated every cloudflared.exe on the machine and
    stopped them all -- on a box running the live paper and a dev copy side
    by side, that is the dev install killing production's route to the
    internet. It now stops only what its own scheduled task started. This
    gate fails if a Stop-Process ever again feeds from an image-name filter
    in this script.
  */
  const script = readFileSync(join(ROOT, "ops", "restart-tunnel.ps1"), "utf8");
  const enumerated = /Filter\s+"Name='cloudflared\.exe'"[\s\S]{0,200}?Stop-Process/;
  assert.ok(
    !enumerated.test(script),
    "restart-tunnel.ps1 stops processes enumerated by image name again",
  );
});

test("a non-owner install refuses the tunnel restart server-side, not just in the UI", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "ops", "actions.server.ts"), "utf8");
  assert.match(
    src,
    /restart-tunnel.*TOWNREPORTER_TUNNEL|TOWNREPORTER_TUNNEL[\s\S]{0,400}?restart-tunnel/s,
    "runOpsActionById no longer gates restart-tunnel on TOWNREPORTER_TUNNEL",
  );
});

