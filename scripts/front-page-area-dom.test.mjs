/*
  F03: the geography row on the front page marks ONE area, and a filtered front
  page names the area it is showing.

  WHY THIS FILE EXISTS. `scripts/registry-public-pages-dom.test.mjs` renders
  other public routes; nothing rendered the home route. The bug the walk found
  was a second pill claiming `aria-current="page"` on `/?area=nearby` (TanStack
  marks a link current when its search is a SUBSET of the page's, and the home
  pill's search is empty, so it matched too). The route now passes
  `activeOptions={{ exact: true }}` and sets `aria-current` itself. A string of
  markup cannot reproduce the router's matching, so this test pins the claim the
  component makes: exactly one pill is pressed, on page one and on page two, and
  the page prints the chosen area's name.

  The route file, `GeoPills` and `story-area.ts` are the real ones. Everything
  the front page draws below the heading -- stories, river, opinion, sections --
  is stubbed to empty, because the heading and the pill row are the whole
  question here.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

installDom();

const state = { search: {}, loader: null };
globalThis.__frontPageState = state;

const routerUrl = stubUrl(`
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
export function createFileRoute(path) {
  return (options) => ({
    path,
    options,
    useSearch: () => globalThis.__frontPageState.search,
    useLoaderData: () => globalThis.__frontPageState.loader,
  });
}
export function useNavigate() { return () => {}; }
export function Link({ to, search, params, children, ...rest }) {
  return createElement("a", { href: String(to ?? "#"), ...rest }, children);
}
`);

/*
  Every other dependency of the front page, reduced to what renders the page's
  frame: an empty section list, no stories, and pass-through wrappers. The pill
  row and the area heading are not among them, so they stay real.
*/
const emptyUrl = stubUrl(`
export function EmptyEdition() { return null; }
export function MoreTopStories() { return null; }
export function EventsWeekBox() { return null; }
export function ReaderRow() { return null; }
export function SaveStory() { return null; }
export function ReadBeacon() { return null; }
export function ViewBeacon() { return null; }
export function PublicSectionsSeed({ children }) { return children; }
export function usePublicSections() { return { sections: [] }; }
export function useReader() { return { saved: [], ready: true }; }
export async function readerArticles() { return { stories: [] }; }
export async function readerRoundups() { return []; }
export async function publicSections() { return []; }
export async function frontEventsWeek() { return null; }
export function editionRiverQuery() { return {}; }
export const RIVER_BATCH = 0;
export const TOP_STORIES = 1;
export function numberedMoreTopStories() { return []; }
export function topStorySlots() { return { pair: [] }; }
export function headlineWithTag(_topic, headline) { return headline; }
export function opinionHeadlineDisplay(headline) { return headline; }
export function dekOrFallback(dek, body) { return dek || body; }
export function isMiscTopic() { return false; }
export function readerSearch(raw) { return raw ?? {}; }
export function readMinutes() { return 1; }
export function topicReportingSentence() { return ""; }
export function hasEvents() { return false; }
`);

/* The masthead slot is where the pill row is handed down, so this stub keeps it. */
const chromeUrl = stubUrl(`
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
export function PaperShell({ children, geography }) {
  return createElement("div", null, geography, children);
}
`);

const queryUrl = stubUrl(`
export function useQuery() {
  return { data: undefined, isError: false, refetch() {} };
}
`);

const labels = {
  longmont: "Longmont",
  nearby: "Nearby",
  county: "Boulder County",
  colorado: "Colorado",
};
const contextUrl = stubUrl(`
export function usePaper() {
  return { name: "The Longmont Paper", city: "Longmont", state: "Colorado", location: "Longmont, Colorado" };
}
export function useAreaLabels() { return ${JSON.stringify(labels)}; }
export function usePaperDateFormatters() {
  return { formatShortDate: () => "Sep 1, 2026", formatDayStamp: () => "Sep 1, 2026" };
}
`);

const storyAreaUrl = await moduleUrl("src/lib/story-area.ts");
const geoPillsUrl = await moduleUrl("src/components/paper/geo-pills.tsx", {
  "@tanstack/react-router": routerUrl,
  "@/lib/story-area": storyAreaUrl,
  "@/lib/paper-context-state": contextUrl,
});

const imports = {
  "@tanstack/react-router": routerUrl,
  "@tanstack/react-query": queryUrl,
  "@/components/empty-edition": emptyUrl,
  "@/components/paper-chrome": chromeUrl,
  "@/components/reader-controls": emptyUrl,
  "@/components/paper/events-week-box": emptyUrl,
  "@/components/paper/geo-pills": geoPillsUrl,
  "@/components/paper/more-top-stories": emptyUrl,
  "@/components/reader-context": emptyUrl,
  "@/components/read-beacon": emptyUrl,
  "@/components/view-beacon": emptyUrl,
  "@/lib/news/reader-public": emptyUrl,
  "@/lib/news/reader-roundups-public": emptyUrl,
  "@/lib/news/front-page": emptyUrl,
  "@/lib/news/editorial": emptyUrl,
  "@/lib/news/dek-fallback": emptyUrl,
  "@/lib/news/section-types": emptyUrl,
  "@/lib/story-area": storyAreaUrl,
  "@/lib/reader": emptyUrl,
  "@/lib/use-sections": emptyUrl,
  "@/lib/news/sections": emptyUrl,
  "@/lib/paper-context-state": contextUrl,
  "@/lib/paper-phrases": emptyUrl,
  "@/lib/news/edition-river": emptyUrl,
  "@/lib/news/events-week-public": emptyUrl,
  "@/lib/news/events-week": emptyUrl,
};

const { Route } = await import(await moduleUrl("src/routes/index.tsx", imports));
const FrontPage = Route.options.component;

function renderHome(search) {
  state.search = search;
  state.loader = {
    sections: [],
    listing: { stories: [] },
    river: null,
    opinion: null,
    roundups: [],
    events: null,
    region: null,
  };
  const html = renderToStaticMarkup(createElement(FrontPage));
  return { html, document: parseHTML(html).document };
}

function pressed(document) {
  return [...document.querySelectorAll(".geopill")].filter(
    (pill) => pill.getAttribute("aria-current") === "page",
  );
}

test("?area=nearby marks only the Nearby pill", () => {
  const { document } = renderHome({ area: "nearby" });
  const pills = [...document.querySelectorAll(".geopill")];
  assert.equal(pills.length, 4, "the row prints the paper's four grounds");
  const current = pressed(document);
  assert.equal(current.length, 1, "exactly one pill claims aria-current");
  assert.equal(current[0].textContent.trim(), "Nearby");
  assert.match(current[0].getAttribute("class") ?? "", /\bon\b/);
  for (const pill of pills) {
    if (pill === current[0]) continue;
    assert.equal(pill.getAttribute("aria-current"), null);
    assert.doesNotMatch(pill.getAttribute("class") ?? "", /\bon\b/);
  }
});

test("?area=nearby&page=2 keeps only the Nearby pill marked", () => {
  const { document } = renderHome({ area: "nearby", page: 2 });
  const current = pressed(document);
  assert.equal(current.length, 1, "page two must not lose or double the mark");
  assert.equal(current[0].textContent.trim(), "Nearby");
  assert.match(current[0].getAttribute("class") ?? "", /\bon\b/);
});

test("the unfiltered front page marks the home town", () => {
  const { document } = renderHome({});
  const current = pressed(document);
  assert.equal(current.length, 1);
  assert.equal(current[0].textContent.trim(), "Longmont");
});

test("a filtered front page prints a heading for the chosen area", () => {
  const { document } = renderHome({ area: "nearby" });
  const heading = document.querySelector(".front-area-head h2");
  assert.ok(heading, "the area heading is on the page");
  assert.equal(heading.textContent.trim(), "Nearby");
});

test("the same heading is there on page two", () => {
  const { document } = renderHome({ area: "nearby", page: 2 });
  const heading = document.querySelector(".front-area-head h2");
  assert.ok(heading);
  assert.equal(heading.textContent.trim(), "Nearby");
});

test("no area heading on the unfiltered front page", () => {
  const { document } = renderHome({});
  assert.equal(document.querySelector(".front-area-head"), null);
});
