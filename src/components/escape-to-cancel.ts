import { useEffect, useRef } from "react";

/**
 * Escape on an open inline confirmation (unit DLG-2).
 *
 * An inline confirmation -- "Yes, delete" with "Keep" beside it -- used to stay
 * open when Escape was pressed; only its Keep button closed it. Escape now does
 * exactly what Keep does: the confirmation goes away and nothing is changed.
 * Escape never confirms. Keep's own guards carry over: a Keep that is disabled
 * while a delete is saving is also a no-op for Escape, so the caller passes
 * `active` false then.
 *
 * The listener sits on the window in the capture phase, so while the
 * confirmation is open the press stops here and does not also close the More
 * panel or dialog the confirmation sits in. If two confirmations are open, one
 * press closes the first one; the next press closes the other. It is attached
 * only while `active` is true, so Escape is left alone everywhere else.
 */
export function attachEscapeToCancel(target: EventTarget, onCancel: () => void): () => void {
  const escape = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onCancel();
  };
  target.addEventListener("keydown", escape, true);
  return () => target.removeEventListener("keydown", escape, true);
}

/** Escape = Keep, for an inline confirmation that is open (`active`). */
export function useEscapeToCancel(active: boolean, onCancel: () => void): void {
  // The latest onCancel is read through a ref so the window listener is not
  // re-attached on every render; re-attaching would change which open
  // confirmation hears Escape first.
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });
  useEffect(() => {
    if (!active) return;
    return attachEscapeToCancel(window, () => cancelRef.current());
  }, [active]);
}

/**
 * The same Escape listener for a confirmation that is drawn once per row in a
 * list, where a hook cannot be called. Render it inside the row's confirmation;
 * it mounts with the confirmation and unmounts when the confirmation closes.
 */
export function EscapeToCancel({
  active = true,
  onCancel,
}: {
  active?: boolean;
  onCancel: () => void;
}): null {
  useEscapeToCancel(active, onCancel);
  return null;
}
