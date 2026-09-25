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
  /**
   * Rungs Automatic passed over before the one that answered, as the ladder
   * reported them ("Qwen 3.6 35B skipped: not loaded"). This is the record of
   * WHY a job that asked for Automatic ran on rung 3 rather than rung 2 --
   * without it, a skipped rung and a rung that was never offered look the
   * same. Absent when nothing was skipped, which is the ordinary case.
   */
  skippedRungs?: readonly string[] | null;
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
    ...(input.skippedRungs?.length ? { skippedRungs: [...input.skippedRungs] } : {}),
    preflightFailover: input.preflightFailover ?? null,
  };
}
