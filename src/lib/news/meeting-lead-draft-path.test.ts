import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { fileMeetingLead } from "./meeting-lead.ts";
import { parseNotes } from "./notes.ts";

/**
 * The path draftLead actually takes.
 *
 * draftLead resolves scope as `input.researchScope ?? parseNotes(lead.notes_json)
 * .researchScope ?? "public"`, and nothing passes the first. So the lead's own
 * notes decide whether the writer reads the transcript or goes looking on the web.
 * A meeting lead that did not record supplied scope would default to public, and
 * the transcript would sit unused in scratch while the writer chased a different
 * story -- the material present, the draft about something else.
 */
describe("meeting lead drafts from its own record", () => {
  async function filedNotes(): Promise<ReturnType<typeof parseNotes>> {
    let captured = "";
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(_t: string, params: unknown[] = []) => {
      captured = String(params[9]);
      return [{ id: 1 }] as unknown as T[];
    };
    await fileMeetingLead(sql, {
      newsroomId: 1,
      userId: "editor",
      videoId: "L1AnMLsLwtk",
      title: "City Council Regular Session",
      meetingDate: "2026-09-15",
      topic: "council",
      sourceUrls: ["https://www.youtube.com/watch?v=L1AnMLsLwtk"],
      items: [{ item: "9", title: "Second Reading" }],
      establishedVotes: 1,
      citations: [{ item: "9", segmentIndex: 4612, timestampSeconds: 18450, excerpt: "the motion carries six to one", captionSha256: "abc" }],
      artifactId: 4,
      votes: [{ item: "9", established: true, motion: "Approve", mover: "A", seconder: "B", tally: "6-1", result: "Passed", source: "longmontcitycouncil.org" }],
    });
    return parseNotes(captured);
  }

  it("lands in supplied scope, so the writer reads the transcript", async () => {
    const notes = await filedNotes();
    assert.equal(notes.researchScope, "supplied", "public scope would send the writer to the web instead");
  });

  it("carries the transcript as evidence in scratch", async () => {
    const notes = await filedNotes();
    assert.match(notes.scratch, /MEETING: City Council Regular Session/);
    assert.match(notes.scratch, /the motion carries six to one/, "the verbatim excerpt must reach the writer");
    assert.match(notes.scratch, /tally 6-1/, "the structured vote must reach the writer");
  });

  it("carries the citations the draft step links from", async () => {
    const notes = await filedNotes();
    assert.equal(notes.transcriptCitations?.length, 1);
    assert.equal(notes.transcriptCitations![0]!.segmentIndex, 4612);
    assert.equal(notes.meeting?.artifactId, 4, "the link writer needs the artifact id");
  });
});

