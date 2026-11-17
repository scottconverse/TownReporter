/**
 * A11 -- how often the desk nav's Queue count should refetch.
 *
 * The nav's number comes from `["leads"]`, which is not polled: a scan files
 * leads batch by batch, so the count stayed at its old value until something
 * else invalidated the query, and the left menu looked frozen for the length
 * of a run. While a scan job is queued or running, five seconds is quick
 * enough to watch the number climb and cheap enough for one count query. With
 * no scan running it is `NAV_COUNT_POLL_MS` (below): the count is small now.
 *
 * Kept free of imports so a test can load it with `--experimental-strip-types`
 * (component modules reach the `@/` alias, which that loader cannot resolve).
 */
export const QUEUE_SCAN_POLL_MS = 5_000;

/**
 * Nov 17 2026: the nav's Queue and Drafts numbers are server COUNTS now (one
 * small number each, not the 30 MB lead list), so they can be re-read all the
 * time. Auto-draft and auto-kill change them in the background, and Scott saw
 * the Drafts number sit still until he opened Drafts.
 */
export const NAV_COUNT_POLL_MS = 15_000;

export function queueCountRefetchMs(scanRunning: boolean): number {
  return scanRunning ? QUEUE_SCAN_POLL_MS : NAV_COUNT_POLL_MS;
}
