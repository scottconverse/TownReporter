import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { getDbSource, getSql } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";
import { DEFAULT_NEWSROOM_ID } from "@/lib/news/membership";
import {
  databaseValue,
  diskState,
  formatAgo,
  formatBytes,
  formatIn,
  formatUptime,
  jobsState,
  publicState,
  watchdogState,
  type HealthCheck,
} from "./health";

const run = promisify(execFile);

/**
 * Read the machine's state for the ops dashboard.
 *
 * Every probe is wrapped: a dashboard whose job is to tell you what is broken
 * must never be the thing that is broken. A collector that throws contributes
 * an "unknown" row and the page still renders.
 *
 * PowerShell is invoked with a fixed argument array and never a composed
 * command string, and nothing a caller supplies reaches it.
 */
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

async function powershell(script: string, timeoutMs = 15_000): Promise<string> {
  const { stdout } = await run("powershell.exe", [...PS_ARGS, script], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

const isWindows = process.platform === "win32";

/** The app's own directory, whatever it was started from. */
export function appRoot(): string {
  return process.cwd();
}

async function checkApp(): Promise<HealthCheck[]> {
  const mem = process.memoryUsage();
  return [
    {
      id: "app-version",
      label: "Paper",
      state: "ok",
      value: `v${APP_VERSION} on Node ${process.versions.node}`,
    },
    {
      id: "app-uptime",
      label: "Running for",
      state: "ok",
      value: formatUptime(process.uptime()),
      note: `${formatBytes(mem.rss)} in memory`,
    },
  ];
}

async function checkDatabase(): Promise<HealthCheck[]> {
  try {
    const sql = await getSql();
    /*
      Warm the connection before timing anything.

      The first query after a restart carries the pool's connect handshake, and
      timing that reported "answered in 15218ms" on a database that was
      perfectly healthy — a number that would send an operator hunting a
      problem that does not exist. Time a trivial query on an open connection
      instead; that is the reading that means something.
    */
    await sql`select 1`;
    const started = Date.now();
    await sql`select 1`;
    const ms = Date.now() - started;
    const size = await sql<{ size: string; name: string }>`
      select pg_size_pretty(pg_database_size(current_database())) as size,
             current_database() as name
    `;
    const counts = await sql<{ leads: number; drafts: number; articles: number; sources: number }>`
      select
        (select count(*) from leads where newsroom_id = ${DEFAULT_NEWSROOM_ID}) as leads,
        (select count(*) from drafts) as drafts,
        (select count(*) from articles where status = 'published') as articles,
        (select count(*) from sources where newsroom_id = ${DEFAULT_NEWSROOM_ID}) as sources
    `;
    const c = counts[0];
    return [
      {
        id: "db",
        label: "Database",
        state: ms > 250 ? "warn" : "ok",
        value: databaseValue(getDbSource() === "pglite", size[0]?.name, size[0]?.size, ms),
      },
      {
        id: "db-rows",
        label: "Contents",
        state: "ok",
        value: `${c?.articles ?? 0} published · ${c?.drafts ?? 0} drafts · ${c?.leads ?? 0} leads · ${c?.sources ?? 0} sources`,
      },
    ];
  } catch (err) {
    return [
      {
        id: "db",
        label: "Database",
        state: "down",
        value: "not answering",
        note: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
      },
    ];
  }
}

async function checkJobs(): Promise<HealthCheck[]> {
  try {
    const sql = await getSql();
    /*
      Broken out by lane, status and kind rather than just status: since
      ENG-105 split the drainer into an `editorial` lane and a `default`
      lane, a bare "N queued" no longer tells the operator anything true
      about why the pile is not moving -- a queued Scan is NOT waiting on a
      running editorial any more, that is the whole point of the fix. What
      it may be waiting on is the `default` lane's own concurrency (2 at a
      time). This is what turns a bare "Queued" into a reason.
    */
    const rows = await sql<{ lane: string; status: string; kind: string; n: number; oldest: string | null }>`
      select coalesce(lane, 'default') as lane, status, kind, count(*)::int as n,
             min(created_at)::text as oldest
      from desk_jobs
      where status in ('queued', 'running', 'failed')
      group by coalesce(lane, 'default'), status, kind
    `;
    const running = rows.filter((r) => r.status === "running").reduce((a, r) => a + r.n, 0);
    const queued = rows.filter((r) => r.status === "queued").reduce((a, r) => a + r.n, 0);
    const failed = rows.filter((r) => r.status === "failed").reduce((a, r) => a + r.n, 0);
    const runningRows = rows.filter((r) => r.status === "running");
    const oldestRunning = runningRows
      .map((r) => r.oldest)
      .filter((v): v is string => Boolean(v))
      .sort()[0];
    const oldestMs = oldestRunning ? Date.now() - new Date(oldestRunning).getTime() : 0;

    // Name what a queued job in each lane is actually behind -- the running
    // kind(s) occupying that SAME lane's concurrency, never the other lane's.
    const waitNotes: string[] = [];
    for (const lane of ["editorial", "default"] as const) {
      const laneQueued = rows.some((r) => r.lane === lane && r.status === "queued");
      if (!laneQueued) continue;
      const laneRunningKinds = runningRows.filter((r) => r.lane === lane).map((r) => r.kind);
      waitNotes.push(
        laneRunningKinds.length
          ? `${lane} queue waiting on ${laneRunningKinds.join(", ")}`
          : `${lane} queue waiting for its turn`,
      );
    }

    return [
      {
        id: "jobs",
        label: "Work queue",
        state: jobsState(running, failed, oldestMs),
        value: `${running} running · ${queued} queued · ${failed} failed`,
        note: [running && oldestRunning ? `oldest started ${formatAgo(oldestRunning)}` : "", ...waitNotes]
          .filter(Boolean)
          .join(" · "),
      },
    ];
  } catch {
    return [{ id: "jobs", label: "Work queue", state: "unknown", value: "could not read" }];
  }
}

async function checkTunnel(): Promise<HealthCheck[]> {
  if (!isWindows) {
    return [{ id: "tunnel", label: "Tunnel", state: "unknown", value: "not a Windows host" }];
  }
  /*
    Only the install that owns the tunnel gets a real answer.

    cloudflared.exe is counted machine-wide, and this machine runs the live
    paper and a development copy side by side -- so the dev instance's Server
    page reported production's tunnel as its own, "running (2 processes) OK",
    and offered a Restart button pointed at the live paper's route to the
    internet. The release walkthrough caught it. An install now claims the
    tunnel with TOWNREPORTER_TUNNEL=1 in its environment; every other
    install says plainly that the tunnel is not its to watch or touch.
  */
  if (process.env.TOWNREPORTER_TUNNEL !== "1") {
    return [
      {
        id: "tunnel",
        label: "Cloudflare tunnel",
        state: "unknown",
        value: "not managed by this install",
        note: "Set TOWNREPORTER_TUNNEL=1 in the install that owns the tunnel.",
      },
    ];
  }
  try {
    const out = await powershell(
      "@(Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" -ErrorAction SilentlyContinue).Count",
    );
    const n = Number(out) || 0;
    return [
      {
        id: "tunnel",
        label: "Cloudflare tunnel",
        state: n > 0 ? "ok" : "down",
        value: n > 0 ? `running (${n} process${n === 1 ? "" : "es"})` : "not running",
        note: n > 0 ? "" : "The paper is unreachable from the internet until this is up.",
      },
    ];
  } catch (err) {
    return [
      {
        id: "tunnel",
        label: "Cloudflare tunnel",
        state: "unknown",
        value: "could not check",
        note: err instanceof Error ? err.message.slice(0, 160) : "",
      },
    ];
  }
}

async function checkWatchdog(): Promise<HealthCheck[]> {
  if (!isWindows) {
    return [{ id: "watchdog", label: "Watchdog", state: "unknown", value: "not a Windows host" }];
  }
  try {
    const out = await powershell(
      "$i = Get-ScheduledTaskInfo -TaskName 'TownReporter Watchdog' -ErrorAction Stop; " +
        "\"$($i.LastRunTime.ToString('o'))|$($i.LastTaskResult)|$($i.NextRunTime.ToString('o'))\"",
    );
    const [lastRun, resultRaw, next] = out.split("|");
    const result = Number(resultRaw);
    const state = watchdogState(lastRun || null, Number.isFinite(result) ? result : null);
    return [
      {
        id: "watchdog",
        label: "Watchdog",
        state,
        value: `ran ${formatAgo(lastRun)}${result === 0 ? "" : ` · exit ${resultRaw}`}`,
        note: next ? `next run ${formatIn(next)}` : "",
      },
    ];
  } catch {
    return [
      {
        id: "watchdog",
        label: "Watchdog",
        state: "down",
        value: "task not found",
        note: "Nothing is watching. Restart it from ops/install-tasks.ps1.",
      },
    ];
  }
}

async function checkDisk(): Promise<HealthCheck[]> {
  if (!isWindows) return [];
  try {
    const out = await powershell(
      "(Get-PSDrive -Name C).Free.ToString() + '|' + ((Get-PSDrive -Name C).Used.ToString())",
    );
    const [freeRaw, usedRaw] = out.split("|");
    const free = Number(freeRaw);
    const used = Number(usedRaw);
    return [
      {
        id: "disk",
        label: "Disk",
        state: diskState(free),
        value: `${formatBytes(free)} free of ${formatBytes(free + used)}`,
        note: diskState(free) === "ok" ? "" : "Postgres stops accepting writes when this runs out.",
      },
    ];
  } catch {
    return [{ id: "disk", label: "Disk", state: "unknown", value: "could not read" }];
  }
}

/**
 * Does the paper answer on its public address?
 *
 * Measured from this machine, so it proves the tunnel and Cloudflare are
 * routing — it does not prove a reader in another town can reach it, and the
 * dashboard says so rather than implying more than it knows.
 */
async function checkPublic(): Promise<HealthCheck[]> {
  const site = (process.env.PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || "").trim();
  if (!site) {
    return [{ id: "public", label: "Public site", state: "unknown", value: "no address configured" }];
  }
  const started = Date.now();
  try {
    const res = await fetch(site, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    return [
      {
        id: "public",
        label: "Public site",
        state: publicState(res.status, ""),
        value: `${site} answered ${res.status} in ${ms}ms`,
        note: "Checked from this machine, so it proves the tunnel is routing — not that every reader can reach it.",
      },
    ];
  } catch (err) {
    return [
      {
        id: "public",
        label: "Public site",
        state: "down",
        value: `${site} did not answer`,
        note: err instanceof Error ? err.message.slice(0, 160) : "",
      },
    ];
  }
}

/*
  The Reader privacy row is gone, deliberately.

  It fetched the front page and grepped the HTML for outside hosts in
  script/link/img/iframe/video/source tags. Two problems, and the second is
  the one that matters.

  First, it was broken. Six of its patterns carried a literal backspace byte
  (0x08) where a word boundary was meant, so nothing could ever match and the
  row reported "no outside requests" unconditionally, whatever was on the page.
  An audit found it. No test would have, because the row had none.

  Second, and the reason it was removed rather than repaired: even working, it
  only ever saw hard-coded tags in static HTML. A tracker injected by
  JavaScript at runtime -- which is how trackers usually arrive -- was
  invisible to it. The row read as a guarantee and was a spot-check of the
  weakest kind. A gauge that can only say "fine" is worse than no gauge.

  The claim itself is true and still enforced elsewhere: checkReaderPrivacy()
  in scripts/smoke-built-server.mjs loads the front page in a real browser,
  counts every request it makes, and fails if any of them leaves this origin.
  That runs in CI against both the built server and the dev server. One honest
  check beats an honest one plus a flattering one.
*/

export type LogTail = { name: string; path: string; lines: string[]; error?: string };

/** The last few lines of the logs an operator actually reads. */
export async function readLogs(perFile = 12): Promise<LogTail[]> {
  const dir = join(appRoot(), "logs");
  const wanted = [
    { name: "Watchdog", file: "watchdog.log" },
    { name: "Paper (errors)", file: "app.err.log" },
    { name: "Paper (output)", file: "app.out.log" },
    { name: "Tunnel", file: "cloudflared.err.log" },
  ];
  const out: LogTail[] = [];
  for (const w of wanted) {
    const path = join(dir, w.file);
    try {
      await stat(path);
      const text = await readFile(path, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      out.push({ name: w.name, path, lines: lines.slice(-perFile) });
    } catch {
      out.push({ name: w.name, path, lines: [], error: "not written yet" });
    }
  }
  return out;
}

export type OpsHealth = {
  checks: HealthCheck[];
  logs: LogTail[];
  host: string;
  takenAt: string;
};

export async function collectHealth(): Promise<OpsHealth> {
  // Independent probes, so run them together; each already swallows its own
  // failure into an "unknown" row.
  const groups = await Promise.all([
    checkApp(),
    checkPublic(),
    checkTunnel(),
    checkDatabase(),
    checkJobs(),
    checkWatchdog(),
    checkDisk(),
  ]);
  return {
    checks: groups.flat(),
    logs: await readLogs(),
    host: os.hostname(),
    takenAt: new Date().toISOString(),
  };
}
