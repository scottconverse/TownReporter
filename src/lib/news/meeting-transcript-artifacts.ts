import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolutePathAnyPlatform, normalizeAbsolutePath } from "./absolute-path.ts";
import { join, resolve } from "node:path";
import type { Sql } from "../db.ts";
import type { ParsedCaptionFile, TranscriptFormat } from "./caption-parse.ts";

export type MeetingRetentionMode = "media" | "audio-only" | "transcript-only";
export type MeetingTranscriptSegment = {
  segmentIndex: number; startSeconds: number; endSeconds: number;
  item: string | null; excerpt: string; captionSha256: string;
};
export type MeetingTranscriptArtifact = {
  id: number; newsroomId: number; videoId: string; artifactType: "transcript";
  storagePath: string; format: string; sha256: string; byteSize: number; capturedAt: string;
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
  if (!isAbsolutePathAnyPlatform(value)) throw new Error(`Meeting transcript storage root must be absolute: ${value}`);
  return normalizeAbsolutePath(value);
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Put verified bytes at an immutable, content-addressed path.
 *
 * The temporary file lives beside the destination so rename is atomic on the
 * same filesystem. A concurrent writer of the same hash is harmless: whichever
 * rename wins, the loser verifies the final bytes before discarding its temp.
 */
type ImmutableWriteFaultInjection = {
  /** Test-only interruption point after temp fsync/hash validation and before atomic rename. */
  beforeAtomicRename?: (temporaryPath: string, targetPath: string) => void;
  /** Preserve the verified temp only when the injected interruption throws, like process death. */
  preserveTempOnInjectedInterruption?: boolean;
};

function writeVerifiedImmutableFile(sourcePath: string, targetPath: string, expectedSha256: string, fault?: ImmutableWriteFaultInjection): number {
  if (!existsSync(sourcePath)) throw new Error(`Captured artifact file is missing: ${sourcePath}`);
  const sourceBytes = readFileSync(sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  if (sourceSha256 !== expectedSha256) {
    throw new Error(`Captured artifact hash mismatch for ${sourcePath}: expected ${expectedSha256}, got ${sourceSha256}`);
  }

  if (existsSync(targetPath)) {
    const existingSha256 = sha256(readFileSync(targetPath));
    if (existingSha256 !== expectedSha256) {
      throw new Error(`Immutable meeting artifact path contains different bytes: ${targetPath}`);
    }
    return sourceBytes.byteLength;
  }

  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let preserveTemporary = false;
  try {
    const fd = openSync(temporaryPath, "wx");
    try {
      writeFileSync(fd, sourceBytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const temporarySha256 = sha256(readFileSync(temporaryPath));
    if (temporarySha256 !== expectedSha256) {
      throw new Error(`Temporary meeting artifact failed hash verification: ${temporaryPath}`);
    }
    if (fault?.beforeAtomicRename) {
      try {
        fault.beforeAtomicRename(temporaryPath, targetPath);
      } catch (error) {
        if (fault.preserveTempOnInjectedInterruption) preserveTemporary = true;
        throw error;
      }
    }
    try {
      renameSync(temporaryPath, targetPath);
    } catch (error) {
      if (!existsSync(targetPath) || sha256(readFileSync(targetPath)) !== expectedSha256) throw error;
    }
  } finally {
    if (!preserveTemporary && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  const finalSha256 = sha256(readFileSync(targetPath));
  if (finalSha256 !== expectedSha256) {
    throw new Error(`Stored meeting artifact failed final hash verification: ${targetPath}`);
  }
  return sourceBytes.byteLength;
}

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
  const bytes = readFileSync(sourceInfoPath);
  const infoSha256 = sha256(bytes);
  const targetPath = join(targetDir, `info-${infoSha256}.json`);
  const infoBytes = writeVerifiedImmutableFile(sourceInfoPath, targetPath, infoSha256);
  return {
    infoPath: targetPath,
    infoSha256,
    infoBytes,
    infoMissingReason: null,
  };
}

/**
 * The extension the stored artifact keeps on disk.
 *
 * Unit R: a speech-to-text run's artifact IS the tool's own JSON, so it is
 * stored with its own extension rather than relabelled `.vtt`. Storing JSON
 * bytes under a caption extension would make the file's name disagree with its
 * contents, and every integrity check downstream reads the bytes.
 */
export function transcriptArtifactExtension(format: TranscriptFormat): string {
  if (format === "srv3") return ".srv3";
  if (format === "textflowkit-json") return ".json";
  return ".vtt";
}

export async function storeMeetingTranscriptArtifact(
  sql: Sql,
  input: {
    newsroomId: number; videoId: string; parsed: ParsedCaptionFile; infoSourcePath?: string | null; sourceMethod?: string;
    /**
     * Unit R: what produced this transcript -- tool version, model, device, and
     * the hash of the audio it was transcribed from. A speech-to-text revision
     * that does not say which model read it cannot be re-checked or explained
     * to a reader, so this is recorded beside the artifact rather than folded
     * into a free-text field.
     */
    provenance?: Record<string, unknown> | null;
  },
  /** Internal test seam for exercising an abrupt process stop before rename. */
  fault?: ImmutableWriteFaultInjection,
): Promise<MeetingTranscriptArtifact> {
  const storageRoot = await loadStorageRoot(sql, input.newsroomId);
  const retentionMode = await loadRetentionMode(sql, input.newsroomId);
  retentionPlan(retentionMode);
  const targetDir = join(storageRoot, `newsroom-${input.newsroomId}`, input.videoId);
  mkdirSync(targetDir, { recursive: true });
  const extension = transcriptArtifactExtension(input.parsed.format);
  const targetPath = join(targetDir, `transcript-${input.parsed.sha256}${extension}`);
  let byteSize: number;
  if (resolve(input.parsed.sourcePath) !== resolve(targetPath)) {
    byteSize = writeVerifiedImmutableFile(input.parsed.sourcePath, targetPath, input.parsed.sha256, fault);
  } else if (!existsSync(targetPath) || sha256(readFileSync(targetPath)) !== input.parsed.sha256) {
    throw new Error(`Stored meeting artifact is missing or does not match its hash: ${targetPath}`);
  } else {
    byteSize = readFileSync(targetPath).byteLength;
  }
  const sidecar = storeMeetingInfoSidecar(input.infoSourcePath, targetDir);
  const segments = input.parsed.segments?.length
    ? input.parsed.segments.map((segment, segmentIndex) => ({
        segmentIndex,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        item: null,
        excerpt: segment.excerpt,
        captionSha256: input.parsed.sha256,
      }))
    : parseTranscriptSegments(input.parsed.text, input.parsed.sha256);
  const sourceMethod = input.sourceMethod ?? "yt-dlp-captions";
  const provenanceJson = input.provenance ? JSON.stringify({ ...input.provenance, sourceMethod }) : null;
  const rows = await sql.query<{ id: number; captured_at: string }>(
    `insert into meeting_transcript_artifacts
       (newsroom_id,video_id,artifact_type,storage_path,format,sha256,captured_at,source_method,retention_mode,byte_size,info_path,info_sha256,info_bytes,info_missing_reason,integrity_status,integrity_detail,integrity_checked_at,provenance_json)
     values ($1,$2,'transcript',$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15)
     on conflict (newsroom_id,video_id,artifact_type,sha256)
     do update set storage_path=excluded.storage_path,format=excluded.format,source_method=excluded.source_method,
       retention_mode=excluded.retention_mode,byte_size=excluded.byte_size,info_path=excluded.info_path,info_sha256=excluded.info_sha256,info_bytes=excluded.info_bytes,info_missing_reason=excluded.info_missing_reason,
       integrity_status=excluded.integrity_status,integrity_detail=excluded.integrity_detail,integrity_checked_at=excluded.integrity_checked_at,
       provenance_json=coalesce(excluded.provenance_json,meeting_transcript_artifacts.provenance_json),updated_at=now()
     returning id,captured_at::text as captured_at`,
    [input.newsroomId, input.videoId, targetPath, input.parsed.format, input.parsed.sha256, sourceMethod, retentionMode, byteSize, sidecar.infoPath, sidecar.infoSha256, sidecar.infoBytes, sidecar.infoMissingReason, input.infoSourcePath && sidecar.infoMissingReason ? "sidecar-missing" : "valid", sidecar.infoMissingReason, provenanceJson],
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
    storagePath: targetPath, format: input.parsed.format, sha256: input.parsed.sha256, byteSize,
    capturedAt: rows[0]!.captured_at, sourceMethod, retentionMode,
  };
}

/**
   * Resolve the agenda item for each segment from the chunk table.
   *
   * `meeting_transcript_segments.item` is never populated -- nothing writes it,
   * so it is null on every row and a citation could name a timestamp but never
   * the agenda item it sits under. The spec requires item + timestamp + excerpt,
   * and the tests passed anyway because the resolver was handed a segment that
   * already carried an item.
   *
   * The item is resolved HERE, at read time, from `meeting_agenda_chunks` -- the
   * one table that actually knows which segments belong to which item. Writing a
   * copy back onto every segment row was the obvious alternative and is the wrong
   * one: a second copy of a fact that goes stale the moment alignment re-runs,
   * which is the drift class this project keeps getting bitten by. A join costs
   * nothing and cannot disagree with itself.
   */
  async function itemsBySegmentIndex(sql: Sql, videoId: string): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    let chunks: Array<{ item: string | null; segment_indexes: unknown }>;
    try {
      chunks = await sql.query<{ item: string | null; segment_indexes: unknown }>(
        "select item,segment_indexes from meeting_agenda_chunks where video_id=$1 order by id",
        [videoId],
      );
    } catch {
      // A database predating the chunk table simply has no items to attach.
      return out;
    }
    for (const chunk of chunks) {
      if (!chunk.item) continue;
      const raw = chunk.segment_indexes;
      let list: number[] = [];
      if (Array.isArray(raw)) list = (raw as unknown[]).map((n) => Number(n));
      else if (typeof raw === "string") {
        try { list = (JSON.parse(raw) as unknown[]).map((n) => Number(n)); } catch { list = []; }
      }
      for (const idx of list) if (Number.isFinite(idx)) out.set(idx, chunk.item);
    }
    return out;
  }

  export async function loadTranscriptCitation(
    sql: Sql, input: { artifactId: number; segmentIndex?: number; timestampSeconds?: number },
  ): Promise<ResolvedTranscriptCitation> {
    const artifacts = await sql.query<{
      id: number; storage_path: string; sha256: string; video_id: string;
    }>(
      "select id,storage_path,sha256,video_id from meeting_transcript_artifacts where id=$1", [input.artifactId],
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
    const fromChunks = await itemsBySegmentIndex(sql, artifact.video_id);
    return resolveTranscriptCitation({
      artifact: { id: artifact.id, storagePath: artifact.storage_path, sha256: artifact.sha256 },
      segments: segments.map((s) => ({
        segmentIndex: s.segment_index, startSeconds: Number(s.start_seconds), endSeconds: Number(s.end_seconds),
        item: s.item ?? fromChunks.get(s.segment_index) ?? null,
        excerpt: s.excerpt, captionSha256: s.caption_sha256,
      })),
      segmentIndex: input.segmentIndex, timestampSeconds: input.timestampSeconds,
    });
  }
