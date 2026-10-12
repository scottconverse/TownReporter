import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTranscriptDate,
  formatTranscriptTimestamp,
  meetingDateFromTitle,
} from "./transcript-dates.ts";

describe("meeting transcript dates", () => {
  it("reads an explicit meeting date from the title, not from a video post date", () => {
    assert.equal(
      meetingDateFromTitle("Museum Advisory Board Meeting, September 21, 2026"),
      "2026-09-21",
    );
    assert.equal(meetingDateFromTitle("Workshop held 2026-10-04"), "2026-10-04");
    assert.equal(meetingDateFromTitle("Museum Advisory Board Meeting"), null);
    assert.equal(meetingDateFromTitle("Meeting, February 30, 2026"), null);
  });

  it("formats date-only and captured timestamps in readable UTC", () => {
    assert.equal(formatTranscriptDate("2026-09-21"), "September 21, 2026");
    assert.equal(formatTranscriptDate("2026-02-30"), null);
    assert.equal(
      formatTranscriptTimestamp("2026-09-30 03:10:00.000000+00"),
      "September 30, 2026 at 3:10 AM UTC",
    );
    assert.equal(formatTranscriptTimestamp("not a timestamp"), null);
  });
});
