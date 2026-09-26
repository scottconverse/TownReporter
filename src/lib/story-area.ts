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
 */
export const AREA_LABELS: Record<StoryArea, string> = {
  longmont: "Longmont",
  nearby: "Nearby",
  county: "Boulder County",
  colorado: "Colorado",
};

/** The pill row's labels, in print order. */
export const AREA_PILLS: readonly { key: StoryArea; label: string }[] = STORY_AREAS.map((key) => ({
  key,
  label: AREA_LABELS[key],
}));

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
