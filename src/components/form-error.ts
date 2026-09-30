/**
 * One announced failure line, the shape every desk form already had by hand.
 *
 * UX-3: the error paragraphs on the first-run and sign-in screens rendered as
 * plain `<p>` with no `role` and no live ancestor, while Scan and Add-lead
 * errors were announced (`role="alert"`). A message nobody hears is not a
 * message: "Passwords do not match." and "Wrong setup code." left a screen
 * reader user with a form that silently did nothing.
 *
 * `role="alert"` is the default because every call site is a failure that
 * appears *after* the reader pressed something -- the case an alert is for.
 * `role="status"` is for the two spots that are good news rather than a
 * failure (the one-time temporary password, the freshly minted recovery
 * codes): announced, not alarming.
 *
 * `aria-live` and `aria-atomic` are explicit, the pair `Notice`
 * (`states.tsx`) and the Opinion page's notices already carry for UIUX-03's
 * reason: these paragraphs are mounted at the same moment their text appears,
 * and a live region that arrives with its content is frequently not announced
 * at all. `aria-atomic` makes the whole line read as one message rather than a
 * fragment of it.
 *
 * Written with `createElement` in a `.ts` file, deliberately, the same way
 * `src/components/dialogs/editor-dialog-bodies.ts` is: `node
 * --experimental-strip-types` cannot load a `.tsx` file, so a component
 * written in JSX could not be rendered by `renderToStaticMarkup` in
 * `node --test` at all -- and the render check that proves this component
 * emits the role is the point of it existing.
 */
import { createElement, type ReactNode } from "react";

export function FormError({
  children,
  className,
  role = "alert",
}: {
  children: ReactNode;
  /**
   * The error styling the call site already had, passed through untouched.
   * This component changes what a screen reader hears, never what the screen
   * looks like: passing nothing renders the paragraph with no class at all.
   */
  className?: string;
  /** `"status"` for a reveal that is good news rather than a failure. */
  role?: "alert" | "status";
}) {
  return createElement(
    "p",
    {
      role,
      "aria-live": role === "alert" ? "assertive" : "polite",
      "aria-atomic": "true",
      className,
    },
    children,
  );
}
