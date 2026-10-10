import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNCHECKED_STORY_REASON,
  bodyHasCheckableFact,
  evidenceCheckCoversCurrentVersion,
  uncheckedStoryNeedsCheck,
} from "./unchecked-story-gate.ts";
import { editorStoryState, storyReadiness, storyReadinessChip } from "./story-readiness.ts";
import { publishBlockers } from "./publish-blockers.ts";
import { evidenceReviewToken, EVIDENCE_REVIEW_VERSION_KEY } from "./draft-evidence.ts";
import { findingEvidenceContentToken } from "./finding-evidence-review.ts";
import { topicConfirmationFingerprint } from "./notes.ts";
import type { DraftRow } from "./types.ts";

/**
 * UNIT ZC1 -- THE ZERO-RECORDED-CLAIMS TRUST BUG.
 *
 * A story with a real, checkable fact (a dollar figure, a date, a vote) that
 * the evidence check never ran against, because the check produced NO claims,
 * printed with nothing having been checked at all: `performPublish` only ever
 * refused when the count of unreviewed claims was ABOVE zero, so zero claims
 * read as "clear". This pins the detector, the gate and the new readiness
 * state on the pure functions, without a database.
 */

const baseMemo = "{}";

function draft(patch: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 1,
    lead_id: 1,
    headline: "Council adopts the budget",
    dek: "The plan funds the year.",
    body: "The council adopted the budget unanimously.",
    topic: "council",
    source_urls: "[]",
    provenance_json: "[]",
    found_note: "[]",
    unanswered: "[]",
    research_json: baseMemo,
    ...patch,
  } as DraftRow;
}

describe("bodyHasCheckableFact", () => {
  it("sees a digit", () => {
    assert.equal(bodyHasCheckableFact("The council met at 7 p.m."), true);
  });
  it("sees a month or day name", () => {
    assert.equal(bodyHasCheckableFact("The vote came in September."), true);
    assert.equal(bodyHasCheckableFact("She spoke on Tuesday."), true);
  });
  it("sees a percent or a dollar amount", () => {
    assert.equal(bodyHasCheckableFact("Support rose 12 percent."), true);
    assert.equal(bodyHasCheckableFact("The budget is $547.5 million."), true);
  });
  it("sees a bare percent or dollar sign, independent of any digit", () => {
    assert.equal(bodyHasCheckableFact("Voter support grew by a few %."), true);
    assert.equal(bodyHasCheckableFact("It cost a few $ more."), true);
  });
  it("only sees a month or day name as a whole word", () => {
    assert.equal(bodyHasCheckableFact("The marching band played."), false);
    assert.equal(bodyHasCheckableFact("A monetary gift arrived."), false);
    assert.equal(bodyHasCheckableFact("The mayor spoke in March."), true);
  });
  it("sees a vote word", () => {
    for (const word of ["unanimously", "approved", "voted", "adopted", "passed"]) {
      assert.equal(
        bodyHasCheckableFact(`The council ${word} the item.`),
        true,
        `"${word}" is a checkable fact`,
      );
    }
  });
  it("says no for prose with nothing checkable in it", () => {
    assert.equal(bodyHasCheckableFact("The council met and talked for a while."), false);
  });
});

describe("evidenceCheckCoversCurrentVersion", () => {
  it("is true when a stored current-version identity matches this draft", () => {
    const d = draft();
    const material = { aiEvidenceReview: { checkedText: d.body, rows: [] } };
    const research = JSON.stringify({
      ...material,
      evidenceReviewVersion: topicConfirmationFingerprint(evidenceReviewToken({ ...d, research_json: JSON.stringify(material) })),
    });
    assert.equal(evidenceCheckCoversCurrentVersion({ ...d, research_json: research }), true);
  });

  it("is false once the headline changed under a checked body, even when the legacy pair still matches", () => {
    const d = draft();
    const material = { aiEvidenceReview: { checkedText: d.body, rows: [] }, evidenceReconciledAt: "2026-10-10T02:20:39.040Z" };
    const research = JSON.stringify({
      ...material,
      evidenceReviewVersion: topicConfirmationFingerprint(evidenceReviewToken({ ...d, research_json: JSON.stringify(material) })),
    });
    /* A headline-only edit must reopen the zero-claims gate. `checkedText` still
       equals the body and `evidenceReconciledAt` is present, so a stamp that no
       longer matches this version must decide on its own and not fall through to
       the legacy pair. */
    assert.equal(
      evidenceCheckCoversCurrentVersion({ ...d, headline: "Council passes the budget", research_json: research }),
      false,
    );
  });

  it("falls back to the legacy pair only when no stamp exists", () => {
    const d = draft();
    const legacy = JSON.stringify({
      aiEvidenceReview: { checkedText: d.body, rows: [] },
      evidenceReconciledAt: "2026-10-10T02:20:39.040Z",
    });
    assert.equal(evidenceCheckCoversCurrentVersion({ ...d, research_json: legacy }), true);
    /* And a stale legacy pair whose text moved is false. */
    assert.equal(
      evidenceCheckCoversCurrentVersion({
        ...d,
        body: "The council approved the budget after a debate.",
        research_json: legacy,
      }),
      false,
    );
  });

  it("is false for a draft with no evidence check record at all", () => {
    assert.equal(evidenceCheckCoversCurrentVersion(draft()), false);
  });

  it("does not let the completion stamp change the finding-evidence content token", () => {
    /* The stamp is a derived receipt of the SAVED version, not content the editor
       judges. If it moved `findingEvidenceContentToken`, a reconciliation pass
       would throw away every carried human judgment about the same text. */
    const d = draft();
    const withoutStamp = findingEvidenceContentToken({ ...d, research_json: JSON.stringify({ reportedClaims: { version: 1, rows: [] } }) });
    const withStamp = findingEvidenceContentToken({
      ...d,
      research_json: JSON.stringify({
        reportedClaims: { version: 1, rows: [] },
        [EVIDENCE_REVIEW_VERSION_KEY]: "deadbeefdeadbeef",
      }),
    });
    assert.equal(withStamp, withoutStamp, "the completion stamp is excluded from the content token");
  });
});

describe("uncheckedStoryNeedsCheck", () => {
  it("blocks when there are zero recorded claims, no check for this version, and a checkable fact", () => {
    const result = uncheckedStoryNeedsCheck({
      recordedClaims: 0,
      evidenceCheckedCurrentVersion: false,
      body: "The council approved the $547.5 million budget on Tuesday.",
      acknowledgedForVersion: false,
      exempt: false,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, UNCHECKED_STORY_REASON);
  });

  it("does not block a zero-claims body with nothing checkable in it", () => {
    const result = uncheckedStoryNeedsCheck({
      recordedClaims: 0,
      evidenceCheckedCurrentVersion: false,
      body: "The council met and talked for a while about the year ahead.",
      acknowledgedForVersion: false,
      exempt: false,
    });
    assert.equal(result.blocked, false);
  });

  it("leaves a draft with recorded claims to the existing claims gate", () => {
    const result = uncheckedStoryNeedsCheck({
      recordedClaims: 3,
      evidenceCheckedCurrentVersion: false,
      body: "The council approved the $547.5 million budget.",
      acknowledgedForVersion: false,
      exempt: false,
    });
    assert.equal(result.blocked, false);
  });

  it("clears on a completed evidence check for this version, even with zero claims", () => {
    const result = uncheckedStoryNeedsCheck({
      recordedClaims: 0,
      evidenceCheckedCurrentVersion: true,
      body: "The council approved the $547.5 million budget.",
      acknowledgedForVersion: false,
      exempt: false,
    });
    assert.equal(result.blocked, false);
  });

  it("clears on the explicit one-press acknowledgement for this version", () => {
    const result = uncheckedStoryNeedsCheck({
      recordedClaims: 0,
      evidenceCheckedCurrentVersion: false,
      body: "The council approved the $547.5 million budget.",
      acknowledgedForVersion: true,
      exempt: false,
    });
    assert.equal(result.blocked, false);
  });

  it("preserves the imported/pasted and opinion exemptions", () => {
    for (const exempt of [true]) {
      const result = uncheckedStoryNeedsCheck({
        recordedClaims: 0,
        evidenceCheckedCurrentVersion: false,
        body: "The council approved the $547.5 million budget.",
        acknowledgedForVersion: false,
        exempt,
      });
      assert.equal(result.blocked, false);
    }
  });
});

describe("readiness and the blocker for the zero-claims gate", () => {
  const state = {
    headline: "Council adopts the budget",
    dek: "The plan funds the year.",
    body: "The council approved the $547.5 million budget.",
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

  it("adds a warn blocker with the exact sentence and both presses", () => {
    const blockers = publishBlockers({ ...state, uncheckedStory: true });
    const row = blockers.find((b) => b.key === "claims-unchecked");
    assert.ok(row, "the zero-claims gate is a blocker");
    assert.equal(row!.sentence, UNCHECKED_STORY_REASON);
    assert.equal(row!.altAction?.target.kind, "acknowledge-unchecked");
  });

  it("does not add the blocker when the gate is clear", () => {
    const blockers = publishBlockers({ ...state, uncheckedStory: false });
    assert.equal(blockers.find((b) => b.key === "claims-unchecked"), undefined);
  });

  it("maps the zero-claims blocker to the new not-checked readiness state and chip", () => {
    const blockers = publishBlockers({ ...state, uncheckedStory: true });
    const readiness = editorStoryState(blockers, 0);
    assert.equal(readiness.state, "not-checked");
    assert.deepEqual(storyReadinessChip(readiness), { text: "! Not checked yet", tone: "warn" });
  });

  it("keeps the ordinary not-ready chip for other blockers", () => {
    assert.deepEqual(storyReadinessChip({ state: "not-ready", openCount: 1, totalCount: 1, reason: "x" }), {
      text: "✕ Not ready",
      tone: "warn",
    });
  });
});

describe("storyReadiness with no claims", () => {
  it("reads a zero-claim body with a digit as not-checked, not verified", () => {
    const result = storyReadiness({
      headline: "Council adopts the budget",
      body: "The council approved the $547.5 million budget.",
      claims: [],
    });
    assert.equal(result.state, "not-checked");
    assert.equal(result.reason, UNCHECKED_STORY_REASON);
  });

  it("keeps zero claims with nothing checkable as verified", () => {
    const result = storyReadiness({
      headline: "Council meets",
      body: "The council met and talked for a while about the year ahead.",
      claims: [],
    });
    assert.equal(result.state, "verified");
  });

  it("leaves a draft with recorded claims to the ordinary path", () => {
    const result = storyReadiness({
      headline: "Council adopts the budget",
      body: "The council approved the $547.5 million budget.",
      claims: [{ text: "The budget is $547.5 million.", status: "UNVERIFIED" }],
    });
    assert.equal(result.state, "not-ready");
  });

  it("clears on a completed check or the acknowledgement for this version", () => {
    const base = {
      headline: "Council adopts the budget",
      body: "The council approved the $547.5 million budget.",
      claims: [] as { text: string; status: "UNVERIFIED" }[],
    };
    assert.equal(storyReadiness({ ...base, evidenceCheckedCurrentVersion: true }).state, "verified");
    assert.equal(storyReadiness({ ...base, acknowledgedForVersion: true }).state, "verified");
  });
});
