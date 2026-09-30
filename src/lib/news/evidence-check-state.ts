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
 * WHAT COUNTS AS "NEEDING REVIEW" is deliberately the same predicate the pane
 * draws its `! Needs review` chip from (`claimNeedsReview` below, which
 * `judgmentChip` uses). The count on the blocker and the number of rows chipped
 * `! Needs review` are the same number because they are the same expression,
 * not because two rules were written to agree. A row the check could not read
 * (`Could not check`, no readable capture) is NOT counted here: there is no
 * judgment to record against it, so a "review the claims" press would be a
 * dead end. That state stays where it already is, on the pane's own chip.
 *
 * Pure -- no DOM, no database, no hooks -- so both the page and the publish
 * gate can ask it, and a test can pin it without a browser.
 */

import { claimNeedsReview, judgmentChip, NEEDS_REVIEW_CHIP } from "./evidence-check-list.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
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
  /** Claims the check raised that a person has not judged yet. */
  toReview: number;
};

/** One row of any of the review's three stacks, as the two predicates need it. */
type ReviewableRow = {
  judgment: { value: FindingJudgment };
  captures: readonly FindingCaptureEvidence[];
};

/**
 * How many rows of a resolved review are waiting on a person.
 *
 * THE TRIPWIRE: every counted row must chip `! Needs review`, and every row
 * that chips `! Needs review` with no judgment behind it must be counted. A
 * test walks the whole judgment matrix and fails if this and the chip ever
 * disagree, so the blocker's number and the pane's rows cannot drift.
 *
 * ONE ROW CHIPS THE REVIEW CHIP WITHOUT BEING COUNTED, deliberately: a
 * judgment of `contradicts` is a recorded answer -- the editor read the record
 * and it does not say what the claim says -- so nothing is waiting on anybody,
 * and the fix is to re-judge or rewrite the sentence, not to review it. The
 * count is "claims nobody has judged", which is the thing a person can be
 * asked to do; the contradiction keeps its own chip on the pane, which is
 * where the editor meets it.
 */
export function claimsNeedingReview(
  rows: readonly FindingEvidenceRow[],
  claimRows: readonly ClaimEvidenceRow[],
  manualClaimRows: readonly ManualClaimEvidenceRow[],
): number {
  let count = 0;
  for (const row of [...rows, ...claimRows, ...manualClaimRows] as ReviewableRow[]) {
    if (!claimNeedsReview(row.judgment.value, row.captures)) continue;
    /* Belt and braces against a `judgmentChip` change that stops printing the
       review chip for a row that meets the review predicate: the count is only
       honest while these two say the same thing. */
    if (judgmentChip(row.judgment.value, row.captures).chip !== NEEDS_REVIEW_CHIP) continue;
    count += 1;
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
}): EvidenceCheckState {
  const fromTheRun = input.findings + input.claims + input.manualClaims;
  return {
    ran: input.recorded || fromTheRun > 0 || input.openClaims > 0,
    toReview: input.toReview,
  };
}

/** The three stacks of a resolved review, or none when it has not loaded. */
type ReviewLike = {
  rows: readonly FindingEvidenceRow[];
  claimRows: readonly ClaimEvidenceRow[];
  manualClaimRows: readonly ManualClaimEvidenceRow[];
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
}): EvidenceCheckState {
  const review = input.review;
  return evidenceCheckState({
    recorded: input.recorded,
    findings: review?.rows.length ?? 0,
    claims: review?.claimRows.length ?? 0,
    manualClaims: review?.manualClaimRows.length ?? 0,
    openClaims: input.openClaims,
    toReview: review
      ? claimsNeedingReview(review.rows, review.claimRows, review.manualClaimRows)
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
