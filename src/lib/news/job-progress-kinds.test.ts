import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __setJobWorkForTest,
  clampPct,
  countedStep,
  enqueueJob,
  executeJob,
  JOB_KINDS,
  JOB_STAGE_LISTS,
  jobProgressStalled,
  jobStages,
  pctFor,
  progressReporterFor,
  spanPct,
  type DeskJob,
  type JobKind,
} from "./jobs.ts";
import { getSql } from "../db.ts";
import { jobProgressView, readDeskJobs } from "./job-progress.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

/*
  `readDeskJobs` reads `drafts` and `leads` to give a story job its headline --
  both migrated tables, and neither is one `ensureJobsSchema` writes.
  `scripts/run-tests-safe.mjs` registers `migrations/*.sql` as a preload, so the
  ordinary suite opens PGlite with them already there;
  `scripts/run-postgres-integration.mjs` runs the same file WITHOUT that
  preload, which is how the postgres-integration lane met
  `relation "drafts" does not exist` (42P01) here while the file was green in
  the ordinary suite. Asking for the schema is how this fixture says it needs
  one -- the same call `dark-queue.test.ts` makes.
*/
await applyMigrationsToTestPglite();

describe("reporting result navigation", () => {
  const requestJob = { id: 326, kind: "reporting", subject_id: 8, status: "running", model_choice: "local-model", result_href: null, started_at: null, finished_at: null, beat_at: null } as DeskJob;
  it("never treats a reporting request ID as a lead ID", () => {
    assert.equal(jobProgressView(requestJob, 0, null).resultHref, "/desk/queue");
    assert.equal(jobProgressView(requestJob, 326, null).resultHref, "/desk/story/326");
  });
  it("keeps the worker's explicit result link", () => {
    assert.equal(jobProgressView({ ...requestJob, result_href: "/desk/story/415" }, 326, null).resultHref, "/desk/story/415");
  });
});

/*
  THE PROGRESS MODEL, FOR EVERY KIND (FB1, units 1-3).

  `job-progress.test.ts` proves the model on ONE kind (`draft`) because that was
  the only kind with a stage list when it was written. This file is the same
  proof stated for all eleven, plus the two things the owner's complaint was
  actually about:

    - the bar moves  ->  a counted step's percentage climbs and never falls
    - the chips move ->  every arrival lights its own chip, on every kind

  and the ONE READER:

    - `readDeskJobs` returns every kind, not just drafts, and an OPEN job is
      never paged out of the window by the finished ones behind it.

  NO MODEL IS LOADED OR CALLED. Every kind's real work is replaced through
  `__setJobWorkForTest`, the same seam `jobs.test.ts` uses, so what runs here is
  the claim, the seeding, the reporting and the terminal writes -- which is the
  machinery under test -- and not a worker with a provider behind it.
*/

/** A newsroom nobody else's fixtures touch. */
const NEWSROOM = 91777;
/** A second, so the reader's window can be filled without disturbing the first. */
const READER_NEWSROOM = 91778;

const subject = { next: 93001 };
const freshSubject = () => subject.next++;

const storedJob = async (id: number, newsroomId = NEWSROOM): Promise<DeskJob> => {
  const sql = await getSql();
  const [row] = await sql<DeskJob>`
    select * from desk_jobs where id = ${id} and newsroom_id = ${newsroomId}
  `;
  return row!;
};

const enqueue = (kind: JobKind, newsroomId = NEWSROOM, subjectId = freshSubject()) =>
  enqueueJob({ userId: `fb1-${kind}`, newsroomId, kind, subjectId, kick: false });

describe("the progress model, for every kind", () => {
  it("seeds the claim with the kind's own stage list, and lights every chip in order", async () => {
    for (const kind of JOB_KINDS) {
      const job = await enqueue(kind);
      const seen: DeskJob[] = [];
      __setJobWorkForTest(async (claimed) => {
        const stages = JOB_STAGE_LISTS[claimed.kind];
        /*
          The seeded row is what the WORKER gets, and that is the whole point:
          the list is written at claim and `stageIndexFor` reads it off the row
          the worker was handed. A worker given the pre-claim row would resolve
          every arrival against null and no chip would ever light -- which is
          exactly what happened to eight of these eleven kinds before FB1.
        */
        assert.deepEqual(jobStages(claimed), [...stages], `${kind}: the worker holds the list`);
        const report = progressReporterFor(claimed, { minWriteMs: 0 });
        for (const [index, phrase] of stages.entries()) {
          await report(phrase);
          const row = await storedJob(claimed.id);
          assert.equal(row.stage_index, index, `${kind}: "${phrase}" lights chip ${index}`);
          assert.equal(row.step_text, phrase, `${kind}: the step line is the arrival`);
          // A worker that has just spoken is a worker that is alive: the stall
          // rule the card reads must not fire on a job mid-report.
          assert.equal(jobProgressStalled(row), false, `${kind}: reporting is a heartbeat`);
          seen.push(row);
        }
        /*
          A sentence that is NOT an arrival moves the "Now:" line and leaves the
          chip where it was. This is the rule the report's R2 hinges on -- the
          per-page and per-batch sentences are steps, not stages -- and a
          reporter that guessed an index for them would walk the chip row
          backwards twice a minute.
        */
        await report(`a sentence in no list at all (${kind})`);
        const after = await storedJob(claimed.id);
        assert.equal(after.stage_index, stages.length - 1, `${kind}: the chip holds`);
        assert.equal(after.step_text, `a sentence in no list at all (${kind})`);
      });
      try {
        assert.equal(await executeJob(job), true);
      } finally {
        __setJobWorkForTest();
      }
      const done = await storedJob(job.id);
      assert.equal(done.status, "completed", `${kind}: the run finished`);
      assert.ok(seen.length > 0, `${kind}: at least one arrival was reported`);
      await (await getSql())`delete from desk_jobs where id = ${job.id}`;
    }
  });

  it("climbs a counted step's percentage and never lets it fall, on every kind", async () => {
    for (const kind of JOB_KINDS) {
      const job = await enqueue(kind);
      const percentages: number[] = [];
      __setJobWorkForTest(async (claimed) => {
        const report = progressReporterFor(claimed, { minWriteMs: 0 });
        // The counted tick, in the shape every counting worker uses: a label, a
        // done/total pair, and `spanPct` over the slice of the bar that phase
        // owns.
        for (let done = 1; done <= 4; done += 1) {
          await report(countedStep("Reading sources", done, 4), spanPct(done, 4, 5, 55));
          const row = await storedJob(claimed.id);
          assert.notEqual(row.pct, null, `${kind}: a counted tick is a percentage`);
          assert.ok(
            row.pct! >= 0 && row.pct! <= 100,
            `${kind}: ${row.pct} is inside the bar`,
          );
          percentages.push(row.pct!);
        }
        // The end of a phase lands where the span says it lands. Without this
        // the bar could be monotonic and still mean nothing.
        assert.equal(percentages.at(-1), 55, `${kind}: the fetch slice ends at its own bound`);
      });
      try {
        assert.equal(await executeJob(job), true);
      } finally {
        __setJobWorkForTest();
      }
      assert.deepEqual(
        percentages,
        [...percentages].sort((a, b) => a - b),
        `${kind}: the bar only ever moves forwards`,
      );
      assert.equal(new Set(percentages).size, percentages.length, `${kind}: every tick moved it`);
      await (await getSql())`delete from desk_jobs where id = ${job.id}`;
    }
  });

  it("answers 0-100 for every stage of every kind, and null for no denominator", () => {
    for (const kind of JOB_KINDS) {
      const stages = JOB_STAGE_LISTS[kind];
      const list: number[] = [];
      for (let index = 0; index < stages.length; index += 1) {
        const pct = pctFor(index, stages.length);
        assert.ok(pct != null && pct >= 0 && pct <= 100, `${kind}: stage ${index} is inside the bar`);
        list.push(pct!);
      }
      assert.deepEqual(list, [...list].sort((a, b) => a - b), `${kind}: stage percentages climb`);
    }
    // No denominator is null and NOT 100: a worker that does not yet know how
    // many pages a PDF has is not finished, it is a worker with no number.
    assert.equal(pctFor(0, 0), null);
    assert.equal(pctFor(5, 0), null);
    assert.equal(spanPct(0, 0, 5, 55), null);
    // ...and the clamp still holds at both ends.
    assert.equal(clampPct(pctFor(200, 100)!), 100);
    assert.equal(spanPct(99, 10, 5, 55), 55);
  });

  it("keeps a stage list written once at claim, whatever the worker reports", async () => {
    const job = await enqueue("scan");
    __setJobWorkForTest(async (claimed) => {
      const report = progressReporterFor(claimed, { minWriteMs: 0 });
      for (const phrase of JOB_STAGE_LISTS.scan) await report(phrase);
      const row = await storedJob(claimed.id);
      /*
        The list is not rewritten by reporting. It is what `stageIndexFor`
        resolves against, so a worker that rewrote it mid-run would move its own
        chips underneath itself -- which is why `setJobStages` is a separate
        function with no production callers.
      */
      assert.deepEqual(jobStages(row), [...JOB_STAGE_LISTS.scan]);
    });
    try {
      assert.equal(await executeJob(job), true);
    } finally {
      __setJobWorkForTest();
    }
    await (await getSql())`delete from desk_jobs where id = ${job.id}`;
  });

  it("writes a counted tick at most once a second, and never drops an arrival", async () => {
    const job = await enqueue("scan");
    let ticks = 0;
    let clock = 1_000_000;
    __setJobWorkForTest(async (claimed) => {
      // A frozen clock is the only way to test a throttle: waiting a real
      // second per tick would make this the slowest test in the suite.
      const report = progressReporterFor(claimed, { now: () => clock });
      for (let done = 1; done <= 5; done += 1) {
        await report(countedStep("Reading sources", done, 5), pctFor(done, 5));
      }
      const row = await storedJob(claimed.id);
      ticks = row.pct!;
      // Five ticks inside one second: the first lands, the rest wait. The
      // percentage is the first tick's, not the fifth's.
      assert.equal(ticks, 20, "only the first counted tick of the second landed");
      // A stage arrival is never throttled, however fast it follows -- a chip
      // that skips under load is a lie about where the job is.
      clock += 10;
      await report("Reading the sources");
      const arrived = await storedJob(claimed.id);
      assert.equal(arrived.stage_index, 1, "the arrival landed inside the window");
      // ...and the next second's tick goes through.
      clock += 1_000;
      await report(countedStep("Reading sources", 5, 5), pctFor(5, 5));
      assert.equal((await storedJob(claimed.id)).pct, 100);
    });
    try {
      assert.equal(await executeJob(job), true);
    } finally {
      __setJobWorkForTest();
    }
    await (await getSql())`delete from desk_jobs where id = ${job.id}`;
  });
});

describe("one reader for every kind", () => {
  it("returns a card for all eleven kinds, not only the story ones", async () => {
    /*
      THE REPORT'S R2, AS A TEST. `listStoryJobProgress` filtered
      `kind in ('draft','reconcile')` and the shell's own reader filtered
      `kind='draft'`, so six of these eleven kinds had no card surface anywhere
      in the product. This enqueues one job of every kind and asks the reader
      for them by name.
    */
    const sql = await getSql();
    const made: number[] = [];
    for (const kind of JOB_KINDS) {
      const job = await enqueue(kind, READER_NEWSROOM);
      made.push(job.id);
    }
    const rows = await readDeskJobs(READER_NEWSROOM);
    const kinds = new Set(rows.map((row) => row.kind));
    for (const kind of JOB_KINDS) {
      assert.ok(kinds.has(kind), `the reader returns a ${kind} job`);
    }
    /*
      A non-story kind carries NO lead id. A scan's `subject_id` is a
      `scan_runs` id and a routine edition's is a `routine_notice_runs` id;
      handing one to a screen that navigates to `/desk/story/$leadId` would open
      whichever story happened to share the number.
    */
    for (const row of rows) {
      const storyKind = row.kind === "draft" || row.kind === "reconcile";
      if (!storyKind) assert.equal(row.leadId, 0, `${row.kind} has no lead`);
      if (!storyKind) assert.equal(row.headline, null, `${row.kind} has no headline`);
      // Every kind has its own title and its own word for Done now, so no card
      // can print "scan" or "Done" where the editor expects prose.
      assert.ok(row.title.length > 0 && row.title !== row.kind, `${row.kind} has a title`);
      assert.ok(row.doneText.length > 0 && row.doneText !== "Done", `${row.kind} has done text`);
    }
    await sql`delete from desk_jobs where id = any(${made}::int[])`;
  });

  it("keeps an open job in the window behind thirty finished ones", async () => {
    /*
      The ordering is not a detail. `order by id desc limit 30` would page a
      long-running scan out of the window as the newsroom's history grew -- the
      card the editor is watching would simply vanish. Open rows sort first.
    */
    const sql = await getSql();
    const done: number[] = [];
    for (let n = 0; n < 31; n += 1) {
      const job = await enqueue("draft", READER_NEWSROOM);
      await sql`
        update desk_jobs set status = 'completed', finished_at = now(), stage = 'Done'
        where id = ${job.id}
      `;
      done.push(job.id);
    }
    const scan = await enqueue("scan", READER_NEWSROOM);
    const rows = await readDeskJobs(READER_NEWSROOM);
    assert.equal(rows[0]?.id, scan.id, "the open job is first, not thirtieth");
    assert.equal(rows[0]?.kind, "scan");
    assert.equal(rows[0]?.status, "queued");
    await sql`delete from desk_jobs where id = any(${[...done, scan.id]}::int[])`;
  });

  it("gives a story job its headline and a run job its own title", async () => {
    const sql = await getSql();
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, status)
      values (${`fb1-reader`}, ${READER_NEWSROOM}, ${"Council votes on the water contract"}, ${"why"}, ${"new"})
      returning id
    `;
    const leadId = leadRows[0]!.id;
    const draftJob = await enqueue("draft", READER_NEWSROOM, leadId);
    const scanJob = await enqueue("scan", READER_NEWSROOM);
    const rows = await readDeskJobs(READER_NEWSROOM);
    const draftRow = rows.find((row) => row.id === draftJob.id)!;
    const scanRow = rows.find((row) => row.id === scanJob.id)!;
    assert.equal(draftRow.headline, "Council votes on the water contract");
    assert.equal(draftRow.leadId, leadId);
    assert.equal(scanRow.headline, null);
    assert.equal(scanRow.title, "Scanning the watch list");
    await sql`delete from desk_jobs where id = any(${[draftJob.id, scanJob.id]}::int[])`;
    await sql`delete from leads where id = ${leadId}`;
  });
});
