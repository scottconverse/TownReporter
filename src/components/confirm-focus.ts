import { useEffect, useRef } from "react";

/**
 * Where the keyboard goes when an inline confirm opens and closes (F06 of the
 * 2026-11-19 walk).
 *
 * The desk's confirms replace their own trigger: the Delete button is removed
 * from the page and the "Yes, delete / Keep" pair takes its place. A focused
 * button that leaves the document drops focus to the top of the page ("Skip to
 * desk"), so the keyboard editor who just pressed Delete had to tab back from
 * the start. The same happened again when "Keep" closed the question and the
 * trigger came back.
 *
 * The rule is the ordinary one for a disclosure like this: opening moves focus
 * to the confirm's first SAFE button (Cancel / Keep / Not yet), and closing puts
 * it back on the button that opened the question.
 *
 * WHY `data-focus-key` AND NOT REFS. The trigger is a NEW element after the
 * question closes, so a ref captured before opening points at a node that is no
 * longer in the page. A key on the element survives the remount, and works the
 * same for one confirm on a page (the Server page) and for a confirm inside a
 * list row (Opinion), where one shared ref would land on the wrong row.
 *
 * `keys` may be null while nothing is open; the last pair seen is remembered, so
 * the close still knows where to go back to.
 */
export type ConfirmFocusKeys = {
  /** `data-focus-key` of the button that opens the question. */
  trigger: string;
  /** `data-focus-key` of the confirm's first safe button. */
  safe: string;
};

/** The element carrying a focus key, if it is in the page. */
export function confirmFocusTarget(
  key: string,
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) ?? null;
}

/**
 * Move focus when `open` flips: to `keys.safe` on open, to `keys.trigger` on
 * close. Does nothing on the first render, so a confirm that is already open
 * when its screen mounts does not steal focus from the page.
 */
export function useConfirmFocus(open: boolean, keys: ConfirmFocusKeys | null): void {
  const lastKeys = useRef<ConfirmFocusKeys | null>(null);
  // During render and idempotent: the close needs the pair from while it was open.
  if (keys) lastKeys.current = keys;
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    const pair = lastKeys.current;
    if (!pair) return;
    confirmFocusTarget(open ? pair.safe : pair.trigger)?.focus();
  }, [open]);
}
