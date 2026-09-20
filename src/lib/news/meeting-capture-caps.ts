/**
 * N-5: capture bounding. Pure logic so it is testable without a process.
 *
 * A capture that exceeds either cap is REFUSED with a recorded reason. It is
 * never silently truncated: the caller refuses and records the named reason.
 */
export type CaptureCaps = {
  durationCapSeconds: number;
  sizeCapBytes: number;
};

/** Stated defaults; require Scott's confirmation before being treated as final. */
export const DEFAULT_CAPTURE_CAPS: CaptureCaps = {
  durationCapSeconds: 28800, // 8 hours
  sizeCapBytes: 524288000, // 500 MB
};

export type CapRefusal = { refused: true; reason: string } | { refused: false };

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Refuse when the meeting is longer than the configured duration cap. */
export function checkDurationCap(durationSeconds: number | null, caps: CaptureCaps): CapRefusal {
  if (durationSeconds == null) return { refused: false };
  if (!Number.isFinite(caps.durationCapSeconds) || caps.durationCapSeconds <= 0) return { refused: false };
  if (durationSeconds > caps.durationCapSeconds) {
    return {
      refused: true,
      reason: `Refused: meeting duration ${fmtDuration(durationSeconds)} exceeds the duration cap of ${fmtDuration(caps.durationCapSeconds)}. Raise the cap in Server -> Meeting capture if this meeting should be captured.`,
    };
  }
  return { refused: false };
}

/** Refuse when the downloaded artifact is larger than the configured size cap. */
export function checkSizeCap(byteSize: number | null, caps: CaptureCaps): CapRefusal {
  if (byteSize == null) return { refused: false };
  if (!Number.isFinite(caps.sizeCapBytes) || caps.sizeCapBytes <= 0) return { refused: false };
  if (byteSize > caps.sizeCapBytes) {
    return {
      refused: true,
      reason: `Refused: captured file ${fmtBytes(byteSize)} exceeds the size cap of ${fmtBytes(caps.sizeCapBytes)}. Raise the cap in Server -> Meeting capture if this file should be kept.`,
    };
  }
  return { refused: false };
}

export function capsFromSettings(settings: { duration_cap_seconds?: number | null; size_cap_bytes?: number | null } | undefined): CaptureCaps {
  return {
    durationCapSeconds: settings?.duration_cap_seconds ?? DEFAULT_CAPTURE_CAPS.durationCapSeconds,
    sizeCapBytes: Number(settings?.size_cap_bytes ?? DEFAULT_CAPTURE_CAPS.sizeCapBytes),
  };
}

