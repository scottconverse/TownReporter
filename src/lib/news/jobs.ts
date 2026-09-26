import { ensureSchemaOnce, getSql } from "../db.ts";
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
/**
 * `audio-transcribe` joined the list in 0.6.63 (unit R). Transcribing a
 * meeting's retained audio with textflowkit is minutes of CPU, not seconds --
 * the same reason `editorial` and `artifact-ocr` are jobs rather than inline
 * work. It rides the `default` lane and serialises itself to one run at a time
 * (see textflowkit-transcribe.server.ts); the lane's concurrency of 2 is about
 * how many jobs may be *open*, not how many may burn CPU.
 */
export type JobKind = "scan" | "draft" | "reconcile" | "dark" | "editorial" | "brief" | "routine-notice" | "artifact-ocr" | "pull" | "audio-transcribe";
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
  research_scope?: "public" | "supplied";
  draft_batch_id?: number | null;
  model_choice_source: "editor" | "auto" | "scheduled";
  lane: JobLane;
  status: JobStatus;
  stage: string;
  failover_note: string;
  error: string | null;
  result_json?: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  claim_token?: string | null;
  /**
   * Structured progress (migration 0099). All optional because they are null
   * on every row written before that migration, and because a job that has
   * not reported progress yet is a real state the desk has to render.
   *
   * `stages_json` is the raw JSON text, as stored -- `jobStages()` parses it,
   * and no read path should hand a parsed array around, for the same reason
   * `result_json` stays text here.
   */
  stages_json?: string | null;
  stage_index?: number | null;
  pct?: number | null;
  step_text?: string | null;
  beat_at?: string | null;
  cancel_requested?: boolean | null;
  result_href?: string | null;
};

/**
 * The stall threshold the design locks: a running job with no word from its
 * worker for this many seconds is shown as stalled, not as working. It is
 * deliberately much shorter than `STALE_RUNNING_SECONDS` (120): the reclaim
 * window decides when the SYSTEM may take the job away from a dead process,
 * this decides when the EDITOR should be offered a choice. A job can be
 * legitimately stalled-looking at 60s and still be perfectly claimable at
 * 119s, and those are different questions.
 */
export const JOB_STALL_SECONDS = 60;

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

/**
 * One `draining` flag per lane, shared by every bundled copy of this module in
 * the process. The background entry and SSR entry can each bundle jobs.ts;
 * module-local flags let both copies open a full lane and bypass its limit.
 * `Symbol.for` keeps the ownership record common without making a cross-process
 * scheduler claim -- separate server processes still coordinate only through
 * the existing database claim tokens and stale-run recovery.
 */
const JOB_DRAINING_KEY = Symbol.for("townreporter:job-lane-draining");
const jobGlobal = globalThis as typeof globalThis &
  Record<symbol, Record<JobLane, boolean> | undefined>;
const draining = (jobGlobal[JOB_DRAINING_KEY] ??= { editorial: false, default: false });

export async function ensureJobsSchema() {
  const sql = await getSql();
  /*
    The statement list, not a sequence of awaits.

    Every writer below this line -- `reportProgress` on each stage boundary,
    `throwIfJobCancelled` between steps -- is called per document and per batch,
    not per job, and the old shape was twenty DDL round trips every time.
    `ensureSchemaOnce` (db.ts) is this repo's answer to exactly that: it records
    a fingerprint of this list IN the database, so a current schema costs two
    round trips, and a database that was dropped and rebuilt still reruns the
    batch because the marker table went with it. Nothing is cached in process
    memory, which is why a scratch PGLite database is safe here and a module
    boolean would not have been.

    The statements and their comments are unchanged; only how they are issued
    is. `jobs.test.ts`'s drift tests read this function's text, so each SQL
    statement stays whole in one string.
  */
  const statements = [
    `create table if not exists desk_jobs (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      kind text not null,
      subject_id integer not null default 0,
      model_choice text not null default 'auto',
      status text not null default 'queued',
      stage text not null default '',
      failover_note text not null default '',
      error text,
      result_json text not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )`,
    `create index if not exists desk_jobs_open_idx
      on desk_jobs (newsroom_id, kind, subject_id, status, id desc)`,
    // The same column + backfill + index as migrations/0019_job_lanes.sql, for
    // the same reason the 0017 index is declared twice: this covers the
    // embedded PGLite path where migrations do not run.
    // `jobs.test.ts` asserts the two definitions agree. Audit finding ENG-105.
    `alter table desk_jobs add column if not exists lane text`,
    `update desk_jobs
    set lane = case when kind = 'editorial' then 'editorial' else 'default' end
    where lane is null`,
    `create index if not exists desk_jobs_lane_idx
      on desk_jobs (lane, status, id asc)`,
    /*
      The same partial unique index as migrations/0017_one_open_job.sql.

      It has to be in both places: the migration covers a real Postgres, this
      covers the embedded PGLite path where migrations do not run. Declared
      twice is a drift risk, so `jobs.test.ts` asserts the two definitions match
      -- a duplicated invariant that nobody checks is how the last one failed.

      This is what makes enqueueJob race-safe; the findOpenJob check above is
      only an optimisation. Audit finding ENG-004.
    */
    `create unique index if not exists desk_jobs_one_open_per_subject
      on desk_jobs (newsroom_id, kind, subject_id)
      where status in ('queued', 'running')`,
    // Identifies WHICH execution owns a running row. Without it a stale-reclaim
    // and the original executor both write results for the same job.
    `alter table desk_jobs add column if not exists claim_token text`,
    `alter table desk_jobs add column if not exists research_scope text not null default 'public'`,
    `alter table desk_jobs add column if not exists draft_batch_id integer`,
    `alter table desk_jobs add column if not exists model_choice text not null default 'auto'`,
    // The same column as migrations/0026_model_choice_source.sql, for the same
    // reason model_choice itself is declared twice: this covers the embedded
    // PGLite path where migrations do not run.
    `alter table desk_jobs add column if not exists model_choice_source text not null default 'editor'`,
    // The same column as migrations/0032_job_failover_note.sql, for the same
    // reason model_choice_source itself is declared twice: this covers the
    // embedded PGLite path where migrations do not run.
    `alter table desk_jobs add column if not exists failover_note text not null default ''`,
    /*
      The same columns as migrations/0099_desk_job_progress.sql, for the same
      reason every column above is declared twice: this covers the embedded
      PGLite path where migrations do not run. Structured progress is what the
      JobCard renders, so a desk running on PGLite without these would show a
      card with no stages, no bar and no stall rule at all -- the drift would be
      visible on screen rather than only in a diff. `jobs.test.ts` asserts the
      two definitions agree.
    */
    `alter table desk_jobs add column if not exists stages_json text`,
    `alter table desk_jobs add column if not exists stage_index integer`,
    `alter table desk_jobs add column if not exists pct integer`,
    `alter table desk_jobs add column if not exists step_text text`,
    `alter table desk_jobs add column if not exists beat_at timestamptz`,
    `alter table desk_jobs add column if not exists cancel_requested boolean not null default false`,
    `alter table desk_jobs add column if not exists result_href text`,
    `create index if not exists desk_jobs_running_idx
      on desk_jobs (newsroom_id, id desc)
      where status in ('queued', 'running')`,
  ];
  await ensureSchemaOnce(sql, "desk-jobs", statements);
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

export function scanDispatchMode(
  job: Pick<DeskJob, "model_choice_source">,
  hasDailyReservation: boolean,
): "scheduled" | "manual" {
  if (hasDailyReservation) return "scheduled";
  if (job.model_choice_source === "scheduled")
    throw new Error("Scheduled scan reservation is missing; refusing unguarded execution.");
  return "manual";
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
  } else if (job.kind === "reconcile") {
    const { performDraftReconcileWork } = await import("./draft-reconcile.server.ts");
    await performDraftReconcileWork(job);
  } else if (job.kind === "scan") {
    const daily = await import("./daily-scan.server.ts");
    const mode = scanDispatchMode(job, await daily.isDailyScanJob(job));
    if (mode === "scheduled") await daily.performDailyScanWork(job);
    else {
      const { performScanWork } = await import("./desk.ts");
      await performScanWork(job);
    }
  } else if (job.kind === "dark") {
    const { performDarkRound } = await import("./dark.ts");
    await performDarkRound(job);
  } else if (job.kind === "brief") {
    const { performBriefWork } = await import("./dark.ts");
    await performBriefWork(job);
  } else if (job.kind === "editorial") {
    const { performEditorialWork } = await import("./editorial.server.ts");
    await performEditorialWork(job);
  } else if (job.kind === "routine-notice") {
    const { performRoutineNoticeWork } = await import("./routine-notice-worker.server.ts");
    await performRoutineNoticeWork(job);
  } else if (job.kind === "artifact-ocr") {
    const { performArtifactOcrWork } = await import("./dark.ts");
    await performArtifactOcrWork(job);
  } else if (job.kind === "pull") {
    const { performPullWork } = await import("./pull.server.ts");
    await performPullWork(job);
  } else if (job.kind === "audio-transcribe") {
    const { performAudioTranscribeWork } = await import("./textflowkit-transcribe.server.ts");
    await performAudioTranscribeWork(job);
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
    select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error, result_json,
           stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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
          select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error, result_json,
                 stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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
          select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error, result_json,
                 stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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
  researchScope?: "public" | "supplied";
  /** Narrow job-specific input/result receipt for a queued artifact OCR read. */
  resultJson?: string;
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
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, lane, status, stage, result_json)
    values (${newsroomId}, ${opts.userId}, ${opts.kind}, ${opts.subjectId}, ${opts.modelChoice ?? "auto"}, ${opts.modelChoiceSource ?? "editor"}, ${opts.researchScope ?? "public"}, ${lane}, ${"queued"}, ${"Queued"}, ${opts.resultJson ?? "{}"})
    on conflict do nothing
    returning id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error,
              stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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
      insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, lane, status, stage, result_json)
      values (${newsroomId}, ${opts.userId}, ${opts.kind}, ${opts.subjectId}, ${opts.modelChoice ?? "auto"}, ${opts.modelChoiceSource ?? "editor"}, ${opts.researchScope ?? "public"}, ${lane}, ${"queued"}, ${"Queued"}, ${opts.resultJson ?? "{}"})
      on conflict do nothing
      returning id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error,
              stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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
  /*
    Every stage boundary in the app already funnels through this function --
    story-documents, report.ts, investigate, dark-verify, scan-model-run, the
    editorial and reconcile workers and all the rest call `setStage`, which is
    this. So this is where structured progress starts for all of them: one
    delegation here is what makes "called at every existing stage boundary" true
    of the whole job surface at once, instead of sixty edits that the next new
    worker would forget to copy.

    A worker that holds its own job row should use `progressReporterFor(job)`
    instead: same delegation, plus the stage index that sentence implies, which
    this function cannot know because it was handed an id and not a row.
  */
  await reportProgress(id, { step: stage });
}

/**
 * The durable twin of `setJobStage`. `stage` is transient -- "Done"
 * overwrites it once the job finishes, so by the time an editor looks at a
 * completed draft the reason it switched providers is already gone. This
 * writes the same sentence into a column nothing else overwrites, so it is
 * still there after the job is Done and the story view can show it.
 */
export async function setJobFailoverNote(id: number, note: string) {
  const sql = await getSql();
  await sql`
    update desk_jobs set failover_note = ${note}, updated_at = now() where id = ${id}
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

/** Persist a technical provider switch together with the effort that is valid
 * for the destination model. Keeping both in one write prevents a reclaimed
 * job from pairing the new provider with the old provider's unsupported level. */
export async function setJobModelRuntime(
  id: number,
  modelChoice: string,
  modelEffort: string | null,
  requestedRuntime?: string,
  requestedEffort?: string | null,
  phase?: "documents" | "writer" | "checker",
) {
  const sql = await getSql();
  await sql.query(
    `with current as (
       select id, model_choice as previous_choice,
              coalesce(nullif(result_json,'')::jsonb,'{}'::jsonb) as payload
       from desk_jobs where id=$1
     ), receipt as (
       select id,
         jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 payload,
                 '{requestedRuntime}',
                 case when payload ? 'requestedRuntime' then payload->'requestedRuntime'
                      else to_jsonb(coalesce($4::text, previous_choice)) end,
                 true
               ),
               '{requestedEffort}',
               case when payload ? 'requestedEffort' then payload->'requestedEffort'
                    when $4::text is not null then coalesce(to_jsonb($5::text),'null'::jsonb)
                    else coalesce(payload->'modelEffort','null'::jsonb) end,
               true
             ),
               '{actualRuntime}',
               case when $6::text = 'checker' and payload ? 'actualRuntime'
                    then payload->'actualRuntime'
                    else to_jsonb($2::text) end,
               true
           ),
           '{modelEffort}',
           case when $6::text = 'checker' and payload ? 'modelEffort'
                then payload->'modelEffort'
                else coalesce(to_jsonb($3::text),'null'::jsonb) end,
           true
         ) as payload
       from current
     )
     update desk_jobs j
       set model_choice=case when $6::text = 'checker' then j.model_choice else $2 end,
           result_json=(case when $6::text is null then receipt.payload else
             jsonb_set(
               receipt.payload,
               '{runtimeByStage}',
               coalesce(receipt.payload->'runtimeByStage','{}'::jsonb) ||
                 jsonb_build_object($6::text, jsonb_build_object(
                   'modelChoice', $2::text,
                   'modelEffort', coalesce(to_jsonb($3::text),'null'::jsonb)
                 )),
               true
             )
           end)::text,
           updated_at=now()
     from receipt where j.id=receipt.id`,
    [id, modelChoice, modelEffort, requestedRuntime ?? null, requestedEffort ?? null, phase ?? null],
  );
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
            select id, newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, draft_batch_id, lane, status, stage, failover_note, error, result_json,
                   stages_json, stage_index, pct, step_text, beat_at, cancel_requested, result_href,
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

/**
 * Startup reattachment for durable jobs.
 *
 * The normal drainer is intentionally invoked by enqueue kicks and the
 * unattended clock, but a restarted process must not wait for the next clock
 * tick before reclaiming work that was already durable. This sweep does not
 * invent a new state: it calls the same drainer, whose conditional claim on
 * queued rows or stale running rows is the existing idempotency guard. Two
 * concurrent starts therefore race through the same claim-token update; only
 * one can take a row. A fresh running row owned by another live process is
 * left alone because its heartbeat keeps updated_at inside the stale window.
 *
 * No PID is read or signalled here. ENG-06's ownership rule applies: a pid
 * persisted on a running row is not proof this process owns the child, so the
 * sweep adopts work only through the database claim, never through taskkill.
 */
export async function reattachDurableJobsOnStartup(): Promise<{ ran: number }> {
  return drainQueuedJobs();
}

export async function executeJob(job: DeskJob): Promise<boolean> {
  const sql = await getSql();
  const token = mintClaimToken();
  /*
    The stage list is part of the claim, and the row handed to the worker below
    carries it. Both halves matter: written any later, the first boundaries of a
    fast job would report an index into a list nobody had stored yet; handed to
    the worker from the stale `job` argument instead, `stageIndexFor` would be
    reading the null it arrived with and every chip after the first would be
    missing.
  */
  const stages = JOB_STAGE_LISTS[job.kind] ?? null;
  const claimed = await sql<{ id: number }>`
    update desk_jobs
    set status = ${"running"}, stage = ${"Working…"}, claim_token = ${token},
        started_at = coalesce(started_at, now()), updated_at = now(),
        beat_at = now(),
        stages_json = ${stages && stages.length ? JSON.stringify(stages) : null},
        stage_index = 0
    where id = ${job.id}
      and (
        status = ${"queued"}
        or (status = ${"running"} and updated_at < now() - make_interval(secs => ${STALE_RUNNING_SECONDS}))
      )
    returning id
  `;
  if (!claimed[0]) return false;
  const seeded: DeskJob = {
    ...job,
    stages_json: stages && stages.length ? JSON.stringify(stages) : null,
    stage_index: 0,
  };

  /*
    Claiming IS the worker's first sign of life, so `beat_at` starts here
    rather than at the first stage boundary: a job whose lead-in work (loading
    the packet, reading the memory, fetching the meeting material) takes a
    minute should not look quiet merely because it has not reached a stage yet.

    `stage_index` is seeded to 0 only for a kind that HAS a list, and the list
    is cleared for one that does not -- a reclaimed row from an older build
    must not keep chips for a vocabulary this build no longer reports. Null
    means "no stage list", which is what the card renders as no chip row.
  */

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
    /*
      Cancelled before we even started. The editor can press Cancel on a queued
      row, and nothing else would ever notice -- the row would sit queued until
      the drainer claimed it, run to completion, and produce a draft nobody
      asked for. Checked fresh rather than from `job`, whose copy was read
      before the claim.
    */
    await throwIfJobCancelled(job.id);
    await runWork({ ...seeded, claim_token: token });
    // `claim_token` guard: if we were declared stale and someone else took the
    // job, this write must not clobber their result.
    // Derive the editor-facing terminal stage from the receipt in the same
    // database write that completes the job. The final draft and receipt are
    // committed by performDraftWork immediately before this; a separate read
    // can race connection visibility and briefly turn a review-required draft
    // into a misleading "Done". The persisted receipt is the authority.
    await sql`
      update desk_jobs
      set status = ${"completed"},
          stage = case
            when coalesce((result_json::jsonb -> 'quality' ->> 'reviewRequired')::boolean, false)
              or coalesce((result_json::jsonb ->> 'evidenceCheckIncomplete')::boolean, false)
              or result_json::jsonb -> 'quality' ->> 'citationStatus' = 'review-required'
            then ${"Draft saved — review required"}
            else ${"Done"}
          end,
          error = null, finished_at = now(), updated_at = now()
      where id = ${job.id} and status = ${"running"} and claim_token = ${token}
    `;
  } catch (err) {
    /*
      A cancel is not a crash. It is recorded as a failure because the card has
      no other terminal state for "this stopped without a result", but the
      reason written is the honest one, so the editor sees "Cancelled by the
      editor" with Retry beside it instead of a stack trace.
    */
    const raw =
      err instanceof JobCancelledError
        ? JOB_CANCELLED_REASON
        : err instanceof Error
          ? err.message
          : "Job failed";
    await sql`
      update desk_jobs
      set status = ${"failed"}, error = ${raw.slice(0, 800)}, finished_at = now(), updated_at = now()
      where id = ${job.id} and status = ${"running"} and claim_token = ${token}
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

/* ---------------------------------------------------------------------------
   Structured progress (migration 0099, redesign phase 3)

   The design asks every job for seven things it could not answer from `stage`
   alone: an ordered stage list, the position in it, an optional percent, a
   one-line "now" step, the last time the worker actually said something, a way
   for the editor to ask it to stop, and where the result landed. The columns
   are in 0099; everything that reads or writes them lives below, so there is
   exactly one place to look when a card shows something odd.

   THE ONE INVARIANT THAT MATTERS: `beat_at` must move while a worker is
   genuinely alive and must NOT move when it is not. `executeJob` seeds it at
   claim time and nothing else writes it except `reportProgress` and the
   waiting ticker. In particular the 30s `updated_at` heartbeat deliberately
   does NOT touch it -- if it did, the quiet time could never reach 60s and the
   stall state the design asks for would be unreachable. See the note on
   `waitForModel` for the other half of that contract.
--------------------------------------------------------------------------- */

/**
 * What the editor asked a job to stop, and what a stopped worker records as
 * the reason. Spelled once: `desk_jobs.error` and the JobCard's failed state
 * both read it, and a test asserts the exact string.
 */
export const JOB_CANCELLED_REASON = "Cancelled by the editor";

/**
 * How often a worker speaks up while it waits on a model. The design says
 * 10-15s; 12 sits in the middle and is comfortably under `JOB_STALL_SECONDS`,
 * so a live worker can miss three ticks in a row before anything calls it
 * quiet.
 */
export const JOB_TICK_MS = 12_000;

/**
 * Raised by `throwIfJobCancelled` at a step boundary. `executeJob` catches it
 * and records `JOB_CANCELLED_REASON` as the failure reason: the design's card
 * has three states (running, done, failed) and no cancelled one, so a job the
 * editor stopped is a failed job whose real reason is that the editor stopped
 * it -- which is exactly what the card renders, Retry buttons and all.
 */
export class JobCancelledError extends Error {
  constructor() {
    super(JOB_CANCELLED_REASON);
    this.name = "JobCancelledError";
  }
}

/**
 * Parse `stages_json`. Null (never reported) and malformed both answer null --
 * a card with no stage list renders its single `stage` sentence, which is what
 * every row written before 0099 does, so neither case is special-cased
 * anywhere downstream.
 */
export function jobStages(
  job: Pick<DeskJob, "stages_json"> | null | undefined,
): string[] | null {
  const raw = job?.stages_json;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const labels = parsed.filter((s): s is string => typeof s === "string");
    return labels.length ? labels : null;
  } catch {
    return null;
  }
}

/**
 * Each kind's stage list, in the order the worker walks it.
 *
 * THE RULE, and it is the whole reason this table can be trusted: every phrase
 * here must be a string the worker actually writes through the reporter -- see
 * `progressReporterFor`. The card cannot then show a chip that contradicts the
 * "Now:" line beside it, because the chip IS that line, remembered. A phrase
 * nothing ever writes is a chip that never lights up: a stage the editor waits
 * for and never sees finish.
 *
 * That is also why the lists are shorter than the workers' vocabulary: these
 * are the arrivals, and the sentences in between ("Interpreting packet.pdf:
 * part 2 of 7") move the step line without moving the chip.
 *
 * A kind with no entry reports its step and heartbeats exactly like the others;
 * it simply has no chip row, which is what `stages_json` null means everywhere.
 */
export const JOB_STAGE_LISTS: Partial<Record<JobKind, readonly string[]>> = {
  draft: [
    "Opening source material",
    "Looking for primary sources",
    "Planning the reporting",
    "Writing the draft",
    "Checking the draft against the evidence",
    "Connecting the story to saved sources",
  ],
  reconcile: [
    "Checking the saved draft against the evidence",
    "Reconciling the draft with the saved evidence",
  ],
};

/**
 * Where `step` sits in this job's stage list, or undefined.
 *
 * Read off the row the worker was already handed, not out of the database: the
 * list is written once when the job is claimed and never changes during the
 * run, so the copy the worker holds is the copy the card is reading. Undefined
 * means "this sentence is not an arrival at a stage" -- a failover note, a
 * per-document message -- and `reportProgress` leaves `stage_index` alone for
 * it, which keeps the chip row on the last stage the job actually reached.
 */
export function stageIndexFor(
  job: Pick<DeskJob, "stages_json"> | null | undefined,
  step: string,
): number | undefined {
  const stages = jobStages(job);
  if (!stages) return undefined;
  const at = stages.indexOf(step);
  return at < 0 ? undefined : at;
}

/**
 * `setJobStage` for a worker that is holding its own job row. Every worker has
 * one of these in scope, so this is the one line that gives the whole job
 * surface a stage index as well as a sentence, without any of the sixty
 * boundaries having to know its own position in a list.
 */
export function progressReporterFor(
  job: DeskJob,
): (step: string) => Promise<void> {
  return (step) => reportProgress(job.id, { step, stageIndex: stageIndexFor(job, step) });
}

/**
 * Percent, clamped. A worker that computes 103% of a batch, or -1 from an
 * off-by-one, must not paint a bar outside its track or print "Now: -1%"; the
 * clamp is here rather than at each call site so no future call site can
 * forget it. Null and undefined both mean "no percentage" (indeterminate bar).
 */
export function clampPct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * The one helper the kickoff names. Every argument is optional and the
 * distinction between "absent" and "null" is load-bearing:
 *
 *   absent (undefined) -- leave that column exactly as it is
 *   null               -- clear it (`pct` null is the indeterminate bar)
 *
 * It always bumps `beat_at`, which is the whole point: a worker calling this is
 * a worker that is alive.
 *
 * "Absent" means `undefined` and NOT merely "the key is missing from the
 * object literal". `progressReporterFor` builds its argument as
 * `{ step, stageIndex: stageIndexFor(...) }`, and that expression produces the
 * key with an `undefined` VALUE for every sentence that is not a stage arrival
 * -- a failover note, a per-packet line. An `in` test would call that "present"
 * and clear the chip row on every such sentence, so a job that had reached
 * stage 3 would flash back to "no stage list" twice a minute. The three
 * `!== undefined` tests below are what make the documented contract true for
 * that caller, which cannot avoid naming the key.
 */
export async function reportProgress(
  jobId: number,
  progress: {
    stageIndex?: number | null;
    pct?: number | null;
    step?: string | null;
  },
): Promise<void> {
  await ensureJobsSchema();
  const sql = await getSql();
  const hasIndex = progress.stageIndex !== undefined;
  const hasPct = progress.pct !== undefined;
  const hasStep = progress.step !== undefined;
  await sql`
    update desk_jobs
    set stage_index = case when ${hasIndex} then ${progress.stageIndex ?? null}::integer else stage_index end,
        pct = case when ${hasPct} then ${clampPct(progress.pct)}::integer else pct end,
        step_text = case when ${hasStep} then ${progress.step ?? null}::text else step_text end,
        beat_at = now()
    where id = ${jobId}
  `;
}

/**
 * The stage list, written once when a job kind starts. Kept separate from
 * `reportProgress` so the boundary calls stay the three-argument shape the
 * kickoff specifies and a worker cannot accidentally rewrite the list on every
 * tick.
 */
export async function setJobStages(id: number, stages: string[] | null) {
  await ensureJobsSchema();
  const sql = await getSql();
  await sql`
    update desk_jobs
    set stages_json = ${stages && stages.length ? JSON.stringify(stages) : null},
        stage_index = 0,
        beat_at = now()
    where id = ${id}
  `;
}

/**
 * The editor pressed Cancel. This asks; it does not take the job away. The
 * worker notices at its next step boundary and stops with
 * `JOB_CANCELLED_REASON`. A worker that has already died never sees the flag,
 * which is why the stalled state offers "Retry on next model" as well.
 */
export async function requestJobCancel(id: number) {
  await ensureJobsSchema();
  const sql = await getSql();
  await sql`
    update desk_jobs set cancel_requested = true, updated_at = now() where id = ${id}
  `;
}

/** Read the flag fresh. A worker's own copy of the row is from claim time. */
export async function jobCancelRequested(id: number): Promise<boolean> {
  await ensureJobsSchema();
  const sql = await getSql();
  const rows = await sql<{ cancel_requested: boolean | null }>`
    select cancel_requested from desk_jobs where id = ${id}
  `;
  return rows[0]?.cancel_requested === true;
}

/**
 * Between steps: stop if the editor asked us to. Call this before starting
 * each step, never in the middle of one -- the design's rule is that a
 * cancelled job stops at a boundary, so it never leaves a half-written batch
 * or a half-saved document behind.
 */
export async function throwIfJobCancelled(jobId: number): Promise<void> {
  if (await jobCancelRequested(jobId)) throw new JobCancelledError();
}

/**
 * The stall rule, as one pure function so both the card and the server-side
 * tests can use the same clock. `running` only: a queued job has not started
 * and a finished job is not stalled, it is finished. A job that never reported
 * (`beat_at` null) is never called stalled -- there is no evidence either way,
 * and the reclaim window is still the thing that will deal with it.
 */
export function jobProgressStalled(
  job: Pick<DeskJob, "status" | "beat_at"> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!job) return false;
  if (job.status !== "running") return false;
  if (!job.beat_at) return false;
  const beat = Date.parse(job.beat_at);
  if (Number.isNaN(beat)) return false;
  return nowMs - beat >= JOB_STALL_SECONDS * 1000;
}

/**
 * Run one model call that may outlast the stall window, while telling the desk
 * it is still going: "Waiting on Codex Sol · 42s", once a tick.
 *
 * THIS IS THE OTHER HALF OF THE `beat_at` CONTRACT. A call that is not wrapped
 * here is a call during which the worker says nothing, so a slow model and a
 * dead process look identical from outside and the card will offer the editor
 * "Retry on next model" for a job that is working perfectly. Every await on a
 * model, an OCR pass or a transcription that can run past 60s goes through
 * this. The ticker is `unref`ed so it never holds the process open by itself,
 * and it stops before the caller's own terminal writes (see `executeJob`).
 *
 * THIS IS ALSO WHERE CANCEL REACHES A CALL IN FLIGHT. A twenty-minute model
 * call has no stage boundary in it, so before this the editor's Cancel did
 * nothing at all until the model answered -- the button was honest and useless.
 * The same tick that reports progress asks whether the editor has asked to
 * stop, and if so abandons the wait with `JobCancelledError`. The underlying
 * call is not killed (nothing here can kill a provider's socket); it is left to
 * finish and its result discarded, which is what "stop cleanly at the next
 * boundary" means for a boundary that is inside an await.
 *
 * `now`, `report` and `cancelPoll` are injection seams: the tests drive a fake
 * clock instead of waiting 12 real seconds, and assert on the reported steps.
 */
export async function waitForModel<T>(opts: {
  jobId: number;
  /**
   * Editor-facing label, already resolved ("Codex Sol", "textflowkit"). A
   * function is accepted for the callers whose model can change while the call
   * is in flight -- the scan and OCR paths hand the work to the failover helper
   * inside `run`, and a ticker still naming the rung that already failed would
   * be telling the editor something untrue about the call they are waiting on.
   */
  label: string | (() => string);
  /** The await itself. Any model, OCR or transcription call is a candidate. */
  run: () => Promise<T>;
  tickMs?: number;
  now?: () => number;
  report?: typeof reportProgress;
  cancelPoll?: (jobId: number) => Promise<boolean>;
}): Promise<T> {
  const tick = opts.tickMs ?? JOB_TICK_MS;
  const now = opts.now ?? (() => Date.now());
  const report = opts.report ?? reportProgress;
  const cancelPoll = opts.cancelPoll ?? jobCancelRequested;
  const labelNow = () => (typeof opts.label === "function" ? opts.label() : opts.label);
  const startedAt = now();
  let cancelled = false;
  let rejectCancel: (err: JobCancelledError) => void = () => undefined;
  const cancelSignal = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  // Handled up front so that a run which finishes first does not leave this
  // rejection loose once the ticker stops.
  void cancelSignal.catch(() => undefined);
  const say = () => {
    const seconds = Math.max(0, Math.floor((now() - startedAt) / 1000));
    void report(opts.jobId, { step: `Waiting on ${labelNow()} · ${seconds}s` }).catch(
      () => undefined,
    );
  };
  // Speak once immediately: a worker entering a model call right after a long
  // stretch of local work is alive now, and the card should show that at once
  // rather than 12 seconds later.
  say();
  const timer = setInterval(() => {
    say();
    void cancelPoll(opts.jobId)
      .then((yes) => {
        // Once only: the ticker keeps firing until `finally`, and the second
        // rejection would be a loose one.
        if (yes && !cancelled) {
          cancelled = true;
          rejectCancel(new JobCancelledError());
        }
      })
      .catch(() => undefined);
  }, tick);
  (timer as unknown as { unref?: () => void }).unref?.();
  const run = opts.run();
  try {
    return await Promise.race([run, cancelSignal]);
  } finally {
    clearInterval(timer);
    if (cancelled) {
      /*
        The abandoned call will still settle, usually by rejecting -- a provider
        socket closing, a timeout firing. Nobody is left to hear it, and an
        unhandled rejection here would take the process down over a job the
        editor already stopped on purpose.
      */
      void run.catch(() => undefined);
    }
  }
}
