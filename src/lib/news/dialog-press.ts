/**
 * WHICH dialog button is out, not just "one is" (unit UI1a3, finding 4).
 *
 * The Kill and Hold dialogs each put two destructive presses in one foot, and
 * both were wired to a single `busy`. Handing the shared `Dialog` foot the same
 * pending label for both made BOTH buttons draw "Killing…" / "Holding…" with a
 * spinner -- a claim that two destructive controls had been activated when the
 * editor pressed one.
 *
 * The rule is small enough to state once: the foot is pending while a press is
 * out (`pending`), and each button wears the word ONLY if it was the one
 * pressed -- the other gets `undefined`, which the foot reads as "not pending",
 * so it stays at its own label. It is pure so the rule is testable without a
 * browser: the dialogs themselves are Radix trees no `node --test` can mount.
 */
export type DialogPress = "primary" | "alt" | null;

export type DialogPressProps = {
  /** True while a press is out, whichever button fired it. */
  pending: boolean;
  /** The word for the PRIMARY button, or undefined when it was not the one. */
  primaryPendingLabel: string | undefined;
  /** The word for the ALT button, or undefined when it was not the one. */
  altPendingLabel: string | undefined;
};

export function dialogPressProps(pressed: DialogPress, word: string): DialogPressProps {
  return {
    pending: pressed !== null,
    primaryPendingLabel: pressed === "primary" ? word : undefined,
    altPendingLabel: pressed === "alt" ? word : undefined,
  };
}
