import type { ModelEffort } from "./provider-registry.ts";

/** The immutable editor request plus the concrete runtime pinned at enqueue. */
export function initialModelRuntimeReceipt(input: {
  requestedRuntime: string;
  requestedEffort: ModelEffort | null | undefined;
  actualRuntime: string;
  actualEffort: ModelEffort | null | undefined;
  preflightFailover?: unknown;
}) {
  return {
    requestedRuntime: input.requestedRuntime,
    requestedEffort: input.requestedEffort ?? null,
    actualRuntime: input.actualRuntime,
    modelEffort: input.actualEffort ?? null,
    preflightFailover: input.preflightFailover ?? null,
  };
}
