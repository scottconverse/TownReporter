/**
 * What a bulk press on the Queue says when it is finished.
 *
 * M7 of the batch-6 pre-merge audit. The Queue's bulk Hold and bulk Kill ran
 * `setStatus.mutate` once per selected lead, and each of those raised its own
 * toast -- twelve leads, twelve toasts, and the shared three-toast stack meant
 * the editor saw the last three and could not tell whether the other nine had
 * landed. A partial failure was worse: its sentence scrolled off behind the
 * successes.
 *
 * The press now runs every lead through one `Promise.allSettled`, reports the
 * whole batch in ONE sentence, and offers one Undo for the leads that actually
 * took. This module is the pure half of that -- the counting and the wording --
 * so both can be held to their shape without a React tree or a database.
 */

/** The two statuses the Queue's bulk strip sets. */
export type BulkLeadStatus = "held" | "killed";

/** How each one reads as a past-tense verb: "Held 12." */
const BULK_STATUS_PAST: Record<BulkLeadStatus, string> = {
  held: "Held",
  killed: "Killed",
};

/**
 * The id every bulk-status summary is raised under.
 *
 * Sonner replaces a toast handed an id it already knows, so pressing Hold,
 * then Kill, then Hold again leaves ONE summary on screen -- the current one --
 * rather than a stack of three that disagree about the state of the same
 * leads. See `DeskToastOptions.id`.
 */
export const BULK_STATUS_TOAST_ID = "desk-bulk-lead-status";

/** The word on the way back. Both of these presses are reversible. */
export const BULK_STATUS_UNDO_LABEL = "Undo";

export type BulkStatusReport = {
  status: BulkLeadStatus;
  /** How many of the leads took. */
  done: number;
  /** One sentence per lead that did not, in the order they were tried. */
  failures: string[];
  /**
   * The leads that DID take -- and so the only ones an Undo may put back. Undo
   * over every selected id would also "restore" a lead whose write failed,
   * which was never held or killed and is already where it belongs.
   */
  undoIds: number[];
};

/**
 * Read a settled batch into a count, the reasons, and the ids to undo.
 *
 * `Promise.allSettled` preserves order, so `settled[i]` is `ids[i]`. A
 * fulfilled call that answered `{ok:false}` is a refusal and is counted with
 * the failures: the desk said no, and saying "Held 12" over it would be the
 * same silence this unit exists to remove.
 *
 * `reason` is injected (`deskErrorReason`) so this stays free of the toast
 * layer and its wording is the desk's one mapping.
 */
export function bulkStatusReport(input: {
  status: BulkLeadStatus;
  ids: readonly number[];
  settled: readonly PromiseSettledResult<unknown>[];
  reason: (error: unknown) => string;
}): BulkStatusReport {
  const failures: string[] = [];
  const undoIds: number[] = [];
  input.ids.forEach((id, index) => {
    const outcome = input.settled[index];
    if (!outcome) {
      failures.push("the desk gave no reason");
      return;
    }
    if (outcome.status === "rejected") {
      failures.push(input.reason(outcome.reason));
      return;
    }
    const refusal = refusalIn(outcome.value);
    if (refusal) {
      failures.push(refusal);
      return;
    }
    undoIds.push(id);
  });
  return { status: input.status, done: undoIds.length, failures, undoIds };
}

/** The `{ok:false, error}` a server function answered with, if it answered one. */
function refusalIn(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { ok?: unknown }).ok !== false) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" && error.trim()
    ? error.trim()
    : "the desk refused that press and said nothing about why";
}

/**
 * The one sentence a finished bulk press shows.
 *
 * "Held 4 leads." when it all landed, "Held 11. 1 failed: <reason>" when it did
 * not. The noun is FB6's, and it is not decoration: "Held 4." under a table of
 * rows reads as four of something the sentence never names, and the sentence is
 * shown away from the rows it is about -- a toast at the bottom of the screen
 * over a list that has already changed under it.
 *
 * `done: 0` reads "Held 0 leads. 12 failed: <reason>" on purpose -- the verb is
 * the press the editor made, and the count and the reason are what they need to
 * act on. The first reason is carried, not every one: they are the same failure
 * in almost every case, and the Undo on the same toast is the action.
 */
export function bulkStatusSummary(report: Pick<BulkStatusReport, "status" | "done" | "failures">): string {
  const head = `${BULK_STATUS_PAST[report.status]} ${report.done} lead${report.done === 1 ? "" : "s"}.`;
  if (report.failures.length === 0) return head;
  const failed = `${report.failures.length} failed`;
  const first = report.failures[0];
  return first ? `${head} ${failed}: ${first}` : `${head} ${failed}.`;
}
