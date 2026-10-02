import { createElement } from "react";
import type { PublishPressState } from "../lib/news/publish-blockers.ts";
import { ActionIcon } from "./action-button.ts";

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
      Unit UI1a, and the FOLD. Scott asked that pressing Publish "CHANGES to
      say 'Published' with, say, a green color". This banner IS that change:
      a print takes the publish bar away (`canPublish` goes false the moment
      the lead is on the paper), so the button's done state and the banner
      occupy the same place at the same moment and there is no way to draw both
      without saying "it printed" twice. Rather than invent a second
      confirmation, the banner is drawn with the shared piece's own done
      icon -- the same check, from `ActionIcon` -- and carries the same
      `data-phase`/`data-token` the button would have, so the two can never
      drift apart and PUB2's rule (the banner is the ONLY confirmation on this
      page) is kept exactly.
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
