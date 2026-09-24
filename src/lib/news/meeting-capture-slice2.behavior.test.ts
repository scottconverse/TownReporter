import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Sql } from "../db.ts";

type Row = Record<string, unknown>;

function statefulSql(storageRoot: string, channels = [{ channel_url: "https://youtube.com/@city", position: 0 }]): {
  sql: Sql;
  capturedSet: Set<string>;
  records: () => Row[];
  withTransaction: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
} {
  const rows = new Map<string, Row>();
  const captured = new Set<string>();
  const run = (text: string, params: unknown[] = []): Row[] | null => {
    if (/from meeting_channel_priority/i.test(text)) return channels;
    if (/from meeting_capture_settings/i.test(text)) return [{ storage_root: storageRoot, retention_mode: "transcript-only" }];
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()];
    if (/insert into meeting_capture_records/i.test(text)) {
      const [newsroomId, videoId, channelUrl, title, published] = params as [number, string, string, string, string];
      if (/on conflict\s*\(newsroom_id,video_id\)\s*do nothing/i.test(text) && rows.has(videoId)) return [];
      const isCaptured = text.includes("'captured'");
      const isFailed = text.includes("'failed'");
      const status = isCaptured ? "captured" : isFailed ? "failed" : "not-captured";
      rows.set(videoId, {
        newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
        status, failure_reason: isFailed ? (params[5] as string) : null,
        caption_path: isCaptured ? (params[5] as string) : null,
        caption_format: isCaptured ? (params[6] as string) : null,
        caption_sha256: isCaptured ? (params[7] as string) : null,
        caption_captured_at: isCaptured ? "2026-01-01T00:00:00Z" : null,
        ended_at: null, capture_disposition: isCaptured ? "final" : null,
        duration_seconds: null, caption_revision_timestamp: null,
        revision_count: 0, settled_under_churn: false, last_revision_at: null,
      });
      if (status === "captured") captured.add(videoId);
      return [];
    }
    if (/update meeting_capture_records set/i.test(text) && /caption_path=\$4/i.test(text)) {
      const videoId = String(params[17]);
      const row = rows.get(videoId);
      if (row) {
        Object.assign(row, {
          channel_url: params[0], title: params[1], published: params[2], status: "captured",
          caption_path: params[3], caption_format: params[4], caption_sha256: params[5],
          caption_captured_at: "2026-01-01T00:00:00Z", failure_reason: null,
          ended_at: params[6], caption_revision_timestamp: params[7], duration_seconds: params[8],
          capture_disposition: params[9], revision_count: params[12], last_revision_at: params[13],
        });
        captured.add(videoId);
      }
      return [];
    }
    if (/insert into meeting_transcript_artifacts/i.test(text)) return [{ id: 5, captured_at: "2026-01-01T00:00:00Z" }];
    if (/insert into meeting_transcript_segments/i.test(text)) return [];
    return null;
  };
  const makeSql = (): Sql => {
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Row>(text: string, params: unknown[] = []) => (run(text, params) ?? []) as T[];
    return sql;
  };
  const sql = makeSql();
  const withTransaction = async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> => fn(makeSql());
  return { sql, capturedSet: captured, records: () => [...rows.values()], withTransaction };
}

describe("meeting capture Slice 2 second-run suppression", () => {
  it("captures once, then a second run does not re-capture", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-live-"));
    const captionPath = join(storageRoot, "L1AnMLsLwtk.en.srv3");
    const captionText = "Item 1, approval of the minutes.";
    writeFileSync(captionPath, captionText, "utf8");
    const captionSha256 = createHash("sha256").update(captionText).digest("hex");
    const state = statefulSql(storageRoot);
    let calls = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "L1AnMLsLwtk", title: "City Council Regular Session", published: "2026-01-01",
        url: "https://www.youtube.com/watch?v=L1AnMLsLwtk", duration: 100, tab: "streams" as const,
      }],
      captureMeeting: async () => {
        calls += 1;
        return {
          ok: true as const,
          parsed: { text: captionText, format: "srv3" as const, sha256: captionSha256, sourcePath: captionPath },
          infoPath: null,
          info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
          argv: [], stdout: "", stderr: "",
        };
      },
      withTransaction: state.withTransaction,
      // Section 5 now runs inside the capture transaction. This harness is about
      // capture-record suppression, so the section-5 boundary is stubbed here and
      // exercised for real by meeting-story-section5-run.test.ts and
      // meeting-story-section5-wiring.test.ts.
      runSection5: async () => ({ aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] }),
    };
    const first = await runMeetingAwareness(state.sql, 1, deps as never);
    const second = await runMeetingAwareness(state.sql, 1, deps as never);
    assert.equal(calls, 1, "capturer must run exactly once");
    assert.match(first.coverageLine, /1 captured/);
    assert.match(second.coverageLine, /1 captured/);
    assert.deepEqual([...state.capturedSet], ["L1AnMLsLwtk"]);
  });

  it("preserves the actual source channel and deduplicates by configured priority", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-channels-"));
    const captionPath = join(storageRoot, "meeting.en.srv3");
    const captionText = "Item 1, approval of the minutes.";
    writeFileSync(captionPath, captionText, "utf8");
    const captionSha256 = createHash("sha256").update(captionText).digest("hex");
    const city = "https://youtube.com/@CityofLongmont";
    const lpm = "https://youtube.com/@LongmontPublicMedia";
    const state = statefulSql(storageRoot, [
      { channel_url: city, position: 0 },
      { channel_url: lpm, position: 1 },
    ]);
    const deps = {
      listChannelVideos: async (channelUrl: string) => channelUrl === city
        ? [
            { id: "city-only", title: "City Council Regular Session", published: "2026-09-22", url: "https://youtube.com/watch?v=city-only", duration: 100, tab: "streams" as const },
            { id: "duplicate", title: "Planning and Zoning Commission", published: "2026-09-16", url: "https://youtube.com/watch?v=duplicate", duration: 100, tab: "streams" as const },
          ]
        : [
            { id: "lpm-only", title: "Museum Advisory Board", published: "2026-09-17", url: "https://youtube.com/watch?v=lpm-only", duration: 100, tab: "videos" as const },
            { id: "duplicate", title: "Planning and Zoning Commission", published: "2026-09-16", url: "https://youtube.com/watch?v=duplicate", duration: 100, tab: "videos" as const },
          ],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionText, format: "srv3" as const, sha256: captionSha256, sourcePath: captionPath },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: state.withTransaction,
      runSection5: async () => ({ aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] }),
    };

    const result = await runMeetingAwareness(state.sql, 1, deps as never);
    const records = new Map(state.records().map((row) => [String(row.video_id), row]));
    assert.equal(result.found.length, 3, "the duplicate upload must be captured once");
    assert.equal(records.get("city-only")?.channel_url, city);
    assert.equal(records.get("lpm-only")?.channel_url, lpm);
    assert.equal(records.get("duplicate")?.channel_url, city, "the higher-priority channel must own a duplicate");
  });

  it("repairs a stale archive before it can suppress a database-uncaptured meeting", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-stale-archive-"));
    const priorRoot = process.env.TOWNREPORTER_DATA_ROOT;
    process.env.TOWNREPORTER_DATA_ROOT = storageRoot;
    try {
      const { meetingArchivePath, runMeetingAwareness } = await import("./meeting-capture.ts");
      const videoId = "stale000001";
      const archivePath = meetingArchivePath(1);
      mkdirSync(dirname(archivePath), { recursive: true });
      writeFileSync(archivePath, `youtube ${videoId}\n`, "utf8");
      const captionPath = join(storageRoot, "meeting.en.srv3");
      const captionText = "Item 1, approval of the minutes.";
      writeFileSync(captionPath, captionText, "utf8");
      const captionSha256 = createHash("sha256").update(captionText).digest("hex");
      const state = statefulSql(storageRoot);
      let captureCalls = 0;
      await runMeetingAwareness(state.sql, 1, {
        listChannelVideos: async () => [{ id: videoId, title: "City Council Meeting", published: "2026-09-22", url: `https://youtube.com/watch?v=${videoId}`, duration: 100, tab: "streams" as const }],
        captureMeeting: async ({ archivePath: received }: { archivePath: string }) => {
          captureCalls += 1;
          assert.doesNotMatch(readFileSync(received, "utf8"), new RegExp(videoId), "stale cache entry must be removed before capture");
          return { ok: true as const, parsed: { text: captionText, format: "srv3" as const, sha256: captionSha256, sourcePath: captionPath }, infoPath: null, info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null }, argv: [], stdout: "", stderr: "" };
        },
        withTransaction: state.withTransaction,
        runSection5: async () => ({ aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] }),
      } as never);
      assert.equal(captureCalls, 1);
    } finally {
      if (priorRoot === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
      else process.env.TOWNREPORTER_DATA_ROOT = priorRoot;
    }
  });

  it("reports one named failure when the failed record and capture pass describe the same error", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-failure-"));
    const state = statefulSql(storageRoot);
    const result = await runMeetingAwareness(state.sql, 1, {
      listChannelVideos: async () => [{
        id: "failure0001", title: "City Council Meeting", published: "2026-09-22",
        url: "https://youtube.com/watch?v=failure0001", duration: 100, tab: "streams" as const,
      }],
      captureMeeting: async () => ({
        ok: false as const, stopped: false, reason: "yt-dlp rate limited (HTTP 429)",
        argv: [], stdout: "", stderr: "",
      }),
      withTransaction: state.withTransaction,
    } as never);

    assert.deepEqual(result.failures, ["City Council Meeting: yt-dlp rate limited (HTTP 429)"]);
    assert.equal(result.failed.length, 1);
  });
});
