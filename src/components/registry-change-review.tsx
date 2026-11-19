import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  acceptRegistryChange,
  rejectRegistryChange,
} from "@/lib/news/registry/registry-review";
import type { listRegistryDesk } from "@/lib/news/registry/registry-desk";

/**
 * The review controls of the registry change list (spec 24, Phase 3).
 *
 * A waiting change ("pending" or "needs-editor") gets a note box and three
 * buttons: Accept and apply, Accept without applying, Reject. Before the editor
 * acts, the row says plainly when the field has changed since the proposal was
 * made (then Accept and apply is not offered, because the server would refuse
 * it) or when the proposal points at no live row (then only Accept without
 * applying and Reject are offered). Whatever the server answers is shown as it
 * came, in one status line above the list, and focus moves to that line. The
 * row may leave the filtered list once it is resolved, and the filter may leave
 * the list empty: the line lives above the rows, not in one, and this component
 * stays mounted (it shows its own empty text) so the line stays too. Accepting
 * never verifies an entry.
 *
 * An accepted or rejected change shows who decided, when, whether it was
 * applied, and the note. It has no buttons.
 *
 * Every line is the page's normal body size and full-contrast text.
 */

type DeskChange = Awaited<ReturnType<typeof listRegistryDesk>>["changes"][number];

const NOTE_MAX = 1000;
const WAITING = new Set(["pending", "needs-editor"]);
const REFRESH_FAILED = "The list could not be refreshed. Reload the page.";

type Status = { kind: "ok" | "refused"; text: string; count: number };

const shown = (value: string | null): string =>
  value === null || value === "" ? "nothing recorded" : value;

/** The field no longer holds what the proposal was made against. */
function isStale(change: Pick<DeskChange, "targetLive" | "currentValue" | "beforeValue">): boolean {
  return change.targetLive && (change.currentValue ?? null) !== (change.beforeValue ?? null);
}

function ResolvedDetails({
  change,
  formatTime,
}: {
  change: DeskChange;
  formatTime: (when: string | Date | null | undefined) => string;
}) {
  const stateWord = change.reviewState === "accepted" ? "Accepted" : "Rejected";
  return (
    <div data-testid="resolved-details">
      <p className="text-base">
        {stateWord} by {change.reviewedBy ?? "an editor"}
        {change.reviewedAt ? ` on ${formatTime(change.reviewedAt)}` : ""}.
      </p>
      <p className="text-base">
        {change.appliedAt ? `Applied to the entry on ${formatTime(change.appliedAt)}.` : "Not applied."}
      </p>
      {change.reviewNote ? <p className="text-base">Note: {change.reviewNote}</p> : null}
    </div>
  );
}

function WaitingControls({
  change,
  busy,
  onAct,
}: {
  change: DeskChange;
  busy: boolean;
  onAct: (change: DeskChange, action: "apply" | "accept" | "reject", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const stale = isStale(change);
  const noTarget = !change.targetLive;
  const noteId = `review-note-${change.id}`;
  const label = (change.entityName ?? change.fieldName).slice(0, 80);
  return (
    <div className="mt-2 grid gap-2" data-testid="review-controls">
      {stale ? (
        <p className="text-base font-semibold text-ink" data-testid="stale-notice">
          This field now says {shown(change.currentValue)}. The proposal expected{" "}
          {shown(change.beforeValue)}.
        </p>
      ) : null}
      {noTarget ? (
        <p className="text-base font-semibold text-ink" data-testid="no-target-notice">
          This proposal does not point at one live row, so it cannot be applied. You can accept it
          without applying, or reject it.
        </p>
      ) : null}
      <label className="block text-base" htmlFor={noteId}>
        Note (optional, up to {NOTE_MAX} characters)
      </label>
      <textarea
        id={noteId}
        name="note"
        className="w-full border border-rule bg-paper p-2 text-base"
        rows={2}
        maxLength={NOTE_MAX}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {!stale && !noTarget ? (
          <InkButton
            tone="solid"
            ariaLabel={`Accept and apply: ${label}`}
            disabled={busy}
            onClick={() => onAct(change, "apply", note)}
          >
            Accept and apply
          </InkButton>
        ) : null}
        <InkButton
          tone="ghost"
          ariaLabel={`Accept without applying: ${label}`}
          disabled={busy}
          onClick={() => onAct(change, "accept", note)}
        >
          Accept without applying
        </InkButton>
        <InkButton
          tone="ghost"
          ariaLabel={`Reject: ${label}`}
          disabled={busy}
          onClick={() => onAct(change, "reject", note)}
        >
          Reject
        </InkButton>
      </div>
    </div>
  );
}

/**
 * The list of changes with their review controls. `renderSummary` draws the
 * row's existing content (what the scan found); this adds the status line and,
 * under each row, the controls or the resolved details. With no rows it shows
 * `emptyText` in place of the list, and the status line stays above it.
 */
export function RegistryChangeReviewList({
  changes,
  emptyText,
  formatTime,
  renderSummary,
}: {
  changes: readonly DeskChange[];
  emptyText: ReactNode;
  formatTime: (when: string | Date | null | undefined) => string;
  renderSummary: (change: DeskChange) => ReactNode;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The row's buttons may leave the page with the row, so focus goes to what was said.
    if (status) statusRef.current?.focus();
  }, [status]);

  const act = async (change: DeskChange, action: "apply" | "accept" | "reject", note: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let next: Omit<Status, "count">;
    try {
      const trimmed = note.trim() === "" ? null : note;
      const result =
        action === "reject"
          ? await rejectRegistryChange({ data: { changeId: change.id, note: trimmed } })
          : await acceptRegistryChange({
              data: { changeId: change.id, apply: action === "apply", note: trimmed },
            });
      next = { kind: result.ok ? "ok" : "refused", text: result.message };
    } catch (error) {
      next = {
        kind: "refused",
        text:
          (error instanceof Error ? error.message : "") ||
          "That change could not be reviewed. Nothing was changed.",
      };
    }
    // The server's answer is said first, whatever it was.
    setStatus((previous) => ({ ...next, count: (previous?.count ?? 0) + 1 }));
    try {
      // Refused, thrown or not, the server may know something the list does not.
      await qc.invalidateQueries({ queryKey: ["registry-desk"] });
    } catch {
      // A failed refresh is said after the answer and never replaces it.
      setStatus((previous) => ({
        ...next,
        text: `${next.text} ${REFRESH_FAILED}`,
        count: (previous?.count ?? 0) + 1,
      }));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      {status ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          className={"mb-3 text-base " + (status.kind === "refused" ? "text-rust" : "text-ink")}
          role={status.kind === "refused" ? "alert" : "status"}
          aria-live={status.kind === "refused" ? "assertive" : "polite"}
          data-testid="review-status"
        >
          {status.text}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <p className="wire-sum">{emptyText}</p>
      ) : (
        <ul className="astra-plain registry-changes">
          {changes.map((change) => (
            <li key={change.id}>
              {renderSummary(change)}
              {WAITING.has(change.reviewState) ? (
                <WaitingControls change={change} busy={busy} onAct={act} />
              ) : (
                <ResolvedDetails change={change} formatTime={formatTime} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
