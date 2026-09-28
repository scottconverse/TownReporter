/**
 * What the Queue shows, and in what order.
 *
 * WHY HERE AND NOT IN THE ROUTE. The Queue's list used to be narrowed in the
 * component: the screen fetched every lead and then filtered, searched,
 * section-narrowed and sorted in the browser. Unit CZ-long-lists puts a window
 * on the list -- the first 25 rows, then one more page per press -- and a
 * window cut BEFORE the filter pages the unfiltered list and shows the wrong
 * rows. So the narrowing moved to the server, which means it had to leave the
 * route: `src/lib/news/desk.ts` opens a database at import time and cannot be
 * loaded by `node --experimental-strip-types`, and this is the rule that
 * decides which leads an editor sees. It lives here where a test can pin it,
 * the same split `desk-drafts.ts` and `published-rows.ts` already use.
 *
 * The order the steps are applied in IS the rule and is preserved exactly as
 * the route applied it: the tab, then the search box, then the section select,
 * then the sort. Anything else changes which rows a page contains.
 */
import { nearDuplicate, openLeads } from "./desk-copy.ts";
import { cleanListWindow, type ListFilterWindow } from "./list-window.ts";

/**
 * The drawn tab set (README "3. Queue"), named here because the server has to
 * know which tabs exist before it will answer one: a request for a tab this
 * screen does not have gets "open" back rather than an empty page. The route's
 * own tab strip reads the same list, so the two cannot drift.
 */
export const QUEUE_FILTERS = ["open", "held", "killed", "printed", "all"] as const;

export type QueueFilter = (typeof QUEUE_FILTERS)[number];

/** Sort: Best first is the score the scanner gave; the other two are the age
 *  of the lead, for an editor who came back after a day away. */
export const QUEUE_SORTS = ["best", "newest", "oldest"] as const;

export type QueueSort = (typeof QUEUE_SORTS)[number];

/**
 * The most rows a section name may be. A section key, not a sentence -- the
 * bound is here so a hand-made request cannot make the desk compare a
 * kilobyte against every row's topic.
 */
export const SECTION_MAX = 64;

/** The facts about one lead this module reads. A lead carries twenty columns;
 *  these are the ones that decide where it lands. */
export type QueueLead = {
  id: number;
  status: string;
  headline: string;
  why: string | null;
  topic: string | null;
  newsworthiness: number | null;
  created_at: string;
  last_resurfaced_at?: string | null;
};

/** A printed story, as `nearDuplicate` reads it. */
export type QueuePrinted = {
  slug: string;
  headline: string;
  topic?: string;
  published_at: string;
};

/** The Queue's window plus the two controls the shared window does not carry. */
export type QueueWindow = ListFilterWindow<QueueFilter> & {
  /** The section select's value, or "all". */
  section: string;
  sort: QueueSort;
};

/**
 * Read the Queue's window request, whatever the caller sent.
 *
 * The limit, offset, search and tab come from `cleanListWindow`, which clamps
 * every field; the section and sort are clamped here the same way, so an
 * unknown sort is "best" rather than a crash and a nonsense section is "all"
 * rather than a filter that matches nothing.
 */
export function cleanQueueWindow(input: unknown): QueueWindow {
  const base = cleanListWindow(input, QUEUE_FILTERS, "open");
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const section =
    typeof raw.section === "string" && raw.section.trim()
      ? raw.section.trim().slice(0, SECTION_MAX)
      : "all";
  const sort = QUEUE_SORTS.includes(raw.sort as QueueSort) ? (raw.sort as QueueSort) : "best";
  return { ...base, section, sort };
}

/** The search box's text as the comparison uses it: trimmed, folded. */
export function queueNeedle(search: string): string {
  return search.trim().toLowerCase();
}

/** Does this lead match the search box? The headline, the why-now and the
 *  section, which is what the box's placeholder promises. */
export function queueMatchesSearch(lead: QueueLead, needle: string): boolean {
  if (!needle) return true;
  return `${lead.headline} ${lead.why ?? ""} ${lead.topic ?? ""}`.toLowerCase().includes(needle);
}

/** The leads the desk already matches to a piece that ran -- the "≈ Printed"
 *  tab. The same `nearDuplicate` the row's chip and "Kill as duplicate" use. */
export function queuePrintedMatches<T extends QueueLead>(
  leads: readonly T[],
  printed: readonly QueuePrinted[],
): T[] {
  return leads.filter(
    (lead) => nearDuplicate({ headline: lead.headline, topic: lead.topic ?? undefined }, printed) !== null,
  );
}

export type QueueCounts = {
  /** The Open tab: not killed, not published. */
  open: number;
  held: number;
  killed: number;
  /** The "≈ Printed" tab. */
  printed: number;
  /** Every lead the newsroom holds, which is what the All tab shows. */
  all: number;
  /** Leads whose status is `published`. Not a tab -- the empty Queue's copy
   *  offers Published as a door when there is something behind it. */
  publishedLeads: number;
};

/**
 * The tab strip's numbers, counted over EVERY lead rather than over the page.
 *
 * This is the whole point of counting on the server: a count taken over the 25
 * rows on screen would make "All" read 25 the moment a window appeared, and an
 * editor would read the page size as the size of their queue.
 */
export function queueCounts(
  leads: readonly QueueLead[],
  printed: readonly QueuePrinted[],
): QueueCounts {
  const byStatus = (status: string) => leads.filter((lead) => lead.status === status).length;
  return {
    open: openLeads(leads).length,
    held: byStatus("held"),
    killed: byStatus("killed"),
    printed: queuePrintedMatches(leads, printed).length,
    all: leads.length,
    publishedLeads: byStatus("published"),
  };
}

/**
 * The rows one page of the Queue holds, in the order the screen draws them.
 *
 * The steps run in the order the route ran them before the window moved to the
 * server: tab, then search, then section, then sort. The sort is applied last
 * and to a copy, because a sort that ran before the filter would still give
 * the right rows but a different page boundary.
 */
export function queueSelect<T extends QueueLead>(
  leads: readonly T[],
  printed: readonly QueuePrinted[],
  window: Pick<QueueWindow, "filter" | "section" | "sort"> & { needle: string },
): T[] {
  const { filter, section, sort, needle } = window;
  const byFilter =
    filter === "killed"
      ? leads.filter((lead) => lead.status === "killed")
      : filter === "held"
        ? leads.filter((lead) => lead.status === "held")
        : filter === "printed"
          ? queuePrintedMatches(leads, printed)
          : filter === "open"
            ? openLeads(leads)
            : leads;
  const bySearch = byFilter.filter((lead) => queueMatchesSearch(lead, needle));
  const filtered = section === "all" ? bySearch : bySearch.filter((lead) => lead.topic === section);
  return queueSort(filtered, sort, filter);
}

/**
 * The Queue's three orders.
 *
 * "Best" is the score the scanner gave, and on the Killed tab it means
 * something else: what keeps coming back belongs on top there, which is the
 * whole point of stamping a resurfaced lead instead of quietly hiding it.
 * Leads never resurfaced (`last_resurfaced_at` null) sort after ones that
 * have, oldest kill first within that group.
 */
export function queueSort<T extends QueueLead>(
  leads: readonly T[],
  sort: QueueSort,
  filter: QueueFilter,
): T[] {
  const byAge = (a: T, b: T) =>
    sort === "newest"
      ? Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id
      : Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;
  if (sort === "best" && filter === "killed") {
    return [...leads].sort((a, b) => {
      const at = a.last_resurfaced_at ? Date.parse(a.last_resurfaced_at) : -1;
      const bt = b.last_resurfaced_at ? Date.parse(b.last_resurfaced_at) : -1;
      if (at !== bt) return bt - at;
      return b.id - a.id;
    });
  }
  return [...leads].sort(
    sort === "best" ? (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0) : byAge,
  );
}
