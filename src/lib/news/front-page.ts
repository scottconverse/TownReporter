/** The front page's fixed shape: one lead, two beside it, four in the numbered list. */
export const TOP_STORIES = 7;
export const FRONT_PAIR = 2;
export const MORE_TOP_STORIES = 4;
export const RIVER_BATCH = 6;

export type FrontStorySlot = { id: number };

export function topStorySlots<T extends FrontStorySlot>(stories: readonly T[]) {
  return {
    lead: stories[0],
    pair: stories.slice(1, 1 + FRONT_PAIR),
    more: stories.slice(1 + FRONT_PAIR, TOP_STORIES),
  };
}

/** The four cards in MORE TOP STORIES, carrying the visible 1..4 they print. */
export function numberedMoreTopStories<T extends FrontStorySlot>(stories: readonly T[]) {
  return topStorySlots(stories).more.map((story, index) => ({ ...story, number: index + 1 }));
}

/**
 * Every story slot the front page prints, in document order. The renderer uses
 * the same partition, so this also states the no-repeat invariant the page owes.
 */
export function frontPageStoryIds<T extends FrontStorySlot>({ top, river, opinion }: {
  top: readonly T[];
  river: readonly T[];
  opinion?: T;
}) {
  return [
    ...top.slice(0, TOP_STORIES).map((story) => story.id),
    ...river.slice(0, RIVER_BATCH).map((story) => story.id),
    ...(opinion ? [opinion.id] : []),
  ];
}

export function frontPageHasNoRepeatedStory(ids: readonly number[]): boolean {
  return new Set(ids).size === ids.length;
}
