import { withTransaction } from "../db.ts";
import { audit } from "./ops.ts";
import { completePublishedMeetingReviewWithCorrection } from "./meeting-article-revision.ts";
import { bodyEditRecord } from "./correction-wording.ts";
import { LIMITS } from "./request-input.ts";

export type CorrectionContext = { userId: string; newsroomId: number };

/**
 * The server-side correction write, kept outside the route wrapper so its
 * newsroom boundary can be exercised against the real database.
 *
 * 0.6.70 adds the second half of a correction. Until this release the printed
 * body was immutable, so a story whose copy said "$4,200" when the fee was
 * $2,400 kept saying it, under a note saying it did not. `alsoFixBody` lets the
 * editor change the text and publish the note as one act.
 *
 * ATOMIC, AND ONE ACT. Both writes are in the transaction below, so a body that
 * changed without its note -- or a note without the change it promises -- is
 * not a state this desk can reach. The old text goes to `article_body_history`
 * (migration 0095) with the correction's own id, which is what ties the two
 * halves back together for anyone reading the record later.
 *
 * The default is still note-only, which is what every existing caller sends and
 * what the desk shows first.
 */
export async function performAddCorrection(
  context: CorrectionContext,
  input: {
    articleSlug?: string;
    body: string;
    meetingReviewId?: number;
    /** Change the printed story text as well as publishing the note. */
    alsoFixBody?: boolean;
    /** The body the story should carry. Only read when `alsoFixBody` is true. */
    storyBody?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (body.length < 8) return { ok: false, error: "Write the correction." };
  /*
    The body is checked before the transaction so a fix with nothing in it is
    refused in a sentence, not by an empty story page. A body edit needs a
    story: a correction with no slug is an unattached note, and there is no
    printed text to change.
  */
  const fixing = input.alsoFixBody === true;
  const nextBody = fixing ? String(input.storyBody ?? "").trim() : "";
  /*
    A transcript-review correction completes a review against the story it came
    from, so it can only be posted against that story. This is a broken caller
    rather than an editor's mistake, so it throws the way it always has.
  */
  if (input.meetingReviewId != null && !input.articleSlug) {
    throw new Error("A transcript-review correction must target its published story.");
  }
  if (fixing) {
    if (!input.articleSlug) {
      return { ok: false, error: "To fix the story text, choose the published story it belongs to." };
    }
    if (!nextBody) {
      return { ok: false, error: "The story text cannot be blank. Put the corrected story in the box, then post." };
    }
    if (nextBody.length > LIMITS.storyText) {
      return { ok: false, error: "That story text is too long to save." };
    }
  }
  const saved = await withTransaction(async (sql) => {
    let articleId: number | null = null;
    if (input.articleSlug) {
      const rows = await sql<{ id: number; body: string | null }>`
        select id, body from articles
        where slug = ${input.articleSlug}
          and newsroom_id = ${context.newsroomId}
          and status = 'published'
        limit 1
      `;
      if (!rows[0]) return { ok: false as const, error: "That published story is not available in this newsroom." };
      articleId = rows[0].id;
      /*
        The record is built inside the transaction, off the row that is about to
        be updated, so the "before" text in the history is the text that was
        really there rather than what the desk was showing a moment ago.
      */
      const edit = fixing ? bodyEditRecord(rows[0], nextBody) : null;
      if (fixing && !edit) {
        return {
          ok: false as const,
          error: "The story text you typed is the same as the story text on the paper, so nothing was changed.",
        };
      }
      const [correction] = await sql<{ id: number }>`
        insert into corrections (user_id, newsroom_id, article_id, body)
        values (${context.userId}, ${context.newsroomId}, ${articleId}, ${body})
        returning id
      `;
      if (edit) {
        await sql`
          update articles set body = ${edit.newBody}
          where id = ${articleId} and newsroom_id = ${context.newsroomId}
        `;
        await sql`
          insert into article_body_history
            (newsroom_id, article_id, old_body, new_body, changed_by, correction_id)
          values (
            ${context.newsroomId}, ${articleId}, ${edit.oldBody}, ${edit.newBody},
            ${context.userId}, ${correction.id}
          )
        `;
      }
      if (input.meetingReviewId != null) {
        await completePublishedMeetingReviewWithCorrection(sql, {
          newsroomId: context.newsroomId,
          reviewId: input.meetingReviewId,
          articleId,
          correctionId: correction.id,
          reviewerId: context.userId,
        });
      }
      return { ok: true as const, fixedBody: Boolean(edit), correctionId: correction.id, articleId };
    }
    const [correction] = await sql<{ id: number }>`
      insert into corrections (user_id, newsroom_id, article_id, body)
      values (${context.userId}, ${context.newsroomId}, ${articleId}, ${body})
      returning id
    `;
    return { ok: true as const, fixedBody: false, correctionId: correction.id, articleId };
  });
  if (!saved.ok) return saved;
  /*
    Audited after the transaction, where the rest of the publish path's audits
    sit: `audit` writes on the pooled connection, and on PGlite there is one
    connection, so writing from inside a transaction deadlocks it.
  */
  await audit(context.userId, "correction", input.articleSlug ?? "unspecified", context.newsroomId);
  // `fixedBody` is only ever true on the branch that found the article, so the
  // id travels with it; the guard is for the type, not for a real state.
  if (saved.fixedBody && saved.articleId != null) {
    await audit(
      context.userId,
      "edit_article_body",
      `Article ${saved.articleId}: story text changed with correction ${saved.correctionId}`,
      context.newsroomId,
      { kind: "articles", id: saved.articleId },
    );
  }
  return { ok: true };
}
