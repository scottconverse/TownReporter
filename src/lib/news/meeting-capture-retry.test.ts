// guards: one newsroom's slow scan could block another newsroom, while overlapping scans could duplicate captures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { withMeetingCapturePassLock } from "./meeting-capture-retry.ts";

test("capture passes serialize within a newsroom and run independently across newsrooms", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  const first = withMeetingCapturePassLock(1, async () => { events.push("first"); await held; throw new Error("capture failed"); });
  const failed = assert.rejects(first, /capture failed/);
  const same = withMeetingCapturePassLock(1, async () => { events.push("same"); });
  const other = withMeetingCapturePassLock(2, async () => { events.push("other"); });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first", "other"]);
  } finally {
    release();
    await Promise.all([failed, same, other]);
  }
  assert.deepEqual(events, ["first", "other", "same"]);
});
