import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPglite, getSql } from "../db.ts";
import {
  ensureFollowUpsSchema,
  parseFinding,
  performCreateAiFollowUp,
  performListFollowUps,
} from "./follow-ups.ts";
import { enqueueJob, ensureJobsSchema } from "./jobs.ts";
import {
  FOLLOW_UP_STALE_RUN_MS,
  performReconcileFollowUpRuns,
  startFollowUpRun,
  tickFollowUps,
  tickFollowUpsFor,
} from "./follow-up-scheduler.ts";

/**
 * When a follow-up runs -- and, more to the point, when it does not.
 *
 * The brief's three scheduling rules are each one test here, by name:
 * only DUE rows start, only ONE at a time, and never alongside a running
 * draft. The fourth test is the repair the design needs and the brief does not
 * ask for: a process that dies mid-run leaves a row saying `running`, and
 * nothing in the job machinery knows how to clear it.
 *
 * The database is real (PGlite, as in follow-ups.test.ts) because every
 * assertion here is about a ROW: `next_run_at`, `last_state`, and one
 * `desk_jobs` row per started run. Nothing is drained and no agent runs --
 * every tick is called with `{ kick: false }`, so the queue is left exactly as
 * the scheduler wrote it.
 */

const NEWSRoom = (n: number) => 97300 + n;

/** The user a follow-up belongs to; the scheduler enqueues the job under it. */
const EDITOR = "scheduler-editor";

async function clean(newsroomId: number): Promise<void> {
  const sql = await getSql();
  await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  await sql`delete from follow_ups where newsroom_id = ${newsroomId}`;
}

/**
 * An active agent follow-up whose `next_run_at` is where the test says it is.
 *
 * `performCreateAiFollowUp` sets `next_run_at` from the schedule, which is
 * always in the future -- so a due row is made due by writing the column,
 * which is the only way a row ever becomes due in production too.
 */
async function agentFollowUp(
  newsroomId: number,
  what: string,
  opts: { nextRunAt?: Date | null; agentKind?: "recheck" | "search" | "agenda" } = {},
): Promise<number> {
  const created = await performCreateAiFollowUp(
    { userId: EDITOR, newsroomId },
    {
      what,
      agentKind: opts.agentKind ?? "search",
      schedule: "daily",
      targets: ["https://example.test/one"],
    },
  );
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  const id = created.ok ? created.id : 0;
  if (opts.nextRunAt !== undefined) {
    const sql = await getSql();
    await sql`update follow_ups set next_run_at = ${opts.nextRunAt ? opts.nextRunAt.toISOString() : null} where id = ${id}`;
  }
  return id;
}

const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const future = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/** Observe real zero-delay dispatch timers, forwarding all callbacks normally. */
async function withDispatchObserver<T>(run: () => Promise<T>): Promise<{ value: T; dispatches: number }> {
  const realSetTimeout = globalThis.setTimeout;
  let dispatches = 0;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const isDispatch = delay === 0 && new Error().stack?.includes("at kickJobs (") === true;
    if (isDispatch) dispatches += 1;
    // Let the test remove the queued row before the forwarded real drainer runs.
    return realSetTimeout(callback, isDispatch ? 500 : delay, ...args);
  }) as typeof setTimeout;
  try {
    const value = await run();
    // The tests delete their queue row before yielding, so the forwarded real
    // callback settles without claiming work or invoking a provider.
    await new Promise<void>((resolve) => realSetTimeout(resolve, 510));
    return { value, dispatches };
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

async function removeQueuedFollowUp(newsroomId: number): Promise<void> {
  const sql = await getSql();
  await sql`delete from desk_jobs where newsroom_id = ${newsroomId} and kind = 'follow-up'`;
}

/** The follow-up jobs this newsroom's queue is holding, oldest first. */
async function followUpJobs(newsroomId: number): Promise<{ subject_id: number; status: string; model_choice: string; model_choice_source: string }[]> {
  const sql = await getSql();
  return sql<{ subject_id: number; status: string; model_choice: string; model_choice_source: string }>`
    select subject_id, status, model_choice, model_choice_source from desk_jobs
    where newsroom_id = ${newsroomId} and kind = 'follow-up'
    order by id asc
  `;
}

before(async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await getSql();
  // The real base newsroom schema; Node lacks Vite's migration glob.
  await (
    await getPglite()
  ).exec(await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8"));
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs"])
    await sql.query("alter table " + table + " add column if not exists newsroom_id integer not null default 1");
  await ensureJobsSchema();
  await ensureFollowUpsSchema();
  for (let n = 1; n <= 15; n += 1) await clean(NEWSRoom(n));
});

describe("the follow-up tick", () => {
  it("does not schedule worker dispatch when a scheduled tick opts out", async () => {
    const newsroomId = NEWSRoom(10);
    await agentFollowUp(newsroomId, "Dispatch observation", { nextRunAt: past(5) });
    const observed = await withDispatchObserver(async () => {
      const result = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
      await removeQueuedFollowUp(newsroomId);
      return result;
    });
    assert.equal(observed.value.started, 1);
    assert.equal(observed.dispatches, 0, "kick:false must enqueue without scheduling dispatch");
  });

  for (const kick of [undefined, true] as const) {
    it(`schedules one worker dispatch for scheduled tick with kick=${String(kick)}`, async () => {
      const newsroomId = NEWSRoom(kick === undefined ? 12 : 13);
      await agentFollowUp(newsroomId, "Positive dispatch observation", { nextRunAt: past(5) });
      const observed = await withDispatchObserver(async () => {
        const result = await tickFollowUpsFor(
          newsroomId,
          new Date(),
          kick === undefined ? {} : { kick },
        );
        await removeQueuedFollowUp(newsroomId);
        return result;
      });
      assert.equal(observed.value.started, 1);
      assert.equal(observed.dispatches, 1);
    });
  }

  it("starts a due row and leaves one whose time has not come alone", async () => {
    const newsroomId = NEWSRoom(1);
    const due = await agentFollowUp(newsroomId, "Has the road reopened?", { nextRunAt: past(5) });
    const later = await agentFollowUp(newsroomId, "Have the minutes been posted?", {
      nextRunAt: future(60),
    });

    const result = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(result.started, 1);
    assert.equal(result.skipped, null);
    assert.equal(result.reconciled, 0);

    const jobs = await followUpJobs(newsroomId);
    assert.equal(jobs.length, 1, "exactly one job, and the not-due row has none");
    assert.equal(jobs[0]!.subject_id, due);
    assert.notEqual(jobs[0]!.subject_id, later);
    assert.equal(jobs[0]!.status, "queued");
    /*
      The queue card shows the auto resolution, not an editor's pick: the
      follow-up's own saved choice plus the phase 5 order is what decided this
      model, and the worker re-reads the row anyway.
    */
    assert.equal(jobs[0]!.model_choice_source, "auto");
    assert.equal(jobs[0]!.model_choice, "auto", "the row's own pick, copied through");
  });

  it("starts one at a time, and the next row gets its turn once the first has recorded", async () => {
    const newsroomId = NEWSRoom(2);
    const first = await agentFollowUp(newsroomId, "First question", { nextRunAt: past(30) });
    const second = await agentFollowUp(newsroomId, "Second question", { nextRunAt: past(10) });

    const one = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(one.started, 1);
    assert.equal(one.skipped, null);
    const started = await followUpJobs(newsroomId);
    assert.equal(started.length, 1, "two due rows, one job");
    assert.equal(started[0]!.subject_id, first, "the earliest due row first");

    // The very next tick sees the run's own job and starts nothing.
    const two = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(two.started, 0);
    assert.equal(two.skipped, "follow-up-running");
    assert.equal((await followUpJobs(newsroomId)).length, 1);

    /*
      The run finishes the way a real one does: the worker records the outcome
      (moving `next_run_at` out by an interval) and the queue clears its job.
      Only then does the second row become the one the tick picks.
    */
    const sql = await getSql();
    await sql`update follow_ups set last_state = 'no-change', next_run_at = ${future(24 * 60).toISOString()} where id = ${first}`;
    await sql`delete from desk_jobs where newsroom_id = ${newsroomId} and kind = 'follow-up'`;

    const three = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(three.started, 1);
    const next = await followUpJobs(newsroomId);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.subject_id, second, "the row that was waiting is the one that runs now");
  });

  it("starts nothing while a draft is running, or queued", async () => {
    const newsroomId = NEWSRoom(3);
    const due = await agentFollowUp(newsroomId, "Did the vote happen?", { nextRunAt: past(5) });
    await enqueueJob({
      userId: EDITOR,
      newsroomId,
      kind: "draft",
      subjectId: 1,
      kick: false,
    });

    const blocked = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(blocked.started, 0);
    assert.equal(blocked.skipped, "draft-running");
    assert.equal((await followUpJobs(newsroomId)).length, 0, "a draft holds the desk");

    // A finished draft is not a fence; the queued draft above was one, and this
    // asserts both halves of "open" rather than only the running one.
    const sql = await getSql();
    await sql`update desk_jobs set status = 'done' where newsroom_id = ${newsroomId} and kind = 'draft'`;
    const allowed = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(allowed.started, 1);
    assert.equal(allowed.skipped, null);
    assert.equal((await followUpJobs(newsroomId))[0]!.subject_id, due);
  });

  it("puts a dead run back to waiting, with the reason on the card", async () => {
    const newsroomId = NEWSRoom(4);
    const id = await agentFollowUp(newsroomId, "Where is the packet?", { nextRunAt: past(5) });
    const sql = await getSql();
    const longAgo = new Date(Date.now() - FOLLOW_UP_STALE_RUN_MS - 5 * 60_000).toISOString();
    await sql`update follow_ups set last_state = 'running', updated_at = ${longAgo} where id = ${id}`;

    assert.equal(await performReconcileFollowUpRuns(newsroomId, new Date()), 1);

    const rows = await performListFollowUps({ userId: EDITOR, newsroomId }, {});
    const row = rows.find((r) => r.id === id)!;
    assert.equal(row.last_state, "waiting", "a run nobody is running is not left saying running");
    assert.match(parseFinding(row.finding_json).reason, /stopped before it finished/);
    assert.equal(
      new Date(row.next_run_at!).getTime() > Date.now(),
      true,
      "and it waits a full interval rather than retrying at once",
    );

    assert.equal(await performReconcileFollowUpRuns(newsroomId, new Date()), 0, "and it is not released twice");
  });

  it("leaves a live run alone: its job is still open, or it is still fresh", async () => {
    const newsroomId = NEWSRoom(5);
    const staleButQueued = await agentFollowUp(newsroomId, "Still working", { nextRunAt: past(5) });
    const freshNoJob = await agentFollowUp(newsroomId, "Just started", { nextRunAt: past(5) });
    const sql = await getSql();
    const longAgo = new Date(Date.now() - FOLLOW_UP_STALE_RUN_MS - 5 * 60_000).toISOString();
    await sql`update follow_ups set last_state = 'running', updated_at = ${longAgo} where id = ${staleButQueued}`;
    await sql`update follow_ups set last_state = 'running', updated_at = ${new Date().toISOString()} where id = ${freshNoJob}`;
    await enqueueJob({
      userId: EDITOR,
      newsroomId,
      kind: "follow-up",
      subjectId: staleButQueued,
      modelChoice: "auto",
      kick: false,
    });

    assert.equal(
      await performReconcileFollowUpRuns(newsroomId, new Date()),
      0,
      "the clock is not the test -- another process's live job is",
    );
    const rows = await performListFollowUps({ userId: EDITOR, newsroomId }, {});
    assert.equal(rows.find((r) => r.id === staleButQueued)!.last_state, "running");
    assert.equal(rows.find((r) => r.id === freshNoJob)!.last_state, "running");
  });

  it("visits the newsrooms that have an agent follow-up, and no others", async () => {
    // Only the newsrooms this test builds: the earlier ones are cleared so the
    // desk-wide sweep is asserted exactly rather than with a >=.
    for (let n = 1; n <= 15; n += 1) await clean(NEWSRoom(n));
    const dueHere = await agentFollowUp(NEWSRoom(6), "Due here", { nextRunAt: past(5) });
    const manualOnly = NEWSRoom(7);
    const sql = await getSql();
    await sql`insert into follow_ups (user_id, newsroom_id, who, what, status) values (${EDITOR}, ${manualOnly}, 'The editor', 'Chase the clerk', 'open')`;
    await agentFollowUp(NEWSRoom(8), "Not yet due", { nextRunAt: future(120) });
    const dueThere = await agentFollowUp(NEWSRoom(9), "Due there", { nextRunAt: past(5) });

    const result = await tickFollowUps(new Date(), { kick: false });
    assert.equal(result.newsrooms, 3, "the manual-only newsroom is not on the clock");
    assert.equal(result.started, 2, "one per due newsroom, no more");
    assert.equal((await followUpJobs(NEWSRoom(6)))[0]!.subject_id, dueHere);
    assert.equal((await followUpJobs(NEWSRoom(9)))[0]!.subject_id, dueThere);
    assert.equal((await followUpJobs(NEWSRoom(8))).length, 0);
    assert.equal(
      (await followUpJobs(manualOnly)).length,
      0,
      "select count(*) from desk_jobs where newsroom_id = 97307 and kind = 'follow-up' returned no row",
    );
  });
});

describe("Run now dispatch", () => {
  it("does not schedule worker dispatch when Run now opts out", async () => {
    const newsroomId = NEWSRoom(11);
    const id = await agentFollowUp(newsroomId, "Manual dispatch observation", { nextRunAt: future(60) });
    const observed = await withDispatchObserver(async () => {
      const result = await startFollowUpRun({ userId: EDITOR, newsroomId }, id, new Date(), { kick: false });
      await removeQueuedFollowUp(newsroomId);
      return result;
    });
    assert.equal(observed.value.started, true);
    assert.equal(observed.dispatches, 0, "kick:false must enqueue without scheduling dispatch");
  });

  for (const kick of [undefined, true] as const) {
    it(`schedules one worker dispatch for Run now with kick=${String(kick)}`, async () => {
      const newsroomId = NEWSRoom(kick === undefined ? 14 : 15);
      const id = await agentFollowUp(newsroomId, "Positive Run now observation", { nextRunAt: future(60) });
      const observed = await withDispatchObserver(async () => {
        const result = await startFollowUpRun(
          { userId: EDITOR, newsroomId },
          id,
          new Date(),
          kick === undefined ? {} : { kick },
        );
        await removeQueuedFollowUp(newsroomId);
        return result;
      });
      assert.equal(observed.value.started, true);
      assert.equal(observed.dispatches, 1);
    });
  }
});
