import type { EvidenceListRow } from "../lib/news/evidence-check-list";

/**
 * The drawn Checks-tab list (unit CW, 0.6.81).
 *
 * One row per claim: a status chip, the sentence it was run on, what the check
 * compared it against, and one press. The row shape is the one unit CT gave
 * the "Before you can publish" list directly above it -- a chip in the left
 * column, everything else in the right one -- because the drawing draws them
 * the same and an editor reads them the same way.
 *
 * The only presses here are the two the rows can carry: a link to the captured
 * record the claim was checked against, and a focus of the style section's own
 * repair button. Nothing in this component mutates anything.
 */
export function EvidenceCheckList({
  ranLine,
  rows,
  compareLabel,
  onCompare,
  onStylePress,
}: {
  /** "Ran 8:14 a.m. · Claude Sonnet · checked against 3 captures", or "". */
  ranLine: string;
  rows: readonly EvidenceListRow[];
  /** The drawn footer press, or "" when there is no checked version to compare. */
  compareLabel: string;
  onCompare: () => void;
  onStylePress: () => void;
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
          {rows.map((row) => (
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
                    <a className="btn quiet astra-evidence-act" href={row.action.href}>
                      {row.action.label}
                    </a>
                  ) : (
                    <button type="button" className="btn astra-evidence-act" onClick={onStylePress}>
                      {row.action.label}
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {compareLabel ? (
        <button type="button" className="btn astra-evidence-compare" onClick={onCompare}>
          {compareLabel}
        </button>
      ) : null}
    </section>
  );
}
