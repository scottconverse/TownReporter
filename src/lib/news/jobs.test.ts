import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueJob,
  findOpenJob,
  latestJob,
  drainQueuedJobs,
  executeJob,
  ensureJobsSchema,
  annotateScanRowsWithStallStatus,
  jobHeartbeatStale,
  runLooksStalled,
  laneForKind,
  STALE_RUNNING_SECONDS,
  HEARTBEAT_MS,
  __setJobWorkForTest,
  setJobFailoverNote,
  scanDispatchMode,
  type DeskJob,
} from "./jobs.ts";
import { getSql } from "../db.ts";

function fakeJob(over: Partial<DeskJob>): DeskJob {
  return {
    id: 1,
    newsroom_id: 1,
    user_id: "u",
    kind: "scan",
    subject_id: 1,
    model_choice: "auto",
    model_choice_source: "editor",
    lane: "default",
    status: "running",
    stage: "",
    failover_note: "",
    error: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    finished_at: null,
    ...over,
  };
}

/**
 * Bound a wait, so a claim that never happens fails the test with a reason
 * instead of hanging the whole file -- node's test runner has no default
 * per-test timeout, and a blocked worker left holding its gate would outlive
 * the test that started it.
 */
function withDeadline<T>(promise: Promise<T>, what: string, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
    timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** The terminal columns the claim-token guard decides the fate of. */
type JobTerminalRow = {
  status: string;
  stage: string;
  claim_token: string | null;
  error: string | null;
  finished_at: unknown;
};

type SupersededExecutionRace = {
  job: DeskJob;
  tokenA: string;
  tokenB: string;
  releaseGhost(): void;
  releaseOwner(): void;
  /** Let the superseded execution finish its own code path; the value is its `executeJob` result. */
  settleGhost(): Promise<boolean>;
  /** Let the execution that took the row over finish its own code path. */
  settleOwner(): Promise<boolean>;
  /** The job's terminal columns, read fresh from the database. */
  row(): Promise<JobTerminalRow | undefined>;
  /** Release both gates, drain both executions, restore the work seam, remove the row. */
  finish(): Promise<void>;
};

/**
 * Drive the superseded-execution race through production code, with no
 * stand-in for the ghost's terminal write.
 *
 * Execution A claims a draft job and blocks inside its work. Its heartbeat is
 * `HEARTBEAT_MS` (30s) away and nothing else moves `updated_at`, so the test
 * can push the row past `STALE_RUNNING_SECONDS` and leave it there. Execution
 * B then re-claims that same stale row through `executeJob`'s real reclaim
 * path and blocks too, so B is the live owner while A is still inside its own
 * `executeJob`. Releasing A makes it finish through the same try/catch the
 * production drainer uses -- claim token, heartbeat, reclaim and both terminal
 * writes all belong to `jobs.ts`, not to this file.
 *
 * The only thing swapped is what the work itself does (`__setJobWorkForTest`,
 * jobs.ts:310): a 40-minute draft cannot run here, and the race is about the
 * claim boundary around the work, not the work.
 */
async function startSupersededExecutionRace(opts: {
  newsroomId: number;
  subjectId: number;
  /** What the superseded execution's work does once the test releases it. */
  ghostWork: () => Promise<void>;
}): Promise<SupersededExecutionRace> {
  await ensureJobsSchema();
  const sql = await getSql();
  const job = await enqueueJob({
    userId: `job-superseded-${Date.now()}`,
    newsroomId: opts.newsroomId,
    kind: "draft",
    subjectId: opts.subjectId,
    kick: false,
  });

  // Tokens in the order executions enter their work: [A (ghost), B (owner)].
  const tokens: string[] = [];
  let releaseGhost!: () => void;
  const ghostGate = new Promise<void>((resolve) => {
    releaseGhost = resolve;
  });
  let releaseOwner!: () => void;
  const ownerGate = new Promise<void>((resolve) => {
    releaseOwner = resolve;
  });
  let ghostEntered!: () => void;
  const ghostInWork = new Promise<void>((resolve) => {
    ghostEntered = resolve;
  });
  let ownerEntered!: () => void;
  const ownerInWork = new Promise<void>((resolve) => {
    ownerEntered = resolve;
  });

  __setJobWorkForTest(async (claimed) => {
    tokens.push(claimed.claim_token ?? "");
    if (tokens.length === 1) {
      ghostEntered();
      await ghostGate;
      await opts.ghostWork();
      return;
    }
    ownerEntered();
    await ownerGate;
  });

  let ghostRun: Promise<boolean> | undefined;
  let ownerRun: Promise<boolean> | undefined;
  const settle = async () => {
    releaseGhost();
    releaseOwner();
    await ghostRun?.catch(() => undefined);
    await ownerRun?.catch(() => undefined);
  };

  try {
    ghostRun = executeJob(job);
    await withDeadline(ghostInWork, "the first execution to enter its work");
    const tokenA = tokens[0]!;
    assert.ok(tokenA, "the first execution must stamp a claim token");

    // A has gone quiet past the reclaim window: the shape of a process that
    // died mid-run, from every other drainer's point of view.
    await sql`
      update desk_jobs
      set updated_at = now() - make_interval(secs => ${STALE_RUNNING_SECONDS + 60})
      where id = ${job.id} and claim_token = ${tokenA}
    `;

    ownerRun = executeJob({ ...job, status: "running" });
    await withDeadline(ownerInWork, "the second execution to claim the reclaimed row");
    const tokenB = tokens[1]!;
    assert.ok(tokenB, "the reclaiming execution must stamp its own claim token");
    assert.notEqual(tokenB, tokenA, "each execution mints its own claim token");

    const row = async () =>
      (
        await sql<JobTerminalRow>`
          select status, stage, claim_token, error, finished_at
          from desk_jobs where id = ${job.id}
        `
      )[0];

    return {
      job,
      tokenA,
      tokenB,
      releaseGhost,
      releaseOwner,
      async settleGhost() {
        releaseGhost();
        return await ghostRun!;
      },
      async settleOwner() {
        releaseOwner();
        return await ownerRun!;
      },
      row,
      async finish() {
        await settle();
        __setJobWorkForTest();
        await sql`delete from desk_jobs where id = ${job.id}`;
      },
    };
  } catch (error) {
    // Setup failed with workers still holding their gates: let them go and
    // clean up, or the failure would be a hung test file rather than a message.
    await settle();
    __setJobWorkForTest();
    await sql`delete from desk_jobs where id = ${job.id}`;
    throw error;
  }
}

describe("desk jobs", () => {
  it("refuses a scheduled scan whose reservation metadata is missing", () => {
    assert.throws(
      () => scanDispatchMode({ model_choice_source: "scheduled" }, false),
      /reservation is missing/,
    );
    assert.equal(scanDispatchMode({ model_choice_source: "editor" }, false), "manual");
    assert.equal(scanDispatchMode({ model_choice_source: "scheduled" }, true), "scheduled");
  });
  it("keeps supplied-material scope when another enqueue races with a broader scope", async () => {
    const request = { userId: "scope-race", newsroomId: 91009, kind: "draft" as const, subjectId: 71717, kick: false };
    const first = await enqueueJob({ ...request, researchScope: "supplied" });
    const second = await enqueueJob({ ...request, researchScope: "public" });
    assert.equal(second.id, first.id);
    assert.equal(second.research_scope, "supplied");
    assert.equal((await latestJob(request))?.research_scope, "supplied");
    const sql = await getSql();
    await sql`delete from desk_jobs where id = ${first.id} and newsroom_id = 91009`;
  });
  it("persists the editor's model choice on the queued job", async () => {
    const newsroomId = 91000;
    const enqueueWithModel = enqueueJob as unknown as (
      opts: Parameters<typeof enqueueJob>[0] & { modelChoice: string },
    ) => Promise<DeskJob & { model_choice: string }>;
    const job = await enqueueWithModel({
      userId: `job-model-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 515151,
      modelChoice: "codex-frontier",
      kick: false,
    });
    assert.equal(job.model_choice, "codex-frontier");
    const latest = (await latestJob({ newsroomId, kind: "draft", subjectId: 515151 })) as
      (DeskJob & { model_choice: string }) | null;
    assert.equal(latest?.model_choice, "codex-frontier");
  });

  it("defaults model_choice_source to editor, and persists 'auto' when Automatic queued it", async () => {
    const newsroomId = 91001;
    const editorJob = await enqueueJob({
      userId: `job-source-editor-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 616161,
      modelChoice: "claude-frontier",
      kick: false,
    });
    assert.equal(editorJob.model_choice_source, "editor");
    const editorFound = await findOpenJob({ newsroomId, kind: "draft", subjectId: 616161 });
    assert.equal(editorFound?.model_choice_source, "editor");
    const editorLatest = await latestJob({ newsroomId, kind: "draft", subjectId: 616161 });
    assert.equal(editorLatest?.model_choice_source, "editor");

    const autoJob = await enqueueJob({
      userId: `job-source-auto-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 616162,
      modelChoice: "claude-frontier",
      modelChoiceSource: "auto",
      kick: false,
    });
    assert.equal(autoJob.model_choice_source, "auto");
    const autoFound = await findOpenJob({ newsroomId, kind: "draft", subjectId: 616162 });
    assert.equal(autoFound?.model_choice_source, "auto");
    const autoLatest = await latestJob({ newsroomId, kind: "draft", subjectId: 616162 });
    assert.equal(autoLatest?.model_choice_source, "auto");
  });

  /*
    0.6.8: the provider-switch reason used to live only in the transient
    `stage` column, which "Done" overwrites once the job finishes -- so an
    editor looking at a finished draft could no longer see why it switched
    models. `failover_note` is the durable twin; this confirms it defaults
    empty, that setJobFailoverNote persists it, and that it round-trips
    through every select list that enumerates job columns (latestJob and
    findOpenJob included) -- the exact drift risk model_choice_source's own
    column list carries.
  */
  it("defaults failover_note empty and persists it through setJobFailoverNote", async () => {
    const newsroomId = 91002;
    const created = await enqueueJob({
      userId: `job-failover-note-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 616163,
      modelChoice: "claude-frontier",
      modelChoiceSource: "auto",
      kick: false,
    });
    assert.equal(created.failover_note, "");

    const timeoutNote = "This draft moved to Codex Sol 6.1 (balanced) because Claude Opus timed out";
    await setJobFailoverNote(created.id, timeoutNote);
    const foundAfterTimeout = await findOpenJob({ newsroomId, kind: "draft", subjectId: 616163 });
    assert.equal(foundAfterTimeout?.failover_note, timeoutNote);
    const latestAfterTimeout = await latestJob({ newsroomId, kind: "draft", subjectId: 616163 });
    assert.equal(latestAfterTimeout?.failover_note, timeoutNote);

    const authNote = "This draft moved to Codex Sol 6.1 (balanced) because Claude Opus sign-in lapsed";
    await setJobFailoverNote(created.id, authNote);
    const latestAfterAuth = await latestJob({ newsroomId, kind: "draft", subjectId: 616163 });
    assert.equal(latestAfterAuth?.failover_note, authNote);
  });

  it("keeps completed fake model work as an unpublished draft on a cold database read", async () => {
    const sql = await getSql();
    await sql.query(`
      create table if not exists leads (
        id serial primary key,
        user_id text not null,
        headline text not null,
        why text not null,
        topic text not null default 'council',
        status text not null default 'new',
        source_urls text not null default '[]',
        created_at timestamptz not null default now()
      )
    `);
    await sql.query(`
      create table if not exists drafts (
        id serial primary key,
        user_id text not null,
        lead_id integer not null references leads(id) on delete cascade,
        headline text not null,
        dek text not null default '',
        body text not null,
        topic text not null,
        source_urls text not null default '[]',
        integrity_notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await sql.query(`
      create table if not exists articles (
        id serial primary key,
        user_id text not null,
        lead_id integer references leads(id) on delete set null,
        slug text not null unique,
        headline text not null,
        dek text not null default '',
        body text not null,
        topic text not null,
        source_urls text not null default '[]',
        status text not null default 'published',
        published_at timestamptz not null default now(),
        /* 0098. Hand-built schema tracks production, column for column. */
        area text
      )
    `);

    const userId = `persisted-model-${Date.now()}-${Math.random()}`;
    const newsroomId = 92000 + Math.floor(Math.random() * 1000);
    const [lead] = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic, source_urls)
      values (${userId}, ${"Council adopts the water plan"}, ${"A recorded public vote"},
              ${"council"}, ${'["https://example.gov/packet"]'})
      returning id
    `;
    assert.ok(lead);
    const modelResult = {
      headline: "Council adopts the water plan",
      dek: "The unanimous vote follows a public hearing.",
      body: "The council voted 7-0 after reviewing the staff packet and hearing public comment.",
      topic: "council",
      source_urls: '["https://example.gov/packet","https://example.gov/minutes"]',
      integrity_notes: "Vote and date checked against the official minutes.",
    };
    const job = await enqueueJob({
      userId,
      newsroomId,
      kind: "draft",
      subjectId: lead.id,
      modelChoice: "claude-frontier",
      kick: false,
    });

    try {
      __setJobWorkForTest(async (claimedJob) => {
        assert.equal(claimedJob.id, job.id);
        const workerSql = await getSql();
        await workerSql`
          insert into drafts
            (user_id, lead_id, headline, dek, body, topic, source_urls, integrity_notes)
          values
            (${userId}, ${lead.id}, ${modelResult.headline}, ${modelResult.dek},
             ${modelResult.body}, ${modelResult.topic}, ${modelResult.source_urls},
             ${modelResult.integrity_notes})
        `;
        await workerSql`update leads set status = 'drafted' where id = ${lead.id}`;
      });

      assert.equal(await executeJob(job), true);
      __setJobWorkForTest();

      // The worker seam and its local SQL variable are gone. Read the durable
      // result back through a new query, as a later request would after work
      // completed, instead of asserting on anything returned by the fake.
      const coldSql = await getSql();
      const drafts = await coldSql<typeof modelResult>`
        select headline, dek, body, topic, source_urls, integrity_notes
        from drafts where lead_id = ${lead.id}
      `;
      assert.deepEqual(drafts, [modelResult]);

      const [storedLead] = await coldSql<{ status: string }>`
        select status from leads where id = ${lead.id}
      `;
      assert.equal(storedLead?.status, "drafted");
      assert.equal(
        (await latestJob({ newsroomId, kind: "draft", subjectId: lead.id }))?.status,
        "completed",
      );

      const [published] = await coldSql<{ count: number }>`
        select count(*) as count from articles
        where lead_id = ${lead.id} and status = 'published'
      `;
      assert.equal(Number(published?.count), 0, "model work must stop at an editor-visible draft");
    } finally {
      __setJobWorkForTest();
      await sql`delete from articles where lead_id = ${lead.id}`;
      await sql`delete from drafts where lead_id = ${lead.id}`;
      await sql`delete from desk_jobs where id = ${job.id}`;
      await sql`delete from leads where id = ${lead.id}`;
    }
  });

  it("reuses a queued/running job for the same subject", async () => {
    const user = `job-${Date.now()}`;
    const newsroomId = 91001;
    const a = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 424242,
      kick: false,
    });
    const b = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 424242,
      kick: false,
    });
    assert.equal(a.id, b.id);
    const latest = await latestJob({ newsroomId, kind: "draft", subjectId: 424242 });
    assert.equal(latest?.id, a.id);
    assert.ok(latest?.status === "queued" || latest?.status === "running");
  });

  it("keeps the first persisted model authoritative when conflicting requests coalesce", async () => {
    const newsroomId = 91002;
    const subjectId = 424243;
    const first = await enqueueJob({
      userId: `job-choice-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId,
      modelChoice: "claude-frontier",
      kick: false,
    });
    const second = await enqueueJob({
      userId: `job-choice-${Date.now()}-second`,
      newsroomId,
      kind: "draft",
      subjectId,
      modelChoice: "codex-frontier",
      kick: false,
    });
    assert.equal(second.id, first.id);
    assert.equal(
      second.model_choice,
      "claude-frontier",
      "a coalesced caller must receive the real persisted choice",
    );
  });

  it("finds an open scan without knowing the run id", async () => {
    const user = `job-scan-${Date.now()}`;
    const newsroomId = 91002;
    const a = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "scan",
      subjectId: 9001,
      kick: false,
    });
    const found = await findOpenJob({ newsroomId, kind: "scan" });
    assert.ok(found);
    assert.equal(found.id, a.id);
    assert.equal(found.kind, "scan");
  });

  it("a wake-up finishes a queued job even if kick never ran", async () => {
    const user = `job-drain-${Date.now()}`;
    const newsroomId = 91003;
    const job = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 1,
      kick: false,
    });
    assert.equal(job.status, "queued");
    const { ran } = await drainQueuedJobs();
    assert.ok(ran >= 1);
    const latest = await latestJob({ newsroomId, kind: "draft", subjectId: 1 });
    assert.ok(latest);
    assert.ok(latest.status === "completed" || latest.status === "failed", latest.status);
    assert.notEqual(latest.status, "queued");
    if (latest.status === "failed") {
      assert.ok((latest.error ?? "").length > 0);
    }
  });

  it("two drainers cannot both run the same queued job", async () => {
    const user = `job-cas-${Date.now()}`;
    const newsroomId = 91004;
    const job = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 77,
      kick: false,
    });
    const [a, b] = await Promise.all([executeJob(job), executeJob(job)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const latest = await latestJob({ newsroomId, kind: "draft", subjectId: 77 });
    assert.ok(latest);
    assert.notEqual(latest.status, "queued");
  });

  it("stamps a claim token, so an execution can tell if it still owns the job", async () => {
    const newsroomId = 91005;
    const job = await enqueueJob({
      userId: `job-token-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 88,
      kick: false,
    });
    await executeJob(job);
    const sql = await getSql();
    const rows = await sql<{ claim_token: string | null }>`
      select claim_token from desk_jobs where id = ${job.id}
    `;
    assert.ok(rows[0]?.claim_token, "expected a claim token on the executed row");
  });

  /*
    The real shape of the bug, with no stand-in for the ghost's terminal write.

    A slow execution passes the stale window, a second drainer re-claims the
    row, and then the ORIGINAL finishes and writes its result over the top. The
    claim-token guard has to make that a no-op.

    This test used to hand-write the ghost's finish (`update desk_jobs ... where
    claim_token = 'ghost-worker'`), which only proved that a WHERE clause the
    test itself typed does what the test said -- deleting `and claim_token =
    ${token}` from the completion UPDATE in jobs.ts left it green. Both
    executions here are real `executeJob` calls and A finishes through its own
    code path; see `startSupersededExecutionRace`.

    THE GUARD'S OBSERVABLE MOMENT is while B still owns the row. Once B has
    finished, the shared `status = 'running'` clause in the completion UPDATE
    blocks a late write on its own, so the claim token is only load-bearing
    while the rightful owner is still running -- which is exactly the window
    this test holds open. What the guard prevents is not just a wrong row
    afterwards: an unguarded ghost write settles a job B is still working and
    then silently swallows B's own terminal write.
  */
  it("a superseded execution cannot overwrite the result of the one that took over", async () => {
    const race = await startSupersededExecutionRace({
      newsroomId: 91020,
      subjectId: 99,
      ghostWork: async () => undefined,
    });
    try {
      // The reclaim itself, still covered: B took a stale running row over.
      const owned = await race.row();
      assert.equal(owned?.status, "running");
      assert.equal(owned?.claim_token, race.tokenB, "the reclaim must stamp B's token");

      // A now finishes through its normal completion path while B owns the row.
      assert.equal(await race.settleGhost(), true);

      const afterGhost = await race.row();
      assert.equal(
        afterGhost?.status,
        "running",
        "the ghost's completion must not settle a row it no longer owns",
      );
      assert.equal(afterGhost?.claim_token, race.tokenB, "B must still own the row");
      assert.notEqual(afterGhost?.stage, "Done", "the ghost's terminal stage must not be written");
      assert.equal(afterGhost?.finished_at, null, "the ghost must not stamp a finish time");

      // B finishes normally: the settled row is B's result, not A's.
      assert.equal(await race.settleOwner(), true);

      const final = await race.row();
      assert.equal(final?.status, "completed");
      assert.equal(final?.claim_token, race.tokenB);
      assert.notEqual(final?.claim_token, race.tokenA, "the settled row must not carry A's token");
      assert.equal(final?.stage, "Done");
      assert.equal(final?.error, null);
      assert.ok(final?.finished_at, "B's finish time is the one that stands");
    } finally {
      await race.finish();
    }
  });

  /*
    The same race on the failure path (the `catch` at jobs.ts:~834).

    A's work throws after B has taken the row over, so A reaches its failure
    UPDATE while B still owns the row. Unguarded, that write marks B's live job
    failed and records A's error on it -- and because B's own completion then
    fails its `status = 'running'` test, B's successful work is recorded as a
    failure the editor is told about and cannot explain.

    That window is the whole value of the guard on this path: once B has
    finished, `status = 'running'` already blocks a late write by itself, so a
    test that only throws AFTER B completed cannot tell the token guard's
    presence from its absence. This one throws while B is still running.
  */
  it("a superseded execution's late failure cannot overwrite the work that took over", async () => {
    const race = await startSupersededExecutionRace({
      newsroomId: 91021,
      subjectId: 100,
      ghostWork: async () => {
        throw new Error("ghost worker failed");
      },
    });
    try {
      assert.equal(await race.settleGhost(), true);

      const afterGhost = await race.row();
      assert.equal(
        afterGhost?.status,
        "running",
        "the ghost's failure must not settle a row it no longer owns",
      );
      assert.equal(afterGhost?.error, null, "the ghost's error text must not be recorded");
      assert.equal(afterGhost?.claim_token, race.tokenB, "B must still own the row");
      assert.equal(afterGhost?.finished_at, null, "the ghost must not stamp a finish time");

      assert.equal(await race.settleOwner(), true);

      const final = await race.row();
      assert.equal(
        final?.status,
        "completed",
        "the owner's successful work must not be recorded as the ghost's failure",
      );
      assert.equal(final?.error, null);
      assert.equal(final?.claim_token, race.tokenB);
      assert.ok(final?.finished_at, "B's finish time is the one that stands");
    } finally {
      await race.finish();
    }
  });

  it("does not turn atomically completed work into a failure when redundant completion errors", async () => {
    await ensureJobsSchema();
    const sql = await getSql();
    const newsroomId = 91007;
    const job = await enqueueJob({
      userId: `job-terminal-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 100,
      kick: false,
    });
    await sql.query(`
      create or replace function reject_redundant_job_completion() returns trigger
      language plpgsql as $$
      begin
        if old.id = ${job.id} and old.status = 'completed' and new.status = 'completed' then
          raise exception 'redundant completion rejected';
        end if;
        return new;
      end $$
    `);
    await sql.query(`
      create trigger reject_redundant_job_completion_trigger
      before update on desk_jobs for each row
      execute function reject_redundant_job_completion()
    `);
    __setJobWorkForTest(async (claimedJob) => {
      await sql`
        update desk_jobs set status = 'completed', stage = 'Done', updated_at = now()
        where id = ${claimedJob.id} and claim_token = ${claimedJob.claim_token}
      `;
    });
    try {
      assert.equal(await executeJob(job), true);
      const [stored] = await sql<{ status: string; error: string | null }>`
        select status,error from desk_jobs where id = ${job.id}
      `;
      assert.deepEqual(stored, { status: "completed", error: null });
    } finally {
      __setJobWorkForTest();
      await sql.query(
        "drop trigger if exists reject_redundant_job_completion_trigger on desk_jobs",
      );
      await sql.query("drop function if exists reject_redundant_job_completion() cascade");
    }
  });

  it("does not downgrade completed work when its worker reports a late error", async () => {
    const sql = await getSql();
    const newsroomId = 91010;
    const job = await enqueueJob({
      userId: "late-error-terminal",
      newsroomId,
      kind: "draft",
      subjectId: 103,
      kick: false,
    });
    __setJobWorkForTest(async (claimedJob) => {
      await sql`
        update desk_jobs
        set status = 'completed', stage = 'Done', error = null, updated_at = now()
        where id = ${claimedJob.id} and claim_token = ${claimedJob.claim_token}
      `;
      throw new Error("late error after atomic completion");
    });
    try {
      assert.equal(await executeJob(job), true);
      const [stored] = await sql<{ status: string; error: string | null }>`
        select status,error from desk_jobs where id = ${job.id}
      `;
      assert.deepEqual(stored, { status: "completed", error: null });
    } finally {
      __setJobWorkForTest();
    }
  });

  it("still settles ordinary running work as completed or failed", async () => {
    const newsroomId = 91008;
    const success = await enqueueJob({
      userId: "ordinary-terminal",
      newsroomId,
      kind: "draft",
      subjectId: 101,
      kick: false,
    });
    __setJobWorkForTest(async () => undefined);
    try {
      assert.equal(await executeJob(success), true);
      assert.equal((await latestJob({ newsroomId, kind: "draft", subjectId: 101 }))?.status, "completed");

      const failure = await enqueueJob({
        userId: "ordinary-terminal",
        newsroomId,
        kind: "draft",
        subjectId: 102,
        kick: false,
      });
      __setJobWorkForTest(async () => {
        throw new Error("ordinary worker failure");
      });
      assert.equal(await executeJob(failure), true);
      const failed = await latestJob({ newsroomId, kind: "draft", subjectId: 102 });
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.error, "ordinary worker failure");
    } finally {
      __setJobWorkForTest();
    }
  });

  it("keeps a completed draft terminal while exposing required editorial review", async () => {
    const sql = await getSql();
    const newsroomId = 91011;
    const job = await enqueueJob({
      userId: "review-terminal",
      newsroomId,
      kind: "draft",
      subjectId: 104,
      kick: false,
    });
    __setJobWorkForTest(async (claimedJob) => {
      const resultJson = JSON.stringify({
        version: 2,
        finalDraftId: 99,
        draftId: 99,
        quality: {
          version: 1,
          citationStatus: "review-required",
          evidenceCheckIncomplete: false,
          nameCheckComplete: true,
          namesVerified: true,
          reviewRequired: true,
          reviewReasons: ["citations-missing"],
        },
      });
      await sql`
        update desk_jobs set result_json = ${resultJson}, updated_at = now()
        where id = ${claimedJob.id} and claim_token = ${claimedJob.claim_token}
      `;
    });
    try {
      assert.equal(await executeJob(job), true);
      const stored = await latestJob({ newsroomId, kind: "draft", subjectId: 104 });
      assert.equal(stored?.status, "completed");
      assert.equal(stored?.stage, "Draft saved — review required");
      assert.equal(JSON.parse(stored?.result_json ?? "{}").finalDraftId, 99);
    } finally {
      __setJobWorkForTest();
    }
  });
});

/**
 * ENG-105's core property, proven directly rather than by reading the code:
 * a long-running job in one lane must not delay a job queued in the other
 * lane. Before the fix, `drainQueuedJobs` was one serial loop guarded by a
 * single `draining` boolean and `await`ed each job to completion before
 * looking for the next -- so a 40-minute editorial held the whole drainer,
 * and a Scan or Draft queued behind it did not start until the editorial
 * returned.
 *
 * A real editorial takes ten to forty minutes and needs a configured model
 * provider, which this test suite has neither. `__setJobWorkForTest` swaps
 * `executeJob`'s actual work for a stand-in: for an `editorial` job it hangs
 * on a promise the test controls (modelling "still running"), for anything
 * else it resolves immediately. That is the fast stand-in the task asked
 * for, occupying the editorial lane without costing ten minutes or a cent.
 *
 * The exact mutation that must turn this test RED: collapse the two lanes
 * back into one -- e.g. make `drainQueuedJobs` call a single `drainLane`
 * with no `lane =` filter on its claim query (or restore the pre-ENG-105
 * single `for` loop that `await`s each job before looking for the next).
 * Either change makes the scan below wait behind the still-running
 * editorial stand-in, and the 5-second poll below times out.
 */
describe("job lanes (ENG-105)", () => {
  it("laneForKind puts editorial alone and everything else together", () => {
    assert.equal(laneForKind("editorial"), "editorial");
    assert.equal(laneForKind("scan"), "default");
    assert.equal(laneForKind("draft"), "default");
    assert.equal(laneForKind("dark"), "default");
  });

  it("a long editorial job does not delay a job queued in the default lane", async () => {
    const newsroomId = 96001 + Math.floor(Math.random() * 1000);
    let releaseEditorial: () => void = () => {};
    const editorialGate = new Promise<void>((resolve) => {
      releaseEditorial = resolve;
    });
    let editorialStarted = false;
    __setJobWorkForTest(async (job) => {
      if (job.kind === "editorial") {
        editorialStarted = true;
        await editorialGate; // stand-in for a 10-40 minute run, held open by the test
      }
      // every other kind: instant, as production work is not what this test proves
    });
    try {
      const editorial = await enqueueJob({
        userId: "lane-test",
        newsroomId,
        kind: "editorial",
        subjectId: 1,
        kick: false,
      });
      const scan = await enqueueJob({
        userId: "lane-test",
        newsroomId,
        kind: "scan",
        subjectId: 2,
        kick: false,
      });
      assert.equal(editorial.lane, "editorial");
      assert.equal(scan.lane, "default");

      const drainPromise = drainQueuedJobs();

      // Give the editorial stand-in time to actually start and block, so the
      // race below is real: the editorial lane is genuinely occupied when the
      // scan is checked, not just queued alongside it.
      const startDeadline = Date.now() + 2000;
      while (!editorialStarted && Date.now() < startDeadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(editorialStarted, true, "expected the editorial stand-in to have started");

      // THE CORE PROPERTY: the scan finishes on its own, without waiting for
      // the editorial stand-in to release.
      const finishDeadline = Date.now() + 5000;
      let scanSettled = false;
      while (Date.now() < finishDeadline) {
        const latest = await latestJob({ newsroomId, kind: "scan", subjectId: 2 });
        if (latest && latest.status !== "queued" && latest.status !== "running") {
          scanSettled = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(
        scanSettled,
        true,
        "the default-lane scan never finished while the editorial lane was occupied -- lanes are not isolated",
      );

      // The editorial is still genuinely running -- lane isolation did not
      // skip or cancel it, it just stopped blocking everything else.
      const editorialNow = await latestJob({ newsroomId, kind: "editorial", subjectId: 1 });
      assert.equal(editorialNow?.status, "running");

      releaseEditorial();
      await drainPromise;
      const editorialDone = await latestJob({ newsroomId, kind: "editorial", subjectId: 1 });
      assert.notEqual(editorialDone?.status, "queued");
    } finally {
      __setJobWorkForTest();
      releaseEditorial();
    }
  });

  /**
   * The heartbeat contract this fix has to preserve: `executeJob`'s claim is
   * `where status = 'queued' or (status = 'running' and updated_at < now() -
   * STALE_RUNNING_SECONDS)`. A job that is genuinely still running keeps
   * `updated_at` fresh via the heartbeat, so that second clause never matches
   * for it -- a wake-up landing mid-run (this process's own `drainQueuedJobs`
   * being called again, modelling a cron tick arriving while the first pass
   * is still going) must find nothing to reclaim in that lane and leave the
   * running job's claim token untouched.
   */
  it("a long-running job's claim is not re-issued by a wake-up that lands mid-run", async () => {
    const newsroomId = 97001 + Math.floor(Math.random() * 1000);
    let releaseEditorial: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseEditorial = resolve;
    });
    let startCount = 0;
    __setJobWorkForTest(async (job) => {
      if (job.kind === "editorial") {
        startCount += 1;
        await gate;
      }
    });
    try {
      await enqueueJob({
        userId: "hb-test",
        newsroomId,
        kind: "editorial",
        subjectId: 5,
        kick: false,
      });
      const firstDrain = drainQueuedJobs();

      const startDeadline = Date.now() + 2000;
      while (startCount === 0 && Date.now() < startDeadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(startCount, 1);

      const midRun = await latestJob({ newsroomId, kind: "editorial", subjectId: 5 });
      assert.equal(midRun?.status, "running");
      const claimToken = (
        await (await getSql())<{ claim_token: string | null }>`
          select claim_token from desk_jobs where id = ${midRun!.id}
        `
      )[0]?.claim_token;
      assert.ok(claimToken);

      // A wake-up landing while the first execution is still inside its
      // (stand-in) long job -- the same shape as a cron tick or a second
      // enqueue's kickJobs() firing mid-run.
      await drainQueuedJobs();

      assert.equal(
        startCount,
        1,
        "the running job must not have been claimed and started a second time",
      );
      const stillClaimed = (
        await (await getSql())<{ status: string; claim_token: string | null }>`
          select status, claim_token from desk_jobs where id = ${midRun!.id}
        `
      )[0];
      assert.equal(stillClaimed?.status, "running");
      assert.equal(stillClaimed?.claim_token, claimToken, "claim token must be unchanged mid-run");

      releaseEditorial();
      await firstDrain;
      const done = await latestJob({ newsroomId, kind: "editorial", subjectId: 5 });
      assert.notEqual(done?.status, "queued");
      assert.notEqual(done?.status, "running");
    } finally {
      __setJobWorkForTest();
      releaseEditorial();
    }
  });

  it("the heartbeat fires well inside the reclaim window", () => {
    // If this ever stopped holding, a legitimately slow job (any editorial)
    // would eventually go quiet for longer than STALE_RUNNING_SECONDS between
    // heartbeats and a second drainer would reclaim and re-run it mid-flight.
    assert.ok(
      HEARTBEAT_MS < STALE_RUNNING_SECONDS * 1000,
      "heartbeat interval must be well inside the stale-reclaim window",
    );
  });
});

/**
 * The claim boundary is the final shared point for Story drafts and scheduled
 * follow-ups: each arrives as a desk_jobs row, then drainLane calls
 * executeJob. Hold the first fake worker open so the assertions observe the
 * actual overlap window without contacting a model provider.
 */
async function assertSecondClaimWaitsForFirst(
  firstKind: "draft" | "follow-up",
  secondKind: "draft" | "follow-up",
  newsroomId: number,
): Promise<void> {
  const first = await enqueueJob({
    userId: "claim-fence-test",
    newsroomId,
    kind: firstKind,
    subjectId: 1,
    kick: false,
  });
  let second: DeskJob | undefined;
  let releaseFirst!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  const started: number[] = [];
  let firstRun: Promise<boolean> | undefined;
  __setJobWorkForTest(async (job) => {
    started.push(job.id);
    if (job.id === first.id) {
      firstEntered();
      await held;
    }
  });
  try {
    firstRun = executeJob(first);
    await entered;
    second = await enqueueJob({
      userId: "claim-fence-test",
      newsroomId,
      kind: secondKind,
      subjectId: 2,
      kick: false,
    });
    assert.equal(await executeJob(second), false, `${secondKind} must remain queued while ${firstKind} is running`);
    assert.deepEqual(started, [first.id], "only the first execution may enter worker code");

    releaseFirst();
    assert.equal(await firstRun, true);
    assert.equal(await executeJob(second), true, "the blocked queue row must be claimable after the fence clears");
    assert.deepEqual(started, [first.id, second.id]);
  } finally {
    releaseFirst();
    await firstRun?.catch(() => undefined);
    __setJobWorkForTest();
    const sql = await getSql();
    if (second) await sql`delete from desk_jobs where id = ${second.id}`;
    await sql`delete from desk_jobs where id = ${first.id}`;
  }
}

describe("newsroom execution claim fence (ENG-001)", () => {
  it("does not overlap distinct follow-up executions in one newsroom", async () => {
    await assertSecondClaimWaitsForFirst(
      "follow-up",
      "follow-up",
      98001,
    );
  });

  it("lets a running draft finish before a follow-up starts", async () => {
    await assertSecondClaimWaitsForFirst(
      "draft",
      "follow-up",
      99002,
    );
  });

  it("lets a running follow-up finish before a draft starts", async () => {
    await assertSecondClaimWaitsForFirst(
      "follow-up",
      "draft",
      99003,
    );
  });

  it("gives a queued draft the claim ahead of an older queued follow-up", async () => {
    const newsroomId = 99004;
    const followUp = await enqueueJob({
      userId: "claim-fence-priority-test",
      newsroomId,
      kind: "follow-up",
      subjectId: 1,
      kick: false,
    });
    const draft = await enqueueJob({
      userId: "claim-fence-priority-test",
      newsroomId,
      kind: "draft",
      subjectId: 2,
      kick: false,
    });
    let releaseDraft!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    let draftEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      draftEntered = resolve;
    });
    const started: number[] = [];
    let drain: Promise<{ ran: number }> | undefined;
    __setJobWorkForTest(async (job) => {
      started.push(job.id);
      if (job.id === draft.id) {
        draftEntered();
        await held;
      }
    });
    try {
      assert.ok(followUp.id < draft.id, "the test must place the follow-up first in the queue");
      drain = drainQueuedJobs();
      await entered;
      assert.deepEqual(started, [draft.id], "a queued draft must win even when the follow-up has the older id");
      assert.equal((await latestJob({ newsroomId, kind: "follow-up", subjectId: 1 }))?.status, "queued");

      releaseDraft();
      await drain;
      assert.deepEqual(started, [draft.id, followUp.id]);
      assert.equal((await latestJob({ newsroomId, kind: "draft", subjectId: 2 }))?.status, "completed");
      assert.equal((await latestJob({ newsroomId, kind: "follow-up", subjectId: 1 }))?.status, "completed");
    } finally {
      releaseDraft();
      await drain?.catch(() => undefined);
      __setJobWorkForTest();
      const sql = await getSql();
      await sql`delete from desk_jobs where id in (${followUp.id}, ${draft.id})`;
    }
  });

  it("keeps draft/draft and different-newsroom work concurrent", async () => {
    const newsroomId = 99005;
    const otherNewsroomId = 99006;
    const firstDraft = await enqueueJob({
      userId: "claim-fence-parallel-test",
      newsroomId,
      kind: "draft",
      subjectId: 1,
      kick: false,
    });
    const secondDraft = await enqueueJob({
      userId: "claim-fence-parallel-test",
      newsroomId,
      kind: "draft",
      subjectId: 2,
      kick: false,
    });
    const otherFollowUp = await enqueueJob({
      userId: "claim-fence-parallel-test",
      newsroomId: otherNewsroomId,
      kind: "follow-up",
      subjectId: 3,
      kick: false,
    });
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const started: number[] = [];
    let firstRun: Promise<boolean> | undefined;
    __setJobWorkForTest(async (job) => {
      started.push(job.id);
      if (job.id === firstDraft.id) {
        firstEntered();
        await held;
      }
    });
    try {
      firstRun = executeJob(firstDraft);
      await entered;
      assert.equal(await executeJob(secondDraft), true);
      assert.equal(await executeJob(otherFollowUp), true);
      assert.deepEqual(started, [firstDraft.id, secondDraft.id, otherFollowUp.id]);
    } finally {
      releaseFirst();
      await firstRun?.catch(() => undefined);
      __setJobWorkForTest();
      const sql = await getSql();
      await sql`delete from desk_jobs where id in (${firstDraft.id}, ${secondDraft.id}, ${otherFollowUp.id})`;
    }
  });
});

/**
 * One open job per subject, even when twenty callers ask at once.
 *
 * enqueueJob ran findOpenJob and then a separate insert, with no transaction
 * and no conflict target. Under concurrency every caller can look, see
 * nothing, and insert its own row. An auditor fired twenty simultaneous
 * enqueues for one (newsroom, kind, subject) and got twenty distinct jobs.
 *
 * The worker's claim token and heartbeat correctly stop two workers running
 * the SAME row — they cannot coalesce duplicate rows. So a double click, a
 * retry, two tabs, or two monitor ticks landing together bought twenty scans,
 * twenty drafts, or twenty investigations, each paying full model price.
 *
 * The invariant belongs in the database, not in a check-then-insert.
 * Audit finding ENG-004.
 */
describe("enqueue is race-safe", () => {
  it("twenty concurrent enqueues produce one open job", async () => {
    const newsroomId = 94001 + Math.floor(Math.random() * 1000);
    const subjectId = 4242;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        enqueueJob({
          userId: "race-test",
          newsroomId,
          kind: "draft",
          subjectId,
          kick: false,
        }),
      ),
    );

    const sql = await getSql();
    const rows = await sql<{ c: string }>`
      select count(*) as c from desk_jobs
      where newsroom_id = ${newsroomId} and kind = 'draft' and subject_id = ${subjectId}
        and status in ('queued', 'running')
    `;
    assert.equal(Number(rows[0]!.c), 1, "expected exactly one open job for the tuple");

    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, "every caller should have been handed the same job");

    await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  });

  it("a new job can still be created once the previous one finishes", async () => {
    const newsroomId = 95001 + Math.floor(Math.random() * 1000);
    const sql = await getSql();
    const first = await enqueueJob({
      userId: "race-test",
      newsroomId,
      kind: "scan",
      subjectId: 7,
      kick: false,
    });
    await sql`update desk_jobs set status = 'completed' where id = ${first.id}`;
    const second = await enqueueJob({
      userId: "race-test",
      newsroomId,
      kind: "scan",
      subjectId: 7,
      kick: false,
    });
    assert.notEqual(second.id, first.id, "a finished job must not block the next one");
    await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  });

  it("concurrent enqueues after a job finishes still coalesce onto one row", async () => {
    // Double-race scenario: Caller A loses the primary insert race, then
    // findOpenJob on the retry path returns nothing because the winner's job
    // is now completed. Caller A tries again (retry insert). But while Caller
    // A is retrying, Caller B creates a new open row. Caller A's retry insert
    // must not error; it must coalesce onto Caller B's row via ON CONFLICT DO
    // NOTHING. ENG-204.
    const newsroomId = 95002 + Math.floor(Math.random() * 1000);
    const sql = await getSql();
    const first = await enqueueJob({
      userId: "race-test-double",
      newsroomId,
      kind: "draft",
      subjectId: 42,
      kick: false,
    });
    // Finish the first job so the retry path has nothing to find.
    await sql`update desk_jobs set status = 'completed' where id = ${first.id}`;

    // Now 15 concurrent enqueues. In a single-threaded environment we can't
    // force a true race, but the test harness covers the window where the
    // first caller's retry runs and concurrent callers are inserting.
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        enqueueJob({
          userId: "race-test-double",
          newsroomId,
          kind: "draft",
          subjectId: 42,
          kick: false,
        }),
      ),
    );

    // All 15 should coalesce onto one open job.
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, "all concurrent enqueues after a finished job should coalesce");

    // That job should be different from the first (completed) one.
    assert.notEqual(results[0]!.id, first.id);

    // Should be exactly one open job for the tuple.
    const rows = await sql<{ c: string }>`
      select count(*) as c from desk_jobs
      where newsroom_id = ${newsroomId} and kind = 'draft' and subject_id = 42
        and status in ('queued', 'running')
    `;
    assert.equal(Number(rows[0]!.c), 1, "expected exactly one open job after concurrent enqueues");

    await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  });
});

/**
 * The dead-run defect: a scan/dark/draft/editorial screen that polls a "run"
 * record (or, for draft, desk_jobs directly) can be left showing a
 * loading state that will never end if the process working it dies mid-run
 * without writing finished_at or error. `runLooksStalled` is the one signal
 * every affected screen relies on to tell "still genuinely working" apart
 * from "the desk has nobody actually working on this any more" -- it must
 * never mistake a live-but-slow run (an editorial piece can run 10-40
 * minutes) for a dead one, and it must never leave a truly dead run looking
 * alive forever.
 */
describe("jobHeartbeatStale", () => {
  const now = Date.parse("2026-01-01T00:00:10.000Z");

  it("is false for a job whose heartbeat is fresh", () => {
    const job = fakeJob({ status: "running", updated_at: "2026-01-01T00:00:00.000Z" });
    assert.equal(jobHeartbeatStale(job, now), false);
  });

  it("is false right up to the reclaim window, even for a legitimately slow job", () => {
    const justUnderWindow = now - (STALE_RUNNING_SECONDS - 1) * 1000;
    const job = fakeJob({ status: "running", updated_at: new Date(justUnderWindow).toISOString() });
    assert.equal(jobHeartbeatStale(job, now), false);
  });

  it("is true once the heartbeat is older than the reclaim window", () => {
    const pastWindow = now - (STALE_RUNNING_SECONDS + 1) * 1000;
    const job = fakeJob({ status: "running", updated_at: new Date(pastWindow).toISOString() });
    assert.equal(jobHeartbeatStale(job, now), true);
  });

  it("ignores a cold heartbeat on a job that already finished or failed", () => {
    const pastWindow = now - (STALE_RUNNING_SECONDS + 1) * 1000;
    for (const status of ["completed", "failed"] as const) {
      const job = fakeJob({ status, updated_at: new Date(pastWindow).toISOString() });
      assert.equal(jobHeartbeatStale(job, now), false, status);
    }
  });

  it("is false with no job at all -- absence is a different signal, handled by runLooksStalled", () => {
    assert.equal(jobHeartbeatStale(null, now), false);
    assert.equal(jobHeartbeatStale(undefined, now), false);
  });
});

describe("runLooksStalled", () => {
  const now = Date.parse("2026-01-01T00:00:10.000Z");
  const pastWindow = now - (STALE_RUNNING_SECONDS + 1) * 1000;
  const freshTime = now - 5_000;

  it("is false whenever the run itself is not open", () => {
    assert.equal(runLooksStalled({ runOpen: false, job: null, now }), false);
    assert.equal(
      runLooksStalled({
        runOpen: false,
        job: fakeJob({ status: "running", updated_at: new Date(pastWindow).toISOString() }),
        now,
      }),
      false,
    );
  });

  it("is true for an open run with no desk_jobs row behind it (orphaned)", () => {
    // A crash between inserting the run row (scan_runs/dark_runs/
    // editorial_requests) and enqueueing the desk_jobs row leaves exactly
    // this shape: nothing will ever reclaim a job that was never enqueued.
    assert.equal(runLooksStalled({ runOpen: true, job: null, now }), true);
  });

  it("is true when the job already settled without the run record hearing about it", () => {
    for (const status of ["completed", "failed"] as const) {
      const job = fakeJob({ status, updated_at: new Date(freshTime).toISOString() });
      assert.equal(runLooksStalled({ runOpen: true, job, now }), true, status);
    }
  });

  it("is true once the backing job's heartbeat has gone cold", () => {
    const job = fakeJob({ status: "running", updated_at: new Date(pastWindow).toISOString() });
    assert.equal(runLooksStalled({ runOpen: true, job, now }), true);
  });

  it("is false for a genuinely live run, no matter how long it has been open", () => {
    // The heartbeat is what makes this safe: `executeJob` re-touches
    // updated_at every 30s for as long as the process is alive, so a
    // 40-minute editorial piece stays "not stalled" throughout.
    const job = fakeJob({ status: "running", updated_at: new Date(freshTime).toISOString() });
    assert.equal(runLooksStalled({ runOpen: true, job, now }), false);
  });

  it("is false for a job still queued and fresh", () => {
    const job = fakeJob({ status: "queued", updated_at: new Date(freshTime).toISOString() });
    assert.equal(runLooksStalled({ runOpen: true, job, now }), false);
  });

  it("keeps an old queued job active while it waits for a lane worker", () => {
    const job = fakeJob({ status: "queued", updated_at: new Date(pastWindow).toISOString() });
    assert.equal(runLooksStalled({ runOpen: true, job, now }), false);
  });
});

describe("scan history stall annotations", () => {
  it("classifies each open history row from its own latest job", async () => {
    const newsroomId = 940_000 + (Date.now() % 10_000);
    const otherNewsroomId = newsroomId + 1;
    const subject = {
      newest: 800_001,
      missing: 800_002,
      terminal: 800_003,
      freshOld: 800_004,
      cold: 800_005,
      finished: 800_006,
      oldQueued: 800_007,
    };
    const subjectIds = Object.values(subject);
    const now = Date.now();
    const recent = new Date(now).toISOString();
    const old = new Date(now - 20 * 60_000).toISOString();
    const sql = await getSql();
    await ensureJobsSchema();

    try {
      for (const id of [subject.newest, subject.terminal, subject.cold, subject.oldQueued]) {
        await enqueueJob({
          userId: `scan-history-${id}`,
          newsroomId,
          kind: "scan",
          subjectId: id,
          kick: false,
        });
      }
      const previousFreshOld = await enqueueJob({
        userId: `scan-history-old-${subject.freshOld}`,
        newsroomId,
        kind: "scan",
        subjectId: subject.freshOld,
        kick: false,
      });
      await sql`
        update desk_jobs
        set status = 'completed', finished_at = ${old}, updated_at = ${old}
        where id = ${previousFreshOld.id}
      `;
      const currentFreshOld = await enqueueJob({
        userId: `scan-history-current-${subject.freshOld}`,
        newsroomId,
        kind: "scan",
        subjectId: subject.freshOld,
        kick: false,
      });
      await enqueueJob({
        userId: `scan-history-foreign-${subject.missing}`,
        newsroomId: otherNewsroomId,
        kind: "scan",
        subjectId: subject.missing,
        kick: false,
      });
      await sql`
        update desk_jobs
        set status = 'completed', finished_at = ${recent}, updated_at = ${recent}
        where newsroom_id = ${newsroomId} and kind = 'scan' and subject_id = ${subject.terminal}
      `;
      await sql`
        update desk_jobs
        set status = 'running', started_at = ${old}, updated_at = ${recent}
        where id = ${currentFreshOld.id}
      `;
      await sql`
        update desk_jobs
        set status = 'running', started_at = ${old},
            updated_at = ${new Date(now - (STALE_RUNNING_SECONDS + 1) * 1000).toISOString()}
        where newsroom_id = ${newsroomId} and kind = 'scan' and subject_id = ${subject.cold}
      `;
      await sql`
        update desk_jobs
        set created_at = ${old}, updated_at = ${old}
        where newsroom_id = ${newsroomId} and kind = 'scan' and subject_id = ${subject.oldQueued}
      `;
      await sql`
        update desk_jobs
        set status = 'running', started_at = ${recent}, updated_at = ${recent}
        where newsroom_id = ${otherNewsroomId} and kind = 'scan' and subject_id = ${subject.missing}
      `;

      const rows: {
        id: number;
        started_at: string;
        finished_at: string | null;
        error: string | null;
        stalled?: boolean;
      }[] = [
        { id: subject.newest, started_at: recent, finished_at: null, error: null },
        { id: subject.freshOld, started_at: old, finished_at: null, error: null },
        { id: subject.terminal, started_at: old, finished_at: null, error: null },
        { id: subject.cold, started_at: old, finished_at: null, error: null },
        { id: subject.missing, started_at: old, finished_at: null, error: null },
        { id: subject.finished, started_at: old, finished_at: recent, error: null },
        { id: subject.oldQueued, started_at: old, finished_at: null, error: null },
      ];
      const annotated = await annotateScanRowsWithStallStatus(rows, newsroomId, now);
      const byId = new Map(annotated.map((row) => [row.id, row]));

      assert.equal(byId.get(subject.newest)?.stalled, false, "the newer active run stays running");
      assert.equal(byId.get(subject.freshOld)?.stalled, false, "run age does not override a fresh heartbeat");
      assert.equal(byId.get(subject.terminal)?.stalled, true, "a terminal job cannot finish the open run");
      assert.equal(byId.get(subject.cold)?.stalled, true, "a cold job heartbeat marks the open run stalled");
      assert.equal(byId.get(subject.missing)?.stalled, true, "an orphaned open run is stalled");
      assert.equal(byId.get(subject.oldQueued)?.stalled, false, "an old queued job remains eligible for a lane worker");
      assert.equal(Object.hasOwn(byId.get(subject.finished)!, "stalled"), false, "finished rows remain untouched");
    } finally {
      await sql.query(
        "delete from desk_jobs where newsroom_id = any($1::int[]) and kind = 'scan' and subject_id = any($2::int[])",
        [[newsroomId, otherNewsroomId], subjectIds],
      );
    }
  });
});

/**
 * The open-job index is declared twice — in the migration for real Postgres,
 * and in ensureJobsSchema for the embedded path. A duplicated invariant that
 * nobody checks is exactly how the locator leak survived: fixed in one copy,
 * still broken in the other. This fails if they drift.
 */
describe("the one-open-job index is declared the same in both places", () => {
  it("migration and ensureJobsSchema agree", async () => {
    const fs = await import("node:fs");
    const migration = fs.readFileSync(
      new URL("../../../migrations/0017_one_open_job.sql", import.meta.url),
      "utf8",
    );
    const code = fs.readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
    const norm = (t: string) => t.toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
    for (const part of [
      "desk_jobs_one_open_per_subject",
      "on desk_jobs (newsroom_id, kind, subject_id)",
      "where status in ('queued', 'running')",
    ]) {
      assert.ok(norm(migration).includes(part), `migration missing: ${part}`);
      assert.ok(norm(code).includes(part), `ensureJobsSchema missing: ${part}`);
    }
  });
});

/**
 * Same drift risk as the 0017 index, for the same reason: the `lane` column,
 * its backfill, and its index are declared once for real Postgres
 * (migrations/0019_job_lanes.sql) and once for the embedded PGLite path
 * (ensureJobsSchema). ENG-105.
 */
describe("the lane column is declared the same in both places", () => {
  it("migration and ensureJobsSchema agree", async () => {
    const fs = await import("node:fs");
    const migration = fs.readFileSync(
      new URL("../../../migrations/0019_job_lanes.sql", import.meta.url),
      "utf8",
    );
    const code = fs.readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
    const norm = (t: string) => t.toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
    for (const part of [
      "add column if not exists lane text",
      "set lane = case when kind = 'editorial' then 'editorial' else 'default' end",
      "where lane is null",
      "desk_jobs_lane_idx",
      "on desk_jobs (lane, status, id asc)",
    ]) {
      assert.ok(norm(migration).includes(part), `migration missing: ${part}`);
      assert.ok(norm(code).includes(part), `ensureJobsSchema missing: ${part}`);
    }
  });
});

/**
 * Same drift risk as 0017/0019, for the same reason: `failover_note` is
 * declared once for real Postgres (migrations/0032_job_failover_note.sql)
 * and once for the embedded PGLite path (ensureJobsSchema). 0.6.8.
 */
describe("the failover_note column is declared the same in both places", () => {
  it("migration and ensureJobsSchema agree", async () => {
    const fs = await import("node:fs");
    const migration = fs.readFileSync(
      new URL("../../../migrations/0032_job_failover_note.sql", import.meta.url),
      "utf8",
    );
    const code = fs.readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
    const norm = (t: string) => t.toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
    for (const part of ["add column if not exists failover_note text not null default ''"]) {
      assert.ok(norm(migration).includes(part), `migration missing: ${part}`);
      assert.ok(norm(code).includes(part), `ensureJobsSchema missing: ${part}`);
    }
  });
});
