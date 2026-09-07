import { withTransaction } from "../db.ts";
import { evidenceNeedsReview, evidenceReviewToken, reconcileDraftEvidence, type EvidenceDecision } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
/** Standalone Opinion drafts only. Reporting drafts must use the lead-fenced workbench. */
export async function withEditorialDraft<T>(newsroomId: number, draftId: number, run: (sql: Awaited<ReturnType<typeof import("../db.ts").getSql>>, draft: DraftRow) => Promise<T>) {
  return withTransaction(async sql => {
    const [draft] = await sql<DraftRow>`select * from drafts where id = ${draftId} and newsroom_id = ${newsroomId} and form = 'editorial' and lead_id is null for update`;
    if (!draft) throw new Error("That standalone editorial is gone. Open reporting drafts from the story queue.");
    return run(sql, draft);
  });
}
export async function saveOpinionDraft(newsroomId: number, data: {draftId:number;headline:string;dek:string;body:string;topic:string;evidenceDecision?:EvidenceDecision;evidenceToken?:string}) {
  return withEditorialDraft(newsroomId, data.draftId, async (sql,draft) => {
    const decision=data.evidenceDecision === "keep" || data.evidenceDecision === "remove" ? data.evidenceDecision : undefined;
    if (decision && data.evidenceToken !== evidenceReviewToken(draft)) throw new Error("The draft or its evidence changed. Reload and review the current evidence before confirming.");
    const evidence=reconcileDraftEvidence(draft,data.body,decision);
    await sql`update drafts set headline=${data.headline.slice(0,300)},dek=${data.dek.slice(0,600)},body=${data.body},topic=${data.topic.slice(0,40)},source_urls=${evidence.source_urls},provenance_json=${evidence.provenance_json},found_note=${evidence.found_note},unanswered=${evidence.unanswered},research_json=${evidence.research_json},updated_at=now() where id=${draft.id} and newsroom_id=${newsroomId}`;
    return {ok:true as const};
  });
}
export function assertOpinionEvidenceReady(draft: DraftRow) {
  if (evidenceNeedsReview(draft,draft.body)) throw new Error("Review the retained evidence before publishing this edited editorial.");
}
