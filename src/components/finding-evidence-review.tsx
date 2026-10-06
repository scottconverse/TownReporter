import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getFindingEvidenceCapture,
  getFindingEvidenceReview,
  saveManualClaim,
  saveFindingEvidenceJudgment,
  type FindingCaptureEvidence,
  type FindingEvidenceCaptureResult,
  type FindingEvidenceReview,
  type FindingJudgment,
  type ManualClaimReferenceRelation,
} from "@/lib/news/finding-evidence-review";
import { InkButton } from "@/components/desk-chrome";
import { EvidenceCheckList } from "@/components/evidence-check-list";
import { TAKEDOWN_REASON_MAX, takeDownEvidenceCapture } from "@/lib/news/evidence-takedown";
import { takedownDoneNotice, takedownFailedNotice } from "@/lib/news/takedown-notice";
import {
  blankTakeDownForm,
  takeDownConfirmText,
  takeDownFormForCapture,
  type TakeDownForm,
} from "@/lib/news/evidence-takedown-form";
import { BusyLine, Notice } from "@/components/states";
import { canRebaseDirtyEvidencePeers } from "@/lib/news/finding-evidence-peer";
import {
  captureStateSentence,
  captureSupportLine,
  groupDisplayCaptures,
  revealOpenedCapture,
} from "@/lib/news/finding-evidence-display";
import {
  citedCaptureCount,
  evidenceCheckRows,
  evidenceRanLine,
  type EvidenceListRow,
} from "@/lib/news/evidence-check-list";
import type { DraftAuditFinding } from "@/lib/news/draft-audit";
import {
  reviewEvidenceCheckState,
  type EvidenceCheckReport,
} from "@/lib/news/evidence-check-state";
import type { DraftMeetingEvidence } from "@/lib/news/meeting-draft-transcript-link";
import type { NameCheck } from "@/lib/news/name-check";
import type { NoteTodo } from "@/lib/news/notes";
import { citationResolution, meetingCitationUrl, meetingClock } from "@/components/meeting-source-block-utils";
import { transcriptViewPath } from "@/lib/news/meeting-transcript-view";
import type { ReportingReviewClaim } from "@/lib/news/reporting-evidence-adapter";
import type { CurrentReportingDocumentCheck } from "@/lib/news/reporting-document-check";

function ClaimReferences({ claim, currentCheck }: { claim: ReportingReviewClaim; currentCheck?: CurrentReportingDocumentCheck }) {
  if (!claim.reporting) return <p className="mt-2 break-all text-sm text-muted">Returned URL: {claim.url}</p>;
  return <div className="mt-2 space-y-2 text-sm text-muted">
    <p>Reporter status: {claim.reporting.status}. Your evidence judgment is saved separately.</p>
    {currentCheck ? <div className="border-l border-rule pl-2">
      <p>Current saved-document check: {currentCheck.status ?? "Unavailable"}.</p>
      <p>{currentCheck.note}</p>
      <p>This checks the filed claim, separately from your current copy and evidence judgment.</p>
      {currentCheck.references.map((ref, index) => <p key={`${ref.id}:${index}`}>{ref.title}: {ref.locator || "Locator unresolved"}</p>)}
    </div> : null}
    {claim.reporting.item ? <p>Claim item: {claim.reporting.item}</p> : null}
    {claim.reporting.nextCheck ? <p>Next check: {claim.reporting.nextCheck}</p> : null}
    <ul className="space-y-2">
      {claim.reporting.references.map((ref, index) => <li key={`${ref.id}:${index}`}>
        <p>{ref.title} · Tier {ref.tier}</p>
        {/^https?:\/\//i.test(ref.url)
          ? <a className="break-all underline" href={ref.url} target="_blank" rel="noreferrer">Open source: {ref.url}</a>
          : <p>{ref.offlineReference || ref.url || "Source location unavailable"}</p>}
        <p>Locator: {ref.locator || "No precise locator recorded"}</p>
        {ref.versionId == null ? <p>No captured version was pinned to this reference.</p> : null}
      </li>)}
    </ul>
    {claim.reporting.missingSourceIds.length ? <p>Missing source records: {claim.reporting.missingSourceIds.join(", ")}</p> : null}
    {!claim.reporting.references.length ? <p>No supporting reference travels with this claim.</p> : null}
  </div>;
}

type JudgmentDraft = {
  value: FindingJudgment;
  reason: string;
  contraryVersionId: number | null;
};

type CurrentDraft = {
  headline: string;
  dek: string;
  body: string;
  topic: string;
};

type ManualClaimForm = {
  id: string | null;
  fact: string;
  kind: "primary" | "record" | "news";
  references: Array<{ versionId: number; relation: ManualClaimReferenceRelation }>;
};

const blankManualClaim = (): ManualClaimForm => ({
  id: null,
  fact: "",
  kind: "record",
  references: [],
});

const judgmentLabels: Record<FindingJudgment, string> = {
  unreviewed: "Unreviewed",
  supports: "Supports",
  "does-not-support": "Does not support",
  contradicts: "Contradicts",
  "needs-reporting": "Needs reporting",
};

function sameDraft(current: CurrentDraft, review: FindingEvidenceReview) {
  return (
    current.headline === review.canonicalDraft.headline &&
    current.dek === review.canonicalDraft.dek &&
    current.body === review.canonicalDraft.body &&
    current.topic === review.canonicalDraft.topic
  );
}

/* The sentence for one captured record lives in `finding-evidence-display.ts`
   (`captureStateSentence`), where it can be read and tested without a browser
   -- unit PUB1 replaced "No recorded excerpt to compare" with what the card
   actually is. */

function draftsFrom(review: FindingEvidenceReview): Record<string, JudgmentDraft> {
  return Object.fromEntries(
    [...review.rows, ...review.claimRows, ...review.manualClaimRows].map((row) => [
      row.key,
      {
        value: row.judgment.value,
        reason: row.judgment.reason,
        contraryVersionId: row.judgment.contraryVersionId,
      },
    ]),
  );
}

/**
 * The transcript half of "Claims & evidence".
 *
 * For a meeting story this is the half that has anything in it. The panel below
 * reviews URL-receipt claims, and a draft written from YouTube captions has
 * none -- its `source_urls` is empty and the citations it actually used are
 * segment indexes into a transcript, so the editor pressed "Review claims and
 * sources" and landed on an empty box. Showing the citations here is the same
 * data the notes' "Where this came from" block shows, at the address the button
 * promises to take them to.
 *
 * The evidence object is the one the story route already loads through
 * `loadDraftMeetingEvidence` (src/lib/news/meeting-draft-transcript-link.ts:60)
 * and passes to `MeetingSourceBlock`; this renders the same rows, not a second
 * read of the tape.
 */
function TranscriptCitationEvidence({ evidence }: { evidence: DraftMeetingEvidence }) {
  const citations = evidence.citations;
  const videoId = evidence.meeting.videoId;
  return (
    <div className="mt-4 border border-rule bg-paper-2 p-4" role="region" aria-label="Transcript citations">
      <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
        Meeting transcript citations
      </p>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        This draft was written from the meeting recording
        {evidence.meeting.date ? ` of ${evidence.meeting.date}` : ""}
        {evidence.meeting.title ? ` (${evidence.meeting.title})` : ""}. The passages below are the
        transcript citations this draft recorded — the evidence a meeting story actually rests on.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <a
          className="btn quiet small"
          href={transcriptViewPath(evidence.artifactId)}
          target="_blank"
          rel="noreferrer"
        >
          Open transcript
        </a>
        <a
          className="inline-link"
          href={meetingCitationUrl(videoId, 0)}
          target="_blank"
          rel="noreferrer"
        >
          Watch the video
        </a>
      </p>
      {citations.length ? (
        <ul className="mt-3 space-y-3">
          {citations.map((citation) => (
            <li key={`${citation.segmentIndex}-${citation.item}`} className="border-l border-rule pl-3">
              <p className="text-sm font-medium text-ink">
                Item {citation.item || "unlabelled"}
                {" · "}
                <a
                  className="inline-link"
                  href={meetingCitationUrl(videoId, citation.timestampSeconds)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {meetingClock(citation.timestampSeconds)}
                </a>
              </p>
              <blockquote className="mt-1 border-l-2 border-rust pl-3 text-sm text-ink-2">
                {citation.excerpt}
              </blockquote>
              <p className="mt-1 text-sm text-muted">{citationResolution(evidence, citation)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          This draft has transcript material but no persisted citation record, so there is nothing to
          review here. Publishing stays blocked until it is redrafted from the current recording.
        </p>
      )}
    </div>
  );
}

/**
 * The page's half of the drawn Checks list (unit CW2).
 *
 * The panel is the only thing holding the review's state, so it is the thing
 * that draws the list; these are the pieces the page owns. `ranLine` is the
 * line the page already words from the draft's check and the chosen writer, and
 * the other three are facts the list states beside a judgment row that the
 * review itself does not carry: the claims of absence still waiting on a
 * person, the saved name check, and the draft audit's findings behind the style
 * row. The three presses are the page's own -- they open the compare dialog,
 * the captured record and the style section, none of which live in here.
 */
/** One capture row, as any of the three stacks carries it. A manual claim's
    captures also carry the role the editor gave them. */
type CaptureRow = FindingCaptureEvidence & { relation?: ManualClaimReferenceRelation };

/**
 * The record checks a list row opens into (unit CW2).
 *
 * This is the markup the page's main column used to carry, moved under the row
 * it belongs to. The two variants differ only in what the desk calls things and
 * in one decision: a recorded finding offers a newer capture as a press, while
 * a claim returned by a draft pass states in words that a newer capture exists
 * and is not substituted -- the draft pass's exact record is the one the claim
 * was returned with, and the page has always said so rather than offered the
 * swap.
 */
const citedRecordCopy = {
  finding: {
    heading: "Mechanical record checks",
    fallback: "Cited capture",
    view: "View cited captured version",
    newer: "Review newer capture",
    empty: "No cited captured version or capture event was recorded for this finding.",
  },
  claim: {
    heading: "Exact draft provenance",
    fallback: "Recorded provenance",
    view: "View exact captured version",
    newer: "",
    empty: "No exact captured version or capture event was recorded for this returned URL.",
  },
} as const;

function CitedRecordChecks({
  variant,
  captures,
  onOpen,
  pending,
}: {
  variant: "finding" | "claim";
  captures: readonly CaptureRow[];
  onOpen: (versionId: number) => void;
  pending: boolean;
}) {
  const copy = citedRecordCopy[variant];
  const displayedCaptures = groupDisplayCaptures([...captures]);
  return (
    <div className="mt-4 border-t border-rule pt-3">
      <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">{copy.heading}</p>
      {displayedCaptures.length ? (
        <ul className="mt-2 space-y-3">
          {displayedCaptures.map((group, captureIndex) => {
            const capture = group.capture;
            return (
              <li
                key={`${capture.versionId ?? "missing"}-${capture.captureEventId ?? captureIndex}`}
                className="border-l border-rule pl-3 text-sm"
              >
                <p className="font-medium text-ink">
                  {capture.title ?? capture.url ?? copy.fallback}
                </p>
                <p className="mt-1 text-muted">
                  {captureStateSentence(capture)}
                  {capture.capturedAt ? ` · captured ${capture.capturedAt}` : ""}
                </p>
                {/*
                  Unit PUB1: the ids stay, because an editor asking support to
                  look at a capture needs to name it -- but on their own smaller
                  line, labelled, in words rather than column names. Above it is
                  what the record IS; this is how to quote it.
                */}
                {group.artifactVersionReference || group.captureEventIds.length ? (
                  <p className="mt-1 text-xs text-muted">
                    For support: {captureSupportLine(group)}
                  </p>
                ) : null}
                {variant === "finding" ? (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {capture.viewHref && capture.versionId != null ? (
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => onOpen(capture.versionId!)}
                        disabled={pending}
                      >
                        {copy.view}
                      </button>
                    ) : null}
                    {capture.newerCapture ? (
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => onOpen(capture.newerCapture!.versionId)}
                        disabled={pending}
                      >
                        {copy.newer}
                        {capture.newerCapture.capturedAt
                          ? ` (${capture.newerCapture.capturedAt})`
                          : ""}
                      </button>
                    ) : null}
                  </p>
                ) : (
                  <>
                    {capture.viewHref && capture.versionId != null ? (
                      <button
                        type="button"
                        className="inline-link mt-1"
                        onClick={() => onOpen(capture.versionId!)}
                        disabled={pending}
                      >
                        {copy.view}
                      </button>
                    ) : null}
                    {capture.newerCapture ? (
                      <p className="mt-1 text-muted">
                        A newer capture exists for review; it is not substituted for this draft’s
                        exact record.
                      </p>
                    ) : null}
                  </>
                )}
                {/*
                  Unit PUB1: the read's own progress, said AT THE LINK. It used
                  to be a line at the foot of the panel, below the fold on a
                  long review, so the press looked like nothing happened until
                  the text arrived somewhere off screen.
                */}
                {pending ? (
                  <p className="mt-1 text-sm text-muted" role="status">
                    Opening the saved copy…
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">{copy.empty}</p>
      )}
    </div>
  );
}

/**
 * The record checks for a claim an editor added by hand: the exact captured
 * records they picked out, each with the role they gave it. No newer-capture
 * press here -- nothing was cited to compare against, so there is nothing a
 * newer capture could be better than.
 */
function ManualRecordChecks({
  captures,
  onOpen,
  pending,
}: {
  captures: readonly CaptureRow[];
  onOpen: (versionId: number) => void;
  pending: boolean;
}) {
  return (
    <div className="mt-4 border-t border-rule pt-3">
      <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
        Selected captured records
      </p>
      <ul className="mt-2 space-y-3">
        {captures.map((capture, captureIndex) => (
          <li
            key={`${capture.versionId ?? "missing"}-${captureIndex}`}
            className="border-l border-rule pl-3 text-sm"
          >
            <p className="font-medium text-ink">
              Selected captured record · {capture.title ?? capture.url ?? "Captured record"} ·{" "}
              {capture.relation}
            </p>
            <p className="mt-1 text-muted">
              {captureStateSentence(capture, "Selected captured record")}
              {capture.capturedAt ? ` · captured ${capture.capturedAt}` : ""}
            </p>
            {capture.viewHref && capture.versionId != null ? (
              <button
                type="button"
                className="inline-link mt-1"
                onClick={() => onOpen(capture.versionId!)}
                disabled={pending}
              >
                View selected captured version
              </button>
            ) : null}
            {pending ? (
              <p className="mt-1 text-sm text-muted" role="status">
                Opening the saved copy…
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The judgment controls a list row opens into (unit CW2): the select, the
 * reason, the contrary record when the judgment is a contradiction, and the
 * save.
 *
 * One component for all three stacks, because the three forms were copies of
 * each other -- the same fields, the same wording, the same reasons a save is
 * refused. What differed is only what is passed in: the id prefix, which keeps
 * the per-stack ids `delete-corrections-e2e.mjs` reads, the label and
 * placeholder of the contrary select, and which captures a contradiction may
 * cite.
 */
function JudgmentControls({
  idBase,
  index,
  judgment,
  citedVersions,
  contraryLabel,
  contraryPlaceholder,
  noneNote,
  locked,
  maySave,
  savePending,
  localDraftChanged,
  onChange,
  onSave,
}: {
  /** "finding" | "claim" | "manual-claim" -- the id prefix the walks read. */
  idBase: string;
  index: number;
  judgment: JudgmentDraft;
  citedVersions: readonly CaptureRow[];
  contraryLabel: string;
  contraryPlaceholder: string;
  /** Said under the contrary select when no capture can support it, or "". */
  noneNote: string;
  /** The controls' own disabled state: a save in flight, or an unapplied review. */
  locked: boolean;
  maySave: boolean;
  /** Which save is in flight, for the button's word. */
  savePending: boolean;
  localDraftChanged: boolean;
  onChange: (update: Partial<JudgmentDraft>) => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">Editor judgment</p>
      <label className="mt-2 block text-sm font-medium text-ink" htmlFor={`${idBase}-judgment-${index}`}>
        Judgment
      </label>
      <select
        id={`${idBase}-judgment-${index}`}
        className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm sm:max-w-sm"
        value={judgment.value}
        disabled={locked}
        onChange={(event) =>
          onChange({
            value: event.target.value as FindingJudgment,
            contraryVersionId:
              event.target.value === "contradicts" ? judgment.contraryVersionId : null,
          })
        }
      >
        {(Object.keys(judgmentLabels) as FindingJudgment[]).map((value) => (
          <option key={value} value={value}>
            {judgmentLabels[value]}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-sm font-medium text-ink" htmlFor={`${idBase}-reason-${index}`}>
        Reason{" "}
        {judgment.value === "contradicts" ? "(required for contradiction)" : "(optional)"}
      </label>
      <textarea
        id={`${idBase}-reason-${index}`}
        className="mt-1 min-h-24 w-full border border-rule bg-paper p-3 text-sm"
        value={judgment.reason}
        maxLength={2000}
        disabled={locked}
        onChange={(event) => onChange({ reason: event.target.value })}
      />
      {judgment.value === "contradicts" ? (
        <>
          <label
            className="mt-3 block text-sm font-medium text-ink"
            htmlFor={`${idBase}-contrary-${index}`}
          >
            {contraryLabel}
          </label>
          <select
            id={`${idBase}-contrary-${index}`}
            className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm sm:max-w-sm"
            value={judgment.contraryVersionId ?? ""}
            disabled={locked}
            onChange={(event) =>
              onChange({
                contraryVersionId: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">{contraryPlaceholder}</option>
            {citedVersions.map((capture) => (
              <option key={capture.versionId} value={capture.versionId!}>
                {capture.title ?? capture.url ?? `Captured version ${capture.versionId}`}
              </option>
            ))}
          </select>
          {!citedVersions.length && noneNote ? (
            <p className="mt-1 text-sm text-muted">{noneNote}</p>
          ) : null}
        </>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <InkButton disabled={!maySave} onClick={onSave}>
          {savePending ? "Saving judgment…" : "Save judgment"}
        </InkButton>
        {localDraftChanged ? (
          <span className="self-center text-sm text-muted">Save the draft first.</span>
        ) : null}
      </div>
    </div>
  );
}

export type EvidenceListInputs = {
  /** When the checks ran, for the drawn "Ran 8:14 a.m." line. */
  checkedAt: string | null;
  /** The writer they ran with, or "" when no check is on the books. */
  modelLabel: string;
  /** `uncheckedGateTodos(notes)` -- the absence claims still unticked. */
  openClaims: readonly NoteTodo[];
  nameCheck: NameCheck | null;
  /** Every finding this draft's audit raises, fixes and reviews together. */
  styleFindings: readonly DraftAuditFinding[];
  /**
   * The page's Style check section (unit CW2), which the style row opens into.
   * It is markup from the route rather than a second implementation here
   * because the tick state and the repair mutation it needs are the page's:
   * this panel draws the row, and the row is a way to that one section.
   */
  styleDetail: ReactNode;
  /** The drawn footer press, or "" when there is no checked version to compare. */
  compareLabel: string;
  onCompare: () => void;
  onStylePress: () => void;
  /**
   * Is there a recorded evidence decision or reconciliation stamp on this
   * draft's memo? The page reads it off `recordedChecks`; the panel cannot,
   * because the memo is not part of the review.
   */
  evidenceRecorded: boolean;
  /**
   * The one answer this panel's list and the page's publish bar both read
   * (unit U24), plus the review's own identity (unit U24b).
   *
   * The panel is the only thing holding the resolved review, so it is the only
   * thing that can count the rows waiting on a person -- and the only thing
   * that holds the review's `evidenceToken`, which the acceptance press has to
   * carry so the server can refuse one recorded against a review that has
   * moved. It reports both up rather than letting the page compute a second
   * answer from the memo: the bar, the chips, the blocker and the rows below
   * them are then readings of a single value, which is what U24 is for. Stable
   * callers only: the page passes a `useCallback`.
   */
  onEvidenceState?: (report: EvidenceCheckReport) => void;
};

export function FindingEvidenceReviewPanel({
  leadId,
  reviewRevision,
  currentDraft,
  meetingEvidence = null,
  disabled = false,
  isOwner = false,
  takeDownDisabled = disabled,
  list,
}: {
  leadId: number;
  reviewRevision: string;
  currentDraft: CurrentDraft;
  /** The draft's transcript citations, when it has any. See `TranscriptCitationEvidence`. */
  meetingEvidence?: DraftMeetingEvidence | null;
  disabled?: boolean;
  /**
   * Whether the owner's takedown press may be used. Defaults to `disabled`.
   *
   * Unit U25: these two must be able to disagree, and the story page is where
   * they do. `disabled` locks the whole panel while the story is on paper --
   * judgments bind to a draft, and a published story has none -- but the
   * takedown is the one control that a published story still needs: the
   * captures with public pages at `/evidence/:versionId` are the ones a
   * publisher's complaint is about, and the page's own confirm copy promises
   * that "published citations still resolve — to a notice instead of an
   * excerpt". Passing `onPaper` into `disabled` alone left the press rendered,
   * greyed, and unusable on every claim of every published story, so no editor
   * could ever produce a public removal notice. See `docs/manual.md`'s
   * "Taking down one captured excerpt (owner workflow)".
   */
  takeDownDisabled?: boolean;
  /**
   * Whether this editor is the newsroom's owner (unit U11b).
   *
   * The takedown press is drawn only for the owner, because only the owner may
   * use it: `takeDownCapture` refuses any other role with the same guard the
   * legal-removal routes use, and this flag only decides whether the desk
   * offers a press that would be refused. A page that has not asked (this
   * default) offers nothing.
   */
  isOwner?: boolean;
  /** The drawn list, as the page sees it: the run line, the extra rows, the presses. */
  list: EvidenceListInputs;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, JudgmentDraft>>({});
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(
    null,
  );
  const [reloadRequired, setReloadRequired] = useState(false);
  const [openedCapture, setOpenedCapture] = useState<FindingEvidenceCaptureResult | null>(null);
  /*
    Unit U11b: the takedown form, opened by a press rather than drawn beside
    every captured record the editor opens. It is a plain press and a state
    flag, not a `<details>`: the review page's shut disclosures are enumerated
    by position in `scripts/delete-corrections-e2e.mjs`, and a new one inside
    the opened-capture pane would move those indices under it.

    Unit U23: it is ONE form, ABOUT ONE CAPTURE. `takeDownFormForCapture` is
    applied below on every render and every edit, so a form that was filled in
    for a capture the pane has since moved away from -- or that the pane has
    closed -- is handed back blank rather than carrying a reason written about a
    different record into a press that destroys this one. The alternative (an
    effect that reset it after the fact) would leave the first paint of the new
    capture showing the previous capture's reason. The rule and the tests are in
    src/lib/news/evidence-takedown-form.ts.
  */
  const [takeDownState, setTakeDownState] = useState<TakeDownForm>(() => blankTakeDownForm(null));
  const [takeDownFeedback, setTakeDownFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  /*
    The form as it applies to the capture the pane is showing now -- the only
    thing the pane below reads -- and the only way to change it. Both fold the
    open capture in first, so neither a render nor a keystroke can land on a
    form that still belongs to the capture before this one.
  */
  const openedVersionId =
    openedCapture && openedCapture.ok ? openedCapture.capture.versionId : null;
  const takeDownForm = takeDownFormForCapture(takeDownState, openedVersionId);
  const editTakeDown = (update: (current: TakeDownForm) => TakeDownForm) =>
    setTakeDownState((current) => update(takeDownFormForCapture(current, openedVersionId)));
  const [manualClaim, setManualClaim] = useState<ManualClaimForm>(blankManualClaim);
  const [recordToAdd, setRecordToAdd] = useState("");
  const [recordRelation, setRecordRelation] = useState<ManualClaimReferenceRelation>("corroborating");
  const dirtyKeys = useRef(new Set<string>());
  const draftToken = useRef("");
  const manualDraftToken = useRef("");
  const reviewAtDraftStart = useRef<FindingEvidenceReview | null>(null);
  const discardOnReload = useRef(false);
  const appliedToken = useRef("");
  const reviewQuery = useQuery({
    queryKey: ["finding-evidence-review", leadId, reviewRevision],
    queryFn: () => getFindingEvidenceReview({ data: { leadId } }),
    retry: false,
  });
  const review = reviewQuery.data?.ok ? reviewQuery.data.review : null;
  const reviewApplied = Boolean(review && appliedToken.current === review.evidenceToken);
  const localDraftChanged = review ? !sameDraft(currentDraft, review) : false;

  function updateManualClaim(update: (current: ManualClaimForm) => ManualClaimForm) {
    if (!manualDraftToken.current && review) manualDraftToken.current = review.evidenceToken;
    setManualClaim(update);
  }

  function resetManualClaim() {
    manualDraftToken.current = "";
    setManualClaim(blankManualClaim());
  }

  useEffect(() => {
    if (!review || appliedToken.current === review.evidenceToken) return;
    const fromServer = draftsFrom(review);
    if (discardOnReload.current || dirtyKeys.current.size === 0) {
      setDrafts(fromServer);
      dirtyKeys.current.clear();
      draftToken.current = "";
      reviewAtDraftStart.current = null;
      discardOnReload.current = false;
      setReloadRequired(false);
    } else {
      setDrafts((current) => {
        for (const key of dirtyKeys.current) {
          if (current[key]) fromServer[key] = current[key];
        }
        return fromServer;
      });
      setReloadRequired(true);
    }
    appliedToken.current = review.evidenceToken;
  }, [review]);

  const reload = async () => {
    discardOnReload.current = true;
    setFeedback({ kind: "warn", text: "Reloading the current evidence review…" });
    const result = await reviewQuery.refetch();
    if (!result.isError && result.data?.ok) {
      setDrafts(draftsFrom(result.data.review));
      appliedToken.current = result.data.review.evidenceToken;
      dirtyKeys.current.clear();
      draftToken.current = "";
      reviewAtDraftStart.current = null;
      resetManualClaim();
      discardOnReload.current = false;
      setReloadRequired(false);
      setFeedback({ kind: "ok", text: "Current evidence review loaded." });
      return;
    }
    discardOnReload.current = false;
    setFeedback({
      kind: "err",
      text:
        result.data && !result.data.ok
          ? result.data.error
          : "Could not reload the evidence review.",
    });
  };

  const captureRead = useMutation({
    mutationFn: (versionId: number) => {
      if (!review) throw new Error("The evidence review is not ready yet.");
      return getFindingEvidenceCapture({ data: { leadId, draftId: review.draftId, versionId } });
    },
    onMutate: () => setOpenedCapture(null),
    onSuccess: (result) => setOpenedCapture(result),
    onError: () =>
      setOpenedCapture({
        ok: false,
        code: "not-found",
        error: "Could not open that captured version.",
      }),
  });
  /*
    ── THE OPENED TEXT IS BROUGHT TO THE EDITOR (UNIT PUB1) ───────────────────

    The owner pressed "View exact captured version" in the Checks sidebar and
    saw a flash and nothing else: the panel IS rendered, at the foot of
    "Claims & evidence", far below the link on a long review -- so the press
    looked like it had done nothing at all.

    This runs for both answers, a read that found the capture and one that was
    refused, because both render the same panel and both have to be seen. The
    effect (rather than the mutation's callback) is what guarantees the panel
    is in the document before anything is scrolled or focused.
  */
  const capturePanel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openedCapture) return;
    revealOpenedCapture(capturePanel.current);
  }, [openedCapture]);

  /*
    Unit U11b: take this capture's excerpt down, permanently.

    The purge changes what the review can say about this record -- its stored
    text is gone, so the review token moves and any judgment that bound to the
    old text is no longer current -- so the press reloads the review rather
    than leaving the page showing a capture that no longer reads the way it
    did. The pane closes: what it was showing is what just came down.

    Closing the pane is also what discards the form (unit U23): with no capture
    open there is no form, so the reason and the tick go with it rather than
    waiting here for the next record the owner opens.
  */
  const takeDown = useMutation({
    mutationFn: (input: { versionId: number; reason: string; removeLink: boolean }) =>
      takeDownEvidenceCapture({ data: input }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setTakeDownFeedback({ kind: "err", text: result.error });
        return;
      }
      setOpenedCapture(null);
      /*
        FB7, item 5 (A2c X1). The sentence used to be the same whatever the
        editor had ticked, so the one fact a takedown turns on -- whether the
        public notice still carries the link to the original -- was the one
        thing it did not say. A2c measured it: the link WAS kept, and the
        notice never said so, leaving the editor to go and look.

        The server already answers it (`TakeDownCaptureResult.linkKept`,
        evidence-takedown.ts) and the checkbox that decides it is on this form
        ("Remove the link to the original too. Left unticked, the public notice
        keeps the link."). Both arms are stated in the same place, in the same
        words the checkbox uses, so the answer and the question match.
      */
      setTakeDownFeedback({ kind: "ok", text: takedownDoneNotice(result.linkKept) });
      captureRead.reset();
      await reviewQuery.refetch();
      await qc.invalidateQueries({ queryKey: ["finding-evidence-review", leadId] });
    },
    onError: () => setTakeDownFeedback({ kind: "err", text: takedownFailedNotice() }),
  });

  const save = useMutation({
    mutationFn: ({
      findingKey,
      judgment,
      hasReadableCapture,
    }: {
      findingKey: string;
      judgment: JudgmentDraft;
      hasReadableCapture: boolean;
    }) => {
      if (!review) throw new Error("The evidence review is not ready yet.");
      if (judgment.value === "supports" && !hasReadableCapture) {
        throw new Error("A support judgment needs a readable cited captured record.");
      }
      return saveFindingEvidenceJudgment({
        data: {
          leadId,
          draftId: review.draftId,
          findingKey,
          judgment: judgment.value,
          reason: judgment.reason,
          contraryVersionId: judgment.value === "contradicts" ? judgment.contraryVersionId : null,
          evidenceToken: draftToken.current || review.evidenceToken,
        },
      });
    },
    onSuccess: async (result, variables) => {
      if (!result.ok) {
        if (result.code === "conflict") {
          setFeedback({
            kind: "warn",
            text: "The draft or cited evidence changed. Reload the current review before recording a fresh judgment.",
          });
          setReloadRequired(true);
          return;
        }
        setFeedback({ kind: "err", text: result.error });
        return;
      }
      dirtyKeys.current.delete(variables.findingKey);
      const peerKeys = [...dirtyKeys.current];
      const previous = reviewAtDraftStart.current;
      const peersUnchanged = canRebaseDirtyEvidencePeers(previous, result.review, peerKeys);
      qc.setQueryData(["finding-evidence-review", leadId, reviewRevision], result);
      appliedToken.current = result.review.evidenceToken;
      if (peerKeys.length > 0 && peersUnchanged) {
        setDrafts((current) => {
          const refreshed = draftsFrom(result.review);
          for (const key of peerKeys) if (current[key]) refreshed[key] = current[key];
          return refreshed;
        });
        draftToken.current = result.review.evidenceToken;
        reviewAtDraftStart.current = result.review;
        setReloadRequired(false);
        setFeedback({
          kind: "ok",
          text: "Evidence judgment saved. Unsaved edits to another finding were retained.",
        });
      } else if (peerKeys.length > 0) {
        setReloadRequired(true);
        setFeedback({
          kind: "ok",
          text: "Evidence judgment saved. Unsaved edits remain visible, but their review changed; reload before saving them.",
        });
      } else {
        draftToken.current = "";
        reviewAtDraftStart.current = null;
        setDrafts(draftsFrom(result.review));
        setFeedback({ kind: "ok", text: "Evidence judgment saved." });
      }
    },
    onError: (error) => {
      setFeedback({
        kind: "err",
        text: error instanceof Error ? error.message : "Evidence judgment could not be saved.",
      });
    },
  });

  const manualSave = useMutation({
    mutationFn: (action: "upsert" | "remove") => {
      if (!review) throw new Error("The evidence review is not ready yet.");
      if (action === "remove") {
        if (!manualClaim.id) throw new Error("Choose a manual claim to remove.");
        return saveManualClaim({
          data: { leadId, draftId: review.draftId, evidenceToken: manualDraftToken.current || review.evidenceToken, action, id: manualClaim.id },
        });
      }
      return saveManualClaim({
        data: {
          leadId,
          draftId: review.draftId,
          evidenceToken: manualDraftToken.current || review.evidenceToken,
          action,
          id: manualClaim.id,
          fact: manualClaim.fact,
          kind: manualClaim.kind,
          references: manualClaim.references,
        },
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setFeedback({ kind: result.code === "conflict" ? "warn" : "err", text: result.error });
        if (result.code === "conflict") setReloadRequired(true);
        return;
      }
      qc.setQueryData(["finding-evidence-review", leadId, reviewRevision], result);
      appliedToken.current = result.review.evidenceToken;
      if (dirtyKeys.current.size) {
        setReloadRequired(true);
        setFeedback({ kind: "ok", text: "Manual claim saved. Unsaved judgments remain visible; reload before saving them." });
      } else {
        setDrafts(draftsFrom(result.review));
        setFeedback({ kind: "ok", text: "Manual claim saved." });
      }
      resetManualClaim();
      setRecordToAdd("");
    },
    onError: (error) => setFeedback({ kind: "err", text: error instanceof Error ? error.message : "Manual claim could not be saved." }),
  });

  function updateDraft(key: string, update: Partial<JudgmentDraft>) {
    if (!dirtyKeys.current.size && review) {
      draftToken.current = review.evidenceToken;
      reviewAtDraftStart.current = review;
    }
    dirtyKeys.current.add(key);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { value: "unreviewed", reason: "", contraryVersionId: null }),
        ...update,
      },
    }));
  }

  /*
    ── The drawn list (unit CW2) ─────────────────────────────────────────────
    What the Checks tab draws is this review, row by row. `evidenceCheckRows` is
    the same list unit CW built -- the chip, the sentence, what it was checked
    against and the press to the record -- and every row with a review row
    behind it now opens into that row's record checks and its judgment controls.
    A row with nothing behind it opens to nothing.

    The screen this replaces stacked three sets of judgment forms in the page's
    main column below the editors, so an editor met a form before the check it
    judges, and the page ran thousands of pixels past the action row the drawing
    ends on. Here the form sits where the claim it judges sits.
  */
  /*
    ── ONE ANSWER, TWO READERS (UNIT U24) ────────────────────────────────────

    The state of the evidence check on this draft, from the review this panel
    resolved plus the one fact only the page holds (whether a decision or a
    reconciliation stamp is on the memo). The ran line below reads it, the rows
    under it are what it counts, and `list.onEvidenceState` carries it to the
    page's publish bar, chips and blockers -- so the sentence three inches above
    this list and the list itself cannot describe different runs, which they
    did on the stand-in editorial day.

    Reported from an effect keyed on the two values, not on the object: the
    page's state setter is stable, and re-reporting an equal state on every
    render would loop.
  */
  const evidenceState = reviewEvidenceCheckState({
    review,
    recorded: list.evidenceRecorded,
    openClaims: list.openClaims.length,
  });
  const reportEvidenceState = list.onEvidenceState;
  /*
    The values, destructured, so the effect's dependencies are the things that
    changed rather than the object they arrived in -- and so a re-render with
    the same state reports nothing.
  */
  const {
    ran: evidenceRan,
    toReview: evidenceToReview,
    contradicted: evidenceContradicted,
  } = evidenceState;
  const evidenceTokenSeen = review?.evidenceToken ?? null;
  useEffect(() => {
    reportEvidenceState?.({
      ran: evidenceRan,
      toReview: evidenceToReview,
      contradicted: evidenceContradicted,
      evidenceToken: evidenceTokenSeen,
    });
  }, [reportEvidenceState, evidenceRan, evidenceToReview, evidenceContradicted, evidenceTokenSeen]);

  /*
    The drawn line under "Evidence check": the review's own record, read
    through the shared state so it cannot describe a run the bar above denies.
  */
  const ranLine = evidenceRanLine({
    state: evidenceState,
    checkedAt: list.checkedAt,
    modelLabel: list.modelLabel,
    captures: review
      ? citedCaptureCount(review.rows, review.claimRows, review.manualClaimRows)
      : 0,
  });
  /*
    Three of the list's rows -- the claims of absence, the name row and the
    style row -- are measurements the page holds itself and not rows of the
    review, so they are drawn whether or not the review has arrived; the review
    only adds the findings and the claims it holds. With no review at all (a
    draft that has never been checked) the list is then exactly those three,
    which is what the page measured, and the style row keeps the repair press
    where the drawing puts it.
  */
  const listRows: EvidenceListRow[] = evidenceCheckRows({
    rows: review?.rows ?? [],
    claimRows: review?.claimRows ?? [],
    manualClaimRows: review?.manualClaimRows ?? [],
    openClaims: list.openClaims,
    nameCheck: list.nameCheck,
    styleFindings: list.styleFindings,
    groundingRows: review?.groundingRows ?? [],
  });

  /*
    A list row's key is the review row's own key -- the one the judgment save
    takes -- so one map from key to that row's place in its stack is all a
    disclosure body needs to find its form back.
  */
  const reviewRowAt = new Map<string, { kind: "finding" | "claim" | "manual"; index: number }>();
  if (review) {
    review.rows.forEach((row, index) =>
      reviewRowAt.set(`finding:${row.key}`, { kind: "finding", index }),
    );
    review.claimRows.forEach((row, index) =>
      reviewRowAt.set(`claim:${row.key}`, { kind: "claim", index }),
    );
    review.manualClaimRows.forEach((row, index) =>
      reviewRowAt.set(`manual:${row.key}`, { kind: "manual", index }),
    );
  }

  /*
    One answer for every Save judgment on the page. The reasons a judgment
    cannot be saved are the same for all three stacks -- the review this page
    holds is not the one the row was drawn from, the page is busy, the draft
    moved under the judgment -- so computing them per row only made three copies
    of one sentence.
  */
  const saveBusy = save.isPending || manualSave.isPending;
  const maySave = reviewApplied && !disabled && !localDraftChanged && !reloadRequired && !saveBusy;
  /** The controls' own disabled state: a save in flight, or an unapplied review. */
  const locked = disabled || saveBusy || !reviewApplied;

  /** The captures a contradiction may cite: available, readable, once each. */
  const citedVersionsOf = (captures: readonly CaptureRow[]) =>
    captures.filter(
      (capture, captureIndex, all) =>
        capture.available &&
        capture.readable &&
        capture.versionId != null &&
        all.findIndex((candidate) => candidate.versionId === capture.versionId) === captureIndex,
    );

  /**
   * The body of one list row's shut disclosure. A row with no review row behind
   * it -- a claim of absence, the name row -- opens to nothing and gets no
   * disclosure at all.
   */
  const renderRowDetail = (row: EvidenceListRow): ReactNode => {
    /*
      The style row (unit CW2) is the one row that opens into something which is
      not a judgment: the page's Style check section, handed in as markup. It is
      checked before the review is, because the section is the page's own -- it
      is there whether or not a check has run.
    */
    if (row.ref?.kind === "style") return list.styleDetail;
    const source = review;
    if (!source) return null;
    const at = reviewRowAt.get(row.key);
    if (!at) return null;

    if (at.kind === "finding") {
      const finding = source.rows[at.index]!;
      const judgment = drafts[finding.key] ?? {
        value: finding.judgment.value,
        reason: finding.judgment.reason,
        contraryVersionId: finding.judgment.contraryVersionId,
      };
      const citedVersions = citedVersionsOf(finding.captures);
      return (
        <article className="border border-rule bg-paper p-4 sm:p-5">
          <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
            Finding {at.index + 1}
          </p>
          <p className="mt-2 whitespace-pre-wrap font-medium text-ink">{finding.finding.text}</p>
          {finding.finding.excerpt ? (
            <blockquote className="mt-3 border-l-2 border-rust pl-3 text-sm text-ink-2">
              <span className="font-medium">Recorded passage: </span>
              {finding.finding.excerpt}
            </blockquote>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No recorded passage was supplied for this finding.
            </p>
          )}
          {finding.finding.locators.length ? (
            <p className="mt-2 text-sm text-muted">
              Locator: {finding.finding.locators.join(" · ")}
            </p>
          ) : null}
          {finding.finding.sourceUrls.length ? (
            <p className="mt-2 break-all text-sm text-muted">
              Source: {finding.finding.sourceUrls.join(" · ")}
            </p>
          ) : null}
          <CitedRecordChecks
            variant="finding"
            captures={finding.captures}
            onOpen={(versionId) => captureRead.mutate(versionId)}
            pending={captureRead.isPending}
          />
          <JudgmentControls
            idBase="finding"
            index={at.index}
            judgment={judgment}
            citedVersions={citedVersions}
            contraryLabel="Cited contrary captured evidence"
            contraryPlaceholder="Choose a cited captured version"
            noneNote="No available cited capture can support a contradiction judgment."
            locked={locked}
            maySave={maySave}
            savePending={save.isPending}
            localDraftChanged={localDraftChanged}
            onChange={(update) => updateDraft(finding.key, update)}
            onSave={() =>
              save.mutate({
                findingKey: finding.key,
                judgment,
                hasReadableCapture: citedVersions.length > 0,
              })
            }
          />
        </article>
      );
    }

    if (at.kind === "claim") {
      const claim = source.claimRows[at.index]!;
      const judgment = drafts[claim.key] ?? claim.judgment;
      const citedVersions = citedVersionsOf(claim.captures);
      return (
        <article className="border border-rule bg-paper p-4 sm:p-5">
          <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
            Claim {at.index + 1} · {claim.claim.kind}
          </p>
          <p className="mt-2 whitespace-pre-wrap font-medium text-ink">{claim.claim.fact}</p>
          <ClaimReferences claim={claim.claim} currentCheck={claim.currentDocumentCheck} />
          <CitedRecordChecks
            variant="claim"
            captures={claim.captures}
            onOpen={(versionId) => captureRead.mutate(versionId)}
            pending={captureRead.isPending}
          />
          <JudgmentControls
            idBase="claim"
            index={at.index}
            judgment={judgment}
            citedVersions={citedVersions}
            contraryLabel="Cited contrary captured evidence"
            contraryPlaceholder="Choose an exact captured version"
            noneNote=""
            locked={locked}
            maySave={maySave}
            savePending={save.isPending}
            localDraftChanged={localDraftChanged}
            onChange={(update) => updateDraft(claim.key, update)}
            onSave={() =>
              save.mutate({
                findingKey: claim.key,
                judgment,
                hasReadableCapture: citedVersions.length > 0,
              })
            }
          />
        </article>
      );
    }

    const manual = source.manualClaimRows[at.index]!;
    const judgment = drafts[manual.key] ?? manual.judgment;
    const corroborating = manual.captures.filter(
      (capture) =>
        capture.available &&
        capture.readable &&
        capture.relation === "corroborating" &&
        capture.versionId != null,
    );
    const contrary = manual.captures.filter(
      (capture) =>
        capture.available &&
        capture.readable &&
        capture.relation === "contrary" &&
        capture.versionId != null,
    );
    return (
      <article className="border border-rule bg-paper p-4 sm:p-5">
        <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
          Manual claim {at.index + 1} · {manual.claim.kind}
        </p>
        <p className="mt-2 whitespace-pre-wrap font-medium text-ink">{manual.claim.fact}</p>
        <ManualRecordChecks
          captures={manual.captures}
          onOpen={(versionId) => captureRead.mutate(versionId)}
          pending={captureRead.isPending}
        />
        <JudgmentControls
          idBase="manual-claim"
          index={at.index}
          judgment={judgment}
          citedVersions={contrary}
          contraryLabel="Explicit contrary captured record"
          contraryPlaceholder="Choose a contrary record"
          noneNote=""
          locked={locked}
          maySave={maySave}
          savePending={save.isPending}
          localDraftChanged={localDraftChanged}
          onChange={(update) => updateDraft(manual.key, update)}
          onSave={() =>
            save.mutate({
              findingKey: manual.key,
              judgment,
              hasReadableCapture: corroborating.length > 0,
            })
          }
        />
        <div className="mt-4 flex flex-wrap gap-3 border-t border-rule pt-4">
          <InkButton
            tone="quiet"
            small
            disabled={manualSave.isPending}
            onClick={() => {
              /*
                Editing a claim whose form is shut. The token says which saved
                review the form was filled from, and the form's own disclosure is
                opened so the editor lands on the form the press just filled.
              */
              manualDraftToken.current = source.evidenceToken;
              setManualClaim({
                id: manual.claim.id,
                fact: manual.claim.fact,
                kind: manual.claim.kind,
                references: manual.captures
                  .filter((capture) => capture.versionId != null)
                  .map((capture) => ({ versionId: capture.versionId!, relation: capture.relation })),
              });
              const form = document.getElementById("manual-claims-disclosure");
              if (form instanceof HTMLDetailsElement) {
                form.open = true;
                form.scrollIntoView({ block: "center" });
              }
            }}
          >
            Edit claim
          </InkButton>
        </div>
      </article>
    );
  };

  /*
    What the list ends with: the two shut disclosures the drawing's own list has
    no room for, and the note that says what the list is and is not. Both
    disclosures are shut by default -- the drawn page ends under the list, and an
    editor reads the list first.
  */
  const extras = review ? (
    <>
      <details className="astra-evidence-more astra-evidence-extra">
        <summary>All claims and records</summary>
        <div className="astra-evidence-more-body">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="kick">Draft-pass inventory</p>
              <h2 id="draft-pass-claims-heading" className="h2">
                Claims returned by this draft pass
              </h2>
            </div>
            <p className="meta">
              {review.claimRows.length} returned{" "}
              {review.claimRows.length === 1 ? "claim" : "claims"}
            </p>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            This inventory records only claims returned with this draft pass. A matching URL or
            captured record does not establish that a claim is true, complete, or supported.
          </p>
          {review.claimRows.length === 0 ? (
            <div className="mt-4 border border-rule bg-paper-2 p-4" role="status">
              <p className="font-medium text-ink">No claims were returned with this draft pass.</p>
            </div>
          ) : null}
          {review.claimRows.length ? (
            <ul className="mt-3 space-y-3">
              {review.claimRows.map((claim, index) => (
                <li key={claim.key} className="border-l border-rule pl-3 text-sm">
                  <p className="font-medium text-ink">
                    Claim {index + 1} · {claim.claim.kind}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-ink-2">{claim.claim.fact}</p>
                  <ClaimReferences claim={claim.claim} currentCheck={claim.currentDocumentCheck} />
                  <p className="mt-1 text-muted">
                    This claim’s record checks and judgment are on its own row in the list above.
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {review.manualClaimRows.length ? (
            <>
              <p className="kick mt-6">Editor-authored claims</p>
              <p className="meta">
                {review.manualClaimRows.length} manual{" "}
                {review.manualClaimRows.length === 1 ? "claim" : "claims"}, each with its own row in
                the list above
              </p>
            </>
          ) : null}
        </div>
      </details>

      <details className="astra-evidence-more astra-evidence-extra" id="manual-claims-disclosure">
        <summary>+ Add a claim</summary>
        <div className="astra-evidence-more-body">
          <h2 id="manual-claims-heading" className="h2">
            Claims added by an editor
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Add only a fact an editor wants to review. Select exact already captured records and
            name their role; record count or host names do not establish independence, truth, or
            support.
          </p>
          <div className="mt-4 border border-rule bg-paper-2 p-4 sm:p-5">
            <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
              {manualClaim.id ? "Edit manual claim" : "Add manual claim"}
            </p>
            <label className="mt-3 block text-sm font-medium text-ink" htmlFor="manual-claim-fact">
              Claim text
            </label>
            <textarea
              id="manual-claim-fact"
              className="mt-1 min-h-24 w-full border border-rule bg-paper p-3 text-sm"
              maxLength={400}
              disabled={disabled || saveBusy || localDraftChanged || reloadRequired}
              value={manualClaim.fact}
              onChange={(event) =>
                updateManualClaim((current) => ({ ...current, fact: event.target.value }))
              }
            />
            <label className="mt-3 block text-sm font-medium text-ink" htmlFor="manual-claim-kind">
              Claim kind
            </label>
            <select
              id="manual-claim-kind"
              className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm sm:max-w-sm"
              disabled={disabled || saveBusy || localDraftChanged || reloadRequired}
              value={manualClaim.kind}
              onChange={(event) =>
                updateManualClaim((current) => ({
                  ...current,
                  kind: event.target.value as ManualClaimForm["kind"],
                }))
              }
            >
              <option value="primary">Primary</option>
              <option value="record">Record</option>
              <option value="news">News</option>
            </select>
            <div className="mt-4 border-t border-rule pt-4">
              <p className="text-sm font-medium text-ink">Explicit captured records</p>
              <p className="mt-1 text-sm text-muted">
                The first choices are records saved with this draft. Other options are already
                captured records in this newsroom; no URL is fetched or substituted.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label
                  className="min-w-56 flex-1 text-sm font-medium text-ink"
                  htmlFor="manual-claim-record"
                >
                  Named, dated record
                  <select
                    id="manual-claim-record"
                    className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm"
                    value={recordToAdd}
                    disabled={disabled || saveBusy || localDraftChanged || reloadRequired}
                    onChange={(event) => setRecordToAdd(event.target.value)}
                  >
                    <option value="">Choose a captured record</option>
                    {review.manualClaimCaptureOptions.map((record) => (
                      <option key={record.versionId} value={record.versionId}>
                        {record.title ?? record.url} · {record.capturedAt ?? "date unavailable"}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="min-w-44 text-sm font-medium text-ink"
                  htmlFor="manual-claim-relation"
                >
                  Relationship
                  <select
                    id="manual-claim-relation"
                    className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm"
                    value={recordRelation}
                    disabled={disabled || saveBusy || localDraftChanged || reloadRequired}
                    onChange={(event) =>
                      setRecordRelation(event.target.value as ManualClaimReferenceRelation)
                    }
                  >
                    <option value="corroborating">Corroborating</option>
                    <option value="contrary">Contrary</option>
                    <option value="context">Context</option>
                  </select>
                </label>
                <InkButton
                  small
                  disabled={
                    !recordToAdd ||
                    manualClaim.references.length >= 6 ||
                    disabled ||
                    saveBusy ||
                    localDraftChanged ||
                    reloadRequired
                  }
                  onClick={() => {
                    const versionId = Number(recordToAdd);
                    if (!manualClaim.references.some((reference) => reference.versionId === versionId))
                      updateManualClaim((current) => ({
                        ...current,
                        references: [...current.references, { versionId, relation: recordRelation }],
                      }));
                    setRecordToAdd("");
                  }}
                >
                  Add record
                </InkButton>
              </div>
              {manualClaim.references.length ? (
                <ul className="mt-3 space-y-2">
                  {manualClaim.references.map((reference) => {
                    const record = review.manualClaimCaptureOptions.find(
                      (candidate) => candidate.versionId === reference.versionId,
                    );
                    return (
                      <li
                        key={reference.versionId}
                        className="flex flex-wrap items-center justify-between gap-2 border-l border-rule pl-3 text-sm"
                      >
                        <span>
                          {record?.title ?? `Captured version ${reference.versionId}`} ·{" "}
                          {reference.relation}
                        </span>
                        <button
                          type="button"
                          className="inline-link"
                          disabled={manualSave.isPending}
                          onClick={() =>
                            updateManualClaim((current) => ({
                              ...current,
                              references: current.references.filter(
                                (candidate) => candidate.versionId !== reference.versionId,
                              ),
                            }))
                          }
                        >
                          Remove record
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">Select at least one exact captured record.</p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <InkButton
                disabled={
                  !manualClaim.fact.trim() ||
                  manualClaim.references.length === 0 ||
                  disabled ||
                  saveBusy ||
                  localDraftChanged ||
                  reloadRequired
                }
                onClick={() => manualSave.mutate("upsert")}
              >
                {manualSave.isPending
                  ? "Saving manual claim…"
                  : manualClaim.id
                    ? "Save manual claim"
                    : "Add manual claim"}
              </InkButton>
              {manualClaim.id ? (
                <InkButton tone="quiet" disabled={manualSave.isPending} onClick={resetManualClaim}>
                  Cancel edit
                </InkButton>
              ) : null}
              {manualClaim.id ? (
                <InkButton
                  tone="danger"
                  disabled={
                    disabled || saveBusy || localDraftChanged || reloadRequired || !reviewApplied
                  }
                  onClick={() => manualSave.mutate("remove")}
                >
                  Remove manual claim
                </InkButton>
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </>
  ) : null;

  return (
    <div id="finding-evidence-review">
      {reviewQuery.isPending ? <BusyLine label="Loading recorded finding evidence…" /> : null}
      {reviewQuery.isError ? (
        <Notice kind="err">
          Could not load the evidence review.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => void reload()}
            disabled={reviewQuery.isRefetching}
          >
            Try again
          </button>
        </Notice>
      ) : null}
      {reviewQuery.data && !reviewQuery.data.ok ? (
        <Notice kind="err">
          {reviewQuery.data.error}
          {reviewQuery.data.code !== "invalid-input" ? (
            <>
              {" "}
              <button
                type="button"
                className="inline-link"
                onClick={() => void reload()}
                disabled={reviewQuery.isRefetching}
              >
                Try again
              </button>
            </>
          ) : null}
        </Notice>
      ) : null}
      {feedback ? <Notice kind={feedback.kind}>{feedback.text}</Notice> : null}
      {/*
        The takedown's own line, at panel level rather than inside the pane:
        the pane closes when a takedown succeeds -- what it was showing is what
        just came down -- and a confirmation drawn inside it would leave with
        it.
      */}
      {takeDownFeedback ? (
        <Notice kind={takeDownFeedback.kind}>{takeDownFeedback.text}</Notice>
      ) : null}

      {/*
        Unit PUB1: the "Opening…" line is drawn at the link that was pressed
        (see `CitedRecordChecks`), not here -- here it was below the fold on a
        long review, which is the flash-and-nothing the owner saw.
      */}
      {openedCapture ? (
        <div
          ref={capturePanel}
          tabIndex={-1}
          className="mt-4 border border-rule bg-paper-2 p-4"
          role="region"
          aria-label="Captured text"
        >
          {openedCapture.ok ? (
            <>
              <p className="font-medium text-ink">
                {openedCapture.capture.title ?? "Captured version"}
              </p>
              <p className="mt-1 break-all text-sm text-muted">{openedCapture.capture.url}</p>
              <p className="mt-1 text-sm text-muted">
                {openedCapture.capture.capturedAt
                  ? `Captured ${openedCapture.capture.capturedAt}`
                  : "Capture time unavailable"}
              </p>
              {openedCapture.capture.fullText.trim() ? (
                <pre className="read-full mt-3">{openedCapture.capture.fullText}</pre>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {openedCapture.capture.takenDown
                    ? "This excerpt was removed at the publisher’s request, and it cannot be restored."
                    : "This captured version has no readable text."}
                </p>
              )}
              {/*
                Unit U11b2: the takedown's own record, for the owner.

                `takenDownReason` only arrives on an owner's read (see
                `loadFindingEvidenceCapture`), so an editor sees the sentence
                above and no note -- the reason is not hidden here, it was never
                sent. The two fields are read as one line because they are one
                fact: when the owner took it down, and what they wrote.
              */}
              {openedCapture.capture.takenDown && openedCapture.capture.takenDownReason ? (
                <p className="mt-3 border-l-2 border-rule pl-3 text-sm text-muted">
                  Taken down {openedCapture.capture.takenDownAt ?? "(time not recorded)"}. Reason
                  recorded for the audit trail: “{openedCapture.capture.takenDownReason}”
                </p>
              ) : null}
              {/*
                Unit U11b: the owner's press, beside the captured text it acts
                on. An editor sees the text and no press; an owner who is not
                sure what they are looking at is looking right at it.
              */}
              {isOwner && !openedCapture.capture.takenDown ? (
                <div className="mt-4 border-t border-rule pt-3">
                  {takeDownForm.open ? (
                    <>
                      {/*
                        Unit U23: the press below cannot be undone, so the line
                        above it names the one capture it would take down --
                        title and address. It is built by
                        `takeDownConfirmText` (src/lib/news/evidence-takedown-form.ts)
                        rather than assembled here, so the words are tested.
                      */}
                      <p className="max-w-3xl text-sm font-medium text-ink">
                        {takeDownConfirmText(openedCapture.capture)}
                      </p>
                      <p className="mt-3 max-w-3xl text-sm text-muted">
                        This deletes the excerpt, the extracted text and the original file stored
                        for this capture, and the desk’s own working copies of it — the Dark Desk
                        artifact and the passages recorded on claims and relationships from this
                        version. The record’s address, hash and capture history stay, so published
                        citations still resolve — to a notice instead of an excerpt. Source
                        snapshots, note fields and backups are separate records and are not
                        touched. It takes effect immediately and{" "}
                        <span className="font-medium text-ink">there is no restore.</span>
                      </p>
                      <label
                        className="mt-3 block text-sm font-medium text-ink"
                        htmlFor="capture-takedown-reason"
                      >
                        Why is this capture coming down?
                      </label>
                      <textarea
                        id="capture-takedown-reason"
                        className="mt-1 min-h-20 w-full border border-rule bg-paper p-3 text-sm"
                        maxLength={TAKEDOWN_REASON_MAX}
                        value={takeDownForm.reason}
                        disabled={takeDown.isPending}
                        onChange={(event) =>
                          editTakeDown((current) => ({ ...current, reason: event.target.value }))
                        }
                      />
                      <label
                        className="mt-3 flex items-start gap-2 text-sm text-ink"
                        htmlFor="capture-takedown-remove-link"
                      >
                        <input
                          id="capture-takedown-remove-link"
                          type="checkbox"
                          className="mt-1"
                          checked={takeDownForm.removeLink}
                          disabled={takeDown.isPending}
                          onChange={(event) =>
                            editTakeDown((current) => ({
                              ...current,
                              removeLink: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          Remove the link to the original too. Left unticked, the public notice
                          keeps the link.
                        </span>
                      </label>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <InkButton
                          tone="danger"
                          small
                          disabled={!takeDownForm.reason.trim() || takeDown.isPending}
                          onClick={() =>
                            takeDown.mutate({
                              versionId: openedCapture.capture.versionId,
                              reason: takeDownForm.reason,
                              removeLink: takeDownForm.removeLink,
                            })
                          }
                        >
                          {takeDown.isPending ? "Taking down…" : "Take down this capture"}
                        </InkButton>
                        <InkButton
                          tone="quiet"
                          small
                          disabled={takeDown.isPending}
                          onClick={() => editTakeDown(() => blankTakeDownForm(openedVersionId))}
                        >
                          Cancel takedown
                        </InkButton>
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        The reason is kept in the desk’s audit trail. It is never shown to a reader.
                      </p>
                    </>
                  ) : (
                    <InkButton
                      tone="danger"
                      small
                      disabled={takeDownDisabled}
                      onClick={() => {
                        setTakeDownFeedback(null);
                        editTakeDown((current) => ({ ...current, open: true }));
                      }}
                    >
                      Take down this capture
                    </InkButton>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <Notice kind="err">{openedCapture.error}</Notice>
          )}
          <InkButton tone="quiet" small onClick={() => setOpenedCapture(null)}>
            Close captured text
          </InkButton>
        </div>
      ) : null}

      {review && localDraftChanged ? (
        <Notice kind="warn">
          Save the current headline, dek, body, and section before recording a judgment. Judgments
          bind to the exact saved draft and cited evidence.
        </Notice>
      ) : null}
      {review && reloadRequired ? (
        <Notice kind="warn">
          The saved review changed while this page has unsaved evidence edits.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => void reload()}
            disabled={reviewQuery.isRefetching}
          >
            Reload current review and discard unsaved evidence edits
          </button>
        </Notice>
      ) : null}

      {/*
        A meeting draft has no URL-receipt claims, so this block is the whole
        answer for it: the citations it used, each with its timestamp and
        whether it still resolves. Rendered beside the finding rows rather than
        instead of them, because a draft can have both.
      */}
      {meetingEvidence ? <TranscriptCitationEvidence evidence={meetingEvidence} /> : null}

      {/*
        FB6 item 8b, from the stand-in walkthrough (A2c-REPORT.md §6 C5): this
        paragraph printed "there is nothing to review here" directly ABOVE the
        list's own first row, "Evidence check ! Needs review".

        The two panes were reading two different things. This one asked whether
        the REVIEW had rows (`review.rows.length`), and the list under it is
        built by `evidenceCheckRows` from three more sources the page holds
        itself -- the claims of absence, the name row and the style row -- none
        of which are `review.rows`. Any of those can carry a "! Needs review"
        chip, so the pane could deny in one line what the row below it asserted
        in the next.

        The list is the source of truth here: `listRows` is exactly what is
        drawn, so the sentence says "nothing to review" only when there is
        nothing on the screen to review. One fact, one place, both panes.
      */}
      {review && listRows.length === 0 && !meetingEvidence ? (
        <div className="mt-4 border border-rule bg-paper-2 p-4" role="status">
          <p className="text-sm text-ink">
            This draft has no recorded findings and no transcript citations, so there is nothing to
            review here. This review does not inventory every claim in the story.
          </p>
        </div>
      ) : null}

      <EvidenceCheckList
        ranLine={ranLine}
        rows={listRows}
        compareLabel={list.compareLabel}
        onCompare={list.onCompare}
        onStylePress={list.onStylePress}
        onOpenRecord={(href) => {
          const versionId = Number(href.match(/^\/evidence\/(\d+)$/)?.[1]);
          if (Number.isSafeInteger(versionId) && versionId > 0) captureRead.mutate(versionId);
        }}
        detail={renderRowDetail}
        footer={extras}
      />

      <p className="mt-4 max-w-3xl text-sm text-muted">
        This list contains only recorded findings. A passage match confirms that the recorded words
        appear in a cited version; it does not decide whether a finding is true. A missing capture
        or passage is a mechanical state, not a contradiction. A newer capture is material to
        review, not proof that the cited record is false.
      </p>
    </div>
  );
}
