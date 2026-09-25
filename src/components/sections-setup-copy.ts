/**
 * The words the sections panel uses for sources.
 *
 * Kept out of the component so the sentences can be checked without a DOM,
 * the same reason desk-chrome-utils.ts exists. The sentences carry a
 * distinction that matters: adding a source from inside a section writes to
 * the watch list immediately (it is the Sources page's own server call), while
 * the *assignment* to the section is a section write and only lands on Confirm
 * and apply. A label that merged those two would send an editor away believing
 * a section scans a page it never reads.
 */

/** How many source names the summary line lists before it starts counting. */
const NAMES_IN_SUMMARY = 3;

/**
 * The `<summary>` of a section's source list.
 *
 * Empty sections get an instruction ("choose or add below") because a
 * collapsed "0 — none assigned yet" is exactly the line the owner read past
 * and then could find no way to act on.
 */
export function sourcesSummaryLabel(count: number, titles: string[]): string {
  if (count <= 0) return "Sources this section reads (0) — choose or add below";
  const head = `Sources this section reads (${count})`;
  const shown = titles
    .slice(0, NAMES_IN_SUMMARY)
    .map((title) => title.trim())
    .filter(Boolean);
  if (!shown.length) return head;
  const hidden = Math.max(count - shown.length, 0);
  return `${head} — ${shown.join(", ")}${hidden ? `, +${hidden} more` : ""}`;
}

/** The standing explanation above the add box. */
export function sourceAddHint(sectionName: string): string {
  return (
    `Adding a source here puts it on watch immediately. Its assignment to ` +
    `${sectionName} is saved when you confirm.`
  );
}

/**
 * What the editor is told after a source was added from inside a section.
 *
 * `alreadyOnWatch` is decided by the server response, not by a string compare
 * on the URL: the add path upserts on the newsroom's URL, so a URL that is
 * already on watch comes back as the same row id. If that id was in the
 * accepted list before the click, nothing new was created and the message must
 * not claim otherwise.
 */
export function sourceAddNotice(input: {
  sectionName: string;
  title: string;
  url: string;
  alreadyOnWatch: boolean;
}): string {
  const lead = input.alreadyOnWatch
    ? "Already on watch — ticked for"
    : "Added to Sources and ticked for";
  return (
    `${lead} ${input.sectionName}: ${input.title} (${input.url}). ` +
    `Its assignment is saved when you confirm.`
  );
}

/** The fixed bar's message while a section draft differs from what is saved. */
export const UNSAVED_SECTION_BAR_MESSAGE = "You have unsaved section changes";
