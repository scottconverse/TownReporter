import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueJob,
  latestJob,
  setJobStage,
  setJobStages,
  setJobFailoverNote,
  setJobModelRuntime,
  reportProgress,
  type DeskJob,
} from "./jobs.ts";
import { getSql } from "../db.ts";

/*
  H1 of the batch-7 pre-merge audit (`briefs/A-B7-AUDIT.md`).

  `setJobStage` decides whether to move the chip row with a guard written inside
  a JS tagged template:

    await sql`... when stages_json is not null and stages_json ~ '^\s*\[' ...`

  `getSql()`'s tag (`src/lib/db.ts`) rebuilds the statement from the COOKED
  strings, and in a template literal `\s` cooks to `s` and `\[` cooks to `[`.
  Postgres therefore received `'^s*['` and raised 2201B ("invalid regular
  expression: brackets [] not balanced") whenever the predicate was evaluated --
  which is every row whose `stages_json` is not null.

  That was every claimed job: `executeJob` seeds `stages_json` from
  `JOB_STAGE_LISTS[job.kind]` at claim, and the table is now total. So the first
  stage boundary of the Opinion job, the Dark Desk round and every failover note
  threw instead of reporting. Nothing caught it because no test had ever called
  `setJobStage` against a row that carries a list; with `stages_json` null the
  `and` short-circuits and the regex is never evaluated.

  What is asserted here:

    1. `setJobStage` survives a job WITH a stage list, and an arrival sentence
       moves `stage_index` to that phrase's position.
    2. A sentence that is not in the list leaves the chip where it was -- the
       same rule `stageIndexFor` applies in JS, so a failover note or a counted
       step cannot move the bar.
    3. A job whose list was never seeded still reports its stage, with no chip.

  Both halves are needed to prove the fix: restoring the backslash regex makes
  the first test fail with 2201B, and removing the exact-match rule makes the
  second assertion (the chip staying at 1) fail.

  Fakes only; no model is loaded or called.
*/

const NEWSROOM = 91097;
const subject = { next: 93001 };
const freshSubject = () => subject.next++;

const enqueueDraft = (userId: string, subjectId: number) =>
  enqueueJob({ userId, newsroomId: NEWSROOM, kind: "draft", subjectId, kick: false });

const stored = (subjectId: number): Promise<DeskJob | null> =>
  latestJob({ newsroomId: NEWSROOM, kind: "draft", subjectId });

describe("a stage boundary on a job that has a stage list", () => {
  it("keeps both hops of the live Haiku to DeepSeek to Sol failure in order", async () => {
    const id = freshSubject();
    const job = await enqueueDraft("picker-switch-history", id);
    await setJobFailoverNote(job.id, "This draft moved to DeepSeek v4.1 Flash because Claude Haiku sign-in lapsed");
    await setJobFailoverNote(job.id, "This draft moved to Codex Sol 6.1 (balanced) because DeepSeek v4.1 Flash reached its usage limit");
    const note = (await stored(id))!.failover_note;
    assert.match(note, /Claude Haiku sign-in lapsed.*DeepSeek v4\.1 Flash reached its usage limit.*Codex Sol 6\.1/);
  });
  it("updates the waiting line as soon as a draft switches, before the next tick", async () => {
    const id = freshSubject();
    const job = await enqueueDraft("picker-progress-switch", id);
    await reportProgress(job.id, { step: "Waiting on DeepSeek v4.1 Flash · 12s" });
    await setJobModelRuntime(job.id, "codex-balanced", "medium");
    await setJobFailoverNote(job.id, "This draft moved to Codex Sol 6.1 (balanced) because DeepSeek v4.1 Flash reached its usage limit");
    assert.match((await stored(id))!.step_text!, /Waiting on Codex Sol 6\.1/);
  });
  it("moves the chip row for an arrival and leaves it for a step", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("stage-write", id);
    const stages = ["Opening source material", "Writing the draft", "Checking names and spellings"];
    await setJobStages(job.id, stages);
    // The claim-time seeding the audit describes: a list is on the row before
    // any worker reports, so the guard is evaluated on every call from here on.
    assert.deepEqual(JSON.parse((await stored(id))!.stages_json ?? "null"), stages);

    // An arrival: the sentence is in the list, so the chip moves to it. This
    // call is the audit's failing input -- with the cooked `'^s*['` guard it
    // throws 2201B before the row is written.
    await setJobStage(job.id, "Writing the draft");
    const arrived = (await stored(id))!;
    assert.equal(arrived.stage, "Writing the draft");
    assert.equal(arrived.stage_index, 1, "the arrival's position in the list");

    // A step inside a stage, and a failover sentence: not arrivals, so the chip
    // stays where the last arrival left it.
    await setJobStage(job.id, "Reading batch 2 of 7");
    const stepped = (await stored(id))!;
    assert.equal(stepped.stage, "Reading batch 2 of 7", "the Now: line still says what the worker said");
    assert.equal(stepped.stage_index, 1, "a non-arrival leaves the chip where it was");

    await setJobStage(job.id, "Checking names and spellings");
    assert.equal((await stored(id))!.stage_index, 2);

    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });

  it("still works for a job whose list was never seeded", async () => {
    const sql = await getSql();
    const id = freshSubject();
    const job = await enqueueDraft("stage-write-null", id);
    // No `setJobStages`: the row is exactly what `enqueueJob` left, which is the
    // shape every existing test used. It passes today because the `and`
    // short-circuits before the broken regex is evaluated, which is why nothing
    // ever caught H1.
    assert.equal((await stored(id))!.stages_json, null);
    await setJobStage(job.id, "Researching the editorial");
    const row = (await stored(id))!;
    assert.equal(row.stage, "Researching the editorial");
    assert.equal(row.stage_index, null, "no list means no chip row, not a chip at zero");
    // A list cleared back to nothing is the other half of the same branch:
    // `setJobStages(id, null)` seeds index 0, and a boundary must not move it.
    await setJobStages(job.id, null);
    await setJobStage(job.id, "Writing the editorial");
    assert.equal((await stored(id))!.stage_index, 0, "a null list leaves the index alone");
    await sql`delete from desk_jobs where id = ${job.id} and newsroom_id = ${NEWSROOM}`;
  });
});
