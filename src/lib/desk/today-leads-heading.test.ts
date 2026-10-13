import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCompletedScan,
  latestCompletedScan,
  todayLeadsHeading,
  todayScanReadingNote,
  type TodayScanRow,
} from "./today-leads-heading.ts";

/**
 * FC15 (Oct 11 walk). Two behaviours, both about NOT crediting an unfinished
 * scan with the pile:
 *
 *  1. The heading names the newest COMPLETED scan. The newest row overall is
 *     the running one, and the pile it sits above holds older leads, so the
 *     heading must skip past it to the last run that really filed.
 *  2. While a scan is running, a short line says its leads are not in this
 *     list yet.
 *
 * The rows are the two the walk saw: a running scan with no finish receipt,
 * and the completed October 7 run behind it.
 */

const running: TodayScanRow & { id: number } = {
  id: 2,
  started_at: "2026-10-11T17:58:00.000Z",
  finished_at: null,
  error: null,
};
const completed: TodayScanRow & { id: number } = {
  id: 1,
  started_at: "2026-10-07T13:00:00.000Z",
  finished_at: "2026-10-07T13:04:00.000Z",
  error: null,
};

describe("the Today New leads heading", () => {
  it("names the newest COMPLETED scan and not the running one", () => {
    // listScans hands rows back newest-first, so the running scan is rows[0].
    const rows = [running, completed];
    const named = latestCompletedScan(rows);
    assert.equal(named?.id ?? null, completed.id, "the running run is skipped");

    const heading = todayLeadsHeading(named);
    assert.doesNotMatch(heading, /Oct 11|11:58/i, "the unfinished scan's time is not the heading");
    assert.match(heading, /scan · best first/);
    assert.equal(heading, todayLeadsHeading(completed), "the heading is the completed run's own");
  });

  it("falls back to the bare sort when no scan has completed yet", () => {
    assert.equal(latestCompletedScan([running]), null);
    assert.equal(todayLeadsHeading(null), "Best first");
  });

  it("does not treat a finished run that errored as completed", () => {
    const failed: TodayScanRow = { ...running, finished_at: "2026-10-11T17:59:00.000Z", error: "provider failed" };
    assert.equal(isCompletedScan(failed), false);
    assert.equal(latestCompletedScan([failed, completed])?.id ?? null, completed.id);
  });

  it("says the running scan's leads are not in this list yet", () => {
    assert.equal(
      todayScanReadingNote(true),
      "A scan is reading sources now. Its leads are not in this list yet.",
    );
    assert.equal(todayScanReadingNote(false), null, "nothing to say while no scan is running");
  });
});
