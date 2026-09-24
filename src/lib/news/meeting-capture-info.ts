export type ParsedInfoSidecar = {
  durationSeconds: number | null;
  /** Stream/video start used to compute ended_at; distinct from YouTube upload time. */
  videoTimestamp: number | null;
  uploadTimestamp?: number | null;
  captionRevisionTimestamp: number | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function parseInfoSidecar(raw: unknown): ParsedInfoSidecar {
  const info = (raw ?? {}) as Record<string, unknown>;
  const timestamp = asFiniteNumber(info.timestamp);
  const releaseTimestamp = asFiniteNumber(info.release_timestamp);
  const liveStatus = typeof info.live_status === "string" ? info.live_status : "";
  return {
    durationSeconds: asFiniteNumber(info.duration),
    // For a completed live stream yt-dlp's `timestamp` is when the upload was
    // published, while `release_timestamp` is the scheduled stream start. Use
    // the start plus duration to derive ended_at; preserve upload time separately.
    videoTimestamp: liveStatus === "was_live"
      ? releaseTimestamp ?? timestamp
      : timestamp ?? releaseTimestamp,
    uploadTimestamp: timestamp,
    captionRevisionTimestamp:
      asFiniteNumber(info.caption_revision_timestamp) ??
      asFiniteNumber(info.revision_timestamp),
  };
}

export function computeEndedAt(input: {
  durationSeconds: number | null;
  videoTimestamp: number | null;
}): string | null {
  if (input.durationSeconds == null || input.videoTimestamp == null) return null;
  return new Date((input.videoTimestamp + input.durationSeconds) * 1000).toISOString();
}
