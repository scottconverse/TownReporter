import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transcriptAlignmentAction, transcriptToPickFromFailure } from "./meeting-transcript-alignment-copy.ts";
import type { MeetingTranscriptChoice } from "./meeting-transcript-choice.ts";

const whisper67 = { artifactId: 67, kind: "whisper", date: "2026-10-06", agendaItemCount: 0 } as MeetingTranscriptChoice;
const captions61 = { artifactId: 61, kind: "captions", date: "2026-10-06", agendaItemCount: 9 } as MeetingTranscriptChoice;

describe("transcriptToPickFromFailure", () => {
  const failure = `Whisper transcript (transcript 67) — not aligned to agenda items. ${transcriptAlignmentAction([captions61])}`;

  it("finds the aligned transcript the failure tells the editor to pick", () => {
    const pick = transcriptToPickFromFailure(failure, [whisper67, captions61]);
    assert.equal(pick?.artifactId, 61);
  });

  it("gives nothing when the failure names no transcript to pick", () => {
    assert.equal(transcriptToPickFromFailure("The writing model timed out.", [whisper67, captions61]), null);
  });
});
