import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

/**
 * "editorial" is the slow one. The voice fetches its own records before it
 * writes, so a piece takes ten to forty minutes — far longer than any other
 * job here. It survives that on the same heartbeat as the rest; nothing needed
 * to change except knowing it is normal.
 */
/**
 * `brief` joined the list in 0.6.2. Writing an investigation's read-me-first
 * block is a model call like any other, and it used to run inline inside the
 * `refreshBrief` request -- which meant it could not carry a model choice,
 * could not be watched, and held an HTTP request open for as long as the
 * provider took. It is a job now, on the default lane, for the same reasons
 * drafting is.
 */
export type JobKind = "scan" | "draft" | "dark" | "editorial" | "brief";
export type JobStatus = "queued" | "running" | "completed" | "failed";

/**
 * Two lanes, not one. Audit finding ENG-105: a single serial drainer meant a
 * 40-minute editorial held `draining` true for the whole run, so a Scan or
 * Draft queued behind it did not start until the editorial finished.
 *
 * `editorial` is its own lane at concurrency 1 -- it is the one kind that is
 * both slow and where running two at once buys nothing (the Opinion desk is
 * one voice, one piece at a time). Everything else shares `default`, so Scan
 * and Draft jobs drain independently of whatever Opinion is doing.
 */
export type JobLane = "editorial" | "default";

/** Every job kind maps to exactly one lane; this is the only place that decides. */
export function laneForKind(kind: JobKind): JobLane {
  return kind === "editorial" ? "editorial" : "default";
}

export type DeskJob = {
  id: number;
  newsroom_id: number;
  user_id: string;
  kind: JobKind;
  subject_id: number;
  model_choice: string;
  model_choice_source: "editor" | "auto";
  lane: JobLane;
  status: JobStatus;
  stage: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/**
 * How many jobs a lane's drainer will run at once. `editorial` stays at 1 on
 * purpose (see JobLane above). `default` gets 2 so a Draft does not sit
 * behind a slow Scan either -- together with the one editorial slot that is
 * up to 3 jobs open at once, each doing its own `pg` queries against the one
 * pool `db.ts` opens. That pool takes its size from `pg`'s own default
 * (`new Pool({ connectionString })` sets no `max`, so it is 10), and 3
 * concurrent jobs plus ordinary request traffic comfortably fit under that --
 * this is the number to revisit if `max` is ever set explicitly (ENG-104).
 */
const LANE_CONCURRENCY: Record<JobLane, number> = { editorial: 1, default: 2 };

/** One `draining` flag per lane, not one for the whole drainer. */
const draining: Record<JobLane, boolean> = { editorial: false, default: false };

export async function ensureJobsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists desk_jobs (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      kind text not null,
      subject_id integer not null default 0,
      model_choice text not null default 'auto',
      status text not null default 'queued',
      stage text not null default '',
      error text,
      result_json text not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )
  `);
  await sql.query(`
    create index if not exists desk_jobs_open_idx
      on desk_jobs (newsroom_id, kind, subject_id, status, id desc)
  `);
  /*
    The same column + backfill + index as migrations/0019_job_lanes.sql, for
    the same reason the 0017 index is declared twice: this covers the
    embedded PGLite path where migrations do not run.
    `jobs.test.ts` asserts the two definitions agree. Audit finding ENG-105.
  */
  await sql.query(`alter table desk_jobs add column if not exists lane text`);
  await sql.query(`
    update desk_jobs
    set lane = case when kind = 'editorial' then 'editorial' else 'default' end
    where lane is null
  `);
  await sql.query(`
    create index if not exists desk_jobs_lane_idx
      on desk_jobs (lane, status, id asc)
  `);
  /*
    The same partial unique index as migrations/0017_one_open_job.sql.

    It has to be in both places: the migration covers a real Postgres, this
    covers the embedded PGLite path where migrations do not run. Declared twice
    is a drift risk, so `jobs.test.ts` asserts the two definitions match — a
    duplicated invariant that nobody checks is how the last one failed.

    This is what makes enqueueJob race-safe; the findOpenJob check above is
    only an optimisation. Audit finding ENG-004.
  */
  await sql.query(`
    create unique index if not exists desk_jobs_one_open_per_subject
      on desk_jobs (newsroom_id, kind, subject_id)
      where status in ('queued', 'running')
  `);
  // Identifies WHICH execution owns a running row. Without it a stale-reclaim
  // and the original executor both write results for the same job.
  await sql.query(`alter table desk_jobs add column if not exists claim_token text`);
  await sql.query(`alter table desk_jobs add column if not exists model_choice text not null default 'auto'`);
  // The same column as migrations/0026_model_choice_source.sql, for the same
  // reason model_choice itself is declared twice: this covers the embedded
  // PGLite path where migrations do not run.
  await sql.query(
    `alter table desk_jobs add column if not exists model_choice_source text not null default 'editor'`,
  );
}

/**
 * How long a `running` row may go without a heartbeat before another drainer
 * treats it as abandoned. The heartbeat below fires far more often than this,
 * so only a genuinely dead process trips it.
 */
export const STALE_RUNNING_SECONDS = 120;
/** Exported so a test can assert the timing invariant that makes the
 * heartbeat actually work: it must fire well inside the reclaim window, or a
 * slow-but-alive job would still get mistaken for a dead one. */
export const HEARTBEAT_MS = 30_000;

/** Unique per execution. `randomUUID` is available on every supported runtime. */
function mintClaimToken(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The real work behind each job kind, dispatched by dynamic import exactly as
 * before lanes existed -- moved here, unchanged, so `executeJob` can go
 * through one seam instead of a hard-coded if/else chain.
 */
async function realWork(job: DeskJob): Promise<void> {
  if (job.kind === "draft") {
    const { performDraftWork } = await import("./desk.ts");
    await performDraftWork(job);
  } else if (job.kind === "scan") {
    const { performScanWork } = await import("./desk.ts");
    await performScanWork(job);
  } else if (job.kind === "dark") {
    const { performDarkRound } = await import("./dark.ts");
    await performDarkRound(job);
  } else if (job.kind === "brief") {
    const { performBriefWork } = await import("./dark.ts");
    await performBriefWork(job);
  } else if (job.kind === "editorial") {
    const { performEditorialWork } = await import("./editorial.server.ts");
    await performEditorialWork(job);
  }
}

let runWork: (job: DeskJob) => Promise<void> = realWork;

/**
 * Test-only seam: swap what `executeJob` does for its actual work, without
 * touching the claim/heartbeat/lane machinery around it.
 *
 * A real 40-minute editorial cannot run in a test -- no model provider is
 * configured, and it would cost money if one were. This is how
 * jobs.test.ts's lane-isolation test models "a long job occupies its lane"
 * honestly: a fast stand-in that hangs on a promise the test controls, so the
 * test can assert a `default`-lane job finishes while the stand-in is still
 * "running", then let the stand-in resolve and clean up. Call with no
 * argument to restore the real dispatch.
 */
export function __setJobWorkForTest(fn?: (job: DeskJob) => Promise<void>) {
  runWork = fn ?? realWork;
}

export async function latestJob(opts: {
  newsroomId: number;
  kind: JobKind;
  subjectId: number;
}): Promise<DeskJob | null> {
  await ensureJobsSchema();
  const sql = await getSql();
  const rows = await sql<DeskJob>`
    select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
           created_at, updated_at, started_at, finished_at
    from desk_jobs
    where newsroom_id = ${opts.newsroomId} and kind = ${opts.kind} and subject_id = ${opts.subjectId}
    order by id desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function findOpenJob(opts: {
  newsroomId: number;
  kind: JobKind;
  subjectId?: number;
}): Promise<DeskJob | null> {
  await ensureJobsSchema();
  const sql = await getSql();
  const rows =
    opts.subjectId != null
      ? await sql<DeskJob>`
          select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
                 created_at, updated_at, started_at, finished_at
          from desk_jobs
          where newsroom_id = ${opts.newsroomId}
            and kind = ${opts.kind}
            and subject_id = ${opts.subjectId}
            and status in ('queued', 'running')
          order by id desc
          limit 1
        `
      : await sql<DeskJob>`
          select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
                 created_at, updated_at, started_at, finished_at
          from desk_jobs
          where newsroom_id = ${opts.newsroomId}
            and kind = ${opts.kind}
            and status in ('queued', 'running')
          order by id desc
          limit 1
        `;
  return rows[0] ?? null;
}

export async function enqueueJob(opts: {
  userId: string;
  newsroomId?: number;
  kind: JobKind;
  subjectId: number;
  modelChoice?: string;
  modelChoiceSource?: "editor" | "auto";
  kick?: boolean;
}): Promise<DeskJob> {
  await ensureJobsSchema();
  const sql = await getSql();
  const newsroomId = opts.newsroomId ?? DEFAULT_NEWSROOM_ID;
  const open = await findOpenJob({
    newsroomId,
    kind: opts.kind,
    subjectId: opts.subjectId,
  });
  if (open) {
    if (opts.kick !== false) kickJobs();
    return open;
  }
  /*
    The check above is an optimisation, not the guarantee.

    findOpenJob-then-insert is a check-then-act: under concurrency every caller
    can look, see nothing, and insert. Twenty simultaneous enqueues for one
    subject produced twenty jobs, each paying full model price. The claim token
    stops two workers running the same ROW; nothing coalesced duplicate rows.

    The partial unique index in 0017 is what actually holds. ON CONFLICT DO
    NOTHING makes the loser silent, and the select that follows hands it the
    row the winner created — so every caller gets the same job, which is what
    they all wanted. Audit finding ENG-004.
  */
  const lane = laneForKind(opts.kind);
  const created = await sql<DeskJob>`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage)
    values (${newsroomId}, ${opts.userId}, ${opts.kind}, ${opts.subjectId}, ${opts.modelChoice ?? "auto"}, ${opts.modelChoiceSource ?? "editor"}, ${lane}, ${"queued"}, ${"Queued"})
    on conflict do nothing
    returning id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
              created_at, updated_at, started_at, finished_at
  `;
  const job =
    created[0] ??
    (await findOpenJob({ newsroomId, kind: opts.kind, subjectId: opts.subjectId }));
  if (!job) {
    // Lost the race and the winner finished before we looked. Rare, and the
    // honest answer is to try once more rather than invent a job row.
    //
    // A narrow double-race can occur between the first findOpenJob miss (above)
    // and this retry insert: the original winner's job finishes, then a third
    // caller creates a new open row for the same (newsroom_id, kind, subject_id)
    // before this retry insert runs. The partial unique index would reject the
    // insert with a constraint violation, surfacing a 500 error. ON CONFLICT DO
    // NOTHING makes this insert silent instead; if it lost that race too, the
    // findOpenJob below finds the third caller's row and returns it. The design
    // intent is that concurrent enqueues always coalesce, never error.
    const retry = await sql<DeskJob>`
      insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage)
      values (${newsroomId}, ${opts.userId}, ${opts.kind}, ${opts.subjectId}, ${opts.modelChoice ?? "auto"}, ${opts.modelChoiceSource ?? "editor"}, ${lane}, ${"queued"}, ${"Queued"})
      on conflict do nothing
      returning id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
                created_at, updated_at, started_at, finished_at
    `;
    if (retry[0]) {
      if (opts.kick !== false) kickJobs();
      return retry[0];
    }
    // Lost the race a second time: another caller inserted an open row while
    // we were retrying. Find and return it.
    const coalescedJob = await findOpenJob({
      newsroomId,
      kind: opts.kind,
      subjectId: opts.subjectId,
    });
    if (coalescedJob) {
      if (opts.kick !== false) kickJobs();
      return coalescedJob;
    }
    // If we still have nothing, that is a real error — something went wrong
    // and we have exhausted our retry logic.
    throw new Error(
      `Failed to enqueue job after double-race: no open job for newsroom=${newsroomId}, kind=${opts.kind}, subject=${opts.subjectId}`,
    );
  }
  if (opts.kick !== false) kickJobs();
  return job;
}

export function kickJobs() {
  setTimeout(() => {
    void drainQueuedJobs();
  }, 0);
}

export async function setJobStage(id: number, stage: string) {
  const sql = await getSql();
  await sql`
    update desk_jobs set stage = ${stage}, updated_at = now() where id = ${id}
  `;
}

/**
 * Automatic failover (src/lib/news/automatic-failover.ts) rewrites the
 * concrete choice ON the running job when the first provider's login has
 * lapsed mid-run, so a heartbeat, a reclaim, or the editor's own screen all
 * see the rung the retry is actually using rather than the one that just
 * failed.
 */
export async function setJobModelChoice(id: number, modelChoice: string) {
  const sql = await getSql();
  await sql`
    update desk_jobs set model_choice = ${modelChoice}, updated_at = now() where id = ${id}
  `;
}

/**
 * Drain one lane. Each lane has its own `draining` flag, so a caller already
 * draining `editorial` does not block a caller trying to drain `default` --
 * that independence is the entire point of ENG-105's fix. Within a lane,
 * `LANE_CONCURRENCY[lane]` workers run in parallel, each looping the same
 * "claim one, run it, look for the next" shape the original single-lane
 * drainer used.
 *
 * Two workers can race for the same row: both `select`s can return it before
 * either has claimed it. That is safe, not just tolerated -- `executeJob`'s
 * claim is a conditional `update ... where status = 'queued' or (stale)`, so
 * only one of them actually flips the row to `running`; the loser's `took`
 * comes back `false` and it just loops around to look again. Nothing here
 * needs `for update skip locked` because the correctness already lives in
 * that one update, exactly as it did before lanes existed.
 */
async function drainLane(lane: JobLane): Promise<{ ran: number }> {
  if (draining[lane]) return { ran: 0 };
  draining[lane] = true;
  let ran = 0;
  try {
    await ensureJobsSchema();
    const sql = await getSql();
    const concurrency = LANE_CONCURRENCY[lane];
    const workers = Array.from({ length: concurrency }, () =>
      (async () => {
        for (let n = 0; n < 8; n++) {
          const next = await sql<DeskJob>`
            select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, lane, status, stage, error,
                   created_at, updated_at, started_at, finished_at
            from desk_jobs
            where lane = ${lane}
              and (
                status = 'queued'
                or (status = 'running' and updated_at < now() - make_interval(secs => ${STALE_RUNNING_SECONDS}))
              )
            order by id asc
            limit 1
          `;
          if (!next[0]) break;
          const took = await executeJob(next[0]);
          if (took) ran += 1;
          // A lost claim race is not "nothing left" -- loop again rather than
          // stopping this worker while a sibling worker (or another job
          // entirely) may still be waiting in this same lane.
        }
      })(),
    );
    await Promise.all(workers);
  } catch (err) {
    console.error(`[jobs] drain failed (lane=${lane})`, err);
  } finally {
    draining[lane] = false;
  }
  return { ran };
}

/**
 * Finish queued (or stale running) jobs across both lanes. Same process, or
 * a cron wake-up. The two lanes drain concurrently -- that is what makes a
 * queued Scan or Draft start while a 40-minute editorial is still running,
 * instead of waiting for it. Audit finding ENG-105.
 */
export async function drainQueuedJobs(): Promise<{ ran: number }> {
  const [editorial, rest] = await Promise.all([drainLane("editorial"), drainLane("default")]);
  return { ran: editorial.ran + rest.ran };
}

export async function executeJob(job: DeskJob): Promise<boolean> {
  const sql = await getSql();
  const token = mintClaimToken();
  const claimed = await sql<{ id: number }>`
    update desk_jobs
    set status = ${"running"}, stage = ${"Working…"}, claim_token = ${token},
        started_at = coalesce(started_at, now()), updated_at = now()
    where id = ${job.id}
      and (
        status = ${"queued"}
        or (status = ${"running"} and updated_at < now() - make_interval(secs => ${STALE_RUNNING_SECONDS}))
      )
    returning id
  `;
  if (!claimed[0]) return false;

  /**
   * Keep `updated_at` fresh for as long as this execution is alive.
   *
   * Nothing else moved it during a run — `setJobStage` had no callers — so any
   * job slower than the stale window (an LLM draft routinely is) was re-claimed
   * by the next drainer and run a SECOND time while the first was still going,
   * producing duplicate drafts and doubled model spend. The `claim_token` guard
   * below is the backstop for the case where this process really did stall.
   */
  const beat = setInterval(() => {
    void sql`
      update desk_jobs set updated_at = now()
      where id = ${job.id} and claim_token = ${token}
    `.catch(() => undefined);
  }, HEARTBEAT_MS);
  // Never hold the process open on this timer alone.
  (beat as unknown as { unref?: () => void }).unref?.();

  try {
    await runWork(job);
    // `claim_token` guard: if we were declared stale and someone else took the
    // job, this write must not clobber their result.
    await sql`
      update desk_jobs
      set status = ${"completed"}, stage = ${"Done"}, error = null, finished_at = now(), updated_at = now()
      where id = ${job.id} and claim_token = ${token}
    `;
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Job failed";
    await sql`
      update desk_jobs
      set status = ${"failed"}, error = ${raw.slice(0, 800)}, finished_at = now(), updated_at = now()
      where id = ${job.id} and claim_token = ${token}
    `;
  } finally {
    clearInterval(beat);
  }
  return true;
}

export function jobIsOpen(job: DeskJob | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

/**
 * The heartbeat is the one signal that actually distinguishes "still
 * working" from "the process that owned this is gone": `executeJob` touches
 * `updated_at` every 30s for as long as it is alive, on every job kind,
 * including the 10-40 minute editorial pieces. A queued-or-running job whose
 * heartbeat is older than the reclaim window (`STALE_RUNNING_SECONDS`) was
 * not written to by anything in the last four heartbeats -- the executor
 * died. `drainQueuedJobs` will eventually reclaim and rerun it, but that can
 * take a while, and nothing about the row itself changes in the meantime, so
 * a screen polling naively would show the same "still going" state whether
 * the job is seconds old or has been dead for an hour.
 */
export function jobHeartbeatStale(
  job: Pick<DeskJob, "status" | "updated_at"> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!job) return false;
  if (job.status !== "running" && job.status !== "queued") return false;
  const updated = Date.parse(job.updated_at);
  if (Number.isNaN(updated)) return false;
  return nowMs - updated > STALE_RUNNING_SECONDS * 1000;
}

/**
 * Scan, Dark Desk and Opinion each keep their own "run" record (scan_runs,
 * dark_runs, editorial_requests) alongside the generic desk_jobs row that
 * actually does the work. The run record only learns it is done when the
 * job's own code writes `finished_at` -- and a process killed mid-run (the
 * machine rebooting, the app being restarted, an OOM kill) can die between
 * those writes, leaving `finished_at` and `error` both null forever. That
 * looked, from the run record alone, indistinguishable from real progress:
 * Scan's `desk.scan.tsx` computed `scanning` from exactly that shape before
 * this fix, so a dead run left the page spinning with the Run button
 * disabled and no way out.
 *
 * A run "looks stalled" when it claims to be open but nothing is actually
 * going to finish it on its own within a useful time:
 *  - no desk_jobs row exists for it at all (orphaned -- nothing will ever
 *    reclaim a job that was never enqueued, e.g. a crash between inserting
 *    the run row and enqueuing the job), or
 *  - the job already settled (completed/failed) without the run record ever
 *    being told, or
 *  - the job's heartbeat has gone cold (`jobHeartbeatStale`).
 *
 * Deliberately NOT "has this been open a long time": that would misjudge a
 * legitimately slow run (Scan fetching many sources, a 40-minute editorial)
 * as dead. The heartbeat is what the system itself already uses to decide
 * whether a job is safe to reclaim, so this reuses that judgment instead of
 * inventing a second, less-informed one.
 */
export function runLooksStalled(opts: {
  runOpen: boolean;
  job: DeskJob | null | undefined;
  now?: number;
}): boolean {
  if (!opts.runOpen) return false;
  if (!opts.job) return true;
  if (opts.job.status === "completed" || opts.job.status === "failed") return true;
  return jobHeartbeatStale(opts.job, opts.now);
}
