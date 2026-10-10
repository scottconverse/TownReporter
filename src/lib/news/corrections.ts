import { withTransaction } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX } from "./correction-origin.ts";
import { audit } from "./ops.ts";
import { auditOverrides, checkOverride, type OverrideWarning } from "./override.ts";
import { completePublishedMeetingReviewWithCorrection } from "./meeting-article-revision.ts";
import { bodyEditRecord } from "./correction-wording.ts";
import { LIMITS } from "./request-input.ts";

export type CorrectionContext = { userId: string; newsroomId: number };

/** The warning key for a correction under the desk's 8-character floor. */
export const CORRECTION_SHORT_KEY = "correction-short";
/** The warning key for a correction that opens with the machine's byline marker. */
export const CORRECTION_ROUTINE_PREFIX_KEY = "correction-routine-prefix";
/** The warning key for a story fix longer than the column can hold. */
export const STORY_TEXT_TOO_LONG_KEY = "story-text-too-long";

const CORRECTION_SHORT_WARNING =
  "This correction is shorter than the desk's 8-character floor, so it may not tell a reader what the story got wrong.";
const CORRECTION_ROUTINE_PREFIX_WARNING =
  "That opening line is the marker the desk writes on corrections it makes by itself. Posting it anyway keeps your own words and drops that opening, so no reader reads it as automatic.";
const STORY_TEXT_TOO_LONG_WARNING = "That story text is longer than the desk can save.";

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
    /**
     * Warning keys this caller has already accepted (audit items 8-11). Absent
     * on the first call, which is what draws the warning; the second call names
     * the key the warning carried.
     */
    override?: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string } | OverrideWarning> {

  const accepted: string[] = [];

  let body = input.body.trim();
  if (body.startsWith(ROUTINE_EDITION_UPDATE_PREFIX)) {
    const warning = checkOverride(
      input,
      CORRECTION_ROUTINE_PREFIX_KEY,
      CORRECTION_ROUTINE_PREFIX_WARNING,
    );
    if (warning) return warning;
    accepted.push(CORRECTION_ROUTINE_PREFIX_KEY);
    body = body.slice(ROUTINE_EDITION_UPDATE_PREFIX.length).trim();
  }
  /*
    AUDIT ITEM 8: the house floor (8 characters) is a QUESTION now, not a wall.
    It is asked on the words that will actually be stored, after the machine's
    marker has been removed, because that is the correction a reader sees.
  */
  if (body.length < 8) {
    const warning = checkOverride(input, CORRECTION_SHORT_KEY, CORRECTION_SHORT_WARNING);
    if (warning) return warning;
    accepted.push(CORRECTION_SHORT_KEY);
  }
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
      return {
        ok: false,
        error: "To fix the story text, choose the published story it belongs to.",
      };
    }
    /*
      KEEP (audit item 11). An empty story body is not a question: the desk will
      not print a story with no words in it, and no override makes one. This is
      the one correction refusal the audit left as a refusal.
    */
    if (!nextBody) {
      return {
        ok: false,
        error: "The story text cannot be blank. Put the corrected story in the box, then post.",
      };
    }

    if (nextBody.length > LIMITS.storyText) {
      const warning = checkOverride(input, STORY_TEXT_TOO_LONG_KEY, STORY_TEXT_TOO_LONG_WARNING);
      if (warning) return warning;
      accepted.push(STORY_TEXT_TOO_LONG_KEY);
    }
  }
  const saved = await withTransaction(async (sql) => {
    let articleId: number | null = null;
    if (input.articleSlug) {
      /*
        Two statements, not one, and the predicate is the same in both on
        purpose: the note-only path reads the story's `id` and nothing else.
        `body` is only ever needed to build the history record when the editor
        is fixing the text, and asking for it here made a note-only correction
        depend on a column it never used -- a desk that can publish a note about
        a story it cannot read the text of is a desk that works on a schema
        without `body` at all (which is what
        corrections-newsroom-boundary.test.ts's own fixture is). Do not merge
        these back into one `select id, body`: a conditional expression still
        names the column, so the parse fails on a table that has no `body`.
      */
      /*
        `body` is optional in the annotation because the note-only statement
        below does not select it: the desk has no text for a row it never read,
        and `bodyEditRecord` is only ever handed one from the branch that did
        (the `fixing` guard). Left bare, the two statement types would collapse
        into one row type that claims a `body` the note-only path never asked
        for -- which is the shape that started this.
      */
      const rows: { id: number; body?: string | null }[] = fixing
        ? await sql<{ id: number; body: string | null }>`
            select id, body from articles
            where slug = ${input.articleSlug}
              and newsroom_id = ${context.newsroomId}
              and status = 'published'
            limit 1
          `
        : await sql<{ id: number }>`
            select id from articles
            where slug = ${input.articleSlug}
              and newsroom_id = ${context.newsroomId}
              and status = 'published'
            limit 1
          `;
      if (!rows[0])
        return {
          ok: false as const,
          error: "That published story is not available in this newsroom.",
        };
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
          error:
            "The story text you typed is the same as the story text on the paper, so nothing was changed.",
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
      return {
        ok: true as const,
        fixedBody: Boolean(edit),
        correctionId: correction.id,
        articleId,
      };
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

  if (accepted.length > 0) {
    await auditOverrides(
      context,
      accepted,
      saved.articleId != null
        ? { kind: "articles", id: saved.articleId }
        : { kind: "corrections", id: saved.correctionId },
    );
  }
  return { ok: true };
}
