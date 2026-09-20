import type { MeetingActivityRow } from "./meeting-activity.ts";

/**
 * N-3: pure label logic, testable without a browser or JSX.
 * A provisional capture that has NOT settled must be labelled as possibly
 * changing -- an unlabelled provisional transcript is a trap.
 */
export function meetingStatusLabel(row: Pick<MeetingActivityRow, "status" | "captureDisposition" | "settledUnderChurn">): {
  text: string;
  tone: "ok" | "warn" | "bad";
} {
  if (row.status === "failed") return { text: "Failed", tone: "bad" };
  if (row.status === "not-captured") return { text: "Not captured", tone: "warn" };
  if (row.captureDisposition === "provisional" && !row.settledUnderChurn) {
    return { text: "Provisional — transcript may still change", tone: "warn" };
  }
  if (row.captureDisposition === "provisional" && row.settledUnderChurn) {
    return { text: "Final (settled under churn)", tone: "ok" };
  }
  return { text: "Captured", tone: "ok" };
}

