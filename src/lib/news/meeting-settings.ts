import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { getSql } from "../db.ts";
import { requireEditor, ForbiddenError } from "./membership.ts";
import type { MeetingChannel } from "./meeting-capture.ts";
import { DEFAULT_CAPTURE_CAPS } from "./meeting-capture-caps.ts";

/*
  No `node:` import may reach this module's top level.

  `components/meeting-capture-settings.tsx` is a client component and imports
  the two server-function handles below, so this whole module is in the browser
  graph. Node builtins there are externalized by Vite, and reading one throws
  at module evaluation -- `/desk/ops` rendered "Something went wrong" with
  `Module "node:path" has been externalized for browser compatibility.
  Cannot access "node:path.isAbsolute" in client code.` The filesystem helpers
  that need them live in `./storage-root.server.ts` and are pulled in inside
  the save handler, whose body never reaches the client.
*/

export type MeetingRetentionMode = "media" | "audio-only" | "transcript-only";

export type MeetingSpeechToTextStatus = {
  installed: boolean;
  version: string | null;
  model: string;
  language: string;
  /** The operator-facing sentence, composed by the pure module. */
  line: string;
};

export type MeetingOperatorSettings = {
  channels: string[];
  storageRoot: string | null;
  retentionMode: MeetingRetentionMode;
  enabled: boolean;
  durationCapSeconds: number;
  sizeCapBytes: number;
  /** Unit R: whether speech-to-text is available on this server at all. */
  speechToText: MeetingSpeechToTextStatus;
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
    // Loaded here, not at module scope: see the note at the top of this module.
    const { loadMeetingPriority } = await import("./meeting-capture.ts");
    const channels = await loadMeetingPriority(sql, newsroomId);
    const rows = await sql.query<{ storage_root: string | null; retention_mode: MeetingRetentionMode | null; enabled: boolean | null; duration_cap_seconds: number | null; size_cap_bytes: number | string | null }>(
      "select storage_root,retention_mode,enabled,duration_cap_seconds,size_cap_bytes from meeting_capture_settings where newsroom_id=$1",
      [newsroomId],
    );
    /*
      Unit R: the operator has to be able to see whether speech-to-text is
      available BEFORE wondering why a captionless meeting stayed audio-only.
      Both modules are loaded inside the handler for the reason the note above
      gives -- textflowkit.ts hashes with node:crypto and textflowkit-cli.server.ts
      spawns a process.

      The probe is bounded well under the job's own 15s allowance: this runs on
      a page load, and a pathological CLI must not hold the settings screen.
      A probe that misbehaves is reported as not installed rather than thrown:
      the panel still renders, and the sentence says what happened.
    */
    let speechToText: MeetingSpeechToTextStatus;
    try {
      const { probeTextflowkit } = await import("./textflowkit-cli.server.ts");
      const { textflowkitStatusLine } = await import("./textflowkit.ts");
      const probe = await probeTextflowkit({ timeoutMs: 5_000 });
      speechToText = {
        installed: probe.installed,
        version: probe.version,
        model: probe.model,
        language: probe.language,
        line: textflowkitStatusLine(probe),
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      speechToText = {
        installed: false,
        version: null,
        model: "",
        language: "",
        line: `Speech-to-text: the textflowkit check failed (${detail}) — meetings without captions stay audio-only`,
      };
    }
    return {
      channels: channels.map((c) => c.url),
      storageRoot: rows[0]?.storage_root ?? null,
      retentionMode: rows[0]?.retention_mode ?? "transcript-only",
      enabled: rows[0]?.enabled ?? false,
      durationCapSeconds: Number(rows[0]?.duration_cap_seconds ?? DEFAULT_CAPTURE_CAPS.durationCapSeconds),
      sizeCapBytes: Number(rows[0]?.size_cap_bytes ?? DEFAULT_CAPTURE_CAPS.sizeCapBytes),
      speechToText,
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
    // Server-only filesystem helpers, loaded here so they never join the
    // client graph (see the note at the top of this module).
    const { storageRootRejectionReason, assertStorageRootWritable, normalizeAbsolutePath } = await import(
      "./storage-root.server.ts"
    );
    const { loadMeetingPriority, saveMeetingPriority } = await import("./meeting-capture.ts");

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

