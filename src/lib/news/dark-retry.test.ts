// guards: a retry must use the model shown on the file and stay on its own file
import assert from "node:assert/strict";
import { it } from "node:test";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import { enqueueJob, type JobKind } from "./jobs.ts";
import { openInvestigationForEditor, retryDarkRoundFor, planDarkRoundFailover } from "./dark.ts";
import { effectiveStoryModelChoice, modelChoiceLabel } from "./model-choice.ts";
import { darkKeepControl } from "./desk-copy.ts";
import { defaultModelEffort } from "./provider-registry.ts";

await applyMigrationsToTestPglite();

async function stoppedJob(
  userId: string,
  newsroomId: number,
  modelChoice: string,
) {
  const sql = await getSql();
  const file = await openInvestigationForEditor(
    userId,
    { paste: "Check the public notice.", title: "Did it change?" },
    newsroomId,
  );
  const job = await enqueueJob({
    userId,
    newsroomId,
    kind: "dark" as JobKind,
    subjectId: file.investigationId,
    modelChoice,
    kick: false,
  });
  await sql`update desk_jobs set status = 'failed', error = 'Cancelled by the editor', finished_at = now() where id = ${job.id}`;
  return { file, job };
}

it("retries a stopped round on the model now shown by the file picker", async () => {
  const context = { userId: `dark-retry-picker-${Date.now()}`, newsroomId: 98231 };
  const { file, job } = await stoppedJob(context.userId, context.newsroomId, "codex-frontier");
  const effort = defaultModelEffort("deepseek-flash");
  let started: { id: number; choice: string; effort: unknown; explicit: boolean } | null = null;

  const result = await retryDarkRoundFor(
    context,
    job.id,
    false,
    {
      start: async (_context, id, choice, savedEffort, _override, _deps, explicit) => {
        started = { id, choice: choice ?? "auto", effort: savedEffort, explicit: explicit === true };
        return {
          ok: true,
          pending: true,
          jobId: 999,
          investigationId: id,
          modelChoice: effectiveStoryModelChoice(choice),
        };
      },
    },
    undefined,
    "deepseek-flash",
    effort,
    true,
  );

  assert.deepEqual(started, {
    id: file.investigationId,
    choice: "deepseek-flash",
    effort,
    explicit: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, modelChoiceLabel("deepseek-flash"));
});

it("retries with the stopped round's own model when the caller sends no picker choice", async () => {
  const context = { userId: `dark-retry-own-${Date.now()}`, newsroomId: 98232 };
  const { file, job } = await stoppedJob(context.userId, context.newsroomId, "codex-frontier");
  let started: { id: number; choice: string } | null = null;

  const result = await retryDarkRoundFor(context, job.id, false, {
    start: async (_context, id, choice) => {
      started = { id, choice: choice ?? "auto" };
      return {
        ok: true,
        pending: true,
        jobId: 998,
        investigationId: id,
        modelChoice: effectiveStoryModelChoice(choice),
      };
    },
  });

  assert.deepEqual(started, { id: file.investigationId, choice: "codex-frontier" });
  assert.equal(result.ok, true);
});

// guards: retrying a stalled round could stop the job without trying another ready model
it("retries on the next ready model, ignoring the picker choice", async () => {
  const context = { userId: `dark-retry-next-${Date.now()}`, newsroomId: 98233 };
  const { job } = await stoppedJob(context.userId, context.newsroomId, "deepseek-flash");
  const probed: string[] = [];
  let startedChoice = "";

  const result = await retryDarkRoundFor(
    context,
    job.id,
    true,
    {
      nextModel: async (saved, failure) => (await planDarkRoundFailover(saved, failure, {
        probe: async (choice) => {
          probed.push(choice!);
          return { ok: true, choice: effectiveStoryModelChoice(choice), label: "Ready model" };
        },
        setModelChoice: async () => {},
        setStage: async () => {},
      }))?.next ?? null,
      start: async (_context, id, choice) => {
        startedChoice = choice ?? "auto";
        return {
          ok: true,
          pending: true,
          jobId: 997,
          investigationId: id,
          modelChoice: effectiveStoryModelChoice(choice),
        };
      },
    },
    undefined,
    "claude-sonnet",
    null,
    true,
  );

  assert.ok(result.ok);
  assert.deepEqual(probed, ["qwen-local"]);
  assert.equal(startedChoice, "qwen-local");
});

it("a failed stopped job releases Keep investigating even if the investigation poll is still investigating", () => {
  const control = darkKeepControl({
    jobStatus: "failed",
    investigationStatus: "investigating",
    stalled: false,
    starting: false,
    stopRequested: true,
  });

  assert.deepEqual(control, { running: false, disabled: false, pendingLabel: null });
});
