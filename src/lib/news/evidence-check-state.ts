/**
 * One answer to "did an evidence check run on this draft, and what is still
 * waiting on a person" (unit U24, from the stand-in editorial day).
 *
 * THE CONTRADICTION THIS EXISTS TO STOP. On one draft, on one screen, the
 * publish bar read `○ Evidence check not run` and `Nothing blocks Publish. No
 * evidence check ran on this draft.` while the Checks pane three inches below
 * it read `Evidence check — checked against 2 captures` over seven rows chipped
 * `! Needs review`. Both were computed honestly; they were computed from
 * different facts.
 *
 *   - The chips and the bar asked the RECORD: `research_json.evidenceReview`
 *     and `evidenceReconciledAt` (`check-gates.ts`, `recordedChecks`). Both
 *     are written by the editor's own evidence review and by the "Check draft
 *     against evidence" reconcile job -- and by nothing else.
 *   - The pane asked the MATERIAL: the findings the draft pass wrote to
 *     `found_note` and the captured records they cite (`evidence-check-list.ts`,
 *     `citedCaptureCount`). A draft whose evidence pass ran inside the drafting
 *     job has all of that and neither of the two records above, so the pane
 *     said "checked" and the bar said "never ran" -- about the same run.
 *
 * So the run's own output is a third record, and this module reads it: a draft
 * with findings, or with claims, has been through an evidence check, whatever
 * the reconcile job has or has not stamped since. `recordedChecks` keeps
 * reading the memo (it is about a DECISION, and a decision is still the only
 * thing that makes a pass), and both it and this are handed to the same
 * `CheckFacts` -- one screen, one set of facts.
 *
 * Open work is the pane's `! Needs review` plus `Could not check` rows. The
 * latter remain open until the editor adds a usable record or records a
 * decision; a missing check must not disappear from the Publish count.
 *
 * Pure -- no DOM, no database, no hooks -- so both the page and the publish
 * gate can ask it, and a test can pin it without a browser.
 */

import { COULD_NOT_CHECK_CHIP, judgmentChip, NEEDS_REVIEW_CHIP } from "./evidence-check-list.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import type { DraftGroundingRow } from "./draft-specifics.ts";
import type {
  ClaimEvidenceRow,
  FindingCaptureEvidence,
  FindingEvidenceRow,
  FindingJudgment,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";
import { topicConfirmationFingerprint, type UnreviewedClaimsConfirmation } from "./notes.ts";
import type { DraftRow } from "./types.ts";

/**
 * What one screen says about the evidence check.
 *
 * `ran` is about the RUN; `toReview` is about the WORK the run left behind.
 * They are separate answers on purpose: "a check ran and found nothing to
 * judge" and "a check ran and seven claims are waiting" are different states,
 * and the second one is the one that was reachable in the desk and invisible
 * on the bar.
 */
export type EvidenceCheckState = {
  /** Did an evidence check run against this draft at all? */
  ran: boolean;
  /**
   * Open rows the Checks pane chips `! Needs review` or `Could not check`.
   */
  toReview: number;
  /**
   * How many of `toReview` the record CONTRADICTS (M5). Always `<= toReview`:
   * a subset of the same rows, by the same predicate.
   */
  contradicted: number;
};

/**
 * The state, plus the identity of the review it was read from (unit U24b).
 *
 * The panel is the only thing that holds a resolved review, so it is also the
 * only thing that holds the review's own `evidenceToken` -- the value the
 * judgment saves take and the one the acceptance press now carries, so a
 * server can tell "the review this editor was looking at" from "a review that
 * has moved since". It travels with the state rather than in a second callback
 * because the two are always read and written together.
 */
export type EvidenceCheckReport = EvidenceCheckState & {
  /**
   * `FindingEvidenceReview.evidenceToken`, or null while the review has not
   * been read. Null is a real answer: an acceptance cannot be recorded against
   * a review nobody has resolved, and the server refuses it.
   */
  evidenceToken: string | null;
};

/** One row of any of the review's three stacks, as the two predicates need it. */
type ReviewableRow = {
  judgment: { value: FindingJudgment; ai?: { verdict: string } };
  captures: readonly FindingCaptureEvidence[];
};

/**
 * How many rows of a resolved review the Checks pane is asking a person to
 * deal with.
 *
 * THE TRIPWIRE: this is exactly the number of rows the pane chips
 * `! Needs review`, because it IS that predicate -- `judgmentChip` is what is
 * called here, not a second rule written to agree with it. A test builds the
 * real list (`evidenceCheckRows`, the same call the pane makes) and fails if
 * the two numbers ever differ, so the blocker, the chip and the pane's rows
 * cannot drift apart.
 *
 * UNIT U24b -- A CONTRADICTION IS COUNTED. U24 counted only rows nobody had
 * judged, on the reasoning that `contradicts` is a recorded answer and so
 * nothing is "waiting" on anybody. The audit found what that produced: four
 * rows chipped `! Needs review` under a blocker that said three, and -- the
 * part that matters -- a story whose claim the captured record CONTRADICTS
 * printing unblocked. A contradiction is not an answer the desk can print on.
 * It is a sentence to change or a judgment to re-make, which is exactly what
 * "review" means here, so the count is the pane's own list of rows that need a
 * person whatever put them there.
 *
 * A row the check could not read (`Could not check`) remains open until the
 * editor adds a usable record or records a decision. It is counted in the same
 * publish headcount as an unreviewed or contradicted row.
 */
export function claimsNeedingReview(
  rows: readonly FindingEvidenceRow[],
  claimRows: readonly ClaimEvidenceRow[],
  manualClaimRows: readonly ManualClaimEvidenceRow[],
  /**
   * Round 2, item 5: the draft's ungrounded specifics. They wear the same
   * `! Needs review` chip as the row stacks (`evidenceCheckRows` hardcodes it),
   * so they are counted here for the same reason every other such row is: the
   * blocker's number and the pane's number of `! Needs review` rows must be the
   * same number, and this is the one place that number is computed.
   */
  groundingRows: readonly DraftGroundingRow[] = [],
  includeCouldNotCheck = true,
): number {
  let count = groundingRows.length;
  for (const row of [...rows, ...claimRows, ...manualClaimRows] as ReviewableRow[]) {
    const chip = judgmentChip(row.judgment.value, row.captures).chip;
    if ((row.judgment.ai && row.judgment.ai.verdict !== "Supported") || chip === NEEDS_REVIEW_CHIP || (includeCouldNotCheck && chip === COULD_NOT_CHECK_CHIP)) count += 1;
  }
  return count;
}

/**
 * How many of those rows the captured record CONTRADICTS.
 *
 * M5 of the batch-6 pre-merge audit. `claimsNeedingReview` counts a
 * contradiction with the unreviewed, because both are work a person has to do
 * before this prints -- but they are not the same sentence to the editor. "Five
 * claims need review" reads as five claims nobody has looked at; "three
 * contradicted by the record" is the one an editor has to change the story for.
 * Folding them together is how a story whose claim the record contradicts
 * prints with a head count that never mentioned it.
 *
 * A subset of `claimsNeedingReview`, by construction: the same `judgmentChip`
 * predicate decides both, and this one keeps only the `contradicts` rows. So
 * this can never exceed the count on the blocker that carries it.
 */
export function contradictedClaims(
  rows: readonly FindingEvidenceRow[],
  claimRows: readonly ClaimEvidenceRow[],
  manualClaimRows: readonly ManualClaimEvidenceRow[],
): number {
  let count = 0;
  for (const row of [...rows, ...claimRows, ...manualClaimRows] as ReviewableRow[]) {
    if (row.judgment.value !== "contradicts") continue;
    if (judgmentChip(row.judgment.value, row.captures).chip === NEEDS_REVIEW_CHIP) count += 1;
  }
  return count;
}

/**
 * The state, from the two records and the run's own output.
 *
 * Every input is a count of something the desk already stores:
 *
 *   - `recorded` -- a decision on the review, or the reconcile job's stamp
 *     (`check-gates.ts`, `recordedChecks`). The editor's own answer.
 *   - `findings`, `claims`, `manualClaims` -- what the evidence pass produced
 *     (`drafts.found_note`, `research_json.reportedClaims`, `manualClaims`).
 *     THIS is the third record: a draft with any of these has been through a
 *     check even when the reconcile job has never run on it.
 *   - `openClaims` -- claims of absence the gate raised that nobody ticked.
 *     The gate is part of the same pass, so its output is a record too.
 *   - `toReview` -- `claimsNeedingReview` over the resolved rows.
 */
export function evidenceCheckState(input: {
  recorded: boolean;
  findings: number;
  claims: number;
  manualClaims: number;
  openClaims: number;
  toReview: number;
  /** How many of `toReview` the record contradicts. Defaults to none. */
  contradicted?: number;
  /**
   * Round 2, item 5: the draft's ungrounded specifics, already counted inside
   * `toReview` (they are rows of the pane's list). Counted here too so a draft
   * whose ONLY finding is an invented figure still reads as "a check ran" -- the
   * measurement is the run's output, like the findings and the absence claims.
   */
  grounding?: number;
}): EvidenceCheckState {
  const fromTheRun = input.findings + input.claims + input.manualClaims + (input.grounding ?? 0);
  return {
    ran: input.recorded || fromTheRun > 0 || input.openClaims > 0,
    toReview: input.toReview,
    // Cannot exceed the head count it is a subset of, whatever a caller passes.
    contradicted: Math.min(input.contradicted ?? 0, input.toReview),
  };
}

/** The three stacks of a resolved review, or none when it has not loaded. */
type ReviewLike = {
  rows: readonly FindingEvidenceRow[];
  claimRows: readonly ClaimEvidenceRow[];
  manualClaimRows: readonly ManualClaimEvidenceRow[];
  /** Round 2, item 5: the draft's ungrounded specifics, when it carries any. */
  groundingRows?: readonly DraftGroundingRow[];
};

/**
 * The state of a draft whose review HAS been resolved -- the shape the Checks
 * pane holds and the shape the publish gate loads on the server.
 *
 * `review: null` is not "no check ran": it is "the review has not been read",
 * and the caller is expected to fall back to the record it holds (the page's
 * own `recordedChecks`) rather than to print a state this function cannot
 * support. `recorded` is passed through for exactly that reason.
 */
export function reviewEvidenceCheckState(input: {
  review: ReviewLike | null;
  recorded: boolean;
  openClaims: number;
  includeCouldNotCheck?: boolean;
}): EvidenceCheckState {
  const review = input.review;
  return evidenceCheckState({
    recorded: input.recorded,
    findings: review?.rows.length ?? 0,
    claims: review?.claimRows.length ?? 0,
    manualClaims: review?.manualClaimRows.length ?? 0,
    openClaims: input.openClaims,
    grounding: review?.groundingRows?.length ?? 0,
    toReview: review
      ? claimsNeedingReview(
          review.rows,
          review.claimRows,
          review.manualClaimRows,
          review.groundingRows ?? [],
          input.includeCouldNotCheck ?? true,
        )
      : 0,
    contradicted: review
      ? contradictedClaims(review.rows, review.claimRows, review.manualClaimRows)
      : 0,
  });
}

/**
 * The fingerprint an acceptance is recorded against: this exact draft version.
 *
 * `topicConfirmationFingerprint(evidenceReviewToken(draft))` -- the SAME
 * identity the section confirmation uses, deliberately, so "this draft" means
 * one thing on this page. The token already covers the memo, so judging a
 * claim, redrafting or editing the text all move it, and an acceptance given
 * for one version cannot authorize the next. That is the honest behaviour: the
 * acceptance says "I read THESE claims", and a different draft is a different
 * set of claims.
 *
 * `topicConfirmationFingerprint` is a 64-bit hash rather than the token itself
 * because the token carries the whole body and storing it in `notes_json`
 * would push `packNotes` over its limit -- see the note on that function.
 */
export function unreviewedClaimsFingerprint(draft: Partial<DraftRow>): string {
  return topicConfirmationFingerprint(evidenceReviewToken(draft));
}

/**
 * Does a stored acceptance cover the draft in front of us?
 *
 * Absent, half-written, or recorded for an older version are all "no": the
 * claims on screen have not been accepted by anybody.
 */
export function acceptanceCoversDraft(
  draft: Partial<DraftRow>,
  confirmation: UnreviewedClaimsConfirmation | null | undefined,
): boolean {
  if (!confirmation?.token) return false;
  return confirmation.token === unreviewedClaimsFingerprint(draft);
}
