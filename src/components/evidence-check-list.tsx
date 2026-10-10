import { useState, type ReactNode } from "react";
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
  onAcceptSupported,
  onRemoveSentence,
  onMarkChecked,
  busy = false,
  readinessReason,
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
  onAcceptSupported?: () => void;
  onRemoveSentence?: (row: EvidenceListRow) => void;
  onMarkChecked?: (row: EvidenceListRow) => void;
  busy?: boolean;
  readinessReason?: string;
}) {
  const [spotChecking, setSpotChecking] = useState(false);
  const supported = rows.filter((row) => row.aiVerdict === "Supported");
  const exceptions = rows.filter((row) => row.aiVerdict !== "Supported")
    .sort((a, b) => Number(b.aiVerdict === "Needs a human") - Number(a.aiVerdict === "Needs a human"));
  const checked = rows.filter((row) => row.aiVerdict).length;
  function renderRows(items: readonly EvidenceListRow[]) {
    return <ul className="astra-evidence-list">{items.map((row) => {
      const body = detail?.(row) ?? null;
      return <li key={row.key} className="astra-evidence-row">
        <span className={`astra-evidence-chip is-${row.tone}`}>{row.chip}</span>
        <p className="astra-evidence-what">{row.what}</p>
        {row.note ? <p className="astra-evidence-note">{row.note}</p> : null}
        {row.action?.kind === "open-record" ? (onOpenRecord ?
          <button type="button" className="btn quiet" onClick={() => onOpenRecord(row.action!.kind === "open-record" ? row.action!.href : "")}>{row.action.label}</button> :
          <a className="btn quiet" href={row.action.href}>{row.action.label}</a>) : row.action ?
          <button type="button" className="btn" onClick={onStylePress}>{row.action.label}</button> : null}
        {row.aiVerdict === "Not supported" ? <div className="astra-evidence-acts">
          <button type="button" className="btn" disabled={busy || !onRemoveSentence} onClick={() => onRemoveSentence?.(row)}>Remove this sentence from the draft</button>
          <button type="button" className="btn quiet" disabled={busy || !onMarkChecked} onClick={() => onMarkChecked?.(row)}>Mark checked anyway</button>
        </div> : null}
        {body ? <details className="astra-evidence-more" id={evidenceDetailId(row.key)} open={row.aiVerdict === "Needs a human" || row.aiVerdict === "Not supported" || undefined}>
          <summary>{row.ref?.kind === "style" ? "Style check" : "Record checks and judgment"}</summary>
          <div className="astra-evidence-more-body">{body}</div>
        </details> : null}
      </li>;
    })}</ul>;
  }
  return (
    <section className="astra-evidence" aria-label="Evidence check">
      <h2 className="astra-evidence-title">Evidence check</h2>
      {readinessReason ? <p role="status">{readinessReason}</p> : null}
      {checked ? <p role="status">AI checked {checked} claims against the record: {supported.length} supported, {checked - supported.length} need you</p> : null}
      {ranLine ? (
        <p className="astra-evidence-ran" role="status">
          {ranLine}
        </p>
      ) : null}
      {supported.length ? <>
        <button type="button" className="btn quiet" onClick={() => setSpotChecking(true)}>Spot-check</button>
        <button type="button" className="btn" disabled={busy || !onAcceptSupported} onClick={onAcceptSupported}>Accept the AI's supported rows</button>
      </> : null}
      {rows.length === 0 ? (
        <p className="meta">No claims are recorded for this draft yet.</p>
      ) : (
        renderRows(exceptions)
      )}
      {supported.length ? <details open={spotChecking || undefined} data-ai-supported="true">
        <summary>Show the {supported.length} claims the AI supported</summary>
        {renderRows(supported)}
      </details> : null}
      {compareLabel ? (
        <button type="button" className="btn astra-evidence-compare" onClick={onCompare}>
          {compareLabel}
        </button>
      ) : null}
      {footer}
    </section>
  );
}
