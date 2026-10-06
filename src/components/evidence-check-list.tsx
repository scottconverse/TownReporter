import type { ReactNode } from "react";
import { evidenceDetailId, type EvidenceListRow } from "../lib/news/evidence-check-list";

/**
 * The drawn Checks-tab list (unit CW, 0.6.81).
 *
 * One row per claim: a status chip, the sentence it was run on, what the check
 * compared it against, and one press. The row shape is the one unit CT gave
 * the "Before you can publish" list directly above it -- a chip in the left
 * column, everything else in the right one -- because the drawing draws them
 * the same and an editor reads them the same way.
 *
 * A row's presses are the two the drawing gives it: a link to the captured
 * record the claim was checked against, and a focus of the style section's own
 * repair button. Nothing in this component mutates anything.
 *
 * `detail` (unit CW2) is the one thing that does not come from the row's data:
 * the body of the disclosure a row opens into -- the record checks and the
 * judgment controls for a row that has a review row behind it, and the page's
 * own Style check section for the style row. It is a render prop rather than
 * markup here because the state and the mutations those controls need belong to
 * whoever owns the review, and rendering them from the row alone would mean a
 * second implementation of the same judgment. A row whose `detail` comes back
 * empty gets no disclosure at all: a shut `details` that opens to nothing is a
 * press that does nothing.
 */
export function EvidenceCheckList({
  ranLine,
  rows,
  compareLabel,
  onCompare,
  onStylePress,
  onOpenRecord,
  detail,
  footer,
}: {
  /** "Ran 8:14 a.m. · Claude Sonnet · checked against 3 captures", or "". */
  ranLine: string;
  rows: readonly EvidenceListRow[];
  /** The drawn footer press, or "" when there is no checked version to compare. */
  compareLabel: string;
  onCompare: () => void;
  onStylePress: () => void;
  /** The authenticated desk can open a private captured record in its pane. */
  onOpenRecord?: (href: string) => void;
  /** The body of one row's shut disclosure, or null for a row that opens to nothing. */
  detail?: (row: EvidenceListRow) => ReactNode;
  /**
   * What the list ends with (unit CW2): the shut disclosures that hold the
   * draft-pass inventory and the manual-claim form. They are passed in rather
   * than built here for the same reason `detail` is -- both own state that
   * belongs to whoever owns the review.
   */
  footer?: ReactNode;
}) {
  return (
    <section className="astra-evidence" aria-label="Evidence check">
      <h2 className="astra-evidence-title">Evidence check</h2>
      {ranLine ? (
        <p className="astra-evidence-ran" role="status">
          {ranLine}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="meta">No claims are recorded for this draft yet.</p>
      ) : (
        <ul className="astra-evidence-list">
          {rows.map((row) => {
            const body = detail?.(row) ?? null;
            return (
            <li key={row.key} className="astra-evidence-row">
              <span className={`astra-evidence-chip is-${row.tone}`}>{row.chip}</span>
              <p className="astra-evidence-what">{row.what}</p>
              {row.note ? <p className="astra-evidence-note">{row.note}</p> : null}
              {row.action ? (
                <div className="astra-evidence-acts">
                  {/*
                    The drawn row's one press is the heavy one (2px ink) and the
                    record link beside it is the light one (1px line), so which
                    press does the work is legible before either is read. A row
                    here carries only one of them: the record link when the
                    claim was checked against something a reader can open.
                  */}
                  {row.action.kind === "open-record" ? (
                    onOpenRecord ? <button type="button" className="btn quiet astra-evidence-act"
                      onClick={() => onOpenRecord(row.action!.kind === "open-record" ? row.action!.href : "")}>
                      {row.action.label}
                    </button> : <a className="btn quiet astra-evidence-act" href={row.action.href}>
                      {row.action.label}
                    </a>
                  ) : (
                    <button type="button" className="btn astra-evidence-act" onClick={onStylePress}>
                      {row.action.label}
                    </button>
                  )}
                </div>
              ) : null}
              {body ? (
                /*
                  The judgment forms live here, not in the page's main column
                  (unit CW2): the editor opens the row they are judging. Shut by
                  default, so the list stays the list, and the row's own press
                  above stays the way to the record.
                */
                <details className="astra-evidence-more" id={evidenceDetailId(row.key)}>
                  {/*
                    The style row opens into the page's Style check section, not
                    into a judgment, so its summary says what it opens (unit
                    CW2). Every other row opens into its own record checks and
                    judgment controls.
                  */}
                  <summary>
                    {row.ref?.kind === "style" ? "Style check" : "Record checks and judgment"}
                  </summary>
                  <div className="astra-evidence-more-body">{body}</div>
                </details>
              ) : null}
            </li>
            );
          })}
        </ul>
      )}
      {compareLabel ? (
        <button type="button" className="btn astra-evidence-compare" onClick={onCompare}>
          {compareLabel}
        </button>
      ) : null}
      {footer}
    </section>
  );
}
