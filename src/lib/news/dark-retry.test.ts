// guards: a retry must stay with the failed file and the editor-approved model path
import assert from "node:assert/strict";
import { it } from "node:test";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, type JobKind } from "./jobs.ts";
import { openInvestigationForEditor, retryDarkRoundFor } from "./dark.ts";
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
