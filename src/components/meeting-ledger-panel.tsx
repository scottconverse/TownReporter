import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActionButton, type ActionPhase } from "@/components/action-button";
import { markClaimReviewed, saveLedgerItemStatus } from "@/lib/news/desk";
import { clockFromSeconds } from "@/lib/news/meeting-whole";
import { runStatsLine } from "@/components/meeting-ledger-stats";
import type { ClaimRow, LedgerItemRow, MeetingAccounting } from "@/lib/news/meeting-ledger.server";

/**
 * The Meeting ledger panel (WR1 phase 2).
 *
 * A whole-meeting run reads the tape window by window and writes down every item
 * it found -- the motion, the vote, the proclamation, and the parts of the tape
 * it never got a readable answer about. That accounting is stored against the
 * draft. This panel is where an editor reads it and changes it: which items the
 * story leads on, which ones go in the roundup, which ones are left out and why.
 *
 * What it is FOR. The writer already decides all of that, and the draft it
 * produces is one answer among several. Before this panel the editor had the
 * story and nothing else: no way to see the items the draft did not use, no way
 * to say "this motion is the lead", and no way to know that an hour of the tape
 * produced no readable items at all. The panel is that view, and every control
 * on it writes through a server function scoped to the caller's newsroom.
 *
 * Two rules run through the whole thing:
 *
 *   - A row the run could not read is shown FIRST, in the warning colour, and
 *     says so in words: "This part of the tape was not read." An editor cannot
 *     decide about a story built on a gap they cannot see.
 *   - Nothing here prints. The ledger does not print until the editor presses
 *     "Rewrite from ledger", which is a normal draft that reuses these rows.
 *
 * Item 2 of the work order (the rewrite button) sits ABOVE the collapsible, not
 * inside it: items 1, 3, 4 and 5 are the reading, and the button is the press
 * that acts on what was read, so it stays reachable with the panel shut.
 */
export function MeetingLedgerPanel({
  leadId,
  accounting,
  transcriptArtifactId,
  locked,
  onRewrite,
  rewritePhase,
  rewriteReason,
}: {
  /** The story page's own query key: a save refetches this lead, nothing else. */
  leadId: number;
  accounting: MeetingAccounting | null;
  /** The transcript this lead's ledger timestamps point into, or null. */
  transcriptArtifactId: number | null;
  /** On a published story the ledger is read-only, like every other write here. */
  locked: boolean;
  onRewrite: () => void;
  rewritePhase: ActionPhase;
  rewriteReason?: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  /*
    Hidden when there are no rows: a lead whose draft predates WR1, or a story
    written from a packet alone, has nothing to account for, and an empty panel
    would be one more thing to read past on every other story in the paper.
  */
  if (!accounting || accounting.draftId === null || accounting.ledger.length === 0) return null;

  /*
    Unread first, then the run's own numbering. The query already sorts this
    way; sorting again here keeps the rule true of the component on its own,
    so a caller that hands over rows in any order still draws the warning rows
    where the editor will see them.
  */
  const ledger = [...accounting.ledger].sort((a, b) =>
    a.status === "unread" && b.status !== "unread"
      ? -1
      : b.status === "unread" && a.status !== "unread"
        ? 1
        : a.itemNo - b.itemNo,
  );
  const unreadCount = ledger.filter((item) => item.status === "unread").length;
  const stats = runStatsLine(accounting.runStats);

  return (
    <div className="meeting-ledger-panel">
      <div className="meeting-ledger-rewrite">
        <ActionButton
          tone="secondary"
          phase={rewritePhase}
          workingLabel="Rewriting from the ledger…"
          doneLabel="Rewrite started"
          reason={rewriteReason ?? null}
          disabled={locked}
          disabledReason={locked ? "This story is published, so its draft is read-only." : null}
          onAct={onRewrite}
        >
          Rewrite from ledger
        </ActionButton>
        <p className="note-hint">
          Writes a new draft from the ledger below — the same items, in the statuses you set — and
          does not read the tape again. The draft it replaces stays until the new one lands.
        </p>
      </div>

      <details
        className="meeting-ledger"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>
          Meeting ledger
          <span className="meeting-ledger-count">
            {ledger.length} item{ledger.length === 1 ? "" : "s"}
            {unreadCount ? ` · ${unreadCount} not read` : ""}
          </span>
        </summary>

        {stats ? <p className="meeting-ledger-stats">{stats}</p> : null}

        <div className="note-sec">
          <p className="side-label">Every item the run found</p>
          <p className="note-one">
            What the draft used, what it left out, and how it decided. Changing a status saves it
            at once; the next rewrite follows these.
          </p>
          {ledger.map((item) => (
            <LedgerRow
              key={item.id}
              item={item}
              transcriptArtifactId={transcriptArtifactId}
              locked={locked}
              onSaved={() => void qc.invalidateQueries({ queryKey: ["lead", leadId] })}
            />
          ))}
        </div>

        <ClaimsList
          claims={accounting.claims}
          locked={locked}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["lead", leadId] })}
        />

        {accounting.meetingNotes.trim() ? (
          <div className="note-sec">
            <p className="side-label">Meeting notes</p>
            <p className="note-one">
              The run's own record: what each check found, and every place the cold check and the
              draft disagreed. Shown in full.
            </p>
            <pre className="meeting-notes-full">{accounting.meetingNotes}</pre>
          </div>
        ) : null}
      </details>
    </div>
  );
}

/** One ledger item: what it was, when it happened, and the editor's decision. */
function LedgerRow({
  item,
  transcriptArtifactId,
  locked,
  onSaved,
}: {
  item: LedgerItemRow;
  transcriptArtifactId: number | null;
  locked: boolean;
  onSaved: () => void;
}) {
  const unread = item.status === "unread";
  const [status, setStatus] = useState<string>(unread ? "" : item.status);
  const [reason, setReason] = useState(item.reason);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: (next: { status: string; reason: string }) =>
      saveLedgerItemStatus({
        data: {
          draftId: item.draftId,
          itemNo: item.itemNo,
          status: next.status as "lead" | "roundup" | "excluded",
          reason: next.reason,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setProblem(res.error);
        setSaved(false);
        return;
      }
      setProblem("");
      setSaved(true);
      onSaved();
    },
    onError: (err) => {
      setSaved(false);
      setProblem(err instanceof Error ? err.message : "That did not save.");
    },
  });

  /*
    A status is one of the three the editor decides; an unread row has no
    decision yet, so it opens on a disabled "Not read" placeholder rather than
    pretending to be one of them. Picking a value IS the save -- there is no
    separate button, because the row is a decision, not a form.
  */
  const choose = (value: string) => {
    setStatus(value);
    save.mutate({ status: value, reason });
  };

  return (
    <div className={unread ? "ledger-item ledger-unread" : "ledger-item"}>
      <div className="ledger-item-head">
        <span className="ledger-no">{item.itemNo}</span>
        <span className="ledger-kind">{item.kind}</span>
        <span className="ledger-text" title={item.text}>
          {item.text}
        </span>
      </div>
      {unread ? (
        <p className="warn-inline">This part of the tape was not read.</p>
      ) : null}
      <div className="ledger-item-meta">
        {item.startSeconds !== null ? (
          transcriptArtifactId ? (
            <Link
              to="/desk/transcript/$artifactId"
              params={{ artifactId: String(transcriptArtifactId) }}
              search={{ at: item.startSeconds }}
              className="ledger-stamp inline-link"
            >
              {clockFromSeconds(item.startSeconds)}
            </Link>
          ) : (
            <span className="ledger-stamp">{clockFromSeconds(item.startSeconds)}</span>
          )
        ) : (
          <span className="ledger-stamp ledger-stamp-none">no timestamp</span>
        )}
        <span className="ledger-page">
          {item.packetPage !== null ? `packet p${item.packetPage}` : "no packet page"}
        </span>
        <label className="ledger-field">
          <span className="ledger-field-label">Status</span>
          <select
            value={status}
            disabled={locked || save.isPending}
            aria-label={`Status for item ${item.itemNo}`}
            onChange={(e) => choose(e.target.value)}
          >
            {unread ? (
              <option value="" disabled>
                Not read
              </option>
            ) : null}
            <option value="lead">Lead</option>
            <option value="roundup">Roundup</option>
            <option value="excluded">Excluded</option>
          </select>
        </label>
        <label className="ledger-field ledger-field-reason">
          <span className="ledger-field-label">Reason</span>
          <textarea
            value={reason}
            disabled={locked}
            rows={2}
            aria-label={`Reason for the status of item ${item.itemNo}`}
            placeholder="Why it is left out, or kept"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {saved ? (
          <span className="ledger-saved" role="status">
            Saved
          </span>
        ) : null}
      </div>
      {problem ? (
        <p className="ledger-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {(item.motions?.length ?? 0) > 0 ? (
        <ul className="ledger-vote">
          {item.motions.map((motion, index) => (
            <li key={index}>
              Recorded vote:{" "}
              {[motion.result, motion.tally || motion.unanimous].filter(Boolean).join(", ") ||
                "result not stated"}
              {motion.seconds !== null ? (
                <span className="ledger-stamp"> {clockFromSeconds(motion.seconds)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : item.voteResult || item.voteTally ? (
        <p className="ledger-vote">
          Recorded vote:{" "}
          {[item.voteResult, item.voteTally].filter(Boolean).join(", ")}
        </p>
      ) : null}
      {item.evidence.length ? (
        <details className="ledger-evidence">
          <summary>
            {item.evidence.length} item{item.evidence.length === 1 ? "" : "s"} read under this one
          </summary>
          <ul>
            {item.evidence.map((entry, index) => (
              <li key={index}>
                <span className="ledger-kind">{entry.kind}</span> {entry.text}
                {entry.startSeconds !== null ? (
                  <span className="ledger-stamp"> {clockFromSeconds(entry.startSeconds)}</span>
                ) : null}
                {entry.packetPage !== null ? (
                  <span className="ledger-page"> · packet p{entry.packetPage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Every checked claim the run wrote, flagged ones first, each with the editor's mark. */
function ClaimsList({
  claims,
  locked,
  onSaved,
}: {
  claims: ClaimRow[];
  locked: boolean;
  onSaved: () => void;
}) {
  if (!claims.length) return null;
  return (
    <div className="note-sec">
      <p className="side-label">Claims and sources · checked</p>
      <p className="note-one">
        Every claim the run checked against the tape and the packet. A flagged claim is one the
        check could not confirm — read it first. Ticking Checked records that a person read it.
      </p>
      {claims.map((claim) => (
        <ClaimRowView key={claim.id} claim={claim} locked={locked} onSaved={onSaved} />
      ))}
    </div>
  );
}

function ClaimRowView({
  claim,
  locked,
  onSaved,
}: {
  claim: ClaimRow;
  locked: boolean;
  onSaved: () => void;
}) {
  const flagged = claim.checkStatus === "flagged";
  const [checked, setChecked] = useState(claim.reviewedAt !== null);

  const mark = useMutation({
    mutationFn: (reviewed: boolean) =>
      markClaimReviewed({ data: { claimId: claim.id, reviewed } }),
    /*
      The mark is drawn from local state the moment the box is ticked, so the
      control never waits on the round trip; a refusal puts it back where it
      was. `reviewed` is the value the press asked for, read from the mutation's
      own variables rather than from the render closure, which may be a render
      behind by the time the answer arrives.
    */
    onSuccess: (res, reviewed) => {
      if (!res.ok) {
        setChecked(!reviewed);
        return;
      }
      onSaved();
    },
    onError: (_err, reviewed) => setChecked(!reviewed),
  });

  return (
    <div className={flagged ? "claim-item claim-flagged" : "claim-item"}>
      <label className="claim-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked || mark.isPending}
          onChange={() => {
            const next = !checked;
            setChecked(next);
            mark.mutate(next);
          }}
        />
        <span>Checked</span>
      </label>
      <span className={flagged ? "claim-flag claim-flag-on" : "claim-flag"}>
        {flagged ? "Flagged" : "Found"}
      </span>
      <p className="claim-item-text">{claim.claim}</p>
      {claim.sourceRef ? (
        <p className="claim-item-source">
          {claim.sourceKind ? `${claim.sourceKind}: ` : ""}
          {claim.sourceRef}
        </p>
      ) : null}
      {claim.note ? <p className="claim-item-note">{claim.note}</p> : null}
    </div>
  );
}
