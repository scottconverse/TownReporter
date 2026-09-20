import { mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Sql } from "../db.ts";
import type { ParsedCaptionFile } from "./caption-parse.ts";

export type MeetingRetentionMode = "media" | "audio-only" | "transcript-only";
export type MeetingTranscriptSegment = {
  segmentIndex: number; startSeconds: number; endSeconds: number;
  item: string | null; excerpt: string; captionSha256: string;
};
export type MeetingTranscriptArtifact = {
  id: number; newsroomId: number; videoId: string; artifactType: "transcript";
  storagePath: string; format: string; sha256: string; capturedAt: string;
  sourceMethod: string; retentionMode: MeetingRetentionMode;
};
export type ResolvedTranscriptCitation = {
  artifactId: number; segmentIndex: number; item: string | null;
  timestampSeconds: number; endSeconds: number; excerpt: string;
  captionSha256: string; storagePath: string;
};

export function resolveMeetingStorageRoot(configured: string | null | undefined): string {
  if (!configured || !configured.trim()) {
    throw new Error("Meeting transcript storage root is not configured; refusing to write inside the app directory.");
  }
  const value = configured.trim();
  if (!isAbsolute(value)) throw new Error(`Meeting transcript storage root must be absolute: ${value}`);
  return resolve(value);
}

export function retentionPlan(mode: MeetingRetentionMode): {
  retentionMode: MeetingRetentionMode; keepsTranscript: boolean;
  automaticDeletion: false; allows: MeetingRetentionMode[];
} {
  return {
    retentionMode: mode, keepsTranscript: true, automaticDeletion: false,
    allows: mode === "media" ? ["media", "audio-only", "transcript-only"] : [mode],
  };
}

export function parseTranscriptSegments(text: string, captionSha256: string): MeetingTranscriptSegment[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => ({
    segmentIndex: index, startSeconds: index * 4, endSeconds: index * 4 + 4,
    item: null, excerpt: line, captionSha256,
  }));
}

export function resolveTranscriptCitation(input: {
  artifact: Pick<MeetingTranscriptArtifact, "id" | "storagePath" | "sha256">;
  segments: MeetingTranscriptSegment[]; segmentIndex?: number; timestampSeconds?: number;
}): ResolvedTranscriptCitation {
  let segment: MeetingTranscriptSegment | undefined;
  if (input.segmentIndex != null) {
    segment = input.segments.find((s) => s.segmentIndex === input.segmentIndex);
  } else if (input.timestampSeconds != null) {
    segment = input.segments.find((s) => input.timestampSeconds! >= s.startSeconds && input.timestampSeconds! < s.endSeconds)
      ?? [...input.segments].reverse().find((s) => input.timestampSeconds! >= s.startSeconds);
  }
  if (!segment) throw new Error("No transcript segment matches that citation.");
  return {
    artifactId: input.artifact.id, segmentIndex: segment.segmentIndex, item: segment.item,
    timestampSeconds: segment.startSeconds, endSeconds: segment.endSeconds,
    excerpt: segment.excerpt, captionSha256: segment.captionSha256 || input.artifact.sha256,
    storagePath: input.artifact.storagePath,
  };
}

async function loadRetentionMode(sql: Sql, newsroomId: number): Promise<MeetingRetentionMode> {
  const rows = await sql.query<{ retention_mode: MeetingRetentionMode }>(
    "select retention_mode from meeting_capture_settings where newsroom_id=$1", [newsroomId],
  );
  return rows[0]?.retention_mode ?? "transcript-only";
}

async function loadStorageRoot(sql: Sql, newsroomId: number): Promise<string> {
  const rows = await sql.query<{ storage_root: string | null }>(
    "select storage_root from meeting_capture_settings where newsroom_id=$1", [newsroomId],
  );
  return resolveMeetingStorageRoot(rows[0]?.storage_root ?? null);
}

/**
 * Pure writer: persists the artifact and its segments using the SQL handle it is
 * given. It never opens its own transaction. Callers that need the capture
 * record, the artifact, and the segments to commit atomically pass a
 * transaction-scoped handle (see runMeetingAwareness).
 */
export type StoredInfoSidecar = {
  infoPath: string | null;
  infoSha256: string | null;
  infoBytes: number | null;
  infoMissingReason: string | null;
};

/**
 * Copies the yt-dlp info sidecar next to the transcript artifact and records its
 * own path, byte size, and SHA-256. A missing sidecar is recorded explicitly
 * rather than silently succeeding.
 */
export function storeMeetingInfoSidecar(sourceInfoPath: string | null | undefined, targetDir: string): StoredInfoSidecar {
  if (!sourceInfoPath) {
    return { infoPath: null, infoSha256: null, infoBytes: null, infoMissingReason: "yt-dlp did not write an info sidecar for this capture" };
  }
  if (!existsSync(sourceInfoPath)) {
    return { infoPath: null, infoSha256: null, infoBytes: null, infoMissingReason: "info sidecar missing at storage time: " + sourceInfoPath };
  }
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, "info.json");
  const bytes = readFileSync(sourceInfoPath);
  copyFileSync(sourceInfoPath, targetPath);
  return {
    infoPath: targetPath,
    infoSha256: createHash("sha256").update(bytes).digest("hex"),
    infoBytes: statSync(targetPath).size,
    infoMissingReason: null,
  };
}

export async function storeMeetingTranscriptArtifact(
  sql: Sql,
  input: { newsroomId: number; videoId: string; parsed: ParsedCaptionFile; infoSourcePath?: string | null; sourceMethod?: string },
): Promise<MeetingTranscriptArtifact> {
  const storageRoot = await loadStorageRoot(sql, input.newsroomId);
  const retentionMode = await loadRetentionMode(sql, input.newsroomId);
  retentionPlan(retentionMode);
  const targetDir = join(storageRoot, `newsroom-${input.newsroomId}`, input.videoId);
  mkdirSync(targetDir, { recursive: true });
  const extension = input.parsed.format === "srv3" ? ".srv3" : ".vtt";
  const targetPath = join(targetDir, `${input.videoId}.en${extension}`);
  if (resolve(input.parsed.sourcePath) !== resolve(targetPath)) {
    if (!existsSync(input.parsed.sourcePath)) throw new Error(`Captured caption file is missing: ${input.parsed.sourcePath}`);
    copyFileSync(input.parsed.sourcePath, targetPath);
  }
  const sidecar = storeMeetingInfoSidecar(input.infoSourcePath, targetDir);
  const segments = parseTranscriptSegments(input.parsed.text, input.parsed.sha256);
  const rows = await sql.query<{ id: number; captured_at: string }>(
    `insert into meeting_transcript_artifacts
       (newsroom_id,video_id,artifact_type,storage_path,format,sha256,captured_at,source_method,retention_mode,info_path,info_sha256,info_bytes,info_missing_reason)
     values ($1,$2,'transcript',$3,$4,$5,now(),$6,$7,$8,$9,$10,$11)
     on conflict (newsroom_id,video_id,artifact_type,sha256)
     do update set storage_path=excluded.storage_path,format=excluded.format,source_method=excluded.source_method,
       retention_mode=excluded.retention_mode,info_path=excluded.info_path,info_sha256=excluded.info_sha256,info_bytes=excluded.info_bytes,info_missing_reason=excluded.info_missing_reason,updated_at=now()
     returning id,captured_at::text as captured_at`,
    [input.newsroomId, input.videoId, targetPath, input.parsed.format, input.parsed.sha256, input.sourceMethod ?? "yt-dlp-captions", retentionMode, sidecar.infoPath, sidecar.infoSha256, sidecar.infoBytes, sidecar.infoMissingReason],
  );
  const artifactId = rows[0]?.id;
  if (!artifactId) throw new Error("Meeting transcript artifact insert returned no id.");
  for (const segment of segments) {
    await sql.query(
      `insert into meeting_transcript_segments
         (artifact_id,segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (artifact_id,segment_index)
       do update set start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds,
         item=excluded.item,excerpt=excluded.excerpt,caption_sha256=excluded.caption_sha256`,
      [artifactId, segment.segmentIndex, segment.startSeconds, segment.endSeconds, segment.item, segment.excerpt, segment.captionSha256],
    );
  }
  return {
    id: artifactId, newsroomId: input.newsroomId, videoId: input.videoId, artifactType: "transcript",
    storagePath: targetPath, format: input.parsed.format, sha256: input.parsed.sha256,
    capturedAt: rows[0]!.captured_at, sourceMethod: input.sourceMethod ?? "yt-dlp-captions", retentionMode,
  };
}

export async function loadTranscriptCitation(
  sql: Sql, input: { artifactId: number; segmentIndex?: number; timestampSeconds?: number },
): Promise<ResolvedTranscriptCitation> {
  const artifacts = await sql.query<{ id: number; storage_path: string; sha256: string }>(
    "select id,storage_path,sha256 from meeting_transcript_artifacts where id=$1", [input.artifactId],
  );
  const artifact = artifacts[0];
  if (!artifact) throw new Error("Meeting transcript artifact not found.");
  const segments = await sql.query<{
    segment_index: number; start_seconds: number; end_seconds: number;
    item: string | null; excerpt: string; caption_sha256: string;
  }>(
    "select segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256 from meeting_transcript_segments where artifact_id=$1 order by segment_index",
    [input.artifactId],
  );
  return resolveTranscriptCitation({
    artifact: { id: artifact.id, storagePath: artifact.storage_path, sha256: artifact.sha256 },
    segments: segments.map((s) => ({
      segmentIndex: s.segment_index, startSeconds: Number(s.start_seconds), endSeconds: Number(s.end_seconds),
      item: s.item, excerpt: s.excerpt, captionSha256: s.caption_sha256,
    })),
    segmentIndex: input.segmentIndex, timestampSeconds: input.timestampSeconds,
  });
}
