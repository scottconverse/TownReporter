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
};

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
