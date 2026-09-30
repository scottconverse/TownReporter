/**
 * What locks the story page's evidence review, and what locks the takedown.
 *
 * Unit U25, finding B1. These are two rules that look like one, and the story
 * page used to run only the first for both.
 *
 * The panel's general lock is about JUDGMENTS: a judgment binds to an exact
 * saved draft and the captures cited in it, so a story that is on paper --
 * status `published`, or any story with a published slug -- has nothing for a
 * judgment to bind to and the whole panel closes. `killed` stories close it too.
 *
 * The takedown press is not a judgment. It is the one control a PUBLISHED story
 * still needs, and for a reason the feature's own copy states: the captures
 * with public pages at `/evidence/:versionId` belong to published stories, and
 * the point of the press is that "published citations still resolve — to a
 * notice instead of an excerpt" (see the confirm text in
 * `src/components/finding-evidence-review.tsx`, and `docs/manual.md`'s
 * "Taking down one captured excerpt (owner workflow)").
 *
 * Measured on the stand-in walkthrough of 2026-09-30: on `/desk/story/16`, a
 * published story, the press rendered disabled on all ten claims with no
 * tooltip; on a draft the same press worked. The two conditions were mutually
 * exclusive -- only published stories have publicly reachable captures, and
 * published stories were the ones where the press was dead -- so no editor
 * could produce a public removal notice at all.
 *
 * Kept here, as two named predicates the page calls, so the divergence between
 * them is a stated fact with a test rather than a missing term in a JSX
 * expression. `src/lib/news/finding-evidence-locks.test.ts` fails if `onPaper`
 * is folded back into the takedown's rule, or dropped out of the panel's.
 */

export type EvidenceReviewLockInput = {
  /** `killed`: the story is closed, so nothing that writes to it is offered. */
  locked: boolean;
  /** The story is on paper: `published`, or it has a published slug. */
  onPaper: boolean;
  /** The page is mid-action and cannot take another press yet. */
  waiting: boolean;
  /** A save, a review read or a reconcile is in flight. */
  busy: boolean;
};

const anyHeld = (input: EvidenceReviewLockInput) => input.locked || input.waiting || input.busy;

/**
 * Whether the whole evidence panel is closed: no judgments, no new claims, no
 * capture work. A published story is on this list on purpose.
 */
export function evidenceReviewDisabled(input: EvidenceReviewLockInput): boolean {
  return input.onPaper || anyHeld(input);
}

/**
 * Whether the owner's takedown press is closed. `onPaper` is missing on
 * purpose -- see the module comment above. The server still refuses every
 * role but the owner (`takeDownCapture`), so this only decides whether the
 * desk offers a press that would be refused.
 */
export function takeDownPressDisabled(input: EvidenceReviewLockInput): boolean {
  return anyHeld(input);
}
