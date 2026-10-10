import { withTransaction } from "../db.ts";
import { sanitizePublicUrls } from "./schema.ts";
import type { LeadRow } from "./types.ts";
import { editorWarning, type EditorWarning } from "./editor-override.ts";
import { ensureAuditEventsSchema } from "./ops.ts";

export type LeadEditInput = {
  id: number;
  headline: string;
  why: string;
  topic: string;
  urls?: string[];
  /** The keys the editor has already approved this press (Scott's rule). */
  override?: string[];
};

export type LeadEditResult =
  | { ok: true; id: number; message?: string }
  | { ok: false; error: string; warning?: EditorWarning };

/**
 * "Edit the lead" (design review note 2, 0.6.80): change the title, notes or
 * section the drawn row promises, before the lead is drafted.
 *
 * Same shape as `saveDraftForEditor` (`draft-edit.server.ts`): a plain
 * function over `{ userId, newsroomId }` and the validated input, so it can be
 * called directly from a test with a real (PGlite) `leads` table and from
 * `desk.ts`'s `updateLead` server function alike -- `desk.ts` itself cannot be
 * imported under `node --experimental-strip-types` (its own imports reach
 * providers that need a bundler), so the behavior lives here where a test can
 * reach it.
 *
 * Refuses an EMPTY headline (hard: there is nothing to save) and a lead that
 * cannot be found (hard: it is gone). Everything else -- a short headline, a
 * missing why, a killed or already-published lead -- WARNS and lets the
 * editor's second press (naming the key in `override`) go through, per Scott's
 * rule (Oct 10, 2026): outside the Publish path the desk warns, never blocks.
 * The two hard cases keep their old sentence and carry no warning key.
 *
 * A killed lead and a published lead both warn because the editor deserves the
 * reason -- a killed lead is done, and a published lead's headline/section now
 * live on the printed `articles` row (see `updateArticleHeadline`) -- but a
 * person who has read that can still choose to edit the lead row underneath.
 *
 * Also carries the edit to the companion draft `insertLeadWithDraft`
 * (`desk.ts:451`) filed at the same time as the lead -- see the comment
 * inline below for why and for the eligibility rule that keeps this from
 * ever overwriting a draft someone has actually worked on.
 */
export async function updateLeadForEditor(
  context: { userId: string; newsroomId: number },
  data: LeadEditInput,
): Promise<LeadEditResult> {
  const headline = data.headline.trim().slice(0, 180);
  const why = data.why.trim().slice(0, 800);
  // HARD: an empty headline has nothing to save -- no key, no override.
  if (!headline) {
    return { ok: false, error: "Headline needs a full sentence." };
  }
  if (headline.length < 8) {
    const shortHeadline = await editorWarning(
      context,
      data.override,
      "lead-edit-headline-short",
      "Headline needs a full sentence.",
      { kind: "lead", id: data.id },
    );
    if (shortHeadline) return shortHeadline;
  }
  if (why.length < 8) {
    // NOTE: this warning is the one place an EMPTY why is allowed through (a
    // lead may carry no note). Only an empty headline and a gone record stay
    // hard, per the task; a missing why is a warning.
    const whyWarning = await editorWarning(
      context,
      data.override,
      "lead-edit-why",
      "Say why this is news.",
      { kind: "lead", id: data.id },
    );
    if (whyWarning) return whyWarning;
  }
  const topic = (data.topic || "council").trim().slice(0, 40) || "council";
  const urls = sanitizePublicUrls(data.urls ?? []);
  const urlsJson = JSON.stringify(urls);

  // The override audit rides the transaction, so its schema has to exist before
  // the transaction opens (DDL cannot run inside it).
  await ensureAuditEventsSchema();
  return withTransaction(async (sql) => {
    const rows = await sql<Pick<LeadRow, "id" | "status">>`
      select id, status from leads where id = ${data.id} and newsroom_id = ${context.newsroomId} limit 1 for update
    `;
    const lead = rows[0];
    // HARD: a record that is gone is never overridden.
    if (!lead) {
      return { ok: false, error: "Lead not found." };
    }
    const killed = lead.status === "killed"
      ? await editorWarning(
          { ...context, sql },
          data.override,
          "lead-edit-killed",
          "This lead was killed. Saving this edit will keep it killed.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (killed) return killed;
    const published = lead.status === "published"
      ? await editorWarning(
          { ...context, sql },
          data.override,
          "lead-edit-published",
          "This lead has a published story. This edit changes the lead, while the published story keeps its current text.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (published) return published;

    await sql`
      update leads set headline = ${headline}, why = ${why}, topic = ${topic},
             source_urls = ${urlsJson},
             edited_at = now(), edited_by = ${context.userId}
      where id = ${data.id} and newsroom_id = ${context.newsroomId}
    `;

    /*
      Carry the edit to the companion draft `insertLeadWithDraft` (desk.ts:451)
      filed alongside this lead -- the workbench and `publishLead` read their
      headline/section/sources off the latest DRAFT, not the lead
      (desk.ts:391, desk.ts:1671), so an edit that stopped at `leads` would be
      invisible everywhere a reader or an editor actually looks.

      Only a draft still wearing its filing copy is eligible: `updated_at`
      equals `created_at` exactly, because every real write to a draft --
      `saveDraftForEditor` (draft-edit.server.ts:47), a redraft, the writer's
      own checkpoint saves -- stamps `updated_at = now()` on the row it
      touches. A draft an editor or the AI writer has since worked on no
      longer satisfies that equality, and this update leaves it alone: the
      story it is already being written from keeps its own words.
    */
    const draftRows = await sql<{ id: number }>`
      select id from drafts
      where lead_id = ${data.id} and newsroom_id = ${context.newsroomId} and updated_at = created_at
      for update
    `;
    if (draftRows.length === 0) {
      return {
        ok: true,
        id: data.id,
        message: "The story draft keeps its own headline, section and sources.",
      };
    }
    for (const draft of draftRows) {
      await sql`
        update drafts set headline = ${headline}, topic = ${topic}, source_urls = ${urlsJson}
        where id = ${draft.id} and newsroom_id = ${context.newsroomId}
      `;
    }
    return { ok: true, id: data.id };
  });
}
