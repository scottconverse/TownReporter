import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAV_COUNT_POLL_MS, queueCountRefetchMs } from "./queue-count-refresh.ts";

/**
 * A11 — the left menu's Queue count froze for the length of a scan.
 *
 * Leads are filed batch by batch during a scan, but `["leads"]`, which the
 * desk nav's Queue number reads, was never polled and only moved when some
 * other write invalidated it. The interval now depends on one fact: is a scan
 * job queued or running? This pins both halves of that rule.
 */
describe("the Queue count refetch interval follows the scan", () => {
  it("refetches every few seconds while a scan is queued or running", () => {
    assert.equal(queueCountRefetchMs(true), 5000);
  });

  it("still re-reads the small count every 15 seconds when no scan runs", () => {
    // Nov 17 2026: the count is one number from the server now, not every
    // lead, so a slow steady poll is cheap and keeps auto-kill and auto-draft
    // changes visible in the nav.
    assert.equal(queueCountRefetchMs(false), 15_000);
    assert.equal(NAV_COUNT_POLL_MS, 15_000);
  });
});
