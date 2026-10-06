import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_ADVANCE_MIN,
  IMPACT_HOLD_MIN,
  IMPACT_TOTAL_MAX,
  IMPACT_TOTAL_MIN,
  describeImpact,
  impactDecision,
  impactLine,
  impactTotal,
  isRanked,
  parseImpactScore,
  type ImpactScore,
} from "./meeting-impact.ts";

/*
  The scoring primitive, on its own. These are the rules the lead selection in
  meeting-whole.ts builds on, so they are proved here first, where there is no
  pipeline and no model to blame: a real score is four integers 1-5 with a reason
  each, a total that agrees with them, and a decision off civic-scanner's
  thresholds. A missing or malformed score is UNRANKED -- never a zero.
*/

function score(over: Partial<ImpactScore> = {}): ImpactScore {
  return {
    immediacy: 4,
    impact: 5,
    conflict: 3,
    novelty: 4,
    immediacyReason: "voted tonight",
    impactReason: "quiets homes near the airport",
    conflictReason: "one dissent",
    noveltyReason: "new rules",
    total: 16,
    ...over,
  };
}

describe("meeting-impact", () => {
  it("parses a full score and keeps every reason", () => {
    const parsed = parseImpactScore({
      immediacy: 4,
      immediacy_reason: "voted tonight",
      impact: 5,
      impact_reason: "quiets homes near the airport",
      conflict: 3,
      conflict_reason: "one dissent",
      novelty: 4,
      novelty_reason: "new rules",
    });
    assert.ok(parsed, "a complete reply parses");
    assert.equal(parsed!.total, 16, "the four dimensions sum to the total");
    assert.equal(parsed!.immediacy, 4);
    assert.equal(parsed!.impactReason, "quiets homes near the airport");
    assert.equal(parsed!.noveltyReason, "new rules");
    assert.equal(impactTotal(parsed), 16);
    assert.equal(isRanked(parsed), true);
  });

  it("accepts the camelCase reason spellings the JSON prompt uses", () => {
    const parsed = parseImpactScore({
      immediacy: 2,
      immediacyReason: "a report only",
      impact: 4,
      impactReason: "raises the water rate",
      conflict: 1,
      conflictReason: "unanimous",
      novelty: 3,
      noveltyReason: "a new schedule",
    });
    assert.equal(parsed!.immediacyReason, "a report only");
    assert.equal(parsed!.total, 10);
    assert.equal(impactDecision(impactTotal(parsed)!), "ADVANCE");
  });

  it("leaves an item unranked when a dimension is missing or invalid, and invents no zero", () => {
    // A missing dimension is the model's silence, not a judgement that the item
    // scores 1. The item stays unranked rather than being read as scored low.
    for (const broken of [
      { impact: 5, conflict: 3, novelty: 4 }, // no immediacy
      { immediacy: 0, impact: 5, conflict: 3, novelty: 4 }, // zero is not a 1-5 score
      { immediacy: 4, impact: 7, conflict: 3, novelty: 4 }, // above the scale
      { immediacy: 4, impact: 3.5, conflict: 3, novelty: 4 }, // not an integer
      { immediacy: "high", impact: 3, conflict: 3, novelty: 4 }, // not a number
      "not json at all",
      null,
    ]) {
      assert.equal(parseImpactScore(broken), null, `${JSON.stringify(broken)} is not a score`);
    }
    assert.equal(isRanked(null), false, "no score is unranked");
    assert.equal(impactTotal(null), null, "and has no total to compare");
    // A parse of a missing score never becomes a four-zero object.
    const parsed = parseImpactScore({ impact: 5, conflict: 3, novelty: 4 });
    assert.equal(parsed, null, "a partial score yields nothing, not a zero-filled one");
  });

  it("applies civic-scanner's thresholds to the total", () => {
    assert.equal(IMPACT_TOTAL_MIN, 4);
    assert.equal(IMPACT_TOTAL_MAX, 20);
    assert.equal(impactDecision(IMPACT_ADVANCE_MIN), "ADVANCE");
    assert.equal(impactDecision(20), "ADVANCE");
    assert.equal(impactDecision(IMPACT_HOLD_MIN), "HOLD");
    assert.equal(impactDecision(9), "HOLD");
    assert.equal(impactDecision(6), "DEMOTE");
    assert.equal(impactDecision(IMPACT_TOTAL_MIN), "DEMOTE");
  });

  it("describes a score with each dimension and its reason, and says so when there is none", () => {
    const line = describeImpact("Airport noise rules", score());
    assert.match(line, /^Airport noise rules: 16\/20 ADVANCE/);
    assert.match(line, /immediacy 4 \(voted tonight\)/, "every dimension keeps its reason");
    assert.match(line, /impact 5 \(quiets homes near the airport\)/);
    const unscored = describeImpact("Routine item", null);
    assert.match(unscored, /not scored/, "an unscored item says so");
    assert.doesNotMatch(unscored, /0\/20/, "and is never shown as a zero");
    assert.equal(impactLine(null), "", "an unscored item adds nothing to the digest");
    assert.match(impactLine(score()), /score 16\/20 .*immediacy 4, impact 5, conflict 3, novelty 4/);
  });
});
