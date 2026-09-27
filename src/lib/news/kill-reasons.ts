/**
 * The exact words the redesign's Kill and Hold dialogs offer, in one place.
 *
 * Why this is its own module rather than an array inside a dialog component:
 * the Kill dialog belongs to another lane, and the desk's "bad source" count
 * (`SourceKillPattern`) has to agree with it about what counts as one. Two
 * copies of the string "Bad source or unreadable" would drift, and the drift
 * would be silent -- the pattern would simply stop counting kills the editor
 * made with the quick fill, and look like "no bad sources lately".
 *
 * The rule is deliberately a substring test on normalised text, not equality:
 * the design says a quick fill "drops text into Reason in your words", which
 * the editor can then edit. "Bad source or unreadable -- the PDF is a scan"
 * is still a bad-source kill, and equal-string matching would drop it.
 *
 * Nothing here changes scoring or source weights. It is a label vocabulary.
 */

/** The one quick fill the kill pattern counts. Kept as a named export so a
 *  dialog and a counter cannot disagree about the spelling. */
export const BAD_SOURCE_REASON = "Bad source or unreadable";

export type QuickFill = {
  /** The button label. */
  label: string;
  /** The sentence under it, or "" when the design draws none. */
  note: string;
  /** The text that drops into "Reason in your words" when it is pressed. */
  text: string;
};

/**
 * Kill quick fills, in the design's order.
 *
 * The text is the label spelled out as a sentence, because this value is
 * stored on the lead and read back by a person months later under Killed --
 * "Outside our area" alone reads like a category someone clicked.
 */
export const KILL_QUICK_FILLS: readonly QuickFill[] = [
  { label: "Not news", note: "Routine notice, no public interest", text: "Not news — routine notice, no public interest." },
  { label: "Already printed", note: "Matches a story we ran", text: "Already printed — matches a story we ran." },
  { label: "Outside our area", note: "", text: "Outside our area." },
  { label: BAD_SOURCE_REASON, note: "", text: `${BAD_SOURCE_REASON}.` },
];

/**
 * Hold reasons, in the design's order.
 *
 * `key` is what gets written to the lead's notes; the label is what the editor
 * clicked. They are separate because the label is a sentence in the desk's
 * voice and the stored value has to survive a redesign of that sentence --
 * a scan reading back held leads should not care how the button was worded.
 */
export type HoldChoice = {
  key: "record-or-date" | "follow-up" | "not-now";
  label: string;
  note: string;
};

export const HOLD_CHOICES: readonly HoldChoice[] = [
  { key: "record-or-date", label: "Waiting on a record or date", note: "You release it when the record arrives" },
  { key: "follow-up", label: "Waiting on an AI follow-up", note: "Creates a follow-up" },
  { key: "not-now", label: "Not now, maybe later", note: "" },
];

export function holdChoice(key: string): HoldChoice | undefined {
  return HOLD_CHOICES.find((c) => c.key === key);
}

/**
 * True when a free-text kill reason is a bad-source kill.
 *
 * Lower-cased and matched loosely on purpose: the quick fill is a starting
 * point the editor edits, and `SourceKillPattern`'s whole job is to notice a
 * source that keeps producing unreadable material. Requiring an exact string
 * would make the pattern silently wrong in the direction that matters least
 * visibly -- it would under-count.
 */
export function isBadSourceReason(reason: string | null | undefined): boolean {
  const text = String(reason ?? "").toLowerCase();
  if (!text.trim()) return false;
  return /bad source|unreadable/.test(text);
}
