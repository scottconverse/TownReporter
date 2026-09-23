import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";

type Row = Record<string, unknown>;

/**
 * The wiring that finally makes a captured meeting reach the desk.
 *
 * Before this, Section 5 produced aligned items, structured votes and resolved
 * citations and returned them to a caller that dropped them: no lead, no job, no
 * draft, and the paper gained nothing from a four-hour meeting. These drive the
 * real capture path with a Section 5 that returns citations and assert a lead is
 * filed carrying them.
 *
 * Note the existing capture tests could not catch this: their Section 5 stub
 * returns `citations: []`, so the new branch never fires there. That is exactly
 * why this file exists.
 */
function harness() {
  const rows = new Map<string, Row>();
  const leads: { text: string; params: unknown[] }[] = [];
  const run = (text: string, params: unknown[] = []): Row[] | null => {
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }];
    if (/from meeting_capture_settings/i.test(text)) return [{ storage_root: "C:\\TRData", retention_mode: "transcript-only" }];
    if (/from newsroom_members/i.test(text)) return [{ user_id: "owner-1" }];
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()];
    if (/insert into leads/i.test(text)) { leads.push({ text, params }); return [{ id: 77 }]; }
    if (/insert into meeting_capture_records/i.test(text)) {
      const [newsroomId, videoId, channelUrl, title, published] = params as [number, string, string, string, string];
      const isCaptured = text.includes("\x27captured\x27");
      const status = isCaptured ? "captured" : "not-captured";
      rows.set(videoId, {
        newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
        status, failure_reason: null,
        caption_path: isCaptured ? (params[5] as string) : null,
        caption_format: isCaptured ? (params[6] as string) : null,
        caption_sha256: isCaptured ? (params[7] as string) : null,
        caption_captured_at: isCaptured ? "2026-01-01T00:00:00Z" : null,
        ended_at: null, capture_disposition: isCaptured ? "final" : null,
        duration_seconds: null, caption_revision_timestamp: null,
        revision_count: 0, settled_under_churn: false, last_revision_at: null,
      });
      return [];
    }
    if (/insert into meeting_transcript_artifacts/i.test(text)) return [{ id: 5, captured_at: "2026-01-01T00:00:00Z" }];
    if (/insert into meeting_transcript_segments/i.test(text)) return [];
    if (/from meeting_transcript_artifacts/i.test(text)) return [{ id: 5 }];
    return null;
  };
  const makeSql = (): Sql => {
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Row>(text: string, params: unknown[] = []) => (run(text, params) ?? []) as T[];
    return sql;
  };
  return { sql: makeSql(), leads, withTransaction: async <T>(fn: (tx: Sql) => Promise<T>) => fn(makeSql()) };
}

function captionFile(name: string): { path: string; sha256: string } {
  const root = mkdtempSync(join(tmpdir(), "townreporter-meeting-lead-"));
  const p = join(root, name);
  const bytes = Buffer.from("Item 9, second reading of ordinance 2026-46.", "utf8");
  writeFileSync(p, bytes);
  return { path: p, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const VIDEO = {
  id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-09-15",
  url: "https://www.youtube.com/watch?v=L1AnMLsLwtk", duration: 100, tab: "streams" as const,
};

describe("capture files the meeting lead", () => {
  it("files a lead carrying the citations when the meeting aligned", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const caption = captionFile("a.srv3");
    const h = harness();
    const deps = {
      listChannelVideos: async () => [VIDEO],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: "Item 9, second reading of ordinance 2026-46.", format: "srv3" as const, sha256: caption.sha256, sourcePath: caption.path },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: h.withTransaction,
      runSection5: async () => ({
        aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 1, unalignedLead: null,
        items: [{ item: "9", title: "Second Reading", startSeconds: 18450 }],
        votes: [{ item: "9", established: true, motion: "Approve", mover: "A", seconder: "B", tally: "6-1", result: "Passed", source: "longmontcitycouncil.org", provenance: [], disagreements: [] }],
        citations: [{ item: "9", segmentIndex: 4612, timestampSeconds: 18450, endSeconds: 18454, excerpt: "the motion carries", captionSha256: caption.sha256, storagePath: caption.path }],
      }),
    };
    const result = await runMeetingAwareness(h.sql, 1, deps as never);
    assert.equal(h.leads.length, 1, `exactly one lead must be filed for one aligned meeting; failures=${JSON.stringify(result.failures)}`);
    const write = h.leads[0]!;
    assert.match(write.text, /insert into leads/);
    const notes = JSON.parse(String(write.params[9])) as {
      meeting: { videoId: string };
      transcriptCitations: { segmentIndex: number; captionSha256: string; timestamp: string }[];
    };
    assert.equal(notes.meeting.videoId, "L1AnMLsLwtk");
    assert.equal(notes.transcriptCitations.length, 1, "the citation must ride the lead to the desk");
    assert.equal(notes.transcriptCitations[0]!.segmentIndex, 4612);
    assert.equal(notes.transcriptCitations[0]!.timestamp, "05:07:30");
    assert.equal(write.params[0], "owner-1", "the lead belongs to the newsroom owner");
  });

  it("files nothing when the meeting did not align", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const caption = captionFile("b.srv3");
    const h = harness();
    const deps = {
      listChannelVideos: async () => [VIDEO],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: "unstructured", format: "srv3" as const, sha256: caption.sha256, sourcePath: caption.path },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: h.withTransaction,
      runSection5: async () => ({
        aligned: false, alignmentReason: "no packet item could be aligned", chunkCount: 0, voteCount: 0,
        unalignedLead: { leadHeadline: "T", leadWhy: "could not be aligned", untimed: true as const, itemLevelDraft: false as const },
        items: [], votes: [], citations: [],
      }),
    };
    const result = await runMeetingAwareness(h.sql, 1, deps as never);
    assert.equal(h.leads.length, 0, "an unaligned meeting files no item-level lead");
    assert.ok(result.failures.some((f) => /could not be aligned/.test(f)), "the alignment failure is still reported");
  });
});

