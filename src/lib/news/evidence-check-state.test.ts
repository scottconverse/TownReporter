import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptanceCoversDraft,
  claimsNeedingReview,
  contradictedClaims,
  evidenceCheckState,
  reviewEvidenceCheckState,
  unreviewedClaimsFingerprint,
} from "./evidence-check-state.ts";
import { claimNeedsReview, judgmentChip, COULD_NOT_CHECK_CHIP, NEEDS_REVIEW_CHIP } from "./evidence-check-list.ts";
import type {
  ClaimEvidenceRow,
  FindingCaptureEvidence,
  FindingEvidenceRow,
  FindingJudgment,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";

/**
 * Unit U24: the one state the publish bar, the chips and the Checks pane read.
 *
 * THE CONTRADICTION THIS PINS. On the stand-in editorial day the bar said
 * `○ Evidence check not run` while the pane three inches below it said
 * `Evidence check — checked against 2 captures` over seven `! Needs review`
 * rows. Both readers were honest about their own facts and the facts were
 * different: the bar asked the draft's memo and the pane asked the run's
 * output. These tests hold the three claims that fix it:
 *
 *   1. A draft with findings has been through a check, whether or not the
 *      memo records a decision -- the RUN, not the answer.
 *   2. The number on the blocker is the number of rows the pane chips
 *      `! Needs review`, because they are the same expression, not two rules
 *      written to agree. The matrix test below is the tripwire.
 *   3. An acceptance is for ONE draft version, so it cannot authorize a story
 *      nobody read.
 */

function capture(patch: Partial<FindingCaptureEvidence> = {}): FindingCaptureEvidence {
  return {
    versionId: 1,
    captureEventId: null,
    url: "https://records.example/agenda",
    title: "Agenda packet",
    capturedAt: "2026-09-30T14:00:00.000Z",
    available: true,
    readable: true,
    takenDown: false,
    excerptState: "found",
    newerCapture: null,
    viewHref: "/evidence/1",
    ...patch,
  };
}

const readable = capture();
const unreadable = capture({ readable: false });
const missing = capture({ versionId: null, available: false, readable: false, viewHref: null });

function row(
  judgment: FindingJudgment,
  captures: readonly FindingCaptureEvidence[],
): FindingEvidenceRow {
  return {
    key: `f-${judgment}`,
    finding: { text: "The budget is $547.5 million.", sourceUrls: [], locators: [], excerpt: null },
    captures: [...captures],
    judgment: { value: judgment, reason: "", contraryVersionId: null },
  };
}

function claimRow(
  judgment: FindingJudgment,
  captures: readonly FindingCaptureEvidence[],
): ClaimEvidenceRow {
  return {
    key: `c-${judgment}`,
    claim: { fact: "The council adopted the budget.", url: "https://records.example/agenda", kind: "news" },
    captures: [...captures],
    judgment: { value: judgment, reason: "", contraryVersionId: null },
  };
}

function manualRow(
  judgment: FindingJudgment,
  captures: readonly FindingCaptureEvidence[],
): ManualClaimEvidenceRow {
  return {
    key: `m-${judgment}`,
    claim: { id: "11111111-1111-4111-8111-111111111111", fact: "A hand-added claim.", kind: "record" },
    captures: [...captures] as ManualClaimEvidenceRow["captures"],
    judgment: { value: judgment, reason: "", contraryVersionId: null },
  };
}

const JUDGMENTS: FindingJudgment[] = [
  "unreviewed",
  "supports",
  "does-not-support",
  "contradicts",
  "needs-reporting",
];
const CAPTURE_SETS: readonly (readonly FindingCaptureEvidence[])[] = [
  [readable],
  [unreadable],
  [missing],
  [],
];

describe("U24/U24b: what the pane chips and what the blocker counts are one rule", () => {
  // guards: an open row could be missing from the Publish count when its record cannot be checked.
  it("counts every open row the pane marks for review or unable to check", () => {
    /* The count follows the pane's own chips: both unresolved review rows and
       rows the check could not perform are open facts for Publish. */
    for (const judgment of JUDGMENTS) {
      for (const captures of CAPTURE_SETS) {
        const chip = judgmentChip(judgment, captures).chip;
        const count = claimsNeedingReview(
          [row(judgment, captures)],
          [claimRow(judgment, captures)],
          [manualRow(judgment, captures)],
        );
        const label = `${judgment}/${captures.length} capture(s)`;
        if (chip === NEEDS_REVIEW_CHIP || chip === COULD_NOT_CHECK_CHIP) {
          assert.equal(count, 3, `${label}: every stack counts an open row`);
        } else {
          assert.equal(count, 0, `${label}: nothing counted`);
        }
      }
    }
  });

  it("counts a claim the record contradicts, which is the row the audit found uncounted", () => {
    const contradicting = row("contradicts", [readable]);
    assert.equal(judgmentChip("contradicts", [readable]).chip, NEEDS_REVIEW_CHIP);
    assert.equal(
      claimsNeedingReview([contradicting], [], []),
      1,
      "a story whose claim the record contradicts must not print on that answer",
    );
  });

  // guards: a claim the AI could not check could reach Publish without its open work counted.
  it("counts a could-not-check row as open work without calling it a review judgment", () => {
    assert.equal(claimNeedsReview("unreviewed", [unreadable]), false);
    assert.equal(claimNeedsReview("unreviewed", []), false);
    assert.equal(claimNeedsReview("unreviewed", [readable]), true);
    assert.equal(claimsNeedingReview([row("unreviewed", [unreadable])], [], []), 1);
    assert.equal(claimsNeedingReview([row("needs-reporting", [readable])], [], []), 1);
  });

  it("does not count a pass a person recorded", () => {
    for (const judgment of JUDGMENTS) {
      if (judgment === "unreviewed" || judgment === "contradicts") continue;
      assert.equal(
        claimNeedsReview(judgment, [readable]),
        false,
        `${judgment} was recorded by a person, so it is not waiting on one`,
      );
    }
  });
});

describe("U24: did an evidence check run", () => {
  it("reads the run's own output as a record, which is what the bar was missing", () => {
    /* The stand-in editorial day's draft: no decision, no reconciliation
       stamp, and seven findings. The bar said "not run"; the run plainly
       happened. */
    const state = evidenceCheckState({
      recorded: false,
      findings: 7,
      claims: 0,
      manualClaims: 0,
      openClaims: 0,
      toReview: 7,
    });
    assert.equal(state.ran, true);
    assert.equal(state.toReview, 7);
  });

  it("still calls a hand-filed draft with nothing against it not-run", () => {
    const state = evidenceCheckState({
      recorded: false,
      findings: 0,
      claims: 0,
      manualClaims: 0,
      openClaims: 0,
      toReview: 0,
    });
    assert.deepEqual(state, { ran: false, toReview: 0, contradicted: 0 });
  });

  it("counts each of the three records on its own", () => {
    const base = { recorded: false, findings: 0, claims: 0, manualClaims: 0, openClaims: 0, toReview: 0 };
    assert.equal(evidenceCheckState({ ...base, recorded: true }).ran, true, "a decision or a stamp");
    assert.equal(evidenceCheckState({ ...base, findings: 1 }).ran, true, "a finding");
    assert.equal(evidenceCheckState({ ...base, claims: 1 }).ran, true, "a recorded claim");
    assert.equal(evidenceCheckState({ ...base, manualClaims: 1 }).ran, true, "a hand-added claim");
    assert.equal(evidenceCheckState({ ...base, openClaims: 1 }).ran, true, "a claim of absence");
  });

  it("separates 'a check ran and left work' from 'a check ran and left none'", () => {
    const quiet = evidenceCheckState({
      recorded: true,
      findings: 3,
      claims: 0,
      manualClaims: 0,
      openClaims: 0,
      toReview: 0,
    });
    assert.deepEqual(quiet, { ran: true, toReview: 0, contradicted: 0 });
  });

  it("says nothing about review work when the review has not been read", () => {
    /* The page falls back to its own record until the pane reports. That
       fallback must not invent a count, and must not claim nothing ran. */
    assert.deepEqual(reviewEvidenceCheckState({ review: null, recorded: true, openClaims: 0 }), {
      ran: true,
      toReview: 0,
      contradicted: 0,
    });
    assert.deepEqual(reviewEvidenceCheckState({ review: null, recorded: false, openClaims: 0 }), {
      ran: false,
      toReview: 0,
      contradicted: 0,
    });
  });

  it("reads the whole state off a resolved review", () => {
    const review = {
      rows: [row("unreviewed", [readable]), row("supports", [readable])],
      claimRows: [claimRow("unreviewed", [unreadable])],
      manualClaimRows: [manualRow("unreviewed", [readable])],
    };
    assert.deepEqual(
      reviewEvidenceCheckState({ review, recorded: false, openClaims: 0 }),
      { ran: true, toReview: 3, contradicted: 0 },
      "the three unchecked rows remain open, including the one with unreadable evidence",
    );
  });

  /*
    M5 of the batch-6 pre-merge audit. `contradicted` is not a second count of
    a different thing: it is the part of `toReview` the record disagrees with,
    so the editor can be told which of the claims in front of them the story is
    wrong about.

    THE MUTATION THAT MATTERS. Counting every needing-review row rather than
    only the `contradicts` ones fails "counts only the rows the record
    contradicts"; dropping the chip check fails "never exceeds the head count".
  */
  it("counts only the rows the record contradicts", () => {
    const review = {
      rows: [row("unreviewed", [readable]), row("contradicts", [readable])],
      claimRows: [claimRow("contradicts", [readable])],
      manualClaimRows: [manualRow("unreviewed", [readable])],
    };
    const state = reviewEvidenceCheckState({ review, recorded: true, openClaims: 0 });
    assert.equal(state.toReview, 4, "all four rows need a person");
    assert.equal(state.contradicted, 2, "two of them the record contradicts");
  });

  it("never exceeds the head count, whatever a caller passes", () => {
    assert.equal(
      evidenceCheckState({
        recorded: true,
        findings: 0,
        claims: 0,
        manualClaims: 0,
        openClaims: 0,
        toReview: 2,
        contradicted: 9,
      }).contradicted,
      2,
      "a contradicted count over a head count is not a number anyone can print",
    );
  });

  it("is a subset of the head count, by the same chip", () => {
    /*
      `judgmentChip` chips EVERY `contradicts` row `! Needs review`, whatever
      captures it holds -- U24b's point is that a recorded contradiction is not
      an answer the desk may print on, so it stays review work even when the
      record has since become unreadable. So every contradicted row is counted
      by both predicates, and the blocker's "(M contradicted by the record)" can
      never be larger than its own head count.
    */
    const rows = [row("contradicts", [readable]), row("contradicts", [unreadable])];
    assert.equal(contradictedClaims(rows, [], []), 2);
    assert.equal(claimsNeedingReview(rows, [], []), 2);
    assert.ok(
      contradictedClaims(rows, [], []) <= claimsNeedingReview(rows, [], []),
      "the contradicted count is a subset, never a second total",
    );
  });
});

describe("U24: an acceptance is for one draft version", () => {
  const draft = {
    id: 4,
    headline: "Council adopts the budget",
    dek: "The 5-2 vote funds the plan.",
    body: "The council adopted the budget.",
    topic: "council",
    source_urls: '["https://records.example/agenda"]',
    provenance_json: "[]",
    found_note: "[]",
    unanswered: "[]",
    research_json: "{}",
  };

  const confirmation = (token: string) => ({ count: 3, token, at: "2026-09-30T12:00:00.000Z", by: "u1" });

  it("covers the draft it was recorded against", () => {
    const token = unreviewedClaimsFingerprint(draft);
    assert.equal(acceptanceCoversDraft(draft, confirmation(token)), true);
  });

  it("does not cover an edit, and does not cover a missing or partial record", () => {
    const token = unreviewedClaimsFingerprint(draft);
    const edited = { ...draft, body: `${draft.body} It was a long debate.` };
    assert.equal(acceptanceCoversDraft(edited, confirmation(token)), false);
    assert.equal(acceptanceCoversDraft(draft, null), false);
    assert.equal(acceptanceCoversDraft(draft, undefined), false);
    assert.equal(acceptanceCoversDraft(draft, confirmation("")), false);
  });

  it("moves when the claims move, so the same acceptance cannot be reused", () => {
    const before = unreviewedClaimsFingerprint(draft);
    const judged = { ...draft, research_json: '{"findingEvidenceReview":{"judgments":{}}}' };
    assert.notEqual(unreviewedClaimsFingerprint(judged), before);
  });

  it("is the same fingerprint the section confirmation uses, for the same draft", async () => {
    /* Both records answer "which draft version?", and they must answer it the
       same way or one press would silently invalidate the other's meaning. */
    const { topicConfirmationFingerprint } = await import("./notes.ts");
    const { evidenceReviewToken } = await import("./draft-evidence.ts");
    assert.equal(
      unreviewedClaimsFingerprint(draft),
      topicConfirmationFingerprint(evidenceReviewToken(draft)),
    );
  });
});
