#!/usr/bin/env node
/**
 * TownReporter Control -- the mission-control page for this install.
 *
 * WHAT THIS REPLACES
 *
 * `ops\TownReporter Control.cmd` is a numbered menu in a console window. The
 * owner, 2026-09-25: "You know what I'd like instead of a terminal screen like
 * this is something like mission control for DSH." This is the same six things,
 * with the state of the install on the same screen as the buttons that change
 * it, so "is it up?" and "fix it" stop being two different windows. The menu
 * stays in the repository as the fallback (and as menu line 7 it opens this).
 *
 * It is not a new application. There is no scheduled task, nothing is
 * published, nothing is deleted, and nothing here edits the paper's content.
 *
 * WHAT IT CAN AND CANNOT DO
 *
 *   reads   ops/status.ps1 -Json     the paper, the tunnel, the database, the
 *                                    public site, the watchdog, the reader, the
 *                                    model server -- the SAME verdicts the
 *                                    console prints, because it is the same
 *                                    script. One source of truth, so this page
 *                                    and the menu can never disagree.
 *           package.json + git HEAD the running version
 *           https://townreporter.org  the published version, 10s timeout
 *           <backup folder>/*.sql     the newest backup
 *           127.0.0.1:3100            the test copy, if one is up
 *           lms ps --json             Qwen on this computer, read-only
 *           scan_runs (SELECT)        the last scan
 *   runs    exactly the six menu actions, each a fixed executable with a fixed
 *           argument ARRAY and shell:false. No user-supplied argument ever
 *           reaches a command line. See ACTIONS below.
 *
 * SECURITY SHAPE (copied from stock-dsh/mission-control/mission-control.mjs)
 *
 * Bound to 127.0.0.1 only. Three gates, because loopback is not enough:
 *   1. Host must be 127.0.0.1:<port> or localhost:<port>, or 403. A DNS
 *      rebinding attack reaches a loopback server through a name the browser
 *      resolves after the fact; the Host header is what gives it away.
 *   2. Every POST must carry the per-process token minted at boot and embedded
 *      in the served page, AND a same-origin Origin/Referer, or 403. Binding to
 *      loopback stops a remote attacker, not a web page the operator's own
 *      browser has open -- a form POST from any tab is the real vector, and the
 *      token is unreadable to it (same-origin policy).
 *   3. Unknown action id -> 404, checked with hasOwnProperty so
 *      /api/action/constructor cannot walk the prototype chain into a function.
 *
 * One action at a time (409 while one runs), so two presses cannot interleave a
 * stop and a start. The page's "Working..." button is a courtesy; this is the
 * rule.
 *
 * IDLE EXIT
 *
 * 60 minutes with no request and it exits by itself and removes its pid file.
 * The page polls every 15 seconds, so an open tab keeps it alive and a closed
 * one does not leave a server behind. It is not a scheduled task and it is not
 * a service; it lives while someone is looking at it.
 *
 * ZERO DEPENDENCIES
 *
 * node: builtins only. This file runs on a machine whose paper may be down, so
 * it must not need anything installed in the repository it is describing.
 *
 *   node ops/control/control-server.mjs
 *   ops\control.ps1            # the launcher the Desktop icon runs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** <repo>/ops/control/control-server.mjs -> <repo> */
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const OPS_DIR = path.join(REPO_ROOT, "ops");

/** The port the launcher, the pid file and the Host guard all agree on. */
export const PORT = 3095;
export const HOST = "127.0.0.1";
/** 60 minutes with no request and it leaves. */
export const IDLE_MS = 60 * 60 * 1000;
/** The page's own poll period; keep the two consistent. */
export const POLL_MS = 15_000;

/**
 * Where the nightly `*.sql` dumps live. A setting, with this install's folder
 * as the default: a different machine may keep them elsewhere, and hardcoding
 * one operator's Desktop into a script other people run is how a "no backup
 * found" reading becomes a lie rather than an answer.
 */
export const DEFAULT_BACKUP_DIR = "C:\\Users\\scott\\Desktop\\Code\\townreporter-backups";

/** Windows' own absolute paths; never a PATH lookup, so a poisoned PATH or a
 *  `schtasks.bat` dropped in the working directory cannot redirect an action.
 *  Always Windows separators (path.win32), so the table is the same on a Linux CI runner. */
const SYSTEM32 = path.win32.join(process.env.WINDIR || "C:\\Windows", "System32");
const POWERSHELL = path.win32.join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
const SCHTASKS = path.win32.join(SYSTEM32, "schtasks.exe");

/**
 * The six menu items, by fixed id, exactly as `TownReporter Control.cmd`
 * offers them. Every one is a fixed executable plus a fixed argument ARRAY run
 * with shell:false -- Node passes an argv vector, so no argument is ever
 * re-parsed by a shell and no request body can add one. The `explain` text is
 * the menu's own wording: the operator already knows what these sentences mean,
 * and a second phrasing for the same button is a second thing to get wrong.
 *
 * `spawns` is a list of argv vectors run in order. `refresh` is the odd one
 * out: "check" has nothing to run, it re-reads the status.
 */
export const ACTIONS = {
  check: {
    label: "Check it again",
    explain: "Check the paper, the tunnel and the database",
    refresh: true,
    spawns: [],
  },
  "restart-paper": {
    label: "Restart the paper",
    explain: "When the desk is slow or acting strange. The paper is offline for about ten seconds.",
    spawns: [{ exe: SCHTASKS, args: ["/run", "/tn", "TownReporter Restart"], settleMs: 15_000 }],
  },
  "restart-tunnel": {
    label: "Restart the tunnel",
    explain: "When the site is down but the desk works. The desk keeps working; the public site blinks.",
    spawns: [{ exe: SCHTASKS, args: ["/run", "/tn", "TownReporter Tunnel Restart"], settleMs: 15_000 }],
  },
  "start-all": {
    label: "Start everything",
    explain: "After a reboot, or if nothing is running. Starts the database, the paper and the tunnel.",
    spawns: [
      { exe: SCHTASKS, args: ["/run", "/tn", "TownReporter"], settleMs: 0 },
      { exe: SCHTASKS, args: ["/run", "/tn", "TownReporter Tunnel"], settleMs: 20_000 },
    ],
  },
  "stop-all": {
    label: "Stop everything",
    explain: "Takes the paper offline until you start it again.",
    // The one action that takes the paper OFFLINE, and the only button on the
    // page that is drawn as one: red fill, so it does not read as the fifth of
    // five identical "do something" buttons. See CONFIRM_WORD for the other
    // half of that -- the page asks first, and the server refuses without it.
    danger: true,
    confirm: "offline",
    spawns: [
      {
        exe: POWERSHELL,
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(OPS_DIR, "stop-townreporter.ps1")],
        settleMs: 0,
      },
    ],
  },
  "restart-reddit": {
    label: "Restart the Reddit reader",
    explain:
      "When Reddit threads read as headlines only. This waits for it to answer Reddit, so it can take a minute. The paper is not affected either way.",
    spawns: [
      {
        exe: POWERSHELL,
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(OPS_DIR, "redlib.ps1"), "restart"],
        settleMs: 0,
      },
    ],
  },
};

/** The word the stop-all body must carry, and the page's own dialog must show. */
export const CONFIRM_WORD = "offline";

export const LINKS = [
  // The public address, not 127.0.0.1:3000: the sign-in cookie belongs to
  // townreporter.org, so the loopback address is a different site to the
  // browser and asks the editor to sign in again.
  { id: "desk", label: "Open the desk", href: "https://townreporter.org/desk" },
  { id: "site", label: "Open the public site", href: "https://townreporter.org" },
  { id: "test", label: "Open the test copy", href: "http://127.0.0.1:3100" },
];

/**
 * The `.env` values this server needs, from the install being DESCRIBED rather
 * than from the directory the file happens to sit in.
 *
 * `ops/status.ps1` learned this first (`-Root`): run from a worktree, it still
 * describes the live paper. This has the same need, for the one probe that
 * needs a database URL. The process environment wins, so an explicit override
 * still works, and a missing file is just an empty map -- never an error, since
 * "there is no .env" is a normal state for a checkout.
 */
function readEnvFile(appRoot) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(path.join(appRoot, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

/** Run a fixed executable with an argv array and NO shell. Never a command string. */
export function spawnFixed(exe, args, { cwd, env, timeoutMs = 120_000, onOutput } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { cwd, env, shell: false, windowsHide: true });
    } catch (error) {
      resolve({ code: -1, output: [`could not start ${path.basename(exe)}: ${error?.message || error}`] });
      return;
    }
    const output = [];
    const keep = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        output.push(line);
        if (onOutput) onOutput(line);
      }
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (error) => {
      keep(`could not start ${path.basename(exe)}: ${error?.message || error}`);
      resolve({ code: -1, output });
    });
    const timer = setTimeout(() => {
      keep(`${path.basename(exe)} did not finish within ${Math.round(timeoutMs / 1000)}s`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── read-only probes ─────────────────────────── */

/**
 * The paper's own verdicts, from the script that has always owned them.
 *
 * `-Root` is passed only when it differs from this file's repository, so the
 * common case is the plain `ops\status.ps1 -Json` and the worktree case still
 * describes the live install. Read-only in every mode: `-Json` implies no
 * repairs for the same reason `-DryRun` does.
 */
export async function probeStatus({ appRoot, repoRoot = REPO_ROOT, onOutput } = {}) {
  const script = path.join(repoRoot, "ops", "status.ps1");
  if (!fs.existsSync(script)) {
    return { ok: false, error: `ops/status.ps1 is missing at ${script}` };
  }
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Json"];
  if (appRoot && path.resolve(appRoot) !== path.resolve(repoRoot)) args.push("-Root", appRoot);
  const { code, output } = await spawnFixed(POWERSHELL, args, { timeoutMs: 90_000, onOutput });
  const text = output.join("\n");
  const start = text.indexOf("{");
  if (start < 0) {
    return { ok: false, error: `status.ps1 printed no JSON (exit ${code}): ${text.slice(0, 300)}` };
  }
  try {
    return { ok: true, status: JSON.parse(text.slice(start)) };
  } catch (error) {
    return { ok: false, error: `status.ps1 printed unparseable JSON: ${error?.message || error}` };
  }
}

/** The running version: this checkout's package.json, and the short git HEAD. */
export function probeVersion({ repoRoot = REPO_ROOT, read = fs.readFileSync } = {}) {
  let version = null;
  try {
    version = JSON.parse(read(path.join(repoRoot, "package.json"), "utf8")).version || null;
  } catch {
    /* reported below as unknown */
  }
  let head = null;
  try {
    const git = path.join(repoRoot, ".git");
    // A worktree's .git is a file pointing at the real gitdir, so read the
    // ref through it rather than assuming a directory layout.
    const gitDir = fs.statSync(git).isDirectory()
      ? git
      : path.resolve(repoRoot, fs.readFileSync(git, "utf8").replace(/^gitdir:\s*/, "").trim());
    head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      head = fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
    }
  } catch {
    head = null;
  }
  return {
    version,
    head: head ? head.slice(0, 8) : null,
    label: version ? `${version}${head ? ` (${head.slice(0, 8)})` : ""}` : "version not readable",
  };
}

/** The published version, read off the public site. 10s, and never a fault. */
export async function probePublicVersion({ site = "https://townreporter.org", timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(site, { signal: controller.signal, redirect: "follow" });
    const body = await res.text();
    const m = body.match(/0\.6\.\d+/);
    return { ok: true, version: m ? m[0] : null, status: res.status };
  } catch (error) {
    return { ok: false, version: null, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The newest `*.sql` in the backup folder. Missing folder is an answer, not a throw. */
export function probeBackup({ dir = DEFAULT_BACKUP_DIR, now = Date.now } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".sql"));
  } catch {
    return { ok: false, found: false, dir, detail: `No backup found in ${dir}` };
  }
  if (!names.length) return { ok: false, found: false, dir, detail: `No backup found in ${dir}` };
  let newest = null;
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(dir, name));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name, size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      /* vanished mid-listing: the next one still answers */
    }
  }
  if (!newest) return { ok: false, found: false, dir, detail: `No backup found in ${dir}` };
  const ageMinutes = Math.max(0, Math.round((now() - newest.mtimeMs) / 60000));
  return { ok: true, found: true, dir, ...newest, ageMinutes };
}

/** Whether a test copy is answering on 3100, and what version it says. */
export async function probeTestCopy({ port = 3100, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    const body = await res.text();
    const m = body.match(/0\.6\.\d+/);
    return { ok: true, up: true, version: m ? m[0] : null, status: res.status };
  } catch {
    return { ok: true, up: false, version: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Qwen on this computer, through LM Studio's own read-only process listing.
 * NEVER load or unload: the owner may have a model mid-draft, and this page's
 * whole promise is that it does not disturb the machine.
 */
export async function probeQwen({ exe = null, timeoutMs = 20_000 } = {}) {
  const lms = exe || resolveOnPath("lms");
  if (!lms) return { ok: true, found: false, detail: "LM Studio not found" };
  const { code, output } = await spawnFixed(lms, ["ps", "--json"], { timeoutMs });
  const text = output.join("\n");
  if (code !== 0 && !text.trim()) {
    return { ok: true, found: true, models: [], detail: "LM Studio is not answering" };
  }
  let models = [];
  try {
    const start = text.indexOf("[");
    const parsed = start >= 0 ? JSON.parse(text.slice(start)) : [];
    models = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { ok: true, found: true, models: [], detail: "LM Studio answered in a shape this page does not know" };
  }
  const qwen = models.filter((m) => /qwen/i.test(String(m?.modelKey || m?.identifier || "")));
  if (!models.length) return { ok: true, found: true, models, detail: "nothing is loaded in LM Studio" };
  if (!qwen.length) {
    return { ok: true, found: true, models, detail: `${models.length} model(s) loaded, no Qwen among them` };
  }
  return { ok: true, found: true, models, qwen: qwen.map((m) => String(m.modelKey || m.identifier)), detail: `Qwen loaded: ${qwen.map((m) => String(m.modelKey || m.identifier)).join(", ")}` };
}

/**
 * Resolve a bare command against PATH, the way a shell would, without a shell.
 * Only ever used for a READ (lm studio's `lms ps --json`); every action uses an
 * absolute System32 path instead.
 */
export function resolveOnPath(name, env = process.env) {
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";");
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/**
 * The last scan, read-only, through the app's own environment wrapper so the
 * database URL and the migration state are the app's and not this file's.
 * Fails soft: "could not read it" is a real answer and must not read as "the
 * scan failed".
 */
export async function probeLastScan({ repoRoot = REPO_ROOT, appRoot = null, timeoutMs = 60_000, onOutput } = {}) {
  const script = path.join(repoRoot, "ops", "control", "last-scan.cjs");
  if (!fs.existsSync(script)) return { ok: false, detail: "Could not read the last scan" };
  const env = { ...process.env };
  if (!env.DATABASE_URL && appRoot) {
    const fromInstall = readEnvFile(appRoot).DATABASE_URL;
    if (fromInstall) env.DATABASE_URL = fromInstall;
  }
  const { output } = await spawnFixed(
    process.execPath,
    [path.join(repoRoot, "scripts", "with-app-env.mjs"), process.execPath, script],
    { cwd: repoRoot, env, timeoutMs, onOutput },
  );
  const text = output.join("\n");
  const start = text.indexOf("{");
  if (start < 0) return { ok: false, detail: "Could not read the last scan", raw: text.slice(-300) };
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return { ok: false, detail: "Could not read the last scan" };
  }
}

/* ─────────────────────────── status assembly ─────────────────────────── */

const bytes = (n) => {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** This machine's own zone, resolved once. `TZ` in the environment wins. */
const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/** The civil date (year, month, day) `ms` falls on in `timeZone`. */
function civilDay(ms, timeZone) {
  const found = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))) {
    found[part.type] = part.value;
  }
  return { year: Number(found.year), month: Number(found.month), day: Number(found.day) };
}

/** Days since the epoch, so two civil dates can be subtracted without DST lies. */
const dayIndex = ({ year, month, day }) => Math.round(Date.UTC(year, month - 1, day) / 86_400_000);

/**
 * A time the way the person reading this page says it: 12-hour clock, in this
 * machine's own zone, with the day named when it is near.
 *
 * The bug this replaces printed a backup written at 4:31 PM Mountain as
 * "2026-09-25 22:31" -- UTC, 24-hour, on a page whose whole job is to be read
 * by one person sitting at that machine. `Intl` in the resolved zone is the
 * only way to be right about the offset AND the DST boundary, and the zone is
 * injectable so a test can pin it instead of inheriting whatever CI's TZ is.
 *
 * "today" / "yesterday" / "Sep 23" is a comparison of civil dates in the zone,
 * never a 24-hour subtraction: 9:05 PM yesterday and 6:00 AM today are seven
 * hours apart and two different days.
 */
export function formatLocalTime(value, { timeZone = LOCAL_TZ, now = Date.now } = {}) {
  const ms = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "";
  try {
    const clock = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ms));
    const nowMs = typeof now === "function" ? now() : now;
    const day = civilDay(ms, timeZone);
    const delta = dayIndex(day) - dayIndex(civilDay(nowMs, timeZone));
    if (delta === 0) return `today at ${clock}`;
    if (delta === -1) return `yesterday at ${clock}`;
    if (delta === 1) return `tomorrow at ${clock}`;
    const label = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(ms));
    // Outside this year, name the year: "Sep 23 at 6:00 AM" in a January page
    // would otherwise read as this January.
    return `${label}${day.year === civilDay(nowMs, timeZone).year ? "" : `, ${day.year}`} at ${clock}`;
  } catch {
    return "";
  }
}

/** Two times as one span, with the day said once: "today at 4:26 PM to 4:31 PM". */
export function formatLocalRange(from, to, options = {}) {
  const start = formatLocalTime(from, options);
  const end = formatLocalTime(to, options);
  if (!start) return end;
  if (!end) return start;
  const cut = (text) => text.indexOf(" at ");
  if (cut(start) > 0 && cut(end) > 0 && start.slice(0, cut(start)) === end.slice(0, cut(end))) {
    return `${start} to ${end.slice(cut(end) + 4)}`;
  }
  return `${start} to ${end}`;
}

/**
 * The last scan as one honest row.
 *
 * Every soft failure gets its own sentence, keyed on the reason the script
 * reported rather than on prose this file wrote: "no database URL is
 * configured" and "the database did not answer" are different faults with
 * different remedies, and the coordinator's review caught the row saying the
 * first when the second was true.
 *
 * A readable scan is OK only when the run actually finished. A run that failed,
 * or is still going, is a Note with the same words -- "OK: failed" is the same
 * lie as "OK: could not read it", one line down.
 */
export function describeLastScan(scan, options = {}) {
  if (!scan || !scan.ok) {
    const reason = scan?.reason || "";
    const details = {
      "no-database-url": "no database URL is configured for the paper",
      "driver-missing": "the paper's database driver is not installed",
      unreachable: "could not reach the database",
      "no-scans": "no scan has run yet",
      "query-failed": "the scan table could not be read",
    };
    return {
      state: "note",
      detail: details[reason] || scan?.detail || "Could not read the last scan",
      reason: reason || null,
    };
  }
  const status = String(scan.status || "");
  const when = formatLocalRange(scan.startedAt, scan.finishedAt, options);
  const extras = [
    scan.leads === null || scan.leads === undefined ? "" : `${scan.leads} lead(s)`,
    scan.model ? `model ${scan.model}` : "",
  ].filter(Boolean);
  return {
    state: !status || status.startsWith("failed") || status === "running" ? "note" : "ok",
    detail: `${when || "started at an unknown time"} - ${status || "unknown"}${extras.length ? `, ${extras.join(", ")}` : ""}`,
    reason: null,
  };
}

/**
 * The whole page's answer, in one object.
 *
 * The headline and the attention count come from `ops/status.ps1 -Json` and are
 * NOT recomputed here. That is the point of the single source: the console, the
 * menu and this page answer "is it up" with one script's verdicts. The extra
 * cards below are marked informational, so a version skew or a missing backup
 * cannot inflate "N things need attention" into crying wolf.
 */
export async function collectStatus({
  appRoot,
  repoRoot = REPO_ROOT,
  backupDir = DEFAULT_BACKUP_DIR,
  now = Date.now,
  onOutput,
  timeZone = LOCAL_TZ,
  /** Every read-only probe, injectable. Tests replace the ones they are about
   *  rather than reaching for the network, the machine's PowerShell or a
   *  database; nothing here changes a probe's defaults. */
  probes = {},
} = {}) {
  const read = {
    status: probeStatus,
    version: probeVersion,
    publicVersion: probePublicVersion,
    testCopy: probeTestCopy,
    qwen: probeQwen,
    lastScan: probeLastScan,
    backup: probeBackup,
    ...probes,
  };
  const probed = await read.status({ appRoot, repoRoot, onOutput });

  if (!probed.ok) {
    return {
      checkedAt: new Date(now()).toISOString(),
      attention: 1,
      headline: "Could not read the paper's status",
      advice: "The check itself failed; this is not a verdict about the paper.",
      checks: [],
      extras: [
        {
          id: "status-script",
          label: "The check",
          state: "down",
          ok: false,
          optional: false,
          detail: probed.error,
          fix: "check",
          fixLabel: "Check it again",
        },
      ],
    };
  }

  const status = probed.status;
  const [version, publicVersion, testCopy, qwen, lastScan] = await Promise.all([
    Promise.resolve(read.version({ repoRoot })),
    read.publicVersion({ site: status.site || "https://townreporter.org" }),
    read.testCopy({}),
    read.qwen({}),
    read.lastScan({ repoRoot, appRoot, onOutput }),
  ]);

  const backup = read.backup({ dir: backupDir, now });

  // Every card below carries a real `state` -- "ok" / "note" / "down" -- and
  // `ok` derived from it, so the page cannot print OK over a probe that did not
  // answer. NOTHING on a catch or fallback path may be OK: that was the whole
  // of the coordinator's first finding, where a soft failure rendered as a
  // green "OK: Could not read the last scan".
  const card = (id, label, state, detail) => ({
    id,
    label,
    state,
    ok: state === "ok",
    optional: true,
    detail,
    fix: null,
  });

  // Fix 6: versions that differ are a Note with the reason in the sentence.
  const sameVersion = Boolean(
    publicVersion.ok && publicVersion.version && version.version && publicVersion.version === version.version,
  );
  const versionDetail = !publicVersion.ok
    ? `This install is ${version.label}; the public site could not be read (${publicVersion.error})`
    : sameVersion
      ? `This install is ${version.label}; the public site shows the same version`
      : publicVersion.version
        ? `This install is ${version.version}; the public site shows ${publicVersion.version}. Normal right after an update, until the site refreshes.`
        : `This install is ${version.label}; the public site answered but named no version`;

  const scan = describeLastScan(lastScan, { now, timeZone });

  const extras = [
    card("version", "Version", sameVersion ? "ok" : "note", versionDetail),
    // A backup that is not there is not a fault -- this page never starts one --
    // but it is not "OK" either, and it never was: read it as a Note.
    card(
      "backup",
      "Last backup",
      backup.found ? "ok" : "note",
      backup.found
        ? `${backup.name} - ${bytes(backup.size)}, written ${formatLocalTime(backup.mtimeMs, { now, timeZone })} (${backup.ageMinutes} minutes ago)`
        : `No backup found in ${backup.dir}`,
    ),
    // A test copy that is not running is normal, and normal is not the same
    // word as healthy: Note, so the card is never a green light nobody checked.
    card(
      "test-copy",
      "Test copy on 3100",
      testCopy.up ? "ok" : "note",
      testCopy.up
        ? `answering${testCopy.version ? `, version ${testCopy.version}` : ""}`
        : "nothing is answering on 3100 (that is normal; it is not always running)",
    ),
    // The probe reports `ok` for "not installed" / "not answering" because
    // those are answers, not failures -- but a card is a verdict, and the only
    // verdict Qwen loaded earns is OK.
    card(
      "qwen",
      "Qwen on this computer",
      Array.isArray(qwen.qwen) && qwen.qwen.length ? "ok" : "note",
      qwen.detail,
    ),
    card("last-scan", "Last scan", scan.state, scan.detail),
  ];

  return {
    checkedAt: new Date(now()).toISOString(),
    attention: status.attention ?? 0,
    headline: status.headline || "",
    advice: status.advice || "",
    root: status.root,
    checks: status.checks || [],
    extras,
  };
}

/* ─────────────────────────── the server ─────────────────────────── */

/**
 * Build the server. Every side effect is an injected seam -- the clock, the
 * spawner, the probes, whether to write the pid file -- so the tests run the
 * real request handling with no powershell, no schtasks and no port 5433
 * anywhere in sight.
 */
export function createControlServer(options = {}) {
  const {
    port = PORT,
    host = HOST,
    repoRoot = REPO_ROOT,
    appRoot = process.env.CONTROL_ROOT || repoRoot,
    backupDir = process.env.CONTROL_BACKUP_DIR || DEFAULT_BACKUP_DIR,
    now = Date.now,
    idleMs = IDLE_MS,
    statusTtlMs = 5000,
    /** (action, { onOutput }) => Promise<{ code, output }> */
    runner = defaultRunner,
    /** (options) => Promise<status> */
    collect = collectStatus,
    /** How the action table waits out a step's settle time. Injectable so a
     *  test pressing "restart the paper" does not wait fifteen seconds for a
     *  restart that never happened. */
    settle = sleep,
    pidFile = path.join(OPS_DIR, ".control.pid"),
    writePidFile = true,
    onOutputLine = null,
  } = options;

  const token = options.token || crypto.randomBytes(24).toString("hex");
  const state = {
    run: null, // { action, lines, done, code, startedAt, finishedAt }
    lastRequestAt: now(),
    statusCache: null,
  };

  // The port actually bound, which is not the requested one when the tests ask
  // for 0 (an ephemeral port, so a test run cannot collide with a real Control
  // page or with a sibling test). Read per request rather than captured once.
  const boundPort = () => server.address()?.port ?? port;
  const allowedHosts = () =>
    new Set([`${host}:${boundPort()}`, `127.0.0.1:${boundPort()}`, `localhost:${boundPort()}`]);
  const allowedOrigins = () =>
    new Set([`http://127.0.0.1:${boundPort()}`, `http://localhost:${boundPort()}`]);

  /** The action ids that exist, own-properties only. Never the prototype chain. */
  const hasAction = (id) => Object.prototype.hasOwnProperty.call(ACTIONS, id);

  async function defaultCollect() {
    return collect({ appRoot, repoRoot, backupDir, now, onOutput: onOutputLine || undefined });
  }

  async function status({ force = false } = {}) {
    const t = now();
    if (!force && state.statusCache && t - state.statusCache.at < statusTtlMs) return state.statusCache.value;
    if (state.statusCache?.pending) return state.statusCache.pending;
    const pending = (async () => {
      try {
        const value = await defaultCollect();
        state.statusCache = { at: now(), value };
        return value;
      } catch (error) {
        const value = {
          checkedAt: new Date(now()).toISOString(),
          attention: 1,
          headline: "Could not read the paper's status",
          advice: String(error?.message || error),
          checks: [],
          extras: [],
        };
        state.statusCache = { at: now(), value };
        return value;
      }
    })();
    state.statusCache = { at: t, value: state.statusCache?.value || null, pending };
    const resolved = await pending;
    state.statusCache = { at: now(), value: resolved };
    return resolved;
  }

  async function startAction(id) {
    const spec = ACTIONS[id];
    const run = {
      action: id,
      lines: [],
      done: false,
      code: null,
      startedAt: new Date(now()).toISOString(),
      finishedAt: null,
    };
    state.run = run;
    const push = (line) => {
      run.lines.push(line);
      if (onOutputLine) onOutputLine(line);
    };
    if (spec.refresh) {
      await status({ force: true });
      push("Checked again.");
      run.done = true;
      run.code = 0;
      run.finishedAt = new Date(now()).toISOString();
      return run;
    }
    try {
      for (const step of spec.spawns) {
        push(`Running ${path.basename(step.exe)} ${step.args.join(" ")}`);
        const result = await runner(step, { onOutput: push });
        run.code = result?.code ?? -1;
        if (run.code !== 0) {
          push(`That step exited ${run.code}.`);
          break;
        }
        if (step.settleMs) await settle(step.settleMs);
      }
      if (run.code === 0) push("Done. Reading the status again.");
    } catch (error) {
      run.code = -1;
      push(`The action failed: ${error?.message || error}`);
    }
    run.done = true;
    run.finishedAt = new Date(now()).toISOString();
    // The page refreshes itself afterwards; drop the cache so what it reads is
    // the state this action just produced, not the state before it.
    state.statusCache = null;
    return run;
  }

  const server = http.createServer(async (req, res) => {
    state.lastRequestAt = now();
    try {
      setSecurityHeaders(res);
      const hostHeader = String(req.headers.host || "");
      // 1. Host guard. A name that resolves to loopback after the fact (DNS
      //    rebinding) still has to name this server in the Host header.
      if (!allowedHosts().has(hostHeader.toLowerCase())) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("forbidden: this server answers only to 127.0.0.1");
        return;
      }
      const url = new URL(req.url, `http://${host}:${port}`);
      if (url.pathname.startsWith("/api/")) res.setHeader("cache-control", "no-store");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(renderPage(token));
        return;
      }
      // Answer the browser's automatic icon request, so a normal page load
      // leaves no 404 in the console. A console error on a page whose whole job
      // is to say whether things are healthy is a red herring for the operator,
      // and it is the one request the page never makes on purpose.
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const fresh = await status({ force: url.searchParams.get("refresh") === "1" });
        sendJson(res, 200, fresh);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/actions") {
        sendJson(res, 200, {
          actions: Object.entries(ACTIONS).map(([id, spec]) => ({
            id,
            label: spec.label,
            explain: spec.explain,
            danger: spec.danger === true,
            confirm: spec.confirm || null,
          })),
          links: LINKS,
          running: state.run && !state.run.done ? state.run.action : null,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/action/output") {
        const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
        const run = state.run;
        sendJson(res, 200, {
          action: run?.action || null,
          running: !!(run && !run.done),
          done: !!run?.done,
          code: run?.code ?? null,
          lines: run ? run.lines.slice(since) : [],
          next: run ? run.lines.length : 0,
        });
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/action/")) {
        // 2. The CSRF gate: the boot token AND a same-origin Origin/Referer.
        if (!authorized(req)) {
          res.writeHead(403, { "content-type": "text/plain" });
          res.end("forbidden: missing or invalid action token");
          return;
        }
        const id = decodeURIComponent(url.pathname.slice("/api/action/".length));
        // 3. Own properties only.
        if (!hasAction(id)) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("no such action");
          return;
        }
        const body = await readBody(req);
        if (ACTIONS[id].confirm && body?.confirm !== ACTIONS[id].confirm) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end(`refused: this action needs confirm: "${ACTIONS[id].confirm}" in the request body`);
          return;
        }
        if (state.run && !state.run.done) {
          res.writeHead(409, { "content-type": "text/plain" });
          res.end("Another action is running. Wait for it to finish.");
          return;
        }
        // Answer before the work: the page polls for the output, and a slow
        // action must not hold the request open for two minutes.
        sendJson(res, 200, { started: true, action: id });
        startAction(id).catch(() => {
          /* startAction already records its own failure in run.lines */
        });
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`internal error: ${error?.message || error}`);
    }
  });

  function authorized(req) {
    const presented = String(req.headers["x-control-token"] || "");
    const expected = Buffer.from(token);
    const given = Buffer.from(presented);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
    const origin = String(req.headers.origin || "");
    const referer = String(req.headers.referer || "");
    if (!origin && !referer) return false;
    const origins = allowedOrigins();
    const sameSite = (value) => {
      if (!value) return true;
      try {
        return origins.has(new URL(value).origin);
      } catch {
        return false;
      }
    };
    return sameSite(origin) && sameSite(referer);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let text = "";
      req.on("data", (chunk) => {
        text += chunk;
        if (text.length > 4096) {
          text = text.slice(0, 4096);
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(text ? JSON.parse(text) : null);
        } catch {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
    });
  }

  let idleTimer = null;

  /** The idle rule, callable on its own so a test can run it on a fake clock. */
  function checkIdle() {
    if (now() - state.lastRequestAt < idleMs) return false;
    stop();
    return true;
  }

  function writePid() {
    if (!writePidFile) return;
    try {
      fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    } catch {
      /* the pid file is a convenience for the launcher; losing it is not fatal */
    }
  }

  function removePid() {
    if (!writePidFile) return;
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* already gone */
    }
  }

  function stop() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    removePid();
    try {
      server.close();
    } catch {
      /* not listening */
    }
  }

  return {
    server,
    token,
    state,
    status,
    startAction,
    checkIdle,
    writePid,
    removePid,
    stop,
    /** Listen, write the pid file, and start the idle clock. */
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          writePid();
          idleTimer = setInterval(checkIdle, Math.min(idleMs, 60_000));
          if (idleTimer.unref) idleTimer.unref();
          resolve(server.address());
        });
      });
    },
    /** Close and remove the pid file -- for tests and for a signal handler. */
    async close() {
      stop();
      await new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
    },
  };
}

function setSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, code, value) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

/** The real runner: fixed executable, argv array, no shell. */
export function defaultRunner(step, { onOutput } = {}) {
  return spawnFixed(step.exe, step.args, { onOutput, timeoutMs: step.timeoutMs || 180_000 });
}

/* ─────────────────────────── the page ─────────────────────────── */

/**
 * One self-contained document: inline CSS, inline JS, no CDN, no fonts to
 * fetch. It has to render on a machine whose paper is down, so it may not
 * depend on anything that machine would have to reach.
 *
 * Accessibility is a requirement, not a polish pass: the owner reads this at
 * night with old eyes. Dark by default with a light toggle remembered in
 * localStorage, nothing under 16px, buttons at least 44px tall, every control
 * reachable by keyboard, and every click shows "Working..." within the same
 * frame it was clicked in.
 */
export function renderPage(token) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TownReporter Control</title>
<script>
// Before the first paint, so a dark room never gets a white frame.
try { if (localStorage.getItem("townreporter.control.theme") === "light") document.documentElement.setAttribute("data-theme", "light"); } catch (e) {}
</script>
<style>
:root[data-theme="dark"] {
  --bg: #10161a; --card: #182024; --line: #2c3a42; --ink: #eef4f7; --dim: #a9bcc6;
  --good: #6fd08c; --warn: #f0c05a; --bad: #ff9a8a; --accent: #7fc4e8; --accent-ink: #08131a;
  --danger-ink: #1b0d0a;
}
:root[data-theme="light"] {
  --bg: #f6f1e7; --card: #fffdf8; --line: #cbbfa8; --ink: #1b2328; --dim: #4d5a62;
  --good: #1d6b38; --warn: #8a5a00; --bad: #a3231a; --accent: #14526e; --accent-ink: #ffffff;
  --danger-ink: #ffffff;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font: 18px/1.5 "Segoe UI", system-ui, sans-serif; padding: 24px; }
h1 { font-size: 26px; margin: 0 0 4px; }
.sub { color: var(--dim); font-size: 16px; margin: 0 0 20px; }
.headline { font-size: 30px; font-weight: 700; margin: 20px 0 4px; }
.headline.ok { color: var(--good); }
.headline.warn { color: var(--warn); }
.headline.bad { color: var(--bad); }
.advice { color: var(--dim); font-size: 18px; margin: 0 0 8px; }
section { margin: 28px 0 0; }
h2 { font-size: 20px; margin: 0 0 12px; color: var(--dim); font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card h3 { margin: 0 0 6px; font-size: 18px; }
.card p { margin: 0; font-size: 17px; color: var(--dim); }
/* Three colours, three meanings. "note" is AMBER, not the dim grey it used to
   be: a soft failure has to look like something to look at, or "OK: could not
   read the last scan" comes back wearing a different shade. */
.verdict { font-weight: 600; }
.verdict.ok { color: var(--good); }
.verdict.note { color: var(--warn); }
.verdict.bad { color: var(--bad); }
.card button, .actions button, .links a { min-height: 48px; }
.card button { margin-top: 12px; }
button { font: inherit; font-size: 17px; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--line); background: var(--accent); color: var(--accent-ink); cursor: pointer; }
button.secondary { background: transparent; color: var(--ink); }
/* Stop everything, and only it. The six buttons used to be one flat colour,
   which made the one that takes the paper offline look like the five that do
   not. Red fill, with the ink chosen per theme so the label stays legible in
   both: #1b0d0a on the dark theme's pale red (9.2:1) and white on the light
   theme's deep red (7.5:1). */
button.danger { background: var(--bad); color: var(--danger-ink); border-color: var(--bad); font-weight: 600; }
button[disabled] { opacity: 0.65; cursor: default; }
button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; }
.actions .card p { margin-bottom: 4px; }
pre#output { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 16px; white-space: pre-wrap; min-height: 24px; margin: 0; }
.links { display: flex; flex-wrap: wrap; gap: 12px; }
.links a { display: inline-flex; align-items: center; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--line); color: var(--accent); text-decoration: none; font-size: 17px; }
.links a:hover { text-decoration: underline; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
#dialog { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; padding: 24px; }
#dialog.open { display: flex; }
#dialog .box { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 22px; max-width: 620px; }
#dialog h2 { color: var(--ink); font-size: 22px; }
#dialog .row { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
/* The dialog's confirm is the same button class, so it inherits the same
   per-theme ink -- the hardcoded near-black it used to carry was 1.9:1 on the
   light theme's red, which is the contrast bug this fixes. */
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
<header>
  <div>
    <h1>TownReporter Control</h1>
    <p class="sub">The same six things the menu offers, with the state of the install beside them.</p>
  </div>
  <button id="theme" class="secondary" type="button" aria-live="polite">Light</button>
</header>

<p class="headline" id="headline">Reading the status...</p>
<p class="advice" id="advice"></p>
<p class="sub" id="checked">checked just now</p>

<section aria-labelledby="state-h">
  <h2 id="state-h">Is it up?</h2>
  <div class="cards" id="cards"></div>
</section>

<section aria-labelledby="actions-h">
  <h2 id="actions-h">Do something</h2>
  <div class="actions" id="actions"></div>
</section>

<section aria-labelledby="output-h">
  <h2 id="output-h">What just happened</h2>
  <pre id="output" tabindex="0" role="log" aria-live="polite">Nothing yet.</pre>
</section>

<section aria-labelledby="links-h">
  <h2 id="links-h">Go to</h2>
  <div class="links" id="links"></div>
</section>

<div id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-h">
  <div class="box">
    <h2 id="dialog-h">This takes the paper OFFLINE until you start it again.</h2>
    <p class="sub">Readers will see the site go dark. Choose Start everything when you want it back.</p>
    <div class="row">
      <button class="secondary" id="cancel" type="button">Cancel</button>
      <button class="danger" id="confirm" type="button">Take it offline</button>
    </div>
  </div>
</div>

<script>
var TOKEN = ${JSON.stringify(token)};
var POLL_MS = ${POLL_MS};
var lastChecked = Date.now();
var running = null;
var pendingAction = null;

function el(id) { return document.getElementById(id); }

function theme() { return document.documentElement.getAttribute("data-theme"); }
function applyThemeButton() {
  el("theme").textContent = theme() === "dark" ? "Light" : "Dark";
  el("theme").setAttribute("aria-label", "Switch to " + (theme() === "dark" ? "light" : "dark") + " appearance");
}
el("theme").addEventListener("click", function () {
  var next = theme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("townreporter.control.theme", next); } catch (e) {}
  applyThemeButton();
});
applyThemeButton();

/**
 * The card's real state, from the row the server sent.
 *
 * The row's own "state" is the truth and is what this keys on. The fallback is
 * for a status object written before the field existed (the fixtures in
 * scripts/control-page-server.test.mjs and scripts/control-page-walk.mjs, and
 * any cached page still holding an older /api/status): derive it from "ok" and
 * "optional", which is exactly how the server derives it.
 */
function stateOf(card) {
  if (card.state === "ok" || card.state === "note" || card.state === "down") return card.state;
  return card.ok ? "ok" : card.optional ? "note" : "down";
}
function verdictClass(card) {
  var s = stateOf(card);
  return s === "ok" ? "ok" : s === "note" ? "note" : "bad";
}
function verdictWord(card) {
  var s = stateOf(card);
  return s === "ok" ? "OK" : s === "note" ? "Note" : "Down";
}

function renderCards(target, cards, withFix) {
  target.textContent = "";
  (cards || []).forEach(function (card) {
    var box = document.createElement("div");
    box.className = "card";
    box.dataset.state = stateOf(card);
    var h = document.createElement("h3");
    h.textContent = card.label;
    var v = document.createElement("span");
    v.className = "verdict " + verdictClass(card);
    v.textContent = verdictWord(card) + ": ";
    var p = document.createElement("p");
    p.appendChild(v);
    p.appendChild(document.createTextNode(card.detail || ""));
    box.appendChild(h);
    box.appendChild(p);
    // The one button that fixes it -- only when there is one and only when the
    // row is not OK. A button on a healthy row is an invitation to press it,
    // which is what "Note: up" plus a Fix button was: a healthy Reddit reader
    // offering to restart itself.
    if (withFix && card.fix && stateOf(card) !== "ok") {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Fix this";
      b.setAttribute("aria-label", "Fix this: " + (card.fixLabel || card.fix));
      b.addEventListener("click", function () { runAction(card.fix, b); });
      box.appendChild(b);
    }
    target.appendChild(box);
  });
}

function renderActions(actions) {
  var target = el("actions");
  target.textContent = "";
  actions.forEach(function (action) {
    var box = document.createElement("div");
    box.className = "card";
    var h = document.createElement("h3");
    h.textContent = action.label;
    var p = document.createElement("p");
    p.textContent = action.explain;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.dataset.action = action.id;
    if (action.danger) b.className = "danger";
    b.addEventListener("click", function () { runAction(action.id, b); });
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(b);
    target.appendChild(box);
  });
}

function renderLinks(links) {
  var target = el("links");
  target.textContent = "";
  links.forEach(function (link) {
    var a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.label;
    target.appendChild(a);
  });
}

/** Visible feedback in the same frame: the button says so before anything awaits. */
function working(button, label) {
  if (!button) return;
  button.disabled = true;
  button.textContent = label;
}
function unwrap(button, label) {
  if (!button) return;
  button.disabled = false;
  button.textContent = label;
}

function runAction(id, button) {
  var label = button ? button.textContent : "";
  working(button, "Working...");
  fetch("/api/action/" + encodeURIComponent(id), {
    method: "POST",
    headers: { "content-type": "application/json", "x-control-token": TOKEN },
    body: JSON.stringify(id === "stop-all" ? { confirm: "offline" } : {}),
  })
    .then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          el("output").textContent += "\\n" + text;
          unwrap(button, label);
          return null;
        }
        return true;
      });
    })
    .then(function (started) {
      if (started) pollOutput(button, label);
    })
    .catch(function (err) {
      el("output").textContent += "\\nThe request did not go through: " + err;
      unwrap(button, label);
    });
}

function pollOutput(button, label) {
  var since = 0;
  el("output").textContent = "";
  var timer = setInterval(function () {
    fetch("/api/action/output?since=" + since)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.lines && data.lines.length) {
          since = data.next;
          data.lines.forEach(function (line) {
            el("output").textContent += (el("output").textContent ? "\\n" : "") + line;
          });
        }
        if (data.done) {
          clearInterval(timer);
          unwrap(button, label);
          loadStatus(true);
        }
      })
      .catch(function () {
        clearInterval(timer);
        unwrap(button, label);
      });
  }, 700);
}

function loadStatus(force) {
  return fetch("/api/status" + (force ? "?refresh=1" : ""))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      lastChecked = Date.now();
      var h = el("headline");
      h.textContent = data.attention > 0 ? data.attention + (data.attention === 1 ? " thing needs attention" : " things need attention") : "Everything is up";
      h.className = "headline " + (data.attention > 0 ? (data.attention > 2 ? "bad" : "warn") : "ok");
      el("advice").textContent = data.advice || "";
      var paperCards = (data.checks || []).map(function (c) {
        return { id: c.id, label: c.label, state: c.state, ok: c.ok, optional: c.optional, detail: c.detail, fix: c.fix };
      });
      // Every row is shown, healthy or not: the owner looks here to see that the
      // Reddit reader and DeepSeek are up, not only to learn when they are down.
      renderCards(el("cards"), paperCards.concat(data.extras || []), true);
    })
    .catch(function (err) {
      el("headline").textContent = "Could not read the status";
      el("headline").className = "headline bad";
      el("advice").textContent = String(err);
    });
}

function tick() {
  var s = Math.round((Date.now() - lastChecked) / 1000);
  el("checked").textContent = "checked " + (s < 2 ? "just now" : s + " seconds ago") + ", refreshing every " + (POLL_MS / 1000) + " seconds";
}

el("cancel").addEventListener("click", function () { el("dialog").classList.remove("open"); });
el("confirm").addEventListener("click", function () {
  el("dialog").classList.remove("open");
  var button = document.querySelector('button[data-action="stop-all"]');
  runAction("stop-all", button);
});

fetch("/api/actions")
  .then(function (r) { return r.json(); })
  .then(function (data) {
    renderActions(data.actions || []);
    renderLinks(data.links || []);
    // The dialog is the page's half of stop-all's confirm; the server asks for
    // the same word, so a POST forged past this dialog is still refused.
    var stop = document.querySelector('button[data-action="stop-all"]');
    if (stop) {
      var replacement = stop.cloneNode(true);
      stop.parentNode.replaceChild(replacement, stop);
      replacement.addEventListener("click", function () { el("dialog").classList.add("open"); });
    }
  });

loadStatus(false);
setInterval(function () { loadStatus(false); }, POLL_MS);
setInterval(tick, 1000);
tick();
</script>
</body>
</html>
`;
}

/* ─────────────────────────── main ─────────────────────────── */

export async function main() {
  const server = createControlServer({});
  const address = await server.listen();
  console.log(`TownReporter Control on http://127.0.0.1:${address.port}`);
  console.log(`pid ${process.pid}; it exits by itself after ${Math.round(IDLE_MS / 60000)} minutes with no requests.`);
  const bye = () => {
    server.removePid();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Control could not start: ${error?.message || error}`);
    process.exit(1);
  });
}
