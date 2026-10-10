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
it("the story state helper carries the acceptance reason", () => {
  assert.equal(editorStoryState([], 9, 9).reason, "You accepted 9 claims the AI could not confirm.");
});

it("the reason names the recorded accepted count when fewer claims remain outstanding", () => {
  const result = acceptedClaimsPublishState({ blockers: [unreviewed], openCount: 7, acceptedCount: 9, hasAiJudgments: true });
  assert.equal(result.publishEnabled, true);
  assert.equal(result.readiness.reason, "You accepted 9 claims the AI could not confirm.");
});
