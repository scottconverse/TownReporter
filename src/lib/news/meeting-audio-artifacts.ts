import { mkdirSync, copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import type { Sql } from "../db.ts";
import type { MeetingRetentionMode } from "./meeting-transcript-artifacts.ts";

export type MeetingAudioArtifact = {
  id: number;
  newsroomId: number;
  videoId: string;
  artifactType: "audio";
  storagePath: string;
  format: string;
  sha256: string;
  byteSize: number;
  capturedAt: string;
  sourceMethod: string;
  retentionMode: MeetingRetentionMode;
  triggerReason: string;
};

function resolveRoot(configured: string | null | undefined): string {
  if (!configured || !configured.trim()) {
    throw new Error("Meeting transcript storage root is not configured; refusing to write inside the app directory.");
  }
  const value = configured.trim();
  if (!isAbsolute(value)) throw new Error(`Meeting transcript storage root must be absolute: ${value}`);
  return resolve(value);
}

/**
 * Pure writer for the M-1 audio artifact. Uses the passed SQL handle and never
 * opens its own transaction, so it commits atomically with the capture record.
 * Trigger reason is mandatory: "audio used" without a reason is not evidence.
 */
export async function storeMeetingAudioArtifact(
  sql: Sql,
  input: {
    newsroomId: number;
    videoId: string;
    audioSourcePath: string;
    format: string;
    triggerReason: string;
    infoSourcePath?: string | null;
    sourceMethod?: string;
  },
): Promise<MeetingAudioArtifact> {
  if (!input.triggerReason || !input.triggerReason.trim()) {
    throw new Error("Audio fallback trigger reason is required; refusing to record unexplained audio use.");
  }
  const settings = await sql.query<{ storage_root: string | null; retention_mode: MeetingRetentionMode | null }>(
    "select storage_root,retention_mode from meeting_capture_settings where newsroom_id=$1",
    [input.newsroomId],
  );
  const storageRoot = resolveRoot(settings[0]?.storage_root ?? null);
  const retentionMode = settings[0]?.retention_mode ?? "transcript-only";
  const targetDir = join(storageRoot, `newsroom-${input.newsroomId}`, input.videoId);
  mkdirSync(targetDir, { recursive: true });
  const extension = input.format === "opus" ? ".opus" : `.${input.format}`;
  const targetPath = join(targetDir, `${input.videoId}${extension}`);
  if (resolve(input.audioSourcePath) !== resolve(targetPath)) {
    if (!existsSync(input.audioSourcePath)) throw new Error(`Captured audio file is missing: ${input.audioSourcePath}`);
    copyFileSync(input.audioSourcePath, targetPath);
  }
  const bytes = readFileSync(targetPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const byteSize = statSync(targetPath).size;
  const rows = await sql.query<{ id: number; captured_at: string }>(
    `insert into meeting_transcript_artifacts
       (newsroom_id,video_id,artifact_type,storage_path,format,sha256,captured_at,source_method,retention_mode,byte_size)
     values ($1,$2,'audio',$3,$4,$5,now(),$6,$7,$8)
     on conflict (newsroom_id,video_id,artifact_type,sha256)
     do update set storage_path=excluded.storage_path,format=excluded.format,source_method=excluded.source_method,
       retention_mode=excluded.retention_mode,byte_size=excluded.byte_size,updated_at=now()
     returning id,captured_at::text as captured_at`,
    [input.newsroomId, input.videoId, targetPath, input.format, sha256, input.sourceMethod ?? "yt-dlp-audio-opus", retentionMode, byteSize],
  );
  const artifactId = rows[0]?.id;
  if (!artifactId) throw new Error("Meeting audio artifact insert returned no id.");
  return {
    id: artifactId, newsroomId: input.newsroomId, videoId: input.videoId, artifactType: "audio",
    storagePath: targetPath, format: input.format, sha256, byteSize,
    capturedAt: rows[0]!.captured_at, sourceMethod: input.sourceMethod ?? "yt-dlp-audio-opus",
    retentionMode, triggerReason: input.triggerReason,
  };
}
