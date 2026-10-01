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
 * The stand-down rules are Today's, extended by N4 of the batch-7 re-audit,
 * because they are the ones that make a page with four text boxes in it usable:
 *
 *   - a text field or `isContentEditable` owns the keystroke, because the editor
 *     is TYPING in it; a J that moved the list instead of typing a letter would
 *     break the composer;
 *   - so does a control the editor is STANDING ON -- a button, a link, a
 *     summary, anything with `role=button` or `role=link`. Those are activated
 *     with the keyboard, Enter above all, and the old rule cancelled the press
 *     and navigated to the cursor lead instead (the audit's own probe: Enter on
 *     a focused button returned `{kind:"open"}`);
 *   - and the whole set stands down while a surface is over the list -- a
 *     dialog, a modal, or one of the desk's `<details>` menus left open -- so a
 *     stray X cannot open Kill behind the Hold dialog;
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

/** The tags that activate on a keystroke of their own. */
const INTERACTIVE_TAG = /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY|OPTION|LABEL)$/;

/**
 * The roles the desk puts on a `<div>` that behaves as one of those tags --
 * `desk-chrome.tsx`'s own menus and the row controls both draw them that way,
 * and a role is what a keyboard user is told to expect.
 */
const INTERACTIVE_ROLE_SELECTOR =
  '[role="button"],[role="link"],[role="menuitem"],[contenteditable="true"]';

/**
 * Does the element under this keystroke own it, rather than the list?
 *
 * N4 of the batch-7 re-audit. `isTypingTarget` answers "the editor is TYPING
 * here"; this answers "the editor is ON something that has its own keyboard
 * behaviour", which is the other half and the one the desk was missing. The
 * audit ran `triageAction({key:"Enter", target:{tagName:"BUTTON"}})` and got
 * `{kind:"open"}` back: a keyboard user who tabbed to the Hold dialog's
 * confirm, the bulk strip, the pager or "More" and pressed Enter had the
 * activation cancelled and was taken to the cursor lead's story instead.
 * Nothing here is subtle -- every one of them is a control the editor chose to
 * stand on -- so every key stands down, not only Enter.
 */
export function isInteractiveTarget(target: unknown): boolean {
  if (isTypingTarget(target)) return true;
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (typeof tag === "string" && INTERACTIVE_TAG.test(tag)) return true;
  /*
    `closest`, not a walk of `parentElement`: a `<span>` inside a button is the
    target of the keystroke, and the button is what owns it. Guarded because the
    target is not always an element -- a window, a document, and the plain
    objects tests hand this function have no `closest` at all.
  */
  const closest = (el as Element).closest;
  return typeof closest === "function" && closest.call(el, INTERACTIVE_ROLE_SELECTOR) != null;
}

/**
 * A surface standing over the list, in the shapes this desk draws them.
 *
 * The two dialog shapes are deliberately the same ones `desk-action.ts` names
 * for ⌘S (`dialog[open], [role=dialog][data-state=open]` -- a native `<dialog>`
 * that has been shown, and Radix's), plus `details[open]`: the desk has no
 * popover or menu component and `<details>` is what it uses instead, so an open
 * one IS a menu (see `desk-chrome.tsx`).
 *
 * Kept as a selector here rather than imported from `desk-action.ts` because
 * this module is loaded by the DOM harness on its own, and that one pulls the
 * whole mutation stack in with it.
 */
export const TRIAGE_STANDDOWN_SELECTOR =
  "dialog[open], [role=dialog][data-state=open], details[open]";

/** Is one of those surfaces over the list? `root` is injectable so this stays testable. */
export function triageOverlayOpen(
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): boolean {
  return root?.querySelector(TRIAGE_STANDDOWN_SELECTOR) != null;
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
  /*
    "A dialog is open" is not a property of the keystroke -- it is a property of
    the screen at the moment it was pressed -- so it is passed in rather than
    read off the event. Same shape as `deskShouldSave(event, dialogOpen)` in
    `desk-action.ts`, and for the same reason: both halves stay testable without
    a browser. The binding asks the DOM; see `useTriageKeys`.
  */
  overlayOpen = false,
): TriageAction {
  if (overlayOpen) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isInteractiveTarget(event.target)) return null;
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
 * (nothing to triage at all).
 *
 * The dialog stand-down is asked of the DOCUMENT on every keystroke rather than
 * passed in from the screen, which is N4's other half: the audit found the
 * Queue binding this hook with no `enabled` argument at all, and a rule that
 * depends on each screen remembering to name its own dialogs is a rule with as
 * many holes as there are screens. `document.querySelector` also finds a
 * portal, which a screen's own state cannot see from where it sits.
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
      const action = triageAction(event, triageOverlayOpen());
      if (!action) return;
      event.preventDefault();
      handler.current(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
