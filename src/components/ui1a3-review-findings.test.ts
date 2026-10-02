import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const ROOT = new URL("../../", import.meta.url);

function source(relative: string): string {
  return readFileSync(new URL(relative, ROOT), "utf8");
}

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

  it("the page derives all three rows through that one function", () => {
    const page = source("src/routes/desk.story.$leadId.tsx");
    assert.match(
      page,
      /const blockerPress = blockerPressState\(\{/,
      "the page went back to deriving the blocker presses by hand",
    );
    /* The bug's shape: a phase read from `isError` alone. */
    assert.doesNotMatch(
      page,
      /failedTarget: acceptUnreviewed\.isError/,
      "the failed phase is derived from `isError` alone again -- a refusal resolves, so it never fires",
    );
  });
});

/* ------------------------------------------------------------------ 2 --- */

describe("finding 2: the per-row delete confirmation stays armed until the press settles", () => {
  const leads = source("src/components/desk-leads.tsx");

  /** The "Yes, delete" confirm button's own source block. */
  function confirmBlock(): string {
    const start = leads.indexOf('label: "Yes, delete"');
    assert.notEqual(start, -1, "the Queue row's confirm button is gone");
    const end = leads.indexOf("</ActionButton>", start);
    return leads.slice(start, end);
  }

  it("the confirm press runs the delete without clearing `confirming`", () => {
    const block = confirmBlock();
    assert.match(block, /onAct=\{\(\) => onDelete\(\)\}/, "the press no longer runs onDelete directly");
    assert.doesNotMatch(
      block,
      /setConfirming\(false\)/,
      "the confirmation is cleared on the press again -- 'Deleting.' and the reason are then never drawn",
    );
  });

  it("it still consumes deletePending and deleteReason, so 'Deleting.' and the reason are drawn", () => {
    const block = confirmBlock();
    assert.match(block, /rowActionPhase\(\{ isPending: deletePending, problem: deleteReason \}\)/);
    assert.match(block, /workingLabel="Deleting…"/);
    assert.match(block, /reason=\{deleteReason\}/);
  });

  it("the Queue still feeds it the row's own pending flag and reason", () => {
    const queue = source("src/routes/desk.queue.tsx");
    assert.match(queue, /deletePending=\{remove\.isPending && remove\.variables === l\.id\}/);
    assert.match(queue, /deleteReason=\{/);
  });
});

/* ------------------------------------------------------------------ 3 --- */

describe("finding 3: pressing Stop watching leaves Pause/Resume idle", () => {
  const panel = source("src/components/page-watch-panel.tsx");

  /** The Pause/Resume ActionButton's own source block. */
  function pauseBlock(): string {
    const start = panel.indexOf('workingLabel={row.watch_state === "active" ? "Pausing…" : "Resuming…"}');
    assert.notEqual(start, -1, "the page-watch Pause/Resume button is gone");
    const begin = panel.lastIndexOf("<ActionButton", start);
    return panel.slice(begin, start);
  }

  it("the working phase is scoped to pause and resume, not to the shared mutation", () => {
    const block = pauseBlock();
    assert.match(
      block,
      /isPending: state\.isPending && state\.variables\?\.state !== "stopped"/,
      "the pending phase is unfiltered again -- the row says 'Pausing.' and 'Stopping.' at once",
    );
    assert.doesNotMatch(
      block,
      /isPending: state\.isPending,/,
      "the pending phase reads the shared mutation alone",
    );
  });

  it("the failure branch stayed scoped the same way, and both halves read the settled refusal", () => {
    const block = pauseBlock();
    assert.match(block, /state\.variables\?\.state !== "stopped"/);
    assert.match(block, /stateRefusal/, "a settled `{ ok: false }` from setPageWatchState is not read");
  });

  it("Stop watching is scoped to its own state and reads the same refusal", () => {
    const start = panel.indexOf('workingLabel="Stopping…"');
    const begin = panel.lastIndexOf("<ActionButton", start);
    const block = panel.slice(begin, start);
    assert.match(block, /isPending: state\.isPending && state\.variables\?\.state === "stopped"/);
    assert.match(block, /stateRefusal/);
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

  for (const dialog of [
    { name: "Kill", file: "src/components/dialogs/KillDialog.tsx", word: "Killing…", setter: 'setBusy(withReason ? "primary" : "alt")' },
    { name: "Hold", file: "src/components/dialogs/editor-dialogs.tsx", word: "Holding…", setter: 'setPressed(withReason ? "primary" : "alt")' },
  ]) {
    it(`the ${dialog.name} dialog tracks WHICH press, not just that one is out`, () => {
      const text = source(dialog.file);
      assert.match(
        text,
        new RegExp(`\\.\\.\\.dialogPressProps\\([^,]+,\\s*"${dialog.word}"\\)`),
        `${dialog.file} hands the foot one pending word for both buttons again`,
      );
      assert.ok(
        text.includes(dialog.setter),
        `${dialog.file} no longer records which of its two destructive presses was fired`,
      );
      /* The bug's shape: one boolean, both labels. */
      assert.doesNotMatch(
        text,
        new RegExp(`primaryPendingLabel="${dialog.word}"`),
        `${dialog.file} pins the same word on the primary button unconditionally`,
      );
      assert.doesNotMatch(
        text,
        new RegExp(`altPendingLabel="${dialog.word}"`),
        `${dialog.file} pins the same word on the alt button unconditionally`,
      );
    });
  }

  it("the shared Dialog foot only spins a button that was handed a word", () => {
    const dialog = source("src/components/dialog.tsx");
    assert.match(dialog, /pending=\{pending && altPendingLabel != null\}/);
    assert.match(dialog, /pending=\{pending && primaryPendingLabel != null\}/);
  });
});

/* ------------------------------------------------------------------ 5 --- */

describe("the redraft working word: the walks accept both", () => {
  const scripts = readdirSync(new URL("scripts/", ROOT)).filter((f) => f.endsWith(".mjs"));

  it("no walk pins the button's name as exactly 'Drafting…' any more", () => {
    const offenders: string[] = [];
    for (const file of scripts) {
      const text = source(`scripts/${file}`);
      /* The two shapes that broke: an exact-name string pin, and a regex that
         does not allow the "Re" prefix. Both were true only while the story
         had no draft body. */
      if (/name:\s*"Drafting…"/.test(text)) {
        offenders.push(`${file}: still asks for the button by the exact name "Drafting…"`);
      }
      if (/\/\^Drafting…\$\//.test(text)) {
        offenders.push(`${file}: still matches /^Drafting…$/ without the (Re)? alternative`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("the three walks that press the redraft control accept either word", () => {
    for (const file of ["delete-corrections-e2e.mjs", "failover-e2e.mjs", "live-pipeline-proof.mjs"]) {
      assert.match(
        source(`scripts/${file}`),
        /\/\^\(Re\)\?drafting…\$\/i/,
        `${file} no longer accepts both "Drafting…" and "Redrafting…"`,
      );
    }
  });

  it("the page still draws the more accurate word the walk was updated for", () => {
    const page = source("src/routes/desk.story.$leadId.tsx");
    assert.match(page, /data\.draft\?\.body\s*\?\s*"Redrafting…"\s*:\s*"Drafting…"/);
    assert.match(page, /doneLabel=\{data\.draft\?\.body \? "Redraft started" : "Draft started"\}/);
  });
});
