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

/** Claim one queued (or stale running) job. Two callers cannot both win. */
export async function claimNextJob(): Promise<DeskJob | null> {
  await ensureJobsSchema();
  const sql = await getSql();
  const claimed = await sql<DeskJob>`
    update desk_jobs
    set status = ${"running"},
        stage = ${"Working…"},
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = (
      select id from desk_jobs
      where status = 'queued'
         or (status = 'running' and updated_at < now() - interval '2 minutes')
      order by id asc
      limit 1
    )
    and (
      status = 'queued'
      or (status = 'running' and updated_at < now() - interval '2 minutes')
    )
    returning id, newsroom_id, user_id, kind, subject_id, status, stage, error,
              created_at, updated_at, started_at, finished_at
  `;
  return claimed[0] ?? null;
}

/** Finish queued (or stale running) jobs. Same process, or a cron wake-up. */
export async function drainQueuedJobs(): Promise<{ ran: number }> {
  if (draining) return { ran: 0 };
  draining = true;
  let ran = 0;
  try {
    for (let n = 0; n < 8; n++) {
      const next = await claimNextJob();
      if (!next) break;
      await executeJob(next);
      ran += 1;
    }
  } catch (err) {
    console.error("[jobs] drain failed", err);
  } finally {
    draining = false;
  }
  return { ran };
}

async function executeJob(job: DeskJob) {
  const sql = await getSql();
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
    await sql`
      update desk_jobs
      set status = ${"completed"}, stage = ${"Done"}, error = null, finished_at = now(), updated_at = now()
      where id = ${job.id}
    `;
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Job failed";
    await sql`
      update desk_jobs
      set status = ${"failed"}, error = ${raw.slice(0, 800)}, finished_at = now(), updated_at = now()
      where id = ${job.id}
    `;
  }
}

export function jobIsOpen(job: DeskJob | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}
