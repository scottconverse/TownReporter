// guards: a retry must stay with the failed file and the editor-approved model path
import assert from "node:assert/strict";
import { it } from "node:test";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, type JobKind } from "./jobs.ts";
import { openInvestigationForEditor, retryDarkRoundFor, planDarkRoundFailover } from "./dark.ts";
import { effectiveStoryModelChoice } from "./model-choice.ts";

await applyMigrationsToTestPglite();

it("retries the failed file on the next model", async () => {
  const sql = await getSql();
  const userId = `dark-retry-${Date.now()}`;
  const newsroomId = 98231;
  const file = await openInvestigationForEditor(userId, { paste: "Check the public notice.", title: "Did it change?" }, newsroomId);
  const job = await enqueueJob({ userId, newsroomId, kind: "dark" as JobKind, subjectId: file.investigationId, kick: false });
  await sql`update desk_jobs set status = 'failed', error = 'The previous model did not answer', finished_at = now() where id = ${job.id}`;
  let started: { id: number; choice: string } | null = null;
  const result = await retryDarkRoundFor({ userId, newsroomId }, job.id, true, {
    nextModel: async () => "codex-balanced",
    start: async (_context, id, choice) => {
      const selected = choice ?? "auto";
      started = { id, choice: selected };
      return { ok: true, pending: true, jobId: 999, investigationId: id, modelChoice: effectiveStoryModelChoice(selected) };
    },
  });
  assert.deepEqual(started, { id: file.investigationId, choice: "codex-balanced" });
  assert.equal(result.ok, true);
});

// guards: retrying a stalled round could stop the job without trying another ready model
it("probes the next ready model after the editor stops a stalled round", async () => {
  const sql = await getSql();
  const context = { userId: "stalled-retry", newsroomId: 98232 };
  const file = await openInvestigationForEditor(context.userId, { paste: "Notice", title: "Notice" }, context.newsroomId);
  const job = await enqueueJob({ ...context, kind: "dark", subjectId: file.investigationId, modelChoice: "deepseek-flash", kick: false });
  await sql`update desk_jobs set status = 'failed', error = 'Cancelled by the editor' where id = ${job.id}`;
  const probed: string[] = [];
  const result = await retryDarkRoundFor(context, job.id, true, {
    nextModel: async (saved, failure) => (await planDarkRoundFailover(saved, failure, {
      probe: async (choice) => { probed.push(choice!); return { ok: true, choice: effectiveStoryModelChoice(choice), label: "Ready model" }; },
      setModelChoice: async () => {}, setStage: async () => {},
    }))?.next ?? null,
    start: async (_context, id, choice) => ({ ok: true, pending: true, jobId: 999, investigationId: id, modelChoice: effectiveStoryModelChoice(choice) }),
  });
  assert.ok(result.ok);
  assert.deepEqual(probed, ["qwen-local"]);
});
