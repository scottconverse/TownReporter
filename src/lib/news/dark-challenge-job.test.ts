// guards: a challenge result must stay attached to its investigation and job
import { it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, JOB_KINDS, JOB_STAGE_LISTS, type JobKind } from "./jobs.ts";
import { ensureDarkSchema, performChallengeWork } from "./dark.ts";

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
