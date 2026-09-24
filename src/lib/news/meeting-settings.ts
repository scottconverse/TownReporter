import { createServerFn } from "@tanstack/react-start";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { authMiddleware } from "../auth/middleware.ts";
import { getSql } from "../db.ts";
import { requireEditor, ForbiddenError } from "./membership.ts";
import { loadMeetingPriority, saveMeetingPriority, type MeetingChannel } from "./meeting-capture.ts";
import { DEFAULT_CAPTURE_CAPS } from "./meeting-capture-caps.ts";
import { isAbsolutePathAnyPlatform, normalizeAbsolutePath } from "./absolute-path.ts";

export type MeetingRetentionMode = "media" | "audio-only" | "transcript-only";

export type MeetingOperatorSettings = {
  channels: string[];
  storageRoot: string | null;
  retentionMode: MeetingRetentionMode;
  enabled: boolean;
  durationCapSeconds: number;
  sizeCapBytes: number;
};

const RETENTION_MODES: MeetingRetentionMode[] = ["media", "audio-only", "transcript-only"];

/** A recognizable YouTube channel form: a handle (@name), /channel/UC..., /c/name, or /user/name. */
export function youtubeChannelRejectionReason(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Channel URL is required.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That is not a valid URL. Use a full YouTube channel URL, e.g. https://www.youtube.com/@CityofLongmont";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") {
    return "That is not a YouTube URL. Use a youtube.com channel URL such as https://www.youtube.com/@CityofLongmont";
  }
  const path = url.pathname.replace(/\/+$/, "");
  const looksLikeChannel = /^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)$/i.test(path);
  const looksLikeVideo = /^\/watch$/.test(path) || /^\/v\//.test(path) || /^\/shorts\//.test(path);
  if (!looksLikeChannel) {
    if (looksLikeVideo) return "That is a video URL, not a channel. Use the channel URL such as https://www.youtube.com/@CityofLongmont";
    return "That YouTube URL is not a recognized channel form (expected /@handle, /channel/ID, /c/name, or /user/name).";
  }
  return null;
}

export function storageRootRejectionReason(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "Storage root is required. Enter an absolute folder path, e.g. D:\\TownReporter\\meetings";
  if (!isAbsolutePathAnyPlatform(value)) {
    return `Storage root must be an absolute path (got "${value}"). Enter a full path such as D:\\TownReporter\\meetings or /mnt/data/meetings.`;
  }
  return null;
}

/**
 * Verify the root is writable by performing a real write and delete at save
 * time. The error names the exact path and the underlying failure.
 */
export function assertStorageRootWritable(root: string): { ok: true } | { ok: false; error: string } {
  const resolved = normalizeAbsolutePath(root);
  const probe = join(resolved, `.townreporter-write-test-${Date.now()}`);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch (error) {
    return { ok: false, error: `Could not create the storage root "${resolved}": ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    writeFileSync(probe, "townreporter write test", "utf8");
  } catch (error) {
    return { ok: false, error: `Storage root "${resolved}" is not writable: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    unlinkSync(probe);
  } catch {
    /* the write succeeded; a leftover probe file is not a failure */
  }
  return { ok: true };
}

async function ownedNewsroomId(userId: string): Promise<number> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") throw new ForbiddenError("Only the owner can configure meeting capture.");
  return me.newsroomId;
}

export const getMeetingSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MeetingOperatorSettings> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    const sql = await getSql();
    const channels = await loadMeetingPriority(sql, newsroomId);
    const rows = await sql.query<{ storage_root: string | null; retention_mode: MeetingRetentionMode | null; enabled: boolean | null; duration_cap_seconds: number | null; size_cap_bytes: number | string | null }>(
      "select storage_root,retention_mode,enabled,duration_cap_seconds,size_cap_bytes from meeting_capture_settings where newsroom_id=$1",
      [newsroomId],
    );
    return {
      channels: channels.map((c) => c.url),
      storageRoot: rows[0]?.storage_root ?? null,
      retentionMode: rows[0]?.retention_mode ?? "transcript-only",
      enabled: rows[0]?.enabled ?? false,
      durationCapSeconds: Number(rows[0]?.duration_cap_seconds ?? DEFAULT_CAPTURE_CAPS.durationCapSeconds),
      sizeCapBytes: Number(rows[0]?.size_cap_bytes ?? DEFAULT_CAPTURE_CAPS.sizeCapBytes),
    };
  });

export type SaveMeetingSettingsInput = {
  channels: string[];
  storageRoot: string | null;
  retentionMode: MeetingRetentionMode;
  enabled: boolean;
  durationCapSeconds: number;
  sizeCapBytes: number;
};

export type SaveMeetingSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

export const saveMeetingSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown): SaveMeetingSettingsInput => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return {
      channels: Array.isArray(d.channels) ? (d.channels as unknown[]).map(String) : [],
      storageRoot: d.storageRoot == null ? null : String(d.storageRoot),
      retentionMode: (d.retentionMode as MeetingRetentionMode) ?? "transcript-only",
      enabled: Boolean(d.enabled),
      durationCapSeconds: Number(d.durationCapSeconds ?? DEFAULT_CAPTURE_CAPS.durationCapSeconds),
      sizeCapBytes: Number(d.sizeCapBytes ?? DEFAULT_CAPTURE_CAPS.sizeCapBytes),
    };
  })
  .handler(async ({ context, data }): Promise<SaveMeetingSettingsResult> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    const sql = await getSql();

    if (!RETENTION_MODES.includes(data.retentionMode)) {
      return { ok: false, error: `Retention mode must be one of ${RETENTION_MODES.join(", ")}.` };
    }

    // Validate every channel URL up front so a bad one never half-writes.
    const seen = new Set<string>();
    const cleaned: MeetingChannel[] = [];
    for (const raw of data.channels) {
      const reason = youtubeChannelRejectionReason(raw);
      if (reason) return { ok: false, error: reason };
      const url = raw.trim().replace(/\/+$/, "");
      if (seen.has(url)) continue;
      seen.add(url);
      cleaned.push({ url });
    }

    // Storage root: required and validated whenever one is provided or the
    // step is enabled. An absolute, writable root is enforced so the operator
    // cannot submit something the engine will reject later.
    const hasRoot = (data.storageRoot ?? "").trim().length > 0;
    if (data.enabled || hasRoot) {
      const rootReason = storageRootRejectionReason(data.storageRoot);
      if (rootReason) return { ok: false, error: rootReason };
      const writable = assertStorageRootWritable(data.storageRoot!);
      if (!writable.ok) return { ok: false, error: writable.error };
    }

    if (!Number.isFinite(data.durationCapSeconds) || data.durationCapSeconds <= 0) {
      return { ok: false, error: "Duration cap must be a positive number of seconds." };
    }
    if (!Number.isFinite(data.sizeCapBytes) || data.sizeCapBytes <= 0) {
      return { ok: false, error: "Size cap must be a positive number of bytes." };
    }
    if (data.enabled && cleaned.length === 0) {
      return { ok: false, error: "Add at least one meeting channel before turning meeting capture on." };
    }

    // Channel writes must be authoritative: replace the set, keeping order.
    const existing = await loadMeetingPriority(sql, newsroomId);
    await saveMeetingPriority(sql, newsroomId, cleaned);
    const keep = new Set(cleaned.map((c) => c.url));
    for (const old of existing) {
      if (!keep.has(old.url)) {
        await sql.query("delete from meeting_channel_priority where newsroom_id=$1 and channel_url=$2", [newsroomId, old.url]);
      }
    }

    await sql.query(
      `insert into meeting_capture_settings(newsroom_id,storage_root,retention_mode,enabled,duration_cap_seconds,size_cap_bytes)
       values($1,$2,$3,$4,$5,$6)
       on conflict(newsroom_id) do update set storage_root=excluded.storage_root,
         retention_mode=excluded.retention_mode,enabled=excluded.enabled,
         duration_cap_seconds=excluded.duration_cap_seconds,size_cap_bytes=excluded.size_cap_bytes,updated_at=now()`,
      [newsroomId, data.storageRoot ? normalizeAbsolutePath(data.storageRoot) : null, data.retentionMode, data.enabled, Math.round(data.durationCapSeconds), Math.round(data.sizeCapBytes)],
    );

    return { ok: true };
  });

