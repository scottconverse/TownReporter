import { withTransaction } from "../db.ts";
import { evidenceNeedsReview, evidenceReviewToken, reconcileDraftEvidence, type EvidenceDecision } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
import { editorialSourcesError, parseEditorial } from "./editorial.ts";
/** Standalone Opinion drafts only. Reporting drafts must use the lead-fenced workbench. */
export async function withEditorialDraft<T>(newsroomId: number, draftId: number, run: (sql: Awaited<ReturnType<typeof import("../db.ts").getSql>>, draft: DraftRow) => Promise<T>,
) {
  return withTransaction(async (sql) => {
    const [draft] = await sql<DraftRow>`select * from drafts where id = ${draftId} and newsroom_id = ${newsroomId} and form = 'editorial' and lead_id is null for update`;
    if (!draft) throw new Error("That standalone editorial is gone. Open reporting drafts from the story queue.");
    return run(sql, draft);
  });
}
/**
 * Standalone Opinion drafts only, for a caller that must not have the missing
 * row thrown at it.
 *
 * `performPublishEditorial` answers a person who pressed a button, and a row
 * that is not there (deleted in another tab, or a stale link) is an answer, not
 * a 500: it returns `null` and the publish path replies with a sentence. Every
 * other reader keeps `withEditorialDraft`, whose throw is the fence that keeps
 * a reporting draft out of the editorial screens.
 */
export async function withEditorialDraftOrNull<T>(
  newsroomId: number,
  draftId: number,
  run: (sql: Awaited<ReturnType<typeof import("../db.ts").getSql>>, draft: DraftRow) => Promise<T>,
): Promise<T | null> {
  return withTransaction(async (sql) => {
    const [draft] = await sql<DraftRow>`select * from drafts where id = ${draftId} and newsroom_id = ${newsroomId} and form = 'editorial' and lead_id is null for update`;
    if (!draft) return null;
    return run(sql, draft);
  });
}
export async function saveOpinionDraft(
  newsroomId: number,
  data: {
    draftId: number;
    headline: string;
    dek: string;
    body: string;
    topic: string;
    evidenceDecision?: EvidenceDecision;
    evidenceToken?: string;
  },
) {
  return withEditorialDraft(newsroomId, data.draftId, async (sql,draft) => {
    const decision=data.evidenceDecision === "keep" || data.evidenceDecision === "remove" ? data.evidenceDecision : undefined;
    if (decision && data.evidenceToken !== evidenceReviewToken(draft)) throw new Error("The draft or its evidence changed. Reload and review the current evidence before confirming.");
    const evidence=reconcileDraftEvidence(draft,data.body,decision);
    await sql`update drafts set headline=${data.headline.slice(0,300)},dek=${data.dek.slice(0,600)},body=${data.body},topic=${data.topic.slice(0,40)},source_urls=${evidence.source_urls},provenance_json=${evidence.provenance_json},found_note=${evidence.found_note},unanswered=${evidence.unanswered},research_json=${evidence.research_json},updated_at=now() where id=${draft.id} and newsroom_id=${newsroomId}`;
    return {ok:true as const};
  });
}

/**
 * One thing the desk would refuse to print, said as a warning a person can
 * acknowledge and print over.
 *
 * `key` is stable -- the client acknowledges by key, and the audit trail names
 * it -- so it must not drift with the wording. `sentence` is the desk's own
 * words, the ones the editor reads before deciding.
 */
export type EditorialPublishWarning = { key: string; sentence: string };

/**
 * Every reason `performPublishEditorial` would refuse to print this editorial,
 * all of which a person may override -- EXCEPT the true impossibilities
 * (missing, empty headline, empty body), which are not warnings at all and are
 * refused by the publish path however many keys arrive.
 *
 * The gate that used to be an outright throw now reads as a list, one entry
 * per reason, so a single press can carry an informed acknowledgement of all of
 * them (the reported workbench's `publish-overrides` pattern) instead of the
 * editor having to fix every one before the button speaks at all.
 */
export function opinionPublishWarnings(draft: DraftRow): EditorialPublishWarning[] {
  const warnings: EditorialPublishWarning[] = [];

  /*
    An editorial is filed with `dek: ""` (`editorial.server.ts`), whether the
    model wrote it or the editor pasted it in, so this is the commonest warning
    on the desk and the sentence is the server's own instruction.
  */
  if (!(draft.dek ?? "").trim()) {
    warnings.push({
      key: "dek",
      sentence: "Add a dek, the one-line summary under the headline, before you publish.",
    });
  }

  /*
    The editor changed the body after its retained evidence was checked, so the
    check no longer covers this text (`draft-evidence.ts` `evidenceNeedsReview`).
    The override is "keep this evidence" said at publish time, on the record.
  */
  if (evidenceNeedsReview(draft, draft.body)) {
    warnings.push({
      key: "evidence-stale",
      sentence: "Review the retained evidence before publishing this edited editorial.",
    });
  }

  /*
    The claims appendix every op-ed needs (`editorial.ts` `editorialSourcesError`).
    A person may print over it -- they can act informed -- so it is a warning,
    not a wall.
  */
  const sourcesError = editorialSourcesError(parseEditorial(`${draft.headline}\n\n${draft.body}`).appendix);
  if (sourcesError) {
    warnings.push({ key: "editorial-sources", sentence: sourcesError });
  }

  /*
    The section the piece files under. The `drafts_resolve_section` trigger
    keeps a stored row from being section-less through the ordinary path, so
    this is a guard rather than a common case -- but a blank section must never
    print silently, so it is a warning the editor can see and act on.
  */
  if (!(draft.topic ?? "").trim()) {
    warnings.push({
      key: "section",
      sentence: "Choose the section this editorial files under before you publish.",
    });
  }

  return warnings;
}

/**
 * The gate the editorial screens and older callers still ask for.
 *
 * It used to THROW on any of the warnings above. It now stands aside for a
 * warning whose key the caller has acknowledged (`acknowledged`, an
 * acknowledgement snapshot the editor saw), and throws only for the ones that
 * remain -- so an informed override can pass through the same door the old
 * callers use, and the words on the throw are unchanged for the ordinary case
 * of no acknowledgement at all.
 */
export function assertOpinionEvidenceReady(draft: DraftRow, acknowledged: readonly string[] = []) {
  const ack = new Set(acknowledged);
  /*
    Only the evidence gate's two reasons live here -- stale retained evidence and
    the claims appendix -- because that is exactly what this function has always
    thrown for; the dek and the section are the publish path's own warnings
    (`opinionPublishWarnings`), and folding them in would change the sentence an
    old caller's editor already reads. The order is the historical one: evidence
    first, then sources, so the old tests keep their message.
  */
  const gate = opinionPublishWarnings(draft).filter(
    (warning) => warning.key === "evidence-stale" || warning.key === "editorial-sources",
  );
  const first = gate.find((warning) => !ack.has(warning.key));
  if (first) throw new Error(first.sentence);
}
