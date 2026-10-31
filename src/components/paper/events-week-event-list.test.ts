import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { EventsWeekEventList } from "./events-week-event-list.ts";
import type { EventColumn, EventColumnItem } from "../../lib/news/events-week.ts";

const item = (id: string, overrides: Partial<EventColumnItem> = {}): EventColumnItem => ({
  matchKey: id,
  title: id,
  time: "9 a.m.",
  place: "Longmont",
  href: null,
  description: "",
  sourceName: "",
  startMinutes: 9 * 60,
  allDay: false,
  ...overrides,
});

function render(column: EventColumn, expanded = false) {
  return renderToStaticMarkup(
    createElement(EventsWeekEventList, {
      column,
      expanded,
      listId: "eventweek-test-morning",
      onToggle: () => {},
    }),
  );
}

test("a null event href renders plain title text rather than an anchor", () => {
  const html = render({
    key: "morning",
    label: "MORNING",
    items: [item("Private title")],
    more: 0,
  });
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /<span class="eventweek-title">Private title<\/span>/);
});

test("an event page renders as a title link and carries description and source", () => {
  const html = render({
    key: "morning",
    label: "MORNING",
    items: [
      item("Halloween Party", {
        href: "https://www.thegravitybrewing.com/events/halloween-party",
        description: "Costumes and a special beer.",
        sourceName: "The Gravity Brewing Company",
      }),
    ],
    more: 0,
  });
  assert.match(html, /<a class="eventweek-title" href="https:\/\/www\.thegravitybrewing\.com\/events\/halloween-party">/);
  assert.match(html, /eventweek-description/);
  assert.match(html, /From The Gravity Brewing Company/);
});

test("plus-N-more is a button that expands only its own list", () => {
  const column: EventColumn = {
    key: "morning",
    label: "MORNING",
    items: [item("One"), item("Two"), item("Three")],
    more: 1,
  };
  const collapsed = render(column, false);
  assert.match(
    collapsed,
    /<button type="button" class="eventweek-more" aria-expanded="false" aria-controls="eventweek-test-morning">\+ 1 more<\/button>/,
  );
  assert.doesNotMatch(collapsed, />Three</);
  const expanded = render(column, true);
  assert.match(
    expanded,
    /<button type="button" class="eventweek-more" aria-expanded="true" aria-controls="eventweek-test-morning">Show fewer<\/button>/,
  );
  assert.match(expanded, />Three</);
});
