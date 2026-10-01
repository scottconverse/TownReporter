/**
 * Keyboard triage, as one rule two screens share.
 *
 * README "Interactions & behavior": "Keyboard triage on Today **and in the
 * Queue**: J/K move the selection, S starts a story, H opens Hold, X opens Kill,
 * U undoes, Enter opens the lead, N starts a new story, ⌘S saves in the story
 * workbench, and ? shows the shortcut list. Keys are ignored while typing in an
 * input."
 *
 * Today had all of that written into its own window listener. The Queue had
 * none of it -- FB0-Report Table B, Queue: "**missing entirely** -- no
 * `onKeyDown` in the file, against README:468" -- so the same eight keys were
 * one screen's private behaviour. Two listeners would drift the first time one
 * of them gained a key, so the decision is here, pure and testable, and the
 * binding is one hook both screens call.
 *
 * "?" is NOT here: the desk shell already binds it on every desk screen
 * (`desk-chrome.tsx`), so a second binding would be the same sheet opened twice.
 * The sheet itself lists these keys.
 *
 * The stand-down rules are Today's, unchanged, because they are the ones that
 * make a page with four text boxes in it usable:
 *
 *   - `isContentEditable` or a text field of any kind owns the keystroke; a J
 *     that moved the list instead of typing a letter would break the composer;
 *   - any modifier means the keystroke is the browser's or the OS's (Ctrl-K is
 *     the desk's search, Cmd-S the workbench's save, Cmd-R a reload);
 *   - and a key the desk does not claim is left entirely alone, so the page's
 *     own scrolling and the browser's shortcuts still work.
 */
import { useEffect, useRef } from "react";

/**
 * The legend bar's words, in the drawing's own order.
 *
 * README "Interactions & behavior": "the keys are on the screen, not only in
 * the '?' sheet -- an editor triaging a list should not have to open a dialog to
 * learn what J does." Today has drawn this bar since the redesign; the Queue had
 * no keys at all, so it now draws the same bar with the same words.
 *
 * It is the drawing's six and not the sheet's ten: ⌘S is the story workbench's
 * save rather than either list's, and `?` is the shell's on every screen.
 */
export const TRIAGE_LEGEND: [string, string][] = [
  ["J / K", "next / previous"],
  ["S", "start story"],
  ["H", "hold"],
  ["X", "kill"],
  ["U", "undo"],
  ["Enter", "open lead"],
];

/** What one keystroke means on a triage list. `null` means "not ours". */
export type TriageAction =
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "start" }
  | { kind: "hold" }
  | { kind: "kill" }
  | { kind: "undo" }
  | { kind: "open" }
  | { kind: "new" }
  | null;

/**
 * Is this keystroke the editor typing rather than a command?
 *
 * `target` is whatever the event named, which is not always an element (a
 * keystroke on the document body names the body, and a synthesised event may
 * name nothing at all).
 */
export function isTypingTarget(target: unknown): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName;
  return typeof tag === "string" && /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
}

/**
 * The action one keystroke carries, or null.
 *
 * `metaKey`/`ctrlKey`/`altKey` are the stand-down the README describes: with any
 * of them held the key belongs to something else and this screen must not also
 * act on it. Shift is deliberately NOT excluded -- it cannot be, because `?` is
 * Shift+`/` and the shell's sheet depends on it -- and no key here is
 * shift-sensitive, so a stray Shift+J is still a move.
 */
export function triageAction(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey"> & {
    /*
      `unknown`, not `EventTarget`: this reads two properties off whatever it is
      given and never calls a method on it, and a listener's `target` is often
      the document body (or, for a synthesised event, nothing at all). Typing it
      as an EventTarget would force every caller and every test to build one to
      answer a question about a string.
    */
    target?: unknown;
  },
): TriageAction {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key.toLowerCase()) {
    case "j":
      return { kind: "move", delta: 1 };
    case "k":
      return { kind: "move", delta: -1 };
    case "s":
      return { kind: "start" };
    case "h":
      return { kind: "hold" };
    case "x":
      return { kind: "kill" };
    case "u":
      return { kind: "undo" };
    case "enter":
      return { kind: "open" };
    case "n":
      return { kind: "new" };
    default:
      return null;
  }
}

/** Where a move lands in a list of `length`, clamped the way the cursor is. */
export function movedIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(current + delta, length - 1));
}

/**
 * Bind the triage keys while this screen is mounted.
 *
 * `onAction` receives the action and the keystroke is swallowed
 * (`preventDefault`) so the browser does not also act on it -- Enter on a
 * focused row, for instance, would otherwise press whatever the focus was on.
 * `enabled` exists for the one case a screen knows better than the key does
 * (nothing to triage, a dialog open over the list).
 */
export function useTriageKeys(
  onAction: (action: Exclude<TriageAction, null>) => void,
  enabled = true,
): void {
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      const action = triageAction(event);
      if (!action) return;
      event.preventDefault();
      handler.current(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
