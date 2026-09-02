import type { Sql } from "../db.ts";
import type { WriteEditorialResult } from "./editorial-orchestration.ts";
import type { OpinionModelChoice } from "./model-choice.ts";

type EditorialSuccess = Extract<WriteEditorialResult, { ok: true }>;

/** Persist the provider that actually completed an Automatic Opinion run. */
export async function persistEditorialSuccess(
  sql: Sql,
  input: { requestId: number; jobId: number; newsroomId: number; result: EditorialSuccess },
) {
  return persistEditorialCompletion(sql, {
    requestId: input.requestId,
    jobId: input.jobId,
    newsroomId: input.newsroomId,
    draftId: input.result.draftId,
    modelChoice: input.result.modelChoice,
  });
}

/**
 * Link a filed draft to both durable records. The caller owns the transaction;
 * missing either row is an error so that transaction cannot partially commit.
 */
export async function persistEditorialCompletion(
  sql: Sql,
  input: {
    requestId: number;
    jobId: number;
    newsroomId: number;
    draftId: number;
    modelChoice: OpinionModelChoice;
  },
) {
  const requests = await sql<{ id: number }>`
    update editorial_requests
    set draft_id = ${input.draftId}, error = null, finished_at = now(),
        model_choice = ${input.modelChoice}
    where id = ${input.requestId} and newsroom_id = ${input.newsroomId}
    returning id
  `;
  if (!requests[0]) {
    throw new Error(`Editorial request ${input.requestId} was not found during completion.`);
  }

  const jobs = await sql<{ id: number }>`
    update desk_jobs set model_choice = ${input.modelChoice}
    where id = ${input.jobId} and newsroom_id = ${input.newsroomId}
    returning id
  `;
  if (!jobs[0]) {
    throw new Error(`Editorial job ${input.jobId} was not found during completion.`);
  }
}
