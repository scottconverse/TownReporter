import { getSql } from "../db.ts";
import { audit } from "./ops.ts";

export type CorrectionContext = { userId: string; newsroomId: number };

/**
 * The server-side correction write, kept outside the route wrapper so its
 * newsroom boundary can be exercised against the real database.
 */
export async function performAddCorrection(
  context: CorrectionContext,
  input: { articleSlug?: string; body: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (body.length < 8) return { ok: false, error: "Write the correction." };
  const sql = await getSql();
  let articleId: number | null = null;
  if (input.articleSlug) {
    const rows = await sql<{ id: number }>`
      select id from articles
      where slug = ${input.articleSlug}
        and newsroom_id = ${context.newsroomId}
        and status = 'published'
      limit 1
    `;
    if (!rows[0]) {
      return { ok: false, error: "That published story is not available in this newsroom." };
    }
    articleId = rows[0].id;
  }
  await sql`
    insert into corrections (user_id, newsroom_id, article_id, body)
    values (${context.userId}, ${context.newsroomId}, ${articleId}, ${body})
  `;
  await audit(context.userId, "correction", input.articleSlug ?? "unspecified", context.newsroomId);
  return { ok: true };
}
