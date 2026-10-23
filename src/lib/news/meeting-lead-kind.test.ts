import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMeetingStoryLead } from "./meeting-lead-kind.ts";

/*
  One definition of "this lead is a meeting story", shared by the writer
  choice, the Publish warning and the notes heading. The two facts must agree:
  a video id alone is not a meeting story, and the purpose alone is not either.
*/
describe("isMeetingStoryLead", () => {
  it("is true for a transcript-story lead with a meeting video and a stored transcript", () => {
    assert.equal(
      isMeetingStoryLead({
        meeting_video_id: "abc123",
        meeting_artifact_id: 67,
        meeting_lead_purpose: "transcript-story",
      }),
      true,
    );
  });

  it("is false for a transcript-story lead with no stored transcript", () => {
    assert.equal(
      isMeetingStoryLead({
        meeting_video_id: "abc123",
        meeting_artifact_id: null,
        meeting_lead_purpose: "transcript-story",
      }),
      false,
    );
  });

  it("is false for a news lead", () => {
    assert.equal(isMeetingStoryLead({ meeting_video_id: null, meeting_lead_purpose: null }), false);
    assert.equal(isMeetingStoryLead({}), false);
  });

  it("is false for a lead that names a video for another purpose", () => {
    assert.equal(
      isMeetingStoryLead({ meeting_video_id: "abc123", meeting_lead_purpose: "follow-up" }),
      false,
    );
    assert.equal(
      isMeetingStoryLead({ meeting_video_id: "abc123", meeting_lead_purpose: null }),
      false,
    );
  });
});
