import type { DraftRow } from "./types.ts";
export type EvidenceDecision = "keep" | "remove";
function memo(raw: string | null | undefined): Record<string, unknown> {
  try { const parsed = JSON.parse(raw ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function transcriptCitationsFromResearch(raw: string | null | undefined): unknown {
  const research = memo(raw);
  return research.transcriptCitations ?? null;
}
const normalized = (body: string) => body.replace(/\s+/g, " ").trim();
export function publicEvidenceWasRemoved(draft: Partial<DraftRow>): boolean {
  return (memo(draft.research_json).evidenceReview as { decision?: string } | undefined)?.decision === "remove";
}
export function mayInheritLeadSources(draft: Partial<DraftRow>): boolean {
  const research = memo(draft.research_json);
  return !publicEvidenceWasRemoved(draft) && research.researchScope !== "supplied" && research.citationPolicy !== "explicit";
}
/**
 * A draft whose text came in from an editor's import, not from the drafting
 * model (see import-stories.server.ts).
 *
 * The two are opposite shapes and the evidence gate is built for one of them.
 * A model draft is prose written ABOUT records gathered beside it, so when the
 * prose changes a person has to check the new prose still matches those
 * records. An imported story's text IS the material -- a report an editor read
 * and chose -- and its sources are the pages it cites. Editing a name in it and
 * saving is ordinary desk work, and routing that edit into a review of
 * model-extracted claims would ask the editor to compare the story against
 * something that was never extracted.
 *
 * This exempts the draft from that one gate and nothing else: the section is
 * still confirmed for the version being printed, the named-outlet credit check
 * still runs, and the disclosure line still reaches the reader.
 */
export function isImportedText(draft: Partial<DraftRow>): boolean {
  return memo(draft.research_json).importedText === true;
}
export function evidenceNeedsReview(draft: Partial<DraftRow>, body: string): boolean {
  if (isImportedText(draft)) return false;
  const review = memo(draft.research_json).evidenceReview as { required?: boolean } | undefined;
  const hasEvidence = [draft.source_urls, draft.provenance_json, draft.found_note, draft.unanswered].some(x => Boolean(x?.trim() && !["[]", "{}"].includes(x.trim())));
  return review?.required === true || (hasEvidence && normalized(body) !== normalized(draft.body ?? ""));
}
/** A review applies to the exact evidence the editor saw, not a newer draft. */
export function evidenceReviewToken(draft: Partial<DraftRow>): string {
  return JSON.stringify([draft.id, draft.headline, draft.dek, draft.topic, draft.body, draft.source_urls, draft.provenance_json, draft.found_note, draft.unanswered, draft.research_json, transcriptCitationsFromResearch(draft.research_json)]);
}
export function reconcileDraftEvidence(draft: Partial<DraftRow>, body: string, decision?: EvidenceDecision) {
  const previous = memo(draft.research_json);
  const fields = { source_urls: draft.source_urls ?? "[]", provenance_json: draft.provenance_json ?? "[]", found_note: draft.found_note ?? "", unanswered: draft.unanswered ?? "[]" };
  if (!evidenceNeedsReview(draft, body) && !decision) return { ...fields, research_json: draft.research_json ?? "{}" };
  const oldReview = previous.evidenceReview as Record<string, unknown> | undefined;
  // Retain the original material privately. Subsequent edits cannot overwrite it.
  const archive = oldReview?.original ?? { body: draft.body, ...fields };
  const review = { required: !decision, decision: decision ?? oldReview?.decision ?? null, original: archive };
  const retainedResearch = decision === "remove"
    ? Object.fromEntries(Object.entries(previous).filter(([key]) => key !== "reportedDocumentClaims" && key !== "documentEvidenceReview"))
    : previous;
  return { ...(decision === "remove" ? { source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]" } : fields), research_json: JSON.stringify({ ...retainedResearch, evidenceReview: review }) };
}
