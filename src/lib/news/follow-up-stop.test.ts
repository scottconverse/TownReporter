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
import { performFollowUpRun } from "./follow-up-agents.ts";
import { startFollowUpRun, tickFollowUpsFor } from "./follow-up-scheduler.ts";
import {
  JOB_CANCELLED_REASON,
  __setJobWorkForTest,
  enqueueJob,
  ensureJobsSchema,
  executeJob,
  latestJob,
  type DeskJob,
} from "./jobs.ts";
import { parseNotes } from "./notes.ts";
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
