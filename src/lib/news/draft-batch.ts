import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import { isCustomModelChoice, type StoryModelChoice } from "./model-choice.ts";
import { PICKER_PROVIDER_IDS } from "./provider-registry.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";
import { cleanOrRaw, draftBatchGetInput, draftBatchStartInput } from "./request-input.ts";

export type DraftBatchRuntime = Exclude<StoryModelChoice, "auto">;
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
};
export type DraftBatchView = {
  id: number;
  createdAt: string;
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
    | "rate-limited";
  error: string;
  leadId?: number;
  jobId?: number;
};
export type DraftBatchResult = { ok: true; batch: DraftBatchView } | DraftBatchFailure;

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
      error: "Choose one named Codex, Claude, Grok, Local, or saved Custom AI model for this batch.",
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
