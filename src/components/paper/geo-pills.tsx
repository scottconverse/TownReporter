import { Link } from "@tanstack/react-router";
import { AREA_PILLS, HOME_AREA, type StoryArea } from "@/lib/story-area";

/**
 * The geography switch: Longmont · Nearby · Boulder County · Colorado, in that
 * order everywhere.
 *
 * Ported from `design-system/components/paper/GeoPills.jsx`, which draws the
 * home ground pressed. Unit BD departed from the prototype here -- its report
 * argued that an ink-filled pill on an unfiltered page would print a filtered
 * state, so no pill was pressed until a reader chose one. Unit BD2 follows the
 * design instead, and makes the claim true rather than decorative: the front
 * page's unfiltered read IS the home town's read (`area: deps.area ??
 * HOME_AREA` in `src/routes/index.tsx`), which is the same set of stories a
 * null stored area already meant (`readStoryArea`: null is the home town). So
 * the pressed pill and the page agree, and the home pill's href carries no
 * `?area=` because home is what the front page is without one.
 *
 * Each pill is 44px minimum: the row is the paper's primary navigation and it
 * is held to the tap target the rest of the design system uses.
 */
export function GeoPills({
  active,
  search,
}: {
  /** The ground on the paper; defaults to the home town, which is the default read. */
  active?: StoryArea;
  /** The rest of the front page's search, so a pill does not drop the reader's filters. */
  search?: Record<string, unknown>;
}) {
  const pressed = active ?? HOME_AREA;
  return (
    <div className="geopills" role="group" aria-label="Geography">
      {AREA_PILLS.map((pill) => {
        const on = pill.key === pressed;
        const home = pill.key === HOME_AREA;
        return (
          <Link
            key={pill.key}
            to="/"
            search={{ ...search, area: home ? undefined : pill.key, page: undefined }}
            aria-current={on ? "page" : undefined}
            className={on ? "geopill on" : "geopill"}
          >
            {pill.label}
          </Link>
        );
      })}
    </div>
  );
}
