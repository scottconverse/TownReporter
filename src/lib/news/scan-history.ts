/**
 * P0-4 scan-history paging math.
 *
 * The original Scan page grew one window (`limit: pageSize * pages`,
 * `offset: 0`). The server clamps `limit` to 50, so at page 5 the client asked
 * for 60 and was served 50: `history.length` stuck at 50, "Showing latest 50
 * of 51" never advanced, "Show more (1 older)" re-fetched the same 50 rows, and
 * `exhausted` never became true — a permanent, un-closeable dead state.
 *
 * The fix is real offset paging with a bounded page size: page N asks for
 * `limit: pageSize, offset: N * pageSize`, and loaded pages are accumulated
 * client-side. These helpers are exported so the Scan page and its focused
 * test share one implementation — the test must bind to the code that runs.
 */

/** Zero-based offset for a 1-based page number. */
export function pageOffset(page: number, pageSize: number): number {
  const p = Math.max(Math.trunc(page) || 1, 1);
  const size = Math.max(Math.trunc(pageSize) || 1, 1);
  return (p - 1) * size;
}

/**
 * The bounded size for one request. Every request asks for one page, never a
 * growing window, so the server's 50-row clamp is unreachable in normal use.
 */
export function nextWindowSize(pageSize: number): number {
  return Math.max(Math.trunc(pageSize) || 1, 1);
}

/**
 * True exactly when there is nothing older to load. Used to hide "Show more".
 */
export function isHistoryExhausted(loadedCount: number, total: number): boolean {
  return loadedCount >= total;
}

/**
 * Append a newly loaded page to the rows already on screen, de-duplicating by
 * `id` so an overlapping boundary row cannot appear twice or drop a row.
 */
export function accumulateScanPages<T extends { id: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const out = existing.slice();
  const seen = new Set(out.map((r) => r.id));
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
