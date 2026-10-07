// guards: an editor could treat a completed read as still limited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowDarkRunStopNote } from "./desk-copy.ts";

test("hides a superseded read limit but keeps an unfinished one", () => {
  const limited = { stopReason: "document-read-limit", started_at: "2026-10-01", usage: { totals: { documentReads: 8 } } };
  assert.deepEqual([shouldShowDarkRunStopNote(limited, []), shouldShowDarkRunStopNote(limited, [{ stopReason: "completed", started_at: "2026-10-02", usage: { totals: { documentReads: 1 } } }]), shouldShowDarkRunStopNote(limited, [{ stopReason: "document-read-limit", started_at: "2026-10-02", usage: { totals: { documentReads: 8 } } }])], [true, false, true]);
});
