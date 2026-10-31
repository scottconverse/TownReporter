import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventsWeek,
  eventColumns,
  eventDisplayTitle,
  eventTimeLabel,
  isFeedUrl,
  isJunkEventTitle,
  eventsWeekHeading,
  eventsWeekMeta,
  hasEvents,
  paperLocalDate,
  weekDates,
  weekStripItems,
  type EventsWeekEvent,
} from "./events-week.ts";

const event = (id: string, overrides: Partial<EventsWeekEvent> = {}): EventsWeekEvent => ({
  matchKey: id,
  title: id,
  localDate: "2026-10-30",
  startMinutes: 9 * 60,
  allDay: false,
  place: "Longmont Public Library",
  town: "Longmont",
  area: "longmont",
  link: null,
  sourceUrl: `https://events.example/${id}`,
  eventUrl: null,
  description: "",
  sourceName: "",
  ...overrides,
});

test("the paper-local date and seven days cross a month end in the paper's zone", () => {
  assert.equal(
    paperLocalDate(new Date("2026-10-31T05:30:00Z"), "America/Denver"),
    "2026-10-30",
    "Denver is still on Friday while UTC is already Saturday",
  );
  assert.deepEqual(weekDates("2026-10-30"), [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
  ]);
});

test("home events bucket by time, all-day comes first in Morning, and nearby names the town", () => {
  const columns = eventColumns(
    [
      event("evening", { title: "Evening", startMinutes: 17 * 60 }),
      event("nearby-late", {
        title: "Berthoud supper",
        area: "nearby",
        town: "Berthoud",
        startMinutes: 18 * 60,
      }),
      event("all-day", { title: "All day", allDay: true, startMinutes: null }),
      event("morning", { title: "Morning", startMinutes: 9 * 60 }),
      event("noon", { title: "Noon", startMinutes: 12 * 60 }),
      event("nearby-early", {
        title: "Lyons breakfast",
        area: "nearby",
        town: "Lyons",
        startMinutes: 8 * 60,
      }),
      event("last-morning", { title: "Late morning", startMinutes: 11 * 60 + 59 }),
      event("last-afternoon", { title: "Late afternoon", startMinutes: 16 * 60 + 59 }),
    ],
    true,
  );

  assert.deepEqual(
    columns.map((column) => column.label),
    ["MORNING", "AFTERNOON", "EVENING", "NEARBY"],
  );
  assert.deepEqual(
    columns[0]!.items.map((item) => item.title),
    ["All day", "Morning", "Late morning"],
  );
  assert.equal(columns[0]!.items[0]!.time, "All day");
  assert.deepEqual(
    columns[1]!.items.map((item) => item.title),
    ["Noon", "Late afternoon"],
  );
  assert.equal(columns[1]!.items[0]!.time, "Noon");
  assert.deepEqual(
    columns[2]!.items.map((item) => item.title),
    ["Evening"],
  );
  assert.deepEqual(
    columns[3]!.items.map((item) => item.place),
    ["Lyons", "Berthoud"],
  );
  assert.equal(eventTimeLabel(event("ten-thirty", { startMinutes: 10 * 60 + 30 })), "10:30 a.m.");
});

test("a compact column shows two lines and then reports the remaining count", () => {
  const events = [
    ...[8, 9, 10].map((hour) => event(`morning-${hour}`, { startMinutes: hour * 60 })),
    ...[12, 13, 14].map((hour) => event(`afternoon-${hour}`, { startMinutes: hour * 60 })),
    ...[17, 18, 19].map((hour) => event(`evening-${hour}`, { startMinutes: hour * 60 })),
    ...[8, 9, 10].map((hour) =>
      event(`nearby-${hour}`, { startMinutes: hour * 60, area: "nearby", town: "Lyons" }),
    ),
  ];
  const compact = eventColumns(events);
  assert.deepEqual(
    compact.map((column) => column.items.length),
    [2, 2, 2, 2],
  );
  assert.deepEqual(
    compact.map((column) => column.more),
    [1, 1, 1, 1],
  );
  const expanded = eventColumns(events, true);
  assert.deepEqual(
    expanded.map((column) => column.items.length),
    [3, 3, 3, 3],
  );
  assert.deepEqual(
    expanded.map((column) => column.more),
    [0, 0, 0, 0],
  );
});

test("event titles link only to absolute http(s) URLs", () => {
  const href = (link: string | null, sourceUrl: string) =>
    eventColumns([event("link-check", { link, sourceUrl })], true)[0]!.items[0]!.href;

  assert.equal(
    href("javascript:alert(1)", "https://source.example/event"),
    "https://source.example/event",
  );
  assert.equal(href("/events/1", "https://source.example/event"), "https://source.example/event");
  assert.equal(href("https://x.org/e", "https://source.example/event"), "https://x.org/e");
  assert.equal(href("javascript:alert(1)", "/events/1"), null);
});

test("the strip counts seven days, and a paper's date words match the box's headings", () => {
  const dates = weekDates("2026-10-30");
  const days = buildEventsWeek(dates, [
    event("friday-a"),
    event("friday-b", { matchKey: "friday-b" }),
    event("monday", { localDate: "2026-11-02" }),
  ]);
  const strip = weekStripItems(days);

  assert.deepEqual(
    days.map((day) => day.events.length),
    [2, 0, 0, 1, 0, 0, 0],
  );
  assert.deepEqual(
    strip.map((item) => item.label),
    ["TODAY", "SAT", "SUN", "MON", "TUE", "WED", "THU"],
  );
  assert.deepEqual(
    strip.map((item) => item.dayNumber),
    [30, 31, 1, 2, 3, 4, 5],
  );
  assert.equal(strip[3]!.ariaLabel, "Monday, Nov. 2, 1 events");
  assert.equal(eventsWeekMeta(days[0]!), "Friday, Oct. 30 · 2 events");
  assert.equal(eventsWeekHeading(days[0]!, 0, "Longmont"), "Today around Longmont");
  assert.equal(eventsWeekHeading(days[1]!, 1, "Longmont"), "Saturday around Longmont");
});

test("an empty week suppresses the whole box", () => {
  const empty = buildEventsWeek(weekDates("2026-10-30"), []);
  assert.equal(hasEvents(empty), false);
  assert.equal(hasEvents(buildEventsWeek(weekDates("2026-10-30"), [event("one")])), true);
});

test("feed URLs are rejected in every shape while real event pages pass", () => {
  const feeds = [
    "https://events.example/feed.ics",
    "https://events.example/calendar.ical",
    "https://events.example/export.ifb",
    "https://events.example/news.rss",
    "https://events.example/events.xml",
    "https://events.example/events.json",
    "https://events.example/ical/123",
    "https://events.example/feed/today",
    "https://events.example/calendar/ical",
    "https://events.example/events?format=ical",
    "https://events.example/export/calendar",
    "webcal://events.example/calendar",
    "https://tockify.com/api/events?calendar=longmont",
    "https://calendar.google.com/calendar/ical/example/public/basic.ics",
    "https://calendar.google.com/calendar/ical/example%40group.calendar.google.com/public/basic.ics",
  ];
  for (const url of feeds) assert.equal(isFeedUrl(url), true, url);

  const pages = [
    "https://www.thegravitybrewing.com/events/halloween-party",
    "https://longmontcolorado.gov/event/discovery-days-art-8/2026-10-29/",
    "https://tockify.com/longmont/event/music-night",
    "https://calendar.google.com/calendar/u/0/r/eventedit/abc",
    "https://events.example/events/squirrel-junction",
    "not a URL",
  ];
  for (const url of pages) assert.equal(isFeedUrl(url), false, url);
});

test("an event links to its page, then a non-feed source, and never to a feed", () => {
  const href = (overrides: Partial<EventsWeekEvent>) =>
    eventColumns([event("feed-check", overrides)], true)[0]!.items[0]!.href;

  assert.equal(
    href({ link: "https://events.example/events.ics", sourceUrl: "https://events.example/calendar.ics" }),
    null,
  );
  assert.equal(
    href({
      link: "https://events.example/events.ics",
      eventUrl: "https://events.example/events/halloween-party",
      sourceUrl: "https://events.example/events.ics",
    }),
    "https://events.example/events/halloween-party",
  );
  assert.equal(
    href({ link: null, sourceUrl: "https://events.example/organizer" }),
    "https://events.example/organizer",
  );
  assert.equal(
    href({
      link: "https://events.example/events.ics",
      sourceUrl: "https://events.example/organizer",
    }),
    "https://events.example/organizer",
  );
});

test("business notices, private placeholders and school sports are hidden", () => {
  for (const title of [
    "Private Event",
    "private",
    "CLOSED",
    "HALLOWEEN HOLIDAY HOURS",
    "Closed for maintenance",
    "GALLERY HOURS- CLOSED FOR INSTALL",
    "Football JV",
    "Cross Country Varsity",
  ]) {
    assert.equal(isJunkEventTitle(title), true, title);
  }
  for (const title of ["Halloween Party", "U-Create Open Studio", "Lloyd Drust", "Gallery Hours"]) {
    assert.equal(isJunkEventTitle(title), false, title);
  }
});

test("duplicate rows merge by cleaned title, date and town and join differing times", () => {
  const columns = eventColumns(
    [
      event("lloyd-one", {
        title: "Lloyd Drust",
        startMinutes: 19 * 60,
        town: "Berthoud",
      }),
      event("lloyd-two", {
        title: "LLOYD DRUST!",
        startMinutes: 14 * 60,
        town: "berthoud",
      }),
      event("u-create-one", {
        title: "U-Create Open Studio",
        startMinutes: 10 * 60,
        town: "Longmont",
      }),
      event("u-create-two", {
        title: "u create open studio",
        startMinutes: 10 * 60,
        town: "LONGMONT",
      }),
    ],
    true,
  );
  const items = columns.flatMap((column) => column.items);
  assert.equal(items.length, 2);
  const lloyd = items.find((item) => /Lloyd Drust/i.test(item.title))!;
  assert.equal(lloyd.time, "2 p.m. & 7 p.m.");
  const openStudio = items.find((item) => /U-Create Open Studio/i.test(item.title))!;
  assert.equal(openStudio.time, "10 a.m.");
});

test("mostly-capitalized titles are normalized for display without changing short words", () => {
  assert.equal(eventDisplayTitle("GALLERY HOURS- 12PM-5PM"), "Gallery Hours- 12PM-5PM");
  assert.equal(eventDisplayTitle("MUSIC | SQUIRREL JUNCTION"), "Music | Squirrel Junction");
  assert.equal(eventDisplayTitle("BBQ USA DJ NIGHT"), "BBQ USA DJ Night");
  assert.equal(eventDisplayTitle("A mostly lower title"), "A mostly lower title");
});

test("the box item carries its cleaned description, source name and event page", () => {
  const item = eventColumns(
    [
      event("carry", {
        description: "  <b>Live music</b> &amp; dancing  ",
        sourceName: "Firehouse Art Center",
        eventUrl: "https://events.example/events/live-music",
      }),
    ],
    true,
  )[0]!.items[0]!;
  assert.equal(item.description, "Live music & dancing");
  assert.equal(item.sourceName, "Firehouse Art Center");
  assert.equal(item.href, "https://events.example/events/live-music");
});
