export type ScanCoverageStatus = "pending" | "read" | "skipped" | "blocked";
export type ScanCoverageReason =
  "time-budget" | "over-cap" | "waiting" | "host-cap" | "not-reached" | "fetch-failed";

export type ScanSourceCoverageEntry = {
  sourceId: number;
  title: string;
  url: string;
  kind: string;
  tier: string;
  status: ScanCoverageStatus;
  reasonCode: ScanCoverageReason | null;
  reason: string | null;
  lastReadAt: string | null;
};

export type ScanCoverageSource = {
  id: number;
  title: string;
  url: string;
  kind?: string | null;
  tier?: string | null;
  last_ok_at?: string | Date | null;
  retry_after_note?: string | null;
};

export function manualScanCoverage(
  sources: readonly ScanCoverageSource[],
  cap: number,
): ScanSourceCoverageEntry[] {
  const limit = Math.max(0, Math.floor(cap));
  return sources.map((source, index) => ({
    sourceId: source.id,
    title: source.title,
    url: source.url,
    kind: source.kind || "unclassified",
    tier: source.tier || "unclassified",
    status: index < limit ? "pending" : "skipped",
    reasonCode: index < limit ? null : "over-cap",
    reason: null,
    lastReadAt: iso(source.last_ok_at),
  }));
}

export function scheduledScanCoverage(
  sources: readonly ScanCoverageSource[],
  selectedSourceIds: readonly number[],
  deferrals: readonly { sourceId: number; reason: "over-budget" | "parked" | "blocked" }[],
): ScanSourceCoverageEntry[] {
  const selected = new Set(selectedSourceIds);
  const deferred = new Map(deferrals.map((item) => [item.sourceId, item.reason]));
  return sources.map((source) => {
    const readToday = selected.has(source.id);
    const deferral = deferred.get(source.id);
    const overCap = !readToday && (deferral === "over-budget" || !deferral);
    return {
      sourceId: source.id,
      title: source.title,
      url: source.url,
      kind: source.kind || "unclassified",
      tier: source.tier || "unclassified",
      status: readToday ? "pending" : "skipped",
      reasonCode: readToday ? null : overCap ? "over-cap" : "waiting",
      reason: readToday ? null : source.retry_after_note || null,
      lastReadAt: iso(source.last_ok_at),
    };
  });
}

export function updateScanCoverageEntry(
  entries: readonly ScanSourceCoverageEntry[],
  sourceId: number,
  outcome: {
    status: Exclude<ScanCoverageStatus, "pending">;
    reasonCode?: ScanCoverageReason | null;
    reason?: string | null;
    readAt?: string | null;
  },
): ScanSourceCoverageEntry[] {
  return entries.map((entry) =>
    entry.sourceId === sourceId
      ? {
          ...entry,
          status: outcome.status,
          reasonCode: outcome.reasonCode ?? null,
          reason: outcome.reason ?? null,
          lastReadAt:
            outcome.status === "read"
              ? (outcome.readAt ?? new Date().toISOString())
              : entry.lastReadAt,
        }
      : entry,
  );
}

export function finishScanCoverage(
  entries: readonly ScanSourceCoverageEntry[],
): ScanSourceCoverageEntry[] {
  return entries.map((entry) =>
    entry.status === "pending"
      ? { ...entry, status: "skipped", reasonCode: "not-reached", reason: null }
      : entry,
  );
}

export function parseScanSourceCoverage(raw: unknown): ScanSourceCoverageEntry[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScanSourceCoverageEntry[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      !Number.isInteger(row.sourceId) ||
      typeof row.title !== "string" ||
      typeof row.url !== "string" ||
      typeof row.status !== "string" ||
      !["pending", "read", "skipped", "blocked"].includes(row.status)
    )
      return [];
    return [
      {
        sourceId: row.sourceId as number,
        title: row.title,
        url: row.url,
        kind: typeof row.kind === "string" ? row.kind : "unclassified",
        tier: typeof row.tier === "string" ? row.tier : "unclassified",
        status: row.status as ScanCoverageStatus,
        reasonCode: isReasonCode(row.reasonCode) ? row.reasonCode : null,
        reason: typeof row.reason === "string" ? row.reason : null,
        lastReadAt: typeof row.lastReadAt === "string" ? row.lastReadAt : null,
      },
    ];
  });
}

export function scanCoverageCounts(entries: readonly ScanSourceCoverageEntry[]) {
  return {
    total: entries.length,
    read: entries.filter((entry) => entry.status === "read").length,
    skipped: entries.filter((entry) => entry.status === "skipped").length,
    blocked: entries.filter((entry) => entry.status === "blocked").length,
    pending: entries.filter((entry) => entry.status === "pending").length,
  };
}

function isReasonCode(value: unknown): value is ScanCoverageReason {
  return (
    value === "time-budget" ||
    value === "over-cap" ||
    value === "waiting" ||
    value === "host-cap" ||
    value === "not-reached" ||
    value === "fetch-failed"
  );
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
