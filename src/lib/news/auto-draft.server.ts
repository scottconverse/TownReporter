import { withTransaction, type Sql } from "../db.ts";
import { saveDraftRefusalNote } from "./draft-refusal-note.server.ts";

/**
 * ── THE PAPER DRAFTS ITS OWN HIGH-SCORING LEADS ─────────────────────────────
 *
 * Scott's order (Nov 16 2026), word for word: "I want the paper to write a
 * draft on any stories that score higher than 13 (14 and up)."
 *
 * `leads.newsworthiness` is the 4-to-20 total the desk adds from the four score
 * parts (./lead-score.ts), and 14 is already the "hot" line the Queue draws, so
 * the threshold lives here once and every reader (this rule, a test) uses it.
 * A lead at 13 or below is never queued by this rule.
 */
export const AUTO_DRAFT_SCORE_THRESHOLD = 14;

/**
 * The three things this rule may ask of one lead, in the shape
 * `commitStoryDraftForAuthenticatedEditor` already answers in. Kept narrow so a
 * test can stand in for the commit path without loading it.
 */
export type AutoDraftCommitResult = {
  ok: boolean;
  error?: string;
  kind?: string;
};

export type AutoDraftDeps = {
  /**
   * The SAME commit boundary the Draft button presses
   * (`commitStoryDraftForAuthenticatedEditor`): same setup refusal, same
   * preflight, same enqueue. Injected only by tests; production leaves it out
   * and the real path is imported on first use.
   */
  commitDraft?: (input: {
    context: { userId: string; newsroomId: number };
    leadId: number;
    modelChoice: "auto";
    modelChoiceExplicit: boolean;
  }) => Promise<AutoDraftCommitResult>;
  /** Test seam for the refusal note; defaults to the desk's own writer. */
  noteRefusal?: (
    newsroomId: number,
    leadId: number,
    refusal: { text: string; at: string } | null,
  ) => Promise<void>;
};

export type AutoDraftOutcome = {
  /** Eligible leads this sweep looked at. */
  considered: number;
  /** Leads whose draft job the commit path accepted (new or already pending). */
  queued: number;
  /** Leads the preflight (or setup, or a rate limit) refused. */
  refused: number;
};

/**
 * Keep the last Draft refusal on the lead, exactly the way `noteDraftRefusal`
 * in desk.ts does: a failed note write is warned about and swallowed, so it can
 * never change the sweep's own outcome or crash the scan that called it.
 */
async function noteDraftRefusal(
  newsroomId: number,
  leadId: number,
  refusal: { text: string; at: string } | null,
): Promise<void> {
  try {
    await withTransaction((tx) => saveDraftRefusalNote(tx, newsroomId, leadId, refusal));
  } catch (error) {
    console.warn("[desk] could not record the automatic draft refusal on the lead's notes", error);
  }
}

/**
 * Queue a draft for every lead in this newsroom that scores
 * `AUTO_DRAFT_SCORE_THRESHOLD` or more and is not already in hand.
 *
 * A lead is skipped when it is not `new` (so a killed, held, published or
 * already-drafted lead never comes back through this rule), when it already
 * carries a written draft, when it is at or below the threshold, or when a
 * draft job for it is still queued or running.
 *
 * One lead's refusal never stops the sweep: the refusal note is kept the way
 * the Draft button keeps it, and the next lead is tried. This function never
 * throws for a per-lead reason; the caller still wraps it so that a database
 * failure cannot crash the scan either.
 */
export async function autoDraftEligibleLeads(
  sql: Sql,
  context: { userId: string; newsroomId: number },
  deps: AutoDraftDeps = {},
): Promise<AutoDraftOutcome> {
  const rows = await sql<{ id: number }>`
    select l.id
    from leads l
    where l.newsroom_id = ${context.newsroomId}
      and l.status = 'new'
      and coalesce(l.newsworthiness, 0) >= ${AUTO_DRAFT_SCORE_THRESHOLD}
      and not exists (
        select 1 from drafts d
        where d.lead_id = l.id
          and d.newsroom_id = l.newsroom_id
          and (
            d.body ~ '[^[:space:]]'
            or coalesce(nullif(btrim(d.research_json), ''), '{}')::jsonb->>'importedText' = 'true'
          )
      )
      and not exists (
        select 1 from desk_jobs j
        where j.newsroom_id = l.newsroom_id
          and j.kind = 'draft'
          and j.subject_id = l.id
          and j.status in ('queued', 'running')
      )
    order by l.newsworthiness desc, l.id asc
  `;

  const note = deps.noteRefusal ?? noteDraftRefusal;
  let commit = deps.commitDraft;
  if (!commit) {
    const { commitStoryDraftForAuthenticatedEditor } = await import(
      "./model-request-commit.server.ts"
    );
    commit = commitStoryDraftForAuthenticatedEditor as unknown as NonNullable<
      AutoDraftDeps["commitDraft"]
    >;
  }

  let queued = 0;
  let refused = 0;
  for (const row of rows) {
    const leadId = Number(row.id);
    let result: AutoDraftCommitResult;
    try {
      result = await commit({
        context: { userId: context.userId, newsroomId: context.newsroomId },
        leadId,
        // The same pick the Draft button makes when nobody has chosen one: the
        // paper decides. `modelChoiceExplicit: false` lets the saved assignment
        // and the meeting-writer redirect speak, exactly as a press does.
        modelChoice: "auto",
        modelChoiceExplicit: false,
      });
    } catch (error) {
      // One lead's failure is that lead's failure: it is counted, said out
      // loud, and the sweep goes on. Only a failure of the SELECT above (or of
      // the caller's own wiring) can escape, and the scan wraps this whole
      // call so even that cannot crash the run.
      console.warn(`[desk] automatic draft for lead ${leadId} could not run`, error);
      refused += 1;
      continue;
    }
    if (result.ok) {
      queued += 1;
      continue;
    }
    refused += 1;
    if (result.kind) {
      await note(context.newsroomId, leadId, {
        text: result.error ?? "",
        at: new Date().toISOString(),
      });
    }
  }

  return { considered: rows.length, queued, refused };
}
