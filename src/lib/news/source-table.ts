/**
 * The ranked source table (dynamic sources unit 8, spec 6a/6b): the words on
 * the buttons, the words on the chips, the sort and the filter.
 *
 * WHY THIS IS A .ts FILE AND NOT PART OF `source-moves.tsx`. The screen is a
 * `.tsx` component and a test cannot load JSX under `node
 * --experimental-strip-types`. The rules the owner asked for -- "clicking any
 * column header sorts by it; clicking again reverses", "sort by score,
 * highest first, no score last", the button words, the filter behind the
 * counts strip -- are rules, not drawing, so they live here where a test can
 * pin them. `source-moves.tsx` draws them and `desk.sources.tsx` reads the chip
 * words, so the two screens cannot disagree about what a status is called.
 */

/** The three statuses the editor can move a source between. Nothing is deleted. */
export type To = "accepted" | "trial" | "dormant";

/**
 * What each status is CALLED. `sources.status` is the only state (spec 4a), and
 * the editor sees these words on the inventory table and on /desk/sources.
 */
export const STATUS_WORDS: Record<string, string> = {
  accepted: "Read by the scan",
  trial: "On trial",
  dormant: "Dormant (checked once a month)",
  proposed: "Suggested",
  rejected: "Rejected",
  paused: "Paused",
};

/**
 * The words on the press, by where the row is now and where the press sends it
 * (spec 6a, and the owner's own phrasing).
 *
 *   trial    -> accepted   Accept now       one click, no confirmation
 *   trial    -> dormant    Drop now
 *   dormant  -> trial      Re-try
 *   accepted -> trial      Put on trial
 *   accepted -> dormant    Make it dormant
 *
 * Every one of them can be moved again; "Drop now" is a state, not a delete.
 */
export const BUTTON_WORDS: Record<string, Record<To, string>> = {
  accepted: { accepted: "Keep it", trial: "Put on trial", dormant: "Make it dormant" },
  trial: { accepted: "Accept now", trial: "Keep it", dormant: "Drop now" },
  dormant: { accepted: "Accept now", trial: "Re-try", dormant: "Keep it" },
};

export function buttonWord(from: string, to: To): string {
  return BUTTON_WORDS[from]?.[to] ?? BUTTON_WORDS.accepted[to];
}

/** The moves the editor can make from a status: every other status. */
export function movesFrom(status: string): To[] {
  return (["accepted", "trial", "dormant"] as To[]).filter((to) => to !== status);
}

/**
 * The filter the counts strip puts on the table. Null is every row.
 *
 * "suggested" is not a `sources.status` on this table -- suggested sites are
 * proposed sources waiting for a look, and the panel shows them one row per
 * website rather than in the ranked table. It lives in the same filter because
 * it is the same strip: one press in force at a time, "Show all" clears it.
 */
export type SourceFilter = To | "suggested" | null;

/** Which list the panel draws for a strip press. */
export type SourceView = "table" | "suggested-sites";

export function viewForFilter(filter: SourceFilter): SourceView {
  return filter === "suggested" ? "suggested-sites" : "table";
}

/**
 * Spec 5f: the suggested sites, biggest count first -- the website with the
 * most waiting links is the one worth opening first. Equal counts read by name
 * so the list does not shuffle between loads.
 */
export function sortSuggestedSites<T extends { site: string; count: number }>(
  sites: readonly T[],
): T[] {
  return [...sites].sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}

/**
 * The line under a source's name when other links on the same website are
 * waiting to be looked at (spec 6a). Null when there are none, so the caller
 * draws nothing rather than "0 more links".
 */
export function moreLinksWords(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "1 more link on this site" : `${count} more links on this site`;
}

export type SourceSortKey =
  | "source"
  | "status"
  | "score"
  | "leads"
  | "lastLead"
  | "reads"
  | "howOften"
  | "nextRead"
  | "lastObservation";

export type SortDirection = "asc" | "desc";

export type SourceSort = { key: SourceSortKey; direction: SortDirection };

/** What the table opens on: score, highest first (spec 6a). */
export const DEFAULT_SORT: SourceSort = { key: "score", direction: "desc" };

/** The columns that read highest-first when first clicked: a number's useful
 *  end is the top. Names and dates read left to right, oldest first. */
const FIRST_CLICK_DESCENDING: ReadonlySet<SourceSortKey> = new Set([
  "score",
  "leads",
  "reads",
]);

/** Clicking a header: the same column reverses; a new column starts at its
 *  natural end. */
export function sortOn(clicked: SourceSortKey, current: SourceSort): SourceSort {
  if (clicked === current.key) {
    return { key: clicked, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, direction: FIRST_CLICK_DESCENDING.has(clicked) ? "desc" : "asc" };
}

/** The facts the sort reads. A missing value is null and always sorts last. */
export type SortableSourceRow = {
  id: number;
  title: string;
  url: string;
  status: string;
  score: number | null;
  leads90: number;
  reads90: number;
  lastLeadAt: string | null;
  nextDueAt: string | null;
  rhythm: string | null;
  intervalMinutes: number | null;
  lastObservationAt: string | null;
};

/** Minutes between reads, for the "How often" column: a rhythm beats the
 *  interval (spec 5d), and a source with neither is the daily default. */
export function minutesBetweenReads(row: {
  rhythm: string | null;
  intervalMinutes: number | null;
}): number {
  if (row.rhythm?.startsWith("weekly:")) return 7 * 24 * 60;
  if (row.rhythm?.startsWith("monthly:")) return 30 * 24 * 60;
  return row.intervalMinutes ?? 24 * 60;
}

function sortValue(row: SortableSourceRow, key: SourceSortKey): string | number | null {
  switch (key) {
    case "source":
      return (row.title || row.url).toLowerCase();
    case "status":
      return row.status;
    case "score":
      return row.score;
    case "leads":
      return row.leads90;
    case "reads":
      return row.reads90;
    case "lastLead":
      return row.lastLeadAt;
    case "howOften":
      return minutesBetweenReads(row);
    case "nextRead":
      return row.nextDueAt;
    case "lastObservation":
      return row.lastObservationAt;
  }
}

/**
 * The rows as the table shows them: filtered to one status when the strip has
 * been pressed, then sorted. A row with no answer for the sort column (no
 * score yet, never read, no lead) sorts LAST in both directions -- "not
 * enough reads" is not the lowest score, it is an absence, and putting it at
 * the top of a reversed sort would be a claim the desk cannot make.
 */
export function sortSourceRowList<T extends SortableSourceRow>(
  rows: readonly T[],
  sort: SourceSort,
  filter: SourceFilter = null,
): T[] {
  const kept =
    filter && filter !== "suggested" ? rows.filter((row) => row.status === filter) : [...rows];
  const sign = sort.direction === "asc" ? 1 : -1;
  return kept.sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    const leftMissing = left == null || left === "";
    const rightMissing = right == null || right === "";
    if (leftMissing && rightMissing) return a.id - b.id;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    if (order !== 0) return order * sign;
    // A stable, meaningful tie-break: the busier source first, then the older row.
    return b.leads90 - a.leads90 || a.id - b.id;
  });
}
