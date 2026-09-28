/**
 * How much of a long list one screen shows at a time.
 *
 * WHY THIS EXISTS. The real desk holds lists the drawing never saw: 41 leads in
 * the Queue, 1,588 suggested sources, 214 published stories. Every one of those
 * screens used to fetch its whole list and render every row -- 15,872 px of
 * sources, 17,615 px of published stories -- so the page a reader scrolled was
 * a page nobody had designed, and the DOM carried rows no one would look at.
 * Unit CZ-long-lists puts a window on each of the four lists: the first 25 rows,
 * and a plain "Show 25 more" button that asks the server for the next one.
 *
 * WHERE THE WINDOW IS APPLIED. On the server, in the `...Page` server function
 * for each screen, so the browser is only ever sent the rows it draws. It is
 * NOT a SQL `limit`/`offset`, and that is deliberate: three of the four lists
 * filter by a decision over row fields rather than by a column -- the Queue's
 * "≈ Printed" is `nearDuplicate` against the published set, Drafts is the state
 * machine in `desk-drafts.ts`, and Sources' "Could not check" is the same
 * accepted rows narrowed to those with a fetch error. A SQL `limit` would page
 * the UNFILTERED set and hand back the wrong rows. So each server function
 * reads its rows exactly as it always did, applies the screen's own filter, and
 * then takes `offset .. offset + limit` off the result. What crosses the wire,
 * and what lands in the DOM, is bounded either way.
 *
 * WHY HERE AND NOT IN THE ROUTE. `src/lib/news/desk.ts` opens a database at
 * import time and cannot be loaded by `node --experimental-strip-types`, so
 * anything living beside the server functions is only ever tested through a
 * running server. These are arithmetic over plain values -- the same split
 * `desk-drafts.ts` and `headline-control.ts` already use.
 */

/** What one press of "Show 25 more" adds. Named here so the four screens and
 *  this module cannot drift apart about it. */
export const PAGE_SIZE = 25;

/**
 * The most rows one request may ask for.
 *
 * Not a design rule -- a bound on the request. A caller that asks for more than
 * this is asking for the whole list back under another name, which is the thing
 * the window exists to stop; the screens never ask for more than 25 at a time
 * and grow by 25, so this is only ever reached by a hand-made request.
 */
export const WINDOW_MAX = 1000;

/** The longest search string the desk will carry. A search box, not a query. */
export const SEARCH_MAX = 200;

export type ListFilterWindow<F extends string> = {
  /** How many rows to return, at most. */
  limit: number;
  /** How many matching rows to skip. */
  offset: number;
  /** The search box's text, trimmed; "" when the box is empty. */
  search: string;
  /** Which filter pill is on, always one of `filters`. */
  filter: F;
};

function whole(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read a screen's window request, whatever the caller sent.
 *
 * Every field is optional and every field is clamped, so a hand-made request
 * cannot make the desk return an unbounded list or a negative offset -- the
 * same contract `listScans` has had since P0-4. An unknown filter falls back to
 * `fallback` rather than being trusted, so a URL cannot open a list this screen
 * does not have.
 */
export function cleanListWindow<F extends string>(
  input: unknown,
  filters: readonly F[],
  fallback: F,
): ListFilterWindow<F> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  /*
    A limit that is not a positive whole number is the default page, not zero
    and not one. Nothing on the desk ever asks for a single row, and a request
    for 0 rows is a request for the list to be empty, which the screens have
    other words for; handing back 1 row would draw a footer promising 25 more
    above a table of one.
  */
  const wanted = whole(raw.limit, PAGE_SIZE);
  const limit = wanted > 0 ? Math.min(wanted, WINDOW_MAX) : PAGE_SIZE;
  const offset = Math.max(whole(raw.offset, 0), 0);
  const search = typeof raw.search === "string" ? raw.search.trim().slice(0, SEARCH_MAX) : "";
  const filter = filters.includes(raw.filter as F) ? (raw.filter as F) : fallback;
  return { limit, offset, search, filter };
}

/**
 * The window off a list that has already been filtered.
 *
 * `total` is the number of rows the filter matched, not the number returned --
 * it is what the footer's "Showing 25 of 1,588" and the pills both read, so it
 * has to count the whole list and not the page.
 */
export function takeWindow<T>(
  rows: readonly T[],
  offset: number,
  limit: number,
): { rows: T[]; total: number } {
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

/** How the footer says it: "Showing 25 of 1,588 suggested sources." */
export function showingLine(shown: number, total: number, noun: string): string {
  if (total === 0) return "";
  const from = Math.min(shown, total);
  return `Showing ${from.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`;
}
