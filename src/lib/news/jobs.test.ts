import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueJob,
  findOpenJob,
  latestJob,
  drainQueuedJobs,
  executeJob,
  ensureJobsSchema,
  jobHeartbeatStale,
  runLooksStalled,
  STALE_RUNNING_SECONDS,
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
    status: "running",
    stage: "",
    error: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    finished_at: null,
    ...over,
  };
}

describe("desk jobs", () => {
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

  it("a superseded execution cannot overwrite the result of the one that took over", async () => {
    // The real shape of the bug: a slow job passes the stale window, a second
    // drainer re-claims it, and then the ORIGINAL finishes and writes its
    // result over the top. The claim-token guard has to make that a no-op.
    await ensureJobsSchema();
    const sql = await getSql();
    const newsroomId = 91006;
    const job = await enqueueJob({
      userId: `job-stale-${Date.now()}`,
      newsroomId,
      kind: "draft",
      subjectId: 99,
      kick: false,
    });

    // Pretend an earlier execution claimed it and then went quiet past the window.
    await sql`
      update desk_jobs
      set status = 'running', claim_token = 'ghost-worker',
          updated_at = now() - make_interval(secs => ${STALE_RUNNING_SECONDS + 60})
      where id = ${job.id}
    `;

    // A fresh drainer legitimately takes it over.
    const took = await executeJob({ ...job, status: "running" });
    assert.equal(took, true, "a stale running job should be reclaimable");

    const after = await sql<{ status: string; claim_token: string | null }>`
      select status, claim_token from desk_jobs where id = ${job.id}
    `;
    assert.notEqual(after[0]?.claim_token, "ghost-worker");
    const settled = after[0]!.status;

    // Now the ghost finishes and tries to report success.
    await sql`
      update desk_jobs
      set status = 'completed', stage = 'Done', error = null, finished_at = now(), updated_at = now()
      where id = ${job.id} and claim_token = 'ghost-worker'
    `;

    const final = await sql<{ status: string }>`
      select status from desk_jobs where id = ${job.id}
    `;
    assert.equal(final[0]?.status, settled, "the ghost must not have changed anything");
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
    const norm = (t: string) =>
      t.toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");
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
