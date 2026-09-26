import type { ModelEffort } from "./provider-registry.ts";

/** The immutable editor request plus the concrete runtime pinned at enqueue. */
export function initialModelRuntimeReceipt(input: {
  requestedRuntime: string;
  requestedEffort: ModelEffort | null | undefined;
  actualRuntime: string;
  actualEffort: ModelEffort | null | undefined;
  /**
   * Exact OpenAI-compatible endpoint/model selected and preflighted for this
   * job.
   *
   * Two kinds of run produce one: the editor's "Local model" pick, and a rung
   * that picks its model at call time (0.6.69, Unit AL item 4 -- the LM Studio
   * rung, which runs whatever is loaded and is named by it here). A rung that
   * names its own model in the registry still passes nothing, so old receipts
   * for DeepSeek on Ollama read exactly as they did.
   */
  localModel?: { baseUrl: string; id: string } | null;
  preflightFailover?: unknown;
  /**
   * Rungs Automatic passed over before the one that answered, as the ladder
   * reported them ("Local model skipped: nothing loaded in LM Studio"). This is
   * the record of WHY a job that asked for Automatic ran on rung 3 rather than
   * rung 2 --
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
    /*
      0.6.69 (Unit AL item 4): the gate is "this run went to a real
      OpenAI-compatible model on this machine", not "the editor picked Local
      model". A rung that picks its model at call time IS such a run, and the
      model it picked is exactly what a reader has to be able to look up
      afterwards. The first clause is kept so a run whose pair is missing still
      records the version, as it always did.
    */
    ...(input.actualRuntime === "local-model" || input.localModel
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
