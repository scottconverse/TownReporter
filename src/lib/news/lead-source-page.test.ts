import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOME_OR_LIST_SOURCE_WARNING,
  homeOrListSourceUrls,
  looksLikeHomeOrListPage,
  onlyHomeOrListSourceUrls,
  storyUrlForListSource,
  withStoryUrlsForListSources,
} from "./lead-source-page.ts";

/*
 * G26-HP-1 (2026-11-03): scan 97 leads cited `timescall.com/local-news/`,
 * `bouldercounty.gov/`, `svvsd.org/feed/` and `insidelongmontco.com/` as their
 * source. Nothing looked at it, so the editor opening such a lead to check it
 * landed on a front page. The check below marks those URLs (warn, never block,
 * rule 22) and this test pins the four real shapes plus the story shapes it
 * must leave alone.
 */

test("G26-HP-1: the four real scan-97 source URLs are marked as home or list pages", () => {
  for (const url of [
    "https://www.timescall.com/local-news/",
    "https://bouldercounty.gov/",
    "https://svvsd.org/feed/",
    "https://insidelongmontco.com/",
  ]) {
    assert.equal(looksLikeHomeOrListPage(url), true, `${url} is not the story page`);
  }
});

test("G26-HP-1: a home page is a URL with no path, with or without a trailing slash", () => {
  for (const url of ["https://example.org", "https://example.org/", "example.org/", "  https://www.example.org  "]) {
    assert.equal(looksLikeHomeOrListPage(url), true, url);
  }
});

test("G26-HP-1: feeds are feeds however they are addressed", () => {
  for (const url of [
    "https://svvsd.org/feed",
    "https://svvsd.org/feed/",
    "https://longmontcolorado.gov/news/?feed=rss2",
    "https://example.org/rss",
    "https://example.org/rss/",
    "https://example.org/atom.xml",
    "https://example.org/sitemap.xml",
    "https://example.org/news/feed/",
  ]) {
    assert.equal(looksLikeHomeOrListPage(url), true, url);
  }
});

test("G26-HP-1: a one-segment section path is a list page", () => {
  for (const url of [
    "https://www.dailycamera.com/news/",
    "https://www.timescall.com/sports",
    "https://example.org/opinion/",
    "https://example.org/obituaries/",
    "https://example.org/calendar/",
  ]) {
    assert.equal(looksLikeHomeOrListPage(url), true, url);
  }
});

test("G26-HP-1: a story page is NOT flagged -- the warning must not cry wolf", () => {
  for (const url of [
    "https://svvsd.org/news/lyons-school-ranking-2026/",
    "https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/",
    "https://www.timescall.com/2026/08/12/longmont-council-ranked-choice-voting/",
    "https://www.longmontleader.com/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123",
    "https://longmont.primegov.com/portal/meeting/12345",
    "https://assets.bouldercounty.gov/wp-content/uploads/2025/02/packet.pdf",
  ]) {
    assert.equal(looksLikeHomeOrListPage(url), false, `${url} addresses one story`);
  }
});

test("G26-HP-1: a URL that cannot be read is left alone rather than guessed at", () => {
  for (const url of ["", "   ", "not a url", "https://", null, undefined]) {
    assert.equal(looksLikeHomeOrListPage(url), false, String(url));
  }
});

test("G26-HP-1: the lead's marked URLs are returned once each, in the lead's order, and nothing is dropped", () => {
  const urls = [
    "https://svvsd.org/feed/",
    "https://svvsd.org/news/lyons-school-ranking-2026/",
    "https://bouldercounty.gov/",
    "https://svvsd.org/feed/",
  ];
  assert.deepEqual(homeOrListSourceUrls(urls), ["https://svvsd.org/feed/", "https://bouldercounty.gov/"]);
  assert.deepEqual(homeOrListSourceUrls(urls), homeOrListSourceUrls(urls).filter(Boolean));
  assert.equal(
    HOME_OR_LIST_SOURCE_WARNING,
    "Source is a home or list page, not the story page",
    "the Queue's sentence is the rule's own words",
  );
});

/*
 * G26-HP-2 (walk 2026-11-19): the scan cited only the front/list page it read,
 * so the Queue's chip was true for nearly every such lead. Filing now adds the
 * story's own link from the article links that page carried, and the chip is
 * only for a lead that still has no story page at all.
 */

const FRONT_PAGE = {
  url: "https://svvsd.org/news/",
  storyLinks: [
    { url: "https://svvsd.org/news/lyons-school-ranking-2026/", title: "Lyons schools rank high in state report" },
    { url: "https://svvsd.org/news/bus-routes-change-monday/", title: "Bus routes change Monday for middle schools" },
    { url: "https://svvsd.org/feed/", title: "News feed" },
  ],
};

test("G26-HP-2: the article link whose title names the headline is the story page", () => {
  assert.equal(
    storyUrlForListSource(
      "Lyons schools rank high in state report",
      "https://svvsd.org/news/",
      [FRONT_PAGE],
    ),
    "https://svvsd.org/news/lyons-school-ranking-2026/",
  );
});

test("G26-HP-2: a lead with no clear article match gets nothing added", () => {
  const urls = ["https://svvsd.org/news/"];
  assert.deepEqual(
    withStoryUrlsForListSources(
      "Council approves water rate increase",
      urls,
      [FRONT_PAGE],
    ),
    urls,
  );
  assert.equal(
    storyUrlForListSource("Council approves water rate increase", "https://svvsd.org/news/", [FRONT_PAGE]),
    null,
  );
  // No page read under that URL: nothing to draw a link from.
  assert.equal(storyUrlForListSource("Lyons schools rank high in state report", "https://svvsd.org/news/", []), null);
});

test("G26-HP-2: two equally plausible article links are not a clear match", () => {
  const page = {
    url: "https://example.org/news/",
    storyLinks: [
      { url: "https://example.org/news/council-approves-water-rate-increase/", title: "Council approves water rate increase" },
      { url: "https://example.org/news/council-approves-water-rate-freeze/", title: "Council approves water rate freeze" },
    ],
  };
  assert.equal(
    storyUrlForListSource("Council approves water rate increase", "https://example.org/news/", [page]),
    null,
  );
});

test("G26-HP-2: the story link is added before the list page and the list page is kept", () => {
  assert.deepEqual(
    withStoryUrlsForListSources(
      "Lyons schools rank high in state report",
      ["https://svvsd.org/news/", "https://svvsd.org/district-calendar/"],
      [FRONT_PAGE],
    ),
    [
      "https://svvsd.org/news/lyons-school-ranking-2026/",
      "https://svvsd.org/news/",
      "https://svvsd.org/district-calendar/",
    ],
  );
});

test("G26-HP-2: the chip is only for a lead with no story page at all", () => {
  assert.equal(onlyHomeOrListSourceUrls(["https://svvsd.org/feed/", "https://bouldercounty.gov/"]), true);
  assert.equal(
    onlyHomeOrListSourceUrls([
      "https://svvsd.org/feed/",
      "https://svvsd.org/news/lyons-school-ranking-2026/",
    ]),
    false,
  );
  assert.equal(onlyHomeOrListSourceUrls([]), false);
});
