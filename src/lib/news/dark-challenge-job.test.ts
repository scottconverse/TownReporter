// guards: a challenge result must stay attached to its investigation and job
import { it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, JOB_KINDS, JOB_STAGE_LISTS, type JobKind } from "./jobs.ts";
import { ensureDarkSchema, performChallengeWork, queueInvestigationChallengeFor, openInvestigationForEditor } from "./dark.ts";
import { verifyRunSignals } from "./dark-verify.ts";

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

// guards: an imported finding must remain challengeable when it has no linked research run
it("challenges a saved brief when the file has no research run", async () => {
  const sql = await getSql();
  const userId = `challenge-brief-${Date.now()}`;
  const newsroomId = 98126;
  const file = await openInvestigationForEditor(userId, {
    paste: "The adopted water schedule changed after the public notice.",
    title: "Did the water schedule change?",
  }, newsroomId);
  const brief = {
    headline: "A schedule changed after notice",
    evidence_status: "unverified",
    tldr: "The saved record says the schedule changed after notice.",
    verdict: "thin",
    why_verdict: "The adopted record needs another check.",
    hypothesis: "The schedule changed after the notice.",
    strength: 0.4,
    supports: ["The adopted water schedule changed after the public notice."],
    contradictions: [],
    benign: "The revision may have been routine.",
    kills_it: "A dated copy showing the schedule was unchanged.",
    next: "Compare the signed notice with the adopted schedule.",
    connections: [],
    sections: { record: "", tested: "", open: "", known: "" },
    generated_at: new Date().toISOString(),
  };
  await sql`
    insert into investigation_briefs (investigation_id, newsroom_id, brief_json)
    values (${file.investigationId}, ${newsroomId}, ${JSON.stringify(brief)})
  `;

  const queued = await queueInvestigationChallengeFor(
    { userId, newsroomId }, file.investigationId, "auto", null, false,
  );
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  let receivedPack = "";
  await performChallengeWork({
    id: queued.jobId,
    subject_id: file.investigationId,
    newsroom_id: newsroomId,
    user_id: userId,
    model_choice: "auto",
    result_json: "{}",
  } as never, {
    readPlace: async () => ({
      place: { city: "Longmont", state: "Colorado", county: null }, official: [], press: [],
    }),
    verify: async (options) => verifyRunSignals({
      ...options,
      deps: {
        search: async () => [],
        model: async (_system, pack) => {
          receivedPack = pack;
          return JSON.stringify({
            gates: {
              disproof_attempted: "The signed schedule was not found.",
              source_independence: "No independent record has been checked.",
              missing_context: "The clerk's signed copy is still needed.",
              self_referential: false,
            },
            counter_narrative: "The revision may have been routine.",
            newsworthiness: { public_interest: 2, scale: 2, timeliness: 2, distinctiveness: 2 },
          });
        },
      },
    }),
  });
  assert.match(receivedPack, /SAVED CASE BRIEF/);
  assert.match(receivedPack, /The adopted water schedule changed after the public notice/);
  const saved = await sql<{ run_id: number | null; summary: string }>`
    select run_id, summary from investigation_challenges where newsroom_id = ${newsroomId}
  `;
  assert.equal(saved[0]?.run_id, null);
  assert.match(saved[0]?.summary ?? "", /Adversarial review/);
});

// guards: challenging a case could charge the previous provider instead of the editor's chosen model
it("challenges the prior findings with the challenge job's model", async () => {
  const sql = await getSql();
  const job = await enqueueJob({ userId: "challenge-model", newsroomId: 98125, kind: "challenge", subjectId: 724, modelChoice: "codex-balanced", kick: false });
  await sql`insert into dark_runs (user_id, newsroom_id, investigation_id, model_choice)
    values ('challenge-model', 98125, 724, 'claude-frontier')`;
  let choice;
  await performChallengeWork(job, {
    readPlace: async () => ({ place: { city: "Longmont", state: "Colorado", county: null }, official: [], press: [] }),
    verify: async (options) => {
      choice = options.choice;
      return { checked: 0, eligible: 0, deferred: 0, failed: 0, verified: 0, unverified: 0, searches: [], summary: "Saved" };
    },
  });
  assert.equal(choice, "codex-balanced");
});
