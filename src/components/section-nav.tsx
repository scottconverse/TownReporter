import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

/**
 * The paper's section navigation, on one line (unit BD5).
 *
 * The owner's report, with the staged data beside the design capture: the real
 * paper publishes 21 sections and the front page drew them over three lines at
 * 1280, and the article page drew them over two, under the wordmark. Both
 * prototypes -- `docs/design/handoff-2026-09-26/design/Front Daily.dc.html`
 * (the nav under the masthead) and `Article Daily.dc.html` (the nav on the
 * masthead row, beside the wordmark) -- draw one row.
 *
 * A paper cannot make a promise about how many sections it will publish, so
 * the row is FITTED rather than counted: as many sections as the row has room
 * for, in the paper's own order, and a "More sections" button for the rest.
 * The measurement is taken against the real links in the browser, so a longer
 * section name or a larger text size moves the cut instead of overflowing the
 * line; a fixed count would have been right for one paper on one day.
 *
 * Below `NAV_FIT_MIN_WIDTH` there is no fitted row at all: the sections are
 * the reader menu the paper already had ("Explore the publication"), which
 * prints every one of them.
 */

/**
 * What the server renders before anything has been measured. Deliberately
 * small: a row that is too short settles upward to the real fit, while a row
 * that is too long would paint overflowing before the measure corrected it.
 */
export const NAV_SAFE_COUNT = 5;

/**
 * The width at which the fitted row replaces the reader menu. It matches the
 * `@media (min-width: 900px)` block in reader-astra.css that turns the row
 * into one non-wrapping line -- the two have to agree, or the component would
 * measure a row the stylesheet has not made measurable yet.
 */
export const NAV_FIT_MIN_WIDTH = 900;

/**
 * The nav's element id. The reader menu ("Explore the publication") points at
 * it with `aria-controls`, so it is the nav's to own -- one masthead renders
 * per page, so there is exactly one.
 */
export const NAV_ID = "reader-sections";

/** One section, as the nav needs it: what it is called and which topic it is. */
export type NavSection = { key: string; name: string };

type Item = {
  key: string;
  name: string;
  /** The `topic` search param, or undefined for the "Front page" entry. */
  topic?: string;
  active: boolean;
};

/** How much of the row the links take, measured once per set of links. */
type RowMetrics = { widths: number[]; gap: number; more: number };

export function SectionNav({
  sections,
  activeTopic,
  frontPageActive = false,
  includeFrontPage = false,
  menuOpen = false,
}: {
  sections: NavSection[];
  /** The section the reader is on, if any. */
  activeTopic?: string;
  /** Whether the unfiltered front page is the current view. */
  frontPageActive?: boolean;
  /** Print "Front page" ahead of the sections (the front page's own nav). */
  includeFrontPage?: boolean;
  /**
   * Whether the reader menu ("Explore the publication") is open. Below
   * `NAV_FIT_MIN_WIDTH` this nav IS that menu, opened by the button beside it,
   * so the class lives here rather than on a second nav element.
   */
  menuOpen?: boolean;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (includeFrontPage) {
      out.push({ key: "__front", name: "Front page", active: frontPageActive });
    }
    for (const section of sections) {
      out.push({
        key: section.key,
        name: section.name,
        topic: section.key,
        active: section.key === activeTopic,
      });
    }
    return out;
  }, [sections, includeFrontPage, frontPageActive, activeTopic]);

  const [count, setCount] = useState(() => Math.min(NAV_SAFE_COUNT, items.length));
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /*
    The links' own widths, in px, and the gap between them. Both are properties
    of the text, not of the row: the row only decides how many of them fit. So
    they are measured once per set of links (and once more when the webfonts
    land, which changes every one of them) and the resize path is then pure
    arithmetic -- no un-hiding, no layout of anything below the row.
  */
  const metrics = useRef<RowMetrics>({ widths: [], gap: 0, more: 0 });

  /** Measure the links on one line, wherever the row currently cuts them. */
  const measureLinks = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const nodes = Array.from(nav.querySelectorAll<HTMLElement>("[data-navitem]"));
    if (!nodes.length) return;
    /*
      `hidden` on the tail is what makes the cut; it is also `display: none`,
      so a hidden link reports a width of zero. The attribute is therefore
      flipped off for this synchronous pass and put straight back: nothing is
      painted in between (a layout effect runs before the browser paints), a
      ResizeObserver sees the same box it saw before, and React's next diff
      reads back exactly the values it wrote, so it has nothing to correct.
    */
    const was = nodes.map((node) => node.hidden);
    for (const node of nodes) node.hidden = false;
    metrics.current.widths = nodes.map((node) => node.getBoundingClientRect().width);
    metrics.current.gap = Number.parseFloat(getComputedStyle(nav).columnGap) || 0;
    nodes.forEach((node, index) => {
      node.hidden = was[index] ?? false;
    });
    /*
      The button's width, kept from the last time it was on screen. It is only
      rendered while there is something left over, which is exactly when the
      fit has to reserve room for it -- so it is on screen in the same commit
      that first needs it.
    */
    const more = moreRef.current?.getBoundingClientRect().width ?? 0;
    if (more > 0) metrics.current.more = more;
  }, []);

  /** How many of the links fit, reserving the button when there are leftovers. */
  const appliedCount = useCallback(() => {
    const nav = navRef.current;
    if (!nav || items.length === 0) return items.length;
    const { widths, gap, more } = metrics.current;
    if (widths.length !== items.length) return count;
    const room = nav.getBoundingClientRect().width;
    /** The largest prefix that fits inside `limit`. */
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
    const bare = prefix(room);
    if (bare === widths.length) return items.length;
    // Room for the button as well as the links it stands for.
    return Math.max(1, prefix(room - gap - more));
  }, [count, items.length]);

  /** Re-cut the row for the width it has now. */
  const refit = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const wide = window.matchMedia(`(min-width: ${NAV_FIT_MIN_WIDTH}px)`).matches;
    // Below the fit there is no cut to make: the reader menu prints them all.
    if (!wide) {
      setCount(items.length);
      return;
    }
    if (metrics.current.widths.length !== items.length) measureLinks();
    setCount(appliedCount());
  }, [appliedCount, items.length, measureLinks]);

  useLayoutEffect(() => {
    refit();
    // The webfonts land after the first measure and change every link's width.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) refit();
    });
    return () => {
      cancelled = true;
    };
  }, [refit]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => refit());
    observer.observe(nav);
    const query = window.matchMedia(`(min-width: ${NAV_FIT_MIN_WIDTH}px)`);
    query.addEventListener("change", refit);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", refit);
    };
  }, [refit]);

  // A disclosure, closed the two ways a reader expects one to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      moreRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (moreRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const rest = items.slice(count);
  const search = (topic?: string) => (topic ? { topic } : {});

  return (
    <>
      <nav
        className={`sections${menuOpen ? " open" : ""}`}
        id={NAV_ID}
        aria-label="News sections"
        ref={navRef}
      >
        {items.map((item, index) => (
          <Link
            key={item.key}
            to="/"
            search={search(item.topic)}
            className={item.active ? "active" : ""}
            data-navitem=""
            hidden={index >= count}
          >
            {item.name}
          </Link>
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            className="moresections"
            ref={moreRef}
            aria-expanded={open}
            aria-controls="more-sections"
            onClick={() => setOpen((value) => !value)}
          >
            More sections <ChevronDown aria-hidden />
          </button>
        )}
      </nav>
      {open && rest.length > 0 && (
        <div className="morepanel" id="more-sections" ref={panelRef}>
          <b>More sections</b>
          {rest.map((item) => (
            <Link
              key={item.key}
              to="/"
              search={search(item.topic)}
              className={item.active ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {item.name}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
