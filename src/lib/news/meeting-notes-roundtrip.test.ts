import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNotes, packNotes } from "./notes.ts";

/**
 * The round trip that carries a meeting transcript from the capture pass into the
 * desk.
 *
 * parseNotes builds an explicit object rather than spreading the raw JSON, so a
 * field it does not name is dropped on read. The meeting block and its citations
 * were unnamed, which means filing them looked identical to filing none -- the
 * silent-loss shape this codebase keeps finding. These pin the round trip.
 */
describe("meeting notes round trip", () => {
  it("keeps the meeting block and its citations through a parse", () => {
    const raw = JSON.stringify({
      news: "", why: "", angle: "", todo: [], found: [], verify: [], opened: [], scratch: "",
      meeting: { videoId: "L1AnMLsLwtk", title: "City Council Regular Session", date: "2026-09-15", artifactId: 4 },
      transcriptCitations: [{
        item: "9", segmentIndex: 4612, timestampSeconds: 18450, timestamp: "05:07:30",
        excerpt: "the motion carries", captionSha256: "abc123",
      }],
    });
    const notes = parseNotes(raw);
    assert.ok(notes.meeting, "the meeting block must survive the parse");
    assert.equal(notes.meeting!.videoId, "L1AnMLsLwtk");
    assert.equal(notes.meeting!.artifactId, 4);
    assert.equal(notes.transcriptCitations?.length, 1, "the citations must survive the parse");
    assert.equal(notes.transcriptCitations![0]!.segmentIndex, 4612);
    assert.equal(notes.transcriptCitations![0]!.captionSha256, "abc123");
  });

  it("drops a citation that could never match a revision check", () => {
    /*
      The revision check compares caption hashes. A citation without one would sit
      in the link table and never match anything, so the re-check would run on
      every pass and always report nothing -- the defect being repaired.
    */
    const raw = JSON.stringify({
      meeting: { videoId: "v", title: "t", date: null, artifactId: 2 },
      transcriptCitations: [
        { item: "9", segmentIndex: 1, captionSha256: "" },
        { item: "9", captionSha256: "abc" },
        { item: "9", segmentIndex: 2, captionSha256: "abc" },
      ],
    });
    const notes = parseNotes(raw);
    assert.equal(notes.transcriptCitations?.length, 1, "only the citeable one is kept");
    assert.equal(notes.transcriptCitations![0]!.segmentIndex, 2);
  });

  it("keeps the meeting fields through a pack and reparse", () => {
    const raw = packNotes({
      ...parseNotes("{}"),
      meeting: { videoId: "v", title: "T", date: "2026-01-01", artifactId: 9 },
      transcriptCitations: [{ item: "5", segmentIndex: 7, timestampSeconds: 60, excerpt: "x", captionSha256: "h" }],
    });
    const notes = parseNotes(raw);
    assert.equal(notes.meeting?.artifactId, 9, "packing must not lose the meeting");
    assert.equal(notes.transcriptCitations?.length, 1);
  });

  it("does not take the rest of the notes down when the meeting block is malformed", () => {
    const raw = JSON.stringify({ news: "a real memo", scratch: "evidence", meeting: { videoId: "" }, transcriptCitations: "nonsense" });
    const notes = parseNotes(raw);
    assert.equal(notes.news, "a real memo", "the memo must survive");
    assert.equal(notes.scratch, "evidence");
    assert.equal(notes.meeting, undefined, "an unuseable meeting block is dropped, not half-kept");
    assert.equal(notes.transcriptCitations, undefined);
  });
});

