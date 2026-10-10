// guards: a loading or blocked story could show Ready while Publish and Checks disagree.
import assert from "node:assert/strict";
import { it } from "node:test";
import { editorStoryState, storyReadinessChip } from "./story-readiness.ts";
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
