import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeArchive, parseArchive, reconcileArchive, archiveCorrupt, meetingArchivePath, meetingCaptionDir, meetingRuntimeRoot, storedCaptureDisposition, runMeetingAwareness, type MeetingAwarenessDeps } from "./meeting-capture.ts";
import type { Sql } from "../db.ts";

const records = [
  { videoId: "aaaaaaaaaaa", channelUrl: "https://youtube.com/@city", title: "Council 1", published: "2026-01-01", status: "captured" as const },
  { videoId: "bbbbbbbbbbb", channelUrl: "https://youtube.com/@city", title: "Board 1", published: "2026-01-02", status: "not-captured" as const },
];

/**
 * The path segments `full` sits at, below `root`.
 *
 * `meetingArchivePath` and `meetingCaptionDir` build a real filesystem path
 * with `path.join`, so the separator is the host's: `\` on Windows, `/` on
 * Linux. Asserting one literal string therefore only passed on Windows, and CI
 * runs Linux. Compare what the path actually means -- the segments under the
 * resolved root -- so the invariant holds on both.
 */
function segmentsBelow(root: string, full: string): string[] {
  return full.slice(root.length).split(/[\\/]+/).filter(Boolean);
}

describe("meeting capture archive is a regenerable cache", () => {
  it("uses the installer-owned data root for runtime capture files", () => {
    const root = meetingRuntimeRoot({ TOWNREPORTER_DATA_ROOT: "C:\\TownReporterData", TOWNREPORTER_DATA_DIR: "C:\\Legacy" }, "C:\\App");
    assert.equal(root, "C:\\TownReporterData");
    // Both files must land under the installer-owned root -- not under the
    // source-run fallback (`C:\App`) -- and in the documented layout.
    const archive = meetingArchivePath(7, root);
    assert.equal(archive.startsWith(root), true, `archive must live under the data root: ${archive}`);
    assert.deepEqual(segmentsBelow(root, archive), ["meeting-capture", "newsroom-7", "yt-dlp-archive.txt"]);
    const captions = meetingCaptionDir(7, root);
    assert.equal(captions.startsWith(root), true, `caption folder must live under the data root: ${captions}`);
    assert.deepEqual(segmentsBelow(root, captions), ["meeting-captions", "newsroom-7"]);
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

type Statement = { text: string; params: unknown[] };

/**
 * A capture pass backed by a fake database. `artifactStatuses` is the latest
 * transcript artifact integrity status per video; everything else (settings,
 * channels, records) answers the empty/default shape the pass expects.
 */
function capturePassSql(input: {
  artifactStatuses?: Record<string, string>;
  records?: Record<string, unknown>[];
} = {}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    if (/select enabled from meeting_capture_settings/i.test(text)) return [{ enabled: true }] as T[];
    if (/select duration_cap_seconds/i.test(text)) return [] as T[];
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }] as T[];
    if (/distinct on \(video_id\)[\s\S]*meeting_transcript_artifacts/i.test(text)) {
      return Object.entries(input.artifactStatuses ?? {}).map(([video_id, integrity_status]) => ({ video_id, integrity_status })) as T[];
    }
    if (/from meeting_transcript_artifacts/i.test(text)) return [] as T[];
    if (/from meeting_capture_records/i.test(text)) return (input.records ?? []) as T[];
    if (/from newsroom_members/i.test(text)) return [{ user_id: "owner-1" }] as T[];
    return [] as T[];
  };
  return { sql, statements };
}

function withCaptureDataRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "meeting-capture-test-"));
  const prior = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = root;
  return run(root).finally(() => {
    if (prior === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
    else process.env.TOWNREPORTER_DATA_ROOT = prior;
    rmSync(root, { recursive: true, force: true });
  });
}

const RATE_LIMITED = "yt-dlp rate limited (HTTP 429): HTTP Error 429: Too Many Requests";
const MEETING = {
  id: "audiofall01", title: "City Council Meeting", published: "2026-09-22",
  url: "https://www.youtube.com/watch?v=audiofall01", duration: 3420, tab: "rss" as const,
};

function audioSuccess() {
  return {
    ok: true as const,
    audio: { path: "C:\\tmp\\audiofall01.opus", format: "opus" as const, byteSize: 1_048_576, sha256: "a".repeat(64) },
    infoPath: null,
    info: { durationSeconds: 3420, videoTimestamp: null, captionRevisionTimestamp: null },
    argv: [], stdout: "", stderr: "",
  };
}

const rateLimitStatement = (statements: Statement[]) =>
  statements.find((s) => /'YouTube rate limited \(HTTP 429\)'/.test(s.text));

describe("A7: a caption 429 falls back to audio before the rate limit is recorded", () => {
  it("captures from audio and records no rate limit when the audio download succeeds", async () => {
    await withCaptureDataRoot(async () => {
      const { sql, statements } = capturePassSql();
      const audioCalls: string[] = [];
      const result = await runMeetingAwareness(sql, 900101, {
        listChannelVideos: async () => [MEETING],
        prepareCapturePaths: () => ({ archivePath: "unused-archive", outputDir: "unused-output" }),
        captureMeeting: async () => ({ ok: false, reason: RATE_LIMITED, argv: [], stderr: "" }),
        captureAudio: async (input) => { audioCalls.push(input.videoId); return audioSuccess(); },
        storeMeetingAudioArtifact: (async () => ({ id: 9, storagePath: "C:\\tmp\\stored.opus" })) as unknown as NonNullable<MeetingAwarenessDeps["storeMeetingAudioArtifact"]>,
        withTransaction: (async (fn: (tx: Sql) => Promise<unknown>) => fn(sql)) as unknown as NonNullable<MeetingAwarenessDeps["withTransaction"]>,
      });
      assert.deepEqual(audioCalls, [MEETING.id], "the refused caption download is tried once as audio");
      assert.equal(rateLimitStatement(statements), undefined, "a good audio download records no rate limit");
      const stored = statements.find((s) => /insert into meeting_capture_records/i.test(s.text) && /'captured'/.test(s.text));
      assert.ok(stored, "the video is recorded as captured");
      assert.ok(stored.params.includes("Captions refused by YouTube (HTTP 429); audio fallback used."),
        "the record says why the audio fallback ran");
      assert.equal(result.failures.length, 0);
    });
  });

  it("records the rate limit when the audio download is refused too", async () => {
    await withCaptureDataRoot(async () => {
      const { sql, statements } = capturePassSql();
      let audioCalls = 0;
      await runMeetingAwareness(sql, 900102, {
        listChannelVideos: async () => [MEETING],
        prepareCapturePaths: () => ({ archivePath: "unused-archive", outputDir: "unused-output" }),
        captureMeeting: async () => ({ ok: false, reason: RATE_LIMITED, argv: [], stderr: "" }),
        captureAudio: async () => { audioCalls += 1; return { ok: false, reason: RATE_LIMITED, argv: [], stderr: "" }; },
      });
      assert.equal(audioCalls, 1, "audio is tried exactly once, never retried");
      const recorded = rateLimitStatement(statements);
      assert.ok(recorded, "a refused audio download records the YouTube rate limit");
      assert.match(String(recorded.params[5]), /^\d{4}-\d{2}-\d{2}$/, "the retry day is recorded");
    });
  });
});

const CAPTURED_RECORD = {
  video_id: "", channel_url: "https://youtube.com/@city", title: "City Council Meeting",
  published: "2026-09-01", status: "captured", failure_reason: null,
  youtube_retry_day: null, youtube_retry_count: 0, youtube_retry_at: null,
  caption_path: null, caption_format: null, caption_sha256: "b".repeat(64), caption_captured_at: null,
  ended_at: null, capture_disposition: "final", duration_seconds: 3420, caption_revision_timestamp: null,
  revision_count: 0, settled_under_churn: false, last_revision_at: null,
};
const listedFor = (id: string) => ({
  id, title: "City Council Meeting", published: "2026-09-01",
  url: `https://www.youtube.com/watch?v=${id}`, duration: 3420, tab: "rss" as const,
});

// A successful caption capture. The fake apply step ignores the parsed file;
// the pass only reads its path to size-check the artifact.
function captionSuccess(outputDir: string) {
  return {
    ok: true as const,
    parsed: { sourcePath: join(outputDir, "captions.srv3"), sha256: "d".repeat(64) },
    infoPath: null,
    info: { durationSeconds: 3420, videoTimestamp: null, captionRevisionTimestamp: null },
    argv: [], stdout: "", stderr: "",
  } as unknown as Awaited<ReturnType<NonNullable<MeetingAwarenessDeps["captureMeeting"]>>>;
}

describe("A10: a captured video whose transcript artifact is missing is captured again", () => {
  it("re-runs the capture pass and keeps the video out of the download archive", async () => {
    await withCaptureDataRoot(async (root) => {
      const { sql, statements } = capturePassSql({
        artifactStatuses: { gone0000001: "missing" },
        records: [{ ...CAPTURED_RECORD, video_id: "gone0000001" }],
      });
      const archive = meetingArchivePath(900103, root);
      // The live archive still lists the video: yt-dlp would otherwise report
      // "already recorded" and write no caption file, so the pass must clear it.
      const fs = await import("node:fs");
      fs.mkdirSync(join(root, "meeting-capture", "newsroom-900103"), { recursive: true });
      fs.writeFileSync(archive, "youtube gone0000001\n", "utf8");
      const captures: string[] = [];
      const reapplied: string[] = [];
      await runMeetingAwareness(sql, 900103, {
        listChannelVideos: async () => [listedFor("gone0000001")],
        prepareCapturePaths: () => ({ archivePath: archive, outputDir: join(root, "captions") }),
        captureMeeting: async (input) => { captures.push(input.videoId); return captionSuccess(join(root, "captions")); },
        captureAudio: async () => ({ ok: false, reason: "unexpected", argv: [], stderr: "" }),
        applyCapturedMeetingTranscript: (async (_tx: Sql, input: { video: { id: string } }) => {
          reapplied.push(input.video.id);
          return { warnings: [] };
        }) as unknown as NonNullable<MeetingAwarenessDeps["applyCapturedMeetingTranscript"]>,
        withTransaction: (async (fn: (tx: Sql) => Promise<unknown>) => fn(sql)) as unknown as NonNullable<MeetingAwarenessDeps["withTransaction"]>,
      });
      assert.deepEqual(captures, ["gone0000001"], "a missing artifact re-runs the capture");
      assert.deepEqual(reapplied, ["gone0000001"], "the fresh capture is applied the normal way");
      const archiveText = fs.existsSync(archive) ? fs.readFileSync(archive, "utf8") : "";
      assert.doesNotMatch(archiveText, /gone0000001/, "the archive cannot suppress the recapture");
      assert.equal(statements.some((s) => /delete from meeting_transcript_artifacts/i.test(s.text)), false,
        "the old artifact row is never deleted");
    });
  });

  it("leaves a captured video with a valid latest artifact alone", async () => {
    await withCaptureDataRoot(async (root) => {
      const { sql } = capturePassSql({
        artifactStatuses: { fine0000001: "valid" },
        records: [{ ...CAPTURED_RECORD, video_id: "fine0000001" }],
      });
      const captures: string[] = [];
      await runMeetingAwareness(sql, 900104, {
        listChannelVideos: async () => [listedFor("fine0000001")],
        prepareCapturePaths: () => ({ archivePath: meetingArchivePath(900104, root), outputDir: join(root, "captions") }),
        captureMeeting: async (input) => { captures.push(input.videoId); return { ok: false, reason: "no text", argv: [], stderr: "" }; },
        captureAudio: async () => ({ ok: false, reason: "unexpected", argv: [], stderr: "" }),
      });
      assert.deepEqual(captures, [], "an intact capture is not downloaded again");
      const archiveText = await import("node:fs").then((fs) => fs.readFileSync(meetingArchivePath(900104, root), "utf8"));
      assert.match(archiveText, /youtube fine0000001/, "an intact capture stays in the archive");
    });
  });
});

describe("A10 guard: recapture runs only against a readable root, and only three at a time", () => {
  it("recaptures nothing when the meeting artifact root is not readable", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "meeting-capture-test-"));
    const unplugged = join(scratch, "unplugged-drive");
    const prior = process.env.TOWNREPORTER_DATA_ROOT;
    process.env.TOWNREPORTER_DATA_ROOT = unplugged; // the drive is not there
    try {
      const { sql } = capturePassSql({
        artifactStatuses: { gone0000001: "missing" },
        records: [{ ...CAPTURED_RECORD, video_id: "gone0000001" }],
      });
      const captures: string[] = [];
      await runMeetingAwareness(sql, 900105, {
        listChannelVideos: async () => [listedFor("gone0000001")],
        prepareCapturePaths: () => ({ archivePath: join(scratch, "archive.txt"), outputDir: join(scratch, "captions") }),
        captureMeeting: async (input) => { captures.push(input.videoId); return captionSuccess(join(scratch, "captions")); },
        captureAudio: async () => { throw new Error("unexpected audio attempt"); },
        applyCapturedMeetingTranscript: (async () => ({ warnings: [] })) as unknown as NonNullable<MeetingAwarenessDeps["applyCapturedMeetingTranscript"]>,
        withTransaction: (async (fn: (tx: Sql) => Promise<unknown>) => fn(sql)) as unknown as NonNullable<MeetingAwarenessDeps["withTransaction"]>,
      });
      assert.deepEqual(captures, [], "an unreadable root cannot start a mass recapture");
    } finally {
      if (prior === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
      else process.env.TOWNREPORTER_DATA_ROOT = prior;
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("recaptures the three oldest missing meetings and leaves the rest in the archive", async () => {
    await withCaptureDataRoot(async (root) => {
      const published: Record<string, string> = {
        missing0001: "2026-09-01", missing0002: "2026-09-02", missing0003: "2026-09-03",
        missing0004: "2026-07-01", missing0005: "2026-08-01",
      };
      const { sql } = capturePassSql({
        artifactStatuses: Object.fromEntries(Object.keys(published).map((id) => [id, "missing"])),
        records: Object.entries(published).map(([video_id, date]) => ({ ...CAPTURED_RECORD, video_id, published: date })),
      });
      const archive = meetingArchivePath(900106, root);
      const fs = await import("node:fs");
      fs.mkdirSync(join(root, "meeting-capture", "newsroom-900106"), { recursive: true });
      fs.writeFileSync(archive, Object.keys(published).map((id) => `youtube ${id}`).join("\n") + "\n", "utf8");
      const captures: string[] = [];
      await runMeetingAwareness(sql, 900106, {
        listChannelVideos: async () => Object.keys(published).map((id) => listedFor(id)),
        prepareCapturePaths: () => ({ archivePath: archive, outputDir: join(root, "captions") }),
        captureMeeting: async (input) => { captures.push(input.videoId); return captionSuccess(join(root, "captions")); },
        captureAudio: async () => { throw new Error("unexpected audio attempt"); },
        applyCapturedMeetingTranscript: (async () => ({ warnings: [] })) as unknown as NonNullable<MeetingAwarenessDeps["applyCapturedMeetingTranscript"]>,
        withTransaction: (async (fn: (tx: Sql) => Promise<unknown>) => fn(sql)) as unknown as NonNullable<MeetingAwarenessDeps["withTransaction"]>,
      });
      assert.deepEqual(captures.sort(), ["missing0001", "missing0004", "missing0005"],
        "only the three oldest missing meetings are recaptured in one pass");
      const archiveText = fs.readFileSync(archive, "utf8");
      assert.match(archiveText, /youtube missing0002/, "an over-cap missing meeting keeps its archive line");
      assert.match(archiveText, /youtube missing0003/, "an over-cap missing meeting keeps its archive line");
      assert.doesNotMatch(archiveText, /youtube missing0004/, "a recapture target is held out of the archive");
    });
  });
});
