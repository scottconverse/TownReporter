import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { meetingClock, meetingDraftNotes, meetingEvidenceBlock, type MeetingDraftMaterial } from "./meeting-draft-input.ts";
import { emptyNotes } from "./notes.ts";

/**
 * The drafting input for a captured meeting. Two rules must hold, because they are
 * the difference between a meeting story and a plausible-sounding invention: votes
 * come from the structured record and are never inferred from prose, and every
 * excerpt carries the position it came from.
 */
const base: MeetingDraftMaterial = {
  title: "City Council Regular Session",
  meetingDate: "2026-09-15",
  videoUrl: "https://www.youtube.com/watch?v=L1AnMLsLwtk",
  items: [{ item: "9", title: "Second Reading", startSeconds: 18450, excerpt: "Mayor: the motion carries, six to one." }],
  votes: [{
    item: "9", established: true, motion: "Approve Ordinance O-2026-46", mover: "Matthew Popkin",
    seconder: "Jake Marsing", tally: "6-1", result: "Passed", source: "longmontcitycouncil.org",
  }],
};

describe("meeting draft input", () => {
  it("labels every excerpt with its item and timestamp so it can be cited", () => {
    const block = meetingEvidenceBlock(base);
    assert.match(block, /--- ITEM 9: Second Reading \(from 05:07:30\) ---/, "the item and timestamp must be on the excerpt");
    assert.match(block, /the motion carries, six to one/, "the verbatim excerpt must be present");
  });

  it("states that a captured meeting is complete so the writer cannot turn it into an upcoming event", () => {
    const block = meetingEvidenceBlock(base);
    assert.match(block, /recording has ended/i);
    assert.match(block, /transcript below was captured successfully/i);
    assert.match(block, /do not\s+describe the meeting as merely scheduled or upcoming/i);
  });

  it("states a vote only as the structured record states it", () => {
    const block = meetingEvidenceBlock(base);
    assert.match(block, /tally 6-1/, "the record tally must be carried");
    assert.match(block, /source: longmontcitycouncil.org/, "the vote source must be named");
    assert.match(block, /moved by Matthew Popkin/);
  });

  it("refuses to let an unestablished vote read as a tally", () => {
    /*
      The transcript above literally says "the motion carries, six to one". If the
      record does not establish a vote, the block must say so and must tell the
      writer not to report it -- otherwise the writer has a spoken tally and no
      instruction, which is how a number gets invented.
    */
    const block = meetingEvidenceBlock({ ...base, votes: [{ ...base.votes[0]!, established: false }] });
    assert.match(block, /No vote was established from the structured record/);
    assert.match(block, /Do not state a vote, a tally, or a result/);
    assert.doesNotMatch(block, /tally 6-1/, "an unestablished vote must not be carried as a tally");
    assert.doesNotMatch(block, /source: longmontcitycouncil\.org/, "and must not carry a source it lacks");
  });

  it("formats the clock the way the editor reads it", () => {
    assert.equal(meetingClock(0), "00:00:00");
    assert.equal(meetingClock(18450), "05:07:30");
    assert.equal(meetingClock(3661), "01:01:01");
  });

  it("drafts in supplied scope so the writer does not go looking elsewhere", () => {
    const notes = meetingDraftNotes(base, emptyNotes());
    assert.equal(notes.researchScope, "supplied");
    assert.deepEqual(notes.suppliedUrls, ["https://www.youtube.com/watch?v=L1AnMLsLwtk"]);
    assert.match(notes.scratch, /MEETING: City Council Regular Session/);
  });

  it("keeps the editor's own notes when assembling the meeting material", () => {
    const withEditorLine = { ...emptyNotes(), scratch: "editor wrote this", todo: [{ t: "ask about the vote", done: false, src: "you" as const }] };
    const notes = meetingDraftNotes(base, withEditorLine);
    assert.equal(notes.todo.length, 1, "the editor's to-do must survive");
    assert.match(notes.scratch, /MEETING:/, "the transcript evidence replaces scratch");
  });
});

