import type { DraftRepairStatus } from "./draft-audit-repair.ts";

export type DraftReviewReason =
  | "citations-missing"
  | "evidence-reconciliation-incomplete"
  | "name-check-incomplete"
  | "names-unresolved"
  /** The style audit still reports something to fix after the repair rounds
   *  the desk was allowed to run. Nothing is blocked: the editor can publish
   *  over it, or use "Fix these with the model" to try another round. */
  | "style-audit-open";

/**
 * The style audit's own summary, kept beside the citation and name checks so
 * the receipt answers "what did the desk check?" in one place. The findings
 * themselves are long -- they live with the draft, not in the job receipt.
 */
export type DraftStyleAuditSummary = {
  status: DraftRepairStatus;
  fixCount: number;
  reviewCount: number;
  rounds: number;
};

export type DraftCompletionQuality = {
  version: 1;
  citationStatus: "complete" | "repaired" | "review-required" | "not-applicable";
  evidenceCheckIncomplete: boolean;
  nameCheckComplete: boolean;
  namesVerified: boolean;
  reviewRequired: boolean;
  reviewReasons: DraftReviewReason[];
  /** Absent on a receipt written before the style audit existed, and on the
   *  opinion path, which does not run this audit. */
  styleAudit?: DraftStyleAuditSummary;
};

const STYLE_STATUSES: readonly DraftRepairStatus[] = ["clean", "repaired", "open", "provider-failed"];

const STYLE_REVIEW_REASONS: readonly DraftReviewReason[] = [
  "citations-missing",
  "evidence-reconciliation-incomplete",
  "name-check-incomplete",
  "names-unresolved",
  "style-audit-open",
];

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
  /** The style audit of the draft that was actually saved, when one ran. */
  styleAudit?: DraftStyleAuditSummary | null;
}): DraftCompletionReceipt {
  const nameCheckComplete = input.nameCheck?.complete === true;
  const namesVerified = nameCheckComplete && (input.nameCheck?.rows ?? []).every((row) => row.status !== "unresolved");
  const reviewReasons: DraftReviewReason[] = [];
  if (input.citationStatus === "review-required") reviewReasons.push("citations-missing");
  if (input.evidenceCheckIncomplete) reviewReasons.push("evidence-reconciliation-incomplete");
  if (!nameCheckComplete) reviewReasons.push("name-check-incomplete");
  else if (!namesVerified) reviewReasons.push("names-unresolved");
  // A fix finding the desk could not clear in its two rounds is a reason to
  // look, not a reason to block: publishing stays the editor's call.
  if (input.styleAudit && input.styleAudit.fixCount > 0) reviewReasons.push("style-audit-open");
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
      ...(input.styleAudit ? { styleAudit: input.styleAudit } : {}),
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
        typeof reason === "string" && STYLE_REVIEW_REASONS.includes(reason as DraftReviewReason))
    : [];
  const styleAudit = parseStyleAudit(qualityRaw.styleAudit);
  /*
    "Something to fix" is read from the summary as well as from the flag: a
    receipt whose summary says problems are open must never print as Done,
    whatever a stale flag in the same row claims.
  */
  const styleOpen = styleAudit != null && styleAudit.fixCount > 0;
  if (styleOpen && !reasons.includes("style-audit-open")) reasons.push("style-audit-open");
  const reviewRequired = qualityRaw.reviewRequired === true || evidenceCheckIncomplete || styleOpen;
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
      ...(styleAudit ? { styleAudit } : {}),
    },
  };
}

/** The style summary as it survives a round trip, or null when the receipt
 *  carries none or carries something this build does not understand. A status
 *  that is not one of the four is dropped rather than guessed at, so a row
 *  written by a later version cannot make this one print a wrong line. */
function parseStyleAudit(raw: unknown): DraftStyleAuditSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const status = String(row.status ?? "");
  if (!STYLE_STATUSES.includes(status as DraftRepairStatus)) return null;
  const count = (value: unknown): number => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  return {
    status: status as DraftRepairStatus,
    fixCount: count(row.fixCount),
    reviewCount: count(row.reviewCount),
    rounds: count(row.rounds),
  };
}

export function draftCompletionStage(resultJson: unknown): "Done" | "Draft saved — review required" {
  return parseDraftCompletionReceipt(resultJson)?.quality.reviewRequired
    ? "Draft saved — review required"
    : "Done";
}
