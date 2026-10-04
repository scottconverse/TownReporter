import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("N-3 provisional visibility label", () => {
  it("labels an unsettled provisional capture as possibly changing", async () => {
    const { meetingStatusLabel } = await import("./meeting-activity-label.ts");
    const label = meetingStatusLabel({ status: "captured", captureDisposition: "provisional", settledUnderChurn: false });
    assert.match(label.text, /provisional/i);
    assert.match(label.text, /may still change/i);
    assert.equal(label.tone, "warn");
  });

  it("labels a settled/under-churn provisional as final, not a trap", async () => {
    const { meetingStatusLabel } = await import("./meeting-activity-label.ts");
    const label = meetingStatusLabel({ status: "captured", captureDisposition: "provisional", settledUnderChurn: true });
    assert.equal(label.tone, "ok");
    assert.match(label.text, /final/i);
  });

  it("labels failures and not-captured clearly", async () => {
    const { meetingStatusLabel } = await import("./meeting-activity-label.ts");
    assert.equal(meetingStatusLabel({ status: "failed", captureDisposition: null, settledUnderChurn: false }).tone, "bad");
    assert.equal(meetingStatusLabel({ status: "not-captured", captureDisposition: null, settledUnderChurn: false }).tone, "warn");
  });
});

