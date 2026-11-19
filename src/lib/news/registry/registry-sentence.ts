/**
 * The closing period of a sentence the desk prints around a value or a date.
 *
 * A value or a date can already end in a full stop ("Free checkups, edited by
 * hand.", "Nov. 18, 5:04 p.m."), so a period added after it would print "..".
 * This adds one only when the text does not already end in ".", "!" or "?".
 * Pure and browser-safe.
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
