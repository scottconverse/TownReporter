import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frontPageHasNoRepeatedStory,
  frontPageStoryIds,
  numberedMoreTopStories,
  RIVER_BATCH,
  TOP_STORIES,
  topStorySlots,
} from "./front-page.ts";

const stories = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  slug: `story-${index + 1}`,
}));

test("the top block is one lead, two side-by-side stories, and four numbered stories", () => {
  const slots = topStorySlots(stories);
  assert.deepEqual(
    slots.pair.map((story) => story.id),
    [2, 3],
  );
  assert.deepEqual(
    slots.more.map((story) => story.id),
    [4, 5, 6, 7],
  );
  assert.equal(TOP_STORIES, 7);
});

test("More top stories numbers the four cards in order and keeps their story ids", () => {
  const numbered = numberedMoreTopStories(stories);
  assert.deepEqual(
    numbered.map((story) => story.number),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    numbered.map((story) => story.id),
    [4, 5, 6, 7],
  );
  assert.deepEqual(
    numbered.map((story) => story.slug),
    ["story-4", "story-5", "story-6", "story-7"],
  );
});

test("the front page prints fourteen distinct stories in the normal edition", () => {
  const ids = frontPageStoryIds({
    top: stories.slice(0, TOP_STORIES),
    river: stories.slice(TOP_STORIES, TOP_STORIES + RIVER_BATCH),
    opinion: stories[19],
  });
  assert.equal(ids.length, 14);
  assert.equal(frontPageHasNoRepeatedStory(ids), true);
});

test("a story printed in both the top and river fails the no-repeat predicate", () => {
  const ids = frontPageStoryIds({
    top: stories.slice(0, TOP_STORIES),
    river: [stories[0]!, ...stories.slice(TOP_STORIES, TOP_STORIES + RIVER_BATCH - 1)],
  });
  assert.equal(frontPageHasNoRepeatedStory(ids), false);
});
