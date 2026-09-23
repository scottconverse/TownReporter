import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { fileMeetingLead, meetingLeadCopy } from "./meeting-lead.ts";

/**
 * The bridge from capture to desk. Before this, Section 5 produced aligned items,
 * structured votes and resolved citations and returned them to a caller that
 * dropped them: no lead, no job, no draft. A four-hour meeting became a record and
 * the paper gained nothing.
 */
describe("meeting lead", () => {
  it("carries the citations onto the lead so the draft can cite the tape", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return [{ id: 88 }] as unknown as T[];
    };
    const result = await fileMeetingLead(sql, {
      newsroomId: 1,
      userId: "editor",
      videoId: "L1AnMLsLwtk",
      title: "City Council Regular Session",
      meetingDate: "2026-09-15",
      topic: "council",
      sourceUrls: ["https://longmontcitycouncil.org/meetings/2026-09-15/"],
      items: [{
        item: "9",
        title: "Second Reading",
        startSeconds: 18420,
        excerpt: "Council debated the effective date and heard that the ordinance would take effect October 1. Later, the motion carries.",
      }],
      establishedVotes: 1,
      citations: [{ item: "9", segmentIndex: 4612, timestampSeconds: 18450, excerpt: "the motion carries", captionSha256: "abc123" }],
      artifactId: 4,
      votes: [{ item: "9", established: true, motion: "Approve Ordinance O-2026-46", mover: "Matthew Popkin", seconder: "Jake Marsing", tally: "6-1", result: "Passed", source: "longmontcitycouncil.org" }],
    });
    assert.equal(result.leadId, 88);
    const write = calls.find((c) => /insert into leads/.test(c.text));
    assert.ok(write, "the lead must be filed");
    assert.match(write!.text, /on conflict \(newsroom_id,meeting_video_id,meeting_artifact_id,meeting_lead_purpose\)/i, "the database must enforce one lead per artifact and purpose");
    const notes = JSON.parse(String(write!.params[9])) as {
      meeting: { videoId: string; artifactId: number };
      scratch: string;
      transcriptCitations: { segmentIndex: number; captionSha256: string; timestamp: string }[];
    };
    assert.equal(notes.meeting.videoId, "L1AnMLsLwtk");
    assert.equal(notes.meeting.artifactId, 4);
    assert.equal(notes.transcriptCitations.length, 1, "the citation must survive the trip");
    assert.equal(notes.transcriptCitations[0]!.segmentIndex, 4612);
    assert.equal(notes.transcriptCitations[0]!.captionSha256, "abc123", "the hash is what the revision check needs");
    assert.equal(notes.transcriptCitations[0]!.timestamp, "05:07:30", "the editor needs a readable timestamp");
    /*
      scratch is what the drafting step actually reads as evidence. A lead that
      carried citations but left scratch empty would reach the writer with a
      headline and a URL and no transcript, and draft from nothing.
    */
    assert.match(notes.scratch, /MEETING: City Council Regular Session/, "the transcript evidence must reach the draft");
    assert.match(notes.scratch, /the motion carries/, "the verbatim excerpt must be in the evidence block");
    assert.match(notes.scratch, /take effect October 1/, "later substantive discussion from the full item span must reach the draft");
    assert.match(notes.scratch, /tally 6-1/, "the structured vote must be in the evidence block");
  });

  it("says the record established no vote rather than implying one", () => {
    const copy = meetingLeadCopy({
      title: "Planning and Zoning Commission",
      meetingDate: "2026-09-16",
      items: [{ item: "3", title: "Site Plan" }],
      establishedVotes: 0,
    });
    assert.match(copy.why, /no vote established from the structured record/i);
    assert.doesNotMatch(copy.why, /\d+ vote/i, "a zero must not read as a tally");
  });

  it("names how many votes the structured record established", () => {
    const copy = meetingLeadCopy({
      title: "City Council Regular Session",
      meetingDate: "2026-09-15",
      items: [{ item: "9", title: "Second Reading" }, { item: "10", title: "Ordinance" }],
      establishedVotes: 2,
    });
    assert.match(copy.why, /2 votes established from the structured record/i);
    assert.match(copy.why, /item 9 Second Reading/);
  });

  it("names the covered items so the lead is an assignment, not a story", () => {
    const copy = meetingLeadCopy({
      title: "LURA",
      meetingDate: null,
      items: [{ item: "5", title: "Budget" }],
      establishedVotes: 0,
    });
    assert.match(copy.why, /Covered: item 5 Budget/);
    assert.match(copy.why, /resolves to an item, a timestamp and the verbatim words/);
  });

  it("files the lead with no votes invented and no model called", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return [{ id: 5 }] as unknown as T[];
    };
    await fileMeetingLead(sql, {
      newsroomId: 1, userId: "editor", videoId: "v", title: "T", meetingDate: null,
      topic: "council", sourceUrls: [], items: [], establishedVotes: 0, citations: [], artifactId: 1, votes: [],
    });
    assert.equal(calls.length, 1, "only the idempotent lead insert; nothing else is touched");
    const params = calls[0]!.params;
    assert.equal(params[7], 0, "newsworthiness is not asserted by the capture pass");
    assert.equal(params[8], "new", "the lead enters the ordinary queue");
  });
});

