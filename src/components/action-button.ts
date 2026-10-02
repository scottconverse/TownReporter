import { createElement, Fragment, type ReactNode } from "react";
import type { PublishPressState } from "../lib/news/publish-blockers.ts";

/**
 * ONE button, four states, at the control (unit UI1a).
 *
 * Scott pressed "Publish anyway - I accept these claims are unreviewed" on the
 * live paper and said it "DOES NOT look like something you can click", that
 * there are "a ton of these text strings with no identifying features that
 * it's an action", and asked for controls that "provide feedback once used
 * (click a publish button, it publishes and then CHANGES to say 'Published'
 * with, say, a green color)".
 *
 * The desk already had the press half of this -- `useDeskAction`
 * (desk-action.ts) is one press in four phases with a lock, a turned error and
 * the real reason. What it never had was the DRAWING half: no shared place
 * that turns a phase into a colour, a word and an icon, so every control grew
 * its own (or none at all). This is that place, and only that place: the
 * tokens and the icons live here, once.
 *
 * The rules it implements, all of them measurable:
 *
 *   - phase `working` -- the button is disabled, carries a spinner and says
 *     what it is doing ("Publishing…"). `aria-busy` is set, so a screen reader
 *     is told the same thing the eye is.
 *   - phase `done` -- the word changes AND the colour token changes AND an
 *     icon appears. Never colour alone: a green word with no icon is invisible
 *     to anyone who cannot see the green, and a check with no word is a
 *     symbol the editor has to guess at. The three are asserted separately.
 *   - phase `failed` -- the reason the server gave is printed BESIDE the
 *     control in the danger colour (`role="alert"`, so it is announced), and
 *     the button itself is back to idle and pressable.
 *   - `disabled` -- the reason is printed beside it too. A greyed button with
 *     no sentence next to it is a dead end: the editor cannot tell whether it
 *     is broken, still loading, or refusing on purpose.
 *
 * Written with `createElement` and no JSX, the same split and the same reason
 * as `publish-bar-result.ts` next to it: the words, the tokens and the phases
 * are testable without a browser or a server, and
 * `node --experimental-strip-types` can read this file.
 */

/** Where a press is between being pressed and answering. */
export type ActionPhase = "idle" | "working" | "done" | "failed";

/**
 * The three design-system levels (design-system/README.md §6). `quiet` is NOT
 * one of them: it is the desk's own low-emphasis class for minor or
 * navigational presses, and it is allowed here only because unit UI1a put its
 * edge back over 3:1 -- see the `.btn.quiet` note in desk-astra.css.
 */
export type ActionTone = "primary" | "secondary" | "quiet" | "danger" | "quiet-danger";

/**
 * The class each level is drawn with. One place, so no call site guesses.
 *
 * `quiet` was added by unit UI1a2. It is not a design-system level, but it is
 * where the desk's most-pressed scoped controls live -- Check now, Pause,
 * Preview as reader, Kill this lead, the row Deletes -- and the whole point of
 * this unit is that those get the four states too. Leaving them on the
 * hand-rolled `<button>` would have kept eight copies of the phase logic
 * alive; giving `ActionButton` the tone lets them move onto the one piece
 * without changing how quiet they look. Its edge is `--fg2` (see `.btn.quiet`
 * in desk-astra.css), which is the UI1a fix that made quiet visible at all.
 */
export const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  primary: "btn solid",
  secondary: "btn",
  quiet: "btn quiet",
  danger: "btn danger",
  /*
    `quiet-danger` is `InkButton`'s own level for Kill -- a real action heading
    toward removal that is not a confirm step. The class string is unchanged
    from what the desk already drew, so the Kill controls keep the exact
    `.btn.quiet.danger` edge the stylesheets give them.
  */
  "quiet-danger": "btn quiet danger",
};

/**
 * The colour TOKEN each phase paints with, as a bare token name.
 *
 * It is written onto the button as `data-token` and read by one rule per token
 * in desk-astra.css, so a test can assert the token changed without asserting
 * a computed colour, and a theme swap needs no second list. `idle` has no
 * token of its own: it wears its level's, which is the whole point of an idle
 * button looking like the level it was drawn as.
 */
export function actionToken(phase: ActionPhase, tone: ActionTone): string {
  if (phase === "done") return "ok";
  if (phase === "working") return "fg2";
  if (phase === "failed") return "danger";
  if (tone === "primary") return "a";
  if (tone === "danger" || tone === "quiet-danger") return "danger";
  return "fg";
}

/**
 * The phase of a row action whose outcome is the ROW's own new state.
 *
 * Unit UI1a2. `Hold`, `Pause`, `Kill` and `Delete` do not have a "done" that
 * belongs to the button: what they change is what the row IS, and the desk
 * already draws that -- a paused source reads "Paused" and offers "Resume", a
 * held lead reads "On hold", a deleted row leaves and the list's own notice
 * says so. Rule 3's "done changes the word, the colour and the icon" is
 * satisfied by that new state, so the button itself never wears a green
 * "Paused" that would sit next to a row still saying "Active" (the two would
 * contradict each other for the length of one refetch, which is exactly the
 * flicker FB6 opened this family of units about).
 *
 * So this helper deliberately has no `done` branch: `working`, `failed` and
 * `idle` are the button's, and the row carries the rest.
 */
export function rowActionPhase(input: {
  isPending: boolean;
  problem?: string | null;
}): ActionPhase {
  if (input.problem) return "failed";
  if (input.isPending) return "working";
  return "idle";
}

/**
 * The publish bar's own answer, as a button phase.
 *
 * `publishPressState` (lib/news/publish-blockers.ts) still decides WHAT is
 * true -- this only says how the control is drawn, so the gate logic and the
 * banner semantics from PUB1/PUB2 are untouched.
 */
export function pressPhase(kind: PublishPressState["kind"]): ActionPhase {
  if (kind === "publishing") return "working";
  if (kind === "published") return "done";
  if (kind === "refused") return "failed";
  return "idle";
}

/**
 * The two icons, inline SVG, `aria-hidden` and inert: the WORD carries the
 * meaning and the glyph only makes it findable at a glance. A screen reader
 * announcing "check mark" beside "Published" is the same answer twice.
 */
export function ActionIcon(props: { phase: ActionPhase }) {
  if (props.phase === "working") {
    return createElement(
      "svg",
      {
        className: "action-icon action-icon-spin",
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        "aria-hidden": true,
        focusable: false,
      },
      createElement("circle", {
        cx: 8,
        cy: 8,
        r: 6.5,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeDasharray: "28 13",
        strokeLinecap: "round",
      }),
    );
  }
  if (props.phase === "done") {
    return createElement(
      "svg",
      {
        className: "action-icon action-icon-check",
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        "aria-hidden": true,
        focusable: false,
      },
      createElement("path", {
        d: "M3 8.6l3.2 3.2L13 5",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }),
    );
  }
  return null;
}

export type ActionButtonProps = {
  phase: ActionPhase;
  /** The idle word. Unchanged from what the desk already said. */
  children: ReactNode;
  /** The word while the press runs. Falls back to the idle word. */
  workingLabel?: ReactNode;
  /** The word once it is done. Falls back to the idle word. */
  doneLabel?: ReactNode;
  /** The reason a `failed` press gives, printed beside the control. */
  reason?: string | null;
  tone?: ActionTone;
  disabled?: boolean;
  /** Why the control is off, printed beside it. Rule 4. */
  disabledReason?: string | null;
  onAct?: () => void;
  type?: "button" | "submit";
  small?: boolean;
  /** Extra classes for the call site (the walks ask for several by name). */
  className?: string;
  /** An explicit accessible name, when the drawn word is not the right one. */
  ariaLabel?: string;
};

/**
 * Draw the press. Presentational only -- the caller owns the phase, exactly as
 * `BeforeYouCanPublish` owns nothing but draws the blockers it is handed.
 */
export function ActionButton(props: ActionButtonProps) {
  const phase = props.phase;
  /*
    A FAILED press draws its button back at idle: rule 3 says the button
    "returns to idle" and the reason is what carries the failure. The phase is
    still on the button as `data-phase="failed"`, so the state is not lost, it
    is just not the button's clothes.
  */
  const drawn: ActionPhase = phase === "failed" ? "idle" : phase;
  const tone: ActionTone = props.tone ?? "secondary";
  const busy = drawn === "working";
  const label =
    drawn === "working"
      ? (props.workingLabel ?? props.children)
      : drawn === "done"
        ? (props.doneLabel ?? props.children)
        : props.children;

  const button = createElement(
    "button",
    {
      type: props.type ?? "button",
      onClick: props.onAct,
      disabled: props.disabled || busy ? true : undefined,
      "aria-busy": busy ? true : undefined,
      "aria-label": props.ariaLabel,
      "data-phase": phase,
      "data-token": actionToken(drawn, tone),
      className:
        "action-btn " +
        ACTION_TONE_CLASS[tone] +
        (props.small ? " small" : "") +
        (props.className ? " " + props.className : ""),
    },
    ActionIcon({ phase: drawn }),
    createElement("span", { className: "action-label" }, label),
  );

  /*
    One reason line, whichever reason there is: the failure the server gave, or
    the gate that is holding the control off. It is a SIBLING of the button and
    never inside it -- several walks read a control's `innerText` and compare
    it against the bar's sentence, and a reason folded into the button would
    silently rewrite the name they ask for.
  */
  const note =
    phase === "failed" && props.reason
      ? createElement("span", { className: "action-reason", role: "alert" }, props.reason)
      : props.disabled && props.disabledReason
        ? createElement("span", { className: "action-reason" }, props.disabledReason)
        : null;

  if (!note) return button;
  return createElement(Fragment, null, button, note);
}

/**
 * The same press around a React Query mutation that only reports `isPending`.
 *
 * Eight hand-rolled `isPending ? "X…" : "X"` expressions were the thing this
 * unit was opened about; this is the one line that replaces them, so a press
 * that fails can carry the mutation's own reason without the call site
 * learning a second vocabulary.
 */
export function mutationPhase(input: {
  isPending: boolean;
  done?: boolean;
  problem?: string | null;
}): ActionPhase {
  if (input.problem) return "failed";
  if (input.done) return "done";
  if (input.isPending) return "working";
  return "idle";
}
