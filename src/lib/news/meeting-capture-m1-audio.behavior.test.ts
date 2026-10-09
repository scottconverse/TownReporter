import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSql } from "../db.ts";
import type { Sql } from "../db.ts";
import { storeMeetingAudioArtifact } from "./meeting-audio-artifacts.ts";

type Row = Record<string, unknown>;

/*
  These tests drive the real capture path, and `runMeetingAwareness` writes its
  yt-dlp download-archive through `meetingArchivePath()`, which roots at
  `meetingRuntimeRoot()` (`src/lib/news/meeting-capture.ts`): TOWNREPORTER_DATA_ROOT,
  else TOWNREPORTER_DATA_DIR, else `process.cwd()`. With neither variable set the
  run left `meeting-capture/newsroom-1/yt-dlp-archive.txt` in whatever directory
  the runner started in -- a stray untracked folder at the repo root. The
  `mkdtempSync` storage root below is unrelated; it is the archive that leaks.
  Pin the root to a temp dir for this file and put the environment back after.
*/
let priorDataRoot: string | undefined;

before(() => {
  priorDataRoot = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = mkdtempSync(join(tmpdir(), "townreporter-m1-audio-root-"));
});

after(() => {
  if (priorDataRoot === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
  else process.env.TOWNREPORTER_DATA_ROOT = priorDataRoot;
});

function statefulSql(): {
  sql: Sql; rows: Map<string, Row>; audioRows: Row[];
  withTransaction: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
} {
  const rows = new Map<string, Row>();
  const audioRows: Row[] = [];
  const storageRoot = mkdtempSync(join(tmpdir(), "m1-store-"));
  const run = (text: string, params: unknown[] = []): Row[] | null => {
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }];
    if (/from meeting_capture_settings/i.test(text)) return [{ storage_root: storageRoot, retention_mode: "transcript-only" }];
    if (/from meeting_capture_records/i.test(text)) return [...rows.values()];
    if (/insert into meeting_capture_records/i.test(text)) {
      const [newsroomId, videoId, channelUrl, title, published] = params as [number, string, string, string, string];
      if (text.includes("audio_path")) {
        rows.set(videoId, {
          newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
          status: "captured", failure_reason: null,
          caption_path: null, caption_format: null, caption_sha256: null, caption_captured_at: null,
          audio_path: params[8], audio_format: params[9], audio_sha256: params[10], audio_bytes: params[11],
          audio_trigger_reason: params[12], ended_at: params[5], capture_disposition: params[6],
          duration_seconds: params[7], caption_revision_timestamp: null,
          revision_count: 0, settled_under_churn: false, last_revision_at: null,
        });
      } else {
        rows.set(videoId, {
          newsroom_id: newsroomId, video_id: videoId, channel_url: channelUrl, title, published,
          status: text.includes("'captured'") ? "captured" : text.includes("'failed'") ? "failed" : "not-captured",
          failure_reason: null,
        });
      }
      return [];
    }
    if (/insert into meeting_audio_captures/i.test(text)) {
      const row = { id: audioRows.length + 9, storage_path: String(params[2]), params };
      audioRows.push(row);
      return [{ id: row.id, captured_at: "2026-01-01T00:00:00Z" }];
    }
    if (/from meeting_audio_captures/i.test(text)) return audioRows;
    return null;
  };
  const makeSql = (): Sql => {
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Row>(text: string, params: unknown[] = []) => (run(text, params) ?? []) as T[];
    return sql;
  };
  const sql = makeSql();
  const withTransaction = async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> => fn(makeSql());
  return { sql, rows, audioRows, withTransaction };
}

describe("meeting capture M-1 audio fallback in the real pipeline", () => {
  it("captions failure triggers audio capture and records the trigger reason", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const state = statefulSql();
    const audioFile = join(mkdtempSync(join(tmpdir(), "m1-audio-")), "AYkGlzLLIxc.opus");
    writeFileSync(audioFile, "OPUS-PLACEHOLDER-AUDIO-BYTES", "utf8");
    let audioCalls = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "AYkGlzLLIxc", title: "Water Board Meeting", published: "2021-04-19",
        url: "https://www.youtube.com/watch?v=AYkGlzLLIxc", duration: 6850, tab: "streams" as const,
      }],
      captureMeeting: async () => ({
        ok: false as const,
        reason: "yt-dlp exited 0 but wrote no srv3 or vtt caption file",
        argv: [], stderr: "",
      }),
      captureAudio: async () => {
        audioCalls += 1;
        return {
          ok: true as const,
          audio: { path: audioFile, format: "opus" as const, byteSize: 1234, sha256: "b".repeat(64) },
          infoPath: null,
          info: { durationSeconds: 6850, videoTimestamp: 1618800000, captionRevisionTimestamp: null },
          argv: [], stdout: "", stderr: "",
        };
      },
      withTransaction: state.withTransaction,
      runSection5: async () => ({ aligned: true, alignmentReason: null, chunkCount: 0, voteCount: 0, unalignedLead: null, citations: [] }),
    } as never;
    const result = await runMeetingAwareness(state.sql, 1, deps);
    assert.equal(audioCalls, 1, "audio fallback must run exactly once when captions fail");
    assert.match(result.coverageLine, /1 captured/);
    const rec = [...state.rows.values()][0]!;
    assert.equal(rec.audio_format, "opus");
    assert.equal(rec.audio_sha256, "b".repeat(64));
    assert.match(String(rec.audio_trigger_reason), /no srv3 or vtt caption file/);
    assert.equal(state.audioRows.length, 1, "audio artifact row must be written");
  });

  it("normal caption success never invokes audio", async () => {
    const { runMeetingAwareness } = await import("./meeting-capture.ts");
    const state = statefulSql();
    const dir = mkdtempSync(join(tmpdir(), "m1-"));
    const cap = join(dir, "cap.srv3");
    writeFileSync(cap, "<timedtext><body><p>Item 1.</p></body></timedtext>", "utf8");
    let audioCalls = 0;
    const deps = {
      listChannelVideos: async () => [{
        id: "L1AnMLsLwtk", title: "Council", published: "2026-01-01",
        url: "https://www.youtube.com/watch?v=L1AnMLsLwtk", duration: 100, tab: "streams" as const,
      }],
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: "Item 1.", format: "srv3" as const, sha256: "c".repeat(64), sourcePath: cap },
        infoPath: null, info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      captureAudio: async () => { audioCalls += 1; throw new Error("audio must not run"); },
      withTransaction: state.withTransaction,
      runSection5: async () => ({ aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 0, unalignedLead: null, citations: [] }),
    } as never;
    await runMeetingAwareness(state.sql, 1, deps);
    assert.equal(audioCalls, 0, "audio must not run on the captions-first path");
  });

  // guards: a repeat capture could overwrite the reporter's earlier audio evidence
  it("a second capture keeps the first audio file and record", async () => {
    const sql = await getSql();
    const testRoot = mkdtempSync(join(tmpdir(), "meeting-audio-write-once-"));
    const storageRoot = join(testRoot, "stored");
    const newsroomId = 900000 + Math.floor(Math.random() * 900000);
    const videoId = "write-once-video";
    const firstSource = join(testRoot, "first.opus");
    const secondSource = join(testRoot, "second.opus");
    try {
      await sql.query(
        "insert into meeting_capture_settings(newsroom_id,storage_root,retention_mode) values($1,$2,'audio-only')",
        [newsroomId, storageRoot],
      );
      writeFileSync(firstSource, "first captured audio bytes");
      writeFileSync(secondSource, "second captured audio bytes");
      const first = await storeMeetingAudioArtifact(sql, {
        newsroomId, videoId, audioSourcePath: firstSource, format: "opus", triggerReason: "captions unavailable",
      });
      const second = await storeMeetingAudioArtifact(sql, {
        newsroomId, videoId, audioSourcePath: secondSource, format: "opus", triggerReason: "captions unavailable",
      });
      const rows = await sql.query<{ id: number; storage_path: string }>(
        "select id,storage_path from meeting_audio_captures where newsroom_id=$1 and video_id=$2 order by id",
        [newsroomId, videoId],
      );
      assert.notEqual(first.id, second.id, "each capture must have a new record id");
      assert.equal(rows.length, 2, "both audio captures must remain in the record");
      assert.equal(new Set(rows.map((row) => row.storage_path)).size, 2, "each capture must have its own file");
      assert.equal(readFileSync(first.storagePath, "utf8"), "first captured audio bytes");
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
