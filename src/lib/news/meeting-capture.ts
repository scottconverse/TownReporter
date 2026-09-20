/*
  Meeting-capture Slice 1: step-zero awareness only.

  This module answers "is there a meeting we have not read?" at the top of a
  scan. It does not download, capture, transcribe, or draft. The database
  capture record is authoritative; the yt-dlp archive file is a regenerable
  cache derived from that record and is never allowed to override it.
*/
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Sql } from "../db.ts";
import {
  isMeetingTitle,
  listChannelVideos,
  pickMeetingVideos,
  type ListedVideo,
} from "./youtube.ts";

export type MeetingChannel = { url: string; label?: string };
export type MeetingCaptureStatus = "not-captured" | "captured" | "failed";

export type MeetingCaptureRecord = {
  videoId: string;
  channelUrl: string;
  title: string;
  published: string;
  status: MeetingCaptureStatus;
  failureReason?: string | null;
};

export type MeetingAwarenessResult = {
  configured: boolean;
  found: ListedVideo[];
  uncaptured: ListedVideo[];
  captured: MeetingCaptureRecord[];
  failed: MeetingCaptureRecord[];
  coverageLine: string;
  failures: string[];
  archivePath: string | null;
};

export type MeetingAwarenessDeps = {
  listChannelVideos?: typeof listChannelVideos;
  now?: () => Date;
};

const ARCHIVE_DIR = join(process.env.TOWNREPORTER_DATA_DIR || process.cwd(), "meeting-capture");
const EMPTY_RESULT: MeetingAwarenessResult = {
  configured: false,
  found: [],
  uncaptured: [],
  captured: [],
  failed: [],
  coverageLine: "",
  failures: [],
  archivePath: null,
};

export function meetingArchivePath(newsroomId: number): string {
  return join(ARCHIVE_DIR, `newsroom-${newsroomId}`, "yt-dlp-archive.txt");
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
  return records
    .filter((r) => r.status === "captured")
    .map((r) => `youtube ${r.videoId}`)
    .sort()
    .join("\n")
    .concat(records.length ? "\n" : "");
}

/**
 * The database wins in both directions:
 *   file says captured / record says not -> not captured
 *   record says captured / file says not -> regenerated from the record
 */
export function reconcileArchive(
  archiveText: string | null,
  records: MeetingCaptureRecord[],
): { capturedIds: Set<string>; rewritten: string; changed: boolean } {
  const fromDb = new Set(records.filter((r) => r.status === "captured").map((r) => r.videoId));
  const fromFile = archiveText ? parseArchive(archiveText) : new Set<string>();
  const capturedIds = new Set([...fromDb].filter((id) => fromFile.has(id) || !fromFile.size || fromFile.has(id)));
  for (const id of fromDb) capturedIds.add(id);
  const rewritten = serializeArchive(records);
  const changed = rewritten !== (archiveText ?? "");
  return { capturedIds, rewritten, changed };
}

export async function loadMeetingPriority(sql: Sql, newsroomId: number): Promise<MeetingChannel[]> {
  const rows = await sql.query<{ channel_url: string; position: number }>(
    "select channel_url,position from meeting_channel_priority where newsroom_id=$1 order by position,id",
    [newsroomId],
  );
  return rows.map((r) => ({ url: r.channel_url }));
}

export async function saveMeetingPriority(
  sql: Sql,
  newsroomId: number,
  channels: MeetingChannel[],
): Promise<void> {
  for (let i = 0; i < channels.length; i++) {
    await sql.query(
      "insert into meeting_channel_priority(newsroom_id,channel_url,position) values($1,$2,$3) on conflict(newsroom_id,channel_url) do update set position=excluded.position",
      [newsroomId, channels[i]!.url, i],
    );
  }
}

export async function readArchive(path: string): Promise<string | null> {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

export function regenerateArchive(path: string, records: MeetingCaptureRecord[]): string {
  const text = serializeArchive(records);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return text;
}

export function archiveCorrupt(text: string | null, records: MeetingCaptureRecord[]): boolean {
  if (text == null) return true;
  try {
    return serializeArchive(records) !== text && parseArchive(text).size === 0 && records.length > 0;
  } catch {
    return true;
  }
}

export async function runMeetingAwareness(
  sql: Sql,
  newsroomId: number,
  deps: MeetingAwarenessDeps = {},
): Promise<MeetingAwarenessResult> {
  const channels = await loadMeetingPriority(sql, newsroomId);
  if (!channels.length) return EMPTY_RESULT;
  const list = deps.listChannelVideos ?? listChannelVideos;
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
  }>("select video_id,channel_url,title,published,status,failure_reason from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  const captured: MeetingCaptureRecord[] = records.map((r) => ({
    videoId: r.video_id, channelUrl: r.channel_url, title: r.title, published: r.published,
    status: r.status, failureReason: r.failure_reason,
  }));
  const known = new Set(captured.filter((r) => r.status === "captured").map((r) => r.videoId));
  const uncaptured = found.filter((v) => !known.has(v.id));
  for (const v of uncaptured) {
    await sql.query(
      "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status) values($1,$2,$3,$4,$5,'not-captured') on conflict(newsroom_id,video_id) do update set title=excluded.title,published=excluded.published,updated_at=now()",
      [newsroomId, v.id, channels[0]!.url, v.title, v.published ?? ""],
    );
  }
  const failed = captured.filter((r) => r.status === "failed");
  const archivePath = meetingArchivePath(newsroomId);
  const archiveText = await readArchive(archivePath);
  const reconciled = reconcileArchive(archiveText, captured);
  if (reconciled.changed) regenerateArchive(archivePath, captured);
  const coverageLine = `meetings: ${found.length} found, ${captured.filter((r) => r.status === "captured").length} captured, ${failed.length} failed`;
  return {
    configured: true,
    found,
    uncaptured,
    captured,
    failed,
    coverageLine,
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