import { getSql } from "../db.ts";
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
  | { ok: true; id: number }
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

  const sql = await getSql();
  const rows = await sql<Pick<LeadRow, "id" | "status">>`
    select id, status from leads where id = ${data.id} and newsroom_id = ${context.newsroomId} limit 1
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
           source_urls = ${JSON.stringify(urls)},
           edited_at = now(), edited_by = ${context.userId}
    where id = ${data.id} and newsroom_id = ${context.newsroomId}
  `;
  return { ok: true, id: data.id };
}
