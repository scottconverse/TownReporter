import type { DeskJob } from "./jobs.ts";
import type { ProviderOverrides } from "./provider-registry.ts";

export type ExactLocalModel = { baseUrl: string; id: string };

function parseSnapshot(value: unknown): ExactLocalModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.baseUrl !== "string" || typeof row.id !== "string" || !row.id.trim()) return null;
  try {
    const url = new URL(row.baseUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { baseUrl: row.baseUrl, id: row.id };
}

/**
 * Resolve the exact local endpoint/model a queued job was preflighted against.
 * New receipts fail closed if their snapshot is malformed or absent. Legacy
 * jobs without the snapshot marker keep their historical behavior and use the
 * current scoped/legacy preference.
 */
export function pinnedLocalModelForJob(
  job: Pick<DeskJob, "model_choice" | "result_json">,
): ExactLocalModel | null {
  if (job.model_choice !== "local-model") return null;
  let receipt: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(job.result_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) receipt = parsed as Record<string, unknown>;
  } catch {
    throw new Error("This queued local-model job has an unreadable model receipt. Requeue it after checking the model selection.");
  }
  if (receipt.localModelSnapshotVersion === 1) {
    const snapshot = parseSnapshot(receipt.localModel);
    if (!snapshot) throw new Error("This queued local-model job has an invalid saved model snapshot. Requeue it after checking the model selection.");
    return snapshot;
  }
  return null;
}

/** Apply a job's immutable local endpoint over the current budget settings. */
export function applyJobLocalModelSnapshot(
  job: Pick<DeskJob, "model_choice" | "result_json">,
  overrides: ProviderOverrides,
): ProviderOverrides {
  const pinned = pinnedLocalModelForJob(job);
  if (!pinned) return overrides;
  return {
    ...overrides,
    "local-model": { ...(overrides["local-model"] ?? {}), localModel: pinned },
  };
}
