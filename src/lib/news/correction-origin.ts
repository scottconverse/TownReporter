/*
  Which corrections a machine wrote, and what to call them in public.

  A correction reaches `/corrections` from two places, and until now the page
  drew both the same way: an editor's row, written through
  `src/lib/news/corrections.ts` after a person decided the story was wrong, and
  the row `routine-notice-worker.server.ts` appends when a routine edition
  changes after it printed -- no editor action, no one reading it, just the
  worker noticing the approved source moved. The second is the only automated
  byline the paper has, and it should not read like the first.

  WHY THE MARKER IS THE BODY'S OPENING WORDS AND NOT A COLUMN.

  The obvious home for this would be a `corrections` column, and there is
  none: `corrections` is (id, user_id, newsroom_id, article_id, body,
  created_at) and nothing else (migrations/0002_newsroom.sql:92,
  0012_newsroom_appliance.sql:25). The other candidate is not a column of the
  row at all -- `routine_notice_publications`, which `getPublishedArticle`
  already joins to tell a routine notice's own article apart from a reported
  story. That answers a different question. It says the ARTICLE came from a
  fixed template; a correction on that article can still be an editor's, and
  an editor correcting a routine notice would be labelled automatic by it --
  the one mistake this label must not make, because it would disown a
  correction a person made on purpose.

  So the signal is the one the writer already emits, made explicit here rather
  than left as a string literal in two files: the worker writes
  `ROUTINE_EDITION_UPDATE_PREFIX` at the head of every row it inserts, and this
  module is what both sides read it from. No schema change, which is what the
  unit asked for wherever it was avoidable; the cost, stated plainly, is that
  the marker lives in the row's text, so an editor who edits a routine-notice
  correction's opening words by hand and removes the prefix turns the label
  off. Nothing in the desk offers that edit (`corrections.ts` writes new rows,
  it does not rewrite old ones), and the alternative was a migration that
  `migrations/0108` -- a copy fix with no schema work in it -- did not need.
*/

/** The exact opening the routine-notice worker writes on every correction it appends. */
export const ROUTINE_EDITION_UPDATE_PREFIX = "Routine edition update:";

/** What the reader is told about one of those rows, so it is not read as an editor's. */
export const ROUTINE_EDITION_UPDATE_LABEL = "Automatic routine-notice update";

/** True when this correction body was written by the routine-notice worker rather than an editor. */
export function correctionIsAutomatic(body: string): boolean {
  return body.startsWith(ROUTINE_EDITION_UPDATE_PREFIX);
}
