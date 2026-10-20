/**
 * A11 -- how often the desk nav's Queue count should refetch.
 *
 * The nav's number comes from `["leads"]`, which is not polled: a scan files
 * leads batch by batch, so the count stayed at its old value until something
 * else invalidated the query, and the left menu looked frozen for the length
 * of a run. While a scan job is queued or running, five seconds is quick
 * enough to watch the number climb and cheap enough for one count query. With
 * no scan running the answer is `false` -- today's behaviour, no interval.
 *
 * Kept free of imports so a test can load it with `--experimental-strip-types`
 * (component modules reach the `@/` alias, which that loader cannot resolve).
 */
export const QUEUE_SCAN_POLL_MS = 5_000;

export function queueCountRefetchMs(scanRunning: boolean): number | false {
  return scanRunning ? QUEUE_SCAN_POLL_MS : false;
}
