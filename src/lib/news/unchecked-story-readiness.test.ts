import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editorStoryState, storyReadinessChip } from "./story-readiness.ts";
import { publishBlockers } from "./publish-blockers.ts";
import { reviewEvidenceCheckState } from "./evidence-check-state.ts";

/**
 * UNIT ZC0 -- THE ZERO-RECORDED-CLAIMS TRUST BUG.
 *
 * THE BUG. The evidence gate refused only when the unreviewed-claim count was
 * ABOVE zero. A review that produced no claims (`rows: []`) therefore read as
 * "nothing outstanding" and the story printed, no matter what facts its body
 * carried and whether a single check had ever run against them. The desk's
 * blocker list was empty and the readiness read `ready`.
 */

const ZERO_CLAIM_STATE = {
  headline: "Council adopts the budget",
  dek: "The plan funds the year.",
  body: "The council approved the $547.5 million budget on Tuesday.",
  sectionReady: true,
  openClaims: 0,
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  namedOutlets: [] as string[],
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

describe("ZC0: the zero-claims readiness the desk reaches", () => {
  it("treats a zero-claim, unchecked, checkable story as its own gate", () => {
    /* An evidence review resolved with NO rows: a draft nothing has ever been
       run against, with a dollar figure and a date in its body. */
    const state = reviewEvidenceCheckState({
      review: { rows: [], claimRows: [], manualClaimRows: [] },
      recorded: false,
      openClaims: 0,
      includeCouldNotCheck: true,
    });
    assert.equal(state.ran, false, "fixture: no evidence check ran");

    /* The gate is one boolean the page already has, derived on the page and the
       server from the same rule; the blocker list must read it. */
    const withGate = publishBlockers({ ...ZERO_CLAIM_STATE, uncheckedStory: true });
    const row = withGate.find((b) => b.key === "unchecked");
    assert.equal(row?.kind, "warning");
    assert.ok(row, "a checkable story nobody has checked must be a blocker");
    assert.equal(row!.altAction?.target.kind, "acknowledge-unchecked");

    const readiness = editorStoryState(withGate, 0);
    assert.equal(
      readiness.state,
      "not-checked",
      "a checkable story nobody has checked must read as not-checked, not ready",
    );
    assert.deepEqual(storyReadinessChip(readiness), { text: "! Not checked yet", tone: "warn" });
  });

  it("adds no blocker when the gate is clear", () => {
    const withoutGate = publishBlockers({ ...ZERO_CLAIM_STATE, uncheckedStory: false });
    assert.equal(
      withoutGate.find((b) => b.key === "unchecked"),
      undefined,
      "a draft the gate does not apply to is untouched",
    );
  });
});
