import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const labelPath = new URL("../../components/meetings-activity.tsx", import.meta.url);
const activityPath = new URL("./meeting-activity.ts", import.meta.url);

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

describe("N-3 activity surface reads the real columns", () => {
  it("selects artifact size and hash, disposition, revisions, churn, alignment, chunks, and votes", async () => {
    const src = readFileSync(activityPath, "utf8");
    for (const col of [
      "caption_format", "caption_sha256", "capture_disposition", "revision_count", "settled_under_churn",
      "forced_recapture", "byte_size", "storage_path",
    ]) assert.ok(src.includes(col), `meeting-activity must select ${col}`);
    assert.match(src, /meeting_agenda_chunks/);
    assert.match(src, /meeting_structured_votes/);
    assert.match(src, /meeting_alignments/);
  });

  it("reports what a captured meeting produced for the desk", () => {
    /*
      A capture that transcribed perfectly and produced no story is a different
      outcome from one that produced a draft waiting to be read, and the surface
      could not tell them apart: it showed the transcription state and stopped.
    */
    const src = readFileSync(activityPath, "utf8");
    for (const field of ["leadId", "leadStatus", "draftId", "citationCount"]) {
      assert.ok(src.includes(field), `meeting-activity must report ${field}`);
    }
    assert.match(src, /from leads/, "the meeting lead must be read, not guessed");
    assert.match(src, /transcriptCitations/, "the citation count comes from the recorded citations");
  });

  it("guards the jsonb cast so one unreadable row cannot break the Scan desk", () => {
    const src = readFileSync(activityPath, "utf8");
    assert.match(src, /notes_json ~/, "the cast must be restricted to rows that can survive it");
  });

  it("renders the fail reason, chunks, and votes, and the provisional label", () => {
    const src = readFileSync(labelPath, "utf8");
    assert.match(src, /role="alert"/);
    assert.match(src, /failureReason/);
    assert.match(src, /meetingStatusLabel/);
    assert.match(src, /Alignment:/);
    assert.match(src, /Vote item/);
  });
});

