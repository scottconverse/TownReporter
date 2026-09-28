import { withTransaction } from "../db.ts";
import { sanitizePublicUrls } from "./schema.ts";
import type { LeadRow } from "./types.ts";

export type LeadEditInput = {
  id: number;
  headline: string;
  why: string;
  topic: string;
  urls?: string[];
};

export type LeadEditResult =
  | { ok: true; id: number; message?: string }
  | { ok: false; error: string };

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
 * Refuses a killed or already-published lead: a killed lead is done, and a
 * published lead's headline/section live on the printed `articles` row (see
 * `updateArticleHeadline`), not on the lead that started it -- editing the
 * lead after publication would change nothing the reader sees and would read
 * to the editor as though it had.
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
  if (headline.length < 8) {
    return { ok: false, error: "Headline needs a full sentence." };
  }
  if (why.length < 8) {
    return { ok: false, error: "Say why this is news." };
  }
  const topic = (data.topic || "council").trim().slice(0, 40) || "council";
  const urls = sanitizePublicUrls(data.urls ?? []);
  const urlsJson = JSON.stringify(urls);

  return withTransaction(async (sql) => {
    const rows = await sql<Pick<LeadRow, "id" | "status">>`
      select id, status from leads where id = ${data.id} and newsroom_id = ${context.newsroomId} limit 1 for update
    `;
    const lead = rows[0];
    if (!lead) {
      return { ok: false, error: "Lead not found." };
    }
    if (lead.status === "killed") {
      return { ok: false, error: "This lead was killed. Restore it before editing." };
    }
    if (lead.status === "published") {
      return { ok: false, error: "This lead is already published. Edit the published story instead." };
    }

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
