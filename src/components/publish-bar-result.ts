import { createElement } from "react";
import type { PublishPressState } from "../lib/news/publish-blockers.ts";
import { ActionButton, ActionIcon } from "./action-button.ts";

/**
 * The publish bar's answer to the press (unit PUB1).
 *
 * The owner pressed "Publish in Elections" and the same button came back with
 * no message at all: the refusal was drawn, if at all, as a Notice in the page
 * body, far from the sticky bar where he had just clicked. He pressed again,
 * and again nothing visibly happened.
 *
 * So the bar says what happened, in the same danger style the other refusals on
 * this page use and in the server's own words -- which already name the next
 * step for every gate the desk keeps ("Review them in the workbench, or accept
 * them explicitly to print anyway"). On success it says so plainly, with the
 * way to read the story on the paper.
 *
 * Written without JSX and driven entirely by `publishPressState`, the same
 * split and the same reason as `check-gates.ts` next to it: the words are
 * testable without a server or a browser, and `node --experimental-strip-types`
 * can read this file.
 */
export function PublishBarResult(props: { state: PublishPressState }) {
  const { state } = props;
  if (state.kind === "publishing") {
    /*
      Unit UI1a: the same spinner the button draws, from the same place. While
      the press is running the bar's sentence and the button's own state are
      one thing to look at, not two.
    */
    return createElement(
      "span",
      { className: "note", role: "status", "aria-busy": true, "data-phase": "working" },
      ActionIcon({ phase: "working" }),
      "Publishing…",
    );
  }
  if (state.kind === "refused") {
    /*
      `role="alert"` rather than `status`: this is the answer to a press the
      editor just made and it is the thing they must act on, so it is announced
      rather than queued behind whatever else the page is saying.
    */
    return createElement(
      "span",
      { className: "note publish-blocked publish-refused", role: "alert" },
      state.message,
    );
  }
  if (state.kind === "published") {
    /*
      Unit UI1a drew this banner as the FOLD, on the rule that a print takes
      the publish bar away (`canPublish` goes false the moment the lead is on
      the paper) so the button's done state and the banner were the same place
      at the same moment and there was no way to draw both without saying "it
      printed" twice.

      UNIT UI1b-2 CHANGES THAT RULE, on the owner's own words. The auditor put
      PR 171 in front of Scott on his real story: after "Yes, print it" the
      Publish button was GONE. What he asked for is the CONTROL changing --
      "click a publish button, it publishes and then CHANGES to say 'Published'
      with, say, a green color" -- so the control wears its own done state AND
      this banner stays. The two agree because they are drawn from the same
      answer (`press`), and both carry `data-phase="done"`/`data-token="ok"`
      and the same check from `ActionIcon`, so neither can drift.

      This banner keeps every word the walks pin: "Published.", "Read it on
      the paper", "See it under Published".
    */
    return createElement(
      "span",
      {
        className: "note publish-done",
        role: "status",
        "data-phase": "done",
        "data-token": "ok",
      },
      ActionIcon({ phase: "done" }),
      "Published.",
      state.slug
        ? " "
        : null,
      state.slug
        ? createElement(
            "a",
            { className: "inline-link", href: `/articles/${state.slug}` },
            "Read it on the paper",
          )
        : null,
      state.slug ? " · " : " ",
      createElement("a", { className: "inline-link", href: "/desk/published" }, "See it under Published"),
    );
  }
  return null;
}

/**
 * The word the settled control wears. No full stop: it is a button's label,
 * not a sentence -- the banner beside it is the sentence.
 */
export const PUBLISHED_LABEL = "Published";

/**
 * ── UI1b-2: THE PRESS CHANGES, AND IT STAYS CHANGED ────────────────────────
 *
 * The bar a story on the paper leaves behind. Two things, in the bar's own
 * place, at the same time, on purpose:
 *
 *   - the Publish button's own DONE state, in the slot the press was made in:
 *     the shared `ActionButton` in phase `done`, so the word is "Published",
 *     the token is the success green and the check is drawn -- all three, from
 *     the one place, asserted separately. It is `disabled` because a done
 *     state has no action, and the stylesheet keeps it at full strength: a
 *     settled control, not a faded dead button.
 *   - the banner (`PublishBarResult`, unit PUB1) with its own sentence and its
 *     two ways on, unchanged.
 *
 * WHY IT IS DRIVEN BY `onPaper` AND NOT BY THE PRESS'S LAST ANSWER. This is
 * the decision the unit asked to be made and said out loud: the green
 * "Published" is a FACT ABOUT THE STORY, so it is drawn whenever the story is
 * on the paper -- after the cache refreshes that follow a print, and on a page
 * opened later on a story that went up days ago, where there was no press at
 * all. The banner is the answer to a press, so it appears only right after
 * one (`justPublished`, through `press`), exactly as PUB1 built it.
 *
 * A refusal never reaches here: `onPaper` is false for it (no slug is written
 * on either refusal path), so a refused press draws the failure and no
 * Published state.
 */
export function PublishBarDone(props: { result: PublishPressState }) {
  return createElement(
    "div",
    { className: "astra-publish-bar astra-publish-done", id: "astra-publish-bar" },
    createElement(
      "div",
      { className: "astra-publish-actions" },
      createElement(ActionButton, {
        /*
          The same level the press was drawn at, so what the editor sees is
          ONE control that changed rather than a different one that replaced
          it. The `done` phase repaints it green whatever the level.
        */
        tone: "primary",
        phase: "done",
        disabled: true,
        doneLabel: PUBLISHED_LABEL,
        className: "astra-publish-published",
        children: PUBLISHED_LABEL,
      }),
      createElement(PublishBarResult, { state: props.result }),
    ),
  );
}
