import assert from "node:assert/strict";
import test from "node:test";
import { routineEditionFingerprint, routineEditionUpdateKind } from "./routine-notice-editions.ts";

/*
  Decision 11: already-published stories are not rewritten for a change of
  layout. These are the three cases a run can meet for a channel that already
  has a story today.
*/
const bodyHash = "a".repeat(64);
const fingerprint = routineEditionFingerprint(bodyHash);

test("an old-layout receipt with the same events moves to v2 with no correction", () => {
  assert.equal(
    routineEditionUpdateKind({
      existingFingerprint: "b".repeat(64),
      existingKeys: ["k1", "k2"],
      fingerprint,
      bodyHash,
      keysAfterRun: ["k2", "k1"],
    }),
    "layout-only",
  );
});

test("an old-layout receipt with a new or removed event is corrected as always", () => {
  const base = { existingFingerprint: "b".repeat(64), existingKeys: ["k1"], fingerprint, bodyHash };
  assert.equal(routineEditionUpdateKind({ ...base, keysAfterRun: ["k1", "k2"] }), "correction");
  assert.equal(routineEditionUpdateKind({ ...base, keysAfterRun: [] }), "correction");
});

test("a v2 receipt with a changed body is corrected, with the same events or not", () => {
  const base = { existingFingerprint: routineEditionFingerprint("c".repeat(64)), existingKeys: ["k1"], fingerprint, bodyHash };
  assert.equal(routineEditionUpdateKind({ ...base, keysAfterRun: ["k1"] }), "correction");
  assert.equal(routineEditionUpdateKind({ ...base, keysAfterRun: ["k1", "k2"] }), "correction");
});

test("the same text already printed is left alone, in either receipt style", () => {
  const base = { existingKeys: ["k1"], fingerprint, bodyHash, keysAfterRun: ["k1"] };
  assert.equal(routineEditionUpdateKind({ ...base, existingFingerprint: fingerprint }), "unchanged");
  assert.equal(routineEditionUpdateKind({ ...base, existingFingerprint: bodyHash }), "unchanged");
});
