import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Sql } from "../db.ts";
import { withTransaction } from "../db.ts";
import { listChannelVideos, pickMeetingVideos, youtubeCaptureReadiness, type ListedVideo, type YoutubeCaptureReadiness } from "./youtube.ts";
import { captureMeetingCaptions, captureMeetingAudio, requiresAudioFallback, type CaptionCaptureFailure, type CaptionCaptureResult, type AudioCaptureResult } from "./meeting-capture-ytdlp.ts";
import { storeMeetingAudioArtifact } from "./meeting-audio-artifacts.ts";
import { computeEndedAt, wholeDurationSeconds } from "./meeting-capture-info.ts";
import { applyDraftRevision, captureDisposition, detectRevision, dueForRecheck, nextCheckState } from "./meeting-revision.ts";
import { storeMeetingTranscriptArtifact } from "./meeting-transcript-artifacts.ts";
import { runSection5ForArtifact } from "./meeting-story-section5-run.ts";
import { fileMeetingLead } from "./meeting-lead.ts";
import { capsFromSettings, checkDurationCap, checkSizeCap, type CaptureCaps } from "./meeting-capture-caps.ts";
import { lockMeetingRevisionForCapture } from "./meeting-revision-lock.ts";
import { flagPublishedArticlesForTranscriptRevision } from "./meeting-article-revision.ts";

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
  /** Injectable to test the metadata-only preflight without contacting YouTube. */
  captureReadiness?: (videoId: string) => Promise<YoutubeCaptureReadiness>;
  /** Injectable path preparation keeps readiness tests away from real data roots. */
  prepareCapturePaths?: typeof prepareMeetingCapturePaths;
  captureMeeting?: (input: { videoId: string; outputDir: string; archivePath: string; sleepSubtitles?: number; sleepRequests?: number; resume?: boolean }) => Promise<CaptionCaptureResult | CaptionCaptureFailure>;
  captureAudio?: (input: { videoId: string; outputDir: string; archivePath: string; sleepRequests?: number; resume?: boolean }) => Promise<AudioCaptureResult>;
  storeMeetingAudioArtifact?: typeof storeMeetingAudioArtifact;
  storeMeetingTranscriptArtifact?: typeof storeMeetingTranscriptArtifact;
  runSection5?: typeof runSection5ForArtifact;
  withTransaction?: typeof withTransaction;
  applyCapturedMeetingTranscript?: typeof applyCapturedMeetingTranscript;
  now?: () => Date;
};

export function namedMeetingFailures(
  listingFailures: string[],
  failedRecords: MeetingCaptureRecord[],
): string[] {
  return [...new Set([
    ...listingFailures,
    ...failedRecords.map((record) => `${record.title}: ${record.failureReason ?? "capture failed"}`),
  ])];
}

const EMPTY_RESULT: MeetingAwarenessResult = {
  configured: false, found: [], uncaptured: [], captured: [], failed: [],
  coverageLine: "", failures: [], archivePath: null,
};

export function meetingRuntimeRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  // The Windows installer owns TOWNREPORTER_DATA_ROOT. DATA_DIR is retained
  // only for older source deployments that already set it.
  return env.TOWNREPORTER_DATA_ROOT || env.TOWNREPORTER_DATA_DIR || cwd;
}
export function meetingArchivePath(newsroomId: number, root = meetingRuntimeRoot()): string {
  return join(root, "meeting-capture", `newsroom-${newsroomId}`, "yt-dlp-archive.txt");
}
export function meetingCaptionDir(newsroomId: number, root = meetingRuntimeRoot()): string {
  return join(root, "meeting-captions", `newsroom-${newsroomId}`);
}
export function storedCaptureDisposition(
  stored: "provisional" | "final" | null,
  status: MeetingCaptureStatus,
): "provisional" | "final" | undefined {
  return stored ?? (status === "captured" ? "final" : undefined);
}
export function prepareMeetingCapturePaths(newsroomId: number, videoId: string): { archivePath: string; outputDir: string } {
  const archivePath = meetingArchivePath(newsroomId);
  const outputDir = join(meetingCaptionDir(newsroomId), videoId);
  mkdirSync(dirname(archivePath), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  return { archivePath, outputDir };
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

function safeFileSize(path: string): number | null {
  try { return statSync(path).size; } catch { return null; }
}

/** N-5: a cap refusal is recorded with its named reason, not a silent truncation. */
async function recordCaptureRefusal(sql: Sql, newsroomId: number, video: ListedVideo, reason: string): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,failure_reason,refused_reason) values($1,$2,$3,$4,$5,'failed',$6,$6) on conflict(newsroom_id,video_id) do update set status='failed',failure_reason=excluded.failure_reason,refused_reason=excluded.refused_reason,updated_at=now()",
    [newsroomId, video.id, video.url, video.title, video.published ?? "", reason],
  );
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
       channel_url=excluded.channel_url,title=excluded.title,published=excluded.published,
       status='captured',captured_at=now(),failure_reason=null,ended_at=excluded.ended_at,
       capture_disposition=excluded.capture_disposition,duration_seconds=excluded.duration_seconds,
       audio_path=excluded.audio_path,audio_format=excluded.audio_format,audio_sha256=excluded.audio_sha256,
       audio_bytes=excluded.audio_bytes,audio_captured_at=now(),audio_trigger_reason=excluded.audio_trigger_reason,
       updated_at=now()`,
    [newsroomId, video.id, channelUrl, video.title, video.published ?? "", endedAt, disposition, wholeDurationSeconds(result.info.durationSeconds), storedPath, result.audio.format, result.audio.sha256, result.audio.byteSize, triggerReason],
  );
}


/**
 * N-5 Continue: find the resumable partial yt-dlp left behind for a video.
 *
 * yt-dlp writes `<id>.<ext>.part` next to the output template and continues it
 * on the next run. Stop SIGKILLs the child mid-write, so the partial survives —
 * but nothing recorded that it exists. Without this the desk could not tell
 * "stopped, nothing to resume" from "stopped, a partial is waiting", and a
 * re-run started from zero.
 */
export function findResumablePartial(outputDir: string, videoId: string): string | null {
  try {
    const entries = readdirSync(outputDir);
    const hit = entries.find((name) => name.startsWith(`${videoId}.`) && name.endsWith(".part"));
    if (!hit) return null;
    const full = join(outputDir, hit);
    return statSync(full).size > 0 ? full : null;
  } catch {
    return null;
  }
}

/** N-5: a capture the operator stopped is recorded as stopped, not failed. */
async function recordCaptureStopped(sql: Sql, newsroomId: number, video: ListedVideo, reason: string, partialPath: string | null): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,failure_reason,partial_path) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(newsroom_id,video_id) do update set status=excluded.status,failure_reason=excluded.failure_reason,partial_path=excluded.partial_path,updated_at=now()",
    [newsroomId, video.id, video.url, video.title, video.published ?? "", "stopped", reason, partialPath],
  );
}

async function recordCaptureFailure(sql: Sql, newsroomId: number, video: ListedVideo, reason: string): Promise<void> {
  await sql.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,failure_reason) values($1,$2,$3,$4,$5,'failed',$6) on conflict(newsroom_id,video_id) do update set status='failed',failure_reason=excluded.failure_reason,updated_at=now()",
    [newsroomId, video.id, video.url, video.title, video.published ?? "", reason],
  );
}
/**
 * N-5 Continue: resume captures the operator stopped, in place.
 *
 * A stopped capture is not terminal. yt-dlp left a `.part` file behind and will
 * continue it, and meeting_capture_records is unique (newsroom_id, video_id) —
 * so a resume UPDATES the existing record rather than creating a second one.
 *
 * Only records with a recorded resumable partial are attempted: a stopped
 * capture with nothing on disk would re-download from the start, which is a
 * fresh attempt, not a resume, and is reported as such instead of silently
 * presented as one.
 */
export async function resumeStoppedMeetings(
  sql: Sql,
  newsroomId: number,
  deps: MeetingAwarenessDeps = {},
): Promise<{ resumed: number; skipped: number; failures: string[]; coverageLine: string }> {
  const stopped = await sql<{ video_id: string; channel_url: string; title: string; published: string; partial_path: string | null }>`
    select video_id, channel_url, title, published, partial_path
      from meeting_capture_records
     where newsroom_id = ${newsroomId} and status = 'stopped'
     order by updated_at asc
  `;
  const failures: string[] = [];
  let resumed = 0;
  let skipped = 0;
  const applyCaptured = deps.applyCapturedMeetingTranscript ?? applyCapturedMeetingTranscript;
  const ownerUserId = stopped.length
    ? (await sql.query<{ user_id: string }>(
        "select user_id from newsroom_members where newsroom_id=$1 and role='owner' limit 1",
        [newsroomId],
      ))[0]?.user_id ?? ""
    : "";
  for (const record of stopped) {
    if (!record.partial_path || !existsSync(record.partial_path)) {
      skipped += 1;
      failures.push(`${record.title}: stopped with no resumable partial on disk; a new capture is required`);
      continue;
    }
    const capture = deps.captureMeeting ?? captureMeetingCaptions;
    // Resume in the directory that owns the recorded .part file. Initial
    // captures use a per-video directory; pointing yt-dlp at the newsroom root
    // would start a fresh file while the real partial sat one level below.
    const outputDir = dirname(record.partial_path);
    const result = await capture({ videoId: record.video_id, outputDir, archivePath: meetingArchivePath(newsroomId), resume: true });
    if (result.ok) {
      try {
        const applied = await applyCaptured(sql, {
          newsroomId,
          userId: ownerUserId,
          video: {
            id: record.video_id,
            channelUrl: record.channel_url,
            title: record.title,
            published: record.published,
          },
          result: result as Extract<CaptionCaptureResult, { ok: true }>,
        }, deps);
        await sql.query(
          "update meeting_capture_records set partial_path = null, resumed_at = now(), updated_at = now() where newsroom_id = $1 and video_id = $2",
          [newsroomId, record.video_id],
        );
        failures.push(...applied.warnings);
        resumed += 1;
      } catch (error) {
        failures.push(`${record.title}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    failures.push(`${record.title}: ${result.reason}`);
  }
  const coverageLine = `meetings resume: ${resumed} resumed, ${skipped} skipped (no partial), ${failures.length} failed`;
  return { resumed, skipped, failures, coverageLine };
}

export async function runMeetingAwareness(sql: Sql, newsroomId: number, deps: MeetingAwarenessDeps = {}): Promise<MeetingAwarenessResult> {
  // N-1: the operator enable/disable control. Disabled returns the same no-op
  // result as an unconfigured newsroom, without deleting any configuration.
  const meetingSettings = await sql.query<{ enabled: boolean | null }>("select enabled from meeting_capture_settings where newsroom_id=$1", [newsroomId]);
  if (meetingSettings.length && meetingSettings[0]!.enabled === false) return EMPTY_RESULT;
  const capRows = await sql.query<{ duration_cap_seconds: number | null; size_cap_bytes: number | null }>(
    "select duration_cap_seconds,size_cap_bytes from meeting_capture_settings where newsroom_id=$1", [newsroomId],
  );
  const caps: CaptureCaps = capsFromSettings(capRows[0]);
  const channels = await loadMeetingPriority(sql, newsroomId);
  if (!channels.length) return EMPTY_RESULT;
  const list = deps.listChannelVideos ?? listChannelVideos;
  const captureReadiness = deps.captureReadiness ?? youtubeCaptureReadiness;
  const prepareCapturePaths = deps.prepareCapturePaths ?? prepareMeetingCapturePaths;
  const capture = deps.captureMeeting ?? captureMeetingCaptions;
  const captureAudio = deps.captureAudio ?? captureMeetingAudio;
  const storeAudio = deps.storeMeetingAudioArtifact ?? storeMeetingAudioArtifact;
  const runTransaction = deps.withTransaction ?? withTransaction;
  const applyCaptured = deps.applyCapturedMeetingTranscript ?? applyCapturedMeetingTranscript;
  const now = (deps.now ?? (() => new Date()))();
  type ListedMeetingVideo = ListedVideo & { channelUrl: string };
  const foundById = new Map<string, ListedMeetingVideo>();
  const failures: string[] = [];
  for (const channel of channels) {
    try {
      const listed = await list(channel.url);
      for (const video of pickMeetingVideos(listed, 50)) {
        // Channel priority is authoritative when the same upload appears in
        // more than one configured feed. Preserve the actual first source;
        // never relabel every video as if it came from channels[0].
        if (!foundById.has(video.id)) foundById.set(video.id, { ...video, channelUrl: channel.url });
      }
    } catch (e) {
      failures.push(`${channel.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const found = [...foundById.values()];
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
    endedAt: r.ended_at, captureDisposition: storedCaptureDisposition(r.capture_disposition, r.status),
    durationSeconds: r.duration_seconds, captionRevisionTimestamp: r.caption_revision_timestamp,
    revisionCount: r.revision_count ?? 0, settledUnderChurn: r.settled_under_churn ?? false, lastRevisionAt: r.last_revision_at,
  }));
  // The database is the capture source of truth. Reconcile the yt-dlp cache
  // BEFORE asking yt-dlp to capture anything; doing this only after the pass
  // lets a stale file suppress a meeting the database says is uncaptured.
  const archivePath = meetingArchivePath(newsroomId);
  const beforeCapture = reconcileArchive(await readArchive(archivePath), captured);
  if (beforeCapture.changed) regenerateArchive(archivePath, captured);
  const known = new Set(captured.filter((r) => r.status === "captured").map((r) => r.videoId));
  const uncaptured = found.filter((v) => !known.has(v.id));
  const readyToCapture: ListedMeetingVideo[] = [];
  let skippedLiveOrUpcoming = 0;
  let waitingForMetadata = 0;
  for (const v of uncaptured) {
    // RSS and scheduled-stream listings often have no duration. Never start a
    // caption download (or its audio fallback) for those ambiguous entries
    // until player metadata or yt-dlp's metadata-only check confirms readiness.
    // Positive-duration entries retain the existing path and avoid extra probes.
    if (v.duration <= 0) {
      let readiness: YoutubeCaptureReadiness = "unknown";
      try { readiness = await captureReadiness(v.id); } catch { /* unknown is retryable below */ }
      if (readiness === "upcoming" || readiness === "live") {
        skippedLiveOrUpcoming += 1;
        continue;
      }
      if (readiness !== "ready") {
        waitingForMetadata += 1;
        continue;
      }
    }
    readyToCapture.push(v);
  }
  for (const v of readyToCapture) {
    const { archivePath, outputDir } = prepareCapturePaths(newsroomId, v.id);
    await sql.query(
      "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status) values($1,$2,$3,$4,$5,'not-captured') on conflict(newsroom_id,video_id) do update set channel_url=excluded.channel_url,title=excluded.title,published=excluded.published,updated_at=now()",
      [newsroomId, v.id, v.channelUrl, v.title, v.published ?? ""],
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
          const reason = audio.stopped ? audio.reason : `audio fallback failed: ${audio.reason}`;
          await (audio.stopped ? recordCaptureStopped(sql, newsroomId, v, audio.reason, findResumablePartial(outputDir, v.id)) : recordCaptureFailure(sql, newsroomId, v, reason));
          failures.push(`${v.title}: ${reason}`);
          continue;
        }
        // N-5 caps apply to the audio fallback too.
        const audioDurRefusal = checkDurationCap(audio.info.durationSeconds, caps);
        if (audioDurRefusal.refused) {
          await recordCaptureRefusal(sql, newsroomId, v, audioDurRefusal.reason);
          failures.push(`${v.title}: ${audioDurRefusal.reason}`);
          continue;
        }
        const audioSizeRefusal = checkSizeCap(audio.audio.byteSize, caps);
        if (audioSizeRefusal.refused) {
          await recordCaptureRefusal(sql, newsroomId, v, audioSizeRefusal.reason);
          failures.push(`${v.title}: ${audioSizeRefusal.reason}`);
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
            await recordAudioCaptureSuccess(tx, newsroomId, v, v.channelUrl, audio, audioEndedAt, audioDisposition, stored.id, triggerReason, stored.storagePath);
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await recordCaptureFailure(sql, newsroomId, v, reason);
          failures.push(`${v.title}: ${reason}`);
        }
        continue;
      }
      if (result.stopped) {
        await recordCaptureStopped(sql, newsroomId, v, result.reason, findResumablePartial(outputDir, v.id));
      } else {
        await recordCaptureFailure(sql, newsroomId, v, result.reason);
      }
      failures.push(`${v.title}: ${result.reason}`);
      continue;
    }
    // N-5 duration cap: refuse a meeting longer than the cap, with a recorded reason.
    const durRefusal = checkDurationCap(result.info.durationSeconds, caps);
    if (durRefusal.refused) {
      await recordCaptureRefusal(sql, newsroomId, v, durRefusal.reason);
      failures.push(`${v.title}: ${durRefusal.reason}`);
      continue;
    }
    // N-5 size cap: refuse a caption file larger than the cap.
    const captionSizeRefusal = checkSizeCap(safeFileSize(result.parsed.sourcePath), caps);
    if (captionSizeRefusal.refused) {
      await recordCaptureRefusal(sql, newsroomId, v, captionSizeRefusal.reason);
      failures.push(`${v.title}: ${captionSizeRefusal.reason}`);
      continue;
    }
    try {
      const ownerUserId = (await sql.query<{ user_id: string }>(
        "select user_id from newsroom_members where newsroom_id=$1 and role='owner' limit 1",
        [newsroomId],
      ))[0]?.user_id ?? "";
      const applied = await applyCaptured(sql, {
        newsroomId,
        userId: ownerUserId,
        video: { id: v.id, channelUrl: v.channelUrl, title: v.title, published: v.published ?? "" },
        result: result as Extract<CaptionCaptureResult, { ok: true }>,
        now,
      }, deps);
      failures.push(...applied.warnings);
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
    endedAt: r.ended_at, captureDisposition: storedCaptureDisposition(r.capture_disposition, r.status),
    durationSeconds: r.duration_seconds, captionRevisionTimestamp: r.caption_revision_timestamp,
    revisionCount: r.revision_count ?? 0, settledUnderChurn: r.settled_under_churn ?? false, lastRevisionAt: r.last_revision_at,
  }));
  const failed = finalRecords.filter((r) => r.status === "failed");
  const archiveText = await readArchive(archivePath);
  const reconciled = reconcileArchive(archiveText, finalRecords);
  if (reconciled.changed) regenerateArchive(archivePath, finalRecords);
  // Which reader found these videos is part of the receipt: "read with the
  // official API" and "read the public feed" fail in different ways, and an
  // editor looking at a short list needs to know which one they are looking at.
  const readBy = found.length
    ? found.every((v) => v.tab === "api")
      ? " (read with the official API)"
      : found.some((v) => v.tab === "api")
        ? " (read with the official API and the public feed)"
        : " (read from the public feed)"
    : "";
  const coverageLine = `meetings: ${found.length} found, ${finalRecords.filter((r) => r.status === "captured").length} captured, ${failed.length} failed${skippedLiveOrUpcoming ? `, ${skippedLiveOrUpcoming} live/upcoming skipped` : ""}${waitingForMetadata ? `, ${waitingForMetadata} waiting for status metadata (will retry)` : ""}${readBy}`;
  return {
    configured: true, found, uncaptured, captured: finalRecords, failed, coverageLine,
    failures: namedMeetingFailures(failures, failed),
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

type ExistingMeetingCapture = {
  video_id: string;
  channel_url: string;
  title: string;
  published: string;
  status: MeetingCaptureStatus;
  caption_sha256: string | null;
  capture_disposition: "provisional" | "final" | null;
  consecutive_unchanged: number | null;
  last_checked_at: string | null;
  captured_at: string | null;
  duration_seconds: number | null;
  caption_revision_timestamp: number | null;
  revision_count: number | null;
};

/**
 * Persist one successful caption capture through the canonical revision path.
 *
 * Scheduled rechecks and the editor's explicit "Force re-capture" control use
 * this same function. That is load-bearing: a manual button must not bypass the
 * shared publication lock, immutable artifact storage, alignment, lead filing,
 * draft notices, or post-publication review creation.
 */
export async function applyCapturedMeetingTranscript(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    video: { id: string; channelUrl: string; title: string; published: string };
    result: Extract<CaptionCaptureResult, { ok: true }>;
    forced?: boolean;
    now?: Date;
    /**
     * Unit R: this revision is speech-to-text, not the publisher's captions.
     * Both fields travel together into the artifact row so the desk can label
     * it for a reader and an editor can see which model read the audio.
     */
    sourceMethod?: string;
    provenance?: Record<string, unknown> | null;
  },
  deps: Pick<MeetingAwarenessDeps, "storeMeetingTranscriptArtifact" | "runSection5" | "withTransaction"> = {},
): Promise<{ revised: boolean; settled: boolean; artifactId: number; warnings: string[] }> {
  void sql; // The transaction owns the authoritative connection.
  const storeTranscript = deps.storeMeetingTranscriptArtifact ?? storeMeetingTranscriptArtifact;
  const runTransaction = deps.withTransaction ?? withTransaction;
  const now = input.now ?? new Date();
  /*
    Whole seconds, once, for the three things that read it: the integer column
    this is written to, the revision comparison, and `computeEndedAt`. See
    `wholeDurationSeconds` -- textflowkit reports a float and the column does not
    accept one, which is what the real run found.
  */
  const durationSeconds = wholeDurationSeconds(input.result.info.durationSeconds);
  const endedAt = computeEndedAt({
    durationSeconds,
    videoTimestamp: input.result.info.videoTimestamp,
  });
  const initialDisposition = captureDisposition({ endedAt, now });

  return runTransaction(async (tx) => {
    await tx.query(
      `insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status)
       values($1,$2,$3,$4,$5,'not-captured')
       on conflict(newsroom_id,video_id) do nothing`,
      [input.newsroomId, input.video.id, input.video.channelUrl, input.video.title, input.video.published],
    );
    await lockMeetingRevisionForCapture(tx, { newsroomId: input.newsroomId, videoId: input.video.id });
    const priorRows = await tx.query<ExistingMeetingCapture>(
      `select video_id,channel_url,title,published,status,caption_sha256,capture_disposition,
              consecutive_unchanged,last_checked_at,captured_at,duration_seconds,
              caption_revision_timestamp,revision_count
         from meeting_capture_records where newsroom_id=$1 and video_id=$2`,
      [input.newsroomId, input.video.id],
    );
    const prior = priorRows[0]!;
    const hadCapture = prior.status === "captured" && Boolean(prior.caption_sha256);
    const signal = hadCapture
      ? detectRevision({
          priorSha256: prior.caption_sha256,
          nextSha256: input.result.parsed.sha256,
          priorRevisionTimestamp: prior.caption_revision_timestamp,
          nextRevisionTimestamp: input.result.info.captionRevisionTimestamp,
          priorDuration: prior.duration_seconds,
          nextDuration: durationSeconds,
        })
      : null;
    const state = hadCapture
      ? nextCheckState({
          status: prior.capture_disposition ?? initialDisposition,
          consecutiveUnchanged: prior.consecutive_unchanged ?? 0,
          lastCheckedAt: prior.last_checked_at,
          firstCapturedAt: prior.captured_at ?? now.toISOString(),
          now,
          changed: signal != null,
        })
      : {
          status: initialDisposition,
          consecutiveUnchanged: 0,
          settled: false,
          settledUnderChurn: false,
          revisionRecorded: false,
        };
    const priorArtifacts = await tx.query<{ id: number }>(
      "select id from meeting_transcript_artifacts where newsroom_id=$1 and video_id=$2 order by captured_at desc, id desc limit 1",
      [input.newsroomId, input.video.id],
    );
    const priorArtifactId = priorArtifacts[0]?.id ?? null;
    const stored = await storeTranscript(tx, {
      newsroomId: input.newsroomId,
      videoId: input.video.id,
      parsed: input.result.parsed,
      infoSourcePath: input.result.infoPath,
      sourceMethod: input.sourceMethod,
      provenance: input.provenance ?? null,
    });
    const section5 = await (deps.runSection5 ?? runSection5ForArtifact)(tx, {
      newsroomId: input.newsroomId,
      videoId: input.video.id,
      title: input.video.title,
      meetingDate: input.video.published,
      artifactId: stored.id,
    });
    const warnings = section5.aligned || !section5.unalignedLead ? [] : [section5.unalignedLead.leadWhy];
    if ((!hadCapture || signal) && section5.aligned && section5.citations.length) {
      await fileMeetingLead(tx, {
        newsroomId: input.newsroomId,
        userId: input.userId,
        videoId: input.video.id,
        title: input.video.title,
        meetingDate: input.video.published || null,
        topic: "council",
        sourceUrls: [`https://www.youtube.com/watch?v=${input.video.id}`],
        items: section5.items,
        establishedVotes: section5.voteCount,
        votes: section5.votes.map((vote) => ({
          item: vote.item, established: vote.established, motion: vote.motion, mover: vote.mover,
          seconder: vote.seconder, tally: vote.tally, result: vote.result, source: vote.source,
        })),
        citations: section5.citations.map((citation) => ({
          item: citation.item, segmentIndex: citation.segmentIndex,
          timestampSeconds: citation.timestampSeconds, excerpt: citation.excerpt,
          captionSha256: citation.captionSha256,
        })),
        artifactId: stored.id,
      });
    }
    if (signal) {
      await tx.query(
        "insert into meeting_transcript_revisions(newsroom_id,video_id,artifact_id,prior_artifact_id,revision_signal,prior_sha256,new_sha256) values($1,$2,$3,$4,$5,$6,$7)",
        [input.newsroomId, input.video.id, stored.id, priorArtifactId, signal, prior.caption_sha256, input.result.parsed.sha256],
      );
      if (prior.caption_sha256) {
        await applyDraftRevision(tx, {
          newsroomId: input.newsroomId,
          videoId: input.video.id,
          previousSha256: prior.caption_sha256,
          nextSha256: input.result.parsed.sha256,
        });
        if (priorArtifactId != null) {
          await flagPublishedArticlesForTranscriptRevision(tx, {
            newsroomId: input.newsroomId,
            videoId: input.video.id,
            priorArtifactId,
            currentArtifactId: stored.id,
            reason: signal,
          });
        }
      }
    }
    await tx.query(
      `update meeting_capture_records set
       channel_url=$1,title=$2,published=$3,status='captured',failure_reason=null,
         captured_at=coalesce(captured_at,$19),caption_path=$4,caption_format=$5,
         caption_sha256=$6,caption_captured_at=$19,ended_at=$7,
         caption_revision_timestamp=$8,duration_seconds=$9,capture_disposition=$10,
         consecutive_unchanged=$11,last_checked_at=$19,settled_under_churn=$12,
         revision_count=$13,last_revision_at=$14,
         forced_recapture=$15,forced_recapture_at=case when $15 then $19 else forced_recapture_at end,
         prior_caption_sha256=case when $15 then $16 else prior_caption_sha256 end,updated_at=$19
       where newsroom_id=$17 and video_id=$18`,
      [
        input.video.channelUrl, input.video.title, input.video.published,
        stored.storagePath, input.result.parsed.format, input.result.parsed.sha256, endedAt,
        input.result.info.captionRevisionTimestamp, durationSeconds,
        state.status, state.consecutiveUnchanged, state.settledUnderChurn,
        (prior.revision_count ?? 0) + (signal ? 1 : 0), signal ? now.toISOString() : null,
        input.forced === true, prior.caption_sha256, input.newsroomId, input.video.id, now.toISOString(),
      ],
    );
    return { revised: signal != null, settled: state.settled, artifactId: stored.id, warnings };
  });
}

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
  const now = (deps.now ?? (() => new Date()))();
  const failures: string[] = [];
  const rows = await sql.query<{
    video_id: string; channel_url: string; title: string; published: string; caption_path: string | null;
    caption_sha256: string | null; capture_disposition: "provisional" | "final" | null;
    consecutive_unchanged: number | null; last_checked_at: string | null;
    captured_at: string | null; duration_seconds: number | null;
    caption_revision_timestamp: number | null; revision_count: number | null;
  }>(
    "select video_id,channel_url,title,published,caption_path,caption_sha256,capture_disposition,consecutive_unchanged,last_checked_at,captured_at,duration_seconds,caption_revision_timestamp,revision_count from meeting_capture_records where newsroom_id=$1 and status='captured' and capture_disposition='provisional'",
    [newsroomId],
  );
  let checked = 0;
  let revised = 0;
  let settled = 0;
  for (const row of rows) {
    if (!dueForRecheck({ status: row.capture_disposition ?? "final", lastCheckedAt: row.last_checked_at, now })) continue;
    checked += 1;
    const { archivePath, outputDir } = prepareMeetingCapturePaths(newsroomId, row.video_id);
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
    try {
      const userId = (await sql.query<{ user_id: string }>(
        "select user_id from newsroom_members where newsroom_id=$1 and role='owner' limit 1",
        [newsroomId],
      ))[0]?.user_id ?? "";
      const applied = await applyCapturedMeetingTranscript(sql, {
        newsroomId,
        userId,
        video: { id: row.video_id, channelUrl: row.channel_url, title: row.title, published: row.published },
        result: result as Extract<CaptionCaptureResult, { ok: true }>,
        now,
      }, deps);
      if (applied.revised) revised += 1;
      if (applied.settled) settled += 1;
      failures.push(...applied.warnings);
    } catch (error) {
      failures.push(`${row.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { checked, revised, settled, failures };
}
