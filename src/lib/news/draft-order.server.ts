import { withTransaction } from "../db.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
type Sql = Awaited<ReturnType<typeof import("../db.ts").getSql>>;
/** All changes to a lead's authoritative draft use the same parent-row fence.
 * A lock on draft A alone cannot stop another transaction inserting draft B. */
export async function withLeadDraftLock<T>(context: { newsroomId: number }, leadId: number, run: (sql: Sql, status: string | null) => Promise<T>): Promise<T> {
  return withTransaction(async sql => {
    const [lead] = await sql<{id:number;status:string|null}>`select id, to_jsonb(leads)->>'status' as status from leads where id = ${leadId} and newsroom_id = ${context.newsroomId} for update`;
    if (!lead) throw new Error("Lead not found");
    if (lead.status === "published") throw new Error("This lead has already been published. Use Published to make a correction.");
    if (lead.status === "killed") throw new Error("Restore this lead before changing its draft.");
    return run(sql, lead.status);
  });
}
export async function withCurrentDraftForPublish<T>(context: { newsroomId: number }, leadId: number, expected: DraftRow, run: (sql: Sql) => Promise<T>): Promise<T> {
  return withLeadDraftLock(context, leadId, async (sql, status) => {
    if (status === "held") throw new Error("Un-hold this lead before publishing.");
    const [current] = await sql<DraftRow>`select * from drafts where lead_id = ${leadId} and newsroom_id = ${context.newsroomId} order by updated_at desc, id desc limit 1 for update`;
    if (!current || evidenceReviewToken(current) !== evidenceReviewToken(expected)) throw new Error("The draft changed while publishing. Reload and review it before publishing.");
    return run(sql);
  });
}
