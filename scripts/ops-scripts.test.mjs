import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertStagingDatabase } from "./stage-editor.mjs";

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

/**
 * Every script the docs, the Server page and the other ops scripts depend on.
 *
 * The lib-*.ps1 entries are here because a dot-source of a missing file fails
 * at runtime, on the machine that keeps the paper online, with nothing in CI
 * to say so. The two about optional services (lib-redlib.ps1, lib-ollama.ps1)
 * are the ones four different callers agree through; losing one silently
 * would turn "is the Reddit reader up" into four different answers again.
 */
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
  "redlib.ps1",
  "lib-redlib.ps1",
  "lib-ollama.ps1",
  "lib-env.ps1",
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
    // start-townreporter.ps1 checks the explicitly configured owned cluster port.
    const waits = [...text.matchAll(/\$i -lt (\d+) -and -not \(Test-Port (?:\$OwnedPgPort|\$pgPort)\)/g)];
    assert.ok(waits.length > 0, `ops/${name}: no wait loop for the configured Postgres port found`);
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
    /Invoke-WebRequest\s+"http:\/\/127\.0\.0\.1:\$port\//,
    "the app health probe must use $port, not a hardcoded port number " +
      "(and 127.0.0.1, not localhost, which can resolve to ::1 -- see TW-INC-2026-09-02)",
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

/**
 * ops/stage.ps1 is the pre-promote check: it restores a real production
 * backup into townreporter_dev and serves the new build locally so the
 * changed screens get walked before anything is promoted. It is covered by
 * the generic ASCII/parse/Stop-Process/CIM checks above (they iterate every
 * ops/*.ps1 file), but its existence and its never-touch-port-3000 /
 * never-touch-townreporter guarantees are load-bearing enough to name
 * directly rather than rely only on the generic loop.
 */
test("ops/stage.ps1 exists, stays ASCII, and never names port 3000 or the townreporter database", () => {
  const path = join(OPS, "stage.ps1");
  assert.ok(existsSync(path), "ops/stage.ps1 is missing");
  const text = readFileSync(path, "utf8");
  const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
  assert.equal(
    bad.length,
    0,
    `ops/stage.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
  );
  assert.match(text, /townreporter_dev/, "ops/stage.ps1 must name townreporter_dev as its target database");
  assert.doesNotMatch(
    text,
    /-d\s+townreporter\b(?!_dev)/,
    "ops/stage.ps1 must never pass -d townreporter (the live paper's database) to psql",
  );
  assert.match(text, /Port -eq 3000/, "ops/stage.ps1 must refuse -Port 3000, the live paper's port");
  assert.doesNotMatch(text, /Stop-Process\s+-Name/i, "ops/stage.ps1 must not stop a process by image name");
});

/**
 * scripts/stage-editor.mjs upserts a staging sign-in into townreporter_dev
 * (the disposable copy `ops/stage.ps1` restores real production data into).
 * The one thing standing between this script and a real account is
 * `assertStagingDatabase`: it must refuse anything whose database name is
 * not exactly `townreporter_dev` -- not the live `townreporter` database,
 * not a lookalike name, not a missing/unparseable URL.
 */
test("stage-editor's guard accepts only townreporter_dev", () => {
  assert.equal(
    assertStagingDatabase("postgres://postgres@127.0.0.1:5433/townreporter_dev").ok,
    true,
  );
});

test("stage-editor's guard refuses the live townreporter database", () => {
  const r = assertStagingDatabase("postgres://postgres@127.0.0.1:5433/townreporter");
  assert.equal(r.ok, false);
  assert.match(r.reason, /townreporter_dev/);
});

test("stage-editor's guard refuses a lookalike database name", () => {
  for (const url of [
    "postgres://postgres@127.0.0.1:5433/townreporter_dev2",
    "postgres://postgres@127.0.0.1:5433/townreporter_devx",
    "postgres://postgres@127.0.0.1:5433/townreporter_development",
    "postgres://postgres@127.0.0.1:5433/postgres",
  ]) {
    assert.equal(assertStagingDatabase(url).ok, false, `expected a refusal for ${url}`);
  }
});

test("stage-editor's guard is indifferent to host, since only the database name matters", () => {
  assert.equal(
    assertStagingDatabase("postgres://postgres@remote-host:5433/townreporter_dev").ok,
    true,
  );
});

test("stage-editor's guard refuses a missing or unparseable DATABASE_URL", () => {
  assert.equal(assertStagingDatabase(undefined).ok, false);
  assert.equal(assertStagingDatabase("").ok, false);
  assert.equal(assertStagingDatabase("   ").ok, false);
  assert.equal(assertStagingDatabase("not a url at all").ok, false);
});

/**
 * The same guard, exercised end-to-end by actually spawning the script --
 * this is what the task asked to prove, not just the pure function in
 * isolation: `node scripts/stage-editor.mjs` with a wrong DATABASE_URL must
 * exit non-zero and must never attempt a database connection.
 */
test("spawning stage-editor.mjs with a non-townreporter_dev DATABASE_URL exits non-zero", () => {
  const scriptPath = join(ROOT, "scripts", "stage-editor.mjs");
  assert.throws(() => {
    execFileSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://postgres@127.0.0.1:5433/townreporter",
      },
      timeout: 15_000,
    });
  }, /Command failed|exit code/i);
});

test("spawning stage-editor.mjs with no DATABASE_URL exits non-zero", () => {
  const scriptPath = join(ROOT, "scripts", "stage-editor.mjs");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  assert.throws(() => {
    execFileSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
  });
});


/**
 * TW-INC-2026-09-02: an unrelated dev server held [::1]:3000 (IPv6 only)
 * during the 0.6.2 promote. A plain `Get-NetTCPConnection -LocalPort $p
 * -State Listen` has no address filter, so it was satisfied by that
 * listener, concluded TownReporter was already up, and never started it --
 * the site served 502 for ~25 minutes. Every port check for the app's own
 * port must go through the address-aware helper in lib-port.ps1 instead.
 * A plain check on 5433 is fine: Postgres binds both address families, so
 * that one is deliberately left alone (and called out as such in-file).
 */
test("no ops script checks a port with a bare Get-NetTCPConnection, except the Postgres 5433 check", () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    if (name === "lib-port.ps1") continue; // where the helper itself lives
    const text = readFileSync(join(OPS, name), "utf8");
    const usesHelper = /Test-TownReporterPort|Get-TownReporterPortOwner/.test(text);
    for (const line of text.split("\n")) {
      if (!/Get-NetTCPConnection\s+-LocalPort/.test(line)) continue;
      const isPostgresCheck = /5433/.test(line);
      assert.ok(
        isPostgresCheck || usesHelper,
        `ops/${name}: "${line.trim()}" checks a port without going through the address-aware ` +
          `helper (Test-TownReporterPort / Get-TownReporterPortOwner) and is not the 5433 Postgres check`,
      );
    }
  }
});

/** localhost can resolve to ::1; every app health probe must use 127.0.0.1. */
test("no ops script probes http://localhost", () => {
  for (const name of readdirSync(OPS).filter((f) => f.endsWith(".ps1"))) {
    const text = readFileSync(join(OPS, name), "utf8");
    assert.doesNotMatch(
      text,
      /https?:\/\/localhost[:/]/i,
      `ops/${name}: probes localhost, which can resolve to ::1 -- use 127.0.0.1`,
    );
  }
});

/** The two functions this incident's fix depends on must actually exist. */
test("lib-port.ps1 defines Test-TownReporterPort and Get-TownReporterPortOwner", () => {
  const text = readFileSync(join(OPS, "lib-port.ps1"), "utf8");
  assert.match(text, /function Test-TownReporterPort/, "lib-port.ps1 must define Test-TownReporterPort");
  assert.match(text, /function Get-TownReporterPortOwner/, "lib-port.ps1 must define Get-TownReporterPortOwner");
  // Both must actually filter by address, not just alias the old bare check.
  assert.match(
    text,
    /function Get-TownReporterPortOwner[\s\S]{0,400}?Where-Object[\s\S]{0,120}?LocalAddress/,
    "Get-TownReporterPortOwner must filter listeners by LocalAddress",
  );
});

/* ------------------------------------------------------------------------- *
 * Redlib, the local Reddit reader, and Ollama, the first Automatic rung's
 * server. Both are OPTIONAL: the desk reads Reddit through Reddit's .rss when
 * Redlib is down, and "Automatic" walks to the next model when Ollama is.
 *
 * That optionality is the property these tests protect. The failure mode is
 * not "Redlib did not start" -- it is an optional reader becoming a reason to
 * restart or stop the paper, which is how a supported degraded state turns
 * into an outage. So the gates below are mostly about what must NOT happen.
 * ------------------------------------------------------------------------- */

const read = (name) => readFileSync(join(OPS, name), "utf8");

/**
 * PowerShell text with its comments removed.
 *
 * Several of these scripts explain in prose what they must never do -- "there
 * is no Stop-Process in lib-ollama.ps1 at all" -- and a naive search for the
 * forbidden code finds the sentence saying the code is absent. That is the
 * false-positive version of the claims-of-absence mistake: the assertion has
 * to be about the code, so strip the prose first.
 */
const stripComments = (ps) => ps.replace(/<#[\s\S]*?#>/g, "").replace(/(^|\s)#[^\n]*/g, "$1");

test("the Reddit reader is stopped by its own pid file, never by image name", () => {
  const lib = read("lib-redlib.ps1");
  assert.match(lib, /redlib\.pid/, "lib-redlib.ps1 must know the pid file the skill writes");
  assert.match(lib, /function Stop-Redlib/, "lib-redlib.ps1 must own the stop path");
  assert.match(
    lib,
    /function Stop-Redlib[\s\S]{0,900}?Stop-Process -Id \$entry\.Pid/,
    "Stop-Redlib must stop the pid it verified, not a name match",
  );
  assert.doesNotMatch(lib, /Stop-Process\s+-Name/i, "lib-redlib.ps1 must never stop by image name");

  // The recorded pid must be CHECKED against the installed executable, not
  // believed: a recycled pid would otherwise be a kill aimed at a stranger.
  assert.match(lib, /MainModule\.FileName/, "the pid's executable must be read");
  assert.match(lib, /config\.executable/, "and compared with the executable install.json names");
  assert.match(lib, /'refused'/, "an unidentifiable pid must be refused, not orphaned");
});

test("stop-townreporter.ps1 takes the Reddit reader down with the paper", () => {
  const text = read("stop-townreporter.ps1");
  assert.match(text, /Stop-Redlib/, "the 'stop everything' path must stop the reader");
  assert.doesNotMatch(
    text,
    /redlib[\s\S]{0,200}?Stop-Process\s+-Name/i,
    "the reader must not be stopped by image name",
  );
  // Postgres stays opt-in and the app stop must still be port-scoped: this
  // change adds a third thing to the script and must not have relaxed either.
  assert.match(text, /param\(\[switch\]\$IncludeDatabase\)/, "-IncludeDatabase must survive");
  assert.match(text, /Get-TownReporterPortOwner \$port/, "the app stop must stay port-scoped");
});

test("start-townreporter.ps1 starts the reader detached, after the paper, and cannot fail on it", () => {
  const text = read("start-townreporter.ps1");
  assert.match(text, /Start-RedlibIfDown/, "logon must start the reader if it is down");
  assert.match(text, /Get-RedlibOffSwitch/, "and must honour TOWNREPORTER_REDLIB");
  assert.match(text, /try\s*\{[\s\S]*?Start-RedlibIfDown[\s\S]*?\}\s*catch/, "the reader start must be wrapped");
  // Non-blocking: the child is spawned by Start-RedlibIfDown, and nothing in
  // this script waits on it. A reader that waits for Reddit to answer must
  // never hold up the paper's logon start.
  const lib = read("lib-redlib.ps1");
  assert.match(lib, /function Start-RedlibIfDown[\s\S]{0,1200}?Start-Process/, "the start must be detached");
  assert.doesNotMatch(
    lib.slice(lib.indexOf("function Start-RedlibIfDown"), lib.indexOf("function Stop-Redlib")),
    /Wait-Process|Start-Sleep/,
    "Start-RedlibIfDown must not wait for the reader",
  );
  // Order: the app is started first, and only then the reader.
  const appStart = text.indexOf(".output\\server\\index.mjs");
  const readerStart = text.indexOf("Start-RedlibIfDown");
  assert.ok(appStart > 0 && readerStart > appStart, "the paper must be started before the optional reader");
});

test("the Control menu offers the reader in plain words and still publishes nothing", () => {
  const text = readFileSync(join(OPS, "TownReporter Control.cmd"), "utf8");
  assert.match(text, /^echo   6  /m, "the menu must have a line 6");
  assert.match(text, /Reddit reader/i, "line 6 must be about the Reddit reader");
  assert.match(text, /if "%choice%"=="6" goto redlib/, "and must dispatch it");
  assert.match(text, /redlib\.ps1" restart/, "option 6 must restart the reader through its own ops script");
  // The menu's promise at the top of the file, re-checked: the numbers may
  // only ever read state or run the fixed set of ops scripts. ("publish" and
  // "delete" appear in the promise itself, so the search is for commands.)
  assert.doesNotMatch(
    text,
    /schtasks \/delete|Stop-Process|taskkill|psql|del |rmdir|robocopy/i,
    "the menu must stay read/restart only",
  );
  assert.doesNotMatch(text, /if "%choice%"=="7"|if "%choice%"=="8"/, "no undocumented menu items");
});

test("the watchdog repairs the reader and the model server without ever aiming at the paper", () => {
  const wd = read("watchdog.ps1");
  assert.match(wd, /Start-RedlibIfDown/, "the watchdog must start the reader if it is down");
  assert.match(wd, /Start-OllamaIfDown/, "the watchdog must start Ollama if it is down");

  // The two optional sections sit between the app and the tunnel sections and
  // are each skipped in test mode. Sliced, then read for what must not appear.
  const optionalRaw = wd.slice(wd.indexOf("--- Reddit reader (Redlib)"), wd.indexOf("--- Tunnel ---"));
  assert.ok(optionalRaw.length > 0, "could not find the optional-service sections");
  const optional = stripComments(optionalRaw);
  assert.match(optional, /WATCHDOG_TEST_MODE -ne '1'/, "both sections must be skipped in test mode");
  assert.equal(
    [...optional.matchAll(/catch\s*\{/g)].length,
    2,
    "each optional section must be wrapped in its own catch -- neither may throw into the paper's path",
  );
  assert.doesNotMatch(optional, /Stop-Process/, "nothing in either section may stop a process");
  assert.doesNotMatch(optional, /Start-ScheduledTask/, "and neither may start a scheduled task");
  assert.doesNotMatch(optional, /throw /, "and neither may throw");

  // The app's own section must not know these exist. If a reader check ever
  // lands inside the app block, a Redlib problem becomes an app restart.
  const appBlock = stripComments(
    wd.slice(wd.indexOf("# --- App ---"), wd.indexOf("--- Reddit reader (Redlib)")),
  );
  assert.ok(appBlock.length > 0, "could not find the app section");
  assert.doesNotMatch(appBlock, /redlib|ollama/i, "the app repair path must not consult the optional services");

  // A detached start cannot be reported as a completed repair on the same run.
  assert.doesNotMatch(
    optional,
    /\$repaired \+= "(redlib|ollama)"/,
    "an unverified detached start must not be claimed as a repair in the same run",
  );
});

test("Ollama is started the shortcut's way and is never killed, and LM Studio is never touched", () => {
  const libRaw = read("lib-ollama.ps1");
  const lib = stripComments(libRaw);
  assert.doesNotMatch(
    lib,
    /Stop-Process|Stop-Service|taskkill/i,
    "lib-ollama.ps1 must contain no path that stops anything -- a wedged Ollama is the operator's to restart",
  );
  assert.doesNotMatch(
    lib,
    /1234|lms|lm-studio|\bLM Studio\b/i,
    "lib-ollama.ps1 must not reach toward LM Studio or its models",
  );
  // The launch target is READ out of the operator's shortcut, not restated.
  assert.match(lib, /CreateShortcut/, "the Startup shortcut must be read, not assumed");
  assert.match(lib, /Ollama\.lnk/, "and the default is the operator's own Startup shortcut");
  assert.match(lib, /OLLAMA_SHORTCUT/, "with an override for a non-default install");
  // Started only when nothing is running: a process that exists but is not
  // answering is left alone, so a slow start is never doubled.
  assert.match(
    lib,
    /function Start-OllamaIfDown[\s\S]{0,900}?if \(Test-OllamaProcessRunning\) \{ return 'starting' \}/,
    "a running-but-not-ready Ollama must be left alone",
  );
  // Ready means the model list answers, the same question the desk asks.
  assert.match(lib, /\/models/, "readiness must be the OpenAI-compatible model list");
  assert.match(lib, /11434/, "and must default to the DeepSeek rung's own endpoint");
});

test("status.ps1 answers for the reader and the model server in plain words, read-only", () => {
  const text = read("status.ps1");
  assert.match(text, /Reddit reader \(Redlib\)/, "status must name the reader");
  assert.match(text, /DeepSeek \(via Ollama\)/, "status must name the model");
  // The wording is the point: Ollama down is not a fault, and the line must
  // say what the paper does about it rather than implying something is broken.
  assert.match(text, /Ollama not running - the paper will use the next model/);
  assert.match(text, /switched off \(TOWNREPORTER_REDLIB=0\)/, "the reader's off-switch must be honoured");
  // Both lines must be shown as notes, not faults: an optional service that is
  // down must not read the same as the paper being down.
  const readerLine = text.slice(text.indexOf('Show "Reddit reader (Redlib)"'));
  assert.match(readerLine.slice(0, 80), /\$redlibOptional/, "the reader must not be marked as a fault");
  assert.match(text, /Show "DeepSeek \(via Ollama\)"[^\n]*\$true/, "the model line must not be marked as a fault");

  // Read-only, in both modes, and -DryRun must SAY so rather than imply it.
  assert.match(text, /\[switch\]\$DryRun/, "status.ps1 must take -DryRun");
  assert.match(text, /\[string\]\$Root/, "status.ps1 must take -Root so it can describe the live install");
  assert.match(text, /Nothing was started, stopped or changed/, "-DryRun must state plainly that nothing happened");
  assert.match(text, /-Root exists so this script can be run from a worktree/, "-Root's reason must be documented");
  assert.doesNotMatch(text, /Stop-Process|Start-Process|Start-ScheduledTask/, "status.ps1 must start and stop nothing");
  assert.doesNotMatch(text, /schtasks/, "and must not run a scheduled task");
  // The .env parser is shared now; a second private copy is how the two
  // answers to "what port is this install on" drift apart.
  assert.match(text, /Read-OpsEnvValue/, "status.ps1 must use the shared .env reader");
  assert.doesNotMatch(text, /function Read-EnvValue/, "and must not keep its own copy of it");
});

test("both optional services have an off-switch the operator can throw", () => {
  const redlib = read("lib-redlib.ps1");
  const ollama = read("lib-ollama.ps1");
  assert.match(redlib, /TOWNREPORTER_REDLIB/, "the reader's off-switch must be the app's own env var");
  assert.ok(
    /Test-RedlibUp|Get-RedlibState/.test(redlib.slice(redlib.indexOf("function Get-RedlibState"))),
    "the reader's state must come from whether it answers, not only from a pid file",
  );
  assert.match(ollama, /function Start-OllamaIfDown[\s\S]{0,200}?OffSwitch/, "Ollama's start must honour an off-switch");
});

test("no new scheduled task is registered for either optional service", () => {
  /*
    Both are reached through tasks that already exist: "TownReporter" (logon)
    starts the reader via start-townreporter.ps1, "TownReporter Watchdog"
    (every five minutes) restarts either if it stops, and Ollama is launched by
    the operator's own Startup shortcut. A dedicated task would be a second
    starter racing the watchdog. The installer must say so, and must not have
    quietly grown a seventh task.
  */
  const text = read("install-tasks.ps1");
  assert.match(text, /There is NO task for Redlib or Ollama/, "install-tasks.ps1 must record the decision");
  // CRLF, so the closing paren is matched with a pattern rather than a literal.
  const list = text.match(/\$tasks = @\(([\s\S]*?)\r?\n\)\r?\n/);
  assert.ok(list, "could not find the task list");
  assert.equal(
    [...list[1].matchAll(/Name = "/g)].length,
    6,
    "the task list grew or shrank -- if that is intended, update this count and the docs table deliberately",
  );
  assert.doesNotMatch(list[1], /[Rr]edlib|[Oo]llama/, "neither optional service may get its own task");
});

