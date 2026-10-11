import { createElement, Fragment, type ReactNode } from "react";
import type { PublishBlocker } from "../lib/news/publish-blockers.ts";
import { publishConfirmation } from "../lib/news/publish-blockers.ts";
import { ActionButton, type ActionPhase } from "./action-button.ts";

/**
 * ── THE CONFIRM PRESS FOR A STORY THE DESK ONLY WARNED ABOUT (unit OH) ────────
 *
 * The publish button used to be off whenever the blocker list was non-empty. On
 * the owner's own story that was a wall: a named outlet without a source, an
 * AI readiness verdict and an unreviewed claim all turned the button grey, and
 * every one of them is a judgement an editor is paid to make. So the button is
 * now on whenever no HARD reason stands in the way, and pressing it opens this
 * -- the same confirm dialog the desk already had, with every warning sentence
 * printed above the confirm press, so nobody accepts a warning they were never
 * shown.
 *
 * WHAT IS DRAWN, AND WHY EACH IS HERE:
 *
 *   - every warning's sentence, in the bar's own words, ABOVE the confirm
 *     button (including the contradicted-claims sentence, which is the one the
 *     old dialog could not be relied on to say);
 *   - a lead that is held or killed says what the ONE press does -- un-hold /
 *     restore and publish in the same press -- rather than sending the editor
 *     away to find a second control;
 *   - the confirm button's own label comes from `publishConfirmation`, so a
 *     dialog with warnings reads "Publish anyway in <section>" and a dialog
 *     without any is the desk's unchanged "Yes, print it in <section>".
 *
 * Presentational only. The press is `onConfirm`; the page owns the mutation,
 * and the page owns the acknowledgement snapshot -- this component only draws
 * the warnings it is handed, so a warning that arrives after the dialog was
 * opened is not silently accepted. Written with `createElement` and no JSX, the
 * same split as `publish-blockers.ts` and `action-button.ts` next to it, so
 * `node --experimental-strip-types` can read it.
 */
export function PublishConfirmation(props: {
  /** Every reason Publish is off, each with its warning/hard kind. */
  blockers: readonly PublishBlocker[];
  /** The section the press files under, named on the confirm button. */
  sectionName: string;
  /** Preserve each publishing surface's existing consequence notice. */
  consequenceText?: string;
  /**
   * The warnings the server returned on a refused press (unit OH, stale tab).
   * Every one of them is drawn here, so an editor whose tab was stale sees all
   * of the desk's current warnings before pressing again. Absent means the page
   * holds none.
   */
  refusedWarnings?: readonly { key: string; sentence: string }[];
  /** The press. The page turns it into the publish mutation. */
  onConfirm: () => void;
  /** "Not yet" -- closes the dialog and changes nothing. */
  onCancel: () => void;
  /** The press is in flight. */
  publishing?: boolean;
}) {
  /*
    ── THE MERGED LIST THE DECISION IS MADE FROM (unit OH) ───────────────────
    The page's own blockers plus any the SERVER returned on a refused press. The
    merge is by key, and a server warning WINS for its own key: the server's
    count and readiness are the current facts, so a stale tab must not keep
    saying "7 claims need review" after the desk has answered "9". The merged
    list is what `publishConfirmation` sees, so a clean client with one new
    server warning gets the warning LABEL and stays enabled -- the label is not
    computed from the client's list alone.
  */
  const byKey = new Map<string, PublishBlocker>();
  for (const blocker of props.blockers) byKey.set(blocker.key, blocker);
  for (const warning of props.refusedWarnings ?? []) {
    byKey.set(warning.key, {
      key: warning.key,
      kind: "warning",
      sentence: warning.sentence,
      action: { label: "Review", target: { kind: "evidence-review" } },
    });
  }
  const merged = [...byKey.values()];
  const decision = publishConfirmation(merged, props.sectionName);

  /* The warnings to draw, in merged order, with each key drawing exactly once
     (the server's sentence where it spoke last). */
  const sentences = decision.warnings.map((warning) => warning.sentence);

  const phase: ActionPhase = props.publishing ? "working" : "idle";

  const confirm = createElement(ActionButton, {
    tone: "primary",
    phase,
    disabled: props.publishing || !decision.enabled,
    workingLabel: "Publishing…",
    onAct: props.onConfirm,
    children: props.publishing ? "Publishing…" : decision.confirmLabel,
  });

  /*
    The desk's own unchanged words, kept verbatim so a story with no warnings
    reads exactly as it read before this unit.
  */
  const deskNote = createElement(
    "span",
    { className: "note" },
    props.consequenceText ??
      "This puts the story on the public paper and in the feed, under your name, now. Corrections are published, not silent edits.",
  );

  const body: ReactNode[] = [
    createElement("div", { className: "astra-publish-confirm" }, deskNote),
  ];

  if (sentences.length > 0) {
    body.push(
      createElement(
        "ul",
        {
          className: "astra-publish-warnings",
          key: "warnings",
          "aria-label": "Warnings you are publishing over",
        },
        ...sentences.map((sentence, index) =>
          createElement("li", { className: "astra-publish-warning", key: `w-${index}` }, sentence),
        ),
      ),
    );
  }

  body.push(
    createElement(
      Fragment,
      { key: "acts" },
      confirm,
      createElement(ActionButton, {
        tone: "secondary",
        phase: "idle",
        onAct: props.onCancel,
        children: "Not yet",
      }),
    ),
  );

  return createElement(Fragment, null, ...body);
}
