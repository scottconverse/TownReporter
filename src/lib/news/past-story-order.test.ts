import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPINION_PAST_STORY_LABEL,
  PAST_STORY_SCORE_BAND,
  isOpinionTopic,
  orderPastStories,
  pastStoryScoreBand,
} from "./past-story-order.ts";

/*
 * G27-MS-1 (2026-11-03, desk only): "Our past stories close in meaning" put
 * opinion pieces at the top of the list with nothing saying they were columns
 * -- "police staffing" found an opinion piece on the tech board, "school board
 * budget" found an urban-renewal opinion piece. The fix labels them "Opinion"
 * and keeps them after the reporting in the same score band. Nothing is
 * removed from the list (rule 25) and the 0.46 cut is unchanged (see the doc
 * comment in past-story-order.ts for why the cut is not the cause).
 */

const row = (headline: string, score: number, isOpinion = false) => ({ headline, score, isOpinion });

test("G27-MS-1: opinion pieces are recognised from the paper's own topic key", () => {
  assert.equal(isOpinionTopic("opinion"), true);
  assert.equal(isOpinionTopic(" Opinion "), true);
  assert.equal(isOpinionTopic("opinions"), false, "only the section's own key counts");
  assert.equal(isOpinionTopic("schools"), false);
  assert.equal(isOpinionTopic(null), false);
  assert.equal(isOpinionTopic(undefined), false);
  assert.equal(OPINION_PAST_STORY_LABEL, "Opinion", "the desk's own word for the section");
});

test("G27-MS-1: inside one score band the reporting comes first and the opinion piece after it", () => {
  // The walk's own shape: an opinion piece scored a hair HIGHER than a news
  // story of the same subject, so score alone put the column first.
  const rows = [
    row("Opinion: the tech board's staffing plan", 0.63, true),
    row("Council approves police staffing plan", 0.61, false),
  ];
  assert.equal(pastStoryScoreBand(0.63), pastStoryScoreBand(0.61), "these two are the same band");
  assert.deepEqual(
    orderPastStories(rows).map((r) => r.headline),
    ["Council approves police staffing plan", "Opinion: the tech board's staffing plan"],
    "the reporting is listed first, the column after it",
  );
});

test("G27-MS-1: a clearly closer opinion piece still outranks a weaker news story", () => {
  // A band rather than "opinion always last": a near-exact column is better
  // background than a distant story that happens to be reporting.
  const rows = [
    row("Council approves police staffing plan", 0.48, false),
    row("Opinion: what the staffing vote means", 0.72, true),
  ];
  assert.notEqual(pastStoryScoreBand(0.72), pastStoryScoreBand(0.48));
  assert.deepEqual(
    orderPastStories(rows).map((r) => r.headline),
    ["Opinion: what the staffing vote means", "Council approves police staffing plan"],
  );
});

test("G27-MS-1: within a band and a kind, the closer story is still first", () => {
  const rows = [
    row("Water rates rise 4 percent", 0.80, false),
    row("Water rate hearing set", 0.83, false),
    row("Opinion: the water rate mistake", 0.81, true),
    row("Opinion: water, again", 0.84, true),
  ];
  assert.deepEqual(
    orderPastStories(rows).map((r) => r.headline),
    ["Water rate hearing set", "Water rates rise 4 percent", "Opinion: water, again", "Opinion: the water rate mistake"],
  );
});

test("G27-MS-1: nothing is removed -- every row handed in comes back, once", () => {
  const rows = [
    row("A", 0.9, true),
    row("B", 0.5),
    row("C", 0.47),
    row("D", 0.46),
  ];
  const out = orderPastStories(rows);
  assert.equal(out.length, rows.length, "the order changes; the list does not shrink");
  assert.deepEqual(new Set(out.map((r) => r.headline)), new Set(rows.map((r) => r.headline)));
  assert.deepEqual(rows.map((r) => r.headline), ["A", "B", "C", "D"], "the input is not mutated");
});

test("G27-MS-1: equal scores keep the ranker's own order", () => {
  const rows = [row("first", 0.6), row("second", 0.6), row("third", 0.6)];
  assert.deepEqual(orderPastStories(rows).map((r) => r.headline), ["first", "second", "third"]);
});

test("G27-MS-1: the band edges do not drift on float error", () => {
  assert.equal(PAST_STORY_SCORE_BAND, 0.05);
  assert.equal(pastStoryScoreBand(0.46 + 0.05 + 0.05), pastStoryScoreBand(0.56));
  assert.equal(pastStoryScoreBand(0), 0);
});
