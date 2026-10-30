import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventsWeek,
  eventColumns,
  eventTimeLabel,
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
