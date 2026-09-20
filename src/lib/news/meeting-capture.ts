import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Sql } from "../db.ts";
import { withTransaction } from "../db.ts";
import { listChannelVideos, pickMeetingVideos, type ListedVideo } from "./youtube.ts";
import { captureMeetingCaptions, captureMeetingAudio, requiresAudioFallback, type CaptionCaptureFailure, type CaptionCaptureResult, type AudioCaptureResult } from "./meeting-capture-ytdlp.ts";
import { storeMeetingAudioArtifact } from "./meeting-audio-artifacts.ts";
import { computeEndedAt } from "./meeting-capture-info.ts";
import { applyDraftRevision, captureDisposition, detectRevision, dueForRecheck, nextCheckState } from "./meeting-revision.ts";
import { storeMeetingTranscriptArtifact } from "./meeting-transcript-artifacts.ts";
import { runSection5ForArtifact } from "./meeting-story-section5-run.ts";

export type MeetingChannel = { url: string; label?: string };
export type MeetingCaptureStatus = "not-captured" | "captured" | "failed";
export type MeetingCaptureRecord = {
  videoId: string; channelUrl: string; title: string; published: string;
  status: MeetingCaptureStatus; failureReason?: string | null;
  captionPath?: string | null; captionFormat?: string | null;
  captionSha256?: string | null; captionCapturedAt?: string | null;
  endedAt?: string | null; captureDisposition?: "provisional" | "final";
  durationSeconds?: number | null; captionRevisionTimestamp?: number | null;
  audioPath?: string | null; audioFormat?: string | null; audioSha256?: string | null; audioBytes?: number | null; audioTriggerReason?: string | null;
  revisionCount?: number; settledUnderChurn?: boolean; lastRevisionAt?: string | null;
};
export type MeetingAwarenessResult = {
  configured: boolean; found: ListedVideo[]; uncaptured: ListedVideo[]; captured: MeetingCaptureRecord[];
  failed: MeetingCaptureRecord[]; coverageLine: string; failures: string[]; archivePath: string | null;
};
export type MeetingAwarenessDeps = {
  listChannelVideos?: typeof listChannelVideos;
  captureMeeting?: (input: { videoId: string; outputDir: string; archivePath: string; sleepSubtitles?: number; sleepRequests?: number }) => Promise<CaptionCaptureResult | CaptionCaptureFailure>;
  captureAudio?: (input: { videoId: string; outputDir: string; archivePath: string; sleepRequests?: number }) => Promise<AudioCaptureResult>;
  storeMeetingAudioArtifact?: typeof storeMeetingAudioArtifact;
  storeMeetingTranscriptArtifact?: typeof storeMeetingTranscriptArtifact;
  runSection5?: typeof runSection5ForArtifact;
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

async function recordAudioCaptureSuccess(
  sql: Sql, newsroomId: number, video: ListedVideo, channelUrl: string,
  result: Extract<AudioCaptureResult, { ok: true }>, endedAt: string | null, disposition: "provisional" | "final",
  artifactId: number, triggerReason: string, storedPath: string,
): Promise<void> {
  await sql.query(
    `insert into meeting_capture_records(
       newsroom_id,video_id,channel_url,title,published,status,captured_at,
       failure_reason,ended_at,capture_disposition,duration_seconds,
       audio_path,audio_format,audio_sha256,audio_bytes,audio_captured_at,audio_trigger_reason)
     values($1,$2,$3,$4,$5,'captured',now(),null,$6,$7,$8,$9,$10,$11,$12,now(),$13)
     on conflict(newsroom_id,video_id) do update set
       status='captured',captured_at=now(),failure_reason=null,ended_at=excluded.ended_at,
       capture_disposition=excluded.capture_disposition,duration_seconds=excluded.duration_seconds,
       audio_path=excluded.audio_path,audio_format=excluded.audio_format,audio_sha256=excluded.audio_sha256,
       audio_bytes=excluded.audio_bytes,audio_captured_at=now(),audio_trigger_reason=excluded.audio_trigger_reason,
       updated_at=now()`,
    [newsroomId, video.id, channelUrl, video.title, video.published ?? "", endedAt, disposition, result.info.durationSeconds, storedPath, result.audio.format, result.audio.sha256, result.audio.byteSize, triggerReason],
  );
}

async function recordCaptureFailure(sql: Sql, newsroomId: number, video: ListedVideo, reason: string): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,failure_reason) values($1,$2,$3,$4,$5,'failed',$6) on conflict(newsroom_id,video_id) do update set status='failed',failure_reason=excluded.failure_reason,updated_at=now()",
    [newsroomId, video.id, video.url, video.title, video.published ?? "", reason],
  );
}
async function recordCaptureSuccess(
  sql: Sql, newsroomId: number, video: ListedVideo, channelUrl: string,
  result: Extract<CaptionCaptureResult, { ok: true }>, endedAt: string | null, disposition: "provisional" | "final",
): Promise<void> {
  await sql.query(
    `insert into meeting_capture_records(
       newsroom_id,video_id,channel_url,title,published,status,captured_at,
       caption_path,caption_format,caption_sha256,caption_captured_at,failure_reason,
       ended_at,capture_disposition,duration_seconds,caption_revision_timestamp)
     values($1,$2,$3,$4,$5,'captured',now(),$6,$7,$8,now(),null,$9,$10,$11,$12)
     on conflict(newsroom_id,video_id) do update set
       status='captured',captured_at=now(),caption_path=excluded.caption_path,
       caption_format=excluded.caption_format,caption_sha256=excluded.caption_sha256,
       caption_captured_at=now(),failure_reason=null,ended_at=excluded.ended_at,
       capture_disposition=excluded.capture_disposition,duration_seconds=excluded.duration_seconds,
       caption_revision_timestamp=excluded.caption_revision_timestamp,updated_at=now()`,
    [newsroomId, video.id, channelUrl, video.title, video.published ?? "", result.parsed.sourcePath, result.parsed.format, result.parsed.sha256, endedAt, disposition, result.info.durationSeconds, result.info.captionRevisionTimestamp],
  );
}

export async function runMeetingAwareness(sql: Sql, newsroomId: number, deps: MeetingAwarenessDeps = {}): Promise<MeetingAwarenessResult> {
  // N-1: the operator enable/disable control. Disabled returns the same no-op
  // result as an unconfigured newsroom, without deleting any configuration.
  const meetingSettings = await sql.query<{ enabled: boolean | null }>("select enabled from meeting_capture_settings where newsroom_id=$1", [newsroomId]);
  if (meetingSettings.length && meetingSettings[0]!.enabled === false) return EMPTY_RESULT;
  const channels = await loadMeetingPriority(sql, newsroomId);
  if (!channels.length) return EMPTY_RESULT;
  const list = deps.listChannelVideos ?? listChannelVideos;
  const capture = deps.captureMeeting ?? captureMeetingCaptions;
  const captureAudio = deps.captureAudio ?? captureMeetingAudio;
  const storeAudio = deps.storeMeetingAudioArtifact ?? storeMeetingAudioArtifact;
  const storeTranscript = deps.storeMeetingTranscriptArtifact ?? storeMeetingTranscriptArtifact;
  const runTransaction = deps.withTransaction ?? withTransaction;
  const now = (deps.now ?? (() => new Date()))();
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
    caption_path: string | null; caption_format: string | null; caption_sha256: string | null;
    caption_captured_at: string | null; ended_at: string | null; capture_disposition: "provisional" | "final" | null;
    duration_seconds: number | null; caption_revision_timestamp: number | null;
    revision_count: number | null; settled_under_churn: boolean | null; last_revision_at: string | null;
  }>("select video_id,channel_url,title,published,status,failure_reason,caption_path,caption_format,caption_sha256,caption_captured_at,ended_at,capture_disposition,duration_seconds,caption_revision_timestamp,audio_path,audio_format,audio_sha256,audio_bytes,audio_trigger_reason,revision_count,settled_under_churn,last_revision_at from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  const captured: MeetingCaptureRecord[] = records.map((r) => ({
    videoId: r.video_id, channelUrl: r.channel_url, title: r.title, published: r.published,
    status: r.status, failureReason: r.failure_reason, captionPath: r.caption_path,
    captionFormat: r.caption_format, captionSha256: r.caption_sha256, captionCapturedAt: r.caption_captured_at,
    endedAt: r.ended_at, captureDisposition: r.capture_disposition ?? r.status === "captured" ? "final" : undefined,
    durationSeconds: r.duration_seconds, captionRevisionTimestamp: r.caption_revision_timestamp,
    revisionCount: r.revision_count ?? 0, settledUnderChurn: r.settled_under_churn ?? false, lastRevisionAt: r.last_revision_at,
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
      // M-1: audio is required ONLY when captions are missing or unusable.
      if (requiresAudioFallback(result)) {
        const triggerReason = `Captions unavailable or rejected; audio fallback required. yt-dlp caption result: ${result.reason}`;
        let audio: AudioCaptureResult;
        try {
          audio = await captureAudio({ videoId: v.id, outputDir, archivePath, sleepRequests: 1 });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await recordCaptureFailure(sql, newsroomId, v, `audio fallback failed: ${reason}`);
          failures.push(`${v.title}: audio fallback failed: ${reason}`);
          continue;
        }
        if (!audio.ok) {
          const reason = `audio fallback failed: ${audio.reason}`;
          await recordCaptureFailure(sql, newsroomId, v, reason);
          failures.push(`${v.title}: ${reason}`);
          continue;
        }
        const audioEndedAt = computeEndedAt({ durationSeconds: audio.info.durationSeconds, videoTimestamp: audio.info.videoTimestamp });
        const audioDisposition = captureDisposition({ endedAt: audioEndedAt, now });
        try {
          await runTransaction(async (tx) => {
            const stored = await storeAudio(tx, {
              newsroomId, videoId: v.id, audioSourcePath: audio.audio.path,
              format: audio.audio.format, triggerReason, infoSourcePath: audio.infoPath,
            });
            await recordAudioCaptureSuccess(tx, newsroomId, v, channels[0]!.url, audio, audioEndedAt, audioDisposition, stored.id, triggerReason, stored.storagePath);
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await recordCaptureFailure(sql, newsroomId, v, reason);
          failures.push(`${v.title}: ${reason}`);
        }
        continue;
      }
      await recordCaptureFailure(sql, newsroomId, v, result.reason);
      failures.push(`${v.title}: ${result.reason}`);
      continue;
    }
    const endedAt = computeEndedAt({ durationSeconds: result.info.durationSeconds, videoTimestamp: result.info.videoTimestamp });
    const disposition = captureDisposition({ endedAt, now });
    try {
      await runTransaction(async (tx) => {
        await recordCaptureSuccess(tx, newsroomId, v, channels[0]!.url, result as Extract<CaptionCaptureResult, { ok: true }>, endedAt, disposition);
        await storeTranscript(tx, { newsroomId, videoId: v.id, parsed: result.parsed, infoSourcePath: result.infoPath });
        const section5 = await (deps.runSection5 ?? runSection5ForArtifact)(tx, { newsroomId, videoId: v.id, title: v.title, meetingDate: v.published, artifactId: Number((await tx.query<{ id: number }>("select id from meeting_transcript_artifacts where newsroom_id=$1 and video_id=$2 order by captured_at desc, id desc limit 1", [newsroomId, v.id]))[0]?.id ?? 0) });
        if (!section5.aligned && section5.unalignedLead) failures.push(section5.unalignedLead.leadWhy);
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
    caption_path: string | null; caption_format: string | null; caption_sha256: string | null;
    caption_captured_at: string | null; ended_at: string | null; capture_disposition: "provisional" | "final" | null;
    duration_seconds: number | null; caption_revision_timestamp: number | null;
    revision_count: number | null; settled_under_churn: boolean | null; last_revision_at: string | null;
  }>("select video_id,channel_url,title,published,status,failure_reason,caption_path,caption_format,caption_sha256,caption_captured_at,ended_at,capture_disposition,duration_seconds,caption_revision_timestamp,audio_path,audio_format,audio_sha256,audio_bytes,audio_trigger_reason,revision_count,settled_under_churn,last_revision_at from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  const finalRecords: MeetingCaptureRecord[] = refreshed.map((r) => ({
    videoId: r.video_id, channelUrl: r.channel_url, title: r.title, published: r.published,
    status: r.status, failureReason: r.failure_reason, captionPath: r.caption_path,
    captionFormat: r.caption_format, captionSha256: r.caption_sha256, captionCapturedAt: r.caption_captured_at,
    endedAt: r.ended_at, captureDisposition: r.capture_disposition ?? (r.status === "captured" ? "final" : undefined),
    durationSeconds: r.duration_seconds, captionRevisionTimestamp: r.caption_revision_timestamp,
    revisionCount: r.revision_count ?? 0, settledUnderChurn: r.settled_under_churn ?? false, lastRevisionAt: r.last_revision_at,
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

export type ProvisionalRecheckResult = {
  checked: number;
  revised: number;
  settled: number;
  failures: string[];
};

/**
 * Provisional re-check (Slice 4 integration).
 *
 * Runs on every scan after awareness. Only captures whose disposition is
 * provisional and whose last check is at least the cadence gap old are
 * re-captured. Revision detection precedence is hash, then revision timestamp,
 * then duration. Two unchanged checks separated in time settle a capture;
 * the 48-hour ceiling settles it anyway and records settled_under_churn. A
 * revision after final records a revision without re-provisioning.
 */
export async function recheckProvisionalMeetings(
  sql: Sql,
  newsroomId: number,
  deps: MeetingAwarenessDeps = {},
): Promise<ProvisionalRecheckResult> {
  const capture = deps.captureMeeting ?? captureMeetingCaptions;
  const storeTranscript = deps.storeMeetingTranscriptArtifact ?? storeMeetingTranscriptArtifact;
  const runTransaction = deps.withTransaction ?? withTransaction;
  const now = (deps.now ?? (() => new Date()))();
  const failures: string[] = [];
  const rows = await sql.query<{
    video_id: string; title: string; published: string; caption_path: string | null;
    caption_sha256: string | null; capture_disposition: "provisional" | "final" | null;
    consecutive_unchanged: number | null; last_checked_at: string | null;
    captured_at: string | null; duration_seconds: number | null;
    caption_revision_timestamp: number | null; revision_count: number | null;
  }>(
    "select video_id,title,published,caption_path,caption_sha256,capture_disposition,consecutive_unchanged,last_checked_at,captured_at,duration_seconds,caption_revision_timestamp,revision_count from meeting_capture_records where newsroom_id=$1 and status='captured' and capture_disposition='provisional'",
    [newsroomId],
  );
  let checked = 0;
  let revised = 0;
  let settled = 0;
  for (const row of rows) {
    if (!dueForRecheck({ status: row.capture_disposition ?? "final", lastCheckedAt: row.last_checked_at, now })) continue;
    checked += 1;
    const archivePath = meetingArchivePath(newsroomId);
    const outputDir = join(meetingCaptionDir(newsroomId), row.video_id);
    let result: CaptionCaptureResult;
    try {
      result = await capture({ videoId: row.video_id, outputDir, archivePath, sleepSubtitles: 2, sleepRequests: 1 });
    } catch (error) {
      failures.push(`${row.title}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!result.ok) {
      failures.push(`${row.title}: ${result.reason}`);
      continue;
    }
    const signal = detectRevision({
      priorSha256: row.caption_sha256,
      nextSha256: result.parsed.sha256,
      priorRevisionTimestamp: row.caption_revision_timestamp,
      nextRevisionTimestamp: result.info.captionRevisionTimestamp,
      priorDuration: row.duration_seconds,
      nextDuration: result.info.durationSeconds,
    });
    const state = nextCheckState({
      status: row.capture_disposition ?? "final",
      consecutiveUnchanged: row.consecutive_unchanged ?? 0,
      lastCheckedAt: row.last_checked_at,
      firstCapturedAt: row.captured_at ?? now.toISOString(),
      now,
      changed: signal != null,
    });
    if (signal) revised += 1;
    if (state.settled) settled += 1;
    try {
      await runTransaction(async (tx) => {
        const priorArtifacts = await tx.query<{ id: number }>(
          "select id from meeting_transcript_artifacts where newsroom_id=$1 and video_id=$2 order by captured_at desc, id desc limit 1",
          [newsroomId, row.video_id],
        );
        const priorArtifactId = priorArtifacts[0]?.id ?? null;
        const stored = await storeTranscript(tx, { newsroomId, videoId: row.video_id, parsed: result.parsed, infoSourcePath: result.infoPath });
        const section5 = await (deps.runSection5 ?? runSection5ForArtifact)(tx, { newsroomId, videoId: row.video_id, title: row.title, meetingDate: row.published, artifactId: stored.id });
        if (!section5.aligned && section5.unalignedLead) failures.push(section5.unalignedLead.leadWhy);
        if (signal) {
          await tx.query(
            "insert into meeting_transcript_revisions(newsroom_id,video_id,artifact_id,prior_artifact_id,revision_signal,prior_sha256,new_sha256) values($1,$2,$3,$4,$5,$6,$7)",
            [newsroomId, row.video_id, stored.id, priorArtifactId, signal, row.caption_sha256, result.parsed.sha256],
          );
        }
        await tx.query(
          `update meeting_capture_records set
             caption_sha256=$1, caption_path=$2, caption_format=$3, caption_revision_timestamp=$4,
             duration_seconds=$5, capture_disposition=$6, consecutive_unchanged=$7, last_checked_at=now(),
             settled_under_churn=$8, revision_count=$9, last_revision_at=$10, updated_at=now()
           where newsroom_id=$11 and video_id=$12`,
          [
            result.parsed.sha256, result.parsed.sourcePath, result.parsed.format,
            result.info.captionRevisionTimestamp, result.info.durationSeconds,
            state.status, state.consecutiveUnchanged, state.settledUnderChurn,
            (row.revision_count ?? 0) + (signal ? 1 : 0),
            signal ? now.toISOString() : null, newsroomId, row.video_id,
          ],
        );
      });
      if (signal && row.caption_sha256) {
        await applyDraftRevision(sql, {
          newsroomId,
          videoId: row.video_id,
          previousSha256: row.caption_sha256,
          nextSha256: result.parsed.sha256,
        });
      }
    } catch (error) {
      failures.push(`${row.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { checked, revised, settled, failures };
}
