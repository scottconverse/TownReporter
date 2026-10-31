/** The measured widths the section row must fit into. */
export type SectionFitInput = {
  /** Width available to the nav itself. */
  room: number;
  /** Width of every section link, including the ones not currently shown. */
  widths: readonly number[];
  /** The nav's column gap. */
  gap: number;
  /** Width of the "More sections" button when it is needed. */
  more: number;
  /** Width of the route-owned "About the newsroom" link, when present. */
  about?: number;
};

/**
 * Choose the largest section prefix that fits, reserving About and -- only
 * when a link has to be hidden -- the More button. This is pure so the fit can
 * be tested without a browser layout.
 */
export function fitSectionCount({
  room,
  widths,
  gap,
  more,
  about = 0,
}: SectionFitInput): number {
  if (widths.length === 0) return 0;

  const prefix = (limit: number) => {
    let used = 0;
    let fit = 0;
    for (const width of widths) {
      const next = fit === 0 ? width : used + gap + width;
      if (next > limit) break;
      used = next;
      fit += 1;
    }
    return fit;
  };

  const aboutCost = about > 0 ? gap + about : 0;
  if (prefix(room - aboutCost) === widths.length) return widths.length;

  const reserved = aboutCost + gap + more;
  return Math.max(1, prefix(room - reserved));
}