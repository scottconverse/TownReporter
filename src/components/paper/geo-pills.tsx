import { Link } from "@tanstack/react-router";
import { areaPills, hasGeography, HOME_AREA, type StoryArea } from "@/lib/story-area";
import { useAreaLabels, usePaper } from "@/lib/paper-context-state";

/**
 * The geography switch: home town · Nearby · County · State, in that order
 * everywhere.
 *
 * The words are the CONFIGURED paper's (the home pill is its own city and the
 * last pill its own state: `useAreaLabels` -> `areaLabelsFor`), which is what
 * the design shows for Longmont's paper ("Longmont / Nearby / Boulder County /
 * Colorado", `design/Front Daily.dc.html:24-27`) and what phase 1 got wrong:
 * it printed that list to every paper, so a Riverbend, Ohio install showed
 * Longmont's geography under a Riverbend masthead.
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
  const paper = usePaper();
  const labels = useAreaLabels();
  /*
    The pill row is the configured paper's geography, and a paper that has not
    been set up has none (see `hasGeography`): rendering "Nearby / County" over
    an install that has never named its town would be the masthead making up a
    geography, and rendering the shipped default's four would be the leak this
    row caused before (`src/lib/news/paper-identity.e2e.test.ts`: an
    unconfigured install must not claim to be Longmont's paper anywhere).
  */
  if (!hasGeography(paper)) return null;
  const pressed = active ?? HOME_AREA;
  return (
    <div className="geopills" role="group" aria-label="Geography">
      {areaPills(labels).map((pill) => {
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
