import { createElement } from "react";
import type { PublishPressState } from "../lib/news/publish-blockers.ts";

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
    return createElement(
      "span",
      { className: "note", role: "status" },
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
    return createElement(
      "span",
      { className: "note publish-done", role: "status" },
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
    );
  }
  return null;
}
