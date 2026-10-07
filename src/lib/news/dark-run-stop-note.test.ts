// guards: an editor could treat a completed read as still limited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowDarkRunStopNote } from "./desk-copy.ts";

test("hides a superseded read limit but keeps an unfinished one", () => {
  const limited = { investigation_id: 2, stopReason: "document-read-limit", started_at: "2026-10-01", usage: { totals: { documentReads: 8 } } };
  assert.deepEqual([shouldShowDarkRunStopNote(limited, []), shouldShowDarkRunStopNote(limited, [{ investigation_id: 2, stopReason: "completed", started_at: "2026-10-02", usage: { totals: { documentReads: 1 } } }]), shouldShowDarkRunStopNote(limited, [{ investigation_id: 2, stopReason: "document-read-limit", started_at: "2026-10-02", usage: { totals: { documentReads: 8 } } }])], [true, false, true]);
});

// guards: another investigation could hide an unfinished document read.
test("keeps a read-limit note when another investigation finishes", () => {
  const limited = { investigation_id: 2, stopReason: "document-read-limit", started_at: "2026-10-01", usage: { totals: { documentReads: 8 } } };
  assert.equal(shouldShowDarkRunStopNote(limited, [{ ...limited, investigation_id: 3, stopReason: "completed", started_at: "2026-10-02" }]), true);
});
