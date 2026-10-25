import type { QueryClient } from "@tanstack/react-query";

/*
  THE DRAFTS NUMBER, COUNTED ONCE (D2).

  The side nav counts drafts in its own request (["drafts-desk","count"]), and
  the Drafts screen counts the same rows again in its list request's "All" pill.
  Two requests answer at two moments, so right after a reload the nav and the
  page could print two different numbers for the same list until the slower one
  landed. The nav now takes the list's own count whenever the list has one, which
  is the number the page prints under "All" -- one count on screen, not two.

  `DRAFTS_NAV_COUNT_KEY` is what the shell's count query uses, so the writer and
  the reader of that cache entry cannot drift. It lives under the shared
  ["drafts-desk"] prefix, which keeps every invalidation reaching it.
*/

/** The nav's Drafts count key. The ["drafts-desk"] prefix keeps invalidations reaching it. */
export const DRAFTS_NAV_COUNT_KEY = ["drafts-desk", "count"] as const;

/**
 * Hand the list's own count to the nav.
 *
 * A list that has not answered yet has no number to hand over (`undefined`), and
 * a made-up 0 would be the very thing this replaces -- so only a real count is
 * written.
 */
export function shareDraftsCountWithNav(qc: QueryClient, all: number | undefined): void {
  if (typeof all !== "number" || !Number.isFinite(all)) return;
  qc.setQueryData(DRAFTS_NAV_COUNT_KEY, all);
}

/**
 * A pill's number, or null while no list has been counted.
 *
 * The pills used to print `counts?.[key] ?? 0`, so a list that had not arrived
 * yet said "All · 0" -- a confident number nobody had counted, next to a nav
 * that might say otherwise. Null means "no number yet", and the pill prints its
 * word alone.
 */
export function draftPillCount<K extends string>(
  counts: Partial<Record<K, number>> | undefined,
  key: K,
): number | null {
  const n = counts?.[key];
  return typeof n === "number" ? n : null;
}
