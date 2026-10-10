/**
 * ONE RULE FOR WHAT ONE ATTEMPT DOES TO A SOURCE ROW (HIGH-1, A-B8).
 *
 * A source row is written from three places: the scan's fetch loop when the
 * editor pressed the button, the scan's queued touches when a scheduler started
 * the pass, and the editor's own Check press. They used to write three separate
 * statements, and they drifted -- the scheduled one decided "did we read this?"
 * from `last_error is null`, which is exactly what a 429 touch carries on
 * purpose, so an unattended scan recorded a site that said "come back later" as
 * a successful read: streak wiped, `last_ok_at` stamped, and the "Keeps failing"
 * escalation the editor relies on never arriving. The inline scan and the press
 * counted the same event the other way.
 *
 * So the decision is here, ONCE, and it is made from `SourceTouch.outcome` --
 * a word the caller had to state -- rather than inferred from a column that
 * means two things. `scan-coverage.test.ts` is the same defence one layer down:
 * a row must not depend on which path touched it.
 *
 * WHAT EACH OUTCOME WRITES:
 *
 *   read     last_fetched_at, last_error = null, streak 0, streak start null,
 *            last_ok_at = now(), and every politeness column cleared.
 *   wait /   last_fetched_at, last_error as the touch decided, streak + 1,
 *   blocked /streak start coalesced (so "first failed <date>" names the first),
 *   failed   last_ok_at UNTOUCHED, and the politeness columns as the touch
 *            decided.
 *   skipped  the wait and its sentence, and NOTHING else. Not `last_error` --
 *            the desk never knocked, so it has no failure to report (LOW-2) --
 *            and neither the streak nor `last_fetched_at` nor `last_ok_at`.
 *
 * `last_ok_at` is the column this module exists to protect: `last_fetched_at`
 * moves on a failed attempt too, so before migration 0115 nothing in the schema
 * could say when a source last READ. A wait is not a read.
 */
import type { Sql } from "../db.ts";
import type { SourceTouch } from "./fetch-politeness.ts";

/**
 * Apply one attempt's outcome to one source row.
 *
 * `sql` is the connection to write through -- the pool for the inline scan and
 * the Check press, the run's transaction for the scheduled commit -- because
 * every path writes the same row in the same shape and only the transaction
 * differs.
 */
export async function writeSourceTouch(
  sql: Sql,
  input: { id: number; newsroomId: number; touch: SourceTouch },
): Promise<void> {
  const { id, newsroomId, touch } = input;
  if (touch.outcome === "skipped") {
    /* Two columns, and no `last_error`: "Tried 4 times today" is a sentence
       about the HOST, and writing it onto a source the desk never asked for
       would show a healthy sibling as "Could not check" (LOW-2, A-B8). The
       note column carries the wait and its words. */
    await sql`
      update sources set retry_after = ${touch.retry_after},
        retry_after_note = ${touch.retry_after_note}
      where id = ${id} and newsroom_id = ${newsroomId}
    `;
    return;
  }
  if (touch.outcome === "read") {
    await sql`
      update sources set last_fetched_at = now(), last_error = null,
        consecutive_failures = 0, failure_streak_started_at = null, last_ok_at = now(),
        -- A read that worked is the end of any wait and any block.
        retry_after = null, retry_after_note = null, blocked_at = null, blocked_attempts = 0,
        last_read_method = ${touch.readMethod ?? "fetch"},
        last_read_outcome = ${touch.readOutcome ?? "fetched"},
        last_read_route_url = ${touch.readRouteUrl ?? null},
        newsletter_url = coalesce(${touch.newsletterUrl ?? null}, newsletter_url)
      where id = ${id} and newsroom_id = ${newsroomId}
    `;
    return;
  }
  /* wait | blocked | failed -- an ATTEMPT that did not read the page. The count
     is carried by the DATABASE, not read-then-written by this process: six
     sources are in flight at once and two attempts at the same row must not
     both read the same number. The streak's start is `coalesce`d so the second
     failure in a row does not move it. */
  await sql`
    update sources set last_error = ${touch.last_error}, last_fetched_at = now(),
      consecutive_failures = sources.consecutive_failures + 1,
      failure_streak_started_at = coalesce(failure_streak_started_at, now()),
      retry_after = ${touch.retry_after}, retry_after_note = ${touch.retry_after_note},
      blocked_at = ${touch.blocked_at}, blocked_attempts = ${touch.blocked_attempts},
      last_read_method = ${touch.readMethod ?? null},
      last_read_outcome = ${touch.readOutcome ?? "fetch-failed"},
      last_read_route_url = ${touch.readRouteUrl ?? null},
      newsletter_url = coalesce(${touch.newsletterUrl ?? null}, newsletter_url)
    where id = ${id} and newsroom_id = ${newsroomId}
  `;
}
