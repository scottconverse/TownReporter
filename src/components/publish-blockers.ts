import { createElement, Fragment, type ReactNode } from "react";
import type { PublishBlocker, PublishBlockerTarget } from "../lib/news/publish-blockers.ts";
import { publishBlockedSummary } from "../lib/news/publish-blockers.ts";
import { ActionButton, type ActionPhase } from "./action-button.ts";

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
  /**
   * Unit UI1a. Which row's press is running, by target kind, and which one last
   * failed with what reason. The page owns the mutations, so it owns these
   * facts; this component only turns them into the phase each press is drawn
   * in. Optional, and absent means every row sits at idle -- which is what a
   * pure render should be.
   */
  busyTarget?: PublishBlockerTarget["kind"] | null;
  doneTarget?: PublishBlockerTarget["kind"] | null;
  failedTarget?: PublishBlockerTarget["kind"] | null;
  /** The reason a failed press gave, printed beside the row that failed. */
  failureReason?: string | null;
}) {
  const { blockers, onAct } = props;
  const count = blockers.length;

  /* One derivation, used by both presses on a row, so an alt press cannot be
     left behind a main press that has moved on. */
  const phaseFor = (kind: PublishBlockerTarget["kind"]): ActionPhase => {
    if (props.failedTarget === kind) return "failed";
    if (props.doneTarget === kind) return "done";
    if (props.busyTarget === kind) return "working";
    return "idle";
  };

  const row = (blocker: PublishBlocker) =>
    createElement(
      "li",
      { className: "astra-blocker" + (blocker.kind === "warning" ? " is-warning" : " is-hard"), key: blocker.key, "data-blocker": blocker.key,
        "data-kind": blocker.kind,
      },
      /*
        Unit OH: the chip says which kind of reason this is. A warning is a
        judgement the editor may overrule ("Warning"), a hard reason is the desk
        itself refusing ("Blocks Publish"). The word changes with the kind, so a
        row is never read as a wall when it is a question.
      */
      createElement("span", { className: "astra-blocker-chip" },
        blocker.kind === "warning" ? "Warning" : "Blocks Publish",
      ),
      createElement("span", { className: "astra-blocker-what" }, blocker.sentence),
      createElement(
        "span",
        { className: "astra-blocker-acts" },
        /*
          Unit UI1a. This row's second press -- "Publish anyway - I accept these
          claims are unreviewed" -- is the control Scott pressed on the live
          paper and could not tell was a button: it was drawn `.btn quiet`,
          whose 1px `--line` edge is 1.4:1 against the panel behind it. It is
          the design system's SECONDARY level now (a real 2px ink edge), and
          both presses on the row go through the shared `ActionButton`, so a
          press that is running says so at the control ("Accepting…", disabled,
          with a spinner), a press that finished draws "Accepted" with a check
          in the success green, and a press that failed prints the server's
          reason in red right beside it.
        */
        createElement(ActionButton, {
          tone: "secondary",
          className: "astra-blocker-act",
          phase: phaseFor(blocker.action.target.kind),
          reason: props.failureReason ?? null,
          onAct: () => onAct(blocker.action.target),
          workingLabel: "Opening…",
          children: blocker.action.label,
        }),
        blocker.altAction
          ? createElement(ActionButton, {
              tone: "secondary",
              className: "astra-blocker-act",
              phase: phaseFor(blocker.altAction.target.kind),
              reason: props.failureReason ?? null,
              onAct: () => onAct(blocker.altAction!.target),
              workingLabel: "Accepting…",
              doneLabel: "Accepted",
              children: blocker.altAction.label,
            })
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
        `${publishBlockedSummary(blockers)}. ${blockers.some((blocker) => blocker.kind === "hard") ? "Each row has the press that clears it." : "You can resolve them here or choose Publish anyway."}`,
      ),
      createElement(
        "ul",
        {
          className: "astra-blocker-list",
          key: "list",
          "aria-label": "Publish checks and warnings",
        },
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
