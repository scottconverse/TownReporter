import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __setJobWorkForTest,
  clampPct,
  enqueueJob,
  executeJob,
  JOB_CANCELLED_REASON,
  JOB_STAGE_LISTS,
  JobCancelledError,
  jobCancelRequested,
  jobProgressStalled,
  latestJob,
  progressReporterFor,
  reportProgress,
  requestJobCancel,
  setJobStages,
  stageIndexFor,
  throwIfJobCancelled,
  type DeskJob,
} from "./jobs.ts";
import { getSql } from "../db.ts";

/*
  Structured job progress (redesign phase 3, unit BE; migrations/0099).

  What the design asks a running job to answer, and the test that is the
  evidence for it:

    a percentage that cannot paint outside the bar   -> clampPct
    "the worker is alive" as a column, not a guess   -> reportProgress / beat_at
    a stage list, and the position in it             -> stageIndexFor,
                                                        progressReporterFor,
                                                        the claim-time seeding
    "no activity for 1:14"                           -> jobProgressStalled
    Cancel that stops at a boundary, never mid-step  -> throwIfJobCancelled

  Fakes only: no model is loaded or called anywhere in this file. `executeJob`
  is driven through `__setJobWorkForTest`, which is the same seam the rest of
  jobs.test.ts uses.
*/

const NEWSROOM = 91099;

const subject = { next: 92001 };
const freshSubject = () => subject.next++;

const enqueueDraft = (userId: string, subjectId: number) =>
  enqueueJob({ userId, newsroomId: NEWSROOM, kind: "draft", subjectId, kick: false });

const stored = (subjectId: number) =>
  latestJob({ newsroomId: NEWSROOM, kind: "draft", subjectId });

describe("structured job progress", () => {
  it("keeps a percentage inside the bar, and answers null for no number", () => {
    assert.equal(clampPct(-1), 0);
    assert.equal(clampPct(0), 0);
    assert.equal(clampPct(41.6), 42);
    assert.equal(clampPct(100), 100);
    assert.equal(clampPct(103), 100);
    // "No percentage" and "0%" are different states: one draws an indeterminate
    // bar, the other draws an empty one.
    assert.equal(clampPct(null), null);
    assert.equal(clampPct(undefined), null);
    assert.equal(clampPct(Number.NaN), null);
  });

  it("bumps beat_at, records the step, and tells absent from null", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("progress-fields", id);
    // A claimed job whose worker last spoke 90s ago: stalled by the rule below.
    // `running` because that is the state a claim produces, and the one the
    // stall rule applies to.
    await sql`
      update desk_jobs
      set status = 'running', beat_at = now() - make_interval(secs => 90),
          pct = 7, stage_index = 3, step_text = 'an older sentence'
      where id = ${job.id} and newsroom_id = ${NEWSROOM}
    `;
    assert.equal(jobProgressStalled(await stored(id)), true);

    await reportProgress(job.id, { step: "Reading packet 2 of 3", pct: -5 });
    const spoke = (await stored(id))!;
    assert.equal(jobProgressStalled(spoke), false, "beat_at is the sign of life the card reads");
    assert.equal(spoke.step_text, "Reading packet 2 of 3");
    assert.equal(spoke.pct, 0, "clamped where it is written, not where it is drawn");
    assert.equal(spoke.stage_index, 3, "an absent stageIndex leaves the chip where it was");

    // Absent and null are different instructions, and the card renders them
    // differently: null clears the percentage (indeterminate bar), absent keeps
    // whatever the worker last knew.
    await reportProgress(job.id, { pct: null, stageIndex: null });
    const cleared = (await stored(id))!;
    assert.equal(cleared.pct, null);
    assert.equal(cleared.stage_index, null);
    assert.equal(cleared.step_text, "Reading packet 2 of 3", "an absent step keeps the last one");

    /*
      An `undefined` VALUE counts as absent, not as a clear. This is the defect
      the chip test below found: `progressReporterFor` writes
      `{ step, stageIndex: maybeUndefined }`, so an `in`-based test would clear
      the chip row every time a worker said anything that was not a stage
      arrival -- a job at stage 3 would flash back to no chip row twice a
      minute. Asserted directly, because it is `reportProgress`'s
      `!== undefined` test that makes it true, not the caller's care.
    */
    await sql`
      update desk_jobs set pct = 42, stage_index = 2, step_text = 'kept'
      where id = ${job.id} and newsroom_id = ${NEWSROOM}
    `;
    await reportProgress(job.id, { pct: undefined, stageIndex: undefined, step: undefined });
    const untouched = (await stored(id))!;
    assert.equal(untouched.pct, 42);
    assert.equal(untouched.stage_index, 2);
    assert.equal(untouched.step_text, "kept");

    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });

  it("lights the chip for a sentence the worker actually writes, and only then", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("progress-index", id);
    const stages = ["Opening source material", "Writing the draft"];
    await setJobStages(job.id, stages);

    // The worker holds the seeded row, so it can place its own sentences in it.
    const report = progressReporterFor({ ...job, stages_json: JSON.stringify(stages) });
    await report("Writing the draft");
    assert.equal((await stored(id))!.stage_index, 1);

    // "Interpreting packet.pdf: part 2 of 7" is not an arrival -- it is a step
    // inside stage 1. A reporter that guessed an index here would move the chip
    // backwards and tell the editor a stage had been restarted.
    await report("Interpreting packet.pdf: part 2 of 7");
    const midStage = (await stored(id))!;
    assert.equal(midStage.stage_index, 1);
    assert.equal(midStage.step_text, "Interpreting packet.pdf: part 2 of 7");

    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });

  it("places a sentence by exact match, so a list cannot claim a stage nobody reaches", () => {
    const job = { stages_json: JSON.stringify(["Opening source material", "Writing the draft"]) };
    assert.equal(stageIndexFor(job, "Writing the draft"), 1);
    // Case, punctuation and a trailing space are all differences: a chip only
    // lights for a string the worker literally writes.
    assert.equal(stageIndexFor(job, "writing the draft"), undefined);
    assert.equal(stageIndexFor(job, "Writing the draft "), undefined);
    // No list, unparseable list, and a non-string entry all mean the same thing
    // to a card: no chip row.
    assert.equal(stageIndexFor({ stages_json: null }, "Writing the draft"), undefined);
    assert.equal(stageIndexFor({ stages_json: "not json" }, "Writing the draft"), undefined);
    assert.equal(stageIndexFor(null, "Writing the draft"), undefined);
  });

  it("hands the worker the stage list it seeded at claim time", async () => {
    const id = freshSubject();
    const job = await enqueueDraft("progress-seed", id);
    const seen: DeskJob[] = [];
    __setJobWorkForTest(async (claimed) => {
      seen.push(claimed);
    });
    try {
      assert.equal(await executeJob(job), true);
    } finally {
      __setJobWorkForTest();
    }
    assert.equal(seen.length, 1);
    assert.deepEqual(JSON.parse(seen[0].stages_json ?? "null"), JOB_STAGE_LISTS.draft);
    // Zero, not null: the job is at the start of a list, which is different from
    // a kind that has no list at all.
    assert.equal(seen[0].stage_index, 0);
    // The seeded row is the one the WORKER gets, not just the one the database
    // keeps. A worker handed the pre-claim row would resolve every arrival
    // against the null list that row arrived with, and the chip row would never
    // move no matter how much the job reported.
    assert.equal(stageIndexFor(seen[0], JOB_STAGE_LISTS.draft![0]), 0);
  });

  it("calls a job stalled at 60s of quiet and not at 59s", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("progress-stall", id);
    const quietFor = async (seconds: number): Promise<DeskJob> => {
      await sql`
        update desk_jobs
        set status = 'running', beat_at = now() - make_interval(secs => ${seconds})
        where id = ${job.id} and newsroom_id = ${NEWSROOM}
      `;
      return (await stored(id))!;
    };
    assert.equal(jobProgressStalled(await quietFor(59)), false);
    assert.equal(jobProgressStalled(await quietFor(60)), true);
    // One second past the boundary stays stalled: the state is a threshold, not
    // a window.
    assert.equal(jobProgressStalled(await quietFor(61)), true);

    // A worker that never reported is not stalled: null is "no evidence", not
    // "very quiet", and the reclaim window is what deals with that job.
    await sql`
      update desk_jobs set beat_at = null where id = ${job.id} and newsroom_id = ${NEWSROOM}
    `;
    assert.equal(jobProgressStalled(await stored(id)), false);

    // The same rule off the clock, with no database at all, because the card
    // and the server must answer this identically or the editor is offered
    // "Retry on next model" for a job that is working perfectly.
    const now = Date.now();
    assert.equal(
      jobProgressStalled({ status: "running", beat_at: new Date(now - 59_000).toISOString() }, now),
      false,
    );
    assert.equal(
      jobProgressStalled({ status: "running", beat_at: new Date(now - 60_000).toISOString() }, now),
      true,
    );
    // Finished is not stalled, and queued has not started.
    assert.equal(
      jobProgressStalled({ status: "completed", beat_at: new Date(now - 600_000).toISOString() }, now),
      false,
    );
    assert.equal(
      jobProgressStalled({ status: "queued", beat_at: new Date(now - 600_000).toISOString() }, now),
      false,
    );

    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });

  it("stops at the next step boundary when the editor cancels, with the honest reason", async () => {
    assert.equal(new JobCancelledError().message, JOB_CANCELLED_REASON);
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("progress-cancel", id);
    __setJobWorkForTest(async (claimed) => {
      await reportProgress(claimed.id, { step: "Writing the draft", pct: 40 });
      await throwIfJobCancelled(claimed.id); // boundary 1: nothing asked yet
      await reportProgress(claimed.id, { step: "Checking the draft against the evidence" });
      await requestJobCancel(claimed.id); // the editor presses Cancel mid-run
      assert.equal(await jobCancelRequested(claimed.id), true);
      await throwIfJobCancelled(claimed.id); // boundary 2: stop, do not finish
      throw new Error("a cancelled job must not reach the end of its own work");
    });
    try {
      assert.equal(await executeJob(job), true);
    } finally {
      __setJobWorkForTest();
    }
    const stopped = (await stored(id)) as DeskJob;
    // A cancel is a failed job whose reason is the editor's, because the card's
    // three states are running, done and failed -- and "Cancelled by the editor"
    // with Retry beside it is what the editor needs to see.
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error, JOB_CANCELLED_REASON);
    assert.equal(stopped.step_text, "Checking the draft against the evidence");
    assert.equal(stopped.pct, 40, "the failed card shows how far it got");

    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });

  it("does not run work at all for a job cancelled while it was still queued", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("progress-cancel-queued", id);
    await requestJobCancel(job.id);
    const ran: number[] = [];
    __setJobWorkForTest(async (claimed) => {
      ran.push(claimed.id);
    });
    try {
      assert.equal(await executeJob(job), true);
    } finally {
      __setJobWorkForTest();
    }
    assert.deepEqual(ran, [], "the claim was refused, so no model was ever reached");
    assert.equal((await stored(id))!.status, "failed");
    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });
});

/**
 * Same drift risk as 0017/0019/0032, for the same reason: the seven progress
 * columns and the running index are declared once for real Postgres
 * (migrations/0099_desk_job_progress.sql) and once for the embedded PGLite path
 * (ensureJobsSchema). The card renders all seven, so drift here is visible on
 * screen rather than only in a diff.
 */
describe("the structured-progress columns are declared the same in both places", () => {
  it("migration and ensureJobsSchema agree", async () => {
    const fs = await import("node:fs");
    const migration = fs.readFileSync(
      new URL("../../../migrations/0099_desk_job_progress.sql", import.meta.url),
      "utf8",
    );
    const code = fs.readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
    const norm = (t: string) => t.toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
    for (const part of [
      "add column if not exists stages_json text",
      "add column if not exists stage_index integer",
      "add column if not exists pct integer",
      "add column if not exists step_text text",
      "add column if not exists beat_at timestamptz",
      "add column if not exists cancel_requested boolean not null default false",
      "add column if not exists result_href text",
      "create index if not exists desk_jobs_running_idx on desk_jobs (newsroom_id, id desc) where status in ('queued', 'running')",
    ]) {
      assert.ok(norm(migration).includes(part), `migration missing: ${part}`);
      assert.ok(norm(code).includes(part), `ensureJobsSchema missing: ${part}`);
    }
  });
});
