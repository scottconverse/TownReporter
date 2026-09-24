import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeArchive, parseArchive, reconcileArchive, archiveCorrupt, meetingArchivePath, meetingCaptionDir, meetingRuntimeRoot, storedCaptureDisposition, runMeetingAwareness, type MeetingAwarenessDeps } from "./meeting-capture.ts";
import type { Sql } from "../db.ts";

const records = [
  { videoId: "aaaaaaaaaaa", channelUrl: "https://youtube.com/@city", title: "Council 1", published: "2026-01-01", status: "captured" as const },
  { videoId: "bbbbbbbbbbb", channelUrl: "https://youtube.com/@city", title: "Board 1", published: "2026-01-02", status: "not-captured" as const },
];

describe("meeting capture archive is a regenerable cache", () => {
  it("uses the installer-owned data root for runtime capture files", () => {
    const root = meetingRuntimeRoot({ TOWNREPORTER_DATA_ROOT: "C:\\TownReporterData", TOWNREPORTER_DATA_DIR: "C:\\Legacy" }, "C:\\App");
    assert.equal(root, "C:\\TownReporterData");
    assert.equal(meetingArchivePath(7, root), "C:\\TownReporterData\\meeting-capture\\newsroom-7\\yt-dlp-archive.txt");
    assert.equal(meetingCaptionDir(7, root), "C:\\TownReporterData\\meeting-captions\\newsroom-7");
  });

  it("keeps legacy and source-run fallbacks explicit", () => {
    assert.equal(meetingRuntimeRoot({ TOWNREPORTER_DATA_DIR: "C:\\Legacy" }, "C:\\App"), "C:\\Legacy");
    assert.equal(meetingRuntimeRoot({}, "C:\\App"), "C:\\App");
  });

  it("preserves a stored provisional disposition instead of relabeling it final", () => {
    assert.equal(storedCaptureDisposition("provisional", "captured"), "provisional");
    assert.equal(storedCaptureDisposition("final", "captured"), "final");
    assert.equal(storedCaptureDisposition(null, "captured"), "final");
    assert.equal(storedCaptureDisposition(null, "failed"), undefined);
  });

  it("database wins when the file says captured but the record says not captured", () => {
    const r = reconcileArchive("youtube bbbbbbbbbbb\n", records);
    assert.equal(r.capturedIds.has("bbbbbbbbbbb"), false);
  });

  it("database wins when the record says captured and the file omits it", () => {
    const r = reconcileArchive("youtube ccccccccccc\n", records);
    assert.equal(r.capturedIds.has("aaaaaaaaaaa"), true);
    assert.match(r.rewritten, /^youtube aaaaaaaaaaa$/m);
    assert.doesNotMatch(r.rewritten, /bbbbbbbbbbb/);
  });

  it("regenerates after deliberate corruption and is idempotent", () => {
    const corrupted = "not an archive\n\x00\x00truncated";
    const first = reconcileArchive(corrupted, records);
    const second = reconcileArchive(first.rewritten, records);
    assert.equal(first.rewritten, serializeArchive(records));
    assert.equal(second.rewritten, first.rewritten);
    assert.equal(second.changed, false);
    assert.equal(archiveCorrupt(corrupted, records), true);
    assert.deepEqual([...parseArchive(first.rewritten)], ["aaaaaaaaaaa"]);
  });

  it("never treats an archive-only video as captured", () => {
    const r = reconcileArchive("youtube zzzzzzzzzzz\n", records);
    assert.equal(r.capturedIds.has("zzzzzzzzzzz"), false);
  });
});

function readinessTestSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string) => {
    statements.push(text);
    if (/select enabled from meeting_capture_settings/i.test(text)) return [{ enabled: true }] as T[];
    if (/select duration_cap_seconds/i.test(text)) return [] as T[];
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }] as T[];
    if (/from meeting_capture_records/i.test(text)) return [] as T[];
    return [] as T[];
  };
  return { sql, statements };
}

describe("meeting capture readiness preflight", () => {
  it("does not start captions or audio for live/upcoming or metadata-unknown RSS entries", async () => {
    const { sql, statements } = readinessTestSql();
    const statuses = new Map([
      ["upcom000001", "upcoming" as const],
      ["live0000001", "live" as const],
      ["unknown0001", "unknown" as const],
    ]);
    let captionCalls = 0;
    let audioCalls = 0;
    const deps: MeetingAwarenessDeps = {
      listChannelVideos: async () => [...statuses.keys()].map((id) => ({
        id, title: "Planning and Zoning Commission Meeting", published: "2026-09-23",
        url: `https://www.youtube.com/watch?v=${id}`, duration: 0, tab: "rss" as const,
      })),
      captureReadiness: async (videoId) => statuses.get(videoId) ?? "unknown",
      prepareCapturePaths: () => ({ archivePath: "unused-archive", outputDir: "unused-output" }),
      captureMeeting: async () => { captionCalls += 1; return { ok: false, reason: "no text", argv: [], stderr: "" }; },
      captureAudio: async () => { audioCalls += 1; return { ok: false, reason: "unexpected", argv: [], stderr: "" }; },
    };
    const result = await runMeetingAwareness(sql, 900001, deps);
    assert.equal(captionCalls, 0);
    assert.equal(audioCalls, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(result.uncaptured.length, 3, "skipped listings stay visible as uncaptured and retry next run");
    assert.match(result.coverageLine, /2 live\/upcoming skipped/);
    assert.match(result.coverageLine, /1 waiting for status metadata \(will retry\)/);
    assert.equal(statements.some((statement) => /insert into meeting_capture_records/i.test(statement)), false,
      "not-ready listings must not create failed or misleading capture records");
  });

  it("lets a completed RSS-only meeting reach caption capture when metadata says ready", async () => {
    const { sql } = readinessTestSql();
    let captionCalls = 0;
    let audioCalls = 0;
    const deps: MeetingAwarenessDeps = {
      listChannelVideos: async () => [{
        id: "completed01", title: "Planning and Zoning Commission Meeting", published: "2026-09-23",
        url: "https://www.youtube.com/watch?v=completed01", duration: 0, tab: "rss",
      }],
      captureReadiness: async () => "ready",
      prepareCapturePaths: () => ({ archivePath: "unused-archive", outputDir: "unused-output" }),
      captureMeeting: async () => {
        captionCalls += 1;
        return { ok: false, reason: "temporary metadata test failure", argv: [], stderr: "" };
      },
      captureAudio: async () => { audioCalls += 1; return { ok: false, reason: "unexpected", argv: [], stderr: "" }; },
    };
    const result = await runMeetingAwareness(sql, 900002, deps);
    assert.equal(captionCalls, 1, "a completed but RSS-only video remains capturable");
    assert.equal(audioCalls, 0, "transient capture failure is not an audio-fallback trigger");
    assert.match(result.failures.join("\n"), /temporary metadata test failure/);
  });
});
