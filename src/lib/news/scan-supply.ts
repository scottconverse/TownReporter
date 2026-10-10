export const DAILY_SCAN_TIME_BUDGET_MS = 90 * 60 * 1000;
export const SCAN_SOURCE_BATCH_SIZE = 16;

/** Staleness wins; saved fixed watches break ties in their saved order. */
export function orderAcceptedSources<T extends { id: number; last_ok_at?: string | Date | null }>(
  sources: readonly T[], fixedIds: readonly number[] = [],
): T[] {
  const fixed = new Map(fixedIds.map((id, index) => [id, index]));
  const age = (source: T) => {
    const time = source.last_ok_at ? new Date(source.last_ok_at).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  return [...sources].sort((a, b) => age(a) - age(b) ||
    (fixed.get(a.id) ?? Infinity) - (fixed.get(b.id) ?? Infinity) || a.id - b.id);
}

/** No position cap: failures and parked watches never displace another watch. */
export function* sourceBatches<T>(sources: readonly T[], now = Date.now,
  deadline = now() + DAILY_SCAN_TIME_BUDGET_MS): Generator<readonly T[]> {
  for (let offset = 0; offset < sources.length && now() < deadline; offset += SCAN_SOURCE_BATCH_SIZE)
    yield sources.slice(offset, offset + SCAN_SOURCE_BATCH_SIZE);
}
