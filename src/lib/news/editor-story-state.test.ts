// guards: a loading or blocked story could show Ready while Publish and Checks disagree.
import assert from "node:assert/strict";
import { it } from "node:test";
import { acceptedClaimsPublishState, editorStoryState, storyReadinessChip } from "./story-readiness.ts";
import { readinessDot } from "./writer-bar.ts";
import { publishBlockers } from "./publish-blockers.ts";

it("uses the same reason for loading, human exceptions and publish readiness", () => {
  const facts = { headline: "Plan", dek: "A plan", body: "The plan was submitted.", sectionReady: true,
    openClaims: 0, namedOutlets: [], unreviewedClaims: 0, unreviewedAccepted: false,
    evidenceStale: false, reviewingEvidence: false, reconcileActive: false, publishing: false };
  const loading = publishBlockers({ ...facts, evidenceLoading: true });
  const state = editorStoryState(loading, 0);
  assert.equal(state.state, "checking");
  assert.equal(readinessDot(true, state).reason, loading[0].sentence);
  const blocked = publishBlockers({ ...facts, unreviewedClaims: 2 });
  const waiting = editorStoryState(blocked, 2);
  assert.equal(waiting.state, "not-ready");
  assert.equal(waiting.reason, blocked[0].sentence);
  const ready = editorStoryState(publishBlockers(facts), 0);
  assert.equal(storyReadinessChip(ready).tone, "ok");
  assert.equal(ready.state, "ready");
});

const unreviewed = { key: "claims-unreviewed", sentence: "9 claims need review." };
it("AI-judged acceptance unlocks Publish and names the unconfirmed count", () => {
  const result = acceptedClaimsPublishState({ blockers: [unreviewed], openCount: 9, acceptedCount: 9, hasAiJudgments: true });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.publishEnabled, true);
  assert.equal(result.readiness.reason, "You accepted 9 claims the AI could not confirm.");
  assert.equal(storyReadinessChip(result.readiness).text, "✓ Ready");
});
for (const [name, acceptedCount, openCount] of [["stale after an edit", 0, 9], ["count grew", 3, 4], ["no acceptance", 0, 9]] as const) {
  it(`${name} keeps the Publish blocker`, () => {
    const result = acceptedClaimsPublishState({ blockers: [unreviewed], openCount, acceptedCount, hasAiJudgments: true });
    assert.deepEqual(result.blockers, [unreviewed]);
    assert.equal(result.publishEnabled, false);
    assert.equal(result.readiness.reason, unreviewed.sentence);
  });
}
it("acceptance keeps other publish gates", () => {
  const other = { key: "dek", sentence: "Write a dek." };
  const result = acceptedClaimsPublishState({ blockers: [unreviewed, other], openCount: 9, acceptedCount: 9, hasAiJudgments: false });
  assert.deepEqual(result.blockers, [other]);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.readiness.reason, other.sentence);
});
/*
  ── A WARNING REPORTS NOT-READY BUT STILL PUBLISHES (unit OH) ────────────────
  The decision this unit is built on: the story may READ "not-ready" -- the
  readiness verdict is honest -- while the button is ON, because a warning is a
  judgement the editor overrules. `publishEnabled` derives the ABSENCE of a hard
  kind, so exactly one warning leaves it true even as `readiness.state` is
  "not-ready". A hard kind is false. And a hand-built blocker with NO `kind` is
  treated as hard, so every pre-OH caller's `publishEnabled` is unchanged.
*/
it("a warning reports not-ready yet leaves Publish enabled", () => {
  const warning = {
    key: "readiness",
    kind: "warning",
    sentence: "This story is not ready to publish.",
  };
  const result = acceptedClaimsPublishState({
    blockers: [warning],
    openCount: 0,
    acceptedCount: 0,
    hasAiJudgments: true,
  });
  assert.deepEqual(result.blockers, [warning], "the warning is still listed");
  assert.equal(result.publishEnabled, true, "a warning never disables the button");
  assert.equal(result.readiness.state, "not-ready", "and the readiness verdict is still honest");
});
it("a hard reason leaves Publish off", () => {
  const hard = { key: "headline", kind: "hard", sentence: "The headline is empty." };
  const result = acceptedClaimsPublishState({
    blockers: [hard],
    openCount: 0,
    acceptedCount: 0,
    hasAiJudgments: false,
  });
  assert.equal(result.publishEnabled, false);
});
it("a caller whose blockers carry no kind keeps its Publish gate (compatibility)", () => {
  const legacy = { key: "dek", sentence: "Write a dek." };
  const result = acceptedClaimsPublishState({
    blockers: [legacy],
    openCount: 0,
    acceptedCount: 0,
    hasAiJudgments: false,
  });
  assert.equal(result.publishEnabled, false, "an unknown reason is hard, never a silent unlock");
});
it("the story state helper carries the acceptance reason", () => {
  assert.equal(editorStoryState([], 9, 9).reason, "You accepted 9 claims the AI could not confirm.");
});

it("the reason names the recorded accepted count when fewer claims remain outstanding", () => {
  const result = acceptedClaimsPublishState({ blockers: [unreviewed], openCount: 7, acceptedCount: 9, hasAiJudgments: true });
  assert.equal(result.publishEnabled, true);
  assert.equal(result.readiness.reason, "You accepted 9 claims the AI could not confirm.");
});
