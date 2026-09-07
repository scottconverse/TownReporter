import type { DraftRow } from "./types.ts";
export type EvidenceDecision = "keep" | "remove";
function memo(raw: string | null | undefined): Record<string, unknown> {
  try { const parsed = JSON.parse(raw ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
const normalized = (body: string) => body.replace(/\s+/g, " ").trim();
export function publicEvidenceWasRemoved(draft: Partial<DraftRow>): boolean {
  return (memo(draft.research_json).evidenceReview as { decision?: string } | undefined)?.decision === "remove";
}
export function mayInheritLeadSources(draft: Partial<DraftRow>): boolean {
  return !publicEvidenceWasRemoved(draft) && memo(draft.research_json).researchScope !== "supplied";
}
export function evidenceNeedsReview(draft: Partial<DraftRow>, body: string): boolean {
  const review = memo(draft.research_json).evidenceReview as { required?: boolean } | undefined;
  const hasEvidence = [draft.source_urls, draft.provenance_json, draft.found_note, draft.unanswered].some(x => Boolean(x?.trim() && !["[]", "{}"].includes(x.trim())));
  return review?.required === true || (hasEvidence && normalized(body) !== normalized(draft.body ?? ""));
}
/** A review applies to the exact evidence the editor saw, not a newer draft. */
export function evidenceReviewToken(draft: Partial<DraftRow>): string {
  return JSON.stringify([draft.id, draft.headline, draft.dek, draft.topic, draft.body, draft.source_urls, draft.provenance_json, draft.found_note, draft.unanswered, draft.research_json]);
}
export function reconcileDraftEvidence(draft: Partial<DraftRow>, body: string, decision?: EvidenceDecision) {
  const previous = memo(draft.research_json);
  const fields = { source_urls: draft.source_urls ?? "[]", provenance_json: draft.provenance_json ?? "[]", found_note: draft.found_note ?? "", unanswered: draft.unanswered ?? "[]" };
  if (!evidenceNeedsReview(draft, body) && !decision) return { ...fields, research_json: draft.research_json ?? "{}" };
  const oldReview = previous.evidenceReview as Record<string, unknown> | undefined;
  // Retain the original material privately. Subsequent edits cannot overwrite it.
  const archive = oldReview?.original ?? { body: draft.body, ...fields };
  const review = { required: !decision, decision: decision ?? oldReview?.decision ?? null, original: archive };
  return { ...(decision === "remove" ? { source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]" } : fields), research_json: JSON.stringify({ ...previous, evidenceReview: review }) };
}
