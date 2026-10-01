/*
  THE WAY BACK FROM A REMOVE (FB7, item 1).

  FB0-REPORT.md Table B, Sources: "Remove … SILENT FAIL + NO UNDO + no
  confirm". Remove takes a source off the watch list -- the scanner stops
  fetching it and its row leaves the screen -- and the single-row path offered
  nothing behind it, while the screen's own BULK path had offered an Undo all
  along.

  The decision is here rather than inline in the route so it can be tested
  without a React tree, and so the one rule that matters is stated once:
  removing is reversible, and nothing else on that row is.

  Why nothing else: Pause already has its inverse ("Resume") drawn on the same
  row, and Accept is the inverse of Remove. An Undo toast beside either would
  be two buttons for one press, and the second one would be the desk asking
  the editor to choose between two ways of saying the same thing.
*/

export type SingleRowStatus = "accepted" | "rejected" | "paused";

const STATUSES: readonly string[] = ["accepted", "rejected", "paused"];

/**
 * The status an Undo should put this row back to, or null when there is no way
 * back to offer.
 *
 * `from` is the status the row was in when the press was made -- the mutation
 * knows the NEW status and has no memory of the old one, so the call site
 * carries it. An absent or unrecognised `from` gets no Undo rather than a
 * guessed one: putting a source back as "accepted" when it was "proposed" would
 * be the desk inventing a state the editor never chose.
 */
export function sourceStatusUndoTo(input: {
  status: SingleRowStatus;
  from?: string | null;
}): SingleRowStatus | null {
  if (input.status !== "rejected") return null;
  const from = input.from ?? "";
  if (!STATUSES.includes(from) || from === "rejected") return null;
  return from as SingleRowStatus;
}
