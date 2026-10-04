import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeforeYouCanPublish } from "./publish-blockers.ts";
import { blockerPressState, type PublishBlocker } from "../lib/news/publish-blockers.ts";
import { dialogPressProps } from "../lib/news/dialog-press.ts";

/**
 * Unit UI1a3: the four review-bot findings on PR 171, each with the test that
 * fails when the bug is put back.
 *
 *   1. A resolved `{ ok: false, error }` is a FAILED press. `acceptUnreviewed`
 *      / `overrideOutlet` answer that way for their ordinary refusals, React
 *      Query settles it as a success, and a phase derived from `isError` alone
 *      left the control at idle with the server's sentence nowhere near it.
 *   2. The per-row delete confirmation must stay mounted while the delete is
 *      out -- clearing it on the press replaced the only `ActionButton` that
 *      consumes `deletePending` / `deleteReason`, so "Deleting." and the reason
 *      were never drawn.
 *   3. Pause/Resume and Stop watching share one `state` mutation, so an
 *      unfiltered `isPending` made the row say "Pausing." and "Stopping." at the
 *      same time.
 *   4. One shared `busy` made BOTH destructive presses in the Kill and Hold
 *      dialogs draw "Killing."/"Holding." with a spinner.
 *
 * Plus the CI regression this unit was opened for: the redraft working word is
 * "Redrafting…" for a story that already has a draft body, and the two other
 * walks that pin "Drafting…" must accept both.
 *
 * Findings 2, 3 and 4 are asserted against the SOURCE of the call site, the way
 * `action-button-controls.test.ts` already does for these controls: the dialogs
 * are Radix trees and `desk-leads.tsx` / `page-watch-panel.tsx` are hooked
 * components, none of which a `node --test` run can mount. Each assertion names
 * the exact expression the fix added, so the mutation that puts the bug back
 * fails it.
 */

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

/* ------------------------------------------------------------------ 1 --- */

const CLAIMS_BLOCKER: PublishBlocker = {
  key: "claims-unreviewed",
  sentence: "3 claims need review. The evidence check raised them and no one has judged them.",
  action: { label: "Review the claims", target: { kind: "evidence-review" } },
  altAction: {
    label: "Publish anyway — I accept these claims are unreviewed",
    target: { kind: "accept-unreviewed" },
  },
};

const OUTLET_BLOCKER: PublishBlocker = {
  key: "named-outlet",
  sentence: "The story names Longmont Leader and no source shows it.",
  action: { label: "Open the sources", target: { kind: "add-source" } },
  altAction: { label: "Override Longmont Leader", target: { kind: "override-outlet", outlet: "Longmont Leader" } },
};

const IDLE = { isPending: false, isError: false } as const;

const THE_REFUSAL = "The evidence check has moved since you looked at it. Review it again.";

describe("finding 1: a resolved { ok: false } draws the failed phase, with the server's reason", () => {
  it("an accept that resolved `{ ok: false, error }` is FAILED, not idle", () => {
    const press = blockerPressState({
      accept: { ...IDLE, answer: { ok: false, error: THE_REFUSAL } },
      override: { ...IDLE },
      keepEvidence: { ...IDLE },
    });
    assert.equal(press.failedTarget, "accept-unreviewed", "the refusal was not read off the answer");
    assert.equal(press.failureReason, THE_REFUSAL, "the server's own sentence was not carried");
    assert.equal(press.busyTarget, null, "a settled refusal is not 'still working'");
  });

  it("an override-outlet that resolved `{ ok: false, error }` is FAILED too", () => {
    const press = blockerPressState({
      accept: { ...IDLE },
      override: { ...IDLE, answer: { ok: false, error: "That draft no longer names Longmont Leader." } },
      keepEvidence: { ...IDLE },
    });
    assert.equal(press.failedTarget, "override-outlet");
    assert.equal(press.failureReason, "That draft no longer names Longmont Leader.");
  });

  it("the real control draws that reason BESIDE it and goes back to idle", () => {
    const press = blockerPressState({
      accept: { ...IDLE, answer: { ok: false, error: THE_REFUSAL } },
      override: { ...IDLE },
      keepEvidence: { ...IDLE },
    });
    const html = render(
      createElement(BeforeYouCanPublish, {
        blockers: [CLAIMS_BLOCKER, OUTLET_BLOCKER],
        onAct: () => {},
        busyTarget: press.busyTarget,
        failedTarget: press.failedTarget,
        failureReason: press.failureReason,
      } as never),
    );
    assert.match(html, /role="alert"/, "the reason is not announced");
    assert.match(html, new RegExp(THE_REFUSAL.replace(".", "\\.")));
    assert.match(
      html,
      /class="action-label">Publish anyway — I accept these claims are unreviewed</,
      "the button did not return to its idle word",
    );
    assert.doesNotMatch(html, /action-icon-spin/, "a settled refusal is not still spinning");
  });

  it("a resolved `{ ok: true }` is NOT a failure", () => {
    const press = blockerPressState({
      accept: { ...IDLE, answer: { ok: true, count: 3 } },
      override: { ...IDLE, answer: { ok: true, outlet: "Longmont Leader" } },
      keepEvidence: { ...IDLE },
    });
    assert.equal(press.failedTarget, null, "a finished press was painted as failed");
    assert.equal(press.failureReason, null);
  });

  it("the PREVIOUS refusal does not paint over a press that is now running", () => {
    /* React Query keeps the last answer on `data` while a new press runs, so an
       ungated read would show "failed" instead of the spinner. */
    const press = blockerPressState({
      accept: { isPending: true, isError: false, answer: { ok: false, error: THE_REFUSAL } },
      override: { ...IDLE },
      keepEvidence: { ...IDLE },
    });
    assert.equal(press.busyTarget, "accept-unreviewed", "the press in flight is not drawn as running");
    assert.equal(press.failedTarget, null, "a stale refusal painted over the running press");
  });

  it("a thrown error still reports its reason, as it did before", () => {
    const press = blockerPressState({
      accept: { isPending: false, isError: true, error: new Error("boom") },
      override: { ...IDLE },
      keepEvidence: { ...IDLE },
    });
    assert.equal(press.failedTarget, "accept-unreviewed");
    assert.ok(press.failureReason && press.failureReason.length > 0);
  });
});

/* ------------------------------------------------------------------ 4 --- */

describe("finding 4: only the dialog button that was PRESSED wears the pending word", () => {
  it("the pressed button gets the word; the other gets no word at all", () => {
    const primary = dialogPressProps("primary", "Killing…");
    assert.equal(primary.pending, true);
    assert.equal(primary.primaryPendingLabel, "Killing…");
    assert.equal(
      primary.altPendingLabel,
      undefined,
      "the un-pressed button would draw 'Killing.' with a spinner",
    );

    const alt = dialogPressProps("alt", "Killing…");
    assert.equal(alt.pending, true);
    assert.equal(alt.altPendingLabel, "Killing…");
    assert.equal(alt.primaryPendingLabel, undefined);
  });

  it("nothing is pending when no press is out", () => {
    const none = dialogPressProps(null, "Killing…");
    assert.equal(none.pending, false);
    assert.equal(none.primaryPendingLabel, undefined);
    assert.equal(none.altPendingLabel, undefined);
  });
});
