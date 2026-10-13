import { getSql } from "../db.ts";
import { ensureFollowUpsSchema, performDueFollowUps, performFollowUpAction, performReadFollowUp, performReleaseFollowUpRun } from "./follow-ups.ts";
import { enqueueJob, type JobKind, type JobStatus } from "./jobs.ts";
import { FOLLOW_UP_HARD_CAP_MS } from "./follow-up-agents.ts";

/**
 * When a follow-up runs. One in-app tick, the same shape as the daily scan's
 * (`tickDailyScans`, ./daily-scan.server.ts) and driven by the same clocks:
 * `startUnattendedScheduler()` in the built server and the dev Vite plugin --
 * no Windows scheduled task, no second service, no operator setup.
 *
 * THE PATTERN IS THE SCAN'S, THE FENCES ARE NEW. The scan has a policy table
 * and a reservation table, so "has today's run happened?" is a row. A
 * follow-up has neither: it carries `next_run_at` itself, and the job queue is
 * the only ledger. Two consequences:
 *
 *  - `performDueFollowUps` (./follow-ups.ts) is the whole of "is it due", and
 *    it excludes a row already `running`, so a run in flight is not picked
 *    again on the next tick.
 *  - The checks in this file avoid queueing work when a blocker is already
 *    visible. They are only a preflight: concurrent callers can both pass
 *    them, so `executeJob` in jobs.ts makes the final atomic database claim.
 *    That claim serializes follow-ups and gives queued drafts priority over
 *    follow-ups in the same newsroom.
 *
 * Why the draft fence: a follow-up that shares a newsroom with an in-flight
 * draft would compete for the same provider budget and the same lane, and the
 * draft is the editor's foreground work. The scheduler checks this early for
 * a clear skip result; the job claim enforces it when workers actually start.
 *
 * Why the `running` reconcile: a process that dies mid-run leaves a row whose
 * `last_state` says `running` and whose job is gone. Nothing else ever clears
 * it -- not the job machinery, which knows only about `desk_jobs` -- so the
 * follow-up would be wedged forever. `performReconcileFollowUpRuns` below is
 * that repair, and its window is deliberately wider than the run's own hard
 * cap (`FOLLOW_UP_HARD_CAP_MS`, ten minutes) so a slow-but-alive run can never
 * be mistaken for a dead one.
 */

/**
 * How long a `running` row with no job behind it is left alone before it is
 * put back. Twenty minutes: twice the ten-minute hard cap on a run, so the
 * only way to reach it is a worker that really did stop.
 */
export const FOLLOW_UP_STALE_RUN_MS = 20 * 60_000;

export type FollowUpTickResult = {
  started: number;
  reconciled: number;
  /** Which fence stopped this newsroom, or null when it was simply not due. */
  skipped: "draft-running" | "follow-up-running" | null;
};

/**
 * Put a `running` follow-up whose worker is gone back to `waiting`.
 *
 * The condition is the job, not the clock alone: a row is only stale when it
 * says `running`, its `updated_at` is older than the window, AND no `follow-up`
 * job for it is queued or running. The last clause is what makes this safe to
 * run every tick and in every process -- a live run in another server is
 * covered by its own job row, whatever this process believes about time.
 *
 * `performReleaseFollowUpRun` is the writer rather than an inline update, so
 * the reason lands in `finding_json` the same way it does after a cancel, and
 * `next_run_at` moves a full interval out instead of retrying at once.
 */
export async function performReconcileFollowUpRuns(
  newsroomId: number,
  now: Date = new Date(),
  staleMs = FOLLOW_UP_STALE_RUN_MS,
): Promise<number> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const cutoff = new Date(now.getTime() - staleMs).toISOString();
  const rows = await sql<{ id: number; user_id: string }>`
    select f.id, f.user_id
    from follow_ups f
    where f.newsroom_id = ${newsroomId}
      and f.status = 'active'
      and f.last_state = 'running'
      and f.updated_at < ${cutoff}
      and not exists (
        select 1 from desk_jobs j
        where j.newsroom_id = f.newsroom_id and j.kind = 'follow-up'
          and j.subject_id = f.id and j.status in ('queued', 'running')
      )
    order by f.id asc
    limit 20
  `;
  for (const row of rows) {
    await performReleaseFollowUpRun(
      { userId: row.user_id, newsroomId },
      row.id,
      "The run stopped before it finished. Nothing was recorded.",
    );
  }
  return rows.length;
}

/** Is a job of this kind open in this newsroom? The two fences, one query. */
async function jobOpen(newsroomId: number, kind: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query(
    "select 1 from desk_jobs where newsroom_id=$1 and kind=$2 and status in ('queued','running') limit 1",
    [newsroomId, kind],
  );
  return rows.length > 0;
}

/** Plain names for the kinds that can block a follow-up. */
const BLOCKING_JOB_NAMES: Partial<Record<JobKind, string>> = {
  draft: "story draft",
  editorial: "editorial",
  "follow-up": "follow-up check",
  scan: "scan",
  dark: "Dark Desk dig",
  reconcile: "story draft",
};

/**
 * FC10 (Oct 11 walk): the open job that holds a follow-up back, named for the
 * editor -- its kind and whether it is QUEUED or RUNNING.
 *
 * The old refusal said only "a draft is being written right now", which was
 * wrong on two counts the walk saw. It matched a QUEUED draft as if it were
 * being written, and it never named what was actually holding the desk -- the
 * health panel's one running job was a scan, and the drafts were only queued.
 *
 * The claim rule in jobs.ts is what really serializes this: a `follow-up` job
 * waits while any `draft` is queued or running in the newsroom, and waits for
 * any other `follow-up` to finish. A `draft` also waits while a `follow-up` is
 * running. So the blocker is whatever open job stands between this one and its
 * turn; this reads it so the message can say which, rather than naming a fence
 * by guess.
 *
 * A queued draft is preferred over a running one in the result because that is
 * the case the old copy got wrong: the editor needs to know the wait is behind
 * a queue, not behind active writing.
 */
export async function followUpBlocker(
  newsroomId: number,
): Promise<{ kind: JobKind; status: JobStatus; name: string } | null> {
  const sql = await getSql();
  const rows = await sql<{ kind: JobKind; status: JobStatus }>`
    select kind, status from desk_jobs
    where newsroom_id = ${newsroomId}
      and status in ('queued', 'running')
      and kind in ('draft', 'follow-up')
    order by (status = 'running') desc, id asc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { kind: row.kind, status: row.status, name: BLOCKING_JOB_NAMES[row.kind] ?? "job" };
}

/**
 * One newsroom's tick: reconcile, check the two fences, start at most one due
 * follow-up.
 *
 * "At most one" is a hard one here rather than a drain: the tick starts a
 * single job and returns. The next job starts on the next tick, and only once
 * the previous one has finished -- which the fence below guarantees, because a
 * running `follow-up` job is exactly what the next tick sees. Nothing in this
 * file waits for a run, so a ten-minute run cannot hold a scheduler tick open.
 */
export async function tickFollowUpsFor(
  newsroomId: number,
  now: Date = new Date(),
  deps: { kick?: boolean } = {},
): Promise<FollowUpTickResult> {
  const reconciled = await performReconcileFollowUpRuns(newsroomId, now);
  // The draft fence first: it is the more important of the two to report.
  if (await jobOpen(newsroomId, "draft")) {
    return { started: 0, reconciled, skipped: "draft-running" };
  }
  if (await jobOpen(newsroomId, "follow-up")) {
    return { started: 0, reconciled, skipped: "follow-up-running" };
  }
  const due = await performDueFollowUps(newsroomId, now, 1);
  const row = due[0];
  if (!row) return { started: 0, reconciled, skipped: null };

  // `modelChoiceSource: "auto"` and not "editor": the model comes from the
  // follow-up's own saved pick and the phase 5 resolution order, not from a
  // decision made at this moment. The worker re-resolves it from the row (the
  // row is authoritative, so an edit between enqueue and run is honored) and
  // this column is what the queue card shows meanwhile.
  await enqueueJob({
    userId: row.user_id,
    newsroomId,
    kind: "follow-up",
    subjectId: row.id,
    modelChoice: row.model_choice,
    modelChoiceSource: "auto",
    kick: deps.kick,
  });
  return { started: 1, reconciled, skipped: null };
}

/**
 * "Run now" / "Retry now": start one named follow-up, through the same fences
 * and the same queue as the clock.
 *
 * This is deliberately not a second way to run an agent. It reconciles, checks
 * the same two fences, moves the row to due with the same
 * `performFollowUpAction` the card's other buttons use, and enqueues the same
 * `follow-up` job the tick enqueues -- so a run started by a press is
 * indistinguishable, in the queue and in the row, from one the clock started.
 * What it does NOT do is wait: it returns as soon as the job is queued, and the
 * card's inline progress takes over from there.
 *
 * The brief's rule is that follow-ups run one at a time and never alongside a
 * running draft, and an editor pressing Run now twice on two cards is exactly
 * how that rule would be broken. That rule is kept -- but by the QUEUE, not by
 * a refusal. The job claim in jobs.ts already holds a `follow-up` behind any
 * queued or running draft and behind any other running `follow-up`, so a press
 * that lands while the desk is busy is added to the queue and runs in its turn.
 *
 * FC10 (Oct 11 walk): it used to refuse instead, and the refusal was wrong.
 * `jobOpen(...,"draft")` matched a QUEUED draft as if a draft were being
 * written, so a press was turned away while the only running job on the health
 * panel was a scan; and it never named the real blocker. A press now queues and
 * succeeds, and the caller can say what it is waiting behind -- `followUpBlocker`
 * above names that job, its kind and whether it is queued or running.
 *
 * A row that is `stopped` or `done` is still refused rather than resurrected --
 * that is what the card's Resume is for, and Stop has to mean stop. A manual ask
 * has no method and is refused too.
 */
export type FollowUpRunStart = {
  started: boolean;
  /**
   * Why a press did not start a NEW run: the row is gone or is not in a state
   * Run now may move. The two job fences below are no longer refusals -- a
   * queued press reports `queuedBehind` instead.
   */
  skipped: "not-found" | "not-active" | null;
  /**
   * The open job this press is queued behind, if any: its kind, whether it is
   * `queued` or `running`, and a plain name for the message.
   */
  queuedBehind?: { kind: JobKind; status: JobStatus; name: string } | null;
};

export async function startFollowUpRun(
  context: { userId: string; newsroomId: number },
  id: number,
  now: Date = new Date(),
  deps: { kick?: boolean } = {},
): Promise<FollowUpRunStart> {
  // Same repair the tick does first: a `running` row whose worker died would
  // otherwise be left saying running forever when nobody presses Run now.
  await performReconcileFollowUpRuns(context.newsroomId, now);
  const row = await performReadFollowUp(context, id);
  if (!row || !row.agent_kind) return { started: false, skipped: "not-found" };
  if (row.status !== "active" && row.status !== "paused") {
    return { started: false, skipped: "not-active" };
  }
  /*
    No refusal on the two fences. The press records the editor's request and
    the job claim holds it until the desk is free, so a busy desk costs a queue
    wait and not a lost request. Read the blocker now, before enqueue, so the
    caller can say what it is waiting behind.
  */
  const queuedBehind = await followUpBlocker(context.newsroomId);
  const moved = await performFollowUpAction(context, id, "run-now");
  /*
    `run-now` refuses a row that is no longer active or paused, so a Stop that
    committed between the read above and this write is reported as what it is
    rather than resurrected by a press the editor had already been refused. The
    read above already answered "not-found" for a missing row, so the only way
    to get here is a status that moved under us.
  */
  if (!moved.ok) return { started: false, skipped: "not-active" };
  await enqueueJob({
    userId: row.user_id,
    newsroomId: context.newsroomId,
    kind: "follow-up",
    subjectId: id,
    modelChoice: row.model_choice,
    modelChoiceSource: "auto",
    kick: deps.kick,
  });
  return { started: true, skipped: null, queuedBehind };
}

/**
 * Every newsroom with an agent follow-up, on the app's own clock.
 *
 * The newsroom list comes from `follow_ups` rather than from a policy table,
 * because there is no policy to configure: an editor who has one active agent
 * is a newsroom this tick has work for, and a paper with none costs one
 * `select distinct` and nothing else. A newsroom that stops having agents
 * falls out of the list by itself.
 *
 * One newsroom's failure must not stop the others -- the same reason the scan
 * tick pauses a policy and continues -- so each is caught and logged.
 */
export async function tickFollowUps(
  now: Date = new Date(),
  deps: { kick?: boolean } = {},
): Promise<{ newsrooms: number; started: number; reconciled: number }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql<{ newsroom_id: number }>`
    select distinct newsroom_id from follow_ups
    where status = 'active' and agent_kind is not null
    order by newsroom_id asc
  `;
  let started = 0;
  let reconciled = 0;
  for (const row of rows) {
    try {
      const result = await tickFollowUpsFor(row.newsroom_id, now, deps);
      started += result.started;
      reconciled += result.reconciled;
    } catch (err) {
      console.error(`[townreporter] follow-up tick failed for newsroom ${row.newsroom_id}:`, err);
    }
  }
  return { newsrooms: rows.length, started, reconciled };
}

/** Named so the report and the tests can point at the cap this build enforces. */
export const FOLLOW_UP_RUN_CAP_MS = FOLLOW_UP_HARD_CAP_MS;
