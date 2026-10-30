import { HOME_AREA } from "../story-area.ts";
import type { CollapsedRoutineEvent } from "./routine-events.ts";

/** The event fields the front-page box needs; the table row keeps the rest. */
export type EventsWeekEvent = Pick<
  CollapsedRoutineEvent,
  | "matchKey"
  | "title"
  | "localDate"
  | "startMinutes"
  | "allDay"
  | "place"
  | "town"
  | "area"
  | "link"
  | "sourceUrl"
>;

export type EventsWeekDay = {
  date: string;
  events: EventsWeekEvent[];
};

export type EventsWeekData = {
  days: EventsWeekDay[];
  /** The published "Today in town" story for the first day, when one exists. */
  todayStorySlug: string | null;
};

export type EventColumnKey = "morning" | "afternoon" | "evening" | "nearby";

export type EventColumnItem = {
  matchKey: string;
  title: string;
  time: string;
  place: string;
  href: string;
  startMinutes: number | null;
  allDay: boolean;
};

export type EventColumn = {
  key: EventColumnKey;
  label: string;
  items: EventColumnItem[];
  /** How many lines a collapsed column is not showing. */
  more: number;
};

export type WeekStripItem = {
  label: string;
  dayNumber: number;
  count: number;
  ariaLabel: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const AP_MONTHS = [
  "Jan.",
  "Feb.",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];
const NOON = 12 * 60;
const FIVE_PM = 17 * 60;
const COLUMN_LIMIT = 2;

function dateInstant(localDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== localDate
    ? null
    : instant;
}

/** Today's calendar date where the paper is published, never the server's date. */
export function paperLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Seven consecutive paper-local dates, safely across a month or year end. */
export function weekDates(start: string, length = 7): string[] {
  const first = dateInstant(start);
  if (!first || !Number.isInteger(length) || length < 1) return [];
  return Array.from({ length }, (_, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export function weekdayName(localDate: string): string {
  const instant = dateInstant(localDate);
  return instant ? WEEKDAYS[instant.getUTCDay()]! : localDate;
}

export function weekdayShort(localDate: string): string {
  const instant = dateInstant(localDate);
  return instant ? WEEKDAYS_SHORT[instant.getUTCDay()]! : localDate;
}

export function monthDay(localDate: string): string {
  const instant = dateInstant(localDate);
  return instant ? `${AP_MONTHS[instant.getUTCMonth()]} ${instant.getUTCDate()}` : localDate;
}

export function eventCountLabel(count: number): string {
  return `${count} events`;
}

export function eventsWeekMeta(day: EventsWeekDay): string {
  return `${weekdayName(day.date)}, ${monthDay(day.date)} · ${eventCountLabel(day.events.length)}`;
}

/** "Today around Longmont", then "Friday around Longmont". */
export function eventsWeekHeading(day: EventsWeekDay, index: number, city: string): string {
  return `${index === 0 ? "Today" : weekdayName(day.date)} around ${city}`;
}

export function weekStripItems(days: readonly EventsWeekDay[]): WeekStripItem[] {
  return days.map((day, index) => ({
    label: index === 0 ? "TODAY" : weekdayShort(day.date),
    dayNumber: Number(day.date.slice(8, 10)),
    count: day.events.length,
    ariaLabel: `${weekdayName(day.date)}, ${monthDay(day.date)}, ${eventCountLabel(day.events.length)}`,
  }));
}

function eventOrder(a: EventsWeekEvent, b: EventsWeekEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const aMinutes = a.startMinutes ?? Number.MAX_SAFE_INTEGER;
  const bMinutes = b.startMinutes ?? Number.MAX_SAFE_INTEGER;
  return (
    aMinutes - bMinutes ||
    a.title.localeCompare(b.title) ||
    a.place.localeCompare(b.place) ||
    a.matchKey.localeCompare(b.matchKey)
  );
}

/** The serialized box carries only the fields it prints. */
function weekEvent(event: EventsWeekEvent): EventsWeekEvent {
  return {
    matchKey: event.matchKey,
    title: event.title,
    localDate: event.localDate,
    startMinutes: event.startMinutes,
    allDay: event.allDay,
    place: event.place,
    town: event.town,
    area: event.area,
    link: event.link,
    sourceUrl: event.sourceUrl,
  };
}

/** Collapsed rows split into the seven calendar days, including empty days. */
export function buildEventsWeek(
  dates: readonly string[],
  events: readonly EventsWeekEvent[],
): EventsWeekDay[] {
  const byDate = new Map<string, EventsWeekEvent[]>();
  for (const event of events) {
    const day = byDate.get(event.localDate);
    const oneLine = weekEvent(event);
    if (day) day.push(oneLine);
    else byDate.set(event.localDate, [oneLine]);
  }
  return dates.map((date) => ({
    date,
    events: [...(byDate.get(date) ?? [])].sort(eventOrder),
  }));
}

export function hasEvents(week: readonly EventsWeekDay[]): boolean {
  return week.some((day) => day.events.length > 0);
}

/** AP clock style used by the Today story, with the box's one `Noon` line. */
export function eventTimeLabel(event: Pick<EventsWeekEvent, "allDay" | "startMinutes">): string {
  if (event.allDay) return "All day";
  if (event.startMinutes === null) return "Time TBA";
  if (event.startMinutes === NOON) return "Noon";
  const hour = Math.floor(event.startMinutes / 60);
  const minute = event.startMinutes % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${minute ? `${twelve}:${String(minute).padStart(2, "0")}` : twelve} ${hour < 12 ? "a.m." : "p.m."}`;
}

function columnFor(event: EventsWeekEvent): EventColumnKey {
  if (event.area !== HOME_AREA) return "nearby";
  if (event.allDay || event.startMinutes === null || event.startMinutes < NOON) return "morning";
  if (event.startMinutes < FIVE_PM) return "afternoon";
  return "evening";
}

function columnItem(event: EventsWeekEvent, column: EventColumnKey): EventColumnItem {
  return {
    matchKey: event.matchKey,
    title: event.title,
    time: eventTimeLabel(event),
    place: column === "nearby" ? event.town || event.place : event.place || event.town,
    href: event.link || event.sourceUrl,
    startMinutes: event.startMinutes,
    allDay: event.allDay,
  };
}

/** Four columns in time order; compact columns show two lines and report the rest. */
export function eventColumns(events: readonly EventsWeekEvent[], expanded = false): EventColumn[] {
  const groups: Record<EventColumnKey, EventsWeekEvent[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    nearby: [],
  };
  for (const event of events) groups[columnFor(event)].push(event);
  const labels: Array<[EventColumnKey, string]> = [
    ["morning", "MORNING"],
    ["afternoon", "AFTERNOON"],
    ["evening", "EVENING"],
    ["nearby", "NEARBY"],
  ];
  return labels.map(([key, label]) => {
    const ordered = groups[key].sort(eventOrder);
    const shown = expanded ? ordered : ordered.slice(0, COLUMN_LIMIT);
    return {
      key,
      label,
      items: shown.map((event) => columnItem(event, key)),
      more: ordered.length - shown.length,
    };
  });
}
