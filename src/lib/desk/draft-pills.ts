/**
 * The Drafts filter pill's words (G24-PD-1).
 *
 * "All · 0" was drawn for about a tenth of a second on a full reload, before the
 * list had answered -- a count the desk did not have yet, read as a fact. The
 * pill says its label alone until the count is known, then "label · n". No
 * placeholder glyph: a dash or an ellipsis in a pill is the small, faint kind of
 * mark the desk's readers cannot make out.
 */
export function draftPillText(
  label: string,
  counts: Readonly<Record<string, number>> | null | undefined,
  key: string,
): string {
  const n = counts?.[key];
  return typeof n === "number" ? `${label} · ${n}` : label;
}
