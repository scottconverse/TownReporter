import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeforeYouCanPublish } from "./publish-blockers.ts";
import { publishBlockers, type PublishBlockerState } from "../lib/news/publish-blockers.ts";
import { claimsNeedingReview } from "../lib/news/evidence-check-state.ts";

/**
 * What the editor actually sees at the top of the Checks tab (unit CT).
 *
 * The unit test next to the pure function proves the reasons are complete.
 * This one proves they are printed -- a row per reason, with the sentence and
 * a real button, or the one sentence that says there is nothing to do.
 */

const CLEAN: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  /* Unit U24: the evidence check left nothing for a person to judge. */
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

function render(patch: Partial<PublishBlockerState>) {
  const blockers = publishBlockers({ ...CLEAN, ...patch });
  return renderToStaticMarkup(
    createElement(BeforeYouCanPublish, { blockers, onAct: () => {} }),
  );
}

describe("BeforeYouCanPublish", () => {
  it("says nothing is blocking Publish when nothing is", () => {
    const html = render({});
    assert.match(html, /id="publish-blockers"/, "the block is the anchor the banner and the bar link to");
    assert.match(html, /Before you can publish/);
    assert.match(html, /Nothing is blocking Publish\./);
    assert.doesNotMatch(html, /astra-blocker-act/, "an all-clear needs no button");
  });

  // guards: open facts could be present while the editor is told nothing blocks Publish.
  it("removes the all-clear when an unchecked claim is open", () => {
    const openCount = claimsNeedingReview([{
      judgment: { value: "unreviewed" }, captures: [],
    }] as never, [], []);
    const html = render({ unreviewedClaims: openCount });
    assert.doesNotMatch(html, /Nothing is blocking Publish\./);
    assert.match(html, /1 warning before Publish/);
    assert.doesNotMatch(html, /1 thing blocks Publish/);
    assert.match(html, /Review the claim/);
  });

  it("prints one row per reason, with the sentence and its press", () => {
    const html = render({
      sectionReady: false,
      namedOutlets: ["Longmont Leader"],
      openClaims: 1,
    });
    const rows = html.match(/class="astra-blocker[ "]/g) ?? [];
    assert.equal(rows.length, 3, "the owner's story has three reasons, so it gets three rows");
    assert.match(html, /3 warnings before Publish\. You can resolve them here or choose Publish anyway\./,
    );

    assert.match(html, /No section has been chosen for this story\./);
    assert.match(html, />Pick a section</);
    assert.match(html, /The body names Longmont Leader and this draft&#x27;s Sources do not show it\./);
    assert.match(html, />Override Longmont Leader</);
    assert.match(html, />Add a source</);
    assert.match(html, /A claim of absence has not been confirmed\./);
    assert.match(html, />Confirm the claim</);
  });

  it("gives the empty dek a plain-words warning, not a claim the desk refuses it", () => {
    const html = render({ dek: "" });
    assert.match(html, /The dek is empty\./);
    assert.doesNotMatch(html, /refuse/i,
      "a warning must not claim a refusal the desk no longer makes",
    );
    assert.match(html, />Write a dek</);
  });

  it("keeps the chip on every row, so a reason reads as a state and not as prose", () => {
    const html = render({ evidenceStale: true, reconcileActive: true, publishing: true });
    const chips = html.match(/class="astra-blocker-chip"/g) ?? [];
    assert.equal(chips.length, 3, "one status chip per row");
    assert.match(html, /I checked: keep this evidence/);
    assert.match(html, /See the running check/);
    assert.match(html, /See the publish bar/);
  });

  it("says Warning on a judgement call and Blocks Publish on a hard stop", () => {
    const html = render({ sectionReady: false, headline: "" });
    assert.match(html, /data-kind="warning"/);
    assert.match(html, /data-kind="hard"/);
    assert.match(html, />Warning</);
    assert.match(html, />Blocks Publish</);
  });

  it("hands the press back to the page instead of acting itself", () => {
    const pressed: string[] = [];
    const blockers = publishBlockers({ ...CLEAN, namedOutlets: ["Longmont Leader"] });
    const html = renderToStaticMarkup(
      createElement(BeforeYouCanPublish, {
        blockers,
        onAct: (target) => pressed.push(target.kind),
      }),
    );
    assert.match(html, /Override Longmont Leader/);
    assert.equal(pressed.length, 0, "rendering must not press anything");
  });
});
