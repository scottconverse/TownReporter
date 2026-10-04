import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync, linkSync, unlinkSync, copyFileSync } from "node:fs";
import { join, dirname, win32 as win32Path } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertStagingDatabase } from "./stage-editor.mjs";
import { ACTIONS } from "../ops/control/control-server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPS = join(ROOT, "ops");

function canonicalWindowsPath(path) {
  const tail = [];
  let probe = win32Path.resolve(path);
  while (!existsSync(probe)) {
    const parent = win32Path.dirname(probe);
    if (parent === probe) throw new Error(`could not resolve an existing parent for ${path}`);
    tail.unshift(win32Path.basename(probe));
    probe = parent;
  }
  return win32Path.normalize(win32Path.join(realpathSync.native(probe), ...tail));
}

function configFieldsResolveAtTarget(config, target, oldRoots) {
  try {
    const installRoot = canonicalWindowsPath(config.installRoot);
    const targetRoot = canonicalWindowsPath(target);
    const executable = canonicalWindowsPath(config.executable);
    const logPath = canonicalWindowsPath(config.logPath);
    const note = typeof config.notes?.[0] === "string" && config.notes[0].startsWith("built at ")
      ? canonicalWindowsPath(config.notes[0].slice("built at ".length))
      : null;
    const oldSpellings = oldRoots.flatMap((root) => [root, canonicalWindowsPath(root)]).map((root) => root.toLowerCase());
    const serializedFields = [config.installRoot, config.executable, config.logPath, ...(Array.isArray(config.notes) ? config.notes : [])];
    const noOldRootText = serializedFields.every((value) => typeof value === "string"
      && oldSpellings.every((oldRoot) => !value.toLowerCase().includes(oldRoot)));
    const relativeExecutable = win32Path.relative(installRoot, executable).toLowerCase();
    const relativeLog = win32Path.relative(installRoot, logPath).toLowerCase();

    return win32Path.normalize(installRoot).toLowerCase() === win32Path.normalize(targetRoot).toLowerCase()
      && existsSync(config.executable)
      && relativeExecutable === "redlib.exe"
      && relativeLog === "redlib.log"
      && note !== null
      && win32Path.normalize(note).toLowerCase() === win32Path.normalize(installRoot).toLowerCase()
      && JSON.stringify(config.notes) === JSON.stringify([config.notes[0], "unrelated"])
      && noOldRootText;
  } catch {
    return false;
  }
}

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
  // What a promotion is made of. lib-promote.ps1 is where the run's own log,
  // the detached launch of the long steps, the resume point and the fallback
  // to the previous build live; promote.ps1 dot-sources it before it does
  // anything at all, so losing it fails at the first line of the one script
  // that puts a release on the live paper.
  "lib-promote.ps1",
  // The database half of a promotion: the copy taken before a rollout and the
  // swap that puts it back (unit PR2). Not dot-sourced -- promote.ps1 runs it
  // as a child -- but losing it fails the same way and at the same moment: the
  // promotion builds the command from a path under this install's ops\, so a
  // missing file is a failed step with the paper already stopped.
  "lib-promote-db.mjs",
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
      const envLine = copy.out.split(/\r?\n/).map((line) => line.trim()).find((line) => /^REDLIB_INSTALL_ROOT=/i.test(line));
      assert.ok(envLine, `the standalone .env assignment must be printed:\n${copy.out}`);
      const printedRoot = envLine.slice(envLine.indexOf("=") + 1).trim();
      const canonicalPrintedRoot = realpathSync.native(printedRoot);
      const canonicalTarget = realpathSync.native(dst);
      assert.equal(
        win32Path.normalize(canonicalPrintedRoot).toLowerCase(),
        win32Path.normalize(canonicalTarget).toLowerCase(),
        `the printed .env assignment must name the copied target (expected ${JSON.stringify(dst)} => ${JSON.stringify(canonicalTarget)}, got ${JSON.stringify(printedRoot)} => ${JSON.stringify(canonicalPrintedRoot)}):\n${copy.out}`,
      );
      assert.match(copy.out, /inside AppData/, "a target under AppData must be called out");
      assert.match(copy.out, /was not changed or deleted/, "the run must say the original is still there");
      const moved = JSON.parse(readFileSync(join(dst, "install.json"), "utf8"));
      assert.ok(
        configFieldsResolveAtTarget(moved, dst, [src]),
        `install.json paths and array notes must resolve inside the copied install, with no old-root references: ${JSON.stringify(moved, null, 2)}`,
      );
      assert.equal(moved.commit, "b6a2a5e", "a value that is not a path must be left alone");
      assert.ok(existsSync(join(dst, "config.toml")), "the whole install must be copied");
      assert.ok(!existsSync(join(dst, "redlib.pid")), "the pid file belongs to a process, not to an install");
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

test(
  "redlib-relocate refuses multiply linked target executables with same or alternate basenames",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    const script = join(OPS, "redlib-relocate.ps1");
    const base = mkdtempSync(join(tmpdir(), "redlib-relocate-hardlink-reader-"));
    const source = join(base, "source");
    const target = join(base, "target");
    const externalAlias = join(base, "external-alias");
    const noEnv = join(base, "absent.env");
    const powershellExe = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName"],
      { encoding: "utf8" },
    ).trim();
    const run = (args) => {
      try {
        return {
          code: 0,
          out: execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
            { encoding: "utf8", timeout: 120_000, env: { ...process.env, REDLIB_INSTALL_ROOT: "" } },
          ),
        };
      } catch (err) {
        return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    };
    const plant = (root) => {
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, "install.json"),
        `${JSON.stringify({
          installRoot: root,
          executable: join(root, "redlib.exe"),
          baseUrl: "http://127.0.0.1:65533",
          logPath: join(root, "redlib.log"),
        }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(join(root, "redlib.exe"), "stub, never run\n", "utf8");
      writeFileSync(join(root, "config.toml"), "port = 65533\n", "utf8");
    };
    const startLongLivedProcess = (executable) => Number(execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$child = Start-Process -FilePath $env:REDLIB_TEST_PROCESS_EXE -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90' -PassThru -WindowStyle Hidden; $child.Id",
      ],
      { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_EXE: executable } },
    ).trim());
    const processImagePath = (pid) => execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Id ([int]$env:REDLIB_TEST_PROCESS_PID)).MainModule.FileName"],
      { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_PID: String(pid) } },
    ).trim();
    const stopProcess = (pid) => {
      try {
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "Stop-Process -Id ([int]$env:REDLIB_TEST_PROCESS_PID) -Force -ErrorAction SilentlyContinue"],
          { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_PID: String(pid) } },
        );
      } catch {
        // Only fixture processes are stopped here, during cleanup.
      }
    };
    try {
      plant(source);
      plant(target);
      copyFileSync(powershellExe, join(target, "redlib.exe"));
      mkdirSync(externalAlias);
      const aliasPaths = [join(externalAlias, "redlib.exe"), join(externalAlias, "alternate.exe")];
      for (const aliasPath of aliasPaths) linkSync(join(target, "redlib.exe"), aliasPath);
      const targetInstallBefore = readFileSync(join(target, "install.json"));
      const targetExecutableBefore = readFileSync(join(target, "redlib.exe"));
      const evidence = [];
      for (const aliasPath of aliasPaths) {
        const processPid = startLongLivedProcess(aliasPath);
        try {
          writeFileSync(join(target, "redlib.pid"), "2147483647", "utf8");
          const processImage = processImagePath(processPid);
          const result = run(["-From", source, "-To", target, "-Force", "-EnvFile", noEnv]);
          const processStillRunning = execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", "if (Get-Process -Id ([int]$env:REDLIB_TEST_PROCESS_PID) -ErrorAction SilentlyContinue) { 'running' } else { 'stopped' }"],
            { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_PID: String(processPid) } },
          ).trim() === "running";
          evidence.push({
            aliasBasename: win32Path.basename(aliasPath),
            processImageIsExternalHardlink: processImage.toLowerCase() === aliasPath.toLowerCase(),
            processBasenameDiffersFromTarget: win32Path.basename(processImage).toLowerCase() !== "redlib.exe",
            processStillRunning,
            exit: result.code,
            hardlinkRefusalReported: /image state: linked/i.test(result.out),
            targetMetadataPreserved: existsSync(join(target, "install.json"))
              && readFileSync(join(target, "install.json")).equals(targetInstallBefore),
            targetExecutablePreserved: existsSync(join(target, "redlib.exe"))
              && readFileSync(join(target, "redlib.exe")).equals(targetExecutableBefore),
            stalePidPreserved: existsSync(join(target, "redlib.pid"))
              && readFileSync(join(target, "redlib.pid"), "utf8") === "2147483647",
          });
        } finally {
          stopProcess(processPid);
        }
      }
      assert.deepEqual(evidence, aliasPaths.map((aliasPath) => ({
        aliasBasename: win32Path.basename(aliasPath),
        processImageIsExternalHardlink: true,
        processBasenameDiffersFromTarget: win32Path.basename(aliasPath).toLowerCase() !== "redlib.exe",
        processStillRunning: true,
        exit: 1,
        hardlinkRefusalReported: true,
        targetMetadataPreserved: true,
        targetExecutablePreserved: true,
        stalePidPreserved: true,
      })), JSON.stringify(evidence, null, 2));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  "redlib-relocate.ps1 resolves path aliases, rejects unsafe targets, and fails closed on stale metadata",
  { skip: !onWindows ? "PowerShell only" : false },
  () => {
    const script = join(OPS, "redlib-relocate.ps1");
    const base = mkdtempSync(join(tmpdir(), "redlib-relocate-edge-"));
    const noEnv = join(base, "absent.env");
    const run = (args, extraEnv = {}) => {
      try {
        return {
          code: 0,
          out: execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
            {
              encoding: "utf8",
              timeout: 120_000,
              env: { ...process.env, REDLIB_INSTALL_ROOT: "", ...extraEnv },
            },
          ),
        };
      } catch (err) {
        return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    };
    const runWithNullPathIdentity = (args) => {
      const wrapper = join(base, "null-path-identity.ps1");
      writeFileSync(
        wrapper,
        [
          "Add-Type -TypeDefinition @'",
          "using System;",
          "public static class TownReporterPathIdentity { public static string Resolve(string path) { return null; } }",
          "'@",
          "& $env:REDLIB_RELOCATE_SCRIPT -From $env:REDLIB_RELOCATE_FROM -To $env:REDLIB_RELOCATE_TO -Force -EnvFile $env:REDLIB_RELOCATE_ENV",
          "",
        ].join("\r\n"),
        "utf8",
      );
      try {
        return {
          code: 0,
          out: execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper],
            {
              encoding: "utf8",
              timeout: 120_000,
              env: {
                ...process.env,
                REDLIB_INSTALL_ROOT: "",
                REDLIB_RELOCATE_SCRIPT: script,
                REDLIB_RELOCATE_FROM: args[0],
                REDLIB_RELOCATE_TO: args[1],
                REDLIB_RELOCATE_ENV: noEnv,
              },
            },
          ),
        };
      } catch (err) {
        return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    };
    const plant = (root, overrides = {}) => {
      mkdirSync(root, { recursive: true });
      const config = {
        installRoot: root,
        executable: join(root, "redlib.exe"),
        baseUrl: "http://127.0.0.1:65533",
        logPath: join(root, "redlib.log"),
        notes: [`built at ${root}`, "unrelated"],
        commit: "b6a2a5e",
        ...overrides,
      };
      writeFileSync(join(root, "install.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
      writeFileSync(join(root, "redlib.exe"), "stub, never run\n", "utf8");
      writeFileSync(join(root, "config.toml"), "port = 65533\n", "utf8");
    };
    const envLine = (out) => out.split(/\r?\n/).map((line) => line.trim()).find((line) => /^REDLIB_INSTALL_ROOT=/i.test(line));
    const sourceBytes = (root) => readFileSync(join(root, "install.json"));
    try {
      const shortBase = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$source = $env:REDLIB_ALIAS_SOURCE; $buffer = New-Object System.Text.StringBuilder 1024; Add-Type -TypeDefinition 'using System.Runtime.InteropServices; using System.Text; public static class AliasPathProbe { [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint bufferLength); }'; [void][AliasPathProbe]::GetShortPathName($source, $buffer, [uint32]$buffer.Capacity); $buffer.ToString()",
        ],
        { encoding: "utf8", env: { ...process.env, REDLIB_ALIAS_SOURCE: base } },
      ).trim();
      assert.ok(shortBase && shortBase.toLowerCase() !== base.toLowerCase(), `the Windows fixture needs a real 8.3 alias for ${base}`);

      const aliasSource = join(shortBase, "alias-from");
      const aliasTarget = join(base, "alias-to");
      plant(aliasSource);
      const aliasRun = run(["-From", aliasSource, "-To", aliasTarget, "-Force", "-EnvFile", noEnv]);
      const aliasConfig = existsSync(join(aliasTarget, "install.json"))
        ? JSON.parse(readFileSync(join(aliasTarget, "install.json"), "utf8"))
        : {};
      const aliasFieldsCorrect = configFieldsResolveAtTarget(aliasConfig, aliasTarget, [aliasSource]);

      const autoAliasSource = join(shortBase, "auto-from");
      const autoLongSource = join(base, "auto-from");
      const autoTarget = join(base, "auto-to");
      const autoEnv = join(base, "auto.env");
      plant(autoAliasSource);
      writeFileSync(autoEnv, `REDLIB_INSTALL_ROOT=${autoLongSource}\n`, "utf8");
      const autoRun = run(["-To", autoTarget, "-Force", "-EnvFile", autoEnv]);
      const autoConfig = existsSync(join(autoTarget, "install.json"))
        ? JSON.parse(readFileSync(join(autoTarget, "install.json"), "utf8"))
        : {};
      const autoFieldsCorrect = configFieldsResolveAtTarget(autoConfig, autoTarget, [autoAliasSource, autoLongSource]);

      const fixtureLocalAppData = join(base, "fixture-localappdata");
      const sandboxSource = join(fixtureLocalAppData, "Packages", "FakePackage", "LocalCache", "Local", "RedditSearch", "Redlib");
      const logicalRoot = join(fixtureLocalAppData, "RedditSearch", "Redlib");
      const sandboxTarget = join(base, "sandbox-to");
      plant(sandboxSource, {
        installRoot: logicalRoot,
        executable: join(logicalRoot, "redlib.exe"),
        logPath: join(logicalRoot, "redlib.log"),
        notes: [`built at ${logicalRoot}`, "unrelated"],
      });
      const sandboxBytes = sourceBytes(sandboxSource);
      const sandboxRun = run(["-To", sandboxTarget, "-Force", "-EnvFile", noEnv], { LOCALAPPDATA: fixtureLocalAppData });
      const sandboxConfig = existsSync(join(sandboxTarget, "install.json"))
        ? JSON.parse(readFileSync(join(sandboxTarget, "install.json"), "utf8"))
        : {};
      const printedSandboxRoot = envLine(sandboxRun.out)?.slice(envLine(sandboxRun.out).indexOf("=") + 1).trim();
      const sandboxPrintedTargetCorrect = Boolean(printedSandboxRoot)
        && win32Path.normalize(realpathSync.native(printedSandboxRoot)).toLowerCase()
          === win32Path.normalize(realpathSync.native(sandboxTarget)).toLowerCase();
      const sandboxLogicalMappingCorrect = sandboxRun.code === 0
        && sandboxPrintedTargetCorrect
        && configFieldsResolveAtTarget(sandboxConfig, sandboxTarget, [sandboxSource, logicalRoot])
        && sourceBytes(sandboxSource).equals(sandboxBytes);

      const ordinarySource = join(base, "ordinary-source");
      const ordinaryTarget = join(base, "ordinary-target");
      plant(ordinarySource, {
        installRoot: logicalRoot,
        executable: join(logicalRoot, "redlib.exe"),
        logPath: join(logicalRoot, "redlib.log"),
      });
      const ordinaryBytes = sourceBytes(ordinarySource);
      const ordinaryRun = run(
        ["-From", ordinarySource, "-To", ordinaryTarget, "-Force", "-EnvFile", noEnv],
        { LOCALAPPDATA: fixtureLocalAppData },
      );
      const similarPathRejected = ordinaryRun.code === 1
        && !envLine(ordinaryRun.out)
        && !existsSync(ordinaryTarget)
        && sourceBytes(ordinarySource).equals(ordinaryBytes);

      const siblingPrefixSource = join(base, "sibling-prefix-source");
      const siblingPrefixTarget = `${fixtureLocalAppData}-sibling`;
      plant(siblingPrefixSource);
      const siblingPrefixRun = run(
        ["-From", siblingPrefixSource, "-To", siblingPrefixTarget, "-EnvFile", noEnv],
        { LOCALAPPDATA: fixtureLocalAppData },
      );
      const siblingPrefixStaysOutside = siblingPrefixRun.code === 0
        && Boolean(envLine(siblingPrefixRun.out))
        && !/inside AppData/.test(siblingPrefixRun.out)
        && existsSync(join(siblingPrefixTarget, "install.json"));

      const appDataJunctionSource = join(base, "appdata-junction-source");
      const appDataJunctionDestination = join(fixtureLocalAppData, "junction-destination");
      const externalLookingJunction = join(base, "external-looking-junction");
      plant(appDataJunctionSource);
      mkdirSync(appDataJunctionDestination);
      symlinkSync(appDataJunctionDestination, externalLookingJunction, "junction");
      const appDataJunctionSourceBytes = sourceBytes(appDataJunctionSource);
      const appDataJunctionRun = run(
        ["-From", appDataJunctionSource, "-To", externalLookingJunction, "-EnvFile", noEnv],
        { LOCALAPPDATA: fixtureLocalAppData },
      );
      const appDataJunctionRejected = appDataJunctionRun.code === 1
        && /inside AppData/.test(appDataJunctionRun.out)
        && !envLine(appDataJunctionRun.out)
        && !existsSync(join(appDataJunctionDestination, "install.json"))
        && sourceBytes(appDataJunctionSource).equals(appDataJunctionSourceBytes);

      const sameSource = join(base, "same-source");
      plant(sameSource);
      const sameBytes = sourceBytes(sameSource);
      const sameRun = run(["-From", sameSource, "-To", join(shortBase, "same-source"), "-Force", "-EnvFile", noEnv]);
      const samePlaceSafe = sameRun.code === 0
        && Boolean(envLine(sameRun.out))
        && sourceBytes(sameSource).equals(sameBytes)
        && readdirSync(sameSource).sort().join(",") === "config.toml,install.json,redlib.exe";

      const liveTargetSource = join(base, "live-target-source");
      const liveTarget = join(base, "live-target");
      const powershellExe = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName"],
        { encoding: "utf8" },
      ).trim();
      const startLongLivedProcess = (executable) => Number(execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$child = Start-Process -FilePath $env:REDLIB_TEST_PROCESS_EXE -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90' -PassThru -WindowStyle Hidden; $child.Id",
        ],
        { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_EXE: executable } },
      ).trim());
      const isProcessRunning = (pid) => execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "if (Get-Process -Id ([int]$env:REDLIB_TEST_PROCESS_PID) -ErrorAction SilentlyContinue) { 'running' } else { 'stopped' }"],
        { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_PID: String(pid) } },
      ).trim() === "running";
      const stopProcess = (pid) => {
        try {
          execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", "Stop-Process -Id ([int]$env:REDLIB_TEST_PROCESS_PID) -Force -ErrorAction SilentlyContinue"],
            { encoding: "utf8", env: { ...process.env, REDLIB_TEST_PROCESS_PID: String(pid) } },
          );
        } catch {
          // The relocation regression is allowed to stop a fixture process only in cleanup.
        }
      };
      const startSourceFileLock = (filePath) => {
        const readyPath = join(base, `lock-ready-${Math.random().toString(16).slice(2)}`);
        const childScript = "$stream = [IO.File]::Open($env:REDLIB_TEST_LOCK_PATH, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); [IO.File]::WriteAllText($env:REDLIB_TEST_LOCK_READY, 'ready'); Start-Sleep -Seconds 90; $stream.Dispose()";
        const encodedCommand = Buffer.from(childScript, "utf16le").toString("base64");
        const pid = Number(execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$child = Start-Process -FilePath $env:REDLIB_TEST_POWERSHELL_EXE -ArgumentList ('-NoProfile -NonInteractive -EncodedCommand ' + $env:REDLIB_TEST_LOCK_COMMAND) -PassThru -WindowStyle Hidden; $child.Id",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              REDLIB_TEST_POWERSHELL_EXE: powershellExe,
              REDLIB_TEST_LOCK_COMMAND: encodedCommand,
              REDLIB_TEST_LOCK_PATH: filePath,
              REDLIB_TEST_LOCK_READY: readyPath,
            },
          },
        ).trim());
        const waitCell = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 5000;
        while (!existsSync(readyPath) && Date.now() < deadline) Atomics.wait(waitCell, 0, 0, 25);
        if (!existsSync(readyPath)) {
          stopProcess(pid);
          throw new Error(`source-file lock did not become ready for ${filePath}`);
        }
        return pid;
      };
      plant(liveTargetSource);
      plant(liveTarget);
      copyFileSync(powershellExe, join(liveTarget, "redlib.exe"));
      const liveTargetInstallBefore = readFileSync(join(liveTarget, "install.json"));
      const liveTargetExecutableBefore = readFileSync(join(liveTarget, "redlib.exe"));
      const liveTargetExe = join(liveTarget, "redlib.exe");
      const liveTargetPid = startLongLivedProcess(liveTargetExe);
      writeFileSync(join(liveTarget, "redlib.pid"), String(liveTargetPid), "utf8");
      let liveTargetRun;
      let liveTargetProcessSurvived = false;
      try {
        liveTargetRun = run(["-From", liveTargetSource, "-To", liveTarget, "-Force", "-EnvFile", noEnv]);
        liveTargetProcessSurvived = isProcessRunning(liveTargetPid);
      } finally {
        stopProcess(liveTargetPid);
      }
      const liveTargetEvidence = {
        exit: liveTargetRun.code,
        refusedBeforeReplace: /destination.*running reader/i.test(liveTargetRun.out),
        processStillRunning: liveTargetProcessSurvived,
        installMetadataPreserved: existsSync(join(liveTarget, "install.json"))
          && readFileSync(join(liveTarget, "install.json")).equals(liveTargetInstallBefore),
        executablePreserved: readFileSync(join(liveTarget, "redlib.exe")).equals(liveTargetExecutableBefore),
        pidFilePreserved: existsSync(join(liveTarget, "redlib.pid"))
          && readFileSync(join(liveTarget, "redlib.pid"), "utf8") === String(liveTargetPid),
      };
      const stalePidTargetSource = join(base, "stale-pid-target-source");
      const stalePidTarget = join(base, "stale-pid-target");
      plant(stalePidTargetSource);
      plant(stalePidTarget);
      copyFileSync(powershellExe, join(stalePidTarget, "redlib.exe"));
      const stalePidTargetInstallBefore = readFileSync(join(stalePidTarget, "install.json"));
      const stalePidTargetExecutableBefore = readFileSync(join(stalePidTarget, "redlib.exe"));
      const stalePidTargetExe = join(stalePidTarget, "redlib.exe");
      const stalePidTargetProcess = startLongLivedProcess(stalePidTargetExe);
      writeFileSync(join(stalePidTarget, "redlib.pid"), "2147483647", "utf8");
      let stalePidTargetRun;
      let stalePidProcessSurvived = false;
      try {
        stalePidTargetRun = run(["-From", stalePidTargetSource, "-To", stalePidTarget, "-Force", "-EnvFile", noEnv]);
        stalePidProcessSurvived = isProcessRunning(stalePidTargetProcess);
      } finally {
        stopProcess(stalePidTargetProcess);
      }
      const stalePidTargetEvidence = {
        exit: stalePidTargetRun.code,
        refusedBeforeReplace: /destination.*running reader/i.test(stalePidTargetRun.out),
        processStillRunning: stalePidProcessSurvived,
        installMetadataPreserved: existsSync(join(stalePidTarget, "install.json"))
          && readFileSync(join(stalePidTarget, "install.json")).equals(stalePidTargetInstallBefore),
        executablePreserved: existsSync(stalePidTargetExe)
          && readFileSync(stalePidTargetExe).equals(stalePidTargetExecutableBefore),
        stalePidPreserved: readFileSync(join(stalePidTarget, "redlib.pid"), "utf8") === "2147483647",
      };
      const rollbackSource = join(base, "rollback-source");
      const rollbackTarget = join(base, "rollback-target");
      plant(rollbackSource);
      plant(rollbackTarget);
      writeFileSync(join(rollbackTarget, "redlib.pid"), "2147483647", "utf8");
      const rollbackTargetInstallBefore = readFileSync(join(rollbackTarget, "install.json"));
      const rollbackTargetExecutableBefore = readFileSync(join(rollbackTarget, "redlib.exe"));
      const rollbackTargetConfigBefore = readFileSync(join(rollbackTarget, "config.toml"));
      const sourceLockPid = startSourceFileLock(join(rollbackSource, "config.toml"));
      let rollbackRun;
      try {
        rollbackRun = run(["-From", rollbackSource, "-To", rollbackTarget, "-Force", "-EnvFile", noEnv]);
      } finally {
        stopProcess(sourceLockPid);
      }
      const rollbackTargetRestored = rollbackRun.code === 1
        && /previous destination files were restored/i.test(rollbackRun.out)
        && readFileSync(join(rollbackTarget, "install.json")).equals(rollbackTargetInstallBefore)
        && readFileSync(join(rollbackTarget, "redlib.exe")).equals(rollbackTargetExecutableBefore)
        && readFileSync(join(rollbackTarget, "config.toml")).equals(rollbackTargetConfigBefore)
        && readFileSync(join(rollbackTarget, "redlib.pid"), "utf8") === "2147483647";

      const lockedTargetSource = join(base, "locked-target-source");
      const lockedTarget = join(base, "locked-target");
      plant(lockedTargetSource);
      plant(lockedTarget);
      const lockedTargetInstallBefore = readFileSync(join(lockedTarget, "install.json"));
      const lockedTargetExecutableBefore = readFileSync(join(lockedTarget, "redlib.exe"));
      const lockedTargetConfigBefore = readFileSync(join(lockedTarget, "config.toml"));
      const targetLockPid = startSourceFileLock(join(lockedTarget, "config.toml"));
      let lockedTargetRun;
      try {
        lockedTargetRun = run(["-From", lockedTargetSource, "-To", lockedTarget, "-Force", "-EnvFile", noEnv]);
      } finally {
        stopProcess(targetLockPid);
      }
      const lockedTargetRefused = lockedTargetRun.code === 1
        && /cannot be safely replaced right now/i.test(lockedTargetRun.out)
        && readFileSync(join(lockedTarget, "install.json")).equals(lockedTargetInstallBefore)
        && readFileSync(join(lockedTarget, "redlib.exe")).equals(lockedTargetExecutableBefore)
        && readFileSync(join(lockedTarget, "config.toml")).equals(lockedTargetConfigBefore);

      const unresolvedSource = join(base, "unresolved-identity-source");
      const unresolvedTarget = join(base, "unresolved-identity-target");
      plant(unresolvedSource);
      const unresolvedSourceBytes = sourceBytes(unresolvedSource);
      const unresolvedRun = runWithNullPathIdentity([unresolvedSource, unresolvedTarget]);
      const unresolvedIdentityRejected = unresolvedRun.code === 1
        && /Could not resolve filesystem identity for existing path/.test(unresolvedRun.out)
        && !envLine(unresolvedRun.out)
        && !existsSync(unresolvedTarget)
        && sourceBytes(unresolvedSource).equals(unresolvedSourceBytes);

      const junctionSource = join(base, "junction-source");
      const junctionAlias = join(base, "junction-alias");
      plant(junctionSource);
      symlinkSync(junctionSource, junctionAlias, "junction");
      const junctionBytes = sourceBytes(junctionSource);
      const junctionEntriesBefore = readdirSync(junctionSource).sort();
      const junctionRun = run(["-From", junctionSource, "-To", junctionAlias, "-Force", "-EnvFile", noEnv]);
      const junctionLine = envLine(junctionRun.out);
      const junctionPrintedRoot = junctionLine?.slice(junctionLine.indexOf("=") + 1).trim();
      const sameJunctionEvidence = {
        exit: junctionRun.code,
        printedEnv: Boolean(junctionPrintedRoot),
        sourceBytesPreserved: sourceBytes(junctionSource).equals(junctionBytes),
        sourceEntriesPreserved: readdirSync(junctionSource).sort().join(",") === junctionEntriesBefore.join(","),
        printedRootResolvesToSource: Boolean(junctionPrintedRoot)
          && win32Path.normalize(realpathSync.native(junctionPrintedRoot)).toLowerCase()
            === win32Path.normalize(realpathSync.native(junctionSource)).toLowerCase(),
      };

      const junctionChildSource = join(base, "junction-child-source");
      const junctionChild = join(junctionChildSource, "existing-child");
      const junctionChildAlias = join(base, "junction-child-alias");
      plant(junctionChildSource);
      mkdirSync(junctionChild);
      symlinkSync(junctionChild, junctionChildAlias, "junction");
      const junctionChildBytes = sourceBytes(junctionChildSource);
      const junctionChildEntriesBefore = readdirSync(junctionChildSource).sort();
      const redirectedChildEntriesBefore = readdirSync(junctionChild).sort();
      const junctionChildRun = run(["-From", junctionChildSource, "-To", junctionChildAlias, "-Force", "-EnvFile", noEnv]);
      const targetJunctionChildEvidence = {
        exit: junctionChildRun.code,
        printedEnv: Boolean(envLine(junctionChildRun.out)),
        sourceBytesPreserved: sourceBytes(junctionChildSource).equals(junctionChildBytes),
        sourceEntriesPreserved: readdirSync(junctionChildSource).sort().join(",") === junctionChildEntriesBefore.join(","),
        redirectedChildEntries: readdirSync(junctionChild).sort(),
      };

      const nestedSource = join(base, "nested-source");
      const nestedTarget = join(nestedSource, "nested-target");
      plant(nestedSource);
      const nestedBytes = sourceBytes(nestedSource);
      const nestedRun = run(["-From", nestedSource, "-To", nestedTarget, "-Force", "-EnvFile", noEnv]);
      const nestedSafe = nestedRun.code === 1
        && !existsSync(nestedTarget)
        && !envLine(nestedRun.out)
        && sourceBytes(nestedSource).equals(nestedBytes)
        && readdirSync(nestedSource).sort().join(",") === "config.toml,install.json,redlib.exe";

      const ancestorTarget = join(base, "ancestor-target");
      const ancestorSource = join(ancestorTarget, "source");
      plant(ancestorTarget);
      plant(ancestorSource);
      writeFileSync(join(ancestorTarget, "config.toml"), "preserve parent config\n", "utf8");
      writeFileSync(join(ancestorTarget, "unrelated.keep"), "preserve unrelated file\n", "utf8");
      const ancestorParentEntriesBefore = readdirSync(ancestorTarget).sort();
      const ancestorParentConfigBefore = readFileSync(join(ancestorTarget, "config.toml"));
      const ancestorParentInstallBefore = sourceBytes(ancestorTarget);
      const ancestorParentExeBefore = readFileSync(join(ancestorTarget, "redlib.exe"));
      const ancestorSourceBytes = sourceBytes(ancestorSource);
      const ancestorRun = run(["-From", ancestorSource, "-To", ancestorTarget, "-Force", "-EnvFile", noEnv]);
      const ancestorTargetEvidence = {
        exit: ancestorRun.code,
        printedEnv: Boolean(envLine(ancestorRun.out)),
        parentEntriesPreserved: readdirSync(ancestorTarget).sort().join(",") === ancestorParentEntriesBefore.join(","),
        parentConfigPreserved: readFileSync(join(ancestorTarget, "config.toml")).equals(ancestorParentConfigBefore),
        parentInstallPreserved: sourceBytes(ancestorTarget).equals(ancestorParentInstallBefore),
        parentExecutablePreserved: readFileSync(join(ancestorTarget, "redlib.exe")).equals(ancestorParentExeBefore),
        sourceInstallPreserved: sourceBytes(ancestorSource).equals(ancestorSourceBytes),
      };

      const invalidMetadata = {};
      for (const field of ["installRoot", "executable", "logPath"]) {
        const root = join(base, `bad-${field}-source`);
        const destination = join(base, `bad-${field}-target`);
        const invalidPath = field === "installRoot"
          ? join(base, `unrelated-${field}`)
          : `${root}\\..\\unrelated-${field}\\redlib.${field === "executable" ? "exe" : "log"}`;
        plant(root, { [field]: invalidPath });
        const before = sourceBytes(root);
        const result = run(["-From", root, "-To", destination, "-Force", "-EnvFile", noEnv]);
        invalidMetadata[field] = result.code === 1
          && !envLine(result.out)
          && !existsSync(destination)
          && sourceBytes(root).equals(before);
      }

      const hardlinkSource = join(base, "hardlink-source");
      const hardlinkTarget = join(base, "hardlink-target");
      const hardlinkExternal = join(base, "hardlink-external.txt");
      const hardlinkNestedExternal = join(base, "hardlink-nested-external.txt");
      plant(hardlinkSource);
      writeFileSync(join(hardlinkSource, "redlib.exe"), "SOURCE-EXE-CONTENT", "utf8");
      writeFileSync(join(hardlinkSource, "config.toml"), "SOURCE-CONFIG-CONTENT", "utf8");
      mkdirSync(join(hardlinkSource, "assets", "nested"), { recursive: true });
      writeFileSync(join(hardlinkSource, "assets", "nested", "payload.txt"), "SOURCE-NESTED-CONTENT", "utf8");
      plant(hardlinkTarget);
      unlinkSync(join(hardlinkTarget, "config.toml"));
      mkdirSync(join(hardlinkTarget, "assets", "nested"), { recursive: true });
      writeFileSync(join(hardlinkTarget, "keep.txt"), "KEEP-TARGET-ONLY", "utf8");
      writeFileSync(join(hardlinkTarget, "assets", "nested", "keep.txt"), "KEEP-NESTED-TARGET-ONLY", "utf8");
      writeFileSync(hardlinkExternal, "EXTERNAL-KEEP-CONTENT", "utf8");
      writeFileSync(hardlinkNestedExternal, "EXTERNAL-NESTED-KEEP-CONTENT", "utf8");
      linkSync(hardlinkExternal, join(hardlinkTarget, "config.toml"));
      linkSync(hardlinkNestedExternal, join(hardlinkTarget, "assets", "nested", "payload.txt"));
      const hardlinkSourceExeBefore = readFileSync(join(hardlinkSource, "redlib.exe"));
      const hardlinkSourceConfigBefore = readFileSync(join(hardlinkSource, "config.toml"));
      const hardlinkExternalBefore = readFileSync(hardlinkExternal);
      const hardlinkNestedExternalBefore = readFileSync(hardlinkNestedExternal);
      const hardlinkRun = run(["-From", hardlinkSource, "-To", hardlinkTarget, "-Force", "-EnvFile", noEnv]);
      const hardlinkEvidence = {
        exit: hardlinkRun.code,
        sourceExecutablePreserved: readFileSync(join(hardlinkSource, "redlib.exe")).equals(hardlinkSourceExeBefore),
        sourceConfigPreserved: readFileSync(join(hardlinkSource, "config.toml")).equals(hardlinkSourceConfigBefore),
        externalHardlinkTargetPreserved: readFileSync(hardlinkExternal).equals(hardlinkExternalBefore),
        nestedExternalHardlinkTargetPreserved: readFileSync(hardlinkNestedExternal).equals(hardlinkNestedExternalBefore),
        copiedExecutableCorrect: existsSync(join(hardlinkTarget, "redlib.exe"))
          && readFileSync(join(hardlinkTarget, "redlib.exe")).equals(hardlinkSourceExeBefore),
        copiedConfigCorrect: readFileSync(join(hardlinkTarget, "config.toml")).equals(hardlinkSourceConfigBefore),
        copiedNestedFileCorrect: readFileSync(join(hardlinkTarget, "assets", "nested", "payload.txt")).equals(Buffer.from("SOURCE-NESTED-CONTENT", "utf8")),
        targetOnlyEntriesPreserved: readFileSync(join(hardlinkTarget, "keep.txt"), "utf8") === "KEEP-TARGET-ONLY"
          && readFileSync(join(hardlinkTarget, "assets", "nested", "keep.txt"), "utf8") === "KEEP-NESTED-TARGET-ONLY",
      };

      const unownedSource = join(base, "unowned-source");
      const unownedTarget = join(base, "unowned-target");
      plant(unownedSource);
      mkdirSync(unownedTarget);
      writeFileSync(join(unownedTarget, "redlib.exe"), "UNOWNED-EXE-MUST-SURVIVE", "utf8");
      writeFileSync(join(unownedTarget, "operator-data.txt"), "UNOWNED-DATA-MUST-SURVIVE", "utf8");
      const unownedEntriesBefore = readdirSync(unownedTarget).sort();
      const unownedExeBefore = readFileSync(join(unownedTarget, "redlib.exe"));
      const unownedDataBefore = readFileSync(join(unownedTarget, "operator-data.txt"));
      const unownedRun = run(["-From", unownedSource, "-To", unownedTarget, "-Force", "-EnvFile", noEnv]);
      const unownedTargetRefused = unownedRun.code === 1
        && /not an existing Redlib install|unowned/i.test(unownedRun.out)
        && !envLine(unownedRun.out)
        && !existsSync(join(unownedTarget, "install.json"))
        && readdirSync(unownedTarget).sort().join(",") === unownedEntriesBefore.join(",")
        && readFileSync(join(unownedTarget, "redlib.exe")).equals(unownedExeBefore)
        && readFileSync(join(unownedTarget, "operator-data.txt")).equals(unownedDataBefore);

      const shapeSource = join(base, "shape-source");
      const shapeTarget = join(base, "shape-target");
      plant(shapeSource);
      writeFileSync(join(shapeSource, "zz-collision.txt"), "SOURCE-FILE", "utf8");
      plant(shapeTarget);
      mkdirSync(join(shapeTarget, "zz-collision.txt"));
      writeFileSync(join(shapeTarget, "zz-collision.txt", "keep.txt"), "TARGET-DIRECTORY", "utf8");
      const shapeTargetInstallBefore = sourceBytes(shapeTarget);
      const shapeRun = run(["-From", shapeSource, "-To", shapeTarget, "-Force", "-EnvFile", noEnv]);
      const shapeConflictRejectedBeforeWrite = shapeRun.code === 1
        && !envLine(shapeRun.out)
        && sourceBytes(shapeTarget).equals(shapeTargetInstallBefore)
        && readFileSync(join(shapeTarget, "zz-collision.txt", "keep.txt"), "utf8") === "TARGET-DIRECTORY";

      const reparseSource = join(base, "reparse-source");
      const reparseTarget = join(base, "reparse-target");
      const reparseExternal = join(base, "reparse-external");
      plant(reparseSource);
      mkdirSync(join(reparseSource, "collision"));
      writeFileSync(join(reparseSource, "collision", "payload.txt"), "SOURCE-PAYLOAD", "utf8");
      plant(reparseTarget);
      mkdirSync(reparseExternal);
      writeFileSync(join(reparseExternal, "keep.txt"), "EXTERNAL-KEEP", "utf8");
      symlinkSync(reparseExternal, join(reparseTarget, "collision"), "junction");
      const reparseTargetInstallBefore = sourceBytes(reparseTarget);
      const reparseExternalBefore = readFileSync(join(reparseExternal, "keep.txt"));
      const reparseRun = run(["-From", reparseSource, "-To", reparseTarget, "-Force", "-EnvFile", noEnv]);
      const reparseConflictRejectedBeforeWrite = reparseRun.code === 1
        && !envLine(reparseRun.out)
        && sourceBytes(reparseTarget).equals(reparseTargetInstallBefore)
        && readFileSync(join(reparseExternal, "keep.txt")).equals(reparseExternalBefore);

      const evidence = {
        explicitAlias: { exit: aliasRun.code, printedEnv: Boolean(envLine(aliasRun.out)), allPathFieldsAndArrayNoteRewritten: aliasFieldsCorrect },
        autoDiscoveredAlias: { exit: autoRun.code, printedEnv: Boolean(envLine(autoRun.out)), allPathFieldsAndArrayNoteRewritten: autoFieldsCorrect },
        sandboxedLogicalRoot: sandboxLogicalMappingCorrect,
        similarPathOutsideSandboxRejected: similarPathRejected,
        localAppDataSiblingPrefixStaysOutside: siblingPrefixStaysOutside,
        externalLookingAppDataJunctionRejected: appDataJunctionRejected,
        forceSamePlaceAliasPreservesSource: samePlaceSafe,
        runningTargetInstallRefusedBeforeUnlink: liveTargetEvidence,
        stalePidRunningImageRefusedBeforeUnlink: stalePidTargetEvidence,
        failedCopyRestoresPreviousDestination: {
          exit: rollbackRun.code,
          priorMetadataAndFilesRestored: rollbackTargetRestored,
          copyFailureReported: /destination copy did not complete/i.test(rollbackRun.out),
        },
        lockedDestinationFileRefusedBeforeReplacement: {
          exit: lockedTargetRun.code,
          destinationPreserved: lockedTargetRefused,
          refusalReported: /cannot be safely replaced right now/i.test(lockedTargetRun.out),
        },
        unresolvedExistingPathIdentityFailsClosed: unresolvedIdentityRejected,
        forceJunctionToSource: sameJunctionEvidence,
        junctionToSourceChild: targetJunctionChildEvidence,
        nestedTargetRejectedBeforeSourceMutation: nestedSafe,
        ancestorTarget: ancestorTargetEvidence,
        invalidRequiredMetadataRejectedBeforeAdvice: invalidMetadata,
        hardlinkReplacementPreservesAllOtherLinks: hardlinkEvidence,
        unownedNonemptyTargetRefusedEvenWithForce: unownedTargetRefused,
        fileDirectoryConflictRejectedBeforeWrite: shapeConflictRejectedBeforeWrite,
        targetReparseConflictRejectedBeforeWrite: reparseConflictRejectedBeforeWrite,
      };
      assert.deepEqual(
        evidence,
        {
          explicitAlias: { exit: 0, printedEnv: true, allPathFieldsAndArrayNoteRewritten: true },
          autoDiscoveredAlias: { exit: 0, printedEnv: true, allPathFieldsAndArrayNoteRewritten: true },
          sandboxedLogicalRoot: true,
          similarPathOutsideSandboxRejected: true,
          localAppDataSiblingPrefixStaysOutside: true,
          externalLookingAppDataJunctionRejected: true,
          forceSamePlaceAliasPreservesSource: true,
          runningTargetInstallRefusedBeforeUnlink: {
            exit: 1,
            refusedBeforeReplace: true,
            processStillRunning: true,
            installMetadataPreserved: true,
            executablePreserved: true,
            pidFilePreserved: true,
          },
          stalePidRunningImageRefusedBeforeUnlink: {
            exit: 1,
            refusedBeforeReplace: true,
            processStillRunning: true,
            installMetadataPreserved: true,
            executablePreserved: true,
            stalePidPreserved: true,
          },
          failedCopyRestoresPreviousDestination: {
            exit: 1,
            priorMetadataAndFilesRestored: true,
            copyFailureReported: true,
          },
          lockedDestinationFileRefusedBeforeReplacement: {
            exit: 1,
            destinationPreserved: true,
            refusalReported: true,
          },
          unresolvedExistingPathIdentityFailsClosed: true,
          forceJunctionToSource: {
            exit: 0,
            printedEnv: true,
            sourceBytesPreserved: true,
            sourceEntriesPreserved: true,
            printedRootResolvesToSource: true,
          },
          junctionToSourceChild: {
            exit: 1,
            printedEnv: false,
            sourceBytesPreserved: true,
            sourceEntriesPreserved: true,
            redirectedChildEntries: redirectedChildEntriesBefore,
          },
          nestedTargetRejectedBeforeSourceMutation: true,
          ancestorTarget: {
            exit: 1,
            printedEnv: false,
            parentEntriesPreserved: true,
            parentConfigPreserved: true,
            parentInstallPreserved: true,
            parentExecutablePreserved: true,
            sourceInstallPreserved: true,
          },
          invalidRequiredMetadataRejectedBeforeAdvice: { installRoot: true, executable: true, logPath: true },
          hardlinkReplacementPreservesAllOtherLinks: {
            exit: 0,
            sourceExecutablePreserved: true,
            sourceConfigPreserved: true,
            externalHardlinkTargetPreserved: true,
            nestedExternalHardlinkTargetPreserved: true,
            copiedExecutableCorrect: true,
            copiedConfigCorrect: true,
            copiedNestedFileCorrect: true,
            targetOnlyEntriesPreserved: true,
          },
          unownedNonemptyTargetRefusedEvenWithForce: true,
          fileDirectoryConflictRejectedBeforeWrite: true,
          targetReparseConflictRejectedBeforeWrite: true,
        },
        JSON.stringify({ aliasOutput: aliasRun.out, autoOutput: autoRun.out, sandboxOutput: sandboxRun.out, ordinaryOutput: ordinaryRun.out, siblingPrefixOutput: siblingPrefixRun.out, appDataJunctionOutput: appDataJunctionRun.out, unresolvedIdentityOutput: unresolvedRun.out, junctionOutput: junctionRun.out, junctionChildOutput: junctionChildRun.out, nestedOutput: nestedRun.out, ancestorOutput: ancestorRun.out, invalidMetadata, unownedOutput: unownedRun.out, shapeOutput: shapeRun.out, reparseOutput: reparseRun.out, liveTargetOutput: liveTargetRun.out, liveTargetEvidence, stalePidTargetOutput: stalePidTargetRun.out, stalePidTargetEvidence }, null, 2),
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);




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
    assert.match(text, /\$conds = Get-TownReporterBackupAlertConditions[^\r\n]*-MinFreeGb 1/, "the fake temp volume must use an explicit small reserve rather than assume the CI host has 100 GB free");
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
    assert.match(out, /file hashing without Get-FileHash: every check passed/, `the fixture did not reach its end:\n${out}`);
    assert.equal(code, 0, `the fixture exited ${code}:\n${out}`);
  },
);

/* ─────────── the staged copy comes back after a reboot ─────────── */

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
    assert.match(text, /function Wait-ForStub\([\s\S]*?\.AddSeconds\(\$Seconds\)[\s\S]*?OwningProcess -eq \$ProcessId/, "stub readiness must be bounded and belong to this harness's child process");
    /*
      Unit BX. The machine-wide staged-copy pointer is read at call time from
      %LOCALAPPDATA%, and this machine has one (it names the 3100 copy), so the
      fixture's "nothing staged" scenario found it and reported on machine
      state instead of on the code under test. The fixture now points
      LOCALAPPDATA into its own world for the whole run -- the same seam
      scripts\ci-stage-pointer.ps1 uses for the same file -- and puts the
      operator's value back afterwards.
    */
    assert.match(
      text,
      /Join-Path \$world 'localappdata'/,
      "the fixture must point LOCALAPPDATA inside its own world, so the operator's real pointer is neither read nor written",
    );
    assert.match(text, /\$env:LOCALAPPDATA = \$fakeLocalAppData/, "and it must actually set it");
    const pgReadyAt = text.indexOf("Wait-ForStub $pgPort $stubPgPid 30");
    const firstWatchdogAt = text.indexOf("$run = Invoke-Watchdog 'reboot'");
    assert.ok(pgReadyAt >= 0 && pgReadyAt < firstWatchdogAt, "the bounded wait for this run's PostgreSQL listener must finish before the watchdog starts");
    assert.match(
      text,
      /\$env:LOCALAPPDATA = \$previousLocalAppData|Remove-Item Env:\\LOCALAPPDATA/,
      "and put the real LOCALAPPDATA back",
    );
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
