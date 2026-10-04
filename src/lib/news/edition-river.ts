import type { StoryArea } from "../story-area.ts";

/** Latest stories belongs to the same ground as the edition above it. */
export function editionRiverQuery(area: StoryArea, limit: number, exclude: number[]) {
  return { area, limit, exclude };
}
