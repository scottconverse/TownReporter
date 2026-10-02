import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publishBlockers,
  publishGateNote,
  publishPressState,
  type PublishBlockerState,
} from "./publish-blockers.ts";

/**
 * UNIT PUB1, the pure half. What the publish bar says about the press.
 *
 * The owner pressed "Publish in Elections", the desk refused, and the bar came
 * back showing the same button with nothing said -- the refusal was a Notice in
 * the page body, far from where he clicked. This file pins the decision the bar
 * makes, so the three states cannot be drawn at once and the precedence between
 * them is not an accident.
 */

const CLEAN: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

describe("publishPressState", () => {
  it("says nothing at all before the first press", () => {
    assert.deepEqual(
      publishPressState({ publishing: false, refusal: "", publishedSlug: null }),
      { kind: "idle" },
    );
  });

  it("says 'publishing' while the press is in flight, whatever else is held", () => {
    assert.deepEqual(
      publishPressState({ publishing: true, refusal: "", publishedSlug: null }),
      { kind: "publishing" },
    );
    assert.deepEqual(
      publishPressState({ publishing: true, refusal: "an older refusal", publishedSlug: "a-slug" }),
      { kind: "publishing" },
      "a press in flight is newer than anything a previous press said",
    );
  });

  it("carries the server's own words for a refusal", () => {
    const message =
      "5 claims from the evidence check have not been reviewed. Review them in the workbench, or accept them explicitly to print anyway.";
    assert.deepEqual(
      publishPressState({ publishing: false, refusal: message, publishedSlug: null }),
      { kind: "refused", message },
    );
  });

  it("calls the story that just printed 'published', with its slug", () => {
    assert.deepEqual(
      publishPressState({ publishing: false, refusal: "", publishedSlug: "council-adopts-budget" }),
      { kind: "published", slug: "council-adopts-budget" },
    );
  });

  it("prefers the refusal when both are somehow set, so nothing claims a print that did not happen", () => {
    assert.deepEqual(
      publishPressState({ publishing: false, refusal: "It was refused.", publishedSlug: "a-slug" }),
      { kind: "refused", message: "It was refused." },
    );
  });

  it("treats blank refusal text as no refusal, not as a refusal of nothing", () => {
    assert.deepEqual(
      publishPressState({ publishing: false, refusal: "   ", publishedSlug: null }),
      { kind: "idle" },
    );
  });

  it("CANNOT DRAW 'Nothing blocks Publish' OVER A REFUSAL (the owner's story)", () => {
    /*
      The bar's all-clear line is drawn from the blocker list, and the blocker
      list is drawn from the lead query. On the owner's story the page held an
      acceptance recorded for the previous draft version, so no blocker was
      listed and the bar said "Nothing blocks Publish" -- and the server then
      refused. The refusal path invalidates the lead query (pinned in the
      component test next door); what this pins is that once the server's answer
      is in, the acceptance no longer covering this draft puts the blocker back,
      so the all-clear cannot be drawn again.
    */
    const before = publishBlockers({ ...CLEAN, unreviewedClaims: 5, unreviewedAccepted: true });
    assert.equal(publishGateNote(before), "", "the accepted page has nothing to point at");

    const after = publishBlockers({ ...CLEAN, unreviewedClaims: 5, unreviewedAccepted: false });
    assert.equal(after.length, 1);
    assert.match(after[0]!.sentence, /5 claims need review/);
    assert.notEqual(
      publishGateNote(after),
      "",
      "the refreshed page says what to press instead of 'Nothing blocks Publish'",
    );
  });
});
