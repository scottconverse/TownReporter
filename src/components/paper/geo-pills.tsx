import { Link } from "@tanstack/react-router";
import { AREA_PILLS, type StoryArea } from "@/lib/story-area";

/**
 * The geography switch: Longmont · Nearby · Boulder County · Colorado, in that
 * order everywhere.
 *
 * Ported from `design-system/components/paper/GeoPills.jsx`. The prototype's
 * `hrefFor` is a string builder; here the pills are router links that set the
 * front page's `area` search parameter, because the filter is the archive
 * query's own predicate and not a separate page (migration 0098, 0.6.71).
 *
 * "No pill pressed" is the whole paper, and the *home* pill is a filter that
 * matches a null stored area as the home town. Those are two different reads,
 * so pressing Longmont is not the same as pressing nothing, and the row says
 * so: the front page renders it with `active` unset until a reader chooses.
 * See `readStoryArea` for why null is the home town.
 *
 * Each pill is 44px minimum: the row is the paper's primary navigation and it
 * is held to the tap target the rest of the design system uses.
 */
export function GeoPills({
  active,
  search,
}: {
  /** The pressed pill, or undefined for "the whole paper". */
  active?: StoryArea;
  /** The rest of the front page's search, so a pill does not drop the reader's filters. */
  search?: Record<string, unknown>;
}) {
  return (
    <div className="geopills" role="group" aria-label="Geography">
      {AREA_PILLS.map((pill) => {
        const on = pill.key === active;
        return (
          <Link
            key={pill.key}
            to="/"
            search={{ ...search, area: pill.key, page: undefined }}
            aria-current={on ? "page" : undefined}
            className={on ? "geopill on" : "geopill"}
          >
            {pill.label}
          </Link>
        );
      })}
      {/*
        The way back to the whole paper. A pill row with no off switch would
        leave a reader who pressed Colorado unable to see Longmont again
        without editing the address, and the home pill is a filter, not a
        reset.
      */}
      {active ? (
        <Link to="/" search={{ ...search, area: undefined, page: undefined }} className="geopill clear">
          Everywhere
        </Link>
      ) : null}
    </div>
  );
}
