/*
  The owner's takedown form: the state behind one capture's takedown, and the
  words that name the capture it is about.

  WHAT THIS FILE IS. The form drawn inside the opened-capture pane of
  src/components/finding-evidence-review.tsx, split out so the rule it keeps can
  be tested without a browser: this repository has no DOM test environment for
  components (see the notes in scripts/bh2-dialogs.test.mjs and
  src/components/check-gates.test.ts), and what follows is a rule about state,
  not about markup. It has no imports on purpose -- it is pure, and it is
  reachable from the client bundle.

  THE DEFECT IT FIXES (unit U23, PR #157 review). The open flag, the reason and
  the "remove the link too" tick were three loose pieces of component state that
  nothing had tied to a capture. Open capture A, write a reason about A, then
  open capture B: the form was still open, still holding A's reason, and the
  press under it purged B with a reason written about A. That reason is the
  audit record of why a publisher's excerpt was destroyed; it is the one field
  in this flow that must never be borrowed from the neighbouring row, and a
  borrowed one is worse than an empty one because it reads as deliberate.

  SO THE FORM CARRIES ITS CAPTURE. `versionId` is part of the state, and
  {@link takeDownFormForCapture} is the only way in or out: the form belongs to
  the capture named in it, and the moment the pane moves to another capture --
  or closes, which is `versionId === null` -- every field it held is dropped and
  a blank form is handed back for the new one. Nothing is carried over, because
  there is no field left that could be.

  A REASON IS NOT RESTORED BY COMING BACK. A: type, switch to B, switch back to
  A -- the reason is gone. That is the deliberate direction: the owner types the
  reason with the capture in front of them, and a reason silently reappearing
  from an earlier look is a reason that might no longer be true.
*/

/**
 * The form the owner fills in, and the capture it is about.
 *
 * `versionId` is the capture whose takedown this form would perform. Null means
 * nothing is open and there is nothing to take down.
 */
export type TakeDownForm = {
  versionId: number | null;
  open: boolean;
  reason: string;
  removeLink: boolean;
};

/** The form for `versionId`, with nothing filled in. */
export function blankTakeDownForm(versionId: number | null): TakeDownForm {
  return { versionId, open: false, reason: "", removeLink: false };
}

/**
 * The form as it applies to the capture the pane is showing now.
 *
 * THE ONE RULE THIS FILE EXISTS FOR: a form that is about a different capture
 * -- or about no capture -- becomes a blank form for this one. Called on every
 * render so the reset cannot be missed by a late effect, and returns the SAME
 * object when the capture has not changed, so a caller can use it on every
 * render without churning state.
 */
export function takeDownFormForCapture(
  state: TakeDownForm,
  versionId: number | null,
): TakeDownForm {
  if (state.versionId === versionId) return state;
  return blankTakeDownForm(versionId);
}

/**
 * What the owner reads immediately before the press that cannot be undone: the
 * capture being taken down, named, so the pane cannot confirm a takedown of one
 * record in words that would fit another.
 *
 * The title is the name when there is one; the address is the fallback, so this
 * is never a sentence with a blank in it. The address is always printed too,
 * because two records can share a title and only one of them is behind this
 * press.
 */
export function takeDownConfirmText(capture: { title?: string | null; url: string }): string {
  const title = typeof capture.title === "string" ? capture.title.trim() : "";
  if (!title) return `You are taking down ${capture.url}. It cannot be undone.`;
  return `You are taking down “${title}” — ${capture.url}. It cannot be undone.`;
}
