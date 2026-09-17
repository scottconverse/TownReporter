export type DraftReviewReason =
  | "citations-missing"
  | "evidence-reconciliation-incomplete"
  | "name-check-incomplete"
  | "names-unresolved";

export type DraftCompletionQuality = {
  version: 1;
  citationStatus: "complete" | "repaired" | "review-required" | "not-applicable";
  evidenceCheckIncomplete: boolean;
  nameCheckComplete: boolean;
  namesVerified: boolean;
  reviewRequired: boolean;
  reviewReasons: DraftReviewReason[];
};

export type DraftCompletionReceipt = {
  version: 2;
  checkpointDraftId?: number;
  finalDraftId: number;
  /** Backward-compatible batch result alias. */
  draftId: number;
  quality: DraftCompletionQuality;
};

type NameCheckSummary = {
  complete?: boolean;
  rows?: Array<{ status?: string }>;
} | null | undefined;

export function buildDraftCompletionReceipt(input: {
  checkpointDraftId?: number | null;
  finalDraftId: number;
  citationStatus: DraftCompletionQuality["citationStatus"];
  evidenceCheckIncomplete: boolean;
  nameCheck: NameCheckSummary;
}): DraftCompletionReceipt {
  const nameCheckComplete = input.nameCheck?.complete === true;
  const namesVerified = nameCheckComplete && (input.nameCheck?.rows ?? []).every((row) => row.status !== "unresolved");
  const reviewReasons: DraftReviewReason[] = [];
  if (input.citationStatus === "review-required") reviewReasons.push("citations-missing");
  if (input.evidenceCheckIncomplete) reviewReasons.push("evidence-reconciliation-incomplete");
  if (!nameCheckComplete) reviewReasons.push("name-check-incomplete");
  else if (!namesVerified) reviewReasons.push("names-unresolved");
  return {
    version: 2,
    ...(input.checkpointDraftId ? { checkpointDraftId: input.checkpointDraftId } : {}),
    finalDraftId: input.finalDraftId,
    draftId: input.finalDraftId,
    quality: {
      version: 1,
      citationStatus: input.citationStatus,
      evidenceCheckIncomplete: input.evidenceCheckIncomplete,
      nameCheckComplete,
      namesVerified,
      reviewRequired: reviewReasons.length > 0,
      reviewReasons,
    },
  };
}

export function parseDraftCompletionReceipt(raw: unknown): DraftCompletionReceipt | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw || "{}"); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const finalDraftId = Number(row.finalDraftId ?? row.draftId);
  if (!Number.isInteger(finalDraftId) || finalDraftId <= 0) return null;
  const qualityRaw = row.quality && typeof row.quality === "object"
    ? row.quality as Record<string, unknown>
    : {};
  const citation = String(qualityRaw.citationStatus ?? "not-applicable");
  const citationStatus: DraftCompletionQuality["citationStatus"] =
    citation === "complete" || citation === "repaired" || citation === "review-required"
      ? citation
      : "not-applicable";
  const legacyEvidenceIncomplete = row.evidenceCheckIncomplete === true;
  const evidenceCheckIncomplete = qualityRaw.evidenceCheckIncomplete === true || legacyEvidenceIncomplete;
  const reasons = Array.isArray(qualityRaw.reviewReasons)
    ? qualityRaw.reviewReasons.filter((reason): reason is DraftReviewReason =>
        typeof reason === "string" && ["citations-missing", "evidence-reconciliation-incomplete", "name-check-incomplete", "names-unresolved"].includes(reason))
    : [];
  const reviewRequired = qualityRaw.reviewRequired === true || evidenceCheckIncomplete;
  return {
    version: 2,
    ...(Number.isInteger(Number(row.checkpointDraftId)) && Number(row.checkpointDraftId) > 0
      ? { checkpointDraftId: Number(row.checkpointDraftId) }
      : {}),
    finalDraftId,
    draftId: finalDraftId,
    quality: {
      version: 1,
      citationStatus,
      evidenceCheckIncomplete,
      nameCheckComplete: qualityRaw.nameCheckComplete === true,
      namesVerified: qualityRaw.namesVerified === true,
      reviewRequired,
      reviewReasons: reasons.length || !evidenceCheckIncomplete ? reasons : ["evidence-reconciliation-incomplete"],
    },
  };
}

export function draftCompletionStage(resultJson: unknown): "Done" | "Draft saved — review required" {
  return parseDraftCompletionReceipt(resultJson)?.quality.reviewRequired
    ? "Draft saved — review required"
    : "Done";
}
