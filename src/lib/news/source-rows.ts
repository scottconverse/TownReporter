/**
 * What the Sources screen shows, and which of its four filters counts what.
 *
 * WHY HERE AND NOT IN THE ROUTE. The watch list is the desk's longest list --
 * 1,588 suggested sources at the time of writing, some 15,872px of rows -- and
 * the screen used to render every one of them. Unit CZ-long-lists puts a
 * window on it: the first 25 rows, then one more page per press. A window cut
 * BEFORE the tab and the search box pages the unfiltered list and shows the
 * wrong rows, so the narrowing moved to the server, which means it had to
 * leave the route: `src/lib/news/desk.ts` opens a database at import time and
 * cannot be loaded by `node --experimental-strip-types`, and this is the rule
 * that decides which sources an editor sees and what the filter pills read.
 * It lives here where a test can pin it, the same split `queue-rows.ts`,
 * `desk-drafts.ts` and `published-rows.ts` already use.
 *
 * THE ORDER IS THE RULE, and is preserved exactly as the route applied it: the
 * tab first, then the search box. The four pills and "On watch" being two
 * statuses are also the rule -- a paused source is still on the watch list,
 * which is why the drawing's paused row offers Resume rather than Accept.
 */
import { cleanListWindow, type ListFilterWindow } from "./list-window.ts";

/**
 * The four filters the drawing draws (README "Sources"). The first three are
 * statuses; `unchecked` is not a status -- a source cannot be "could not
 * check" -- it is the on-watch rows the last pass failed to fetch.
 */
export const SOURCE_TABS = ["accepted", "proposed", "rejected", "unchecked"] as const;

export type SourceTab = (typeof SOURCE_TABS)[number];

/** The facts about one source this module reads. A source row carries twenty
 *  columns; these are the ones that decide which filter shows it. */
export type SourceRowLike = {
  id: number;
  title: string;
  url: string;
  kind: string;
  tier: string;
  status: string;
  last_error: string | null;
  /** The failure streak (migration 0115, unit SH0-1). Optional because a
   *  reader that selects only the watch-list columns has no answer -- and a
   *  missing answer is not a streak, so `keepsFailing` reads it as zero. */
  consecutive_failures?: number | null;
};

/**
 * HOW MANY SCANS IN A ROW BEFORE THE ROW SAYS SOMETHING (SH0-2).
 *
 * Three, because two is a bad afternoon: a site is down for a deploy, a feed
 * is briefly 503, a page times out once -- and the scan runs twice a day, so
 * two failures can be an hour apart. Three consecutive FAILED ATTEMPTS is the
 * first point at which "this is a pattern" is a claim the desk can support,
 * and the label is deliberately about our own failure to read the page, never
 * about the site being broken.
 *
 * ONLY ATTEMPTS COUNT. A source the pass never reached -- past `SCAN_WATCH_CAP`,
 * or outside the sections a section scan selected -- keeps its count frozen
 * rather than advancing, because the desk did not try and cannot report a
 * failure it did not have.
 */
export const KEEPS_FAILING_AFTER = 3;

/**
 * Is this the row that gets the "Keeps failing" flag?
 *
 * TWO CONDITIONS, and the second is the one that is easy to forget: the desk
 * tried and failed at least `KEEPS_FAILING_AFTER` times in a row -- that is
 * what the count means, there is no separate "did it fail" test -- and the
 * source is one the desk is STILL TRYING.
 *
 * A PAUSED SOURCE IS NEVER FLAGGED. Pause means "do not fetch this on a
 * schedule", so a paused row that still carried a streak would be told it
 * "keeps failing" when nothing is being tried at all -- a false sentence, and
 * one that would only ever get falser. `setSourceStatus` clears the count when
 * the status moves, so this guard and that write say the same thing twice on
 * purpose: the write makes it true, the guard keeps it true if anything ever
 * writes around the write.
 *
 * A source with no recorded streak (null, or a row read by a select that did
 * not ask for the column) reads as zero and is never flagged. The desk must not
 * claim a history it did not observe.
 */
export function keepsFailing(source: {
  status: string;
  consecutive_failures?: number | null;
}): boolean {
  if (source.status !== "accepted") return false;
  return (source.consecutive_failures ?? 0) >= KEEPS_FAILING_AFTER;
}

/**
 * "On watch" is two statuses, not one (the route's own note, kept here because
 * moving it would have moved the meaning with it).
 *
 * A paused source is still on the watch list -- it is the same row, held, and
 * the drawing's row carries Resume rather than Accept for exactly that reason.
 * So the On watch pill counts both and shows both, while `watching` below
 * counts only the rows the scanner may actually read (`daily-scan.ts` and
 * `runScan` both ask for `status = 'accepted'`), which is what "Files up to"
 * means.
 */
export function onWatch(source: { status: string }): boolean {
  return source.status === "accepted" || source.status === "paused";
}

/** The Sources window: the shared one, and nothing extra -- this screen has no
 *  section select and no sort of its own. */
export type SourceWindow = ListFilterWindow<SourceTab>;

/** Read the window request, whatever the caller sent. An unknown tab is the
 *  watch list rather than an empty page. */
export function cleanSourceWindow(input: unknown): SourceWindow {
  return cleanListWindow(input, SOURCE_TABS, "accepted");
}

/**
 * Does this source match the search box? The title, the address, the kind and
 * the tier, which is what the box's placeholder promises.
 */
export function sourceMatchesSearch(source: SourceRowLike, needle: string): boolean {
  if (!needle) return true;
  return [source.title, source.url, source.kind, source.tier].some((value) =>
    (value ?? "").toLowerCase().includes(needle),
  );
}

export type SourceCounts = {
  /** The On watch pill: accepted and paused together. */
  accepted: number;
  proposed: number;
  rejected: number;
  /** The Could not check pill: on watch, and the last pass failed to reach it. */
  unchecked: number;
  /** The accepted rows alone -- the number of pages the scanner may read,
   *  which is the Daily scan panel's "Files up to". Not a pill. */
  watching: number;
};

/**
 * The pills' numbers and the panel's one figure, counted over EVERY source.
 *
 * This is the whole point of counting on the server: a count taken over the 25
 * rows on screen would make "Suggested" read 25 the moment a window appeared,
 * and the drawing's own panel promises the size of the watch list, not the
 * size of a page.
 */
export function sourceCounts(sources: readonly SourceRowLike[]): SourceCounts {
  let accepted = 0;
  let proposed = 0;
  let rejected = 0;
  let unchecked = 0;
  let watching = 0;
  for (const source of sources) {
    const watched = onWatch(source);
    if (watched) {
      accepted += 1;
      if (source.last_error != null) unchecked += 1;
    } else if (source.status === "proposed") {
      proposed += 1;
    } else if (source.status === "rejected") {
      rejected += 1;
    }
    if (source.status === "accepted") watching += 1;
  }
  return { accepted, proposed, rejected, unchecked, watching };
}

/**
 * The rows one tab holds, before the search box has been read.
 *
 * "Could not check" SHOWS THE WATCH LIST, narrowed to the rows that carry a
 * fetch error -- the same table with the same actions, because a source that
 * cannot be read may still be worth dropping. It is not a fourth status.
 */
export function sourceTabRows<T extends SourceRowLike>(
  sources: readonly T[],
  tab: SourceTab,
): T[] {
  if (tab === "unchecked") return sources.filter((s) => onWatch(s) && s.last_error != null);
  if (tab === "accepted") return sources.filter((s) => onWatch(s));
  return sources.filter((s) => s.status === tab);
}

/**
 * The rows one page of the Sources list holds, in the order the server sent
 * them (the SQL's own order: proposed first, newest first within it, then
 * accepted, paused and rejected by id).
 *
 * The tab runs before the search, the order the route ran them in.
 */
export function selectSourceRows<T extends SourceRowLike>(
  sources: readonly T[],
  window: Pick<SourceWindow, "filter" | "search">,
): T[] {
  const byTab = sourceTabRows(sources, window.filter);
  const needle = window.search.trim().toLowerCase();
  if (!needle) return byTab;
  return byTab.filter((source) => sourceMatchesSearch(source, needle));
}
