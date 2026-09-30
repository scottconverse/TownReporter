import { getSql, withTransaction, type Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { JOB_CANCELLED_REASON, ensureJobsSchema, jobHeartbeatStale } from "./jobs.ts";

/**
 * Stop: end a follow-up AND the run it has in flight, in one transaction.
 *
 * WHY THIS IS ITS OWN `.server.ts` MODULE. The write spans two tables --
 * `follow_ups` (the agent's own record) and `desk_jobs` (the run) -- and the
 * one thing that makes Stop safe is that they move TOGETHER: two writes leave a
 * window where a run can be queued against a row that is already stopped, which
 * is the Sept 28 audit's finding seen from the other side. The queue's module
 * is ./jobs.ts, and `follow-ups.ts` cannot import it: that file is reachable
 * from the client bundle (`desk.ts` re-exports `performFollowUpAction` to the
 * desk screens), and pulling `desk_jobs`' module -- which dynamically imports
 * every `*.server.ts` worker in the app -- into that graph fails the production
 * build's import-protection pass. The name is load-bearing in the same way
 * `follow-up-run.server.ts`'s is: the browser build drops a `.server`-named
 * dynamic import, so `follow-ups.ts` reaches this file from inside
 * `performFollowUpAction` and the browser never sees it.
 *
 * That is also why it does not import ./follow-ups.ts back: the caller ensures
 * the `follow_ups` schema (`performFollowUpAction` does, at the top), and the
 * only thing this module needs from there is that one table's name.
 *
 * `desk_jobs`' own schema is ensured here rather than assumed, the same way
 * every `perform*` function in ./follow-ups.ts ensures its table: a caller that
 * has never touched a job (a unit test, a fresh PGLite preview) must not find
 * the cancel statement missing its table.
 */

function owned(context: { newsroomId?: number }): number {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

/**
 * Cancel every run of one follow-up, inside the caller's transaction.
 *
 * Two statements because the two halves of "stop" are different promises to the
 * editor:
 *
 *  - A QUEUED run is cancelled outright. It has done nothing, so there is
 *    nothing to stop at a boundary, and the row moving to `failed` is what
 *    makes "a stopped follow-up's queued job must never start" true of the
 *    drainer's own `status = 'queued'` claim rather than of the worker
 *    remembering to look. `failed` with the job system's own cancellation
 *    sentence is exactly the terminal state `executeJob` already writes for a
 *    cancel (see `JOB_CANCELLED_REASON`), so nothing new had to be invented and
 *    every list of job statuses stays as it is.
 *  - A RUNNING one is ASKED to stop: `cancel_requested`, the same flag the job
 *    card's own Cancel writes through `requestJobCancel`. The worker hears it
 *    at its next unit of work (`throwIfJobCancelled`, which the agents call at
 *    every boundary and which wraps every model call), or -- if the Stop lands
 *    after that boundary -- the fenced result write refuses it. The job's
 *    terminal state is written by `executeJob` the way every cancel is.
 *
 * This is the shared half of Stop and of the job card's Cancel, so an editor
 * pressing either one cannot leave the other's row behind. The whole point of
 * the flag rather than a second status is that a run which is mid-model-call
 * cannot be reached any other way.
 */
async function cancelFollowUpRunsIn(
  tx: Sql,
  newsroomId: number,
  followUpId: number,
): Promise<void> {
  await tx`
    update desk_jobs
    set status = 'failed', error = ${JOB_CANCELLED_REASON}, finished_at = now(),
        cancel_requested = true, updated_at = now()
    where newsroom_id = ${newsroomId} and kind = 'follow-up' and subject_id = ${followUpId}
      and status = 'queued'
  `;
  await tx`
    update desk_jobs
    set cancel_requested = true, updated_at = now()
    where newsroom_id = ${newsroomId} and kind = 'follow-up' and subject_id = ${followUpId}
      and status = 'running'
  `;
}

/**
 * The screen's Stop, in one transaction: the follow-up is stopped AND every
 * run it has open is cancelled, or neither happens.
 *
 * IDEMPOTENT. The follow-up update has no status predicate of its own (stopping
 * a stopped follow-up is what the second press of a double press is), and the
 * job updates are narrowed to the open rows, so the second call writes the same
 * two things again and matches nothing new -- no second row, no double cancel.
 *
 * The row is what the scheduler reads (`status = 'active'` in
 * `performDueFollowUps`) and what `startFollowUpRun` refuses, so "stopped" is
 * the whole of "never picked again"; Resume is the only way back, and it is a
 * press the editor makes by name.
 *
 * THE LOCK ORDER IS desk_jobs THEN follow_ups, which is the order the rest of
 * the app takes these two tables in (`legal-removal-store.ts`: `desk_jobs` in
 * its scrub loop, then `follow_ups` in the delete list, then `leads`). Stop
 * used to take them the other way round, which is a deadlock pair on its own:
 * a legal removal holding `desk_jobs` and waiting for `follow_ups` while a Stop
 * held `follow_ups` and waited for `desk_jobs` would have had one of them
 * killed by the server. Taking them in the app's order costs nothing, because
 * the FENCE does not depend on which row this transaction touches first: what
 * makes a stopped follow-up unwritable is the `follow_ups` row lock, which Stop
 * still takes, and neither this transaction nor the result write ever holds
 * `desk_jobs` and then waits on something the other one needs (the result write
 * touches `follow_ups` and `leads`, never `desk_jobs`).
 */
export async function performFollowUpStop(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureJobsSchema();
  const newsroomId = owned(context);
  return withTransaction(async (tx) => {
    /*
      Read first, because the follow-up update is now LAST: the statement order
      above is the lock order, and the "is it there at all" answer has to come
      from somewhere. A Stop for an id that is not this newsroom's, or for a
      manual ask, must say so rather than write nothing and report success.
    */
    const [existing] = await tx<{ id: number }>`
      select id from follow_ups
      where id = ${id} and newsroom_id = ${newsroomId} and agent_kind is not null
    `;
    if (!existing) return { ok: false as const, error: "That follow-up is gone." };

    await cancelFollowUpRunsIn(tx, newsroomId, id);
    await tx`
      update follow_ups set status = 'stopped', updated_at = now()
      where id = ${id} and newsroom_id = ${newsroomId} and agent_kind is not null
      returning id
    `;
    return { ok: true as const };
  });
}

/**
 * Is a run for this follow-up still going -- the question Resume asks before it
 * puts the agent back on the clock?
 *
 * OPEN AND NOT KNOWN DEAD. A `queued` row is still going: it has not started,
 * and nothing says it will not (the drainer will reach it as soon as the desk
 * is free). A `running` row is still going until its heartbeat goes quiet --
 * `jobHeartbeatStale`, the same rule the drainer uses to decide it may take the
 * row away from a dead process, so the desk and the system agree about what
 * "alive" means. A stale row is NOT going: its worker is gone.
 *
 * `updated_at` is the 30s heartbeat `executeJob` writes; `beat_at` is the
 * worker's own progress report, which a long unwrapped call lets go quiet
 * without the process being dead. This asks whether the process is alive, so it
 * reads the heartbeat.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE CARD. `followUpCardState` calls a stopped
 * follow-up "Stopped" -- and offers Resume -- whenever nothing is RUNNING, so a
 * queued row does not leave the chip stuck on "Stopping…" behind a long draft.
 * Here a queued row still counts, because the press does something the card
 * cannot know about: resuming would free that queued run to start. The two
 * disagree only on that row, and the refusal says so in plain words.
 */
export async function followUpRunStillGoing(context: { newsroomId?: number }, id: number): Promise<boolean> {
  await ensureJobsSchema();
  const sql = await getSql();
  const rows = await sql<{ status: string; updated_at: string }>`
    select status, updated_at from desk_jobs
    where newsroom_id = ${owned(context)} and kind = 'follow-up' and subject_id = ${id}
      and status in ('queued', 'running')
    order by id desc
    limit 1
  `;
  const job = rows[0];
  if (!job) return false;
  if (job.status === "queued") return true;
  return !jobHeartbeatStale({ status: "running", updated_at: job.updated_at });
}

/**
 * Resume: put a stopped follow-up back on the clock -- refused while a run for
 * it is still going.
 *
 * WHY THIS IS A REFUSAL AND NOT A SILENT SUCCESS. A stopped follow-up's card
 * offers Resume the moment nothing is running; `followUpCardState` hides it
 * while a run is in flight, and this is the server half of the same rule, so a
 * press that raced the card's own state cannot put the agent back on the clock
 * with a cancelled job still unwinding. The message says which state the row is
 * in rather than "could not do that".
 *
 * `stopped` and `done` are both resumable here (Resume is offered on both
 * cards), and resuming a `done` agent is the same press with the same meaning:
 * back on the clock, next run due.
 */
export async function performFollowUpResume(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureJobsSchema();
  const newsroomId = owned(context);
  if (await followUpRunStillGoing(context, id)) {
    return {
      ok: false as const,
      error: "A run for this follow-up is still queued or running. Resume it once that run has stopped.",
    };
  }
  const sql = await getSql();
  const rows = await sql`
    update follow_ups set status = 'active', updated_at = now()
    where id = ${id} and newsroom_id = ${newsroomId} and agent_kind is not null
    returning id
  `;
  return rows.length ? { ok: true as const } : { ok: false as const, error: "That follow-up is gone." };
}
