import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { getSql } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";
import { DEFAULT_NEWSROOM_ID } from "@/lib/news/membership";
import {
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
        value: `${size[0]?.name ?? "?"} · ${size[0]?.size ?? "?"} · answered in ${ms}ms`,
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
    const rows = await sql<{ status: string; n: number; oldest: string | null }>`
      select status, count(*)::int as n, min(created_at)::text as oldest
      from desk_jobs group by status
    `;
    const by = new Map(rows.map((r) => [r.status, r]));
    const running = by.get("running")?.n ?? 0;
    const queued = by.get("queued")?.n ?? 0;
    const failed = by.get("failed")?.n ?? 0;
    const oldestRunning = by.get("running")?.oldest;
    const oldestMs = oldestRunning ? Date.now() - new Date(oldestRunning).getTime() : 0;
    return [
      {
        id: "jobs",
        label: "Work queue",
        state: jobsState(running, failed, oldestMs),
        value: `${running} running · ${queued} queued · ${failed} failed`,
        note: running && oldestRunning ? `oldest started ${formatAgo(oldestRunning)}` : "",
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

/**
 * Does a reader's browser touch anyone but this server?
 *
 * A standing check rather than a one-off audit: the beacon and the Google font
 * links were both invisible until someone looked at the served HTML, and both
 * could come back through a setting nobody remembers changing.
 */
async function checkThirdParty(): Promise<HealthCheck[]> {
  /*
    Same fallback as every other place that needs the public origin.

    Reading only `PUBLIC_SITE_URL` meant this check silently returned nothing on
    a deployment configured with `BETTER_AUTH_URL` instead — the row simply was
    not on the page, which reads as "no problems" rather than "not checked".
  */
  const site = (process.env.PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || "").trim();
  if (!site) {
    return [
      {
        id: "third-party",
        label: "Reader privacy",
        state: "unknown",
        value: "no public address configured",
        note: "Set PUBLIC_SITE_URL or BETTER_AUTH_URL and this checks itself.",
      },
    ];
  }
  try {
    const res = await fetch(site, {
      headers: {
        // The injections only happen for browser-shaped requests. A plain fetch
        // comes back clean and would report a false all-clear.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    const origin = new URL(site).origin;
    /*
      Only what the browser fetches on its own.

      The first version matched every `src` and `href`, so it counted the law
      firm page cited inside a story as a privacy problem. A link a reader
      chooses to click is journalism; a script, stylesheet, font or image the
      page pulls in without asking is the thing being watched for. `<a href>`
      is deliberately not in this list.
    */
    const hosts = new Set<string>();
    const autoLoaded = [
      /<script[^>]*src="(https?:\/\/[^"]+)"/gi,
      /<link[^>]*href="(https?:\/\/[^"]+)"/gi,
      /<img[^>]*src="(https?:\/\/[^"]+)"/gi,
      /<iframe[^>]*src="(https?:\/\/[^"]+)"/gi,
      /<video[^>]*src="(https?:\/\/[^"]+)"/gi,
      /<source[^>]*src="(https?:\/\/[^"]+)"/gi,
    ];
    for (const re of autoLoaded) {
      for (const m of html.matchAll(re)) {
        try {
          const u = new URL(m[1]!);
          if (u.origin !== origin) hosts.add(u.hostname);
        } catch {
          /* not a URL */
        }
      }
    }
    const list = [...hosts];
    return [
      {
        id: "third-party",
        label: "Reader privacy",
        state: list.length ? "warn" : "ok",
        value: list.length
          ? `${list.length} outside host${list.length === 1 ? "" : "s"} loaded by the front page`
          : "no outside requests",
        note: list.join(", "),
      },
    ];
  } catch {
    return [{ id: "third-party", label: "Reader privacy", state: "unknown", value: "could not check" }];
  }
}

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
    checkThirdParty(),
  ]);
  return {
    checks: groups.flat(),
    logs: await readLogs(),
    host: os.hostname(),
    takenAt: new Date().toISOString(),
  };
}
