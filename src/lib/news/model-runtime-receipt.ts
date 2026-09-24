import type { ModelEffort } from "./provider-registry.ts";

/** The immutable editor request plus the concrete runtime pinned at enqueue. */
export function initialModelRuntimeReceipt(input: {
  requestedRuntime: string;
  requestedEffort: ModelEffort | null | undefined;
  actualRuntime: string;
  actualEffort: ModelEffort | null | undefined;
  /** Exact OpenAI-compatible endpoint/model selected and preflighted for this job. */
  localModel?: { baseUrl: string; id: string } | null;
  preflightFailover?: unknown;
}) {
  return {
    requestedRuntime: input.requestedRuntime,
    requestedEffort: input.requestedEffort ?? null,
    actualRuntime: input.actualRuntime,
    modelEffort: input.actualEffort ?? null,
    ...(input.actualRuntime === "local-model"
      ? {
          localModelSnapshotVersion: 1,
          ...(input.localModel
            ? { localModel: { baseUrl: input.localModel.baseUrl, id: input.localModel.id } }
            : {}),
        }
      : {}),
    preflightFailover: input.preflightFailover ?? null,
  };
}
