/**
 * The Editor's Desk left navigation, as data (unit U24).
 *
 * It lives here rather than inside `components/desk-chrome.tsx` for the
 * codebase's usual reason: the shell is a React module that opens contexts and
 * icons at import time, so a rule stated in it can only ever be tested through
 * a running browser. What is worth pinning is small and worth pinning exactly
 * -- that every drawn screen has a drawn path to it, that no two items offer
 * the same destination twice, and which item is current on which URL -- and all
 * three are plain data.
 *
 * CY item 6: `count` is drawn on five of the items -- Queue, Drafts, Opinion,
 * Follow-ups and Dark Desk (Desk Nav.dc.html:56) -- and every one of them is a
 * number a desk screen already prints, computed by that screen's own rule
 * rather than a second one invented here (see `counts` in the shell). Published
 * is drawn blank, so it carries none.
 */

export type DeskNavItem = {
  to: string;
  label: string;
  /** Active only on an exact path match — the page the item names. */
  exact?: boolean;
  /** A hash the link carries, when two items share one route. */
  hash?: string;
  /**
   * Drawn indented under the item above it.
   *
   * A sub-item is a second screen that belongs to the one above: it is a real
   * destination with its own controls, and the item above it is the thing an
   * editor would look under for it.
   */
  sub?: boolean;
};

export const DESK_NAV: readonly DeskNavItem[] = [
  { to: "/desk", label: "Today", exact: true },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/drafts", label: "Drafts" },
  { to: "/desk/published", label: "Published" },
  { to: "/desk/opinion", label: "Opinion" },
  { to: "/desk/follow-ups", label: "Follow-ups" },
  { to: "/desk/dark", label: "Dark Desk" },
  { to: "/desk/sources", label: "Sources & scan" },
  { to: "/desk/ops", label: "Models", hash: "writing-models" },
  { to: "/desk/ops", label: "Server" },
  { to: "/desk/stats", label: "Stats" },
] as const;

/**
 * Routes the shell does not draw as nav items.
 *
 * They are still reachable: this list is what Ctrl K's palette can find and
 * navigate to, which is the design's own "find anything" mechanism. Not drawn
 * in the footer -- BF3 removed those links, and the capture has none.
 *
 * Scan history is reached from the Sources header and remains in the palette.
 */
export const DESK_MORE: readonly { to: string; label: string }[] = [
  { to: "/desk/scan", label: "Scan history" },
  { to: "/desk/import", label: "Import" },
  { to: "/desk/memory", label: "Beat memory" },
  { to: "/desk/legal-removals", label: "Legal removals" },
] as const;

/**
 * Search pages list. The old one read `LINKS`, so a rebuilt nav with new
 * routes and new words silently changed what "Find a story or screen" could
 * find; this is the same list the nav draws, plus the screens that are only in
 * the palette.
 */
export const SEARCH_PAGES = [...DESK_NAV, ...DESK_MORE].map((l) => ({
  to: l.to,
  label: l.label,
}));

/** Every destination the nav offers, drawn or not, for the tripwire below. */
export const DESK_PATHS: readonly string[] = [...new Set(SEARCH_PAGES.map((p) => p.to))];

/**
 * Which nav item is current. `pathname` alone cannot answer it, because Models
 * and Server are the same route; the hash decides between them when there is
 * one, and Server — the page — wins when there is not.
 */
export function navItemIsActive(item: DeskNavItem, pathname: string, hash: string) {
  const path = item.to;
  const onPath = item.exact
    ? pathname === path
    : pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  if (path !== "/desk/ops") return true;
  const wantHash = `#${item.hash ?? ""}`;
  return item.hash ? hash === wantHash : hash !== "#writing-models";
}
