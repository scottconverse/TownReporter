import type { EditorialRow } from "./opinion.ts";

/*
  The Drafts page lists rows from `DESK_DRAFT_ROWS_SQL`, which joins `leads`.
  A piece filed through the Opinion desk's paste box has no lead -- it is a
  draft with form 'editorial' and `lead_id` null -- so it never appeared on
  the Drafts page at all. The editor pasted a long column, read "filed", and
  could not find it where every other unfinished piece lives.

  What belongs in that section: a piece that EXISTS (has a draft), is DONE
  (finished_at set -- nothing is still writing), and has not PRINTED yet
  (no published_slug). Input order is kept, so the newest stays first.

  Pure and exported so the rule is testable without a database.
*/
export function opinionDraftsWaiting<
  T extends Pick<EditorialRow, "draft_id" | "finished_at" | "published_slug">,
>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) => row.draft_id != null && row.finished_at != null && row.published_slug == null,
  );
}
