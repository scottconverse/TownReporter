import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPglite, getSql } from "../db.ts";
import {
  ensureFollowUpsSchema,
  parseFinding,
  performCreateAiFollowUp,
  performDueFollowUps,
  performFollowUpAction,
  performListFollowUps,
  performReadFollowUp,
  performRecordFollowUpRun,
} from "./follow-ups.ts";
import { performFollowUpRun, runRecheckAgent } from "./follow-up-agents.ts";
import { startFollowUpRun, tickFollowUpsFor } from "./follow-up-scheduler.ts";
import {
  JOB_CANCELLED_REASON,
  JOB_PAUSED_REASON,
  STALE_RUNNING_SECONDS,
  JobCancelledError,
  __setJobWorkForTest,
  enqueueJob,
  ensureJobsSchema,
  executeJob,
  jobHeartbeatStale,
  latestJob,
  requestJobCancel,
  throwIfJobCancelled,
  type DeskJob,
} from "./jobs.ts";
import { parseNotes } from "./notes.ts";
import { listPageWatchesFor } from "./page-watch.ts";
import {
  performListFollowUpWatchNotices,
  watchNoticesFor,
} from "./follow-up-watch-notice.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { RUN_HEARTBEAT_STALE_MS, runHeartbeatStale } from "./follow-up-copy.ts";
import type { IngestDocument } from "./ingest.ts";
import type { SearchAttempt, WebHit } from "./search-web.ts";

/**
 * Stop, from the database's side.
 *
 * Every test in this file is about a ROW after a Stop, because that is what the
 * Sept 28 audit found missing: `performFollowUpAction("stop")` moved the
 * follow-up and left the run it had in flight to write its finding anyway. The
 * brief's properties are one describe each:
 *
 *  - a stopped follow-up is never picked, and it is refused to "Run now";
 *  - a queued run is cancelled outright, so it can never start;
 *  - a run in flight hears the stop at its next unit of work, not at the end;
 *  - its result write is FENCED, so a stop landing after that unit of work
 *    still records nothing -- `beforeRecord` puts the Stop in exactly that
 *    window, which is the only place the fence (rather than a boundary check)
 *    is what saves the editor from a finding nobody asked for;
 *  - the work already recorded is untouched, and the run's own job row ends in
 *    the job system's existing terminal state for a cancel.
 *
 * The database is real (PGlite, as in follow-up-agents.test.ts) because every
 * claim here is about a row. Nothing leaves the process: the search provider,
 * the judge and the page reader are fakes.
 */

const EDITOR = "stop-editor";

const ctx = (newsroomId: number) => ({ userId: EDITOR, newsroomId });

const doc = (text: string, extra: Partial<IngestDocument> = {}): IngestDocument => ({
  ok: true,
  status: 200,
  outcome: "fetched",
  text,
  title: "Record",
  extras: [],
  contentType: "text/html",
  needsOcr: false,
  redirectChain: [],
  extractionMethod: "html",
  pages: [],
  notices: [],
  ...extra,
});

const hit = (url: string, title = "Result"): WebHit => ({ title, url, snippet: "…" });

const attempt = (hits: WebHit[], extra: Partial<SearchAttempt> = {}): SearchAttempt =>
  ({ state: "ok", hits, provider: "fake", ...extra }) as SearchAttempt;

/** The judge that answers "yes, here it is" for one URL. */
const judgeFound =
  (url: string, summary = "The answer was posted.") =>
  async () => ({ ok: true as const, answers: true, url, title: "An answer", summary });

/** A newsroom number nobody else in this process is using, with no rows in it. */
async function room(base: number): Promise<number> {
  const sql = await getSql();
  const newsroomId = base + (Math.floor(Math.random() * 10_000) + 1);
  await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  await sql`delete from follow_ups where newsroom_id = ${newsroomId}`;
  return newsroomId;
}

/**
 * An active agent follow-up that is DUE, so every test can ask the scheduler
 * about it rather than only reading the row: `performCreateAiFollowUp` always
 * schedules the first run into the future.
 */
async function dueFollowUp(
  newsroomId: number,
  opts: { agentKind?: "recheck" | "search"; targets?: string[]; leadId?: number } = {},
): Promise<number> {
  const created = await performCreateAiFollowUp(ctx(newsroomId), {
    leadId: opts.leadId ?? null,
    what: "Has the council posted the budget papers?",
    agentKind: opts.agentKind ?? "search",
    schedule: "daily",
    targets: opts.targets,
  });
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  const id = created.ok ? created.id : 0;
  const sql = await getSql();
  await sql`
    update follow_ups set next_run_at = ${new Date(Date.now() - 60_000).toISOString()}
    where id = ${id}
  `;
  return id;
}

async function rowOf(newsroomId: number, id: number) {
  const row = await performReadFollowUp(ctx(newsroomId), id);
  assert.ok(row, "the follow-up row is still there");
  return row;
}

async function followUpJobs(newsroomId: number): Promise<DeskJob[]> {
  const sql = await getSql();
  return sql<DeskJob>`
    select * from desk_jobs
    where newsroom_id = ${newsroomId} and kind = 'follow-up'
    order by id asc
  `;
}

async function notesFor(leadId: number) {
  const sql = await getSql();
  const rows = await sql<{ notes_json: string }>`select notes_json from leads where id = ${leadId}`;
  return parseNotes(rows[0]!.notes_json);
}

/** Run one job with the worker's real body swapped for `work`, then restore it. */
async function withJobWork<T>(
  work: (job: DeskJob) => Promise<void>,
  run: () => Promise<T>,
): Promise<T> {
  __setJobWorkForTest(work);
  try {
    return await run();
  } finally {
    __setJobWorkForTest();
  }
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
  await sql.query("alter table leads add column if not exists notes_json text not null default '{}'");
  await ensureJobsSchema();
  await ensureFollowUpsSchema();
});

describe("Stop on a follow-up with nothing running", () => {
  it("stops it, and the clock never picks it again", async () => {
    const newsroomId = await room(974_000);
    const id = await dueFollowUp(newsroomId);

    // Due, active and picked by the clock to begin with -- otherwise the
    // assertion after the Stop would prove nothing.
    assert.equal((await performDueFollowUps(newsroomId, new Date(), 5)).some((r) => r.id === id), true);

    const stopped = await performFollowUpAction(ctx(newsroomId), id, "stop");
    assert.equal(stopped.ok, true);
    assert.equal((await rowOf(newsroomId, id)).status, "stopped");

    assert.deepEqual(await performDueFollowUps(newsroomId, new Date(), 5), []);
    const tick = await tickFollowUpsFor(newsroomId, new Date(), { kick: false });
    assert.equal(tick.started, 0);
    assert.equal(tick.skipped, null, "nothing was due -- no fence had to refuse it");
    assert.deepEqual(await followUpJobs(newsroomId), [], "and no run was queued for it");

    // Idempotent: the second press is not an error and changes nothing.
    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "stop")).ok, true);
    assert.equal((await rowOf(newsroomId, id)).status, "stopped");
    assert.deepEqual(await followUpJobs(newsroomId), []);
  });

  it("is refused to Run now, and Resume is the one way back", async () => {
    const newsroomId = await room(974_100);
    const id = await dueFollowUp(newsroomId);
    await performFollowUpAction(ctx(newsroomId), id, "stop");

    const runNow = await performFollowUpAction(ctx(newsroomId), id, "run-now");
    assert.equal(runNow.ok, false, "Run now must not resurrect a stopped follow-up");
    assert.equal(
      (await rowOf(newsroomId, id)).status,
      "stopped",
      "and it must not have written the status on its way out",
    );

    const start = await startFollowUpRun(ctx(newsroomId), id, new Date(), { kick: false });
    assert.equal(start.started, false);
    assert.equal(start.skipped, "not-active");
    assert.deepEqual(await followUpJobs(newsroomId), []);

    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "resume")).ok, true);
    assert.equal((await rowOf(newsroomId, id)).status, "active");
    const resumed = await startFollowUpRun(ctx(newsroomId), id, new Date(), { kick: false });
    assert.equal(resumed.started, true, "Resume puts it back on the clock, and only Resume does");
    assert.equal((await followUpJobs(newsroomId)).length, 1);
  });
});

describe("Stop on a follow-up with a queued run", () => {
  it("cancels the queued job outright, so it can never start", async () => {
    const newsroomId = await room(974_200);
    const id = await dueFollowUp(newsroomId);
    const job = await enqueueJob({
      userId: EDITOR,
      newsroomId,
      kind: "follow-up",
      subjectId: id,
      modelChoice: "auto",
      kick: false,
    });
    assert.equal(job.status, "queued");

    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "stop")).ok, true);

    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed", "a queued run is cancelled, not left to be claimed");
    assert.equal(after?.error, JOB_CANCELLED_REASON);
    assert.equal(after?.cancel_requested, true);

    // The claim is what decides, so the proof is the claim refusing -- with the
    // worker body swapped for one that would shout if it ever ran.
    let entered = false;
    const took = await withJobWork(
      async () => {
        entered = true;
      },
      () => executeJob(job),
    );
    assert.equal(took, false, "a cancelled queued row is not claimable");
    assert.equal(entered, false, "so no work ever started");

    // And nothing replaces it: one job, terminal, and the clock queues nothing.
    assert.equal((await tickFollowUpsFor(newsroomId, new Date(), { kick: false })).started, 0);
    const jobs = await followUpJobs(newsroomId);
    assert.equal(jobs.length, 1, "no duplicate dispatch after a cancel");
    assert.equal(jobs[0]!.status, "failed");
  });

  it("cancels the one job the queue actually holds when a caller enqueued twice", async () => {
    // Two enqueues for one follow-up are one job (the one-open-per-subject
    // index), and Stop has to cancel the row that exists rather than the second
    // one a caller imagined.
    const newsroomId = await room(974_300);
    const id = await dueFollowUp(newsroomId);
    const first = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });
    const second = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });
    assert.equal(first.id, second.id);

    await performFollowUpAction(ctx(newsroomId), id, "stop");
    const jobs = await followUpJobs(newsroomId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.status, "failed");
  });
});

describe("Stop on a follow-up whose run is in flight", () => {
  const CHECKED_AT = "2026-09-28T12:00:00.000Z";

  /**
   * A found run already on the record: the finding, its note in the story's
   * reporting notes, and the `checkedAt` that says when. Every test below
   * asserts that a Stop after this point leaves all three as they are.
   */
  async function withEarlierFinding(
    newsroomId: number,
    opts: { agentKind?: "recheck" | "search"; targets?: string[] } = {},
  ): Promise<{ id: number; leadId: number }> {
    const sql = await getSql();
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, status, notes_json)
      values (${EDITOR}, ${newsroomId}, 'Budget vote', 'The council votes Monday', 'new',
              '{"news":"The council votes Monday","todo":[{"t":"Ask the clerk"}],"found":[]}')
      returning id
    `;
    const leadId = leadRows[0]!.id;
    const id = await dueFollowUp(newsroomId, { leadId, ...opts });
    const recorded = await performRecordFollowUpRun(ctx(newsroomId), {
      id,
      state: "found",
      finding: {
        title: "Budget papers",
        summary: "The papers were posted on 24 September.",
        url: "https://clerk.test/papers",
        checkedAt: CHECKED_AT,
      },
      nextRunAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
    assert.deepEqual(recorded, { ok: true, noteWritten: true });
    return { id, leadId };
  }

  it("stops the work at its next unit rather than letting it read to the end", async () => {
    const newsroomId = await room(974_400);
    // A re-check of two pages: the stop lands inside the FIRST page's read, so
    // the second must never be fetched.
    const { id, leadId } = await withEarlierFinding(newsroomId, {
      agentKind: "recheck",
      targets: ["https://clerk.test/one", "https://clerk.test/two"],
    });
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    const read: string[] = [];
    let modelCalls = 0;
    const handled = await withJobWork(
      async (running) =>
        performFollowUpRun(running, {
          agents: {
            /*
              No `waitForModel`: the boundary check is what this test is about,
              and the real wrapper's own 12 s ticker would be a second, slower
              way to hear the same flag.
            */
            model: async (_label, run) => {
              modelCalls += 1;
              // The editor's Stop, while the first page is being read.
              const stopped = await performFollowUpAction(ctx(newsroomId), id, "stop");
              assert.equal(stopped.ok, true);
              return run();
            },
            fetch: async (url) => {
              read.push(url);
              return doc("The library opens at nine.");
            },
          },
        }),
      () => executeJob(job),
    );
    assert.equal(handled, true);

    assert.equal(read.length, 1, "the second page was never fetched");
    assert.equal(modelCalls, 1, "and the run did not go on to its next unit of work");

    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed", "a stopped run is not a job that quietly completed");
    assert.equal(after?.error, JOB_CANCELLED_REASON);

    const row = await rowOf(newsroomId, id);
    assert.notEqual(row.last_state, "found");
    assert.equal(parseFinding(row.finding_json).url, "https://clerk.test/papers");
    assert.equal((await notesFor(leadId)).found.length, 1);
  });

  it("writes no finding and no note when the stop lands after the last unit of work", async () => {
    const newsroomId = await room(974_500);
    const { id, leadId } = await withEarlierFinding(newsroomId);
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    const ran = await withJobWork(
      async (running) =>
        performFollowUpRun(running, {
          agents: {
            model: async (_label, run) => run(),
            search: async () => attempt([hit("https://clerk.test/new-answer")]),
            judge: judgeFound("https://clerk.test/new-answer", "A new answer was posted."),
          },
          /*
            THE WINDOW THE FENCE EXISTS FOR. The worker's own boundary check has
            already run and found nothing; this Stop commits after it and before
            `performRecordFollowUpRun`'s transaction, so only the fence can
            refuse the write now.
          */
          beforeRecord: async () => {
            const stopped = await performFollowUpAction(ctx(newsroomId), id, "stop");
            assert.equal(stopped.ok, true);
          },
        }),
      () => executeJob(job),
    );
    assert.equal(ran, true, "the job ran; it was the WRITE that was refused");

    // The run's own record: the job system's existing cancel vocabulary, not a
    // new status and not a "Done" over a run that recorded nothing.
    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed");
    assert.equal(after?.error, JOB_CANCELLED_REASON);
    assert.notEqual(after?.stage, "Done");

    const row = await rowOf(newsroomId, id);
    assert.equal(row.status, "stopped");
    assert.notEqual(row.last_state, "found", "a stopped run records no outcome");
    assert.notEqual(row.last_state, "running", "and is not left saying it is running");

    // The earlier run's finding, field for field.
    const finding = parseFinding(row.finding_json);
    assert.equal(finding.title, "Budget papers");
    assert.equal(finding.summary, "The papers were posted on 24 September.");
    assert.equal(finding.url, "https://clerk.test/papers");
    assert.equal(finding.checkedAt, CHECKED_AT, "the preserved finding still says when it was found");
    assert.match(finding.reason, /stopped this run/, "and why nothing new followed it");

    // The notes: exactly one, the earlier one, never the stopped run's answer.
    const notes = await notesFor(leadId);
    assert.equal(notes.found.length, 1, "the stopped run's finding never reached the notes");
    assert.match(notes.found[0]!.t, /clerk\.test\/papers/);
    assert.equal(notes.found[0]!.src, "machine");
    assert.equal(notes.todo.length, 1, "and the editor's own notes are untouched");
    assert.equal(notes.news, "The council votes Monday");

    // No duplicate dispatch after the cancel, and the row stays stopped.
    assert.equal((await followUpJobs(newsroomId)).length, 1);
    assert.equal((await performListFollowUps(ctx(newsroomId), {})).find((r) => r.id === id)!.status, "stopped");
  });

  it("refuses a run whose follow-up was stopped after the job was claimed", async () => {
    /*
      The drainer's own pre-work cancel check has already happened (the row is
      `running`), and so has the claim -- so this is the guard in the worker,
      not the queue, that has to refuse it. Nothing may run, and the job must
      not end as a completed run with no work in it.
    */
    const newsroomId = await room(974_600);
    const id = await dueFollowUp(newsroomId);
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    let searched = false;
    const handled = await withJobWork(
      async (running) => {
        const stopped = await performFollowUpAction(ctx(newsroomId), id, "stop");
        assert.equal(stopped.ok, true);
        await performFollowUpRun(running, {
          agents: {
            model: async (_label, run) => run(),
            search: async () => {
              searched = true;
              return attempt([hit("https://clerk.test/x")]);
            },
          },
        });
      },
      () => executeJob(job),
    );
    assert.equal(handled, true, "the claim happened before the stop, so the work was entered");

    assert.equal(searched, false, "a stopped follow-up's run does no work");
    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed");
    assert.equal(after?.error, JOB_CANCELLED_REASON);
    const row = await rowOf(newsroomId, id);
    assert.equal(row.status, "stopped");
    assert.notEqual(row.last_state, "running");
  });
});

describe("the copy's liveness window and the queue's (L3)", () => {
  it("keeps the copy's stale-heartbeat rule equal to the queue's own", async () => {
    /*
      `RUN_HEARTBEAT_STALE_MS` is declared in ./follow-up-copy.ts because the
      copy vocabulary may not import ./jobs.ts (the browser loads it). Declared
      twice is a drift risk, so the two are pinned together here: same window,
      same rule, same answers at the boundary -- a card that called a live
      worker dead, or a dead one live, would be a card the editor cannot act on.
    */
    assert.equal(RUN_HEARTBEAT_STALE_MS, STALE_RUNNING_SECONDS * 1000);
    const now = Date.UTC(2026, 8, 30, 12, 0);
    for (const ageSeconds of [0, 5, STALE_RUNNING_SECONDS - 1, STALE_RUNNING_SECONDS, STALE_RUNNING_SECONDS + 1, 600]) {
      const iso = new Date(now - ageSeconds * 1000).toISOString();
      assert.equal(
        runHeartbeatStale(Date.parse(iso), now),
        jobHeartbeatStale({ status: "running", updated_at: iso }, now),
        `age ${ageSeconds}s`,
      );
    }
    // Null and unparseable are "no evidence", not "stale" -- the same answer
    // `jobHeartbeatStale` gives a row with no timestamp.
    assert.equal(runHeartbeatStale(null, now), false);
    assert.equal(runHeartbeatStale(undefined, now), false);
    assert.equal(runHeartbeatStale(Number.NaN, now), false);
  });
});

describe("the window between reading the follow-up and claiming it (M1)", () => {
  it("ends the job as cancelled when a Stop lands in that window", async () => {
    /*
      The claim is the `status = 'active'` predicate on an update, so the only
      place a Stop can land and be missed by the not-active guard is between the
      read and the claim. The worker used to `return` here, and `executeJob`
      then wrote "Done" over a run that did no work at all -- for a follow-up
      the editor had just stopped.
    */
    const newsroomId = await room(974_900);
    const id = await dueFollowUp(newsroomId);
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    let searched = false;
    const handled = await withJobWork(
      async (running) =>
        performFollowUpRun(running, {
          agents: {
            model: async (_label, run) => run(),
            search: async () => {
              searched = true;
              return attempt([hit("https://clerk.test/x")]);
            },
          },
          beforeClaim: async () => {
            const stopped = await performFollowUpAction(ctx(newsroomId), id, "stop");
            assert.equal(stopped.ok, true);
          },
        }),
      () => executeJob(job),
    );
    assert.equal(handled, true, "the job itself was claimed");

    assert.equal(searched, false, "and no work ran");
    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed", "a run that did nothing must not be recorded as Done");
    assert.equal(after?.error, JOB_CANCELLED_REASON);
    assert.equal((await rowOf(newsroomId, id)).status, "stopped");
  });

  it("ends the job as superseded when another execution already owns the row", async () => {
    // The other way the claim refuses: a `last_state = 'running'` mark that
    // outlived its worker. Returning quietly would read as "Done", and this run
    // recorded nothing, so the card must not say it did.
    const newsroomId = await room(974_950);
    const id = await dueFollowUp(newsroomId);
    const sql = await getSql();
    await sql`update follow_ups set last_state = 'running' where id = ${id}`;
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    let searched = false;
    await withJobWork(
      async (running) =>
        performFollowUpRun(running, {
          agents: {
            model: async (_label, run) => run(),
            search: async () => {
              searched = true;
              return attempt([hit("https://clerk.test/x")]);
            },
          },
        }),
      () => executeJob(job),
    );

    assert.equal(searched, false);
    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed");
    assert.match(String(after?.error), /took it over/);
    const row = await rowOf(newsroomId, id);
    assert.notEqual(row.last_state, "running", "the stale mark is cleared, so the agent is due again");
  });

  it("names the Pause when a paused follow-up's run reaches the worker (L4)", async () => {
    // "Cancelled by the editor" on a Pause the editor pressed reads as a bug
    // report about a button nobody touched. Same terminal state, honest reason.
    const newsroomId = await room(974_960);
    const id = await dueFollowUp(newsroomId);
    await performFollowUpAction(ctx(newsroomId), id, "pause");
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    await withJobWork(
      async (running) => performFollowUpRun(running, { agents: { model: async (_label, run) => run() } }),
      () => executeJob(job),
    );

    const after = await latestJob({ newsroomId, kind: "follow-up", subjectId: id });
    assert.equal(after?.status, "failed");
    assert.equal(after?.error, JOB_PAUSED_REASON);
    assert.notEqual(after?.error, JOB_CANCELLED_REASON);
    const row = await rowOf(newsroomId, id);
    assert.equal(row.status, "paused", "a paused follow-up stays paused");
    assert.match(parseFinding(row.finding_json).reason, /paused before its run started/);
  });
});

describe("Resume while a run for the follow-up is still going (L1)", () => {
  it("refuses Resume with a plain message while a run is queued", async () => {
    const newsroomId = await room(975_000);
    const id = await dueFollowUp(newsroomId);
    await performFollowUpAction(ctx(newsroomId), id, "stop");
    // A queued row Stop's transaction did not see (it was inserted in the same
    // instant): the card says Stopped, and Resume waits for that row.
    await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });

    const resumed = await performFollowUpAction(ctx(newsroomId), id, "resume");
    assert.equal(resumed.ok, false);
    assert.equal(
      resumed.ok === false ? resumed.error : "",
      "A run for this follow-up is still queued or running. Resume it once that run has stopped.",
    );
    assert.equal((await rowOf(newsroomId, id)).status, "stopped", "and the row was not touched");

    // Once that run is terminal, the same press works.
    const sql = await getSql();
    await sql`update desk_jobs set status = 'failed', finished_at = now()
      where newsroom_id = ${newsroomId} and kind = 'follow-up' and subject_id = ${id}`;
    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "resume")).ok, true);
    assert.equal((await rowOf(newsroomId, id)).status, "active");
  });

  it("refuses Resume while a live worker is running, and allows it once it goes quiet", async () => {
    const newsroomId = await room(975_100);
    const id = await dueFollowUp(newsroomId);
    await performFollowUpAction(ctx(newsroomId), id, "stop");
    const job = await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: id, kick: false });
    const sql = await getSql();
    await sql`update desk_jobs set status = 'running', updated_at = now() where id = ${job.id}`;

    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "resume")).ok, false);
    // A worker that has gone quiet is not a run that is still going: the card
    // says Stopped and offers Resume, so the server must honour the press.
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    await sql`update desk_jobs set updated_at = ${stale} where id = ${job.id}`;
    assert.equal((await performFollowUpAction(ctx(newsroomId), id, "resume")).ok, true);
    assert.equal((await rowOf(newsroomId, id)).status, "active");
  });
});

describe("what a re-check leaves behind (M2)", () => {
  const REC_URL = "https://clerk.test/notices";
  const passthrough = async <T,>(_label: string, run: () => Promise<T>) => run();

  it("creates no page watch once the run has been cancelled", async () => {
    const newsroomId = await room(975_200);
    const who = { userId: EDITOR, newsroomId };
    const id = await dueFollowUp(newsroomId, { agentKind: "recheck", targets: [REC_URL] });
    const agentInput = {
      id,
      userId: EDITOR,
      newsroomId,
      what: "Has the notices page changed?",
      targets: [REC_URL],
      modelChoice: "auto",
      lastFinding: parseFinding("{}"),
    };

    // The control first: with nothing cancelled the run does what a re-check
    // does and the watch exists. Without it the assertion below could pass
    // because no watch was ever created by anyone.
    const ran = await runRecheckAgent(agentInput, {
      fetch: async () => doc("The library opens at nine."),
      step: async () => undefined,
      model: passthrough,
    });
    assert.equal(ran.state, "no-change");
    assert.equal((await listPageWatchesFor(who)).length, 1, "a live run creates the watch");

    // Now the same run, cancelled at the boundary immediately before the
    // upsert: the page it was about to watch must not be left on the clock.
    const second = await performCreateAiFollowUp(ctx(newsroomId), {
      what: "Have the minutes been posted?",
      agentKind: "recheck",
      schedule: "daily",
      targets: ["https://clerk.test/minutes"],
    });
    const secondId = second.ok ? second.id : 0;
    const secondJob = await enqueueJob({
      userId: EDITOR,
      newsroomId,
      kind: "follow-up",
      subjectId: secondId,
      kick: false,
    });
    await assert.rejects(
      runRecheckAgent(
        { ...agentInput, id: secondId, targets: ["https://clerk.test/minutes"] },
        {
          // The real wiring, not a fake: the flag one press writes is what the
          // boundary reads back.
          throwIfCancelled: () => throwIfJobCancelled(secondJob.id),
          step: async () => {
            await requestJobCancel(secondJob.id);
          },
          fetch: async () => doc("The library opens at nine."),
          model: passthrough,
        },
      ),
      (e: unknown) => e instanceof JobCancelledError,
    );
    const watches = await listPageWatchesFor(who);
    assert.equal(watches.length, 1, "the cancelled run created no second watch");
    assert.match(watches[0]!.url, /clerk\.test\/notices/);
    assert.equal(
      watches.some((watch) => watch.url.includes("minutes")),
      false,
      "and the page it was about to watch is not being polled",
    );
  });

  it("tells the card which watches a stopped re-check left switched on", async () => {
    const newsroomId = await room(975_300);
    const recheck = await dueFollowUp(newsroomId, { agentKind: "recheck", targets: [REC_URL] });
    // A re-check that is NOT stopped, and a search agent: neither is a
    // leftover, and the read must not claim otherwise.
    const live = await dueFollowUp(newsroomId, { agentKind: "recheck", targets: ["https://pool.test/hours"] });
    const searching = await dueFollowUp(newsroomId, { agentKind: "search" });

    const ran = await runRecheckAgent(
      {
        id: recheck,
        userId: EDITOR,
        newsroomId,
        what: "Has the notices page changed?",
        targets: [REC_URL],
        modelChoice: "auto",
        lastFinding: parseFinding("{}"),
      },
      {
        fetch: async () => doc("The library opens at nine."),
        step: async () => undefined,
        model: passthrough,
      },
    );
    assert.equal(ran.state, "no-change");

    assert.deepEqual(
      await performListFollowUpWatchNotices(ctx(newsroomId)),
      [],
      "an active agent's watch is not a leftover",
    );

    await performFollowUpAction(ctx(newsroomId), recheck, "stop");
    const watched = canonicalPublicUrl(REC_URL);
    assert.deepEqual(await performListFollowUpWatchNotices(ctx(newsroomId)), [
      { followUpId: recheck, url: watched },
    ]);

    // The pure matcher answers the same way when the query's own rows are
    // handed to it: a target that is not watched is not a notice, a newsroom
    // with no watches has none, and a watch belonging to another agent's page
    // does not attach itself to this card.
    const sql = await getSql();
    const rows = await sql<{ id: number; targets_json: string }>`
      select id, targets_json from follow_ups
      where newsroom_id = ${newsroomId} and status in ('stopped', 'done') and agent_kind = 'recheck'
    `;
    assert.deepEqual(watchNoticesFor(rows, [watched]), [{ followUpId: recheck, url: watched }]);
    assert.deepEqual(watchNoticesFor(rows, []), []);
    assert.deepEqual(watchNoticesFor(rows, ["https://elsewhere.test/x"]), []);
    assert.deepEqual(watchNoticesFor(rows, [canonicalPublicUrl("https://pool.test/hours")]), []);
    // The rows really did exclude the live agents -- otherwise the assertions
    // above would be about an empty list rather than about the rule.
    assert.equal(rows.some((row) => row.id === live || row.id === searching), false);
  });
});
