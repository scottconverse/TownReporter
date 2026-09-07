import { withTransaction } from "../db.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
type Sql = Awaited<ReturnType<typeof import("../db.ts").getSql>>;
export async function withCurrentDraftForPublish<T>(context: { newsroomId: number }, leadId: number, expected: DraftRow, run: (sql: Sql) => Promise<T>): Promise<T> {
  return withTransaction(async sql => {
    const [current] = await sql<DraftRow>`select * from drafts where id = ${expected.id} and newsroom_id = ${context.newsroomId} for update`;
    if (!current || evidenceReviewToken(current) !== evidenceReviewToken(expected)) throw new Error("The draft changed while publishing. Reload and review it before publishing.");
    return run(sql);
  });
}
