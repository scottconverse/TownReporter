import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeforeYouCanPublish } from "./publish-blockers.ts";
import { PublishConfirmation } from "./publish-confirmation.ts";
import { publishBlockers, publishConfirmation, type PublishBlockerState } from "../lib/news/publish-blockers.ts";

/**
 * DHI-8: Publish on a story with unreviewed claims showed TWO override buttons
 * that read differently for the one act -- "Publish anyway in <Section>" and
 * "Publish anyway — I accept these claims are unreviewed". Both buttons must be
 * KEPT; they must read the same sentence, section and accepted-claims part
 * included. This renders both surfaces and compares the two labels.
 */

const STATE: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  sectionName: "Infrastructure",
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 3,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

/** Every button label the blocker block draws (the label lives in a span). */
function blockButtons(html: string): string[] {
  return [...html.matchAll(/<span class="action-label">([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);
}

describe("DHI-8: the two override buttons for one act read the same", () => {
  it("the block's accept button and the confirm button carry identical words", () => {
    const blockers = publishBlockers(STATE);
    const block = renderToStaticMarkup(createElement(BeforeYouCanPublish, { blockers, onAct: () => {} }));
    const confirm = renderToStaticMarkup(
      createElement(PublishConfirmation, {
        blockers,
        sectionName: "Infrastructure",
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    const acceptButton = blockButtons(block).find((label) => label.startsWith("Publish anyway"));
    const confirmButton = blockButtons(confirm).find((label) => label.startsWith("Publish anyway"));
    assert.ok(acceptButton, "the block still offers its Publish anyway button");
    assert.ok(confirmButton, "the confirm still offers its Publish anyway button");
    assert.match(acceptButton, /Infrastructure/, "the block button names the section");
    assert.match(acceptButton, /I accept these claims/, "the block button names the accepted claims");
    assert.equal(acceptButton, confirmButton, "one act, one sentence, on both buttons");
  });

  it("a piece with no section names no section, on either button", () => {
    const blockers = publishBlockers({ ...STATE, sectionReady: false, sectionName: undefined });
    const decision = publishConfirmation(blockers, "");
    const acceptButton = blockButtons(renderToStaticMarkup(createElement(BeforeYouCanPublish, { blockers, onAct: () => {} })))
      .find((label) => label.startsWith("Publish anyway"));
    assert.ok(acceptButton);
    assert.doesNotMatch(acceptButton, /\bin\b/, "no section to name");
    assert.equal(acceptButton, decision.confirmLabel);
  });
});
