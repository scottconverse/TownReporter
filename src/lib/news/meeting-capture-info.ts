export type ParsedInfoSidecar = {
  durationSeconds: number | null;
  videoTimestamp: number | null;
  captionRevisionTimestamp: number | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function parseInfoSidecar(raw: unknown): ParsedInfoSidecar {
  const info = (raw ?? {}) as Record<string, unknown>;
  return {
    durationSeconds: asFiniteNumber(info.duration),
    videoTimestamp: asFiniteNumber(info.timestamp) ?? asFiniteNumber(info.release_timestamp),
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
