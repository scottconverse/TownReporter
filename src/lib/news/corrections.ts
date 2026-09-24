import { withTransaction } from "../db.ts";
import { audit } from "./ops.ts";
import { completePublishedMeetingReviewWithCorrection } from "./meeting-article-revision.ts";

export type CorrectionContext = { userId: string; newsroomId: number };

/**
 * The server-side correction write, kept outside the route wrapper so its
 * newsroom boundary can be exercised against the real database.
 */
export async function performAddCorrection(
  context: CorrectionContext,
  input: { articleSlug?: string; body: string; meetingReviewId?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (body.length < 8) return { ok: false, error: "Write the correction." };
  const saved = await withTransaction(async (sql) => {
    let articleId: number | null = null;
    if (input.articleSlug) {
      const rows = await sql<{ id: number }>`
        select id from articles
        where slug = ${input.articleSlug}
          and newsroom_id = ${context.newsroomId}
          and status = 'published'
        limit 1
      `;
      if (!rows[0]) return { ok: false as const, error: "That published story is not available in this newsroom." };
      articleId = rows[0].id;
    }
    const [correction] = await sql<{ id: number }>`
      insert into corrections (user_id, newsroom_id, article_id, body)
      values (${context.userId}, ${context.newsroomId}, ${articleId}, ${body})
      returning id
    `;
    if (input.meetingReviewId != null) {
      if (articleId == null) throw new Error("A transcript-review correction must target its published story.");
      await completePublishedMeetingReviewWithCorrection(sql, {
        newsroomId: context.newsroomId,
        reviewId: input.meetingReviewId,
        articleId,
        correctionId: correction.id,
        reviewerId: context.userId,
      });
    }
    return { ok: true as const };
  });
  if (!saved.ok) return saved;
  await audit(context.userId, "correction", input.articleSlug ?? "unspecified", context.newsroomId);
  return { ok: true };
}
