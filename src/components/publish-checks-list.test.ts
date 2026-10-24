import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeforeYouCanPublish } from "./publish-blockers.ts";
import { PublishConfirmation } from "./publish-confirmation.ts";
import { publishBlockers, type PublishBlockerState } from "../lib/news/publish-blockers.ts";

/**
 * G23-UX-6 (D278): the writer's check list reads as three short lines, not one
 * run-on sentence -- in the Checks panel row and in the Publish dialog.
 *
 * What the editor must meet, in both places:
 *
 *   - the lead sentence, then an `<ol>` with one `<li>` per check;
 *   - in the dialog only, under that list: what pressing anyway actually does;
 *   - the confirm button's words unchanged ("Publish anyway in Council").
 *
 * Rendered with `renderToStaticMarkup`, the same way `publish-confirmation
 * .test.ts` renders the dialog, so the assertions are about the document.
 */

const CHECKS = [
  "Check the 6-1 tally.",
  "The parking figure is read off a slide.",
  "The quote was cut from a longer answer.",
];

const STATE: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  sectionName: "Council",
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
  meetingEditorChecks: CHECKS,
};

function dialogHtml(): string {
  return renderToStaticMarkup(
    createElement(PublishConfirmation, {
      blockers: publishBlockers(STATE),
      sectionName: "Council",
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
}

describe("D278: the Publish dialog draws the checks as a list", () => {
  it("draws the lead and an ol with one li per check", () => {
    const html = dialogHtml();
    assert.match(html, /The meeting writer asks you to check 3 things before publishing:/);
    const list = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/);
    assert.ok(list, "the dialog must draw an ordered list");
    /* Tailwind's base layer kills the marker; the class is what puts the
       numbers back (`list-style: decimal` on `.astra-blocker-items`). */
    assert.match(list![0]!, /<ol class="astra-blocker-items">/);
    const items = list![1]!.match(/<li[^>]*>/g) ?? [];
    assert.equal(items.length, 3, "one row per check");
    for (const check of CHECKS) assert.match(list![1]!, new RegExp(escape(check)));
    assert.doesNotMatch(
      list![1]!,
      /1\. Check the 6-1 tally\./,
      "the number is the list's, not typed into the text",
    );
  });

  it("says what pressing anyway does, right under the list, in body text", () => {
    const html = dialogHtml();
    assert.match(
      html,
      /If you publish anyway, the story prints as written, and the desk records that you published over these checks\./,
    );
    const anywayAt = html.indexOf("If you publish anyway");
    const listAt = html.indexOf("<ol");
    assert.ok(listAt !== -1 && listAt < anywayAt, "the line sits under the list");
  });

  it("keeps the confirm button's words unchanged", () => {
    const html = dialogHtml();
    assert.match(html, /Publish anyway in Council/);
  });

  it("keeps the page's list when the server repeats the same sentence", () => {
    const blockers = publishBlockers(STATE);
    const sentence = blockers.find((row) => row.key === "meeting-editor-checks")!.sentence;
    const html = renderToStaticMarkup(
      createElement(PublishConfirmation, {
        blockers,
        sectionName: "Council",
        refusedWarnings: [{ key: "meeting-editor-checks", sentence }],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const lists = html.match(/<ol[^>]*>/g) ?? [];
    assert.equal(lists.length, 1, "the same fact said twice is one list");
  });
});

describe("D278: the Checks panel row draws the checks as a list", () => {
  it("draws the lead and an ol with three items under the row's words", () => {
    const html = renderToStaticMarkup(
      createElement(BeforeYouCanPublish, { blockers: publishBlockers(STATE), onAct: () => {} }),
    );
    const what = html.match(/<span class="astra-blocker-what">([\s\S]*?)<\/span>/);
    assert.ok(what, "the row draws its words in astra-blocker-what");
    assert.match(what![1]!, /The meeting writer asks you to check 3 things before publishing:/);
    assert.match(what![1]!, /<ol class="astra-blocker-items">/);
    const items = what![1]!.match(/<li[^>]*>/g) ?? [];
    assert.equal(items.length, 3);
    assert.doesNotMatch(what![1]!, /1\. Check the 6-1 tally\./);
  });

  it("still draws one sentence for a warning that is not a list", () => {
    const html = renderToStaticMarkup(
      createElement(BeforeYouCanPublish, {
        blockers: publishBlockers({ ...STATE, meetingEditorChecks: undefined, sectionReady: false }),
        onAct: () => {},
      }),
    );
    assert.match(html, /No section has been chosen for this story\./);
    assert.doesNotMatch(html, /astra-blocker-items/);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
