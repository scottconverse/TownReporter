import { createServerOnlyFn } from "@tanstack/react-start";
import { getSql, withTransaction, type Sql } from "../db.ts";
import { kickJobs, type DeskJob } from "./jobs.ts";
import { dailyScanRuntime, type DailyScanRuntime, type StoredDailyScanRuntime } from "./daily-scan.ts";
import { getPaperConfig } from "./paper-settings.ts";
import {
  runForcedChat,
  validateForcedRuntime,
  type ForcedChatAdapters,
  type ForcedRuntimeSnapshot,
} from "./forced-runtime.server.ts";
import {
  PICKER_PROVIDER_IDS,
  automaticLadder,
  modelEffort,
  type ModelEffort,
  type PickerProviderId,
} from "./provider-registry.ts";
import { automaticFailoverReason, failoverNoteSentence, failoverReasonPhrase } from "./automatic-failover.ts";
import { modelChoiceLabel } from "./model-choice.ts";

export async function validateDailyRuntime(
  newsroomId: number,
  runtime: DailyScanRuntime,
  effort?: ModelEffort | null,
  validate: typeof validateForcedRuntime = validateForcedRuntime,
) {
  try {
    const snapshot = await validate(newsroomId, runtime, modelEffort(runtime, effort));
    return { ...snapshot, requestedRuntime: runtime, requestedEffort: modelEffort(runtime, effort), resolvedRuntime: runtime, switchReason: null, switchNote: null };
  } catch (firstError) {
    const detail = firstError instanceof Error ? firstError.message : String(firstError);
    const reason = automaticFailoverReason(detail);
    if (!reason) throw firstError;
    const ladder = automaticLadder();
    const at = ladder.indexOf(runtime as any);
    const forward = at >= 0 ? ladder.slice(at + 1) : ladder;
    const candidates = (forward.length ? forward : ladder).filter(
      (choice): choice is PickerProviderId =>
        choice !== runtime && PICKER_PROVIDER_IDS.includes(choice as PickerProviderId),
    );
    for (const choice of candidates) {
      try {
        const snapshot = await validate(newsroomId, choice, modelEffort(choice, effort));
        const previousLabel = modelChoiceLabel(runtime);
        const nextLabel = modelChoiceLabel(choice);
        return {
          ...snapshot,
          requestedRuntime: runtime,
          requestedEffort: modelEffort(runtime, effort),
          resolvedRuntime: choice,
          switchReason: failoverReasonPhrase(previousLabel, reason),
          switchNote: failoverNoteSentence(nextLabel, previousLabel, reason),
        };
      } catch {
        // Keep probing the scheduled fallback ladder.
      }
    }
    throw firstError;
  }
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
    }).formatToParts(date),
    v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}

export async function tickDailyScans(
  now = new Date(),
  deps: { runtimeSnapshot?: typeof validateDailyRuntime; kick?: boolean } = {},
): Promise<{ reserved: number }> {
  const sql = await getSql();
  await sql.query(
    "update daily_scan_reservations r set status=j.status,error=j.error,finished_at=coalesce(j.finished_at,now()) from desk_jobs j where r.desk_job_id=j.id and r.status in ('queued','running') and j.status in ('completed','failed')",
  );
  const ps = await sql.query<any>(
    "select * from daily_scan_policies where enabled=true and paused=false",
  );
  let reserved = 0;
  for (const p of ps) {
    // Match the settings UI, including nullable or absent legacy settings.
    const { timezone } = await getPaperConfig(p.newsroom_id);
    let local: ReturnType<typeof localParts>;
    try {
      local = localParts(now, timezone);
    } catch {
      await sql.query(
        "update daily_scan_policies set paused=true,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$3",
        [
          p.newsroom_id,
          "The newsroom timezone is invalid. Correct it in paper settings, then resume the daily scan.",
          p.revision,
        ],
      );
      continue;
    }
    if (local.time < p.local_time) continue;
    const alreadyReserved = await sql.query(
      "select 1 from daily_scan_reservations where newsroom_id=$1 and (local_day=$2 or status in ('queued','running')) limit 1",
      [p.newsroom_id, local.day],
    );
    if (alreadyReserved[0]) continue;
    const [owner] = await sql.query<{ user_id: string }>(
      "select user_id from newsroom_members where newsroom_id=$1 and user_id=$2 and role='owner' limit 1",
      [p.newsroom_id, p.configured_by_user_id],
    );
    /*
      Say WHY, like the timezone and runtime checks above do.

      This was a bare `continue`, and it is the one condition an operator can
      actually fix. If the account that configured the daily scan stops being
      the newsroom owner -- someone is replaced, a second editor is promoted,
      a role changes during setup -- the scheduled scan never ran again: no
      log line, no pause_reason, no notice anywhere in the UI. The paper
      looked configured and quietly stopped producing.

      Pausing with a reason is the same shape the two neighbouring checks
      already use, so the UI has something to show and the operator gets a
      sentence telling them what to do.
    */
    if (!owner) {
      await sql.query(
        "update daily_scan_policies set paused=true,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$3",
        [
          p.newsroom_id,
          "The account that configured the daily scan is no longer the owner of this newsroom. Make that account the owner again in Editors & access, then resume the daily scan.",
          p.revision,
        ],
      );
      continue;
    }
    const [authorized] = await sql.query(
      "select 1 from daily_scan_policies p join newsroom_members m on m.newsroom_id=p.newsroom_id and m.user_id=p.configured_by_user_id and m.role='owner' where p.newsroom_id=$1 and p.enabled=true and p.paused=false and p.revision=$2",
      [p.newsroom_id, p.revision],
    );
    if (!authorized) continue;
    let model: any;
    try {
      model = await (deps.runtimeSnapshot ?? validateDailyRuntime)(
        p.newsroom_id,
        dailyScanRuntime(p.runtime as StoredDailyScanRuntime),
        modelEffort(dailyScanRuntime(p.runtime as StoredDailyScanRuntime), p.model_effort),
      );
    } catch (e) {
      await sql.query(
        "update daily_scan_policies set paused=true,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$3",
        [p.newsroom_id, e instanceof Error ? e.message : "Provider unavailable.", p.revision],
      );
      continue;
    }
    try {
      const made = await withTransaction(async (tx) => {
        const [current] = await tx.query<any>(
          "select * from daily_scan_policies where newsroom_id=$1 for update",
          [p.newsroom_id],
        );
        if (
          !current?.enabled ||
          current.paused ||
          current.revision !== p.revision ||
          current.configured_by_user_id !== owner.user_id
        )
          return false;
        const stillOwner = await tx.query(
          "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role='owner'",
          [p.newsroom_id, owner.user_id],
        );
        if (!stillOwner[0]) return false;
        const sources = await tx.query<any>(
          "select id,url,title,kind,tier,status,last_hash,last_fetched_at,last_error from sources where newsroom_id=$1 and status='accepted' and id=any($2::int[]) order by id",
          [p.newsroom_id, p.selected_source_ids],
        );
        if (sources.length !== p.selected_source_ids.length || sources.length > p.source_cap)
          throw new Error(
            "Scheduled sources changed after configuration. Review the selected accepted sources and resume manually.",
          );
        const [r] = await tx.query<{ id: number }>(
          "insert into daily_scan_reservations(newsroom_id,local_day,status,policy_revision,policy_snapshot,source_snapshot,model_snapshot) values($1,$2,'queued',$3,$4::jsonb,$5::jsonb,$6::jsonb) on conflict(newsroom_id,local_day) do nothing returning id",
          [
            p.newsroom_id,
            local.day,
            p.revision,
            JSON.stringify({
              enabled: true,
              revision: p.revision,
              localTime: p.local_time,
              timezone,
              sourceCap: p.source_cap,
            }),
            JSON.stringify(sources),
            JSON.stringify(model),
          ],
        );
        if (!r) return false;
        const [run] = await tx.query<{ id: number }>(
          "insert into scan_runs(user_id,newsroom_id,source_snapshot,policy_snapshot,model_snapshot,execution_origin,daily_reservation_id) values($1,$2,$3,$4,$5,'scheduled',$6) returning id",
          [
            owner.user_id,
            p.newsroom_id,
            JSON.stringify(sources),
            JSON.stringify({ revision: p.revision }),
            JSON.stringify(model),
            r.id,
          ],
        );
        const [job] = await tx.query<{ id: number }>(
          "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,failover_note,result_json) values($1,$2,'scan',$3,$4,'scheduled','default','queued',$5,$6,$7) returning id",
          [
            p.newsroom_id,
            owner.user_id,
            run.id,
            model.modelChoice,
            model.switchReason ? `Switched to ${modelChoiceLabel(model.modelChoice)}: ${model.switchReason}` : "Scheduled daily scan queued",
            model.switchNote ?? "",
            JSON.stringify({ modelEffort: model.modelEffort ?? null, preflightFailover: model.switchReason ? model : null }),
          ],
        );
        await tx.query(
          "update daily_scan_reservations set scan_run_id=$1,desk_job_id=$2 where id=$3",
          [run.id, job.id, r.id],
        );
        return true;
      });
      if (made) {
        reserved++;
        if (deps.kick !== false) kickJobs();
      }
    } catch (e) {
      if (/Scheduled sources changed/.test(String(e))) {
        await sql.query(
          "update daily_scan_policies set paused=true,pause_reason=$2,revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$3",
          [p.newsroom_id, e instanceof Error ? e.message : String(e), p.revision],
        );
      } else if (!/unique|duplicate/i.test(String(e)))
        console.error("[daily-scan] reservation failed", e);
    }
  }
  return { reserved };
}

export async function assertDailyScanCanContinue(job: DeskJob) {
  const sql = await getSql();
  const [r] = await sql.query<any>(
    "select p.enabled,p.paused,p.revision,r.policy_revision,r.model_snapshot,r.source_snapshot from daily_scan_reservations r join daily_scan_policies p on p.newsroom_id=r.newsroom_id join desk_jobs j on j.id=r.desk_job_id where r.scan_run_id=$1 and r.newsroom_id=$2 and j.status='running' and j.claim_token=$3",
    [job.subject_id, job.newsroom_id, job.claim_token],
  );
  const owner = await sql.query(
    "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role='owner'",
    [job.newsroom_id, job.user_id],
  );
  if (!r || !owner[0] || !r.enabled || r.paused || r.revision !== r.policy_revision)
    throw new Error("Scheduled scan permission was withdrawn before the next external call.");
  return r;
}

async function assertDailyScanCommitAllowed(sql: Sql, job: DeskJob) {
  const [ownedJob] = await sql.query(
    "select 1 from desk_jobs where id=$1 and newsroom_id=$2 and status='running' and claim_token=$3 for update",
    [job.id, job.newsroom_id, job.claim_token],
  );
  if (!ownedJob) throw new Error("Scheduled scan lease was lost before results could be saved.");
  const [reservation] = await sql.query<{ policy_revision: number; status: string }>(
    "select policy_revision,status from daily_scan_reservations where desk_job_id=$1 and scan_run_id=$2 and newsroom_id=$3 for update",
    [job.id, job.subject_id, job.newsroom_id],
  );
  const [policy] = await sql.query<{
    enabled: boolean;
    paused: boolean;
    revision: number;
    configured_by_user_id: string;
  }>(
    "select enabled,paused,revision,configured_by_user_id from daily_scan_policies where newsroom_id=$1 for update",
    [job.newsroom_id],
  );
  const [owner] = policy
    ? await sql.query(
        "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role='owner' for share",
        [job.newsroom_id, policy.configured_by_user_id],
      )
    : [];
  if (
    !reservation ||
    !["queued", "running"].includes(reservation.status) ||
    !policy?.enabled ||
    policy.paused ||
    policy.revision !== reservation.policy_revision ||
    !owner
  )
    throw new Error("Scheduled scan permission was withdrawn before results could be saved.");
}

export async function commitDailyScanResults<T>(
  job: DeskJob,
  write: (sql: Sql) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    await assertDailyScanCommitAllowed(sql, job);
    const result = await write(sql);
    await sql.query(
      "update daily_scan_reservations set status='completed',finished_at=now() where scan_run_id=$1 and newsroom_id=$2 and desk_job_id=$3",
      [job.subject_id, job.newsroom_id, job.id],
    );
    return result;
  });
}

export async function finalizeDailyScanFailure(job: DeskJob, msg: string): Promise<void> {
  await withTransaction(async (sql) => {
    const [ownedJob] = await sql.query(
      "select 1 from desk_jobs where id=$1 and newsroom_id=$2 and status='running' and claim_token=$3 for update",
      [job.id, job.newsroom_id, job.claim_token],
    );
    if (!ownedJob) return;
    const [reservation] = await sql.query<{ policy_revision: number; status: string }>(
      "select policy_revision,status from daily_scan_reservations where desk_job_id=$1 and scan_run_id=$2 and newsroom_id=$3 for update",
      [job.id, job.subject_id, job.newsroom_id],
    );
    if (!reservation || !["queued", "running"].includes(reservation.status)) return;
    await sql.query(
      "update daily_scan_reservations set status='failed',error=$2,finished_at=now() where scan_run_id=$1 and newsroom_id=$3 and desk_job_id=$4",
      [job.subject_id, msg, job.newsroom_id, job.id],
    );
    await sql.query(
      "update scan_runs set finished_at=coalesce(finished_at,now()),error=coalesce(error,$2) where id=$1 and newsroom_id=$3 and daily_reservation_id=(select id from daily_scan_reservations where desk_job_id=$4)",
      [job.subject_id, msg, job.newsroom_id, job.id],
    );
    if (/\b429\b|quota|rate limit/i.test(msg))
      await sql.query(
        "update daily_scan_policies set paused=true,pause_reason='Subscription quota was reached. Resume manually after access is restored.',revision=revision+1,updated_at=now() where newsroom_id=$1 and revision=$2",
        [job.newsroom_id, reservation.policy_revision],
      );
  });
}

export async function isDailyScanJob(job: DeskJob): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query(
    "select 1 from daily_scan_reservations where scan_run_id=$1 and desk_job_id=$2 and newsroom_id=$3",
    [job.subject_id, job.id, job.newsroom_id],
  );
  return Boolean(rows[0]);
}

type ForcedChatSnapshot = ForcedRuntimeSnapshot;

export type DailyRuntimeReceipt = {
  requestedRuntime: string;
  requestedEffort: ModelEffort | null;
  resolvedRuntime: string;
  switchReason: string;
  switchNote: string;
};

export function attachDailyRuntimeReceipt(
  current: (ForcedChatSnapshot & Partial<DailyRuntimeReceipt>) | null,
  next: ForcedChatSnapshot,
  receipt: Pick<DailyRuntimeReceipt, "switchReason" | "switchNote"> & {
    previousRuntime: string;
    previousEffort: ModelEffort | null;
  },
): ForcedChatSnapshot & DailyRuntimeReceipt {
  return {
    ...next,
    requestedRuntime: current?.requestedRuntime ?? current?.runtime ?? receipt.previousRuntime,
    requestedEffort:
      current && Object.prototype.hasOwnProperty.call(current, "requestedEffort")
        ? current.requestedEffort ?? null
        : current && "modelEffort" in current
          ? current.modelEffort ?? null
          : receipt.previousEffort,
    resolvedRuntime: next.runtime,
    switchReason: receipt.switchReason,
    switchNote: receipt.switchNote,
  };
}

/** Promote a scheduled run's actual runtime under the same lease, policy and
 * revision fence that guards its final commit. The reservation drives the
 * owner UI; scan_runs is the immutable execution receipt. */
export async function persistDailyRuntimeSwitch(
  job: DeskJob,
  next: ForcedChatSnapshot,
  receipt: Pick<DailyRuntimeReceipt, "switchReason" | "switchNote"> & {
    previousRuntime: string;
    previousEffort: ModelEffort | null;
  },
): Promise<ForcedChatSnapshot & DailyRuntimeReceipt> {
  return withTransaction(async (sql) => {
    const [current] = await sql.query<{
      id: number;
      model_snapshot: ForcedChatSnapshot & Partial<DailyRuntimeReceipt>;
    }>(
      `select r.id,r.model_snapshot
         from daily_scan_reservations r
         join daily_scan_policies p on p.newsroom_id=r.newsroom_id
         join desk_jobs j on j.id=r.desk_job_id
        where r.desk_job_id=$1 and r.scan_run_id=$2 and r.newsroom_id=$3
          and r.status in ('queued','running')
          and j.status='running' and j.claim_token=$4
          and p.enabled=true and p.paused=false and p.revision=r.policy_revision
        for update of r,p,j`,
      [job.id, job.subject_id, job.newsroom_id, job.claim_token],
    );
    if (!current) {
      throw new Error("Scheduled scan permission was withdrawn before its model switch could be saved.");
    }
    const stored = attachDailyRuntimeReceipt(current.model_snapshot, next, receipt);
    const nextEffort = "modelEffort" in next ? next.modelEffort ?? null : null;
    const jobRows = await sql.query(
      `update desk_jobs
          set model_choice=$2,
              result_json=jsonb_set(coalesce(nullif(result_json,'')::jsonb,'{}'::jsonb),'{modelEffort}',coalesce(to_jsonb($3::text),'null'::jsonb),true)::text,
              failover_note=$4,
              stage=$5,
              updated_at=now()
        where id=$1 and newsroom_id=$6 and status='running' and claim_token=$7
        returning id`,
      [
        job.id,
        next.modelChoice,
        nextEffort,
        receipt.switchNote,
        `Switched to ${modelChoiceLabel(next.modelChoice)}: ${receipt.switchReason}`,
        job.newsroom_id,
        job.claim_token,
      ],
    );
    const reservationRows = await sql.query(
      `update daily_scan_reservations set model_snapshot=$2::jsonb
        where id=$1 and desk_job_id=$3 and scan_run_id=$4 and newsroom_id=$5
        returning id`,
      [current.id, JSON.stringify(stored), job.id, job.subject_id, job.newsroom_id],
    );
    const runRows = await sql.query(
      `update scan_runs set model_snapshot=$2::jsonb
        where id=$1 and newsroom_id=$3 and daily_reservation_id=$4
        returning id`,
      [job.subject_id, JSON.stringify(stored), job.newsroom_id, current.id],
    );
    if (!jobRows[0] || !reservationRows[0] || !runRows[0]) {
      throw new Error("Scheduled scan runtime receipt could not be saved.");
    }
    return stored;
  });
}

export async function runForcedDailyChat<T>(
  snapshot: ForcedChatSnapshot,
  system: string,
  user: string,
  maxTokens: number,
  options: { timeoutMs?: number } | undefined,
  adapters: ForcedChatAdapters<T>,
): Promise<T> {
  return runForcedChat(snapshot, system, user, maxTokens, options, adapters);
}

type DailyScanWorkDeps = {
  performScan?: (job: DeskJob, deps: Record<string, unknown>) => Promise<void>;
  chatAdapters?: ForcedChatAdapters<any>;
  scanDeps?: Record<string, unknown>;
  beforeScheduledCommit?: () => Promise<void>;
  validateRuntime?: typeof validateForcedRuntime;
  persistRuntimeSwitch?: typeof persistDailyRuntimeSwitch;
};

export async function runDailyScanWork(job: DeskJob, deps: DailyScanWorkDeps = {}) {
  try {
    const state = await assertDailyScanCanContinue(job);
    let model = state.model_snapshot as ForcedChatSnapshot & Partial<DailyRuntimeReceipt>;
    const forcedChat = async (
      system: string,
      user: string,
      maxTokens: number,
      opts?: {
        timeoutMs?: number;
        choice?: string;
        reasoningEffort?: ModelEffort | null;
      },
    ) => {
      await assertDailyScanCanContinue(job);
      const adapters =
        deps.chatAdapters ??
        ({
          claude: async (input) =>
            (await import("./ai-claude-code.server.ts")).claudeCodeChat(input),
          codex: async (input) => (await import("./ai-codex.server.ts")).codexChat(input),
          local: async (...input) => {
            const { grokChat } = await import("./ai.ts");
            return grokChat(...input);
          },
          custom: async (...input) => {
            const { grokChat } = await import("./ai.ts");
            return grokChat(...input);
          },
          xai: async (...input) => {
            const { grokChat } = await import("./ai.ts");
            return grokChat(...input);
          },
        } satisfies ForcedChatAdapters<any>);
      const requested = opts?.choice;
      if (requested && requested !== model.modelChoice) {
        const next = await validateForcedRuntime(
          job.newsroom_id,
          requested as DailyScanRuntime,
          opts?.reasoningEffort ?? null,
        );
        return runForcedDailyChat(next, system, user, maxTokens, opts, adapters);
      }
      return runForcedDailyChat(model, system, user, maxTokens, opts, adapters);
    };
    const performScan =
      deps.performScan ??
      (async (workJob, workDeps) => {
        const { performScanWork } = await import("./desk.ts");
        await performScanWork(workJob, workDeps as any);
      });
    await performScan(job, {
      ...deps.scanDeps,
      grokChat: forcedChat as any,
      scheduledGuard: () => assertDailyScanCanContinue(job),
      scheduledSnapshot: { model, sources: state.source_snapshot },
      onModelSwitch: async (receipt: {
        previousChoice: string;
        nextChoice: string;
        nextEffort: ModelEffort | null;
        switchReason: string;
        switchNote: string;
      }) => {
        const validate = deps.validateRuntime ?? validateForcedRuntime;
        const next = await validate(job.newsroom_id, receipt.nextChoice as DailyScanRuntime, receipt.nextEffort);
        const persist = deps.persistRuntimeSwitch ?? persistDailyRuntimeSwitch;
        model = await persist(job, next, {
          previousRuntime: model.runtime ?? receipt.previousChoice,
          previousEffort: "modelEffort" in model ? model.modelEffort ?? null : null,
          switchReason: receipt.switchReason,
          switchNote: receipt.switchNote,
        });
      },
      beforeScheduledCommit: deps.beforeScheduledCommit,
      scheduledCommit: (write: (sql: Sql) => Promise<unknown>) =>
        commitDailyScanResults(job, write),
    } as any);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Scheduled scan failed";
    await finalizeDailyScanFailure(job, msg);
    throw e;
  }
}

export const performDailyScanWork = createServerOnlyFn(runDailyScanWork);
