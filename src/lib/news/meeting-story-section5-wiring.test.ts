import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

type Row = Record<string, unknown>;

/**
 * Exercises the REAL pipeline boundary: runMeetingAwareness must invoke
 * section 5 after storing the transcript artifact. If the pipeline stopped
 * calling runSection5, section5Calls would be 0 and this fails.
 */
function harness(storageRoot: string, captionPath: string, captionSha256: string): {
  sql: Sql;
  withTransaction: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
  section5Calls: () => number;
  filedLeads: () => number;
  seedCaptured: (videoId: string) => void;
} {
  const rows = new Map<string, Row>();
  let section5Calls = 0;
  let filedLeads = 0;
  const run = (text: string, params: unknown[] = []): Row[] | null => {
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }];
    if (/from meeting_capture_settings/i.test(text)) return [{ storage_root: storageRoot, retention_mode: "transcript-only" }];
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()];
    if (/insert into leads/i.test(text)) { filedLeads += 1; return [{ id: 77 }]; }
    if (/insert into meeting_capture_records/i.test(text)) {
      const [newsroomId, videoId, channelUrl, title, published] = params as [number, string, string, string, string];
      if (/on conflict\s*\(newsroom_id,video_id\)\s*do nothing/i.test(text) && rows.has(videoId)) return [];
      const isCaptured = text.includes("'captured'");
      rows.set(videoId, {
        newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
        status: isCaptured ? "captured" : "not-captured", failure_reason: null,
        caption_path: captionPath, caption_format: "srv3", caption_sha256: captionSha256,
        caption_captured_at: "2026-01-01T00:00:00Z", ended_at: null, capture_disposition: "final",
        duration_seconds: null, caption_revision_timestamp: null, revision_count: 0,
        settled_under_churn: false, last_revision_at: null,
      });
      return [];
    }
    if (/update meeting_capture_records set/i.test(text) && /caption_path=\$4/i.test(text)) {
      const videoId = String(params[17]);
      const row = rows.get(videoId);
      if (row) Object.assign(row, {
        channel_url: params[0], title: params[1], published: params[2], status: "captured",
        caption_path: params[3], caption_format: params[4], caption_sha256: params[5],
        caption_captured_at: "2026-01-01T00:00:00Z", failure_reason: null,
        ended_at: params[6], caption_revision_timestamp: params[7], duration_seconds: params[8],
        capture_disposition: params[9], revision_count: params[12], last_revision_at: params[13],
      });
      return [];
    }
    if (/insert into meeting_transcript_artifacts/i.test(text)) return [{ id: 5, captured_at: "2026-01-01T00:00:00Z" }];
    if (/insert into meeting_transcript_segments/i.test(text)) return [];
    if (/from meeting_transcript_artifacts/i.test(text)) return [{ id: 5, storage_path: captionPath, sha256: captionSha256 }];
    return null;
  };
  const makeSql = (): Sql => {
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Row>(text: string, params: unknown[] = []) => {
      if (/meeting_agenda_chunks|meeting_alignments|meeting_structured_votes/i.test(text)) section5Calls += 1;
      return (run(text, params) ?? []) as T[];
    };
    return sql;
  };
  const sql = makeSql();
  const withTransaction = async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> => fn(makeSql());
  const seedCaptured = (videoId: string) => rows.set(videoId, {
    newsroom_id: 1, video_id: videoId, channel_url: "https://youtube.com/@city",
    title: "City Council Regular Session", published: "2026-01-01", status: "captured",
    failure_reason: null, caption_path: captionPath, caption_format: "srv3",
    caption_sha256: captionSha256, caption_captured_at: "2026-01-01T00:00:00Z",
    ended_at: null, capture_disposition: "provisional", duration_seconds: null,
    caption_revision_timestamp: null, revision_count: 0, settled_under_churn: false,
    last_revision_at: null,
  });
  return { sql, withTransaction, section5Calls: () => section5Calls, filedLeads: () => filedLeads, seedCaptured };
}

describe("meeting section 5 pipeline wiring", () => {
  it("runMeetingAwareness invokes section 5 after storing the transcript artifact", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-s5-"));
    const captionPath = join(storageRoot, "L1AnMLsLwtk.en.srv3");
    const captionText = "Item 1, approval of the minutes. Item 2, the airport study.";
    writeFileSync(captionPath, captionText, "utf8");
    const captionSha256 = createHash("sha256").update(captionText).digest("hex");
    const state = harness(storageRoot, captionPath, captionSha256);
    let section5Ran = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
        url: "https://www.youtube.com/watch?v=L1AnMLsLwtk", duration: 100, tab: "streams" as const,
      }],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionText, format: "srv3" as const, sha256: captionSha256, sourcePath: captionPath },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: state.withTransaction,
      runSection5: async () => {
        section5Ran += 1;
        return { aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] };
      },
    };
    const result = await runMeetingAwareness(state.sql, 1, deps as never);
    assert.equal(section5Ran, 1, "pipeline must call section 5 exactly once per captured meeting");
    assert.match(result.coverageLine, /1 captured/);
  });

  it("recheckProvisionalMeetings invokes section 5 on revision", async () => {
    const { recheckProvisionalMeetings } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-s5r-"));
    const priorCaptionPath = join(storageRoot, "L1AnMLsLwtk-prior.en.srv3");
    const priorCaptionText = "Item 1, approval of the minutes.";
    const priorCaptionSha256 = createHash("sha256").update(priorCaptionText).digest("hex");
    writeFileSync(priorCaptionPath, priorCaptionText, "utf8");
    const revisedCaptionPath = join(storageRoot, "L1AnMLsLwtk-revised.en.srv3");
    const revisedCaptionText = "Item 1, corrected approval of the minutes.";
    const revisedCaptionSha256 = createHash("sha256").update(revisedCaptionText).digest("hex");
    writeFileSync(revisedCaptionPath, revisedCaptionText, "utf8");
    const state = harness(storageRoot, priorCaptionPath, priorCaptionSha256);
    state.seedCaptured("L1AnMLsLwtk");
    state.sql.query = async <T = Row>(text: string, _params: unknown[] = []) => {
      if (/from meeting_capture_records/i.test(text) && /capture_disposition/.test(text)) {
        return [{
          video_id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
          caption_path: priorCaptionPath, caption_sha256: priorCaptionSha256, capture_disposition: "provisional",
          consecutive_unchanged: 0, last_checked_at: null, captured_at: "2026-01-01T00:00:00Z",
          duration_seconds: null, caption_revision_timestamp: null, revision_count: 0,
        }] as T[];
      }
      return [] as T[];
    };
    let section5Ran = 0;
    const deps = {
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: revisedCaptionText, format: "srv3" as const, sha256: revisedCaptionSha256, sourcePath: revisedCaptionPath },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: state.withTransaction,
      runSection5: async () => {
        section5Ran += 1;
        return { aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] };
      },
    };
    await recheckProvisionalMeetings(state.sql, 1, deps as never);
    assert.equal(section5Ran, 1, "revision path must call section 5");
  });

  it("an unchanged provisional recheck never files another lead", async () => {
    const { recheckProvisionalMeetings } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-s5-unchanged-"));
    const captionPath = join(storageRoot, "L1AnMLsLwtk.en.srv3");
    const captionText = "Item 1, approval of the minutes.";
    const captionSha256 = createHash("sha256").update(captionText).digest("hex");
    writeFileSync(captionPath, captionText, "utf8");
    const state = harness(storageRoot, captionPath, captionSha256);
    state.seedCaptured("L1AnMLsLwtk");
    state.sql.query = async <T = Row>(text: string, _params: unknown[] = []) => {
      if (/from meeting_capture_records/i.test(text) && /capture_disposition/.test(text)) {
        return [{
          video_id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
          caption_path: captionPath, caption_sha256: captionSha256, capture_disposition: "provisional",
          consecutive_unchanged: 0, last_checked_at: null, captured_at: "2026-01-01T00:00:00Z",
          duration_seconds: null, caption_revision_timestamp: null, revision_count: 0,
        }] as T[];
      }
      return [] as T[];
    };
    const deps = {
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionText, format: "srv3" as const, sha256: captionSha256, sourcePath: captionPath },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: state.withTransaction,
      runSection5: async () => ({
        aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null,
        items: [{ item: "1", title: "Minutes", startSeconds: 0 }], votes: [],
        citations: [{ item: "1", segmentIndex: 0, timestampSeconds: 0, endSeconds: 4,
          excerpt: captionText, captionSha256, storagePath: captionPath }],
      }),
      now: () => new Date("2026-01-01T01:00:00Z"),
    };
    const result = await recheckProvisionalMeetings(state.sql, 1, deps as never);
    assert.equal(result.revised, 0);
    assert.equal(state.filedLeads(), 0, "unchanged transcript checks must not file duplicate Queue leads");
  });
});
