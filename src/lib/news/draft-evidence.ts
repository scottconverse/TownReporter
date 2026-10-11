import { topicConfirmationFingerprint } from "./notes.ts";
import { STYLE_AUDIT_KEY } from "./draft-audit-record.ts";
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
/**
 * `research_json` without the derived records that must never be part of the
 * draft's identity.
 *
 * WHY THE DRAFT'S IDENTITY MUST NOT SEE THEM. `evidenceReviewToken` is what a
 * judgment, a section confirmation, "I accept these unreviewed claims" and the
 * zero-claims completion stamp are all recorded against, so it answers "is this
 * the draft version the person was reading?". Two keys are pure functions of
 * other fields the token already carries and are dropped here:
 *
 *   - `styleAudit` (unit PUB1): `auditDraft`'s measurement OF the headline, dek
 *     and body, written by the ordinary editor save -- including the save the
 *     Publish press makes before it prints -- so hashing it moved every token on
 *     every save. That was the live bug: the editor accepted the claims for the
 *     draft on screen, pressed Publish, the press saved identical text, and the
 *     server refused in words drawn far from the button.
 *   - `evidenceReviewVersion` (unit ZC): the completion stamp itself, which IS
 *     this token's fingerprint. Hashing it would make the stamp a function of
 *     itself -- the stamp could never be written without moving the identity it
 *     is written to match.
 *
 * WHAT IS NOT WEAKENED. This drops those two keys and nothing else: the body,
 * headline, dek, topic, sources, provenance, findings, unanswered list and
 * transcript citations are all still hashed, so an edit a person could make
 * still takes a confirmation, an acceptance or a completion back.
 *
 * A row that has neither key is returned byte for byte, so tokens stored before
 * either change -- recorded confirmations, acceptances and completions -- still
 * match and nothing has to be confirmed again after the upgrade.
 */
function researchJsonWithoutDerivedKeys(raw: string | null | undefined): string | null | undefined {
  const text = raw ?? "{}";
  const parsed = memo(text);
  if (!parsed || (!(STYLE_AUDIT_KEY in parsed) && !(EVIDENCE_REVIEW_VERSION_KEY in parsed))) return raw;
  const { [STYLE_AUDIT_KEY]: _derivedStyle, [EVIDENCE_REVIEW_VERSION_KEY]: _derivedVersion, ...material } = parsed;
  return JSON.stringify(material);
}
export const EVIDENCE_REVIEW_VERSION_KEY = "evidenceReviewVersion";
/** Content identifies the evidence; an identical replacement row must keep its acceptance. */
export function evidenceReviewToken(draft: Partial<DraftRow>): string {
  return JSON.stringify([draft.headline, draft.dek, draft.topic, draft.body, draft.source_urls, draft.provenance_json, draft.found_note, draft.unanswered, researchJsonWithoutDerivedKeys(draft.research_json), transcriptCitationsFromResearch(draft.research_json)]);
}
/** Keep confirmations already recorded for this row valid across the token upgrade. */
export function evidenceConfirmationMatches(token: string | undefined, draft: Partial<DraftRow>): boolean {
  const content = evidenceReviewToken(draft);
  const legacy = JSON.stringify([draft.id, ...JSON.parse(content)]);
  return token === topicConfirmationFingerprint(content) || token === topicConfirmationFingerprint(legacy);
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

/** Keep the same research bytes when a reconcile only repeats its check timestamps. */
export function retainUnchangedReconcileResearch(previous: string | null | undefined, next: string): string {
  function material(raw: string | null | undefined) {
    const value = memo(raw);
    const { evidenceReconciledAt: _time, nameCheck, ...rest } = value;
    if (nameCheck && typeof nameCheck === "object" && !Array.isArray(nameCheck)) {
      const { checkedAt: _checkedAt, ...check } = nameCheck as Record<string, unknown>;
      rest.nameCheck = check;
    } else if (nameCheck !== undefined) rest.nameCheck = nameCheck;
    return JSON.stringify(rest);
  }
  return material(previous) === material(next) ? previous ?? next : next;
}
