import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evidenceReviewDisabled, takeDownPressDisabled } from "./finding-evidence-locks.ts";

/**
 * Unit U25, B1 — the takedown press on a story that is already on paper.
 *
 * WHAT THIS IS FOR. On `/desk/story/16` (published), Checks → "Record checks and
 * judgment" → "View exact captured version" renders "Take down this capture" and
 * the press was `disabled` on all ten claims, with no tooltip. On a draft the
 * same press worked. The story page passed `onPaper` into the panel's single
 * `disabled` prop, and that prop is what the press read.
 *
 * The two conditions were mutually exclusive: only published stories have
 * captures with public pages at `/evidence/:versionId`, and published stories
 * were the ones where the press was dead -- so no editor could produce a public
 * removal notice at all, which is the one thing the feature exists for.
 *
 * THE MUTATION THAT MATTERS. Adding `onPaper` to `takeDownPressDisabled`'s
 * return fails the first case; removing it from `evidenceReviewDisabled` fails
 * the last one, and would unlock judgments on a story that has no draft for
 * them to bind to.
 */

const PAPER = { locked: false, onPaper: true, waiting: false, busy: false };
const IDLE_DRAFT = { locked: false, onPaper: false, waiting: false, busy: false };

describe("the evidence panel's two lock rules", () => {
  it("offers the takedown on a published story, for the owner", () => {
    assert.equal(
      takeDownPressDisabled(PAPER),
      false,
      "the press is dead on the only stories whose captures have public pages",
    );
  });

  it("still locks judgments on a published story", () => {
    assert.equal(evidenceReviewDisabled(PAPER), true);
  });

  it("locks both on a killed story and while the page is busy", () => {
    for (const held of [
      { ...IDLE_DRAFT, locked: true },
      { ...IDLE_DRAFT, waiting: true },
      { ...IDLE_DRAFT, busy: true },
    ]) {
      assert.equal(evidenceReviewDisabled(held), true);
      assert.equal(takeDownPressDisabled(held), true);
    }
  });

  it("leaves a draft's panel open", () => {
    assert.equal(evidenceReviewDisabled(IDLE_DRAFT), false);
    assert.equal(takeDownPressDisabled(IDLE_DRAFT), false);
  });
});
