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
 * Merge a newly loaded page into the rows already on screen.
 *
 * A row whose `id` is already present is NOT "already correct" -- it is
 * "already present, and its latest values win". The Scan page refetches every
 * 2 seconds while a run is in flight and merges each response through here, so
 * dropping same-id rows meant the newest state could never reach the screen:
 * the Run button stayed enabled, no busy indicator appeared, and a scan that
 * was running to completion looked dead until the app was restarted.
 *
 * So: existing rows are seeded into a Map by `id`, incoming rows overwrite
 * them, and the result is returned newest-first. Duplicates still cannot
 * appear (one entry per `id`), and an overlapping boundary row now carries
 * whatever the server said most recently.
 */
export function accumulateScanPages<T extends { id: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<number, T>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/**
 * Is the newest run this page is holding the run the editor is waiting for, or
 * the one they were looking at BEFORE they pressed Run? (Unit U24.)
 *
 * THE CONTRADICTION THIS CLOSES. `scanning` was "our own press is in flight,
 * OR the newest row is still open". Between those two there is a window:
 * `runScan` returns the moment the job is queued, and the invalidated history
 * query has not come back yet -- so the newest row on screen is still the
 * PREVIOUS, finished run. In that window the Scan page drew "Scanning
 * sources…" above the old run's finished "Done. Partial coverage: 200 selected
 * · 186 fetched · 44 leads" report, with nothing saying which was which. On the
 * stand-in editorial day it read as though the new scan had already finished
 * and filed 44 leads; it fooled the walkthrough's own completion check.
 *
 * `reportBeforePress` is the id of the run the page was showing when the press
 * happened. While the newest row still carries it, the page is waiting for a
 * report that has not arrived, so there is no report to draw.
 *
 * A page that has not pressed anything has `reportBeforePress: null` and is
 * not waiting on anybody: whatever it holds is current.
 */
export function scanReportIsCurrent(input: {
  newestRunId: number | null;
  reportBeforePress: number | null;
}): boolean {
  if (input.reportBeforePress == null) return true;
  return input.newestRunId !== input.reportBeforePress;
}

/**
 * Should the page say a scan is in flight? (Unit U24.)
 *
 * Three ways to be running, and the third is the one that was missing: the
 * editor's own press is in flight, the newest run has no finish yet, or the
 * newest run this page holds is the one from BEFORE the press
 * (`scanReportIsCurrent`) -- the page has started a scan and has not been told
 * about it yet.
 */
export function scanIsRunning(input: {
  pressInFlight: boolean;
  newestOpen: boolean;
  newestRunId: number | null;
  reportBeforePress: number | null;
}): boolean {
  return input.pressInFlight || input.newestOpen || !scanReportIsCurrent(input);
}
