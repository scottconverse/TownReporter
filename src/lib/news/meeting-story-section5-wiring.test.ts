import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

type Row = Record<string, unknown>;

/**
 * Exercises the REAL pipeline boundary: runMeetingAwareness must invoke
 * section 5 after storing the transcript artifact. If the pipeline stopped
 * calling runSection5, section5Calls would be 0 and this fails.
 */
function harness(storageRoot: string, captionPath: string): {
  sql: Sql;
  withTransaction: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
  section5Calls: () => number;
} {
  const rows = new Map<string, Row>();
  let section5Calls = 0;
  const run = (text: string, params: unknown[] = []): Row[] | null => {
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }];
    if (/from meeting_capture_settings/i.test(text)) return [{ storage_root: storageRoot, retention_mode: "transcript-only" }];
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()];
    if (/insert into meeting_capture_records/i.test(text)) {
      const [newsroomId, videoId, channelUrl, title, published] = params as [number, string, string, string, string];
      const isCaptured = text.includes("'captured'");
      rows.set(videoId, {
        newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
        status: isCaptured ? "captured" : "not-captured", failure_reason: null,
        caption_path: captionPath, caption_format: "srv3", caption_sha256: "a".repeat(64),
        caption_captured_at: "2026-01-01T00:00:00Z", ended_at: null, capture_disposition: "final",
        duration_seconds: null, caption_revision_timestamp: null, revision_count: 0,
        settled_under_churn: false, last_revision_at: null,
      });
      return [];
    }
    if (/insert into meeting_transcript_artifacts/i.test(text)) return [{ id: 5, captured_at: "2026-01-01T00:00:00Z" }];
    if (/insert into meeting_transcript_segments/i.test(text)) return [];
    if (/from meeting_transcript_artifacts/i.test(text)) return [{ id: 5, storage_path: captionPath, sha256: "a".repeat(64) }];
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
  return { sql, withTransaction, section5Calls: () => section5Calls };
}

describe("meeting section 5 pipeline wiring", () => {
  it("runMeetingAwareness invokes section 5 after storing the transcript artifact", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-s5-"));
    const captionPath = join(storageRoot, "L1AnMLsLwtk.en.srv3");
    writeFileSync(captionPath, "Item 1, approval of the minutes. Item 2, the airport study.", "utf8");
    const state = harness(storageRoot, captionPath);
    let section5Ran = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
        url: "https://www.youtube.com/watch?v=L1AnMLsLwtk", duration: 100, tab: "streams" as const,
      }],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: "Item 1, approval of the minutes. Item 2, the airport study.", format: "srv3" as const, sha256: "a".repeat(64), sourcePath: captionPath },
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
    const captionPath = join(storageRoot, "L1AnMLsLwtk.en.srv3");
    writeFileSync(captionPath, "Item 1, approval of the minutes.", "utf8");
    const state = harness(storageRoot, captionPath);
    state.sql.query = async <T = Row>(text: string, _params: unknown[] = []) => {
      if (/from meeting_capture_records/i.test(text) && /capture_disposition/.test(text)) {
        return [{
          video_id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
          caption_path: captionPath, caption_sha256: "a".repeat(64), capture_disposition: "provisional",
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
        parsed: { text: "Item 1, approval of the minutes.", format: "srv3" as const, sha256: "b".repeat(64), sourcePath: captionPath },
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
});
