import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Sql } from "../db.ts";
import { withTransaction } from "../db.ts";
import { listChannelVideos, pickMeetingVideos, type ListedVideo } from "./youtube.ts";
import { captureMeetingCaptions, type CaptionCaptureFailure, type CaptionCaptureResult } from "./meeting-capture-ytdlp.ts";
import { storeMeetingTranscriptArtifact } from "./meeting-transcript-artifacts.ts";

export type MeetingChannel = { url: string; label?: string };
export type MeetingCaptureStatus = "not-captured" | "captured" | "failed";
export type MeetingCaptureRecord = {
  videoId: string; channelUrl: string; title: string; published: string;
  status: MeetingCaptureStatus; failureReason?: string | null;
  captionPath?: string | null; captionFormat?: string | null;
  captionSha256?: string | null; captionCapturedAt?: string | null;
};
export type MeetingAwarenessResult = {
  configured: boolean; found: ListedVideo[]; uncaptured: ListedVideo[];
  captured: MeetingCaptureRecord[]; failed: MeetingCaptureRecord[];
  coverageLine: string; failures: string[]; archivePath: string | null;
};
export type MeetingAwarenessDeps = {
  listChannelVideos?: typeof listChannelVideos;
  captureMeeting?: (input: { videoId: string; outputDir: string; archivePath: string; sleepSubtitles?: number; sleepRequests?: number }) => Promise<CaptionCaptureResult | CaptionCaptureFailure>;
  storeMeetingTranscriptArtifact?: typeof storeMeetingTranscriptArtifact;
  withTransaction?: typeof withTransaction;
  now?: () => Date;
};

const ARCHIVE_DIR = join(process.env.TOWNREPORTER_DATA_DIR || process.cwd(), "meeting-capture");
const CAPTION_DIR = join(process.env.TOWNREPORTER_DATA_DIR || process.cwd(), "meeting-captions");
const EMPTY_RESULT: MeetingAwarenessResult = {
  configured: false, found: [], uncaptured: [], captured: [], failed: [],
  coverageLine: "", failures: [], archivePath: null,
};

export function meetingArchivePath(newsroomId: number): string {
  return join(ARCHIVE_DIR, `newsroom-${newsroomId}`, "yt-dlp-archive.txt");
}
export function meetingCaptionDir(newsroomId: number): string {
  return join(CAPTION_DIR, `newsroom-${newsroomId}`);
}
export function parseArchive(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^youtube\s+([\w-]{11})\s*$/i);
    if (m) ids.add(m[1]!);
  }
  return ids;
}
export function serializeArchive(records: MeetingCaptureRecord[]): string {
  return records.filter((r) => r.status === "captured").map((r) => `youtube ${r.videoId}`).sort().join("\n").concat(records.length ? "\n" : "");
}
export function reconcileArchive(archiveText: string | null, records: MeetingCaptureRecord[]): { capturedIds: Set<string>; rewritten: string; changed: boolean } {
  const fromDb = new Set(records.filter((r) => r.status === "captured").map((r) => r.videoId));
  const fromFile = archiveText ? parseArchive(archiveText) : new Set<string>();
  const capturedIds = new Set([...fromDb].filter((id) => fromFile.has(id) || !fromFile.size || fromFile.has(id)));
  for (const id of fromDb) capturedIds.add(id);
  const rewritten = serializeArchive(records);
  return { capturedIds, rewritten, changed: rewritten !== (archiveText ?? "") };
}
export async function loadMeetingPriority(sql: Sql, newsroomId: number): Promise<MeetingChannel[]> {
  const rows = await sql.query<{ channel_url: string; position: number }>("select channel_url,position from meeting_channel_priority where newsroom_id=$1 order by position,id", [newsroomId]);
  return rows.map((r) => ({ url: r.channel_url }));
}
export async function saveMeetingPriority(sql: Sql, newsroomId: number, channels: MeetingChannel[]): Promise<void> {
  for (let i = 0; i < channels.length; i++) {
    await sql.query("insert into meeting_channel_priority(newsroom_id,channel_url,position) values($1,$2,$3) on conflict(newsroom_id,channel_url) do update set position=excluded.position", [newsroomId, channels[i]!.url, i]);
  }
}
export async function readArchive(path: string): Promise<string | null> {
  try { return existsSync(path) ? readFileSync(path, "utf8") : null; } catch { return null; }
}
export function regenerateArchive(path: string, records: MeetingCaptureRecord[]): string {
  const text = serializeArchive(records);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return text;
}
export function archiveCorrupt(text: string | null, records: MeetingCaptureRecord[]): boolean {
  if (text == null) return true;
  try { return serializeArchive(records) !== text && parseArchive(text).size === 0 && records.length > 0; } catch { return true; }
}

async function recordCaptureFailure(sql: Sql, newsroomId: number, video: ListedVideo, reason: string): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,failure_reason) values($1,$2,$3,$4,$5,'failed',$6) on conflict(newsroom_id,video_id) do update set status='failed',failure_reason=excluded.failure_reason,updated_at=now()",
    [newsroomId, video.id, video.url, video.title, video.published ?? "", reason],
  );
}
async function recordCaptureSuccess(sql: Sql, newsroomId: number, video: ListedVideo, channelUrl: string, result: Extract<CaptionCaptureResult, { ok: true }>): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,captured_at,caption_path,caption_format,caption_sha256,caption_captured_at,failure_reason) values($1,$2,$3,$4,$5,'captured',now(),$6,$7,$8,now(),null) on conflict(newsroom_id,video_id) do update set status='captured',captured_at=now(),caption_path=excluded.caption_path,caption_format=excluded.caption_format,caption_sha256=excluded.caption_sha256,caption_captured_at=now(),failure_reason=null,updated_at=now()",
    [newsroomId, video.id, channelUrl, video.title, video.published ?? "", result.parsed.sourcePath, result.parsed.format, result.parsed.sha256],
  );
}

export async function runMeetingAwareness(sql: Sql, newsroomId: number, deps: MeetingAwarenessDeps = {}): Promise<MeetingAwarenessResult> {
  const channels = await loadMeetingPriority(sql, newsroomId);
  if (!channels.length) return EMPTY_RESULT;
  const list = deps.listChannelVideos ?? listChannelVideos;
  const capture = deps.captureMeeting ?? captureMeetingCaptions;
  const storeTranscript = deps.storeMeetingTranscriptArtifact ?? storeMeetingTranscriptArtifact;
  const runTransaction = deps.withTransaction ?? withTransaction;
  const found: ListedVideo[] = [];
  const failures: string[] = [];
  for (const channel of channels) {
    try {
      const listed = await list(channel.url);
      found.push(...pickMeetingVideos(listed, 50));
    } catch (e) {
      failures.push(`${channel.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const records = await sql.query<{
    video_id: string; channel_url: string; title: string; published: string;
    status: MeetingCaptureStatus; failure_reason: string | null;
    caption_path: string | null; caption_format: string | null;
    caption_sha256: string | null; caption_captured_at: string | null;
  }>("select video_id,channel_url,title,published,status,failure_reason,caption_path,caption_format,caption_sha256,caption_captured_at from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  const captured: MeetingCaptureRecord[] = records.map((r) => ({
    videoId: r.video_id, channelUrl: r.channel_url, title: r.title, published: r.published,
    status: r.status, failureReason: r.failure_reason, captionPath: r.caption_path,
    captionFormat: r.caption_format, captionSha256: r.caption_sha256, captionCapturedAt: r.caption_captured_at,
  }));
  const known = new Set(captured.filter((r) => r.status === "captured").map((r) => r.videoId));
  const uncaptured = found.filter((v) => !known.has(v.id));
  for (const v of uncaptured) {
    const archivePath = meetingArchivePath(newsroomId);
    const outputDir = join(meetingCaptionDir(newsroomId), v.id);
    await sql.query(
      "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status) values($1,$2,$3,$4,$5,'not-captured') on conflict(newsroom_id,video_id) do update set title=excluded.title,published=excluded.published,updated_at=now()",
      [newsroomId, v.id, channels[0]!.url, v.title, v.published ?? ""],
    );
    let result: CaptionCaptureResult;
    try {
      result = await capture({ videoId: v.id, outputDir, archivePath, sleepSubtitles: 2, sleepRequests: 1 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await recordCaptureFailure(sql, newsroomId, v, reason);
      failures.push(`${v.title}: ${reason}`);
      continue;
    }
    if (!result.ok) {
      await recordCaptureFailure(sql, newsroomId, v, result.reason);
      failures.push(`${v.title}: ${result.reason}`);
      continue;
    }
    // Single transaction boundary: capture record, transcript artifact, and its
    // segments all commit together, on one transaction-scoped SQL handle.
    try {
      await runTransaction(async (tx) => {
        await recordCaptureSuccess(tx, newsroomId, v, channels[0]!.url, result as Extract<CaptionCaptureResult, { ok: true }>);
        await storeTranscript(tx, { newsroomId, videoId: v.id, parsed: result.parsed });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await recordCaptureFailure(sql, newsroomId, v, reason);
      failures.push(`${v.title}: ${reason}`);
    }
  }
  const refreshed = await sql.query<{
    video_id: string; channel_url: string; title: string; published: string;
    status: MeetingCaptureStatus; failure_reason: string | null;
    caption_path: string | null; caption_format: string | null;
    caption_sha256: string | null; caption_captured_at: string | null;
  }>("select video_id,channel_url,title,published,status,failure_reason,caption_path,caption_format,caption_sha256,caption_captured_at from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  const finalRecords: MeetingCaptureRecord[] = refreshed.map((r) => ({
    videoId: r.video_id, channelUrl: r.channel_url, title: r.title, published: r.published,
    status: r.status, failureReason: r.failure_reason, captionPath: r.caption_path,
    captionFormat: r.caption_format, captionSha256: r.caption_sha256, captionCapturedAt: r.caption_captured_at,
  }));
  const failed = finalRecords.filter((r) => r.status === "failed");
  const archivePath = meetingArchivePath(newsroomId);
  const archiveText = await readArchive(archivePath);
  const reconciled = reconcileArchive(archiveText, finalRecords);
  if (reconciled.changed) regenerateArchive(archivePath, finalRecords);
  const coverageLine = `meetings: ${found.length} found, ${finalRecords.filter((r) => r.status === "captured").length} captured, ${failed.length} failed`;
  return {
    configured: true, found, uncaptured, captured: finalRecords, failed, coverageLine,
    failures: [...failures, ...failed.map((r) => `${r.title}: ${r.failureReason ?? "capture failed"}`)],
    archivePath,
  };
}
export function meetingCoverageJson(result: MeetingAwarenessResult): string {
  return JSON.stringify({
    found: result.found.length,
    captured: result.captured.filter((r) => r.status === "captured").length,
    failed: result.failed.map((r) => ({ title: r.title, reason: r.failureReason ?? "capture failed" })),
  });
}
export function hashMeetingAwareness(result: MeetingAwarenessResult): string {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}
