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
  return {
    providerId: String(v.providerId ?? ""),
    callSeconds: isFiniteNumber ? Math.round(seconds) : null,
    invalid: seconds !== undefined && seconds !== null && !isFiniteNumber,
  };
}
