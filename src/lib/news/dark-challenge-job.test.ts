// guards: a challenge result must stay attached to its investigation and job
import { it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, JOB_KINDS, JOB_STAGE_LISTS, type JobKind } from "./jobs.ts";
import { ensureDarkSchema, performChallengeWork, queueInvestigationChallengeFor, openInvestigationForEditor } from "./dark.ts";

await applyMigrationsToTestPglite();

it("stores a challenge result beside its file and job", async () => {
  const sql = await getSql();
  await ensureDarkSchema();
  const job = await enqueueJob({ userId: "challenge-test", newsroomId: 98123, kind: "challenge" as JobKind, subjectId: 723, kick: false });
  const runs = await sql<{ id: number }>`
    insert into dark_runs (user_id, newsroom_id, investigation_id, model_choice)
    values ('challenge-test', 98123, 723, 'codex-balanced') returning id
  `;
  const expected = {
    checked: 2,
    eligible: 2,
    deferred: 0,
    failed: 0,
    verified: 1,
    unverified: 1,
    searches: [],
    summary: "Two records disagree",
  };
  let verifiedRunId: number | null = null;
  await performChallengeWork(job, {
    readPlace: async () => ({
      place: { city: "Longmont", state: "Colorado", county: null },
      official: [],
      press: [],
    }),
    verify: async (options) => {
      verifiedRunId = options.runId;
      return expected;
    },
  });
  const rows = await sql<{
    investigation_id: number;
    job_id: number;
    run_id: number;
    summary: string;
    result_json: string;
  }>`
    select investigation_id, job_id, run_id, summary, result_json
    from investigation_challenges where newsroom_id = 98123
  `;
  assert.equal(verifiedRunId, runs[0]?.id);
  assert.equal(rows[0]?.investigation_id, 723);
  assert.equal(rows[0]?.job_id, job.id);
  assert.equal(rows[0]?.run_id, runs[0]?.id);
  assert.equal(rows[0]?.summary, "Two records disagree");
  assert.deepEqual(JSON.parse(rows[0]?.result_json ?? "{}"), expected);
  assert.ok(JOB_KINDS.includes("challenge"));
  assert.deepEqual(JOB_STAGE_LISTS.challenge, ["Challenging the case"]);
});

it("queues a case challenge for the file the editor opened", async () => {
  const sql = await getSql();
  const userId = `challenge-queue-${Date.now()}`;
  const newsroomId = 98124;
  const file = await openInvestigationForEditor(userId, {
    paste: "Check whether the public notice changed.",
    title: "Did the notice change?",
  }, newsroomId);
  await sql`
    insert into dark_runs (user_id, newsroom_id, investigation_id, model_choice)
    values (${userId}, ${newsroomId}, ${file.investigationId}, 'codex-balanced')
  `;
  const result = await queueInvestigationChallengeFor(
    { userId, newsroomId },
    file.investigationId,
    "auto",
    null,
    false,
  );
  assert.equal(result.ok, true);
  const jobs = await sql<{ kind: string; subject_id: number; status: string }>`
    select kind, subject_id, status from desk_jobs
    where newsroom_id = ${newsroomId} and kind = 'challenge'
  `;
  assert.deepEqual(jobs, [{ kind: "challenge", subject_id: file.investigationId, status: "queued" }]);
});
