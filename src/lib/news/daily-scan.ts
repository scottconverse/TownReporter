import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../db.ts";
import { deskMiddleware, assertOwner } from "./desk-auth.ts";
import { getPaperConfig } from "./paper-settings.ts";

export type DailyScanRuntime = "local" | "claude-cli" | "codex-terra" | "codex-sol";
export type DailyScanPolicy = {
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  localTime: string;
  timezone: string;
  runtime: DailyScanRuntime;
  sourceCap: number;
  selectedSourceIds: number[];
  revision: number;
  updatedAt: string | null;
  lastLocalDay: string | null;
  nextRunAt: string | null;
  openRun: null | { runId: number; jobId: number; localDay: string; status: "queued" | "running" };
  lastRun: null | {
    runId: number;
    jobId: number | null;
    localDay: string;
    status: "queued" | "running" | "completed" | "failed";
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  };
};
export type SaveDailyScanPolicyInput = {
  enabled: boolean;
  localTime: string;
  runtime: DailyScanRuntime;
  sourceCap: number;
  selectedSourceIds: number[];
  expectedRevision: number;
};
type CleanDailyScanPolicyInput = SaveDailyScanPolicyInput & { invalidError?: string };
export type DailyScanPolicyResult =
  | { ok: true; policy: DailyScanPolicy }
  | {
      ok: false;
      error: string;
      code:
        | "forbidden"
        | "conflict"
        | "invalid-config"
        | "source-limit"
        | "foreign-source"
        | "provider-unavailable";
    };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RUNTIMES = new Set(["local", "claude-cli", "codex-terra", "codex-sol"]);
const CAP = 12;

export function cleanDailyScanPolicyInput(raw: unknown): CleanDailyScanPolicyInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourceIds = Array.isArray(value.selectedSourceIds) ? value.selectedSourceIds : [];
  const input: CleanDailyScanPolicyInput = {
    enabled: value.enabled === true,
    localTime: typeof value.localTime === "string" ? value.localTime.trim() : "",
    runtime: typeof value.runtime === "string" ? (value.runtime as DailyScanRuntime) : "local",
    sourceCap: typeof value.sourceCap === "number" ? value.sourceCap : Number.NaN,
    selectedSourceIds: sourceIds.filter((id): id is number => typeof id === "number"),
    expectedRevision:
      typeof value.expectedRevision === "number" ? value.expectedRevision : Number.NaN,
  };
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.localTime !== "string" ||
    typeof value.runtime !== "string" ||
    typeof value.sourceCap !== "number" ||
    !Array.isArray(value.selectedSourceIds) ||
    input.selectedSourceIds.length !== sourceIds.length ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    input.invalidError = "The daily scan settings were malformed. Refresh and try again.";
  return input;
}

export async function persistDailyScanPolicy(
  sql: Sql,
  newsroomId: number,
  userId: string,
  data: SaveDailyScanPolicyInput,
  selectedSourceIds: number[],
): Promise<boolean> {
  const params = [
    newsroomId,
    data.enabled,
    data.localTime,
    data.runtime,
    data.sourceCap,
    JSON.stringify(selectedSourceIds),
    userId,
  ];
  const rows =
    data.expectedRevision === 0
      ? await sql.query(
          "insert into daily_scan_policies(newsroom_id,enabled,paused,pause_reason,local_time,runtime,source_cap,selected_source_ids,revision,updated_at,configured_by_user_id) values($1,$2,false,null,$3,$4,$5,$6::jsonb,1,now(),$7) on conflict(newsroom_id) do nothing returning revision",
          params,
        )
      : await sql.query(
          "update daily_scan_policies set enabled=$2,local_time=$3,runtime=$4,source_cap=$5,selected_source_ids=$6::jsonb,configured_by_user_id=$7,paused=case when $2 then paused else false end,pause_reason=case when $2 then pause_reason else null end,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$8 returning revision",
          [...params, data.expectedRevision],
        );
  return Boolean(rows[0]);
}

function localParts(date: Date, timezone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}
export function nextDailyOccurrence(timezone: string, localTime: string, now: Date): Date {
  if (!TIME_RE.test(localTime)) throw new Error("Time must use 24-hour HH:MM.");
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now);
  let c = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const start = localParts(c, timezone);
  const day = start.day;
  const sameDayEligible = start.time <= localTime;
  for (let i = 0; i <= 4320; i++, c = new Date(c.getTime() + 60000)) {
    const l = localParts(c, timezone);
    if (sameDayEligible && l.day === day && l.time >= localTime) return c;
    if (l.day > day && l.time >= localTime) return c;
  }
  throw new Error("Could not resolve the next scheduled time.");
}

export function nextEligibleDailyOccurrence(
  timezone: string,
  localTime: string,
  now: Date,
  reservedLocalDay: string | null,
): Date {
  const localNow = localParts(now, timezone);
  if (reservedLocalDay !== localNow.day && localNow.time >= localTime) return now;
  let candidate = nextDailyOccurrence(timezone, localTime, now);
  if (reservedLocalDay && localParts(candidate, timezone).day === reservedLocalDay) {
    candidate = nextDailyOccurrence(timezone, localTime, new Date(candidate.getTime() + 60_000));
  }
  return candidate;
}

export async function readDailyScanPolicy(
  newsroomId: number,
  now = new Date(),
): Promise<DailyScanPolicy> {
  const sql = await getSql();
  const paper = await getPaperConfig(newsroomId);
  const [p] = await sql.query<any>("select * from daily_scan_policies where newsroom_id=$1", [
    newsroomId,
  ]);
  const [r] = await sql.query<any>(
    "select r.*,j.status as job_status,j.error as job_error from daily_scan_reservations r left join desk_jobs j on j.id=r.desk_job_id where r.newsroom_id=$1 order by r.local_day desc limit 1",
    [newsroomId],
  );
  const enabled = p?.enabled === true,
    paused = p?.paused === true,
    localTime = p?.local_time ?? "06:00";
  const last = r
    ? {
        runId: r.scan_run_id,
        jobId: r.desk_job_id ?? null,
        localDay: String(r.local_day),
        status: r.job_status ?? r.status,
        error: r.job_error ?? r.error ?? null,
        createdAt: String(r.created_at),
        finishedAt: r.finished_at ? String(r.finished_at) : null,
      }
    : null;
  const lastLocalDay = r ? String(r.local_day) : null;
  return {
    enabled,
    paused,
    pauseReason: p?.pause_reason ?? null,
    localTime,
    timezone: paper.timezone,
    runtime: p?.runtime ?? "local",
    sourceCap: p?.source_cap ?? CAP,
    selectedSourceIds: p?.selected_source_ids ?? [],
    revision: p?.revision ?? 0,
    updatedAt: p?.updated_at ? String(p.updated_at) : null,
    lastLocalDay,
    nextRunAt:
      enabled && !paused
        ? nextEligibleDailyOccurrence(paper.timezone, localTime, now, lastLocalDay).toISOString()
        : null,
    openRun:
      last && (last.status === "queued" || last.status === "running")
        ? { runId: last.runId, jobId: last.jobId!, localDay: last.localDay, status: last.status }
        : null,
    lastRun: last,
  };
}

export const getDailyScanPolicy = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<DailyScanPolicyResult> => {
    try {
      assertOwner(context.role);
      return { ok: true, policy: await readDailyScanPolicy(context.newsroomId) };
    } catch (e) {
      return {
        ok: false,
        code: "forbidden",
        error: e instanceof Error ? e.message : "Only the owner can do that.",
      };
    }
  });
export const saveDailyScanPolicy = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((x: unknown) => cleanDailyScanPolicyInput(x))
  .handler(async ({ context, data }): Promise<DailyScanPolicyResult> => {
    try {
      assertOwner(context.role);
    } catch (e) {
      return {
        ok: false,
        code: "forbidden",
        error: e instanceof Error ? e.message : "Only the owner can do that.",
      };
    }
    if (data.invalidError) return { ok: false, code: "invalid-config", error: data.invalidError };
    if (
      !TIME_RE.test(data.localTime) ||
      !RUNTIMES.has(data.runtime) ||
      !Number.isInteger(data.sourceCap) ||
      data.sourceCap < 1 ||
      data.sourceCap > 12
    )
      return {
        ok: false,
        code: "invalid-config",
        error: "Choose a valid time, runtime, and source limit from 1 to 12.",
      };
    const ids = [...new Set(data.selectedSourceIds.filter(Number.isInteger))];
    if (ids.length !== data.selectedSourceIds.length)
      return {
        ok: false,
        code: "invalid-config",
        error: "Source selections must be unique source IDs.",
      };
    if (ids.length > data.sourceCap)
      return {
        ok: false,
        code: "source-limit",
        error: `You selected ${ids.length} sources; the visible limit is ${data.sourceCap}.`,
      };
    const sql = await getSql();
    const owned = ids.length
      ? await sql.query(
          "select id from sources where newsroom_id=$1 and status='accepted' and id=any($2::int[])",
          [context.newsroomId, ids],
        )
      : [];
    if (owned.length !== ids.length)
      return {
        ok: false,
        code: "foreign-source",
        error: "Every selected source must be accepted by this newsroom.",
      };
    if (data.enabled && !ids.length)
      return {
        ok: false,
        code: "invalid-config",
        error: "Select at least one accepted source before enabling the daily scan.",
      };
    if (data.enabled)
      try {
        await (
          await import("./daily-scan.server.ts")
        ).validateDailyRuntime(context.newsroomId, data.runtime);
      } catch (e) {
        return {
          ok: false,
          code: "provider-unavailable",
          error: e instanceof Error ? e.message : "The selected runtime is unavailable.",
        };
      }
    if (!(await persistDailyScanPolicy(sql, context.newsroomId, context.userId, data, ids)))
      return {
        ok: false,
        code: "conflict",
        error: "The schedule changed in another window. Refresh and try again.",
      };
    return { ok: true, policy: await readDailyScanPolicy(context.newsroomId) };
  });
async function pause(
  context: { role: string; newsroomId: number },
  revision: number,
  value: boolean,
): Promise<DailyScanPolicyResult> {
  try {
    assertOwner(context.role);
  } catch (e) {
    return {
      ok: false,
      code: "forbidden",
      error: e instanceof Error ? e.message : "Only the owner can do that.",
    };
  }
  const sql = await getSql();
  if (!value) {
    const [current] = await sql.query<{ runtime: DailyScanRuntime }>(
      "select runtime from daily_scan_policies where newsroom_id=$1 and revision=$2",
      [context.newsroomId, revision],
    );
    if (!current)
      return {
        ok: false,
        code: "conflict",
        error: "The schedule changed in another window. Refresh and try again.",
      };
    try {
      await (
        await import("./daily-scan.server.ts")
      ).validateDailyRuntime(context.newsroomId, current.runtime);
    } catch (e) {
      return {
        ok: false,
        code: "provider-unavailable",
        error: e instanceof Error ? e.message : "The selected runtime is unavailable.",
      };
    }
  }
  const rows = await sql.query(
    "update daily_scan_policies set paused=$1,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$3 and revision=$4 returning revision",
    [value, value ? "Paused by the owner." : null, context.newsroomId, revision],
  );
  if (!rows[0])
    return {
      ok: false,
      code: "conflict",
      error: "The schedule changed in another window. Refresh and try again.",
    };
  return { ok: true, policy: await readDailyScanPolicy(context.newsroomId) };
}
function cleanExpectedRevision(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    expectedRevision:
      typeof value.expectedRevision === "number" ? value.expectedRevision : Number.NaN,
  };
}
export const pauseDailyScan = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(cleanExpectedRevision)
  .handler(({ context, data }) =>
    Number.isInteger(data.expectedRevision) && data.expectedRevision >= 0
      ? pause(context, data.expectedRevision, true)
      : Promise.resolve({
          ok: false as const,
          code: "invalid-config" as const,
          error: "The policy revision is invalid.",
        }),
  );
export const resumeDailyScan = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(cleanExpectedRevision)
  .handler(({ context, data }) =>
    Number.isInteger(data.expectedRevision) && data.expectedRevision >= 0
      ? pause(context, data.expectedRevision, false)
      : Promise.resolve({
          ok: false as const,
          code: "invalid-config" as const,
          error: "The policy revision is invalid.",
        }),
  );
