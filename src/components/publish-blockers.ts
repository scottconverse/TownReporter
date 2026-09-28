import { createElement, Fragment, type ReactNode } from "react";
import type { PublishBlocker, PublishBlockerTarget } from "../lib/news/publish-blockers.ts";
import { publishBlockedSummary } from "../lib/news/publish-blockers.ts";

/**
 * "Before you can publish" -- every reason Publish is off, each with its press
 * (unit CT, 0.6.81).
 *
 * The drawing (`docs/design/handoff-2026-09-26/design/Desk Story.dc.html`)
 * opens the Checks tab on an "Evidence check" list: a status chip and a short
 * sentence on the first line, the detail under it, and the action buttons in
 * a row under that, with a 44px minimum so the row is a target and not a
 * line of text. This is that row, for the blockers rather than for the check
 * results -- the same shape the owner could not find tonight, in the one
 * place the Checks tab opens on.
 *
 * Presentational only. The press is `onAct`, and the page turns a target into
 * a focus, a scroll, or the mutation that was already there -- so every row
 * here is the same code path as the control it points at, not a second
 * implementation of it.
 */
export function BeforeYouCanPublish(props: {
  blockers: readonly PublishBlocker[];
  /** Runs the row's press. The page owns every target; nothing here acts. */
  onAct: (target: PublishBlockerTarget) => void;
}) {
  const { blockers, onAct } = props;
  const count = blockers.length;

  const row = (blocker: PublishBlocker) =>
    createElement(
      "li",
      { className: "astra-blocker", key: blocker.key, "data-blocker": blocker.key },
      createElement("span", { className: "astra-blocker-chip" }, "Blocks Publish"),
      createElement("span", { className: "astra-blocker-what" }, blocker.sentence),
      createElement(
        "span",
        { className: "astra-blocker-acts" },
        createElement(
          "button",
          {
            type: "button",
            className: "btn astra-blocker-act",
            onClick: () => onAct(blocker.action.target),
          },
          blocker.action.label,
        ),
        blocker.altAction
          ? createElement(
              "button",
              {
                type: "button",
                className: "btn quiet astra-blocker-act",
                onClick: () => onAct(blocker.altAction!.target),
              },
              blocker.altAction.label,
            )
          : null,
      ),
    );

  const body: ReactNode[] = [createElement("h2", { key: "h" }, "Before you can publish")];

  if (count === 0) {
    /*
      The editor came here to find out whether anything is wrong. "Nothing is
      blocking Publish" is an answer, and it is the one the button already
      gives -- said in words rather than left to a button that happens to be
      enabled.
    */
    body.push(
      createElement(
        "p",
        { className: "astra-blocker-clear", key: "clear" },
        createElement("span", { className: "astra-blocker-chip is-ok" }, "Clear"),
        createElement("span", null, "Nothing is blocking Publish."),
      ),
    );
  } else {
    body.push(
      createElement(
        "p",
        { className: "meta", key: "count" },
        `${publishBlockedSummary(blockers)}. Each row has the press that clears it.`,
      ),
      createElement(
        "ul",
        { className: "astra-blocker-list", key: "list", "aria-label": "Reasons Publish is off" },
        ...blockers.map(row),
      ),
    );
  }

  return createElement(
    Fragment,
    null,
    createElement("div", { className: "astra-blockers", id: "publish-blockers" }, ...body),
  );
}
