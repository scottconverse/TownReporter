import type { QueryClient } from "@tanstack/react-query";

/*
  The Drafts number, one source on screen (G23-QA-6).

  The side nav counts drafts under ["drafts-desk","count"] with its own request,
  and the Drafts page counts the same rows in the "All" pill from its list
  request. Two requests answer at two moments, so right after a reload the page
  and the nav disagreed until the slower one landed -- and the page printed
  "All . 0" in the meantime, a confident number nobody had counted.
*/

/** The nav's Drafts count key. The shared ["drafts-desk"] prefix keeps every invalidation reaching it. */
export const DRAFTS_NAV_COUNT_KEY = ["drafts-desk", "count"] as const;

/**
 * The list request already counted every draft ("All"); hand that number to the
 * nav so the two cannot disagree. Ignores a list that has not arrived.
 */
export function shareDraftsCountWithNav(qc: QueryClient, all: number | undefined): void {
  if (typeof all !== "number") return;
  qc.setQueryData(DRAFTS_NAV_COUNT_KEY, all);
}

/** A pill's number, or null while the list has not been counted (never a made-up 0). */
export function draftPillCount(
  counts: Record<string, number> | undefined,
  key: string,
): number | null {
  const n = counts?.[key];
  return typeof n === "number" ? n : null;
}
