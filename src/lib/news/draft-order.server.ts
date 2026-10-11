import { withTransaction } from "../db.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
import type { DeskJob } from "./jobs.ts";
type Sql = Awaited<ReturnType<typeof import("../db.ts").getSql>>;
async function lockLeadForDraft(sql: Sql, newsroomId: number, leadId: number,
  allowLifecycleOverride = false,
) {
  const [lead] = await sql<{id:number;status:string|null}>`
    select id, to_jsonb(leads)->>'status' as status from leads
    where id = ${leadId} and newsroom_id = ${newsroomId} for update
  `;
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "published") throw new Error("This lead has already been published. Use Published to make a correction.");
  /*
    PR233: an editor who has EXPLICITLY acknowledged the held/killed warning is
    printing past it on purpose, and the publish path owns that decision (it
    wrote the warning and the audit row). Ordinary draft edits still refuse a
    killed lead, and a held lead is still unpublished working notes.
  */
  if (!allowLifecycleOverride) {
    if (lead.status === "killed") throw new Error("Restore this lead before changing its draft.");
  }
  return lead;
}
/** All changes to a lead's authoritative draft use the same parent-row fence.
 * A lock on draft A alone cannot stop another transaction inserting draft B. */
export async function withLeadDraftLock<T>(
  context: { newsroomId: number },
  leadId: number,
  run: (sql: Sql, status: string | null) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    const lead = await lockLeadForDraft(sql, context.newsroomId, leadId);
    return run(sql, lead.status);
  });
}
async function withClaimedLeadDraftTransaction<T>(
  job: Pick<DeskJob,"id"|"newsroom_id"|"user_id"|"claim_token">,
  leadId: number,
  completeJob: boolean,
  run: (sql: Sql, status: string | null) => Promise<T>,
): Promise<T> {
  if (!job.claim_token) throw new Error("Draft job has no active claim.");
  return withTransaction(async (sql) => {
    const [ownedJob] = await sql<{id:number}>`
      select id from desk_jobs where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = 'running' and claim_token = ${job.claim_token} for update
    `;
    if (!ownedJob) throw new Error("Draft job lease was lost before results could be saved.");
    const [member] = await sql<{user_id:string}>`
      select user_id from newsroom_members where newsroom_id = ${job.newsroom_id}
        and user_id = ${job.user_id} and role in ('owner','editor') for share
    `;
    if (!member) throw new Error("Draft permission was withdrawn before results could be saved.");
    const lead = await lockLeadForDraft(sql, job.newsroom_id, leadId);
    const result = await run(sql, lead.status);
    if (!completeJob) return result;
    const [completed] = await sql<{id:number}>`
      update desk_jobs
      set status = 'completed',
          stage = case
            when coalesce((result_json::jsonb -> 'quality' ->> 'reviewRequired')::boolean, false)
              or coalesce((result_json::jsonb ->> 'evidenceCheckIncomplete')::boolean, false)
              or result_json::jsonb -> 'quality' ->> 'citationStatus' = 'review-required'
            then 'Draft saved — review required'
            else 'Done'
          end,
          error = null, finished_at = now(), updated_at = now()
      where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = 'running' and claim_token = ${job.claim_token}
      returning id
    `;
    if (!completed) throw new Error("Draft job lease was lost before completion could be saved.");
    return result;
  });
}
/** Fence an intermediate writer checkpoint without prematurely completing its job. */
export async function withClaimedLeadDraftCheckpointLock<T>(
  job: Pick<DeskJob,"id"|"newsroom_id"|"user_id"|"claim_token">,
  leadId: number,
  run: (sql: Sql, status: string | null) => Promise<T>,
): Promise<T> {
  return withClaimedLeadDraftTransaction(job,leadId,false,run);
}
/** Fence a background draft commit by its live job claim and editor membership. */
export async function withClaimedLeadDraftLock<T>(
  job: Pick<DeskJob,"id"|"newsroom_id"|"user_id"|"claim_token">,
  leadId: number,
  run: (sql: Sql, status: string | null) => Promise<T>,
): Promise<T> {
  return withClaimedLeadDraftTransaction(job,leadId,true,run);
}
/**
 * Fence a publish by locking the lead row, then the current draft, in that
 * order -- the same parent-before-child order every draft writer uses, so a
 * background commit cannot slip a new draft in behind this read.
 *
 * The default behaviour (no `useCurrentDraft`) rejects a draft that changed
 * since the caller read it: ordinary callers pass the row they reviewed and a
 * change is a conflict. `useCurrentDraft` is for the publish path, which owns
 * the warning decision itself: there, a change is NOT a conflict -- the caller
 * wants the CURRENT locked row handed to it so it can recompute every warning
 * on what will actually print, and refuse with a fresh list rather than a bare
 * "reload" that hides a newly introduced warning. A missing draft is still a
 * hard refusal in both modes.
 */
export async function withCurrentDraftForPublish<T>(
  context: { newsroomId: number; allowLifecycleOverride?: boolean; useCurrentDraft?: boolean },
  leadId: number,
  expected: DraftRow,
  run: (sql: Sql, current: DraftRow) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    const lead = await lockLeadForDraft(
      sql,
      context.newsroomId,
      leadId,
      context.allowLifecycleOverride === true,
    );
    if (!context.allowLifecycleOverride && lead.status === "held") {
      throw new Error("Un-hold this lead before publishing.");
    }
    const [current] = await sql<DraftRow>`select * from drafts where lead_id = ${leadId} and newsroom_id = ${context.newsroomId} order by updated_at desc, id desc limit 1 for update`;
    /* No draft is a true impossibility: there is nothing that could print. */
    if (!current) throw new Error("Draft this lead before publishing.");
    if (
      !context.useCurrentDraft &&
      evidenceReviewToken(current) !== evidenceReviewToken(expected)
    ) {
      throw new Error("The draft changed while publishing. Reload and review it before publishing.");
    }
    return run(sql, current);
  });
}
