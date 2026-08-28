import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

export type JobKind = "scan" | "draft" | "dark";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export type DeskJob = {
  id: number;
  newsroom_id: number;
  user_id: string;
  kind: JobKind;
  subject_id: number;
  status: JobStatus;
  stage: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

let draining = false;

export async function ensureJobsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists desk_jobs (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      kind text not null,
      subject_id integer not null default 0,
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
  // Identifies WHICH execution owns a running row. Without it a stale-reclaim
  // and the original executor both write results for the same job.
  await sql.query(`alter table desk_jobs add column if not exists claim_token text`);
}

/**
 * How long a `running` row may go without a heartbeat before another drainer
 * treats it as abandoned. The heartbeat below fires far more often than this,
 * so only a genuinely dead process trips it.
 */
export const STALE_RUNNING_SECONDS = 120;
const HEARTBEAT_MS = 30_000;

/** Unique per execution. `randomUUID` is available on every supported runtime. */
function mintClaimToken(): string {
  return globalThis.crypto.randomUUID();
}

export async function latestJob(opts: {
  newsroomId: number;
  kind: JobKind;
  subjectId: number;
}): Promise<DeskJob | null> {
  await ensureJobsSchema();
  const sql = await getSql();
  const rows = await sql<DeskJob>`
    select id, newsroom_id, user_id, kind, subject_id, status, stage, error,
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
          select id, newsroom_id, user_id, kind, subject_id, status, stage, error,
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
          select id, newsroom_id, user_id, kind, subject_id, status, stage, error,
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
  const created = await sql<DeskJob>`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage)
    values (${newsroomId}, ${opts.userId}, ${opts.kind}, ${opts.subjectId}, ${"queued"}, ${"Queued"})
    returning id, newsroom_id, user_id, kind, subject_id, status, stage, error,
              created_at, updated_at, started_at, finished_at
  `;
  const job = created[0]!;
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

/** Finish queued (or stale running) jobs. Same process, or a cron wake-up. */
export async function drainQueuedJobs(): Promise<{ ran: number }> {
  if (draining) return { ran: 0 };
  draining = true;
  let ran = 0;
  try {
    await ensureJobsSchema();
    const sql = await getSql();
    for (let n = 0; n < 8; n++) {
      const next = await sql<DeskJob>`
        select id, newsroom_id, user_id, kind, subject_id, status, stage, error,
               created_at, updated_at, started_at, finished_at
        from desk_jobs
        where status = 'queued'
           or (status = 'running' and updated_at < now() - make_interval(secs => ${STALE_RUNNING_SECONDS}))
        order by id asc
        limit 1
      `;
      if (!next[0]) break;
      const took = await executeJob(next[0]);
      if (took) ran += 1;
    }
  } catch (err) {
    console.error("[jobs] drain failed", err);
  } finally {
    draining = false;
  }
  return { ran };
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
    if (job.kind === "draft") {
      const { performDraftWork } = await import("./desk.ts");
      await performDraftWork(job);
    } else if (job.kind === "scan") {
      const { performScanWork } = await import("./desk.ts");
      await performScanWork(job);
    } else if (job.kind === "dark") {
      const { performDarkRound } = await import("./dark.ts");
      await performDarkRound(job);
    }
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
