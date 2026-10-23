import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { markClaimReviewed, saveLedgerItemStatus } from "@/lib/news/desk";
import { clockFromSeconds } from "@/lib/news/meeting-whole";
import {
  IMPACT_DIMENSIONS,
  IMPACT_UNSCORED_REASON,
  impactDecision,
  impactReasonKey,
  impactTotal,
  isRanked,
} from "@/lib/news/meeting-impact";
import { runStatsLine } from "@/components/meeting-ledger-stats";
import { editorNotesSentence, ledgerHeading } from "@/components/meeting-ledger-heading";
import type { ClaimRow, LedgerItemRow, MeetingAccounting } from "@/lib/news/meeting-ledger.server";

/**
 * The Meeting ledger panel (WR1 phase 2).
 *
 * The writer is the report-local-news skill, run as an agent. Its record is the
 * editor file and the list of things to check before publishing; the ledger rows
 * are often empty. That record is stored against the draft. This panel is where
 * an editor reads it and changes it: which items the story leads on, which ones
 * go in the roundup, which ones are left out and why. On a news draft the same
 * panel shows the writer's notes, not a meeting's accounting (D234 point 5).
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
 *   - Nothing here prints. The panel is a reading of the draft's own record.
 *
 * MS-WIRE W5 (D201): the meeting writer is Scott's report-local-news skill, run
 * as an agent. Its record is the EDITOR FILE and the list of things to check
 * before publishing, so the panel shows those above the (often empty) ledger.
 * "Rewrite from ledger" is retired: the writer reads the tape itself, and a
 * draft is redrafted with the same "Draft with AI" press as any other story.
 */
export function MeetingLedgerPanel({
  leadId,
  accounting,
  transcriptArtifactId,
  locked,
  fromMeeting,
}: {
  /** The story page's own query key: a save refetches this lead, nothing else. */
  leadId: number;
  accounting: MeetingAccounting | null;
  /** The transcript this lead's ledger timestamps point into, or null. */
  transcriptArtifactId: number | null;
  /** On a published story the ledger is read-only, like every other write here. */
  locked: boolean;
  /**
   * D234 point 5: is this draft a meeting's? The report-local-news skill now
   * writes ordinary news leads too, and their editor file lands in the same
   * columns -- so the panel draws for them as well. It is still the writer's
   * notes there, not a meeting ledger, and the heading says so. Nothing else
   * on the panel changes.
   */
  fromMeeting: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const editorNotes = accounting?.meetingNotes.trim() ?? "";
  const editorChecks = accounting?.editorChecks ?? [];

  /*
    Hidden when there is nothing to account for: a lead whose draft predates
    WR1, or a story written from a packet alone. A skill-writer draft has no
    ledger rows, but its editor file is exactly what this panel is for, so the
    record -- not the row count -- decides whether the panel is drawn.
  */
  if (
    !accounting ||
    accounting.draftId === null ||
    (accounting.ledger.length === 0 && !editorNotes && editorChecks.length === 0)
  )
    return null;

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
  const unreadCount = ledger.filter((item) => item.status === "unread" && !item.reporting).length;
  const unsetTreatmentCount = ledger.filter((item) => item.status === "unread" && item.reporting).length;
  const stats = runStatsLine(accounting.runStats);

  return (
    <div className="meeting-ledger-panel">
      <details
        className="meeting-ledger"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>
          {/*
            D234: a news draft's record is the writer's notes, not a meeting
            ledger, and it has no items to count. A meeting draft's words are
            exactly what they were.
          */}
          {ledgerHeading(fromMeeting)}
          {fromMeeting ? (
            <span className="meeting-ledger-count">
              {ledger.length} item{ledger.length === 1 ? "" : "s"}
              {unreadCount ? ` · ${unreadCount} not read` : ""}
              {unsetTreatmentCount ? ` · ${unsetTreatmentCount} treatments not set` : ""}
            </span>
          ) : null}
        </summary>

        {stats ? <p className="meeting-ledger-stats">{stats}</p> : null}

        {editorChecks.length ? (
          <div className="note-sec">
            <p className="side-label">
              Check before publishing ({editorChecks.length})
            </p>
            <p className="note-one">
              The writer asks a person to check these against the record. The Publish dialog lists
              the same items, and you may publish over them.
            </p>
            <ul className="meeting-editor-checks">
              {editorChecks.map((check, index) => (
                <li key={index} className="note-one">
                  {check}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {editorNotes ? (
          <div className="note-sec">
            <p className="side-label">Editor notes (never published)</p>
            <p className="note-one">{editorNotesSentence(fromMeeting)}</p>
            <pre className="meeting-notes-full">{accounting.meetingNotes}</pre>
          </div>
        ) : null}

        {ledger.length ? (
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
        ) : null}

        <ClaimsList
          claims={accounting.claims}
          locked={locked}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["lead", leadId] })}
        />

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
  const action = item.evidence[0]?.reportingAction;
  const [status, setStatus] = useState<string>(unread ? "" : item.status);
  const [reason, setReason] = useState(item.reason);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: (next: { status: string; reason: string }) =>
      saveLedgerItemStatus({
        data: {
          rowId: item.id,
          reporting: item.reporting,
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
      {action ? <p className="note-one">Recorded action {action.actionId} · {action.agendaItem} · {action.timestamp}<br />Outcome: {action.outcome} · Vote: {action.vote}<br />Policy stage: {action.policyStage} · Reporter disposition: {action.disposition}<br />Evidence reference: {action.evidence}</p> : null}
      {unread ? (
        <p className="warn-inline">{action ? "Editorial treatment has not been set." : "This part of the tape was not read."}</p>
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
                {action ? "Treatment not set" : "Not read"}
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
      <ImpactScoreBlock impact={item.impact} />
      {(item.motions?.length ?? 0) > 0 ? (
        <ul className="ledger-vote">
          {item.motions.map((motion, index) => (
            <li key={index}>
              {motion.kind === "procedural" ? "Procedural vote: " : "Recorded vote: "}
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

/**
 * Why this item is or is not worth leading on, in the model's own words.
 *
 * The ranking that picks the lead is driven by these four numbers, so the panel
 * shows the working: the total out of twenty, the decision that total earns, and
 * each dimension with its number and its reason. An item the run never scored --
 * or scored in a reply that could not be read -- says "not scored" rather than
 * showing a zero, because a zero would be a judgement nobody made.
 */
function ImpactScoreBlock({ impact }: { impact: LedgerItemRow["impact"] }) {
  if (!isRanked(impact)) {
    return (
      <p className="ledger-impact ledger-impact-none" title={IMPACT_UNSCORED_REASON}>
        Not scored — no resident-impact score was recorded, so this item is unranked.
      </p>
    );
  }
  const total = impactTotal(impact)!;
  return (
    <div className="ledger-impact">
      <p className="ledger-impact-head">
        <span className="ledger-impact-total">Impact {total} of 20</span>{" "}
        <span className={`ledger-impact-decision ledger-impact-${impactDecision(total).toLowerCase()}`}>
          {impactDecision(total)}
        </span>{" "}
        <span className="ledger-impact-caption">resident impact</span>
      </p>
      <p className="meta">The maximum of 20 combines four dimensions, each rated from 1 to 5: immediacy, local impact, conflict and novelty.</p>
      <ul className="ledger-impact-parts">
        {IMPACT_DIMENSIONS.map((dimension) => (
          <li key={dimension}>
            <span className="ledger-impact-dim">{dimension}</span>{" "}
            <span className="ledger-impact-value">{impact[dimension]}</span>
            {String(impact[impactReasonKey(dimension)] ?? "").trim() ? (
              <span className="ledger-impact-why"> — {String(impact[impactReasonKey(dimension)]).trim()}</span>
            ) : null}
          </li>
        ))}
      </ul>
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
