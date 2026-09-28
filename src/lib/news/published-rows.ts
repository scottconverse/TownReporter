/**
 * Which published stories the Published screen's filter row and search box
 * show, and what each pill counts.
 *
 * WHY HERE AND NOT IN THE ROUTE. These were `published.tsx`'s own inline
 * predicates until Unit CZ-long-lists moved the list onto a server window. A
 * window is only correct if the filter is applied BEFORE the page is cut, so
 * the same decisions now run on the server -- and a rule that runs on the
 * server needs a name and a test that does not need a database, the same split
 * `desk-drafts.ts` and `headline-control.ts` already use.
 *
 * The words are the route's; nothing about which rows match changed.
 */

/** The four pills above the list, in the order the design draws them. */
export const PUBLISHED_FILTERS = ["all", "week", "corrections", "opinion"] as const;
export type PublishedFilter = (typeof PUBLISHED_FILTERS)[number];

/** What the filter row and the search box need to know about one row. */
export type PublishedListRow = {
  headline: string;
  topic: string | null;
  published_at: string | null;
  /** The row's corrections, as the desk's `listPublishedDesk` returns them. */
  corrections: { date: string; body: string }[];
};

/** Seven days, as the route has always measured "This week". */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The cut-off for "This week", off the clock the caller passes in.
 *
 * Read once per request rather than per row so every row on one page measures
 * against the same instant, and so a test can pin it.
 */
export function publishedWeekAgo(nowMs: number): number {
  return nowMs - WEEK_MS;
}

/** The search box's needle, or "" when the box is empty. */
export function publishedNeedle(search: string): string {
  return search.trim().toLowerCase();
}

/**
 * Does this row survive the search box AND the pill that is on?
 *
 * Both, in that order -- the same order the route has always applied them.
 */
export function publishedMatches(
  row: PublishedListRow,
  filter: PublishedFilter,
  needle: string,
  weekAgo: number,
): boolean {
  if (needle && !`${row.headline} ${row.topic ?? ""}`.toLowerCase().includes(needle)) {
    return false;
  }
  switch (filter) {
    case "week":
      return row.published_at != null && Date.parse(row.published_at) >= weekAgo;
    case "corrections":
      return row.corrections.length > 0;
    case "opinion":
      return (row.topic ?? "").trim().toLowerCase() === "opinion";
    default:
      return true;
  }
}

/**
 * How many rows each pill would show.
 *
 * Counted over the WHOLE list, not the page: this is the number the pill
 * prints, and a pill that says "This week · 25" because 25 is as many rows as
 * the screen happens to have loaded is the bug the window would otherwise
 * introduce. The search box is deliberately NOT applied here -- the pills
 * describe the list, and the search narrows what is drawn under them.
 */
export function publishedFilterCounts(
  rows: readonly PublishedListRow[],
  weekAgo: number,
): Record<PublishedFilter, number> {
  return {
    all: rows.length,
    week: rows.filter((row) => publishedMatches(row, "week", "", weekAgo)).length,
    corrections: rows.filter((row) => publishedMatches(row, "corrections", "", weekAgo)).length,
    opinion: rows.filter((row) => publishedMatches(row, "opinion", "", weekAgo)).length,
  };
}
