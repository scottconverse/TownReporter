import { editorWarning, type EditorWarningResult } from "./editor-override.ts";
import { createServerFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import { deskMiddleware, assertOwner } from "./desk-auth.ts";
import { getPaperConfig } from "./paper-settings.ts";
import { isCustomModelChoice, type StoryModelChoice } from "./model-choice.ts";
import {
  PICKER_PROVIDER_IDS,
  isAutomaticRungId,
  modelEffort,
  type AutomaticRungId,
  type ModelEffort,
} from "./provider-registry.ts";
import {
  selectRotation,
  unmarkedQuietInstitutions,
  type SourcePreference,
} from "./adaptive-source-selection.ts";
import { type SourceHealthFacts } from "./source-inventory.ts";

/**
 * What a daily-scan policy may store as its runtime.
 *
 * "auto" is here since 0.6.64 (Unit AA): the scheduled scan can run Automatic
 * and walks the same writing ladder a story does. A rung is still NOT here --
 * DeepSeek v4.1 Flash and the local rung are what Automatic RESOLVED to on the
 * day, which the run record names, never a hand pick an editor can store (the
 * old value was `Exclude<StoryModelChoice, "auto" | AutomaticRungId>`).
 */
export type DailyScanRuntime = Exclude<StoryModelChoice, AutomaticRungId>;
type LegacyDailyScanRuntime = "local" | "claude-cli" | "codex-terra" | "codex-sol";
export type StoredDailyScanRuntime = DailyScanRuntime | LegacyDailyScanRuntime;
export type DailyScanPolicy = {
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  localTime: string;
  timezone: string;
  runtime: DailyScanRuntime;
  modelEffort: ModelEffort | null;
  sourceCap: number;
  everyDaySourceCount: number;
  selectedSourceIds: number[];
  revision: number;
  updatedAt: string | null;
  lastLocalDay: string | null;
  nextRunAt: string | null;
  openRun: null | { runId: number; jobId: number; localDay: string; status: "queued" | "running" };
  /** Latest scan receipt, including manual scans, for both summary screens. */
  lastScan?: { sources_fetched: number; leads_created: number } | null;
  lastRun: null | {
    runId: number;
    jobId: number | null;
    localDay: string;
    status: "queued" | "running" | "completed" | "failed";
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
    failoverNote: string | null;
    /**
     * What the run was asked for and what it resolved to, read off the
     * reservation's `model_snapshot` (0.6.64, Unit AA item 6). These stay
     * `string` rather than `DailyScanRuntime`: a resolved value is normally
     * one of Automatic's own rungs, which no editor can store as a hand pick
     * and which `dailyScanRuntime` would read as "auto".
     */
    requestedRuntime: string | null;
    resolvedRuntime: string | null;
  };
};
export type SaveDailyScanPolicyInput = {
  enabled: boolean;
  localTime: string;
  runtime: DailyScanRuntime;
  modelEffort: ModelEffort | null;
  sourceCap: number;
  everyDaySourceCount: number;
  selectedSourceIds: number[];
  expectedRevision: number;
  override?: string[];
};
type CleanDailyScanPolicyInput = SaveDailyScanPolicyInput & { invalidError?: string };
export type DailyScanPolicyResult =
  | { ok: true; policy: DailyScanPolicy }
  | {
      ok: false;
      warning?: EditorWarningResult["warning"];
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
const CAP = 12;

/** Additive schema compatibility for desks that saved a schedule before the
 * daily and rotating source split was introduced. */
export async function ensureDailyScanPolicySchema(sqlInput?: Sql) {
  const sql = sqlInput ?? await getSql();
  await ensureSchemaOnce(sql, "daily-scan-fixed-source-count", [
    "alter table daily_scan_policies add column if not exists every_day_source_count integer not null default 8",
  ]);
}
/** Why a paused row says it is paused: the one reason this code writes. */
const PAUSED_BY_OWNER = "Paused by the owner.";
const LEGACY_DAILY_SCAN_RUNTIMES = new Set<string>([
  "local",
  "claude-cli",
  "codex-terra",
  "codex-sol",
]);

function validDailyScanRuntime(value: string): value is DailyScanRuntime {
  return (
    value === "auto" ||
    isCustomModelChoice(value) ||
    /*
      Unit U29: a rung is still not a runtime an editor may store, and it now
      has to be said rather than inherited from the picker list. `deepseek-flash`
      is in `PICKER_PROVIDER_IDS` because Opinion's model menu offers it by
      name, so "in the picker list" no longer means "selectable for a scan" --
      which is what this guard means, and what its declared type
      (`DailyScanRuntime`, rungs excluded) has always meant.
    */
    (!isAutomaticRungId(value) &&
      PICKER_PROVIDER_IDS.includes(value as (typeof PICKER_PROVIDER_IDS)[number]))
  );
}

function validStoredDailyScanRuntime(value: unknown): value is StoredDailyScanRuntime {
  return typeof value === "string" &&
    (validDailyScanRuntime(value) || LEGACY_DAILY_SCAN_RUNTIMES.has(value));
}

/**
 * The runtime a stored row means.
 *
 * A stored hand pick keeps its own meaning, including the legacy names an old
 * row still spells -- 0.6.64 (Unit AA) does NOT rewrite one into Automatic,
 * because that would change which model a paper runs without anyone asking.
 * Only a row with no runtime at all, or one this build no longer offers,
 * reads as "auto": the schedule's new default.
 */
export function dailyScanRuntime(value: unknown): DailyScanRuntime {
  if (value === "auto") return "auto";
  if (value === "local") return "local-model";
  if (value === "claude-cli") return "claude-sonnet";
  if (value === "codex-terra") return "codex-balanced";
  if (value === "codex-sol") return "codex-frontier";
  if (isCustomModelChoice(value)) return value;
  return validDailyScanRuntime(String(value))
    ? (value as DailyScanRuntime)
    : "auto";
}

export function cleanDailyScanPolicyInput(raw: unknown): CleanDailyScanPolicyInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourceIds = Array.isArray(value.selectedSourceIds) ? value.selectedSourceIds : [];
  const input: CleanDailyScanPolicyInput = {
    override: Array.isArray(value.override) && value.override.every(k => typeof k === "string") ? value.override : undefined,
    enabled: value.enabled === true,
    localTime: typeof value.localTime === "string" ? value.localTime.trim() : "",
    runtime: typeof value.runtime === "string" ? dailyScanRuntime(value.runtime) : "auto",
    modelEffort: null,
    sourceCap: typeof value.sourceCap === "number" ? value.sourceCap : Number.NaN,
    everyDaySourceCount:
      typeof value.everyDaySourceCount === "number"
        ? value.everyDaySourceCount
        : typeof value.sourceCap === "number"
          ? Math.max(0, Math.min(8, sourceIds.length, Math.floor(value.sourceCap)))
          : 8,
    selectedSourceIds: sourceIds.filter((id): id is number => typeof id === "number"),
    expectedRevision:
      typeof value.expectedRevision === "number" ? value.expectedRevision : Number.NaN,
  };
  input.modelEffort = modelEffort(input.runtime, value.modelEffort);
  if (value.modelEffort !== undefined && value.modelEffort !== null && input.modelEffort !== value.modelEffort) {
    input.invalidError = "Choose an effort supported by the scheduled model.";
  }
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.localTime !== "string" ||
    typeof value.runtime !== "string" ||
    !validStoredDailyScanRuntime(value.runtime) ||
    typeof value.sourceCap !== "number" ||
    (value.everyDaySourceCount !== undefined && typeof value.everyDaySourceCount !== "number") ||
    !Array.isArray(value.selectedSourceIds) ||
    input.selectedSourceIds.length !== sourceIds.length ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    input.invalidError = "The daily scan settings were malformed. Refresh and try again.";
  // The fixed set is a prefix of the saved selection. A larger count would
  // promise daily reads that the scheduled scan cannot actually perform.
  // Apply the same bound to disabled drafts, so enabling one later is safe.
  if (
    !input.invalidError &&
    (!Number.isInteger(input.everyDaySourceCount) ||
      input.everyDaySourceCount < 0 ||
      input.everyDaySourceCount > Math.min(Math.max(0,input.sourceCap), input.selectedSourceIds.length))
  ) {
    input.invalidError =
      "The daily source count must be between 0 and the smaller of the selected source count and daily limit.";
  }
  return input;
}

export async function persistDailyScanPolicy(
  sql: Sql,
  newsroomId: number,
  userId: string,
  data: SaveDailyScanPolicyInput,
  selectedSourceIds: number[],
): Promise<boolean> {
  await ensureDailyScanPolicySchema(sql);
  const params = [
    newsroomId,
    data.enabled,
    data.localTime,
    data.runtime,
    data.modelEffort,
    Math.min(CAP, data.sourceCap),
    data.everyDaySourceCount ?? UNSAVED_DAILY_SCAN_POLICY.everyDaySourceCount,
    JSON.stringify(selectedSourceIds),
    userId,
  ];
  const rows =
    data.expectedRevision === 0
      ? await sql.query(
          "insert into daily_scan_policies(newsroom_id,enabled,paused,pause_reason,local_time,runtime,model_effort,source_cap,every_day_source_count,selected_source_ids,revision,updated_at,configured_by_user_id,source_cap_override) values($1,$2,false,null,$3,$4,$5,$6,$7,$8::jsonb,1,now(),$9,$10) on conflict(newsroom_id) do nothing returning revision",
          [...params, data.sourceCap > CAP ? data.sourceCap : null],
        )
      : await sql.query(
          "update daily_scan_policies set enabled=$2,local_time=$3,runtime=$4,model_effort=$5,source_cap=$6,source_cap_override=$11,every_day_source_count=$7,selected_source_ids=$8::jsonb,configured_by_user_id=$9,paused=case when $2 then paused else false end,pause_reason=case when $2 then pause_reason else null end,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$10 returning revision",
          [...params, data.expectedRevision, data.sourceCap > CAP ? data.sourceCap : null],
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

/**
 * The two model names a scheduled run's `model_snapshot` carries.
 *
 * 0.6.64 (Unit AA) added `requestedRuntime`/`resolvedRuntime` to the receipt
 * `validateDailyRuntime` returns, so a run that resolved Automatic to a rung
 * says both. A reservation written before that has only `modelChoice`, which
 * is the resolved model under another name, and it is read here rather than
 * left blank -- an old row's run still names the model that ran.
 */
export function runSnapshotRuntimes(value: unknown): {
  requestedRuntime: string | null;
  resolvedRuntime: string | null;
} {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (entry: unknown) =>
    typeof entry === "string" && entry.trim() ? entry.trim() : null;
  return {
    requestedRuntime: text(row.requestedRuntime),
    resolvedRuntime: text(row.resolvedRuntime) ?? text(row.modelChoice),
  };
}

/**
 * The schedule a desk that has never saved one reads as.
 *
 * One place, because two writes depend on it and they have to agree:
 * `readDailyScanPolicy` answers with these values when there is no row, and
 * `setDailyScanPaused` writes them into the row it creates when the owner
 * pauses a desk whose schedule was never saved. The table's own SQL defaults
 * are deliberately NOT used for that insert -- they say `runtime 'local'`,
 * where the read says `'auto'` -- so a row built from them would quietly
 * change which model the paper runs the moment the owner enabled the scan.
 * Pausing a desk must write the schedule the desk already had, which is this.
 *
 * `revision` is here as the read's answer rather than a row's: 0 is not a
 * revision any row carries, it is what the read says when there is no row.
 */
export const UNSAVED_DAILY_SCAN_POLICY = {
  enabled: false,
  paused: false,
  pauseReason: null,
  localTime: "06:00",
  runtime: "auto",
  modelEffort: null,
  sourceCap: CAP,
  everyDaySourceCount: 8,
  selectedSourceIds: [],
  revision: 0,
} as const;

export async function readDailyScanPolicy(
  newsroomId: number,
  now = new Date(),
): Promise<DailyScanPolicy> {
  const sql = await getSql();
  await ensureDailyScanPolicySchema(sql);
  const paper = await getPaperConfig(newsroomId);
  const [p] = await sql.query<any>("select * from daily_scan_policies where newsroom_id=$1", [
    newsroomId,
  ]);
  const [r] = await sql.query<any>(
    "select r.*,j.status as job_status,j.error as job_error from daily_scan_reservations r left join desk_jobs j on j.id=r.desk_job_id where r.newsroom_id=$1 order by r.local_day desc limit 1",
    [newsroomId],
  );
  const [lastScan] = await sql.query<{ sources_fetched: number; leads_created: number }>(
    "select sources_fetched, leads_created from scan_runs where newsroom_id=$1 order by started_at desc, id desc limit 1",
    [newsroomId],
  );
  const enabled = p?.enabled === true,
    paused = p?.paused === true,
    localTime = p?.local_time ?? UNSAVED_DAILY_SCAN_POLICY.localTime;
  const last = r
    ? {
        runId: r.scan_run_id,
        jobId: r.desk_job_id ?? null,
        localDay: String(r.local_day),
        status: r.job_status ?? r.status,
        error: r.job_error ?? r.error ?? null,
        createdAt: String(r.created_at),
        finishedAt: r.finished_at ? String(r.finished_at) : null,
        failoverNote:
          r.model_snapshot && typeof r.model_snapshot === "object" && typeof r.model_snapshot.switchNote === "string"
            ? r.model_snapshot.switchNote
            : null,
        ...runSnapshotRuntimes(r.model_snapshot),
      }
    : null;
  const lastLocalDay = r ? String(r.local_day) : null;
  return {
    enabled,
    paused,
    pauseReason: p?.pause_reason ?? null,
    localTime,
    timezone: paper.timezone,
    runtime: dailyScanRuntime(p?.runtime ?? UNSAVED_DAILY_SCAN_POLICY.runtime),
    modelEffort: modelEffort(dailyScanRuntime(p?.runtime ?? UNSAVED_DAILY_SCAN_POLICY.runtime), p?.model_effort),
    sourceCap: p?.source_cap_override ?? p?.source_cap ?? UNSAVED_DAILY_SCAN_POLICY.sourceCap,
    everyDaySourceCount: p?.every_day_source_count ?? UNSAVED_DAILY_SCAN_POLICY.everyDaySourceCount,
    selectedSourceIds: p?.selected_source_ids ?? [...UNSAVED_DAILY_SCAN_POLICY.selectedSourceIds],
    revision: p?.revision ?? UNSAVED_DAILY_SCAN_POLICY.revision,
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
    lastScan: lastScan ?? null,
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
      !validDailyScanRuntime(data.runtime) ||
      !Number.isInteger(data.sourceCap) ||
      !Number.isInteger(data.everyDaySourceCount) ||
      data.everyDaySourceCount < 0 ||
      data.everyDaySourceCount > Math.max(0,data.sourceCap)
    )
      return {
        ok: false,
        code: "invalid-config",
      error: "Choose a valid time, runtime, and source limit from 1 to 12, with no more daily sources than the limit.",
      };
    const ids = [...new Set(data.selectedSourceIds.filter(Number.isInteger))];
    if (ids.length !== data.selectedSourceIds.length)
      return {
        ok: false,
        code: "invalid-config",
        error: "Source selections must be unique source IDs.",
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
        ).validateDailyRuntime(context.newsroomId, data.runtime, data.modelEffort);
      } catch (e) {
        return {
          ok: false,
          code: "provider-unavailable",
          error: e instanceof Error ? e.message : "The selected runtime is unavailable.",
        };
      }
    const saved = await saveDailyCapForEditor(context, data, () => persistDailyScanPolicy(sql, context.newsroomId, context.userId, data, ids));
    if (!saved.ok) return { ...saved, code: "source-limit" };
    if (!saved.saved)
      return {
        ok: false,
        code: "conflict",
        error: "The schedule changed in another window. Refresh and try again.",
      };
    return { ok: true, policy: await readDailyScanPolicy(context.newsroomId) };
  });
/**
 * Pause or resume the schedule, as a compare-and-swap on the revision.
 *
 * `expectedRevision` is what the caller's read said, and a row only ever
 * carries revision 1 or more (`persistDailyScanPolicy`'s insert starts it at
 * 1). So 0 is not a stale revision: it is the read's own answer for a desk
 * that has never saved a schedule at all. That case had no path here, which is
 * why Pause and Resume were refused on a fresh desk with "The schedule changed
 * in another window" -- a conflict with a row that did not exist, reported
 * against an edit nobody had made.
 *
 * Pausing such a desk creates the hold its owner asked for: the row the read
 * was already describing, plus the pause (`UNSAVED_DAILY_SCAN_POLICY` above),
 * so the schedule the paper has is unchanged and the `on conflict` still
 * refuses a caller whose 0 was stale. Resuming one writes nothing -- the desk
 * is not paused, which is the whole of what resuming asks for -- but it proves
 * no row appeared, so a stale 0 is refused there too.
 */
export async function setDailyScanPaused(
  sql: Sql,
  newsroomId: number,
  userId: string,
  value: boolean,
  expectedRevision: number,
): Promise<boolean> {
  const pauseReason = value ? PAUSED_BY_OWNER : null;
  if (expectedRevision === 0) {
    if (!value) {
      const [existing] = await sql.query<{ newsroom_id: number }>(
        "select newsroom_id from daily_scan_policies where newsroom_id=$1",
        [newsroomId],
      );
      return !existing;
    }
    const fresh = UNSAVED_DAILY_SCAN_POLICY;
    const rows = await sql.query(
      "insert into daily_scan_policies(newsroom_id,enabled,paused,pause_reason,local_time,runtime,model_effort,source_cap,selected_source_ids,revision,updated_at,configured_by_user_id) values($1,$2,true,$3,$4,$5,$6,$7,$8::jsonb,$9,now(),$10) on conflict(newsroom_id) do nothing returning revision",
      [
        newsroomId,
        fresh.enabled,
        PAUSED_BY_OWNER,
        fresh.localTime,
        fresh.runtime,
        fresh.modelEffort,
        fresh.sourceCap,
        JSON.stringify(fresh.selectedSourceIds),
        1,
        userId,
      ],
    );
    return Boolean(rows[0]);
  }
  const rows = await sql.query(
    "update daily_scan_policies set paused=$1,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$3 and revision=$4 returning revision",
    [value, pauseReason, newsroomId, expectedRevision],
  );
  return Boolean(rows[0]);
}

async function pause(
  /*
    `userId` is here for the row Pause creates on a desk that never saved a
    schedule: `configured_by_user_id` is NOT NULL, and the owner who pressed
    Pause is who configured it.
  */
  context: { role: string; newsroomId: number; userId: string },
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
  /*
    Resuming a saved schedule means a run may become due, so the model the row
    names has to be one this machine can still reach -- checked against the row
    the revision names, before anything is written. A desk with no row at all
    (revision 0) has nothing to unpause and nothing that could start running,
    so there is nothing to probe; `setDailyScanPaused` is where that caller is
    told whether a row appeared under it.
  */
  if (!value && revision > 0) {
    const [current] = await sql.query<{ runtime: StoredDailyScanRuntime; model_effort: ModelEffort | null }>(
      "select runtime,model_effort from daily_scan_policies where newsroom_id=$1 and revision=$2",
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
      ).validateDailyRuntime(
        context.newsroomId,
        dailyScanRuntime(current.runtime),
        modelEffort(dailyScanRuntime(current.runtime), current.model_effort),
      );
    } catch (e) {
      return {
        ok: false,
        code: "provider-unavailable",
        error: e instanceof Error ? e.message : "The selected runtime is unavailable.",
      };
    }
  }
  if (!(await setDailyScanPaused(sql, context.newsroomId, context.userId, value, revision)))
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

/**
 * THE DAILY ROTATION, decided here so the schedule stops reading the same fixed
 * dozen forever.
 *
 * THE PROBLEM THIS SOLVES, in one number: the accepted pool is 201 sources and
 * the policy cap is 12 a day, so reading exactly the editor's stored twelve
 * every day means a full pass takes at least 17 days AND the other 189 are never
 * read at all. Raising the cap to 201 would make one pass cost seventeen times
 * what it costs now, which is not a fix -- the schedule would still spend its
 * budget in the wrong order on the days it could afford to run.
 *
 * WHAT IT DOES INSTEAD. The editor's own selections are the schedule's floor:
 * every source they picked is read, in their order, before anything else, and
 * the stored policy is NOT overwritten. What is left of the day's budget is
 * filled from `selectRotation`, which reads the sources that are due or have
 * waited longest, honours `retry_after`/blocked (a parked row is deferred, never
 * deleted), and cannot starve the tail. The result is a run that reads the
 * editor's picks AND rotates the rest, so the pool is covered over time instead
 * of freezing.
 *
 * WHY IT IS PURE AND HERE. `daily-scan.server.ts` runs inside a transaction with
 * a network fetch loop; this decision is a sort, and pinning it offline under
 * `node --test` is how "nothing starves" and "editor control is absolute" get
 * proved without a database. The server passes facts in and takes a plan out.
 *
 * WHAT IT REFUSES TO DO. It never invents a reason to drop an accepted source
 * and never touches `selected_source_ids`; a deferred source is deferred for
 * this pass only. It also reports the freshness the plan actually buys and the
 * quiet institutions that carry no priority flag, so the screen can say the gap
 * rather than imply full coverage.
 */
export type DailyRotationPlan = {
  /** The exact source IDs this run would read, editor selections first. */
  sourceIds: number[];
  /** How the run was filled: how many were the editor's, how many rotated. */
  selectedCount: number;
  rotatedCount: number;
  /** The accepted pool the rotation chose from. */
  poolSize: number;
  /**
   * The budget the plan spent, `<= cap`. The INVARIANT, checked by the tests:
   * `sourceIds.length <= budget` always. A selected source can no longer push
   * the read set past the cap.
   */
  budget: number;
  /** Whole days a full rotation takes at this budget, floor 1. */
  fullPassDays: number;
  /** Age in days of the stalest source this pass did not read, or null. */
  stalestDeferredDays: number | null;
  /** Sources deferred this pass (over budget, parked, or blocked). */
  deferredIds: number[];
  /**
   * WHY each deferred source sat out, keyed by id, so the run record can say
   * "over budget" versus "the host asked us to wait" rather than lumping them.
   */
  deferrals: { sourceId: number; reason: "over-budget" | "parked" | "blocked" }[];
  /**
   * Editor-selected sources the automatic run did NOT read this pass because
   * they are ineligible right now (parked/blocked) or beyond the cap. Their
   * stored selection is preserved; they are named here so the desk can show
   * "your pick will run when the wait clears", never a silent unselect.
   */
  selectedDeferredIds: number[];
  /** Watch sources with no priority flag -- the quiet institutions to check. */
  unmarkedQuietIds: number[];
  /** A plain sentence for the run record and the screen. */
  note: string;
};

export type DailyRotationInput = {
  facts: readonly SourceHealthFacts[];
  /** The editor's stored selections, in order. Read first, never dropped. */
  selectedSourceIds: readonly number[];
  /** How many saved picks run every day; remaining slots rotate through the pool. */
  everyDayCount?: number;
  /** Per-source priority the editor set on the Sources screen, if any. */
  preferences?: readonly SourcePreference[];
  /** The policy's cap. Clamped to the schema's 1..12 in `clean*`; read here. */
  cap: number;
  nowMs?: number;
};

/**
 * Build the run's source set: the editor's eligible picks first, then the
 * rotation, up to `cap`. Three properties this keeps, each a fix for a real
 * defect the first cut had:

 *   1. RETRY ELIGIBILITY BEATS A STORED PICK. A selected source that is parked
 *      or blocked right now is NOT re-added to the read set -- the automatic run
 *      respects the wait. Its selection is preserved (it stays in the policy and
 *      comes back when `retry_after` clears); it is reported in
 *      `selectedDeferredIds`, so the desk can say why. A pick that must run
 *      DESPITE a wait is a separate, conscious editor action, not the stored
 *      selection this function reads.
 *   2. THE BUDGET IS A CEILING ON THE READ SET, NOT ON THE PICK LIST. When the
 *      editor has selected more sources than the cap allows, the first `budget`
 *      eligible picks run and the rest are deferred with reason `over-budget`.
 *      They are never silently unselected. `sourceIds.length <= budget` always,
 *      so the plan's "bounded" claim is true.
 *   3. FRESHNESS IS COMPUTED FROM WHAT THIS RUN ACTUALLY CHOSE AND DEFERRED,
 *      not from the internal pre-selection rotation, whose contents can differ.
 */
export function planDailySourceRotation(input: DailyRotationInput): DailyRotationPlan {
  const nowMs = input.nowMs ?? Date.now();
  const budget = Number.isFinite(input.cap) ? Math.max(0, Math.floor(input.cap)) : CAP;
  const everyDayCount =
    input.everyDayCount === undefined
      ? input.selectedSourceIds.length
      : Math.max(0, Math.min(budget, Math.floor(input.everyDayCount)));
  const byId = new Map(input.facts.map((f) => [f.id, f]));

  // The rotation over the WHOLE pool decides eligibility (who is parked/blocked)
  // and the fair order for the fill. Its own read/defer split is discarded below
  // in favour of the actual chosen set.
  const rotation = selectRotation({
    sources: input.facts,
    preferences: input.preferences,
    budget,
    nowMs,
  });
  const ineligible = new Map<number, "parked" | "blocked">();
  for (const d of rotation.deferred) {
    if (d.reason === "parked" || d.reason === "blocked") ineligible.set(d.sourceId, d.reason);
  }

  // The editor's picks, in their stored order, de-duplicated, and kept even when
  // the pool no longer contains them (that gap is reported by `selectedCount`).
  const selectedAll: number[] = [];
  const seen = new Set<number>();
  for (const id of input.selectedSourceIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    selectedAll.push(id);
  }
  const selectedInPool = (input.everyDayCount === undefined
    ? selectedAll
    : selectedAll.slice(0, everyDayCount)
  ).filter((id) => byId.has(id));
  // Eligible picks run; an ineligible pick waits for its retry (never re-added).
  const eligibleSelected = selectedInPool.filter((id) => !ineligible.has(id));

  const overBudget: number[] = [];
  const selected: number[] = [];
  for (const id of eligibleSelected) {
    if (selected.length < budget) selected.push(id);
    else overBudget.push(id);
  }
  const selectedDeferred = [
    ...selectedInPool.filter((id) => ineligible.has(id)),
    ...overBudget,
  ];

  const taken = new Set(selected);
  const remaining = Math.max(0, budget - selected.length);
  const fill = rotation.read
    .map((r) => r.sourceId)
    .filter((id) => !taken.has(id) && !ineligible.has(id))
    .slice(0, remaining);
  const sourceIds = [...selected, ...fill];

  // A source-by-source deferral map for the ACTUAL chosen set: everything the run
  // did not read, with its reason. Parked/blocked come first (they are facts), and
  // the rest are over-budget against this run's real read set.
  const chosen = new Set(sourceIds);
  const deferrals: { sourceId: number; reason: "over-budget" | "parked" | "blocked" }[] = [];
  const deferredIds = new Set<number>();
  // Parked/blocked first: a wait or a block is a fact and outranks "over budget".
  for (const [id, reason] of ineligible)
    if (!chosen.has(id)) {
      deferrals.push({ sourceId: id, reason });
      deferredIds.add(id);
    }
  // Everything else the run did not read is deferred for the budget alone.
  for (const f of input.facts)
    if (!chosen.has(f.id) && !deferredIds.has(f.id)) {
      deferrals.push({ sourceId: f.id, reason: "over-budget" });
      deferredIds.add(f.id);
    }

  const freshness = freshnessOfFromChosen(
    sourceIds,
    input.facts,
    nowMs,
    input.everyDayCount === undefined ? sourceIds.length : fill.length,
  );
  const unmarkedQuietIds = unmarkedQuietInstitutions(input.facts, input.preferences ?? [], nowMs);
  return {
    sourceIds,
    selectedCount: selected.length,
    rotatedCount: fill.length,
    poolSize: input.facts.length,
    budget,
    fullPassDays: freshness.fullPassDays,
    stalestDeferredDays: freshness.stalestDeferredDays,
    deferredIds: deferrals.map((d) => d.sourceId),
    deferrals,
    selectedDeferredIds: selectedDeferred,
    unmarkedQuietIds,
    note: dailyRotationNote({
      poolSize: input.facts.length,
      selectedCount: selected.length,
      rotatedCount: fill.length,
      budget,
      fullPassDays: freshness.fullPassDays,
      unmarkedQuietCount: unmarkedQuietIds.length,
      selectedDeferredCount: selectedDeferred.length,
    }),
  };
}

/**
 * One sentence, in the editor's language, that says what the run will do and
 * what it will not cover. Kept plain on purpose: no percentage that implies a
 * promise the schedule cannot keep.
 */
export function dailyRotationNote(input: {
  poolSize: number;
  selectedCount: number;
  rotatedCount: number;
  budget: number;
  fullPassDays: number;
  unmarkedQuietCount: number;
  selectedDeferredCount?: number;
}): string {
  if (input.poolSize === 0) return "No accepted sources to read.";
  const parts: string[] = [];
  parts.push(
    input.selectedCount
      ? `Reading your ${input.selectedCount} selected source${input.selectedCount === 1 ? "" : "s"} first`
      : "Reading the daily rotation",
  );
  if (input.selectedDeferredCount)
    parts.push(
      `${input.selectedDeferredCount} of your selections wait${input.selectedDeferredCount === 1 ? "s" : ""} for its retry or the next pass`,
    );
  if (input.rotatedCount)
    parts.push(
      `then ${input.rotatedCount} from the rotation of ${input.poolSize}`,
    );
  parts.push(`a full pass takes about ${input.fullPassDays} day${input.fullPassDays === 1 ? "" : "s"} at this rate`);
  if (input.unmarkedQuietCount)
    parts.push(
      `${input.unmarkedQuietCount} quiet source${input.unmarkedQuietCount === 1 ? "" : "s"} carry no priority flag`,
    );
  return `${parts.join("; ")}.`;
}

/**
 * FRESHNESS FROM THE ACTUAL CHOSEN SET, not from the internal rotation.
 *
 * `freshnessOf` in the selection module describes the rotation's own read set,
 * which is computed BEFORE the editor's picks are merged in -- so its counts can
 * describe different IDs than the run will really read. This derives the same
 * figures from the IDs this plan actually chose, so the "days a full pass takes"
 * and "stalest source this pass skipped" the run records are true of the run.
 */
export function freshnessOfFromChosen(
  chosenIds: readonly number[],
  facts: readonly SourceHealthFacts[],
  nowMs: number,
  rotatingCount = chosenIds.length,
): { fullPassDays: number; stalestDeferredDays: number | null } {
  const chosen = new Set(chosenIds);
  let stalest: number | null = null;
  for (const fact of facts) {
    if (chosen.has(fact.id)) continue;
    const at = fact.last_ok_at ? Date.parse(fact.last_ok_at) : Number.NaN;
    if (!Number.isFinite(at)) continue;
    const days = Math.floor((nowMs - at) / 86_400_000);
    if (stalest == null || days > stalest) stalest = days;
  }
  return {
    fullPassDays:
      facts.length <= chosenIds.length
        ? 1
        : rotatingCount > 0
          ? Math.max(
              1,
              Math.ceil((facts.length - (chosenIds.length - rotatingCount)) / rotatingCount),
            )
          : Number.POSITIVE_INFINITY,
    stalestDeferredDays: stalest,
  };
}

/** The chosen limit is stored intact after a warned second press. */
export async function saveDailyCapForEditor(context: { userId: string; newsroomId: number }, data: SaveDailyScanPolicyInput, save: () => Promise<boolean>) {
  if (data.sourceCap < 1 || data.sourceCap > CAP) {
    const warning = await editorWarning(context, data.override, "daily-source-cap", `The daily scan limit is ${data.sourceCap} sources; the usual range is 1 to 12. It may cost more.`, { kind: "newsroom", id: context.newsroomId });
    if (warning) return warning;
  }
  return { ok: true as const, saved: await save() };
}
