import { formatListDateTime } from "../paper.ts";

/**
 * FC15 (Oct 11 walk): the New leads heading named the newest RUN, not the
 * newest run that had actually filed its leads. While a general scan was still
 * reading sources, the heading credited that in-flight scan with a pile that
 * in fact held older leads and a Dark Desk handoff. The pile is every open
 * lead, so the heading may name a scan's time ONLY when that scan has finished
 * and filed; a running scan is named apart, as activity, never as the pile's
 * source.
 */

/** The scan row shape both helpers read; only the two timestamps matter here. */
export type TodayScanRow = {
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

/** A finished run with no error -- the only kind whose leads are on the pile. */
export function isCompletedScan(row: TodayScanRow): boolean {
  return Boolean(row.finished_at) && !row.error;
}

/**
 * The newest COMPLETED scan, or null when no run has finished yet. Rows arrive
 * newest-first from `listScans`, so the first one that has finished is it.
 */
export function latestCompletedScan<T extends TodayScanRow>(rows: T[] | undefined | null): T | null {
  return (rows ?? []).find(isCompletedScan) ?? null;
}

/**
 * The heading line under "New leads". Names the last completed scan's time
 * beside the sort, and says plainly that this pile is every open lead -- not
 * the named scan's own output. With no completed scan yet, it names only the
 * sort, exactly as the bare "Best first" did before.
 */
export function todayLeadsHeading(completed: TodayScanRow | null | undefined): string {
  return completed
    ? `${formatListDateTime(completed.started_at)} scan · best first`
    : "Best first";
}

/**
 * The line under the heading while a scan is reading sources, or null when
 * none is. Says where the in-flight scan's leads are: not in this list yet.
 */
export function todayScanReadingNote(scanning: boolean): string | null {
  return scanning ? "A scan is reading sources now. Its leads are not in this list yet." : null;
}
