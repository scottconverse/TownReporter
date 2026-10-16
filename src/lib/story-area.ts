/**
 * The four grounds a printed story can stand on, and the words the paper uses
 * for them.
 *
 * The order is the design system's, not an accident: Longmont, then Nearby,
 * Boulder County, Colorado, "in that order everywhere: pills, sections and
 * rails" (`design-system/README.md`, principle 1). The geography pill row, the
 * "Around the region" band and the desk's select all read this one list, so the
 * order cannot drift between them.
 *
 * This file is imported by the browser bundle (the pill row and the desk
 * select), so it holds no database code. `story-area.server.ts` holds the
 * mirror of migration 0098 that PGLite needs.
 */

import { isLongmont, type NewsroomPlace } from "./news/dark-place.ts";

/** The stored value on `articles.area`. Stable keys; the labels are display. */
export const STORY_AREAS = ["longmont", "nearby", "county", "colorado"] as const;
export type StoryArea = (typeof STORY_AREAS)[number];

/** The value the paper reads as the home town. */
export const HOME_AREA: StoryArea = "longmont";

/**
 * What each ground is called on the paper and in the desk.
 *
 * `nearby` is deliberately not a town name: the column records which ground a
 * story stands on, and a nearby story's own town is in its headline ("Lyons
 * trustees post draft water rate study"). Naming a town here would be the paper
 * asserting one the row does not carry.
 *
 * These are the SHIPPED paper's words (Longmont, Colorado). They are the
 * fallback for the default identity and the labels `story-area.test.ts` covers;
 * anything a reader sees goes through `areaLabelsFor` below, because a paper
 * configured for another town must not print this town's geography. That was a
 * real leak: phase 1's pill row read this constant directly, so a Riverbend,
 * Ohio paper printed `Longmont · Nearby · Boulder County · Colorado` on its
 * masthead while its title, h1 and footer all said Riverbend
 * (`src/lib/news/paper-identity.e2e.test.ts`).
 */
export const AREA_LABELS: Record<StoryArea, string> = {
  longmont: "Longmont",
  nearby: "Nearby",
  county: "Boulder County",
  colorado: "Colorado",
};

/** The words for the four grounds on one particular paper. */
export type AreaLabels = Record<StoryArea, string>;

/**
 * The four grounds in the CONFIGURED paper's own words.
 *
 * The home ground and the state ground are the paper's own `city`/`state`
 * (its identity, fetched once per page load and threaded down as context), so a
 * configured paper names itself and never the shipped default's town.
 *
 * The county ground is a `dark_settings.county` setting, which is server-side
 * and not on the public identity, so this takes it as an argument and, with
 * none configured, names the GROUND rather than a county: "County" beside
 * "Nearby" is the same kind of word -- which part of the map a story stands on
 * -- and asserting "Boulder County" on a paper that has never been told its
 * county would be the leak again in a different costume.
 */
export function areaLabelsFor(
  paper: { city: string; state: string },
  county?: string | null,
): AreaLabels {
  const countyName = (county ?? "").trim();
  return {
    longmont: paper.city.trim(),
    nearby: "Nearby",
    county: countyName || "County",
    colorado: paper.state.trim(),
  };
}

/**
 * Whether this paper has a geography to offer at all.
 *
 * An install that has not been through first-run setup has no city and no
 * state (`UNCONFIGURED_PAPER_CONFIG`), so its pill row and its region labels
 * would be empty or generic words for a paper that has not said where it is.
 * The front page prints no geography row in that state -- the same honest
 * "not set up" answer the rest of the page gives.
 */
export function hasGeography(paper: { city: string; state: string }): boolean {
  return paper.city.trim().length > 0;
}

/** The pill row, in print order, from a paper's own labels. */
export function areaPills(
  labels: AreaLabels,
): readonly { key: StoryArea; label: string }[] {
  return STORY_AREAS.map((key) => ({ key, label: labels[key] }));
}

/**
 * The stored value for a row that has no area, or for a value this release does
 * not know.
 *
 * Null is the home town by the owner's rule (2026-09-26: "Stories with no area
 * count as the home town"), and every story printed before 0098 is null. An
 * unrecognized value reads as the home town too, rather than vanishing from
 * every pill: a story that is on the paper is always reachable from the front
 * page, which is the promise the pills make.
 */
export function readStoryArea(raw: string | null | undefined): StoryArea {
  const value = (raw ?? "").trim().toLowerCase();
  return (STORY_AREAS as readonly string[]).includes(value) ? (value as StoryArea) : HOME_AREA;
}

/**
 * The stored value for a value the editor or an import supplied, or null when
 * it is not one of the four.
 *
 * The desk's select only offers the four, and an import may carry anything, so
 * this refuses rather than coerces: storing an unrecognized string would put a
 * row in a bucket no pill can reach.
 */
export function cleanStoryArea(raw: unknown): StoryArea | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (STORY_AREAS as readonly string[]).includes(value) ? (value as StoryArea) : null;
}

/**
 * The towns the "Nearby" ground covers, as the shipped paper names them. A
 * story whose headline or body names one of them (and not the home town, and
 * not the county) stands on Nearby. Matched whole-word and case-sensitively, so
 * "superior court" in lower case is not a town.
 *
 * This list belongs to the shipped Longmont, Colorado paper only. A paper
 * configured for another town has no Nearby towns, and `defaultStoryArea` never
 * reads this list for it (the Riverbend, Ohio leak).
 */
export const NEARBY_TOWNS: readonly string[] = [
  "Boulder",
  "Broomfield",
  "Berthoud",
  "Dacono",
  "Erie",
  "Firestone",
  "Frederick",
  "Lafayette",
  "Louisville",
  "Lyons",
  "Mead",
  "Nederland",
  "Niwot",
  "Superior",
];

function namesPlace(text: string, place: string): boolean {
  const name = place.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * Whether the text names this paper's county. The configured county, when Paper
 * setup has one, is "<County> County". The shipped Longmont paper also keeps
 * its literal "Boulder County" (`isLongmont`), so no other paper ever matches it.
 */
function namesCounty(text: string, place: NewsroomPlace): boolean {
  const configured = (place.county ?? "").trim();
  if (configured && namesPlace(text, `${configured} County`)) return true;
  return isLongmont(place) && namesPlace(text, "Boulder County");
}

function groundNamedIn(text: string, place: NewsroomPlace): StoryArea | null {
  if (namesPlace(text, place.city)) return HOME_AREA;
  if (namesCounty(text, place)) return "county";
  if (isLongmont(place) && NEARBY_TOWNS.some((town) => namesPlace(text, town))) return "nearby";
  return null;
}

/**
 * The ground a story stands on, from the place its own words name (TOB-2).
 *
 * The headline is read first, then the body. A story naming the paper's own
 * city is home (for any paper); one naming the paper's county is county; one
 * naming a Nearby town is nearby, and only the shipped Longmont paper has Nearby
 * towns. A story that names none of them returns null, which the page and the
 * publish step both read as the home town -- the same stored value as before --
 * so a story is never filed under a town its words do not name.
 *
 * `paper.county` is the configured county name when the caller has it (Paper
 * setup), and is omitted or null when it does not.
 */
export function defaultStoryArea(
  story: { headline: string; body: string },
  paper: { city?: string | null; state?: string | null; county?: string | null },
): StoryArea | null {
  // `getPaperPlace` types its fields as optional (lead-match.ts); a blank city
  // names nothing, so a missing field reads as the empty string here.
  const place: NewsroomPlace = {
    city: paper.city ?? "",
    state: paper.state ?? "",
    county: paper.county ?? null,
  };
  return groundNamedIn(story.headline, place) ?? groundNamedIn(story.body, place);
}
