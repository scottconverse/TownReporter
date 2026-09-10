import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import { isCustomModelChoice, STORY_MODEL_CHOICES, type StoryModelChoice } from "./model-choice.ts";

export type DraftReconcileState = "idle" | "queued" | "running" | "completed" | "failed";

export type DraftReconcileStatus = {
  jobId: number;
  draftId: number;
  status: Exclude<DraftReconcileState, "idle">;
  stage: string;
  error: string | null;
  modelChoice: string;
  resultDraftId: number | null;
  evidenceCheckIncomplete: boolean;
};

export type DraftReconcileRequestResult =
  { ok: true; pending: true; jobId: number; modelChoice: string } | { ok: false; error: string };

function positiveId(raw: unknown, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

function requestInput(raw: unknown): { leadId: number; modelChoice: StoryModelChoice } {
  if (!raw || typeof raw !== "object") throw new Error("Reconciliation request is invalid.");
  const value = raw as Record<string, unknown>;
  const modelChoice = String(value.modelChoice ?? "").trim();
  const known = STORY_MODEL_CHOICES.some((choice) => choice.value === modelChoice);
  if (!known && !isCustomModelChoice(modelChoice)) {
    throw new Error("Choose an available model before checking the draft.");
  }
  return { leadId: positiveId(value.leadId, "Lead"), modelChoice: modelChoice as StoryModelChoice };
}

function statusInput(raw: unknown): { leadId: number } {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { leadId: positiveId(value.leadId, "Lead") };
}

function resultInput(raw: unknown): { leadId: number; draftId: number } {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    leadId: positiveId(value.leadId, "Lead"),
    draftId: positiveId(value.draftId, "Checked draft"),
  };
}

export type CheckedDraftResult = EditableDraftFields & {
  id: number;
  currentDraftId: number;
  updatedAt: string | null;
};

export function assessCheckedDraftResult(input: { resultDraftId: number; currentDraftId: number }) {
  const exactResult = Number.isInteger(input.resultDraftId) && input.resultDraftId > 0;
  return {
    exactResult,
    safeToAutoLoad: exactResult && input.resultDraftId === input.currentDraftId,
  };
}

export function assessRefreshedCheckedDraft(input: {
  checkedDraftId: number;
  refreshedDraftId: number | null;
  checked: EditableDraftFields;
  refreshed: EditableDraftFields | null;
  expected: EditableDraftFields;
  current: EditableDraftFields;
}): "load" | "stale" | "typed" {
  if (input.refreshedDraftId !== input.checkedDraftId) return "stale";
  if (!input.refreshed || !draftFieldsMatch(input.checked, input.refreshed)) return "stale";
  if (!draftFieldsMatch(input.expected, input.current)) return "typed";
  return "load";
}

/** Authenticated enqueue bridge. The server module owns draft/version validation. */
export const requestDraftReconciliationFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(requestInput)
  .handler(async ({ context, data }): Promise<DraftReconcileRequestResult> => {
    try {
      const { requestDraftReconciliation } = await import("./draft-reconcile.server.ts");
      const job = await requestDraftReconciliation(
        { userId: context.userId, newsroomId: context.newsroomId },
        data,
      );
      return {
        ok: true,
        pending: true,
        jobId: job.id,
        modelChoice: job.model_choice,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The evidence check could not be queued.",
      };
    }
  });

/**
 * Read the latest check for any saved version of this owned lead. Joining
 * through drafts preserves exact-version job identity even after a successful
 * check inserts a newer saved draft.
 */
export const getDraftReconciliationStatusFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(statusInput)
  .handler(async ({ context, data }): Promise<DraftReconcileStatus | null> => {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      subject_id: number;
      model_choice: string;
      status: "queued" | "running" | "completed" | "failed";
      stage: string;
      error: string | null;
      result_json: string;
    }>`
      select j.id, j.subject_id, j.model_choice, j.status, j.stage, j.error, j.result_json
      from desk_jobs j
      join drafts d on d.id = j.subject_id and d.newsroom_id = j.newsroom_id
      where j.newsroom_id = ${context.newsroomId}
        and d.lead_id = ${data.leadId}
        and j.kind = 'reconcile'
      order by j.id desc
      limit 1
    `;
    const job = rows[0];
    if (!job) return null;
    let resultDraftId: number | null = null;
    let evidenceCheckIncomplete = false;
    try {
      const parsed = JSON.parse(job.result_json || "{}") as Record<string, unknown>;
      const candidate = Number(parsed.newDraftId ?? parsed.draftId ?? parsed.resultDraftId);
      if (Number.isInteger(candidate) && candidate > 0) resultDraftId = candidate;
      evidenceCheckIncomplete = parsed.evidenceCheckIncomplete === true;
    } catch {
      // Status remains useful when an old or interrupted job has malformed metadata.
    }
    return {
      jobId: job.id,
      draftId: job.subject_id,
      status: job.status,
      stage: job.stage,
      error: job.error,
      modelChoice: job.model_choice,
      resultDraftId,
      evidenceCheckIncomplete,
    };
  });

/** Load only the exact result named by the completed job, scoped to its owned lead. */
export const getCheckedDraftResultFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(resultInput)
  .handler(async ({ context, data }): Promise<CheckedDraftResult> => {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      headline: string;
      dek: string;
      body: string;
      topic: string;
      updated_at: string | null;
      current_draft_id: number;
    }>`
      select d.id,d.headline,d.dek,d.body,d.topic,d.updated_at,
        (select current.id from drafts current
         where current.newsroom_id = d.newsroom_id and current.lead_id = d.lead_id
         order by current.updated_at desc,current.id desc limit 1) as current_draft_id
      from drafts d
      where d.id = ${data.draftId}
        and d.lead_id = ${data.leadId}
        and d.newsroom_id = ${context.newsroomId}
      limit 1
    `;
    const draft = rows[0];
    if (!draft) throw new Error("The checked draft is unavailable for this story.");
    return {
      id: draft.id,
      currentDraftId: draft.current_draft_id,
      updatedAt: draft.updated_at,
      headline: draft.headline,
      dek: draft.dek,
      body: draft.body,
      topic: draft.topic,
    };
  });

export type EditableDraftFields = { headline: string; dek: string; body: string; topic: string };

export function draftFieldsMatch(a: EditableDraftFields, b: EditableDraftFields): boolean {
  return a.headline === b.headline && a.dek === b.dek && a.body === b.body && a.topic === b.topic;
}
