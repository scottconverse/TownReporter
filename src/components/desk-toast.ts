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

/**
 * The real reason a press failed, in words.
 *
 * Not a lookup table of friendly replacements: the desk's server functions
 * already answer with sentences written for an editor, so the honest thing is
 * to carry that sentence through. A thrown non-Error still gets named rather
 * than swallowed, and an empty message falls back to a sentence that at least
 * says which half of the exchange broke.
 */
export function deskErrorReason(error: unknown): string {
  const nothingToSay = "the desk gave no reason";
  if (error instanceof Error) return error.message.trim() || nothingToSay;
  if (typeof error === "string") return error.trim() || nothingToSay;
  if (error && typeof error === "object") {
    /*
      An error-shaped object with no `message` has nothing to carry through, and
      `String({})` would put "[object Object]" in front of the editor. The
      generic sentence is the honest answer for it.
    */
    const message = String((error as { message?: unknown }).message ?? "").trim();
    return message || nothingToSay;
  }
  if (error == null) return nothingToSay;
  return String(error);
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
            deskToast(`The undo did not go through: ${deskErrorReason(err)}`, { tone: "err" });
          })
          .finally(() => toast.dismiss(id));
      },
    };
  }

  const sink = tone === "err" ? toast.error : tone === "warn" ? toast.warning : toast.success;
  id = sink(body, data);
}
