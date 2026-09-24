import { LIMITS } from "./request-input.ts";

/** Keep input validation independent of the database-backed settings module. */
export type SaveProviderTimeInput = {
  providerId: string;
  /** Null means reset to the shipped default. */
  callSeconds: number | null;
  /** Present, non-finite values must not silently become a reset. */
  invalid: boolean;
};

export function cleanProviderTimeInput(raw: unknown): SaveProviderTimeInput {
  const v = (raw ?? {}) as Partial<SaveProviderTimeInput>;
  const seconds = v.callSeconds;
  const isFiniteNumber = typeof seconds === "number" && Number.isFinite(seconds);
  /*
    The id is looked up in a Map (`providerEntry`, provider-registry.ts:491),
    so an unbounded one was never a lookup risk -- but it was still read,
    copied and compared first. The bound cuts it at the boundary instead. A
    real id is `claude` or a local provider key: six characters.
  */
  const providerId = String(v.providerId ?? "");
  return {
    providerId: providerId.length > LIMITS.providerId ? "" : providerId,
    callSeconds: isFiniteNumber ? Math.round(seconds) : null,
    invalid: seconds !== undefined && seconds !== null && !isFiniteNumber,
  };
}
