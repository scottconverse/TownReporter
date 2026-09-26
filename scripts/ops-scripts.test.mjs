import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertStagingDatabase } from "./stage-editor.mjs";
import { ACTIONS, STAGE_START_WINDOW_MS } from "../ops/control/control-server.mjs";

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
  // The two steps between "Postgres is listening" and "serve the paper", and
  // the one-time Redlib move. lib-migrate.ps1 is why the 2026-09-25 logon task
  // died at 20:01 with the site on 502 (a native command's stderr under 2>&1
  // TERMINATES a script whose preference is Stop); losing that file, or the
  // relocator that gets an MSIX-redirected install somewhere a scheduled task
  // can see, fails on the machine that keeps the paper online.
  "lib-migrate.ps1",
  "redlib-relocate.ps1",
  // The backups and the alerts. lib-backup.ps1 is one backup path shared by
  // promote.ps1, the nightly run and the Control page's button; lib-alert.ps1
  // is the one place that decides whether the owner is told. Losing either
  // does not fail loudly in CI -- it fails at 2 AM on the machine that keeps
  // the paper's only copy of the database, which is the point of this list.
  "lib-backup.ps1",
  "lib-alert.ps1",
  "backup.ps1",
  // What brings the staged copy on 3100 back after a reboot, without a second
  // stage. lib-stage.ps1 decides and starts nothing; start-stage.ps1 is the
  // only thing that starts, and it declines unless what ops\stage.ps1 left on
  // disk is there and the port is free. Both are called by ops\watchdog.ps1 and
  // by the Control page's one start button, so a missing file fails at 3 AM on
  // the machine whose walkthrough is waiting, not in CI.
  "lib-stage.ps1",
  "start-stage.ps1",
  // The Control page, and the launcher the Desktop icon runs. The page is the
  // operator's non-terminal way in now, so the same argument that put
  // status.ps1 in this list applies twice over: a missing file fails on the
  // machine that keeps the paper online, and CI cannot execute PowerShell to
  // notice. A nested entry is joined, so the check reaches into ops/control/.
  "control.ps1",
  join("control", "control-server.mjs"),
  join("control", "last-scan.cjs"),
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
  assert.match(text, /^echo {3}6 {2}/m, "the menu must have a line 6");
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
  assert.doesNotMatch(text, /if "%choice%"=="8"/, "no undocumented menu items");
});

test("the Control menu's line 7 opens the Control page, and the menu is still the fallback", () => {
  /*
    The page REPLACES the terminal menu as the way in (owner, 2026-09-25:
    "something like mission control for DSH"), but it does not delete it. The
    menu keeps every numbered item it had and gains one that opens the page, so
    a machine where the page cannot start is a machine where the six familiar
    things still are. Line 7 therefore has to be a real line, a real dispatch,
    and a spawn of the launcher -- not a sentence in a comment.
  */
  const text = readFileSync(join(OPS, "TownReporter Control.cmd"), "utf8");
  assert.match(text, /^echo {3}7 {2}/m, "the menu must have a line 7");
  assert.match(text, /Control page/i, "line 7 must be about the Control page");
  assert.match(text, /if "%choice%"=="7" goto control/, "and must dispatch it");
  assert.match(text, /:control[\s\S]{0,600}?control\.ps1/, "option 7 must run the launcher");
  assert.match(text, /^echo {3}0 {2}/m, "the close line must survive");
  // Every number from 1 to 7 has a line and a dispatch: a menu that offers a
  // number it does not handle is worse than a shorter menu.
  for (const n of ["1", "2", "3", "4", "5", "6", "7"]) {
    assert.match(text, new RegExp(`^echo {3}${n} {2}`, "m"), `the menu has no line ${n}`);
    assert.match(text, new RegExp(`if "%choice%"=="${n}"`), `the menu does not dispatch ${n}`);
  }
});

test("the Control page's launcher starts the page and nothing else", () => {
  /*
    The launcher's whole job is: is the page up, and if not start it and open a
    browser. It is the file a double-click runs, on a machine that may be in any
    state, so the property to protect is what it must NOT do -- no scheduled
    task, no repair, no process killed. If the paper needs restarting, that is
    the page's own buttons, pressed by a person.
  */
  const text = read("control.ps1");
  assert.doesNotMatch(text, /Stop-Process|Stop-ScheduledTask/, "the launcher must stop nothing");
  assert.doesNotMatch(text, /schtasks|Start-ScheduledTask/, "and must start no scheduled task");
  assert.doesNotMatch(text, /Start-Ollama|Start-Redlib|start-townreporter\.ps1/, "and must start no service");
  // 127.0.0.1, never localhost: the page's server binds IPv4 loopback, and
  // TW-INC-2026-09-02 is the incident where ::1 answered for a different
  // program's socket.
  assert.match(text, /http:\/\/127\.0\.0\.1:\$Port\//, "the launcher must probe 127.0.0.1 on the page's port");
  assert.match(text, /3095/, "the launcher's default must be the page's port");
  assert.match(text, /control-server\.mjs/, "the launcher must start the page's own server");
  assert.match(text, /\.control\.pid/, "and must know the pid file the server leaves");
  assert.match(text, /control\\control-server\.mjs/, "the server path must be the launcher's own sibling");
  assert.match(text, /TownReporter Control\.cmd/, "a failure must name the menu as the fallback");
  assert.match(text, /\$PSScriptRoot/, "the launcher must resolve its own directory, not the working directory");
});

test("the Desktop icon runs the launcher through the hidden launcher, not a console", () => {
  /*
    The icon used to be `cmd /k <menu>`, which is the terminal window the owner
    asked to be rid of. It now runs the launcher through wscript.exe +
    run-hidden.vbs -- the same no-console path the watchdog uses, because
    wscript.exe has no console to inherit. -Fallback keeps the old shortcut
    available, as a real switch rather than a comment, for a machine where the
    page cannot start.
  */
  const text = read("install-shortcut.ps1");
  assert.match(text, /wscript\.exe/, "the icon must run wscript.exe");
  assert.match(text, /run-hidden\.vbs/, "and must go through the hidden launcher");
  assert.match(text, /control\.ps1/, "and must run the Control page's launcher");
  assert.match(text, /\[switch\]\$Fallback/, "the console menu must stay available as a real option");
  assert.match(text, /cmd\.exe[\s\S]{0,200}?\/k/, "-Fallback must still make the cmd /k shortcut");
  // The default path must NOT be the console one. Sliced from the else branch
  // down to the shortcut's creation, so -Fallback's cmd.exe -- which sits above
  // it -- cannot satisfy the assertion.
  const defaultBranch = text.slice(text.indexOf("} else {"), text.indexOf("$desktop = [Environment]"));
  assert.ok(defaultBranch.length > 0, "could not find the default shortcut branch");
  assert.match(defaultBranch, /wscript\.exe/, "the default shortcut must run wscript.exe");
  assert.doesNotMatch(defaultBranch, /cmd\.exe/i, "the default shortcut must not be the console menu");
});


test("the watchdog repairs the reader and the model server without ever aiming at the paper", () => {
  const wd = read("watchdog.ps1");
  assert.match(wd, /Start-RedlibIfDown/, "the watchdog must start the reader if it is down");
  assert.match(wd, /Start-OllamaIfDown/, "the watchdog must start Ollama if it is down");

  // The two optional sections sit between the app and the staged copy's own
  // section (the fourth thing the watchdog keeps alive, and the one with its
  // own test) and are each skipped in test mode. Sliced to that next section
  // so this is about the two sections it names and nothing else -- the count
  // below is one catch per section, and a slice that ran to the tunnel would
  // count a section this test does not describe.
  const optionalRaw = wd.slice(wd.indexOf("--- Reddit reader (Redlib)"), wd.indexOf("--- The staged copy"));
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

  // Fix 2, from the coordinator's review (2026-09-25): the printed marker was
  // derived from whether the row was OPTIONAL, so a reader that was up printed
  // "[ NOTE ] Reddit reader (Redlib)  up" -- and the Control page, which keys on
  // the row's own fields, then offered a "Fix this" button on a healthy card.
  // The state is the verdict; the marker follows it. The repair each row carries
  // must be empty exactly when there is nothing to repair.
  assert.match(text, /if \(\$state -eq "ok"\) \{ " {2}OK {2}" \}/, "the console marker must follow the row's state");
  assert.doesNotMatch(
    text,
    /optional[^\n]{0,40}" NOTE "/,
    "an optional row must not print NOTE for being optional; only its state may",
  );
  assert.match(text, /'up'\s+\{\s*\$redlibState = "ok"; \$redlibDetail = "up" \}/, "a reader that answers is OK");
  assert.match(text, /'up'\s+\{\s*\$ollamaState = "ok"; \$ollamaDetail = "ready" \}/, "a model server that answers is OK");
  assert.match(
    text,
    /Show "Reddit reader \(Redlib\)" \$redlibState \$redlibDetail \$redlibOptional \$redlibFix "reddit-reader"/,
    "the reader's fix must come from the row's own state, not from the row existing",
  );
  assert.match(
    text,
    /Show "DeepSeek \(via Ollama\)" \$ollamaState \$ollamaDetail \$true "" "model-server"/,
    "the model row must offer no repair (there is no action that would help it)",
  );

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

test(
  "status.ps1 -Json prints one object the Control page can render, and the count matches the rows",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The Control page does not re-derive anything: it renders status.ps1's own
      verdicts, so this contract is the whole of "the page and the menu can
      never disagree". Two properties, both of which have a way to break
      silently:

        - stdout is the object and nothing else. A stray Write-Host heading
          ahead of it would be a parse failure that looks like the paper being
          down, which is why -Json wraps every heading in `if (-not $Json)`.
        - the attention count is the non-optional faults, and every fix id a row
          names is a real action. A fix id that is not in ACTIONS renders a
          button that 404s, and an optional service counted as a fault turns a
          supported degraded state into an outage.

      -Root points at a throwaway directory with a .env naming ports nothing is
      listening on, so this touches no live service and opens no real
      connection: every probe is refused immediately, locally. Read-only in
      every sense, which is the script's own promise.
    */
    const dir = mkdtempSync(join(tmpdir(), "control-json-"));
    const script = join(OPS, "status.ps1");
    try {
      writeFileSync(
        join(dir, ".env"),
        "PORT=65531\nPUBLIC_SITE_URL=http://127.0.0.1:65532\n",
        "utf8",
      );
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Json", "-Root", dir],
        { encoding: "utf8", timeout: 120_000 },
      );

      // Nothing from the console mode may appear ahead of the object.
      assert.doesNotMatch(
        out,
        /as seen from this machine|\[ {2}OK {2}\]|\[ DOWN \]|\[ NOTE \]/,
        "-Json leaked console output; the caller parses stdout",
      );
      const start = out.indexOf("{");
      assert.ok(start >= 0, `-Json printed no object at all: ${out.slice(0, 200)}`);
      const status = JSON.parse(out.slice(start));

      assert.equal(status.app, "TownReporter");
      assert.equal(status.root, dir, "-Root must be the install the object describes");
      assert.equal(status.port, "65531", "the port must come from that install's .env");
      assert.equal(status.site, "http://127.0.0.1:65532", "and so must the site URL");
      assert.equal(typeof status.attention, "number");
      assert.equal(typeof status.headline, "string");
      assert.ok(status.headline.length > 0, "a headline is what the page shows first");
      assert.ok(Array.isArray(status.checks), "checks must be a list");

      // The six things the page has a card for, plus the optional two. Named
      // rather than counted, so a row silently disappearing is caught.
      const ids = status.checks.map((c) => c.id);
      for (const id of ["database", "paper", "tunnel", "public-site", "watchdog", "reddit-reader", "model-server"]) {
        assert.ok(ids.includes(id), `status.ps1 -Json is missing the "${id}" row`);
      }
      for (const check of status.checks) {
        for (const key of ["id", "label", "state", "ok", "optional", "detail", "fix"]) {
          assert.ok(key in check, `the "${check.id}" row is missing ${key}`);
        }
        // Fix 2: every row carries a real state, one of three words, and `ok` is
        // derived from it here exactly as it is in the console. The page keys on
        // the state, so a row whose two fields could disagree would put a "Fix
        // this" button on a healthy card -- which is the bug that was reported.
        assert.ok(
          ["ok", "note", "down"].includes(check.state),
          `the "${check.id}" row's state is "${check.state}", which is not one of ok/note/down`,
        );
        assert.equal(check.ok, check.state === "ok", `"${check.id}" says state ${check.state} and ok ${check.ok}`);
        assert.equal(typeof check.ok, "boolean", `"${check.id}".ok must be a boolean, not a truthy string`);
        assert.equal(typeof check.optional, "boolean", `"${check.id}".optional must be a boolean`);
        if (check.fix) {
          assert.ok(
            Object.prototype.hasOwnProperty.call(ACTIONS, check.fix),
            `the "${check.id}" row names the fix "${check.fix}", which the Control page has no action for`,
          );
        }
        // Fix 1: a soft failure is never OK. "Could not" on a green row is the
        // lie the review found; a row that could not be read is a Note.
        if (check.detail && /^could not|could not be read/i.test(check.detail)) {
          assert.notEqual(check.state, "ok", `the "${check.id}" row is green over "${check.detail}"`);
        }
      }

      // The count, and the rule about the optional rows. This is the property
      // that would turn "the Reddit reader is down" into a red headline.
      const faults = status.checks.filter((c) => !c.ok && !c.optional);
      assert.equal(
        status.attention,
        status.checks.filter((c) => c.state === "down").length,
        "attention must be the rows whose state is down",
      );
      assert.equal(status.attention, faults.length, "attention must be the non-optional faults");
      assert.ok(
        status.checks.some((c) => c.optional),
        "there must be at least one optional row, or this rule proves nothing",
      );
      assert.equal(typeof status.advice, "string");
      assert.ok(status.checkedAt, "the object must say when it was read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "the console never prints NOTE or DOWN in front of a row that answered",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The console half of Fix 2. The marker used to follow whether a row was
      OPTIONAL, so a working Reddit reader printed "[ NOTE ] ... up" -- and the
      page, which renders the row's own fields, put a Fix button under it. The
      same throwaway install as the -Json test: two ports nothing listens on, so
      every probe is refused locally and no live service is touched.

      The assertion is about any row that answered, not about the reader on this
      machine: whatever this box's Redlib and Ollama happen to be doing, a line
      that ends in "up" or "ready" may not carry a NOTE or DOWN marker.
    */
    const dir = mkdtempSync(join(tmpdir(), "control-console-"));
    try {
      writeFileSync(join(dir, ".env"), "PORT=65531\nPUBLIC_SITE_URL=http://127.0.0.1:65532\n", "utf8");
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(OPS, "status.ps1"), "-Root", dir],
        { encoding: "utf8", timeout: 120_000 },
      );
      assert.match(out, /TownReporter, as seen from this machine/, "console mode must still print its headings");
      assert.match(out, /\[ {2}OK {2}\]|\[ NOTE \]|\[ DOWN \]/, "console mode must still print a marker per row");
      for (const line of out.split(/\r?\n/)) {
        assert.doesNotMatch(
          line,
          /\[ (NOTE|DOWN) \][^\n]*\b(up|ready)\s*$/,
          `a row that answered is printed as a note or a fault: ${line.trim()}`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

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

/* ------------------------------------------------------------------------- *
 * The 2026-09-25 reboot, in four parts.
 *
 * The logon task ran at 20:01, wrote its own "=== started ===" line, and then
 * nothing: no [migrate] line, no app, 502 until someone ran the task by hand.
 * Two lines did it -- `$ErrorActionPreference = "Stop"` and a native command's
 * stderr under `2>&1`, which in Windows PowerShell 5.1 arrives as a TERMINATING
 * ErrorRecord. At boot Postgres answers the TCP port before it accepts queries,
 * migrate wrote "the database system is starting up" to stderr, and the script
 * died on the first line of it.
 *
 * Four fixes, four groups of tests, none of which needs a reboot:
 *   1. the start path waits for a QUERY and runs migrate where stderr cannot
 *      reach a PowerShell stream -- proven without a database by
 *      scripts/ci-boot-recovery.ps1
 *   2. the watchdog gives a failed logon start its registered task back, after
 *      a three-minute boot grace, instead of launching a second copy
 *   3. the Redlib install root is a setting (.env) a scheduled task can read
 *   4. the one-time move out of MSIX's redirected AppData
 * ------------------------------------------------------------------------- */

test("start-townreporter.ps1 cannot be killed by a child's stderr any more", () => {
  /*
    The regression itself. `2>&1` on a native command is the idiom that did it,
    and it is gone: the redirect now belongs to cmd.exe, inside
    ops\lib-migrate.ps1. What must survive here is the ORDER -- the query wait,
    then migrate, then the app, then the "start finished" line, which is the
    only thing in the log that distinguishes a script that ran to the end from
    one that died in the middle.
  */
  const code = stripComments(read("start-townreporter.ps1"));
  assert.doesNotMatch(code, /2>&1/, "the idiom that terminated the logon task must not come back");
  assert.doesNotMatch(code, /migrate\.mjs/, "migrate is run by lib-migrate.ps1, where stderr cannot reach a PowerShell stream");
  assert.match(code, /\. \(Join-Path \$PSScriptRoot "lib-migrate\.ps1"\)/, "the two steps must be dot-sourced");
  assert.match(code, /Wait-TownReporterDatabase -Bin \$bin -ConnectionString \$dbUrl -Log \$appLog/, "the start must wait for a query");
  assert.match(code, /Invoke-TownReporterMigrate -App \$app -Log \$appLog -Node \$node/, "the start must run migrate through it");
  // Neither failure may fall through to starting the app: a paper served
  // against a half-migrated schema is worse than one plainly not up, and the
  // watchdog cannot tell the difference.
  assert.match(code, /if \(-not \(Wait-TownReporterDatabase[\s\S]{0,600}?\n {2}exit 1/, "a query that never gets answered must exit non-zero");
  assert.match(code, /if \(-not \(Invoke-TownReporterMigrate[\s\S]{0,600}?\n {2}exit 1/, "migrations that never apply must exit non-zero");
  assert.match(code, /the paper was not started: Postgres is listening/, "the reason must be in the log in plain words");
  assert.match(code, /the paper was not started: the database migrations did not apply/, "and so must a failed migrate");
  const started = code.indexOf("=== started ");
  const finished = code.indexOf("=== start finished");
  assert.ok(started > 0 && finished > started, "the log must keep both ends of the run");
});

test("lib-migrate.ps1 hands the redirect to cmd.exe, retries migrate three times, and reports rather than throws", () => {
  const raw = read("lib-migrate.ps1");
  const code = stripComments(raw);
  // The whole repair: cmd /c owns the redirection and Start-Process points it
  // at two FILES, so no PowerShell stream ever carries the child's stderr,
  // whatever the caller's preference is.
  // `/s` plus one outer pair of quotes: plain `/c` strips the first and last
  // quote of a line that starts with one, which broke the quoted psql probe on
  // the live paper (2026-09-25 9:25 PM). scripts/ci-boot-recovery.ps1 2b runs it.
  assert.match(
    code,
    /ArgumentList\s*=\s*@\("\/s", "\/c", \("`"" \+ \$CommandLine \+ "`""\)\)/,
    "cmd /s /c must take the command line as ONE quoted argument",
  );
  assert.match(code, /RedirectStandardOutput\s+= \$StdOutFile/, "stdout must go to a file, not a pipe");
  assert.match(code, /RedirectStandardError\s+= \$StdErrFile/, "and so must stderr -- this is the line that matters");
  assert.match(code, /ErrorActionPreference = "Continue"/, "and the preference is flipped for the duration as well");
  assert.match(code, /\[int\]\$Attempts = 3/, "three migrate attempts");
  assert.match(code, /\[int\]\$DelaySeconds = 10/, "ten seconds apart");
  assert.match(code, /for \(\$attempt = 1; \$attempt -le \$Attempts; \$attempt\+\+\)/, "every attempt is a loop iteration, so every one is logged");
  assert.match(code, /\[migrate\] attempt \$attempt of \$Attempts/, "each attempt must say which one it is");
  assert.match(code, /\[migrate\] {3}\(stderr\) \$line/, "the child's stderr must land in the log, marked as stderr");
  assert.match(code, /attempt \$attempt failed with exit code \$\(\$result\.Code\)/, "the exit code must be logged");
  assert.match(code, /\[migrate\] applied, exit code 0/, "and so must the success");
  assert.match(
    code,
    /the database schema is NOT current after \$Attempts attempts, so the paper was NOT started/,
    "a migrate that never applies must say so in plain words",
  );
  assert.match(code, /return \$false/, "and RETURN false rather than throwing, so the caller can exit non-zero");
  assert.match(code, /boot-migrate\.out\.log and boot-migrate\.err\.log/, "and point at the whole of the last attempt");
  // The wait asks a QUERY, not the port. A listening port is what let the
  // 20:01 boot through: Postgres opens it while it is still in crash recovery.
  assert.match(code, /-tAc "select 1"/, "the probe must ask Postgres a real question");
  assert.match(code, /\[int\]\$TimeoutSeconds = 180/, "three minutes, because a cold boot's crash recovery is slow");
  assert.match(code, /\[Math\]::Min\(\$attempt, \$MaxIntervalSeconds\)/, "the retry must back off, so a three-minute recovery is a handful of lines");
  assert.match(code, /not answering queries yet \(\$reason\)/, "what Postgres itself said while it was not ready is worth more than any sentence written here");
  assert.match(code, /would not answer a query within/, "and running out of budget must be reported, not thrown");
});

test("the watchdog gives a failed logon start its registered task back, after a boot grace", () => {
  /*
    Problem 2, and the answer to it. When 3000 was down right after boot the
    watchdog did the only thing it knew: launched a DETACHED COPY of
    start-townreporter.ps1 and watched it 45 seconds later. The copy died at
    exactly the same line as the logon task had, so the "repair" failed the
    same way every five minutes and the log said only "FAILED to come up
    healthy". Now: for three minutes after the task last ran the start is
    already in progress and this run leaves it alone and says so; after that,
    if the task's own LastTaskResult is non-zero, the run starts the TASK --
    the ownership-checked entry point, whose LastTaskResult becomes the receipt
    for the repair. Never both.
  */
  const wd = read("watchdog.ps1");
  assert.match(wd, /\$startTaskName = 'TownReporter'/, "the repair must be the registered task, not a script path");
  assert.match(wd, /Get-ScheduledTaskInfo -TaskName \$startTaskName/, "the task's own result is the receipt");
  assert.match(wd, /LastTaskResult -ne 0/, "a failed start is what the repair acts on");
  assert.match(wd, /LastRunTime\.Year -gt 1900/, "a task that has NEVER run (0x41303) is not a failure");
  assert.match(wd, /\$startAge -ge 180/, "the boot grace is three minutes");
  assert.match(wd, /inside the three-minute boot grace, leaving its start alone/, "and the grace must say so in the log");
  assert.match(
    wd,
    /Assert-TownReporterTaskOwnership \$startTaskName 'start-townreporter\.ps1'/,
    "the task must be proven to point at THIS checkout before it is run",
  );
  assert.match(wd, /Start-ScheduledTask -TaskName \$startTaskName/, "the task itself must be started");
  assert.match(wd, /\$env:WATCHDOG_TEST_MODE -ne '1'/, "test mode must never run the real task");
  assert.match(
    wd,
    /\$verifySeconds = if \(\$runTheTask\) \{ 300 \} else \{ 45 \}/,
    "the task path needs five minutes -- it has its own DB wait and three migrate attempts",
  );

  // One path or the other. The boot-grace branch may start nothing at all.
  const graceAt = wd.indexOf("} elseif ($startFailed) {");
  assert.ok(graceAt > 0, "could not find the boot-grace branch");
  const grace = stripComments(wd.slice(graceAt, wd.indexOf("} else {", graceAt)));
  assert.ok(grace.length > 0, "could not slice the boot-grace branch");
  assert.doesNotMatch(
    grace,
    /Start-ScheduledTask|Start-Process|Stop-Process|throw /,
    "inside the grace the run only waits and says so -- it must not repair",
  );

  // And the repair branch must not also launch a detached copy of the script:
  // that is the second starter the whole fix exists to remove.
  const taskAt = wd.indexOf("if ($runTheTask) {");
  assert.ok(taskAt > 0, "could not find the repair branch");
  const repair = stripComments(wd.slice(taskAt, graceAt));
  assert.ok(repair.length > 0, "could not slice the repair branch");
  assert.match(repair, /Assert-TownReporterTaskOwnership[\s\S]{0,160}?Start-ScheduledTask/, "ownership is proven first, then the task runs");
  assert.doesNotMatch(repair, /Start-Process/, "running the task and starting a detached copy are the same repair twice");

  // The detached path is still there for the case it is right for -- down, but
  // the logon task never failed (it was started by hand, or never ran).
  assert.match(stripComments(wd.slice(graceAt)), /Start-Process/, "the detached start must survive for the case it is right for");
});

test("the Redlib install root is a setting a scheduled task can read, outside AppData", () => {
  /*
    Problem 3. Redlib was installed into %LOCALAPPDATA%\RedditSearch\Redlib
    from inside an MSIX-packaged app, and MSIX redirects those writes into
    %LOCALAPPDATA%\Packages\<package>\LocalCache\Local\RedditSearch\Redlib --
    per process. Claude's packaged shell saw the merged view and started the
    reader by hand; the watchdog, which Task Scheduler starts unpackaged, saw
    an empty directory and logged "redlib: not installed here" every five
    minutes while Redlib ran. The .env is the one place both kinds of process
    read the same value, and the path it names has to be outside AppData.
  */
  const lib = read("lib-redlib.ps1");
  const root = lib.slice(lib.indexOf("function Get-RedlibInstallRoot"), lib.indexOf("function Get-RedlibSandboxedRoots"));
  assert.ok(root.length > 0, "could not find Get-RedlibInstallRoot");
  // Priority, in this order, checked by position rather than by presence.
  const rungs = [
    "if ($InstallRoot) { return $InstallRoot }",
    "if ($env:REDLIB_INSTALL_ROOT) { return $env:REDLIB_INSTALL_ROOT }",
    'Read-OpsEnvValue -EnvFile $EnvFile -Name "REDLIB_INSTALL_ROOT"',
    "return (Join-Path $env:LOCALAPPDATA",
  ];
  let previous = -1;
  for (const rung of rungs) {
    const at = root.indexOf(rung);
    assert.ok(at > previous, `the install-root priority is missing or out of order at: ${rung}`);
    previous = at;
  }
  assert.match(root, /RedditSearch\\Redlib/, "the last rung must stay the skill's own default");
  assert.match(lib, /run ops\\redlib-relocate\.ps1/, "an absent reader that exists in a sandbox must say what to run");
  assert.match(lib, /Get-RedlibSandboxedRoots/, "the sandboxed copies must be findable at all");

  // ops\redlib.ps1 resolves the root ONCE, in its body. A parameter default is
  // evaluated before the library loads, which is how the old %LOCALAPPDATA%
  // default survived into the scheduled-task path.
  const redlib = read("redlib.ps1");
  assert.doesNotMatch(
    stripComments(redlib),
    /\[string\]\$InstallRoot\s*=\s*\(Join-Path \$env:LOCALAPPDATA/,
    "the install root must not be defaulted at parameter-binding time",
  );
  assert.match(redlib, /if \(-not \$InstallRoot\) \{\s*\$InstallRoot = Get-RedlibInstallRoot/, "the body must resolve it");
  assert.match(redlib, /"-File", \$script, "-InstallRoot", \$InstallRoot/, "the skill's script must be told the same root as an argument");
  assert.match(
    redlib,
    /\$env:REDLIB_INSTALL_ROOT = \$InstallRoot/,
    "and the child must inherit it as an environment variable -- the rung the skill falls back to",
  );
  // The detached start must hand its own root down too: it is a bare `start`
  // with nothing reading what the child says, so the variable is the only way
  // the child can land on the same install the caller asked about.
  const startIfDown = lib.slice(lib.indexOf("function Start-RedlibIfDown"), lib.indexOf("function Stop-Redlib"));
  assert.match(
    startIfDown,
    /\$env:REDLIB_INSTALL_ROOT = \(Get-RedlibInstallRoot -InstallRoot \$InstallRoot -EnvFile \$EnvFile\)/,
    "Start-RedlibIfDown must pass the caller's root to the detached child",
  );

  // The console -- and the Control page, which renders these rows -- must not
  // report a machine that has no reader when the reader is running and merely
  // invisible to it.
  assert.match(read("status.ps1"), /Get-RedlibAbsenceNote/, "status must use the shared absence wording");
  assert.match(read("watchdog.ps1"), /'absent' {2}\{ Write-Log "redlib: \$\(Get-RedlibAbsenceNote\)" \}/, "so must the watchdog");
});

test("redlib-relocate.ps1 copies rather than moves, refuses a live reader, and never edits .env", () => {
  /*
    Problem 3's one-time repair. Its promises are the timid kind and they are
    exactly the properties worth protecting: it COPIES (the old install is left
    untouched, so a mistake costs nothing), it refuses to touch an install that
    is running (Redlib's executable is what is being copied), it does nothing
    when the target is inside AppData unless told -Force, and it never edits
    .env -- it prints the line, because .env is the file the paper and every
    scheduled task read.
  */
  const raw = read("redlib-relocate.ps1");
  const code = stripComments(raw);
  assert.match(raw, /\[switch\]\$Force/, "-Force must exist for a deliberate AppData target");
  assert.match(raw, /\[switch\]\$DryRun/, "-DryRun must exist");
  const toDefault = raw.match(/\$To\s*=\s*"([^"]+)"/);
  assert.ok(toDefault, "could not find the -To default");
  assert.doesNotMatch(toDefault[1], /AppData/i, "the default -To must be OUTSIDE AppData, or the redirect applies to the copy too");

  assert.match(code, /Copy-Item -LiteralPath \$item\.FullName -Destination \$target -Recurse -Force/, "it must copy");
  assert.doesNotMatch(code, /Move-Item/, "and must not move: the original stays where it was");
  assert.doesNotMatch(code, /Remove-Item[^\n]*\$source/, "nothing may delete the source install");
  assert.doesNotMatch(code, /Add-Content|Out-File|Set-Content/, "it must write no file by text -- .env above all");
  assert.match(code, /REDLIB_INSTALL_ROOT=/, "it must print the .env line instead");
  assert.match(code, /Refusing to copy an install out from under a live reader/, "a running reader must be refused, not copied");
  assert.match(code, /-in @\('live', 'unverified', 'other'\)/, "and the same for a pid it could not identify");
  assert.doesNotMatch(code, /Stop-Process|Stop-Redlib|taskkill/, "it stops nothing -- stopping the reader is ops\\redlib.ps1's job");

  // install.json is rewritten at the OBJECT level. A text replace finds
  // nothing: the paths in the file are written with doubled backslashes.
  assert.match(raw, /ConvertFrom-Json[\s\S]{0,300}?Convert-PathInValue/, "the rewrite must walk the parsed object");
  assert.match(code, /ConvertTo-Json -Depth 10/, "and write it back as JSON");
  assert.match(code, /\[IO\.File\]::WriteAllText\([\s\S]{0,160}?UTF8Encoding\(\$false\)/, "UTF-8 with no BOM, readable by both PowerShells");
  assert.match(code, /Get-RedlibSandboxedRoots/, "it must look in the MSIX LocalCache copies, which is where the install really was");
  assert.ok(
    code.includes("RedditSearch\\Redlib"),
    "and at the skill's own default, so a bare run finds a broken machine's install",
  );
});

test(
  "the logon start survives a database that refuses queries, proven without a reboot",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      Fix 1's proof, and the brief's "prove it without a reboot". The fixture
      runs the REAL code -- Wait-TownReporterDatabase and
      Invoke-TownReporterMigrate out of ops\lib-migrate.ps1, the exact functions
      ops\start-townreporter.ps1 calls between "the port is open" and "serve the
      paper" -- against .cmd stubs in a temp directory: a probe that refuses
      twice with "the database system is starting up" on stderr and then
      answers, a migrate that fails twice and then applies, under
      $ErrorActionPreference = "Stop" in the caller. It also runs the old
      `2>&1` idiom once to show it really does die, which is the regression.

      No reboot, no Postgres, no port, no network, no live service: the two
      assertions below about what the fixture may contain are as load-bearing
      as the ones about what it prints.
    */
    const fixture = join(ROOT, "scripts", "ci-boot-recovery.ps1");
    assert.ok(existsSync(fixture), "scripts/ci-boot-recovery.ps1 is missing");
    const text = readFileSync(fixture, "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `scripts/ci-boot-recovery.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
    assert.doesNotMatch(
      text,
      /Start-Process|Get-NetTCPConnection|Invoke-WebRequest|Invoke-RestMethod/,
      "the fixture must touch nothing live -- stubs in a temp directory only",
    );

    let out = "";
    let code = 0;
    try {
      out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture],
        { encoding: "utf8", timeout: 300_000 },
      );
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      code = err.status ?? -1;
    }
    assert.doesNotMatch(out, /FAIL/, `a boot-recovery check failed:\n${out}`);
    assert.match(out, /boot recovery: every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);

test(
  "REDLIB_INSTALL_ROOT comes from the app's .env, and the environment wins over it",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The .env rung read for real, and the priority around it. The probe is a
      file rather than an inline -Command: nested quoting through `powershell
      -Command` is a class of bug in its own right. Nothing here starts,
      stops or looks for a Redlib -- it resolves a path and prints it.
    */
    const dir = mkdtempSync(join(tmpdir(), "redlib-root-"));
    try {
      const fromFile = join(dir, "from-file");
      const fromEnv = join(dir, "from-env");
      const explicit = join(dir, "explicit");
      const envFile = join(dir, "app.env");
      writeFileSync(envFile, `# the install's settings\nREDLIB_INSTALL_ROOT=${fromFile}\n`, "utf8");
      const quote = (p) => `'${p}'`;
      const probe = join(dir, "probe.ps1");
      writeFileSync(
        probe,
        [
          '$ErrorActionPreference = "Continue"',
          `. ${quote(join(OPS, "lib-redlib.ps1"))}`,
          `$EnvFile = ${quote(envFile)}`,
          '$env:REDLIB_INSTALL_ROOT = ""',
          '"file=" + (Get-RedlibInstallRoot -EnvFile $EnvFile)',
          `$env:REDLIB_INSTALL_ROOT = ${quote(fromEnv)}`,
          '"env=" + (Get-RedlibInstallRoot -EnvFile $EnvFile)',
          '$env:REDLIB_INSTALL_ROOT = ""',
          `"explicit=" + (Get-RedlibInstallRoot -InstallRoot ${quote(explicit)} -EnvFile $EnvFile)`,
          '$env:REDLIB_INSTALL_ROOT = ""',
          '"default=" + (Get-RedlibInstallRoot -EnvFile (Join-Path $PSScriptRoot "nothing.env"))',
          "",
        ].join("\r\n"),
        "utf8",
      );
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", probe],
        { encoding: "utf8", timeout: 120_000 },
      );
      const value = (key) => {
        const line = out.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
        assert.ok(line, `the probe printed no ${key}= line:\n${out}`);
        return line.slice(key.length + 1).trim();
      };
      const same = (a, b) => assert.equal(a.toLowerCase(), b.toLowerCase(), `expected ${b}, got ${a}`);
      same(value("file"), fromFile);
      same(value("env"), fromEnv);
      same(value("explicit"), explicit);
      // The last rung is the skill's own default, and it is the one path a
      // scheduled task cannot see -- which is why the .env rung exists.
      same(value("default"), join(process.env.LOCALAPPDATA ?? "", "RedditSearch", "Redlib"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "redlib-relocate.ps1 on a fake install: copies it, rewrites its paths, refuses a live one",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The helper run for real, against a FAKE install in a temp directory. It
      is never pointed at this machine's Redlib: the brief asks for a fake
      install and that is what `plant` builds -- a directory with an
      install.json, a stub executable and a config, on a port nothing listens
      on (65533), so the liveness probe is refused locally and no service is
      touched. The temp directory lives under %LOCALAPPDATA%, which is why
      every copy here passes -Force: the AppData warning is exactly the branch
      this fixture exercises.

      install.json is written as JSON TEXT, never as an inline PSCustomObject
      literal. `"built at " + $root, "unrelated"` parses as
      `"built at " + ($root, "unrelated")` -- the comma binds tighter than + --
      so a literal built that way is ONE space-joined string, and the array
      assertion below would pass for the wrong reason.
    */
    const script = join(OPS, "redlib-relocate.ps1");
    const base = mkdtempSync(join(tmpdir(), "redlib-relocate-"));
    const run = (args) => {
      try {
        return {
          code: 0,
          out: execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
            { encoding: "utf8", timeout: 120_000 },
          ),
        };
      } catch (err) {
        return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    };
    const plant = (root, opts = {}) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, "install.json"),
        `${JSON.stringify(
          {
            installRoot: root,
            executable: join(root, "redlib.exe"),
            baseUrl: "http://127.0.0.1:65533",
            logPath: join(root, "redlib.log"),
            notes: [`built at ${root}`, "unrelated"],
            commit: "b6a2a5e",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(join(root, "redlib.exe"), "stub, never run\n", "utf8");
      writeFileSync(join(root, "config.toml"), "port = 65533\n", "utf8");
      if (opts.pid !== undefined) writeFileSync(join(root, "redlib.pid"), String(opts.pid), "utf8");
    };
    const noEnv = join(base, "absent.env");
    try {
      // 1. The copy. -Force because the target is under %LOCALAPPDATA%.
      const src = join(base, "from");
      const dst = join(base, "to");
      plant(src);
      const copy = run(["-From", src, "-To", dst, "-Force", "-EnvFile", noEnv]);
      assert.equal(copy.code, 0, `the copy exited ${copy.code}:\n${copy.out}`);
      assert.ok(
        copy.out.toLowerCase().includes(`redlib_install_root=${dst}`.toLowerCase()),
        `the .env line must be printed:\n${copy.out}`,
      );
      assert.match(copy.out, /inside AppData/, "a target under AppData must be called out");
      assert.match(copy.out, /was not changed or deleted/, "the run must say the original is still there");
      const moved = JSON.parse(readFileSync(join(dst, "install.json"), "utf8"));
      assert.equal(moved.installRoot.toLowerCase(), dst.toLowerCase(), "installRoot must name the new place");
      assert.equal(moved.executable.toLowerCase(), join(dst, "redlib.exe").toLowerCase(), "so must executable");
      assert.equal(moved.logPath.toLowerCase(), join(dst, "redlib.log").toLowerCase(), "and any other path in it");
      assert.deepEqual(moved.notes, [`built at ${dst}`, "unrelated"], "a path inside an ARRAY must be rewritten, and the array must stay an array");
      assert.equal(moved.commit, "b6a2a5e", "a value that is not a path must be left alone");
      assert.ok(existsSync(join(dst, "config.toml")), "the whole install must be copied");
      assert.ok(!existsSync(join(dst, "redlib.pid")), "the pid file belongs to a process, not to an install");
      assert.ok(
        !readFileSync(join(dst, "install.json"), "utf8").toLowerCase().includes(src.toLowerCase()),
        "the copy must not still name the old root anywhere",
      );
      const kept = JSON.parse(readFileSync(join(src, "install.json"), "utf8"));
      assert.equal(kept.installRoot, src, "the original install.json must be untouched");
      assert.ok(existsSync(join(src, "redlib.exe")), "and the original executable must still be there -- this copies, it does not move");

      // 2. A live reader is refused. This process's own pid is alive but is not
      //    running redlib.exe, so the helper cannot identify it -- also a
      //    refusal, and the more dangerous of the two to get wrong.
      const liveSrc = join(base, "live");
      const liveDst = join(base, "live-copy");
      plant(liveSrc, { pid: process.pid });
      const refused = run(["-From", liveSrc, "-To", liveDst, "-Force", "-EnvFile", noEnv]);
      assert.equal(refused.code, 1, `a live reader must be refused:\n${refused.out}`);
      assert.match(refused.out, /Refusing to copy an install out from under a live reader/);
      assert.ok(!existsSync(liveDst), "nothing may be copied when the reader is running");

      // 3. An existing install at the target, without -Force.
      const someSrc = join(base, "somewhere");
      const takenDst = join(base, "taken");
      plant(someSrc);
      plant(takenDst);
      const taken = run(["-From", someSrc, "-To", takenDst, "-EnvFile", noEnv]);
      assert.equal(taken.code, 1, `an occupied target must be refused without -Force:\n${taken.out}`);
      assert.match(taken.out, /There is already a Redlib install at/);

      // 4. -DryRun prints the plan and changes nothing.
      const drySrc = join(base, "dry-src");
      const dryDst = join(base, "dry-dst");
      plant(drySrc);
      const dry = run(["-From", drySrc, "-To", dryDst, "-Force", "-DryRun", "-EnvFile", noEnv]);
      assert.equal(dry.code, 0, `the dry run exited ${dry.code}:\n${dry.out}`);
      assert.match(dry.out, /dry run: nothing below this line happens/);
      assert.ok(!existsSync(dryDst), "-DryRun must not create the target");

      // 5. A -From that holds no install is an error, not a silent search.
      const missing = run(["-From", join(base, "nothere"), "-To", join(base, "x"), "-Force", "-EnvFile", noEnv]);
      assert.equal(missing.code, 1);
      assert.match(missing.out, /no Redlib install at -From/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

/* -------------------------------------------------------------------------
   The backups, the copy to D: and the alerts (unit AJ, 0.6.68).

   The owner's rules are enforced for real by scripts\ci-backup.ps1, which runs
   the library against fake folders in a temp directory. These are the checks
   that have to hold on a Linux CI runner too: that the files are there, that
   the watchdog's two new sections are gated and cannot take the paper down
   with them, that the conditions have one definition and no caller hands them
   to the library as an array, and that 267009 is not read as a failure. The
   last test executes the PowerShell harness on Windows, the way the
   boot-recovery one does.
   ------------------------------------------------------------------------- */

test("the watchdog takes one backup a night and reports what is wrong, in its own gated sections", () => {
  /*
    The owner is shrinking programs, not adding them: the Watchdog task already
    runs every five minutes, so "is a backup due" is one more question it asks
    rather than one more scheduled task on the machine. The two sections are
    read here for the two ways they could hurt the paper -- throwing into the
    app's path, and running at all in test mode -- and for the one thing that
    must be true of a backup: that it goes through the library, so the nightly
    run, promote.ps1 and the Control page's button cannot prune differently.
  */
  const wd = read("watchdog.ps1");
  const backupAt = wd.indexOf("# --- Nightly backup ---");
  const alertAt = wd.indexOf("# --- Alerts ---");
  const reachAt = wd.indexOf("# --- Public reachability ---");
  assert.ok(backupAt > 0 && alertAt > backupAt, "could not find the nightly backup and the alerts sections");
  assert.ok(
    reachAt > 0 && reachAt < backupAt,
    "both sections must sit AFTER the public reachability probe: above it are the measured facts they read ($appHealthy, $siteHealthy, $pgUp), and below it is what CI can slice without running PowerShell",
  );

  const backup = stripComments(wd.slice(backupAt, alertAt));
  const alerts = stripComments(wd.slice(alertAt));
  assert.ok(backup.length > 0 && alerts.length > 0, "could not slice the two new sections");

  for (const [name, section] of [
    ["backup", backup],
    ["alerts", alerts],
  ]) {
    assert.match(
      section,
      /if \(\$env:WATCHDOG_TEST_MODE -ne '1'\) \{/,
      `the ${name} section must be skipped in test mode -- a runner has no database to dump and 5433 never means a runner's Postgres`,
    );
    assert.ok(
      [...section.matchAll(/catch\s*\{/g)].length >= 1,
      `the ${name} section must catch its own failures`,
    );
    assert.match(
      section,
      new RegExp(`Write-Log "${name}: check failed: \\$\\(\\$_\\.Exception\\.Message\\) -- the paper is unaffected"`),
      `a failure in the ${name} section must be reported and must say the paper is unaffected rather than throw`,
    );
    assert.doesNotMatch(
      section,
      /Stop-Process|Start-ScheduledTask|Start-Process/,
      `the ${name} section must not start or stop anything -- neither is a backup or an alert`,
    );
    assert.doesNotMatch(section, /\bthrow\b/, `the ${name} section must not throw into the paper's path`);
  }

  // The backup itself. One rule, one lock, one prune: the library's.
  for (const fn of ["Test-TownReporterBackupDue", "Test-TownReporterDeskBusy", "Invoke-TownReporterBackupRun"]) {
    assert.match(backup, new RegExp(fn), `the nightly backup must go through ${fn}`);
  }
  assert.match(
    backup,
    /\. \(Join-Path \$PSScriptRoot "lib-backup\.ps1"\)/,
    "the section must dot-source the library itself, not rely on an earlier section having done it",
  );
  assert.match(backup, /an editor job is running; leaving it for the next run/, "a busy desk defers the backup, in plain words");
  assert.match(
    backup,
    /the last attempt failed \$minutesSinceAttempt minute\(s\) ago; waiting half an hour/,
    "a failed dump leaves no file, so without this the due rule would retry it every five minutes all day",
  );
  assert.match(backup, /if \(-not \$due\.Due\) \{/, "the 2 AM / 20 hour rule decides, not a second copy of it written here");

  // The alerts. The facts come from above; only the scan needs asking, and it
  // is asked read-only through psql the way ops\control\last-scan.cjs asks.
  assert.doesNotMatch(
    alerts,
    /Invoke-WebRequest|Invoke-RestMethod|Test-NetConnection/,
    "the alert section must read the facts already measured above, not probe the paper a second time",
  );
  assert.match(alerts, /Get-TownReporterScanState -App \$app -PgPort \(\[int\]\$pgPort\)/, "the daily scan must be read the way the Control page reads it");
  assert.match(alerts, /Test-TownReporterScanAlert -State \$scan -Now/, "and judged by the library, not by a rule written here");
  assert.match(
    alerts,
    /Active = \$null; Detail = 'Postgres is down, so the daily scan could not be read'/,
    "a database that cannot be read must leave scan-missing UNEVALUATED: clearing an alert about a scan nobody could check is worse than saying nothing",
  );
  assert.match(
    alerts,
    /Invoke-TownReporterAlertCheck -App \$app -EnvFile \$envFile -Conditions \$conditions -Now/,
    "the run must hand the whole list to the library in one call",
  );
  for (const id of ["paper-down", "site-down", "scan-missing"]) {
    assert.match(alerts, new RegExp(`'${id}'`), `the watchdog must report the ${id} condition`);
  }
  assert.match(alerts, /Get-TownReporterBackupAlertConditions -App \$app -EnvFile \$envFile -MinFreeGb 100/, "and the three backup conditions must come from the library");
  assert.match(alerts, /\$conditions \+= Get-TownReporterBackupAlertConditions/, "appended straight, not wrapped in @() -- see the note in lib-backup.ps1");
});

test("the three backup conditions have one definition, and no caller hands them over as an array", () => {
  /*
    Measured on 2026-09-25, the day this was written: Get-TownReporterBackupAlertConditions
    hands back its list with a unary comma, so a direct assignment and a += both
    see the three conditions, but @() around the call does NOT flatten them --
    it makes a ONE-item array whose single item IS the array. [string] on that
    item's Id then joins the ids into "scan-missing offsite-failing", written to
    logs\alerts.json as one key. The Control page would show one nonsense row
    and the real alerts would never fire. The library now flattens one level so
    a caller that wraps anyway still gets its alerts; this test is the other
    half -- that the callers shipped on this machine do not wrap.
  */
  const lib = read("lib-backup.ps1");
  assert.match(lib, /function Get-TownReporterBackupAlertConditions/, "lib-backup.ps1 must own the conditions");
  assert.match(lib, /return ,@\(\$conditions\)/, "and must hand them back with the unary comma, the way Get-TownReporterBackupList does");
  for (const id of ["backup-stale", "offsite-failing", "offsite-low-space"]) {
    assert.match(lib, new RegExp(`Id = '${id}'`), `the library must build the ${id} condition`);
  }
  assert.match(
    read("lib-alert.ps1"),
    /if \(\$c -is \[array\]\) \{ foreach \(\$inner in \$c\) \{ \[void\]\$flat\.Add\(\$inner\) \} \}/,
    "the alert consumer must flatten one level, so a caller that wraps the list still gets one alert per condition instead of one joined id",
  );

  // Every caller, found by reading the directory rather than by naming two
  // files: a third caller added later is exactly the one that would wrap.
  const callers = readdirSync(OPS)
    .filter((f) => f.endsWith(".ps1"))
    .filter((f) => stripComments(read(f)).includes("Get-TownReporterBackupAlertConditions"))
    .sort();
  assert.deepEqual(
    callers,
    ["backup.ps1", "lib-backup.ps1", "watchdog.ps1"],
    "the conditions must be defined once and called from the nightly run and the manual run, and nothing else",
  );
  for (const caller of ["backup.ps1", "watchdog.ps1"]) {
    assert.doesNotMatch(
      stripComments(read(caller)),
      /@\(\s*Get-TownReporterBackupAlertConditions/,
      `${caller} must not wrap the conditions call in @(): that makes one item which IS the list, and the ids collapse into a sentence`,
    );
  }
});

test("267009 is the logon start still running, not a start that failed", () => {
  /*
    Found by the reboot test of 2026-09-25: a cold boot spends a minute or more
    in Postgres recovery, the start task was therefore still running, and the
    watchdog read its LastTaskResult of 267009 (SCHED_S_TASK_RUNNING) as a
    failure -- logging a repair it had not needed and, once outside the grace,
    starting the task a second time. Both 267009 cases mean "the start is
    somewhere else"; neither is this run's to repair.
  */
  const wd = read("watchdog.ps1");
  assert.match(
    wd,
    /\$startRunning = \[bool\]\(\$startHasRun -and \$startInfo\.LastTaskResult -eq 267009\)/,
    "267009 must be recognised as its own state, not folded into the failure test",
  );
  assert.match(
    wd,
    /\$startFailed = \[bool\]\(\$startHasRun -and \$startInfo\.LastTaskResult -ne 0 -and -not \$startRunning\)/,
    "and a start that is running must not also count as failed",
  );
  assert.match(wd, /\$runTheTask = \(\$startFailed -and/, "the repair must be driven by the failure, so 267009 can never start the task again");

  const runningAt = wd.indexOf("} elseif ($startRunning) {");
  assert.ok(runningAt > 0, "could not find the 267009 branch");
  const running = stripComments(wd.slice(runningAt, wd.indexOf("} elseif ($startFailed) {", runningAt)));
  assert.ok(running.length > 0, "could not slice the 267009 branch");
  assert.match(running, /start still running \(waiting for the database\)/, "the log must say what 267009 actually is, in the owner's words");
  assert.doesNotMatch(
    running,
    /Start-ScheduledTask|Start-Process|Stop-Process|\bthrow\b/,
    "the 267009 branch waits and says so -- it repairs nothing, because nothing is broken",
  );
  assert.match(
    wd,
    /\$whyWait = if \(\$startRunning\) \{ 'start still running \(waiting for the database\)' \}/,
    "and the no-repair line at the bottom must use the same words, because a FAILED there was the lie on the reboot test",
  );
});

test(
  "the backups, the copy to D: and the alerts pass every check without a database",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The owner's rules, executed. scripts\ci-backup.ps1 runs the REAL library
      -- New-TownReporterBackup, Copy-TownReporterBackupOffsite,
      Remove-TownReporterBackupOld, Invoke-TownReporterBackupRun,
      Invoke-TownReporterAlertCheck -- against fake folders in a temp
      directory: six local backups, an empty "D:", a missing drive, an
      unwritable one, a copy whose hash does not match, a truncated dump, and
      the wrapped and appended forms of the conditions call.

      The dump seam is -DumpCommand, so no pg_dump is launched and no Postgres
      is touched: the harness's own stub is what throws "there is no pg_dump on
      this machine". The three assertions about what the harness may contain
      are as load-bearing as the ones about what it prints -- this file must
      never be a way to touch the live paper or the real backup folders.
    */
    const fixture = join(ROOT, "scripts", "ci-backup.ps1");
    assert.ok(existsSync(fixture), "scripts/ci-backup.ps1 is missing");
    const text = readFileSync(fixture, "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `scripts/ci-backup.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
    assert.doesNotMatch(
      text,
      /Start-Process|Get-NetTCPConnection|Invoke-WebRequest|Invoke-RestMethod|Invoke-Command/,
      "the fixture must touch nothing live -- fake folders in a temp directory only",
    );
    assert.match(text, /GetTempPath\(\)/, "and its fake world must be built under the OS temp directory");
    assert.match(text, /\$script:backupDir = Join-Path \$script:world "townreporter-backups"/, "with the local folder inside that temp world, never the real sibling");
    assert.match(text, /throw 'there is no pg_dump on this machine'/, "the dumps must be written by a stub, so no database is ever dumped");
    assert.ok(text.includes("-DumpCommand $dumpGood"), "and every run must be given that stub");
    // 5433 appears twice, and both times as text written into a fake .env --
    // the port is read for the database NAME off the URL and never connected
    // to. Anything else containing the live port is the start of a real
    // connection to this machine's cluster.
    const withPort = text.split("\n").filter((l) => l.includes("5433"));
    assert.equal(withPort.length, 2, `5433 must appear only in the fake .env the fixture writes, but it is on ${withPort.length} line(s)`);
    for (const line of withPort) {
      assert.match(
        line,
        /DATABASE_URL=postgres:\/\/postgres@127\.0\.0\.1:5433\/townreporter/,
        "a line naming the live port that is not the fake DATABASE_URL is a real connection to Postgres 5433",
      );
    }

    let out = "";
    let code = 0;
    try {
      out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture],
        { encoding: "utf8", timeout: 600_000 },
      );
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      code = err.status ?? -1;
    }
    assert.doesNotMatch(out, /FAIL/, `a backup or alert check failed:\n${out}`);
    assert.match(out, /backups and alerts: every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);


/**
 * A file hash must not depend on a module being reachable.
 *
 * Measured on this machine on 2026-09-26: a Windows PowerShell 5.1 session
 * that inherited PowerShell 7's PSModulePath cannot call Get-FileHash at all
 * -- `Get-Command` still lists it, the call throws CommandNotFoundException.
 * Two places hashed a file that way. ops\promote.ps1 checks the lockfile in
 * step 5, with the live paper already stopped by step 4; installer\
 * Install.ps1 checks a downloaded archive's digest. Both now use .NET
 * SHA256 -- ops\promote.ps1 through Get-TownReporterFileHash in
 * ops\lib-backup.ps1, which it already dot-sources, and the installer
 * inline, because it cannot dot-source ops\.
 *
 * The scan below is the cheap half and catches a third one being added
 * anywhere the paper runs. scripts\ci-hash-no-module.ps1 is the half that
 * executes the real changed code inside a session where the cmdlet is
 * genuinely gone -- and refuses to pass unless the sabotage itself worked.
 */
test("no script the paper runs hashes a file with a cmdlet that a 5.1 session may not have", () => {
  const dirs = [
    ["ops", OPS],
    ["installer", join(ROOT, "installer")],
  ];
  const callers = [];
  for (const [label, dir] of dirs) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ps1"))) {
      const text = readFileSync(join(dir, name), "utf8");
      // Comments may name the cmdlet -- the explanation of why it is gone
      // belongs next to the code. Only a real call is the defect, so strip
      // both comment forms first.
      let inBlock = false;
      text.split("\n").forEach((line, i) => {
        let code = line;
        if (inBlock) {
          const end = code.indexOf("#>");
          if (end === -1) return;
          code = code.slice(end + 2);
          inBlock = false;
        }
        const open = code.indexOf("<#");
        if (open !== -1) {
          const end = code.indexOf("#>", open + 2);
          if (end === -1) {
            code = code.slice(0, open);
            inBlock = true;
          } else {
            code = code.slice(0, open) + code.slice(end + 2);
          }
        }
        if (code.trimStart().startsWith("#")) return;
        if (/Get-FileHash\b/.test(code)) callers.push(`${label}/${name}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(
    callers,
    [],
    `Get-FileHash is unreachable when PSModulePath comes from PowerShell 7 -- use Get-TownReporterFileHash (ops/) or inline .NET SHA256 (installer/) at ${callers.join(", ")}`,
  );
});

test(
  "the changed hash paths run in a PowerShell 5.1 session that cannot reach Get-FileHash",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The real code, in the broken session: the two lockfile lines lifted out
      of ops\promote.ps1 and evaluated, and installer\Install.ps1's
      Get-VerifiedDependency extracted the same way
      scripts\windows-installer-contract.ps1 extracts it -- so no Common.ps1
      repair is in scope for the installer either. Both must produce the same
      answers they produce with the module present, including refusing a
      mismatched download.
    */
    const fixture = join(ROOT, "scripts", "ci-hash-no-module.ps1");
    assert.ok(existsSync(fixture), "scripts/ci-hash-no-module.ps1 is missing");
    const text = readFileSync(fixture, "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `scripts/ci-hash-no-module.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
    assert.doesNotMatch(
      text,
      /Start-Process|Get-NetTCPConnection|Invoke-WebRequest|Invoke-RestMethod|Invoke-Command/,
      "the fixture must touch nothing live -- a temp directory only",
    );
    assert.match(text, /GetTempPath\(\)/, "and its world must be built under the OS temp directory");

    let out = "";
    let code = 0;
    try {
      out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-AppRoot", ROOT],
        { encoding: "utf8", timeout: 300_000 },
      );
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      code = err.status ?? -1;
    }
    assert.doesNotMatch(out, /FAIL/, `a hash check failed:\n${out}`);
    assert.match(out, /file hashing without a module: every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);

/* ─────────── the staged copy on 3100 comes back after a reboot ─────────── */

/**
 * The two files that bring back what ops\stage.ps1 already staged.
 *
 * The reboot is the case: the restored townreporter_dev, the build and the
 * files it wrote all survive it, the running server does not, and the only way
 * back used to be the whole stage again -- drop the database, restore the
 * backup, rebuild. ops\lib-stage.ps1 decides and starts nothing; the watchdog
 * calls ops\start-stage.ps1, which starts and still decides for itself.
 *
 * Every assertion below is one of the three rules those files are built on:
 * it starts and never stops; it starts only what was already staged; and it
 * never puts a second copy on a port something already holds.
 */
const STAGE_LIB = read("lib-stage.ps1");
const STAGE_START = read("start-stage.ps1");
// Comments stripped for the negative assertions: both files say in prose that
// they never kill anything, and a bare doesNotMatch would fail on the sentence
// that makes the promise rather than on a line that breaks it.
const STAGE_LIB_CODE = stripComments(STAGE_LIB);
const STAGE_CODE = stripComments(STAGE_START);

test("the staged copy's start path is start-only, and stays ASCII for 5.1", () => {
  for (const [name, text] of [
    ["lib-stage.ps1", STAGE_LIB],
    ["start-stage.ps1", STAGE_START],
  ]) {
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `ops\\${name} has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
  }

  for (const [name, code] of [
    ["lib-stage.ps1", STAGE_LIB_CODE],
    ["start-stage.ps1", STAGE_CODE],
  ]) {
    assert.doesNotMatch(
      code,
      /Stop-Process|taskkill|Remove-Item[^\n]*\.stage\.pid/,
      `ops\\${name} must never stop anything: a copy on that port belongs to the operator, and ops\\stage.ps1 -Stop is the only stop`,
    );
  }
  assert.doesNotMatch(
    STAGE_CODE,
    /\bpsql\b|Invoke-Sqlcmd|drop database|createdb|\brestore\b/i,
    "the start path restores nothing -- it is the half of staging a reboot did not take away",
  );
  assert.doesNotMatch(STAGE_CODE, /npm (run )?build|vite build/i, "and it builds nothing: the build is already on disk");

  // The port comes from ops\.stage.json through the shared decision, never from
  // a literal typed into this file. 3100 is only the default; a state file may
  // name any safe port, and a number written here would be a second, silently
  // disagreeing answer to a question the file already answers.
  assert.doesNotMatch(STAGE_CODE, /\b3100\b|\b3000\b/, "ops\\start-stage.ps1 must not name a port of its own");
  assert.match(STAGE_CODE, /\$stagePort = \$info\.Port/, "the port must come from Get-TownReporterStageInfo");
  // It does read 5433 -- as the input that lets the library refuse a state file
  // naming the database's port. Nothing is ever started on it.
  assert.match(STAGE_CODE, /-PgPort 5433/, "the database's port is passed to the verifier so it can be refused by name");
  assert.match(
    STAGE_CODE,
    /\. \(Join-Path \$PSScriptRoot "lib-ownership\.ps1"\)[\s\S]{0,400}Assert-TownReporterLegacyOwnership -Watchdog/,
    "a script that starts a server on this checkout must ask the same opt-in question the watchdog asked",
  );

  // Nothing is started while the port is taken: every verdict but 'down' and a
  // watchdog-owned 'starting' declines, in the decision's own words.
  assert.match(STAGE_CODE, /switch \(\$info\.Verdict\)/, "the decision to start must be the library's verdict, not a second opinion");
  const declines = [...STAGE_CODE.matchAll(/'(none|up|wedged)'\s+\{ Decline/g)].map((m) => m[1]);
  assert.deepEqual(declines.sort(), ["none", "up", "wedged"], "none, up and wedged must all decline");
  assert.match(
    STAGE_CODE,
    /'starting' \{\s*\n\s*if \(-not \$Watchdog\) \{ Decline/,
    "a start already in flight is declined unless the watchdog says the record is its own handwriting",
  );
  assert.match(STAGE_CODE, /\[switch\]\$Watchdog/, "the -Watchdog switch the watchdog passes must exist");

  // The order that makes a failed start survivable: the attempt is written
  // before the process is spawned, and the pid file before the wait, so a
  // process that dies on its first line is still on record and still visible.
  const recordedAt = STAGE_CODE.indexOf("Save-TownReporterStageStartRecord");
  const spawnedAt = STAGE_CODE.indexOf("Start-Process -FilePath $nodeExe");
  assert.ok(recordedAt >= 0 && spawnedAt > recordedAt, "the attempt must be recorded BEFORE the spawn, or the floor is not a floor");
  const pidAt = STAGE_CODE.indexOf("Set-Content -Path $paths.Pid");
  const waitedAt = STAGE_CODE.indexOf("for ($i = 0; $i -lt 100; $i++)");
  assert.ok(pidAt >= 0 && waitedAt > pidAt, "the pid file must be written before the wait, so the page can see what is starting");

  // The build goes on the command line as an absolute path in quotes, exactly
  // as ops\start-townreporter.ps1 writes it: Windows reports a command line as
  // it was typed, and Test-TownReporterServerProcess matches that path, which is
  // how a copy started from here is recognised as ours. ops\stage.ps1 passes
  // the same file relative, and lib-stage.ps1 has a weaker wording for that.
  assert.match(
    STAGE_CODE,
    /-ArgumentList @\("scripts\/with-app-env\.mjs", "node", "`"\$outputServer`""\)/,
    "the built server must go on the command line as a quoted absolute path, or the copy is not recognised as ours",
  );
});

test("start-stage.ps1 starts the staged copy in stage.ps1's own environment, to the letter", () => {
  /*
    Two files now start "the staged copy", and if they disagree about the
    database or the host then a reboot quietly hands the operator a different
    server than the one they were walking: the same port, pointing at the live
    townreporter database. So the environment block is compared line for line,
    with each file's own variables resolved to what they actually are today --
    which is also why the two resolutions below are asserted separately: a
    `$dbName` that drifted off townreporter_dev would otherwise be normalised
    away and this test would pass while agreeing about nothing.
  */
  const stageText = read("stage.ps1");
  const dbName = stageText.match(/\$dbName = "([^"]+)"/);
  const pgPort = stageText.match(/\$pgPort = (\d+)/);
  assert.ok(dbName && pgPort, "could not find $dbName or $pgPort in ops\\stage.ps1");
  assert.equal(dbName[1], "townreporter_dev", "staging targets townreporter_dev and nothing else");
  assert.equal(pgPort[1], "5433", "staging's Postgres port is 5433");

  const resolve = (value) =>
    value
      .replace(/\$(Port|stagePort)\b/g, "<port>")
      .replace(/\$pgPort\b/g, pgPort[1])
      .replace(/\$dbName\b/g, dbName[1]);
  const envBlock = (ps) =>
    new Map([...ps.matchAll(/^\$env:([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], resolve(m[2])]));

  const staged = envBlock(STAGE_START);
  const stage = envBlock(stageText);
  assert.deepEqual([...staged.keys()].sort(), [...stage.keys()].sort(), "the two start paths must set the same variables");
  for (const [name, value] of stage) {
    assert.equal(staged.get(name), value, `$env:${name} disagrees: ops\\start-stage.ps1 says "${staged.get(name)}", ops\\stage.ps1 says "${value}"`);
  }
  assert.equal(
    staged.get("DATABASE_URL"),
    `postgres://postgres@127.0.0.1:5433/${dbName[1]}`,
    "the staged copy must come back on the restored database, not on whatever .env says",
  );
  assert.equal(staged.get("PORT"), "<port>", "the port must be the staged one, from ops\\.stage.json");
  assert.equal(staged.get("TOWNREPORTER_TUNNEL"), "0", "a staged copy must never take the paper's public hostname over");
});

test("the page's start window and the library's are the same 150 seconds", () => {
  /*
    The one number the Control page and ops\lib-stage.ps1 share. A drift makes
    the page's WORDS wrong and nothing else -- the library decides, and the page
    never starts anything -- which is exactly why it would go unnoticed. The
    page's own comment promises this test exists.
  */
  const window = STAGE_LIB.match(/\$StartWindowSeconds = (\d+)/);
  assert.ok(window, "could not find StartWindowSeconds in ops\\lib-stage.ps1");
  assert.equal(
    Number(window[1]) * 1000,
    STAGE_START_WINDOW_MS,
    `ops\\lib-stage.ps1's StartWindowSeconds is ${window[1]}s but the Control page's STAGE_START_WINDOW_MS is ${STAGE_START_WINDOW_MS}ms`,
  );
});

test("the watchdog brings the staged copy back, start-only, behind the paper's health", () => {
  /*
    The caller, and the reason the reboot case is fixed at all: the watchdog
    already runs every five minutes, so nothing new has to be scheduled for
    this. Four rules, each one a way it could have gone wrong instead --
    starting something while the paper is down, stopping what holds the port,
    retrying a start that cannot work every five minutes forever, and reading
    its own attempt record back as somebody else's.
  */
  const wd = readFileSync(join(OPS, "watchdog.ps1"), "utf8");
  // The section's doc comment sits ABOVE the gate; the code it describes sits
  // inside it. So the slice to judge is the gate to the next section.
  const gate = wd.indexOf("if ($appHealthy) {");
  const section = wd.indexOf("# --- The staged copy");
  const tunnel = wd.indexOf("# --- Tunnel");
  assert.ok(gate >= 0 && section >= 0 && tunnel > gate, "could not find the stage section or the paper's health gate");
  const gated = wd.slice(gate, tunnel);
  assert.match(gated, /Get-TownReporterStageInfo/, "the stage section must be inside the paper's health gate");
  assert.doesNotMatch(
    gated.slice(0, gated.indexOf("Get-TownReporterStageInfo")),
    /^\}$/m,
    "the stage section must sit inside the paper's health gate: nothing is started while the paper is down",
  );
  const code = stripComments(gated);
  assert.match(code, /Get-TownReporterStageInfo -App \$stageApp -AppPort \(\[int\]\$port\) -PgPort \(\[int\]\$pgPort\)/, "the watchdog must ask the shared decision, with its own ports");
  assert.doesNotMatch(
    code,
    /Stop-Process|taskkill/,
    "the watchdog is start-only here: what holds that port is the operator's copy, and stopping it is ops\\stage.ps1 -Stop's job",
  );
  assert.match(code, /Test-TownReporterStageStartDue -App \$stageApp -Minutes 30/, "the thirty-minute floor must be asked of the shared record");
  assert.match(code, /-Minutes 30/, "the floor is 30 minutes");

  const recordedAt = code.indexOf("Save-TownReporterStageStartRecord");
  const spawnedAt = code.indexOf("Start-Process -FilePath $stageShell");
  assert.ok(recordedAt >= 0 && spawnedAt > recordedAt, "the watchdog must record the attempt before it spawns the start");
  assert.match(
    code,
    /"-File", \(Join-Path \$stageApp "ops\\start-stage\.ps1"\), "-App", "`"\$stageApp`"", "-Quiet", "-Watchdog"/,
    "the spawn must run the staged checkout's own start script, name that checkout, and pass -Watchdog, or the child reads the watchdog's own record as an attempt in flight and declines itself",
  );
  // The resolution above is the whole of Unit AL2's watchdog half: when this
  // checkout has nothing staged, the copy it starts is the one the pointer
  // names. And the silent answer must leave $stageApp alone -- assigning the
  // resolver's App unconditionally puts "" there, and the next line throws on
  // the empty string every five minutes on a machine that never staged.
  assert.match(
    code,
    /Resolve-TownReporterStageApp -App \$stageApp -AppPort \(\[int\]\$port\) -PgPort \(\[int\]\$pgPort\)/,
    "the watchdog must put the pointer through the shared gate before it starts anything from it",
  );
  assert.match(
    code,
    /if \(\$resolve\.Ok\) \{ \$stageApp = \$resolve\.App \}/,
    "only a resolver that answered Ok may replace the checkout: the silent answer carries no path",
  );
  assert.doesNotMatch(
    code,
    /^\s*\$stageApp = \$resolve\.App\s*$/m,
    "an unconditional assignment blanks the checkout on the silent answer and the next line throws",
  );
  assert.match(
    code,
    /not answering, but \$\(\$due\.Reason\); leaving it for a later run/,
    "the thirty-minute floor still declines in the library's own words",
  );
  // Only 'down' starts anything, and 'nothing staged' says nothing at all: an
  // ordinary log line every five minutes on a machine that has never staged is
  // how an operator learns to stop reading the log.
  assert.match(code, /'down' \{/, "only the down verdict may start anything");
  assert.match(code, /if \(\$stage\.StateExists\) \{ Write-Log "stage: \$\(\$stage\.Reason\)" \}/, "nothing staged says nothing; a state file that names an unusable port is worth a line");
  assert.match(
    wd,
    /if \(\$env:WATCHDOG_TEST_MODE -eq '1' -and \$env:WATCHDOG_STAGE_APP\) \{ \$stageApp = \$env:WATCHDOG_STAGE_APP \}/,
    "the stage world must be redirectable for CI, and only in test mode",
  );
  assert.match(wd, /^\s*WATCHDOG_STAGE_APP\s+-/m, "and the seam must be documented with the others");
});

test(
  "the staged copy comes back after a reboot, and the floors hold, without touching 3000 or 3100",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      The reboot, executed. scripts\ci-stage-start.ps1 builds a disposable
      world in the temp directory -- a checkout holding copies of the real
      ops\ files, a stub build that answers 200, a stub Postgres listener, a
      stub app -- and runs the REAL ops\watchdog.ps1 against it through the
      TEST-003 seams plus WATCHDOG_STAGE_APP.

      It proves the five scenarios in its own header, and the assertions below
      are as load-bearing as the ones above: this file must never become a way
      to touch the machine's own copy on 3100, the paper on 3000 or Postgres.
    */
    const fixture = join(ROOT, "scripts", "ci-stage-start.ps1");
    assert.ok(existsSync(fixture), "scripts/ci-stage-start.ps1 is missing");
    const text = readFileSync(fixture, "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `scripts/ci-stage-start.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
    assert.match(text, /WATCHDOG_STAGE_APP/, "the harness must run the real watchdog against its disposable stage world");
    assert.match(text, /\$candidate -ne 3100/, "every port it picks must be one this machine's own copy is not on");
    assert.match(text, /GetTempPath\(\)/, "and its world must be built under the OS temp directory");
    assert.match(
      text,
      /foreach \(\$processId in \$script:spawned\) \{\s*\n\s*Stop-Process -Id \$processId/,
      "cleanup stops the pids THIS run started, one by one -- never by image name",
    );

    let out = "";
    let code = 0;
    try {
      out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-AppRoot", ROOT],
        { encoding: "utf8", timeout: 300_000 },
      );
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      code = err.status ?? -1;
    }
    assert.doesNotMatch(out, /FAIL/, `a stage-start check failed:\n${out}`);
    assert.match(out, /ci-stage-start\.ps1 : every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);

/*
  Unit AL2. The gap the staging work above left open, measured on this machine:
  ops\watchdog.ps1 runs from the LIVE checkout and looked for ops\.stage.json
  in that same checkout -- but a build is never made in the live checkout (the
  owner's rule), so the copy on 3100 is staged from a worker or a dev checkout.
  After a reboot the live watchdog found nothing and started nothing, and the
  operator's copy stayed down until somebody started it by hand.

  The fix is one small written-down fact: ops\stage.ps1 records which checkout
  it just staged, machine-wide, and every reader -- the watchdog,
  ops\start-stage.ps1 with no arguments, the Control page -- puts that record
  through the same gate in ops\lib-stage.ps1 before starting anything from it.
  The assertions below are the shape of that: one writer, one gate, three
  readers, and a refusal that is silent the first time only.
*/
test("which checkout was staged last is written down machine-wide, and one gate guards it", () => {
  const STAGE = read("stage.ps1");

  // One place, outside every checkout. A pointer inside the live checkout is
  // the bug it exists to fix; one inside the worker is invisible to the
  // watchdog that has to read it.
  assert.match(
    STAGE_LIB,
    /function Get-TownReporterStagedCopyPointerPath \{[\s\S]*?\$env:LOCALAPPDATA[\s\S]*?'TownReporter\\staged-copy\.json'/,
    "ops\\lib-stage.ps1 must own the pointer's path: %LOCALAPPDATA%\\TownReporter\\staged-copy.json",
  );
  assert.match(
    STAGE_LIB,
    /function Get-TownReporterStagedCopyPointerPath \{[\s\S]*?\$PointerFile/,
    "and honor an explicit -PointerFile, which is how a test points it at a temp folder",
  );

  // Atomic, like every other state file in this layer: a reader must never see
  // half a document, and the watchdog is a reader that runs unattended.
  const save = STAGE_LIB.slice(STAGE_LIB.indexOf("function Save-TownReporterStagedCopyPointer"));
  assert.match(save, /\$tmp = "\$path\.tmp"/, "the pointer must be written beside its target first");
  assert.match(save, /Move-Item -LiteralPath \$tmp -Destination \$path -Force/, "and moved over it, so no reader sees a partial file");
  for (const field of ["app", "port", "commit", "version", "database", "time"]) {
    assert.match(save, new RegExp(`^\\s{4}${field}\\s`, "m"), `the pointer must name the ${field} the brief asks a reader to have`);
  }

  // The writer is ops\stage.ps1, and it is the one place that knows a restore
  // and a build just succeeded. Written AFTER the state file on purpose: every
  // reader checks the two against each other, so a pointer that arrived first
  // would be refused by all of them.
  const pointerWrite = STAGE.indexOf("Save-TownReporterStagedCopyPointer -App $app");
  const stateWrite = STAGE.indexOf("$state | ConvertTo-Json | Set-Content -Path $stateFile");
  assert.ok(stateWrite >= 0, "ops\\stage.ps1 must still write the checkout's own ops\\.stage.json");
  assert.ok(pointerWrite > stateWrite, "the machine-wide pointer must be written after the state file it is checked against");
  assert.match(STAGE, /^ {2}commit {2}= \$commit$/m, "the state file must record the commit the pointer is compared against");
  assert.match(
    STAGE,
    /if \(Remove-TownReporterStagedCopyPointer -App \$app\)/,
    "-Stop must remove the pointer, and only for the checkout it just stopped: a pointer naming another checkout is a copy still running there",
  );

  // The gate. One function, one answer, and the reasons a reader may refuse.
  const resolve = STAGE_LIB.slice(
    STAGE_LIB.indexOf("function Resolve-TownReporterStageApp"),
    STAGE_LIB.indexOf("function Get-TownReporterStageInfo"),
  );
  const ownStateAt = resolve.indexOf("ops\\.stage.json')");
  const pointerAt = resolve.indexOf("Get-TownReporterStagedCopyPointer -PointerFile $PointerFile");
  assert.ok(ownStateAt >= 0 && pointerAt > ownStateAt, "this checkout's own staging wins: the pointer is only read when nothing is staged here");
  for (const [what, pattern] of [
    ["a checkout with no build at .output\\server\\index.mjs", /\$outputServer/],
    ["a folder that is not there any more", /is not there any more/],
    ["a folder outside the one this checkout lives in", /is not under \$root/],
    ["the live paper's own checkout", /the live paper's own/],
    ["a folder whose package.json names something else", /packageName -ne 'townreporter'/],
    ["a commit that no longer matches the checkout's own state file", /the checkout has been staged again since/],
    ["a port the staged copy must not use", /Test-TownReporterStagePortSafe/],
  ]) {
    assert.match(resolve, pattern, `the gate must refuse ${what} by name`);
  }
  assert.match(
    resolve,
    /App = ''; Ok = \$false; From = 'none'; Silent = \$true; Reason = ''/,
    "a machine with nothing staged here and no pointer anywhere must answer SILENTLY -- an ordinary log line every five minutes is how an operator stops reading the log",
  );

  // Said once. The watchdog runs every five minutes; the same broken pointer is
  // not news the sixth time, and a different one is.
  assert.match(
    STAGE_LIB,
    /function Test-TownReporterStageNoticeIsNew \{[\s\S]{0,900}\$last -ceq \$Reason/,
    "the same refusal must not be repeated on every run, and a different one must still be said",
  );

  // The two readers that start something. Both go through the gate: neither
  // reads the pointer file's fields for itself, or they would drift apart.
  const start = STAGE_START;
  assert.match(
    start,
    /Resolve-TownReporterStageApp -App \$app -AppPort \$appPort -PgPort 5433/,
    "ops\\start-stage.ps1 with no -App must put the pointer through the shared gate",
  );
  assert.match(start, /Decline "the machine-wide staged-copy pointer cannot be trusted: \$\(\$resolve\.Reason\)"/, "and decline with the gate's own plain reason");
  assert.match(start, /if \(\$resolve\.Ok\) \{/, "only an Ok answer may set the target");
  assert.match(
    STAGE_LIB,
    /function Resolve-TownReporterStageApp \{[\s\S]{0,120}\[string\]\$PointerFile = ''/,
    "the gate takes -PointerFile so a test can hand it a temp folder instead of this machine's own",
  );
});

test(
  "the machine-wide pointer is exercised end to end, in another checkout, off this machine",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    /*
      Unit AL2's own fixture, and the reason it can run at all: the pointer's
      path is read from %LOCALAPPDATA% at the moment it is used, by both the
      PowerShell and the JavaScript side, so a fake LOCALAPPDATA in a
      disposable world is the seam -- no new WATCHDOG_* variable had to be
      invented for it, and this machine's real pointer is never read or
      written. The world is two checkouts side by side: 'live', which the
      watchdog runs from and which has nothing staged, and 'worker', which the
      pointer names and which holds the build.

      The checks below are the ones that matter for a fixture nothing else
      guards: it must not be able to touch this machine's own copy, and it must
      really run the real watchdog.
    */
    const fixture = join(ROOT, "scripts", "ci-stage-pointer.ps1");
    assert.ok(existsSync(fixture), "scripts/ci-stage-pointer.ps1 is missing");
    const text = readFileSync(fixture, "utf8");
    const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
    assert.equal(
      bad.length,
      0,
      `scripts/ci-stage-pointer.ps1 has ${bad.length} non-ASCII character(s) (e.g. ${JSON.stringify(bad.slice(0, 3).join(""))}) -- PS 5.1 will mangle them`,
    );
    assert.match(text, /GetTempPath\(\)/, "its world must be built under the OS temp directory");
    assert.match(text, /\$candidate -ne 3100/, "every port it picks must be one this machine's own copy is not on");
    assert.match(
      text,
      /\$env:LOCALAPPDATA = \$fakeLocal/,
      "the pointer must be redirected into the disposable world, so the operator's real pointer is neither read nor written",
    );
    assert.match(
      text,
      /foreach \(\$processId in \$script:spawned\) \{\s*\n\s*Stop-Process -Id \$processId/,
      "cleanup stops the pids THIS run started, one by one -- never by image name",
    );
    assert.match(text, /\$env:LOCALAPPDATA = \$previousLocalAppData|Remove-Item Env:\\LOCALAPPDATA/, "and puts the real LOCALAPPDATA back");

    let out = "";
    let code = 0;
    try {
      out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-AppRoot", ROOT],
        { encoding: "utf8", timeout: 300_000 },
      );
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      code = err.status ?? -1;
    }
    assert.doesNotMatch(out, /FAIL/, `a pointer check failed:\n${out}`);
    assert.match(out, /ci-stage-pointer\.ps1 : every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);
