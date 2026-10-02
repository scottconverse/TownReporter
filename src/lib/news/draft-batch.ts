import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import { isCustomModelChoice, type StoryModelChoice } from "./model-choice.ts";
import { PICKER_PROVIDER_IDS } from "./provider-registry.ts";
import { modelEffort, type AutomaticRungId, type ModelEffort } from "./provider-registry.ts";
import { cleanOrRaw, draftBatchDismissInput, draftBatchGetInput, draftBatchStartInput } from "./request-input.ts";
import { paperSetUpRefusal } from "./paper-settings.ts";

export type DraftBatchRuntime = Exclude<StoryModelChoice, "auto" | AutomaticRungId>;
export type DraftBatchStoredRuntime =
  | DraftBatchRuntime
  | "local"
  | "claude-cli"
  | "codex-terra"
  | "codex-sol";
export type DraftBatchStartItem = { leadId: number; researchScope?: "public" | "supplied" };
export type DraftBatchItem = {
  leadId: number;
  jobId: number;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  error: string | null;
  draftId: number | null;
  evidenceCheckIncomplete: boolean;
  reviewRequired: boolean;
  workbenchHref: string;
  /**
   * Unit BS: the lead's state NOW, read in the same statement that reads the
   * job (`batchView`, the join on `leads`), not what it was when the batch
   * was queued. `null` means the lead row is gone; the panel treats that the
   * way it always has (it falls back to `lead #<id>`), which is why the
   * filter below names the two states it drops instead of allow-listing.
   */
  leadStatus: string | null;
};
export type DraftBatchView = {
  id: number;
  createdAt: string;
  /**
   * Unit BS: the editor put this batch away. The panel renders nothing for a
   * dismissed batch, and the next batch shows normally because a new batch is
   * a new row. Stored on the batch, per newsroom, so a reload agrees.
   */
  dismissed: boolean;
  runtime: {
    runtime: DraftBatchStoredRuntime;
    modelChoice: DraftBatchRuntime;
    modelEffort: ModelEffort | null;
    label: string;
  };
  items: DraftBatchItem[];
};
export type DraftBatchFailure = {
  ok: false;
  code:
    | "invalid-input"
    | "not-found"
    | "ineligible"
    | "already-running"
    | "runtime-unavailable"
    | "rate-limited"
    /** SG1 / Option A: this install has not completed Paper setup yet. */
    | "not-set-up";
  error: string;
  leadId?: number;
  jobId?: number;
};
export type DraftBatchResult = { ok: true; batch: DraftBatchView } | DraftBatchFailure;

/**
 * Unit BS. The batch panel is a list of work the editor still has, not a log
 * of everything a batch ever touched.
 *
 * The owner's report (2026-09-27): Batch #3 listed five rows offering
 * "Redraft with Local model" for stories that were already printed on
 * townreporter.org. A printed story is not work; neither is one the desk
 * killed. Held and open leads stay exactly as they were, and so does every
 * item of a batch that is still running -- a queued or running item's lead is
 * still open, so it is kept by the same rule rather than by a second one.
 *
 * A lead whose row is gone (`null`) is kept: this filter names the two states
 * it drops rather than allow-listing the ones it keeps, so a lead that was
 * deleted underneath the batch behaves as it always has instead of vanishing
 * on a rule nobody wrote.
 */
export function visibleDraftBatchItems<T extends { leadStatus: string | null }>(
  items: readonly T[],
): T[] {
  return items.filter((item) => item.leadStatus !== "published" && item.leadStatus !== "killed");
}

const runtimes = new Set<string>(PICKER_PROVIDER_IDS);

export function cleanDraftBatchInput(
  value: unknown,
): { ok: true; items: DraftBatchStartItem[]; runtime: DraftBatchRuntime; modelEffort: ModelEffort | null } | DraftBatchFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "invalid-input", error: "Choose between one and five leads." };
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.runtime !== "string" ||
    (!runtimes.has(row.runtime) && !isCustomModelChoice(row.runtime))
  ) {
    return {
      ok: false,
      code: "invalid-input",
      /*
        0.6.63 (Unit Y item 4): Grok is gone from every picker -- and GR-C
        removed the provider itself -- so a refusal that names it as a thing
        to choose would be advertising a model the batch dialog cannot offer.
      */
      error: "Choose one named Codex, Claude, Local, or saved Custom AI model for this batch.",
    };
  }
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 5) {
    return { ok: false, code: "invalid-input", error: "Choose between one and five leads." };
  }
  const items: DraftBatchStartItem[] = [];
  const ids = new Set<number>();
  for (const raw of row.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, code: "invalid-input", error: "A selected lead is invalid." };
    }
    const item = raw as Record<string, unknown>;
    const leadId = Number(item.leadId);
    if (!Number.isSafeInteger(item.leadId) || leadId <= 0 || ids.has(leadId)) {
      return {
        ok: false,
        code: "invalid-input",
        error: "Selected leads must have unique positive IDs.",
      };
    }
    if (
      item.researchScope !== undefined &&
      item.researchScope !== "public" &&
      item.researchScope !== "supplied"
    ) {
      return { ok: false, code: "invalid-input", error: "A research scope is invalid." };
    }
    ids.add(leadId);
    items.push({
      leadId,
      ...(item.researchScope ? { researchScope: item.researchScope } : {}),
    });
  }
  const runtime = row.runtime as DraftBatchRuntime;
  const effort = modelEffort(runtime, row.modelEffort);
  if (row.modelEffort !== undefined && effort !== row.modelEffort) {
    return { ok: false, code: "invalid-input", error: "Choose an effort supported by this model." };
  }
  return { ok: true, items, runtime, modelEffort: effort };
}

export const startDraftBatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  // `cleanDraftBatchInput` owns the answer here -- it names the refusal
  // ("Choose between one and five leads.") -- so the boundary bounds and
  // passes the value through rather than throwing over its head.
  .validator((value: unknown) => cleanOrRaw(draftBatchStartInput)(value))
  .handler(async ({ data, context }) => {
    const input = cleanDraftBatchInput(data);
    if (!input.ok) return input;
    /*
      SG1 / Option A: a batch draft writes several stories at once with a model,
      on this paper's behalf. An install that has not been set up has no town to
      write about, so the batch is refused before anything is reserved.
    */
    const notSetUp = await paperSetUpRefusal(context.newsroomId ?? 1, "start a batch draft");
    if (notSetUp) return { ok: false as const, code: "not-set-up" as const, error: notSetUp };
    const server = await import("./draft-batch.server.ts");
    const editorContext = { userId: context.userId, newsroomId: context.newsroomId };
    if (!(await server.isCurrentBatchEditor(editorContext))) {
      return {
        ok: false as const,
        code: "not-found" as const,
        error: "Draft batch could not be started.",
      };
    }
    let runtimeSnapshot;
    try {
      runtimeSnapshot = await server.validateBatchRuntime(context.newsroomId, input.runtime, input.modelEffort);
    } catch (error) {
      return server.batchRuntimeFailure(error);
    }
    return server.commitDraftBatchForAuthenticatedEditor({
      context: editorContext,
      items: input.items,
      runtimeSnapshot,
    });
  });

export const getDraftBatch = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((value: unknown) => cleanOrRaw(draftBatchGetInput)(value))
  .handler(async ({ data, context }) => {
    const row =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    if (
      row.batchId !== undefined &&
      (!Number.isSafeInteger(row.batchId) || Number(row.batchId) <= 0)
    ) {
      return {
        ok: false as const,
        code: "invalid-input" as const,
        error: "Draft batch ID must be a positive integer.",
      };
    }
    return (await import("./draft-batch.server.ts")).readDraftBatchForAuthenticatedEditor(
      { userId: context.userId, newsroomId: context.newsroomId },
      row.batchId === undefined ? undefined : Number(row.batchId),
    );
  });

/**
 * Unit BS: put this batch away for good.
 *
 * The owner's report was a batch panel he could not get rid of -- five rows of
 * already-printed stories every time he opened the Queue. Dropping the
 * published and killed items answers the rows; this answers the panel. It is
 * recorded on the batch row (`dismissed_at`) rather than in the editor's
 * browser, so the Queue after a reload agrees, and the next batch he starts is
 * a new row and shows normally.
 */
export const dismissDraftBatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((value: unknown) => cleanOrRaw(draftBatchDismissInput)(value))
  .handler(async ({ data, context }) => {
    const batchId = (data as { batchId?: unknown } | null)?.batchId;
    return (await import("./draft-batch.server.ts")).dismissDraftBatchForAuthenticatedEditor(
      { userId: context.userId, newsroomId: context.newsroomId },
      typeof batchId === "number" ? batchId : Number(batchId),
    );
  });
