import assert from "node:assert/strict";
import test from "node:test";
import {
  publishedFilterCounts,
  publishedMatches,
  publishedNeedle,
  publishedWeekAgo,
  type PublishedListRow,
} from "./published-rows.ts";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const WEEK_AGO = publishedWeekAgo(NOW);

function row(over: Partial<PublishedListRow> = {}): PublishedListRow {
  return { headline: "Council delays the vote", topic: "city", published_at: null, corrections: [], ...over };
}

test("'This week' is the last seven days off the row's own timestamp", () => {
  const inWeek = row({ published_at: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString() });
  const tooOld = row({ published_at: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() });
  assert.equal(publishedMatches(inWeek, "week", "", WEEK_AGO), true);
  assert.equal(publishedMatches(tooOld, "week", "", WEEK_AGO), false);
});

test("a story that never printed is not 'this week'", () => {
  assert.equal(publishedMatches(row({ published_at: null }), "week", "", WEEK_AGO), false);
});

test("'With corrections' is any correction at all", () => {
  assert.equal(publishedMatches(row(), "corrections", "", WEEK_AGO), false);
  assert.equal(
    publishedMatches(row({ corrections: [{ date: "2026-09-20", body: "We said Tuesday." }] }), "corrections", "", WEEK_AGO),
    true,
  );
});

test("'Opinion' reads the row's topic, which is where an editorial's kind lands", () => {
  assert.equal(publishedMatches(row({ topic: "opinion" }), "opinion", "", WEEK_AGO), true);
  assert.equal(publishedMatches(row({ topic: " Opinion " }), "opinion", "", WEEK_AGO), true);
  assert.equal(publishedMatches(row({ topic: "city" }), "opinion", "", WEEK_AGO), false);
  assert.equal(publishedMatches(row({ topic: null }), "opinion", "", WEEK_AGO), false);
});

test("the search box reads the headline and the kicker above it", () => {
  const needle = publishedNeedle("  COUNCIL ");
  assert.equal(needle, "council");
  assert.equal(publishedMatches(row({ headline: "Council delays the vote" }), "all", needle, WEEK_AGO), true);
  assert.equal(publishedMatches(row({ headline: "Budget passes", topic: "Council" }), "all", needle, WEEK_AGO), true);
  assert.equal(publishedMatches(row({ headline: "Budget passes", topic: "city" }), "all", needle, WEEK_AGO), false);
});

test("the search box and the pill both have to pass, in that order", () => {
  const old = row({ headline: "Council delays the vote", published_at: new Date(NOW - 30 * 86_400_000).toISOString() });
  assert.equal(publishedMatches(old, "all", "council", WEEK_AGO), true);
  assert.equal(publishedMatches(old, "week", "council", WEEK_AGO), false);
});

test("the pills count the whole list, so a page of 25 never shrinks the number", () => {
  const rows = [
    row({ published_at: new Date(NOW - 86_400_000).toISOString() }),
    row({ topic: "opinion" }),
    row({ corrections: [{ date: "2026-09-20", body: "We said Tuesday." }], topic: "opinion" }),
    row({ published_at: new Date(NOW - 30 * 86_400_000).toISOString() }),
  ];
  assert.deepEqual(publishedFilterCounts(rows, WEEK_AGO), {
    all: 4,
    week: 1,
    corrections: 1,
    opinion: 2,
  });
});

test("the pills ignore the search box -- it narrows the list, not the counts", () => {
  const rows = [row({ headline: "Council delays the vote" }), row({ headline: "Budget passes" })];
  // The route passes no needle to the counter at all; this pins that a search
  // that matches one row still leaves "All" reading 2.
  assert.equal(publishedFilterCounts(rows, WEEK_AGO).all, 2);
});
