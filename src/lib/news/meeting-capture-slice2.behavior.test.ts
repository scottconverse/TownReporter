import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";

type Row = Record<string, unknown>;

function statefulSql(): { sql: Sql; capturedSet: Set<string> } {
  const rows = new Map<string, Row>();
  const captured = new Set<string>();
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Row>(text: string, params: unknown[] = []) => {
    if (/from meeting_channel_priority/i.test(text)) {
      return [{ channel_url: "https://youtube.com/@city", position: 0 }] as T[];
    }
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()] as T[];
    if (/insert into meeting_capture_records/i.test(text)) {
      const [, videoId, channelUrl, title, published, status] = params as [
        number, string, string, string, string, string,
      ];
      rows.set(videoId, {
        video_id: videoId,
        channel_url: channelUrl,
        title,
        published,
        status,
        failure_reason: null,
        caption_path: null,
        caption_format: null,
        caption_sha256: null,
        caption_captured_at: null,
      });
    }
    if (/status='captured'/i.test(text)) {
      const [, videoId, channelUrl, title, published] = params as [
        number, string, string, string, string,
      ];
      captured.add(videoId);
      rows.set(videoId, {
        video_id: videoId,
        channel_url: channelUrl,
        title,
        published,
        status: "captured",
        failure_reason: null,
        caption_path: "caption.srv3",
        caption_format: "srv3",
        caption_sha256: "a".repeat(64),
        caption_captured_at: "2026-01-01T00:00:00Z",
      });
    }
    return [] as T[];
  };
  return { sql, capturedSet: captured };
}

describe("meeting capture Slice 2 second-run suppression", () => {
  it("captures once, then a second run does not re-capture", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const { sql, capturedSet } = statefulSql();
    let calls = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "L1AnMLsLwtk",
        title: "City Council Regular Session",
        published: "2026-01-01",
        url: "https://www.youtube.com/watch?v=L1AnMLsLwtk",
        duration: 100,
        tab: "streams" as const,
      }],
      captureMeeting: async () => {
        calls += 1;
        return {
          ok: true as const,
          parsed: {
            text: "captions",
            format: "srv3" as const,
            sha256: "a".repeat(64),
            sourcePath: "caption.srv3",
          },
          infoPath: null,
          argv: [],
          stdout: "",
          stderr: "",
        };
      },
    };
    await runMeetingAwareness(sql, 1, deps);
    await runMeetingAwareness(sql, 1, deps);
    assert.equal(calls, 1);
    assert.deepEqual([...capturedSet], ["L1AnMLsLwtk"]);
  });
});
