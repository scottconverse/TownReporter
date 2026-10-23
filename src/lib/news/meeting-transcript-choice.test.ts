import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultMeetingTranscriptArtifactId } from "./meeting-transcript-choice.ts";

/*
  D243: the default transcript is the first one the writer can use. Whisper
  outranks the captions only when it is aligned to the agenda items -- an
  unaligned Whisper transcript fails the draft at once ("not aligned to agenda
  items") even when the aligned captions would have been fine.
*/
describe("defaultMeetingTranscriptArtifactId", () => {
  it("picks the aligned captions over an unaligned Whisper transcript", () => {
    assert.equal(
      defaultMeetingTranscriptArtifactId([
        { artifactId: 67, kind: "whisper", agendaItemCount: 0 },
        { artifactId: 61, kind: "captions", agendaItemCount: 10 },
      ]),
      61,
    );
  });

  it("keeps the Whisper transcript when both are aligned", () => {
    assert.equal(
      defaultMeetingTranscriptArtifactId([
        { artifactId: 67, kind: "whisper", agendaItemCount: 5 },
        { artifactId: 61, kind: "captions", agendaItemCount: 10 },
      ]),
      67,
    );
  });

  it("keeps the Whisper transcript when neither is aligned", () => {
    assert.equal(
      defaultMeetingTranscriptArtifactId([
        { artifactId: 67, kind: "whisper", agendaItemCount: 0 },
        { artifactId: 61, kind: "captions", agendaItemCount: 0 },
      ]),
      67,
    );
  });

  it("takes the captions when they are the only transcript", () => {
    assert.equal(
      defaultMeetingTranscriptArtifactId([{ artifactId: 61, kind: "captions", agendaItemCount: 3 }]),
      61,
    );
  });

  it("returns null when the meeting has no transcript", () => {
    assert.equal(defaultMeetingTranscriptArtifactId([]), null);
  });
});
