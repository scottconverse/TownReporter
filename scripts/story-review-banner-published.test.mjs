/*
  PUB2 item 1: the red "Draft saved — review required." banner is not drawn on
  a story that is already on the paper.

  The banner's condition is the last completion receipt of the drafting job
  (`completedDraftNeedsReview`), and that receipt does not change when the
  article prints. So a published story -- opened after publication, or in the
  moment just after the Publish press on that page -- showed the red banner
  ("Check the source and name-verification findings before publication. Review
  now") beside the page's own "Published." The instruction is stale, and it
  contradicts the state the page is reporting.

  A source-shape test: the route is a large client component with no existing
  render harness, and what has to hold is a property of the JSX condition --
  the banner is drawn only when `!onPaper`.

  `onPaper` (route) is `status === "published" || publishedSlug`, so it covers
  both the reload and the just-pressed case with one guard.

  publish-blockers-walk.mjs asserts this banner on an UNPUBLISHED lead (its
  own `reviewLeadId`), which is the case this change must leave alone.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const story = await readFile(
  new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url),
  "utf8",
);

test("the review-required banner is guarded by !onPaper", () => {
  assert.match(
    story,
    /\{!onPaper && completedDraftNeedsReview \? \(/,
    "the banner must not be drawn once the story is on the paper",
  );
  /*
    The guard is the ONLY read of the flag besides its own definition: a second
    place that drew the banner from `completedDraftNeedsReview` without the
    guard would put the stale red box back on a published story.
  */
  assert.equal(
    (story.match(/completedDraftNeedsReview/g) ?? []).length,
    2,
    "the flag is defined once and read once, and the one read is guarded",
  );
});

test("the banner's own words are unchanged for an unpublished story", () => {
  assert.match(story, /<strong>Draft saved — review required\.<\/strong>/);
  assert.match(story, /Review now/);
  assert.match(story, /getElementById\("publish-blockers"\)/);
});
