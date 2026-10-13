import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureFollowUpsSchema,
  performCreateAiFollowUp,
} from "./follow-ups.ts";
import { enqueueJob, ensureJobsSchema } from "./jobs.ts";
import { followUpBlocker, startFollowUpRun } from "./follow-up-scheduler.ts";
import { followUpQueueNotice } from "./follow-up-copy.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

/**
 * FC10 (Oct 11 walk). On a published-story follow-up, "Run now" refused with
 * "a draft is being written", while the health panel showed the only RUNNING
 * job was a scan and the drafts were only QUEUED. It offered nothing but "try
 * again once it finishes".
 *
 * Two behaviours, both about the press telling the truth:
 *
 *  1. A press while the desk is busy is QUEUED, not refused -- the job claim in
 *     jobs.ts already holds a follow-up behind queued or running drafts, so a
 *     lost request was never necessary.
 *  2. When it queues, the receipt NAMES the actual blocker -- its kind and
 *     whether it is queued or running. The case the walk saw is a scan running
 *     with drafts merely queued; the notice must say "queued", not "being
 *     written".
 *
 * The desk is real (PGlite, as in follow-up-scheduler.test.ts) because every
 * assertion is about a row: the follow-up job that appears, and the draft/scan
 * rows it is queued behind.
 */

await applyMigrationsToTestPglite();

const NEWSRoom = (n: number) => 97400 + n;
const EDITOR = "queue-blocker-editor";

before(async () => {
  const sql = await getSql();
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs"])
    await sql.query("alter table " + table + " add column if not exists newsroom_id integer not null default 1");
  await ensureJobsSchema();
  await ensureFollowUpsSchema();
  for (let n = 1; n <= 6; n += 1) {
    await sql`delete from desk_jobs where newsroom_id = ${NEWSRoom(n)}`;
    await sql`delete from follow_ups where newsroom_id = ${NEWSRoom(n)}`;
  }
});

async function agentFollowUp(newsroomId: number, what: string): Promise<number> {
  const created = await performCreateAiFollowUp(
    { userId: EDITOR, newsroomId },
    { what, agentKind: "recheck", schedule: "daily", targets: ["https://example.test/one"] },
  );
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  return created.ok ? created.id : 0;
}

describe("Run now while the desk is busy (FC10)", () => {
  it("queues the check behind a running scan and queued drafts, and names the blocker", async () => {
    const newsroomId = NEWSRoom(1);
    const id = await agentFollowUp(newsroomId, "Has the permit changed?");
    // Exactly the walk's desk: the one RUNNING job is a scan, the drafts are
    // only QUEUED. The old fence read the queued draft as "being written".
    await enqueueJob({ userId: EDITOR, newsroomId, kind: "scan", subjectId: 1, kick: false });
    await enqueueJob({ userId: EDITOR, newsroomId, kind: "draft", subjectId: 1, kick: false });
    await enqueueJob({ userId: EDITOR, newsroomId, kind: "draft", subjectId: 2, kick: false });
    const sql = await getSql();
    await sql`update desk_jobs set status = 'running' where newsroom_id = ${newsroomId} and kind = 'scan'`;

    const started = await startFollowUpRun({ userId: EDITOR, newsroomId }, id, new Date(), { kick: false });

    assert.equal(started.started, true, "the press is queued, not refused");
    assert.equal(started.skipped, null);
    const jobs = await sql<{ subject_id: number; status: string }>`
      select subject_id, status from desk_jobs
      where newsroom_id = ${newsroomId} and kind = 'follow-up'
    `;
    assert.equal(jobs.length, 1, "the request is in the queue");
    assert.equal(jobs[0]!.subject_id, id);

    // The blocker is the queued draft, and the receipt says so -- queued, not
    // "being written", and never a scan that is only reading sources.
    assert.equal(started.queuedBehind?.kind, "draft");
    assert.equal(started.queuedBehind?.status, "queued");
    const notice = followUpQueueNotice(started.queuedBehind);
    assert.match(notice!, /queued/);
    assert.doesNotMatch(notice!, /being written/);
    assert.match(notice!, /story draft/);
  });

  it("names a running follow-up as running, behind nothing else", async () => {
    const newsroomId = NEWSRoom(2);
    const id = await agentFollowUp(newsroomId, "Second question");
    const other = await agentFollowUp(newsroomId, "First question");
    await enqueueJob({ userId: EDITOR, newsroomId, kind: "follow-up", subjectId: other, kick: false });
    const sql = await getSql();
    await sql`update desk_jobs set status = 'running' where newsroom_id = ${newsroomId} and kind = 'follow-up'`;

    const blocker = await followUpBlocker(newsroomId);
    assert.equal(blocker?.kind, "follow-up");
    assert.equal(blocker?.status, "running");
    const notice = followUpQueueNotice(blocker);
    assert.match(notice!, /running now/);

    const started = await startFollowUpRun({ userId: EDITOR, newsroomId }, id, new Date(), { kick: false });
    assert.equal(started.started, true, "still queued, not refused");
    assert.equal((await sql`select id from desk_jobs where newsroom_id = ${newsroomId} and kind = 'follow-up' and subject_id = ${id}`).length, 1);
  });

  it("has nothing to wait behind on an idle desk", async () => {
    const newsroomId = NEWSRoom(3);
    const id = await agentFollowUp(newsroomId, "Anything new?");
    const started = await startFollowUpRun({ userId: EDITOR, newsroomId }, id, new Date(), { kick: false });
    assert.equal(started.started, true);
    assert.equal(started.queuedBehind, null);
    assert.equal(followUpQueueNotice(started.queuedBehind), null, "no notice when it starts at once");
  });

  it("still refuses a stopped card, naming Resume", async () => {
    const newsroomId = NEWSRoom(4);
    const id = await agentFollowUp(newsroomId, "Stopped question");
    const sql = await getSql();
    await sql`update follow_ups set status = 'stopped' where id = ${id}`;
    const started = await startFollowUpRun({ userId: EDITOR, newsroomId }, id, new Date(), { kick: false });
    assert.equal(started.started, false, "Stop still means stop");
    assert.equal(started.skipped, "not-active");
  });
});
