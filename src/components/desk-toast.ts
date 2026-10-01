/**
 * The desk's visible toast — the reason no press on this desk is a silent one.
 *
 * Owner, 2026-09-30: "I need much better feedback on all actions everywhere… a
 * line going back and forth is just lazy." The desk already had an answer for
 * every press: `announceToDesk` (`desk-chrome-utils.ts`) writes the sentence
 * into `#desk-announcer`, an sr-only `role=status` region in the desk shell
 * (`desk-chrome.tsx`). Screen-reader-correct, and invisible to everyone else —
 * which is what `docs/design/handoff-2026-09-26/README.md` §Toasts asks for and
 * what was never built ("Use `sonner`: a yellow bar with `#111` text … Keep
 * `announceToDesk` for screen readers").
 *
 * This module is that bar. It is deliberately small and free of React state so
 * that both halves of the shared action family can call it — the press hook
 * (`desk-action.ts`) and every existing `announceToDesk` caller, which gained
 * the visible half without being rewritten.
 *
 * Three things it must not do:
 *
 *  - **Say anything twice.** Sonner's own container is a polite live region
 *    (`aria-live="polite"`, `aria-relevant="additions text"`), so a toast IS the
 *    announcement. `announceToDesk` therefore speaks through the toast when a
 *    toast host is mounted and falls back to `#desk-announcer` only when one is
 *    not — never both. `deskToastHostMounted()` is how it knows.
 *  - **Paint a failure like a success.** The yellow bar is the desk's own
 *    accent (`--a`, "the next step", design-system §3), so it is the shape of a
 *    *finished* press. A failure is `--danger` text on a dashed `--danger`
 *    border, exactly the `!`-marked shape `.notice-err` already uses
 *    (styles.css), because design-system §12 forbids showing "could not check"
 *    in a way that resembles "no change".
 *  - **Invent a fifth accent.** Yellow fill with `#111` text is the whole
 *    palette: text on yellow is `#111` in both themes, and danger/warn are
 *    borders and text only, never page backgrounds (design-system §3).
 *
 * The card's own look lives in `desk-astra.css` under `.desk-toaster`, because
 * the host is inside `.desk-ltr.astra` and has to follow the desk's night
 * palette and its Text: Large scale (`--ts`) like every other desk surface.
 */
import { createElement, type MouseEvent } from "react";
import { toast } from "sonner";
import { editorActionError, looksLikeValidationDump } from "../lib/news/desk-copy.ts";

/** How a finished press reads. `ok` is the spec's yellow bar; `err` a failure. */
export type DeskTone = "ok" | "err" | "warn";

/** A way back from a reversible press, drawn on the toast that reports it. */
export type DeskUndo = {
  /** The button's word — usually "Undo", sometimes the inverse press. */
  label: string;
  run: () => void | Promise<void>;
};

export type DeskToastOptions = {
  tone?: DeskTone;
  /** An Undo for a reversible action, or null when there is nothing to take back. */
  undo?: DeskUndo | null;
  /** Override the tone's default life. Milliseconds. */
  duration?: number;
  /**
   * Coalesce with the toast already carrying this id.
   *
   * M7 of the batch-6 pre-merge audit. Pressing a bulk control twice used to
   * leave two summaries stacked, the second describing the same leads as the
   * first, and three presses left three. Sonner replaces a toast that is handed
   * an id it already knows, so a caller reporting the progress of one action
   * passes the same id every time and the editor sees one line that updates.
   * A caller reporting a *new* action leaves this out and stacks as before.
   */
  id?: string | number;
};

/*
  Long enough to read a sentence, short enough to be gone before the next one.
  A failure gets longer because it carries the reason, and the reason is the
  part the editor has to act on -- a four-second error message is the same
  silence this unit exists to remove.
*/
export const DESK_TOAST_OK_MS = 5_000;
export const DESK_TOAST_ERR_MS = 12_000;

/** The attribute `DeskToaster` puts on the host it mounts. */
export const DESK_TOAST_HOST_ATTR = "data-desk-toaster";

/**
 * How far the toast stack is held off the bottom of the screen, in px.
 *
 * M6 of the batch-6 pre-merge audit. Two bars live at the bottom of a desk
 * screen -- the story workbench's publish bar (`position: sticky; bottom: 0`,
 * `desk-astra.css`, holding the gates between a draft and the paper) and the
 * unsaved-changes bar (`fixed bottom-0`, `unsaved-changes-guard.tsx`) -- and a
 * toast that covers either is a toast covering a control. This is the clear
 * height: both bars are a 44px button in ~14px of padding either side, so
 * anything at or above 88px clears the taller of them, and `desk-astra.css`
 * carries the same number as `--desk-toast-lift` for the phone override. A test
 * in `desk-toaster.test.ts` holds the two together.
 */
export const DESK_TOAST_LIFT = 96;

/*
  The stack's geometry, as values rather than as markup.

  M6 again: `desk-toaster.tsx` draws them, and they live here so a test can hold
  them to their rules -- the position, the lift and the nav-aware left offset
  are the three things M6 is about, and all three are data. `offset.left` is
  `--desk-nav-w` plus a gutter rather than a number because the sidebar is
  230px, 206px under 1200px and 0px on a phone, where the nav is off-canvas.
*/
export const DESK_TOASTER_POSITION = "bottom-left" as const;
/**
 * On a phone the stack is anchored to the TOP, not the bottom.
 *
 * M6: a phone's keyboard and its browser chrome own the bottom of a 390px
 * screen, and the sticky phone topbar (`.astra-topbar`, `desk-astra.css`,
 * `≤700px`) already owns the top with a known height. `DeskToaster` picks this
 * one at mount from {@link DESK_TOASTER_PHONE_QUERY}.
 *
 * IT IS THE ATTRIBUTE, NOT THE BOX. An earlier cut of this left `position` at
 * `bottom-left` and moved the stack with a `≤700px` stylesheet rule setting
 * `top: …; bottom: auto`. Measured in a 390px frame, that put the CARD at
 * y=28px -- overlapping the very header the offset was meant to clear --
 * because sonner still laid the toast out as a bottom-anchored stack and only
 * the box moved. Sonner writes `data-y-position` from this prop and lays the
 * cards out by it, so the prop is the only honest way to change the edge.
 */
export const DESK_TOASTER_PHONE_POSITION = "top-left" as const;
/** The width at which the desk is a phone, the same one `desk-astra.css` uses. */
export const DESK_TOASTER_PHONE_QUERY = "(max-width: 700px)";

/**
 * `bottom` and `top` are BOTH the clear height, and that is deliberate.
 *
 * Sonner swaps to `--mobile-offset-*` at its own 600px breakpoint, which is not
 * this desk's 700px, so a 620px frame is "a phone" to one of them and not the
 * other. Both variables carrying the same number is what makes that
 * disagreement harmless.
 */
export const DESK_TOASTER_OFFSET = {
  bottom: DESK_TOAST_LIFT,
  top: DESK_TOAST_LIFT,
  left: "calc(var(--desk-nav-w, 0px) + 16px)",
  right: 16,
};
/** On a phone the nav is off-canvas, so the left offset is a plain gutter. */
export const DESK_TOASTER_MOBILE_OFFSET = {
  top: DESK_TOAST_LIFT,
  bottom: DESK_TOAST_LIFT,
  left: 16,
  right: 16,
};

/** Which edge the stack hangs from, decided by the frame it is drawn in. */
export function deskStackPosition(phone: boolean): "bottom-left" | "top-left" {
  return phone ? DESK_TOASTER_PHONE_POSITION : DESK_TOASTER_POSITION;
}

/**
 * Is a toast host mounted on this page?
 *
 * `announceToDesk` asks this before deciding which live region speaks, so the
 * announcement is made exactly once: by the toast when there is one, by
 * `#desk-announcer` when there is not.
 */
export function deskToastHostMounted(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector("[" + DESK_TOAST_HOST_ATTR + "]") !== null;
}

/** The message an error-shaped value carries, or "" when it carries none. */
function deskErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    /*
      An error-shaped object with no `message` has nothing to carry through, and
      `String({})` would put "[object Object]" in front of the editor.
    */
    return String((error as { message?: unknown }).message ?? "").trim();
  }
  if (error == null) return "";
  return String(error).trim();
}

/*
  The three shapes the desk's own sentences do not cover.

  M8 of the batch-6 pre-merge audit: `deskErrorReason` returned `error.message`
  verbatim, so the most common failure of all -- the desk not being up, or the
  editor's connection dropping -- reached the editor as the browser's own
  "Failed to fetch", which names nothing they can act on and says nothing about
  whether their press landed. The wording below is the desk's, and each one
  answers the two questions a failed press raises: what happened, and did
  anything change.
*/
const NETWORK_FAILURE = /failed to fetch|load failed|networkerror|network request failed/i;
const TIMEOUT_FAILURE = /abort|timed out|timeout/i;
const SIGNED_OUT_FAILURE = /\b401\b|unauthorized|forbidden/i;

export const DESK_UNREACHABLE_REASON =
  "The desk could not be reached. Check that it is running and your connection. Nothing was changed.";
export const DESK_TOO_SLOW_REASON =
  "The desk took too long. It may have finished — reload before pressing again.";
export const DESK_SIGNED_OUT_REASON = "You are signed out or not allowed to do that. Sign in again.";

/**
 * The real reason a press failed, in words.
 *
 * The desk's server functions already answer with sentences written for an
 * editor, so the honest thing is to carry that sentence through -- that is
 * still the bulk of this function, and `what` is not decoration: it is the word
 * `editorActionError` needs to say which press failed.
 *
 * What is NOT carried through is a message that only names the transport. A
 * browser's `TypeError: Failed to fetch` and a Zod dump are both true and both
 * useless to an editor, and the second one also prints the schema's own field
 * paths at them (see `editorActionError`, desk-copy.ts). A thrown non-Error is
 * still named rather than swallowed, and an empty message falls back to a
 * sentence that at least says which half of the exchange broke.
 */
export function deskErrorReason(error: unknown, what = "do that"): string {
  const raw = deskErrorMessage(error);
  if (!raw) return "the desk gave no reason";
  /*
    The transport never got an answer. Checked before everything else because
    each of these is a sentence that has to be *replaced*: the browser's text
    says nothing about whether the press landed, and the editor's next move
    (start the desk / reload before pressing again / sign in) is the whole
    point of saying anything at all.
  */
  if (NETWORK_FAILURE.test(raw)) return DESK_UNREACHABLE_REASON;
  if (TIMEOUT_FAILURE.test(raw)) return DESK_TOO_SLOW_REASON;
  if (SIGNED_OUT_FAILURE.test(raw)) return DESK_SIGNED_OUT_REASON;
  /*
    A schema dump or a bare 500 is not a sentence either, and `editorActionError`
    is the one place that turns either into one -- the same words the rest of
    the desk uses for the same failure. The predicates are repeated here rather
    than called through, because `editorActionError` also rewrites ordinary
    text through `plainEditorText`, and a real refusal must pass through
    untouched.
  */
  if (
    looksLikeValidationDump(raw) ||
    /unexpected server error|internal server error|status code 500/i.test(raw)
  )
    return editorActionError(raw, what) ?? raw;
  return raw;
}

/**
 * Show a toast, and say it once.
 *
 * The error variant carries a leading "!" the way `Notice` does, so the kind
 * survives without relying on colour: it is `aria-hidden` because the sentence
 * itself is what a screen reader should read, and the danger border and text
 * are what a sighted editor should see.
 */
export function deskToast(text: string, options: DeskToastOptions = {}): void {
  const tone = options.tone ?? "ok";
  const undo = options.undo ?? null;
  const body =
    tone === "err"
      ? createElement(
          "span",
          null,
          createElement("strong", { "aria-hidden": "true" }, "! "),
          text,
        )
      : text;

  const data: Parameters<typeof toast.success>[1] = {
    className: "desk-toast desk-toast-" + tone,
    duration: options.duration ?? (tone === "err" ? DESK_TOAST_ERR_MS : DESK_TOAST_OK_MS),
    // Undefined is sonner's own "a fresh toast"; an id replaces the one on
    // screen. See `DeskToastOptions.id`.
    id: options.id,
  };

  /*
    The Undo button's id, known only once the toast exists. Sonner dismisses a
    toast itself after its action returns, but only when the handler left the
    event alone -- so this prevents the default and dismisses by hand, which is
    what lets a FAILED undo stay on screen as its own error instead of the
    editor watching the only way back disappear with no explanation.
  */
  let id: string | number = "";
  if (undo) {
    data.action = {
      label: undo.label,
      onClick: (event: MouseEvent) => {
        event.preventDefault();
        void Promise.resolve()
          .then(() => undo.run())
          .catch((err: unknown) => {
            deskToast(`The undo did not go through: ${deskErrorReason(err, "take that back")}`, {
              tone: "err",
            });
          })
          .finally(() => toast.dismiss(id));
      },
    };
  }

  const sink = tone === "err" ? toast.error : tone === "warn" ? toast.warning : toast.success;
  id = sink(body, data);
}
