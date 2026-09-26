import { withLeadDraftLock } from "./draft-order.server.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { evidenceReviewToken, reconcileDraftEvidence, type EvidenceDecision } from "./draft-evidence.ts";
import { headlineSourceAfterEdit } from "./headline-control.ts";
import { researchJsonWithStyleAudit, styleRecordForSavedText, type DraftStyleRecord } from "./draft-audit-record.ts";
import type { DraftRow } from "./types.ts";
export type DraftEditInput = { leadId: number; headline: string; dek: string; body: string; topic: string; evidenceDecision?: EvidenceDecision; evidenceToken?: string };
/**
 * Save the editor's draft.
 *
 * `style` is the audit record to store. When it is not given -- the ordinary
 * save, and the publish-time save -- the desk measures the text it is about to
 * write, in code and with no model, so the Style check list on the story page
 * is never stale. When it IS given, a repair run has already decided it, and
 * that record describes the body being saved here.
 */
export async function saveDraftForEditor(context: { userId: string; newsroomId: number }, data: DraftEditInput, style?: DraftStyleRecord | null) {
  return withLeadDraftLock(context, data.leadId, async (sql) => {
    const existing = await sql<DraftRow>`
      select * from drafts where lead_id = ${data.leadId} and newsroom_id = ${context.newsroomId}
      order by updated_at desc, id desc limit 1 for update
    `;
    const body = stripReporterNotebook(data.body);
    const decision = data.evidenceDecision === "keep" || data.evidenceDecision === "remove" ? data.evidenceDecision : undefined;
    /*
      No timestamp on this record, deliberately: the audit is a pure function
      of the text, so saving the same draft twice writes the same bytes and the
      evidence-review token does not move under the editor's hands. The repair
      path records when it ran, because something really did happen there.
    */
    const styleRecord = () =>
      style ?? styleRecordForSavedText({ headline: data.headline, dek: data.dek, body, form: existing[0]?.form });
    if (existing[0]) {
      if (decision && data.evidenceToken !== evidenceReviewToken(existing[0])) throw new Error("The draft or its evidence changed. Reload and review the current evidence before confirming.");
      const evidence = reconcileDraftEvidence(existing[0], body, decision);
      const researchJson = researchJsonWithStyleAudit(evidence.research_json, styleRecord());
      /*
        WHO WROTE THIS HEADLINE (0.6.67). A redraft replaces the row, so the
        desk has to know whether the headline it is about to replace was the
        editor's. `headline_source` is that answer; it is stamped on every
        editor save from the headline actually being saved, so an editor who
        only rewrote the body leaves it reading `model` and a redraft is still
        free to write a new one.
      */
      const headlineSource = headlineSourceAfterEdit(existing[0], data.headline);
      await sql`
        update drafts set headline = ${data.headline}, dek = ${data.dek}, body = ${body},
          topic = ${data.topic}, headline_source = ${headlineSource},
          source_urls = ${evidence.source_urls}, provenance_json = ${evidence.provenance_json},
          found_note = ${evidence.found_note}, unanswered = ${evidence.unanswered}, research_json = ${researchJson}, updated_at = now()
        where id = ${existing[0].id} and newsroom_id = ${context.newsroomId}
      `;
    } else {
      const lead = await sql<{id:number}>`select id from leads where id = ${data.leadId} and newsroom_id = ${context.newsroomId}`;
      if (!lead[0]) throw new Error("Lead not found");
      /*
        No draft row at all: the editor typed the first one, so the headline is
        theirs by construction -- and the column's default is `model`, which
        would be a lie about a headline the model never wrote.
      */
      await sql`insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, headline_source, research_json)
        values (${context.userId}, ${context.newsroomId}, ${data.leadId}, ${data.headline}, ${data.dek}, ${body}, ${data.topic}, 'editor', ${researchJsonWithStyleAudit(null, styleRecord())})`;
    }
    return { ok: true as const };
  });
}
