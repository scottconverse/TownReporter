import { HOME_AREA } from "../story-area.ts";
import { normalizeEventText, type CollapsedRoutineEvent } from "./routine-events.ts";
import { cleanEventDescription, httpUrl, plainEventText } from "./routine-notice-text.ts";

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
> & {
  description: string;
  sourceName: string;
  eventUrl: string | null;
  /** Every distinct time when the same event appeared more than once. */
  startMinutesList?: Array<number | null>;
};

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
  href: string | null;
  description: string;
  sourceName: string;
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
const EXACT_JUNK_TITLES = new Set(["private event", "private", "closed"]);
const BUSINESS_HOURS_NOTICE = /\bholiday hours\b/i;
const CLOSED_NOTICE = /^closed\b/i;
const CLOSED_FOR_NOTICE = /\bclosed (for|on)\b/i;
const SCHOOL_SPORTS_NOTICE = /\b(varsity|jv|junior varsity|freshman|c-team)\b/i;

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

/**
 * A feed endpoint is never an event page. Keep this list in one pure function:
 * the box, its tests, and the stored URL fallback all share the same definition.
 */
export function isFeedUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  if (/^webcal:/i.test(raw)) return true;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const full = url.href.toLowerCase();
  return (
    /\.(?:ics|ical|ifb|rss|xml|json)$/i.test(path) ||
    path.includes("/ical/") ||
    path.includes("/feed") ||
    path.includes("/export") ||
    /(?:^|\/)calendar\/ical(?:\/|$)/i.test(path) ||
    url.searchParams.has("format") && url.searchParams.get("format")?.toLowerCase() === "ical" ||
    full.includes("calendar.google.com/calendar/ical") ||
    ((url.hostname === "tockify.com" || url.hostname.endsWith(".tockify.com")) &&
      path.startsWith("/api"))
  );
}

/** The event's own page, then its non-feed source page, never a calendar file. */
export function eventHref(
  event: Pick<EventsWeekEvent, "link" | "eventUrl" | "sourceUrl">,
): string | null {
  for (const candidate of [event.link, event.eventUrl, event.sourceUrl]) {
    const href = httpUrl(candidate);
    if (href && !isFeedUrl(href)) return href;
  }
  return null;
}

/** Normal case a mostly-shouting title for display without touching stored data. */
export function eventDisplayTitle(value: string): string {
  const title = plainEventText(value) ?? "";
  const letters = title.match(/\p{L}/gu)?.length ?? 0;
  const capitals = title.match(/\p{Lu}/gu)?.length ?? 0;
  if (!letters || capitals <= letters / 2) return title;
  return title.replace(
    /(^|[^\p{L}])(\p{Lu}{4,})(?=$|[^\p{L}])/gu,
    (_whole, lead: string, word: string) =>
      `${lead}${word.charAt(0)}${word.slice(1).toLocaleLowerCase("en-US")}`,
  );
}

/** Business notices and school fixtures that are not things a reader can attend. */
export function isJunkEventTitle(value: string): boolean {
  const title = (plainEventText(value) ?? "").replace(/\s+/g, " ").trim();
  const lower = title.toLowerCase();
  return (
    EXACT_JUNK_TITLES.has(lower) ||
    BUSINESS_HOURS_NOTICE.test(title) ||
    CLOSED_NOTICE.test(title) ||
    CLOSED_FOR_NOTICE.test(title) ||
    SCHOOL_SPORTS_NOTICE.test(title)
  );
}

function mergeOrder(a: EventsWeekEvent, b: EventsWeekEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (
    (a.startMinutes ?? Number.MAX_SAFE_INTEGER) - (b.startMinutes ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Hide non-events, normalize display capitalization, and merge the same event
 * when two sources list it under the same title/date/town. Inputs are unchanged.
 */
export function prepareEventsWeekEvents(events: readonly EventsWeekEvent[]): EventsWeekEvent[] {
  const grouped = new Map<string, EventsWeekEvent[]>();
  for (const event of events) {
    const title = plainEventText(event.title) ?? event.title;
    if (isJunkEventTitle(title)) continue;
    const key = [normalizeEventText(title), event.localDate, normalizeEventText(event.town)].join("|");
    const group = grouped.get(key);
    if (group) group.push(event);
    else grouped.set(key, [event]);
  }
  const out: EventsWeekEvent[] = [];
  for (const group of grouped.values()) {
    const ordered = [...group].sort(mergeOrder);
    const earliest = ordered[0]!;
    const times = [
      ...new Set(
        ordered.flatMap((event) =>
          event.startMinutesList?.length
            ? event.startMinutesList
            : event.allDay
              ? []
              : [event.startMinutes],
        ),
      ),
    ].sort((a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER));
    out.push({
      ...earliest,
      title: eventDisplayTitle(earliest.title),
      description: ordered.find((event) => event.description)?.description ?? "",
      sourceName: ordered.find((event) => event.sourceName)?.sourceName ?? "",
      startMinutes: times[0] ?? earliest.startMinutes,
      startMinutesList: times.length ? times : undefined,
    });
  }
  return out.sort(eventOrder);
}

/** Convert a stored, source-collapsed row into the plain data the box serializes. */
export function eventsWeekEvent(event: CollapsedRoutineEvent): EventsWeekEvent {
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
    eventUrl: httpUrl(event.fields.eventUrl?.value),
    description: cleanEventDescription(event.fields.description?.value),
    sourceName: plainEventText(event.sourceTitle) ?? plainEventText(event.sourceIssuer) ?? "",
  };
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
    title: eventDisplayTitle(event.title),
    localDate: event.localDate,
    startMinutes: event.startMinutes,
    allDay: event.allDay,
    place: event.place,
    town: event.town,
    area: event.area,
    link: event.link,
    sourceUrl: event.sourceUrl,
    eventUrl: event.eventUrl,
    description: cleanEventDescription(event.description),
    sourceName: plainEventText(event.sourceName) ?? "",
    startMinutesList: event.startMinutesList ? [...event.startMinutesList] : undefined,
  };
}

/** Collapsed rows split into the seven calendar days, including empty days. */
export function buildEventsWeek(
  dates: readonly string[],
  events: readonly EventsWeekEvent[],
): EventsWeekDay[] {
  const byDate = new Map<string, EventsWeekEvent[]>();
  for (const event of prepareEventsWeekEvents(events)) {
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

function joinedEventTime(event: EventsWeekEvent): string {
  const times = event.startMinutesList?.length ? event.startMinutesList : [event.startMinutes];
  return [...new Set(times.map((startMinutes) => eventTimeLabel({ ...event, startMinutes })))].join(
    " & ",
  );
}

function columnItem(event: EventsWeekEvent, column: EventColumnKey): EventColumnItem {
  return {
    matchKey: event.matchKey,
    title: eventDisplayTitle(event.title),
    time: joinedEventTime(event),
    place: column === "nearby" ? event.town || event.place : event.place || event.town,
    href: eventHref(event),
    description: cleanEventDescription(event.description),
    sourceName: plainEventText(event.sourceName) ?? "",
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
  for (const event of prepareEventsWeekEvents(events)) groups[columnFor(event)].push(event);
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
