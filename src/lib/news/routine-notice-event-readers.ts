import { validateRoutineNotice, type RoutineField, type UnverifiedRoutineNoticeProvenance } from "./routine-notice-types.ts";
import type { RoutineExtractionResult } from "./routine-notice-extract.ts";

type Base = Omit<UnverifiedRoutineNoticeProvenance, "externalId">;

export type EventFeedReaderKind = "tribe" | "squarespace" | "libcal" | "civicplus";

export type EventFeedOptions = {
  now?: Date;
  windowStart?: Date | string;
  windowEnd?: Date | string;
  window?: { start: Date | string; end: Date | string };
  timezone?: string;
};

type EventFeedContext = {
  provenance: Base;
  issuer: string;
  locality: string;
  timezone?: string;
};

const DEFAULT_TIMEZONE = "America/Denver";
const DAY_MS = 86_400_000;
const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const decodeEntities = (value: string) => {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    hellip: "…",
    copy: "©",
    reg: "®",
    trade: "™",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
};

/** Source text made safe for a field: entities decoded, markup removed, whitespace flattened. */
export function plainEventText(value: unknown) {
  if (typeof value !== "string") return null;
  const plain = decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain || null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const idText = (value: unknown) => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const field = (value: string | null, locator: string): RoutineField | undefined =>
  value ? { value, locator } : undefined;

const compact = (fields: Record<string, RoutineField | undefined>) =>
  Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, RoutineField] => !!entry[1]));

function refusal(
  code: "missing-date" | "unreadable-date" | "unreadable-time" | "missing-stable-identity" | "structurally-invalid",
  locator: string,
  label?: string,
): RoutineExtractionResult {
  return { status: "refused", code, locator, ...(label ? { label: label.slice(0, 200) } : {}) };
}

function validTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

type ZoneParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneParts(instant: number, timezone: string): ZoneParts {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zoneOffset(instant: number, timezone: string) {
  const parts = zoneParts(instant, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(instant / 1000) * 1000;
}

function localInstant(parts: ZoneParts, timezone: string) {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = utc - zoneOffset(utc, timezone);
  instant = utc - zoneOffset(instant, timezone);
  return instant;
}

function isValidCivil(parts: Pick<ZoneParts, "year" | "month" | "day" | "hour" | "minute" | "second">) {
  if (
    !Number.isInteger(parts.year) || parts.year < 1 ||
    !Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12 ||
    !Number.isInteger(parts.day) || parts.day < 1 || parts.day > 31 ||
    !Number.isInteger(parts.hour) || parts.hour < 0 || parts.hour > 23 ||
    !Number.isInteger(parts.minute) || parts.minute < 0 || parts.minute > 59 ||
    !Number.isInteger(parts.second) || parts.second < 0 || parts.second > 59
  ) return false;
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return d.getUTCFullYear() === parts.year && d.getUTCMonth() === parts.month - 1 && d.getUTCDate() === parts.day;
}

function formatInstant(instant: number, timezone: string) {
  const parts = zoneParts(instant, timezone);
  const offset = zoneOffset(instant, timezone);
  const minutes = Math.round(Math.abs(offset) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const offsetText = `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${offsetText}`;
}

function dateParts(value: string, time = "00:00:00") {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!date || !clock) return null;
  const parts = {
    year: Number(date[1]),
    month: Number(date[2]),
    day: Number(date[3]),
    hour: Number(clock[1]),
    minute: Number(clock[2]),
    second: Number(clock[3] ?? 0),
  };
  return isValidCivil(parts) ? parts : null;
}

function parseLocalStamp(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(value.trim());
  if (!match) return null;
  return dateParts(match[1]!, match[2]!);
}

function timedValue(value: string, timezone: string) {
  const parts = parseLocalStamp(value);
  return parts ? formatInstant(localInstant(parts, timezone), timezone) : null;
}

function allDayValue(value: string) {
  return dateParts(value) ? value : null;
}

function windowDate(value: Date | string, timezone: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const parts = zoneParts(instant, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function eventWindow(options: EventFeedOptions | undefined, timezone: string) {
  const now = options?.now instanceof Date && Number.isFinite(options.now.valueOf()) ? options.now : new Date();
  const startValue = options?.window?.start ?? options?.windowStart;
  const endValue = options?.window?.end ?? options?.windowEnd;
  const start = startValue === undefined ? windowDate(now, timezone) : windowDate(startValue, timezone);
  if (!start) return null;
  const startDay = Math.floor(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))) / DAY_MS,
  );
  const defaultEnd = new Date((startDay + 7) * DAY_MS).toISOString().slice(0, 10);
  const end = endValue === undefined ? defaultEnd : windowDate(endValue, timezone);
  return end && start < end ? { start, end } : null;
}

function dateInWindow(date: string, window: { start: string; end: string }) {
  return date >= window.start && date < window.end;
}

function nextDate(date: string) {
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) ? new Date(instant + DAY_MS).toISOString().slice(0, 10) : null;
}

type EventRow = {
  id: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  venue: string | null;
  link: string | null;
  startDate: string | null;
  endDate: string | null;
  locators: { id: string; title: string; start: string; end: string; venue: string; link: string; allDay: string };
};

function eventResult(row: EventRow, context: EventFeedContext, timezone: string): RoutineExtractionResult {
  if (!row.id) return refusal("missing-stable-identity", row.locators.id);
  if (!row.title) return refusal("structurally-invalid", row.locators.title);
  const venue = row.venue ?? context.locality;
  const venueLocator = row.venue ? row.locators.venue : `${row.locators.venue.split(".")[0]}.OWNER_LOCALITY`;
  const link = row.link && /^https?:\/\//i.test(row.link) ? row.link : null;
  const validation = validateRoutineNotice({
    formatKey: "community-arts-event-logistics",
    variant: "event",
    provenance: { ...context.provenance, externalId: `${row.id}#${row.startDate}` },
    fields: compact({
      issuer: field(context.issuer, `${row.locators.start.split(".")[0]}.OWNER_ISSUER`),
      title: field(row.title, row.locators.title),
      start: field(row.start, row.locators.start),
      end: field(row.end, row.locators.end),
      allDay: row.allDay ? field("true", row.locators.allDay) : undefined,
      venue: field(venue, venueLocator),
      onlineUrl: field(link, row.locators.link),
      timezone: row.allDay ? undefined : field(timezone, `${row.locators.start.split(".")[0]}.OWNER_TIMEZONE`),
    }),
  });
  if (!validation.valid) {
    return {
      status: "refused",
      code: "structurally-invalid",
      locator: row.locators.start.split(".")[0]!,
      label: `${row.title}, ${row.start ?? row.startDate ?? ""}`.slice(0, 200),
      validation,
    };
  }
  return { status: "parsed", locator: `${row.locators.start.split(".")[0]}@${row.startDate}`, validation };
}

function tribeRows(raw: Record<string, unknown>, context: EventFeedContext, timezone: string, window: { start: string; end: string }) {
  const events = Array.isArray(raw.events) ? raw.events : [];
  const out: RoutineExtractionResult[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = record(events[index]);
    const prefix = `events[${index}]`;
    if (!event) {
      out.push(refusal("structurally-invalid", prefix));
      continue;
    }
    const title = plainEventText(event.title);
    const startSource = typeof event.start_date === "string" ? event.start_date.slice(0, 10) : null;
    const allDay = event.all_day === true;
    const start = startSource
      ? allDay
        ? allDayValue(startSource)
        : timedValue(event.start_date as string, timezone)
      : null;
    if (!startSource) {
      out.push(refusal("missing-date", `${prefix}.start_date`, title ?? undefined));
      continue;
    }
    if (!start) {
      out.push(refusal(allDay ? "unreadable-date" : "unreadable-time", `${prefix}.start_date`, title ?? undefined));
      continue;
    }
    if (!dateInWindow(startSource, window)) continue;
    const endSource = typeof event.end_date === "string" ? event.end_date.slice(0, 10) : null;
    let end: string | null = null;
    if (typeof event.end_date === "string" && event.end_date.trim()) {
      end = allDay ? allDayValue(event.end_date.slice(0, 10)) : timedValue(event.end_date, timezone);
      if (!end) {
        out.push(refusal(allDay ? "unreadable-date" : "unreadable-time", `${prefix}.end_date`, title ?? undefined));
        continue;
      }
    }
    const venueRecord = record(event.venue);
    const venue = plainEventText(venueRecord?.venue ?? event.venue);
    const link = plainEventText(event.url);
    out.push(eventResult({
      id: idText(event.id),
      title,
      start,
      end,
      allDay,
      venue,
      link,
      startDate: startSource,
      endDate: endSource,
      locators: {
        id: `${prefix}.id`,
        title: `${prefix}.title`,
        start: `${prefix}.start_date`,
        end: `${prefix}.end_date`,
        venue: `${prefix}.venue.venue`,
        link: `${prefix}.url`,
        allDay: `${prefix}.all_day`,
      },
    }, context, timezone));
  }
  return out;
}

function absoluteLink(value: unknown, sourceUrl: string) {
  const text = plainEventText(value);
  if (!text) return null;
  try {
    const url = new URL(text, sourceUrl);
    return /^https?:$/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function squarespaceRows(raw: Record<string, unknown>, context: EventFeedContext, timezone: string, window: { start: string; end: string }) {
  const upcoming = Array.isArray(raw.upcoming) ? raw.upcoming : [];
  const out: RoutineExtractionResult[] = [];
  for (let index = 0; index < upcoming.length; index += 1) {
    const event = record(upcoming[index]);
    const prefix = `upcoming[${index}]`;
    if (!event) {
      out.push(refusal("structurally-invalid", prefix));
      continue;
    }
    const title = plainEventText(event.title);
    if (typeof event.startDate !== "number" || !Number.isFinite(event.startDate)) {
      out.push(refusal("missing-date", `${prefix}.startDate`, title ?? undefined));
      continue;
    }
    let start: string;
    let parts: ZoneParts;
    try {
      parts = zoneParts(event.startDate, timezone);
      start = formatInstant(event.startDate, timezone);
    } catch {
      out.push(refusal("unreadable-date", `${prefix}.startDate`, title ?? undefined));
      continue;
    }
    const startDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    if (!dateInWindow(startDate, window)) continue;
    let end: string | null = null;
    if (event.endDate !== undefined && event.endDate !== null) {
      if (typeof event.endDate !== "number" || !Number.isFinite(event.endDate)) {
        out.push(refusal("unreadable-time", `${prefix}.endDate`, title ?? undefined));
        continue;
      }
      end = formatInstant(event.endDate, timezone);
    }
    const location = record(event.location);
    const venue = plainEventText(
      [location?.addressTitle, location?.addressLine1].filter((value) => typeof value === "string" && value.trim()).join(", "),
    );
    out.push(eventResult({
      id: idText(event.id),
      title,
      start,
      end,
      allDay: false,
      venue,
      link: absoluteLink(event.fullUrl, context.provenance.sourceUrl),
      startDate,
      endDate: null,
      locators: {
        id: `${prefix}.id`,
        title: `${prefix}.title`,
        start: `${prefix}.startDate`,
        end: `${prefix}.endDate`,
        venue: `${prefix}.location.addressTitle`,
        link: `${prefix}.fullUrl`,
        allDay: `${prefix}.startDate`,
      },
    }, context, timezone));
  }
  return out;
}

function xmlItems(raw: string) {
  return [...raw.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1] ?? "");
}

function xmlTag(raw: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(raw);
  return match ? plainEventText(match[1]) : null;
}

function libcalRows(raw: string, context: EventFeedContext, timezone: string, window: { start: string; end: string }) {
  const out: RoutineExtractionResult[] = [];
  const items = xmlItems(raw);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const prefix = `item[${index}]`;
    const id = xmlTag(item, "libcal:eventid");
    const title = xmlTag(item, "title");
    const date = xmlTag(item, "libcal:date");
    const startClock = xmlTag(item, "libcal:start");
    const endClock = xmlTag(item, "libcal:end");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      out.push(refusal("missing-date", `${prefix}.libcal:date`, title ?? undefined));
      continue;
    }
    if (!dateParts(date)) {
      out.push(refusal("unreadable-date", `${prefix}.libcal:date`, title ?? undefined));
      continue;
    }
    if (!startClock || !endClock) {
      out.push(refusal("unreadable-time", `${prefix}.${!startClock ? "libcal:start" : "libcal:end"}`, title ?? undefined));
      continue;
    }
    const allDay = startClock === "00:00:00" && endClock === "23:59:59";
    let start: string | null;
    let end: string | null;
    if (allDay) {
      start = date;
      end = nextDate(date);
    } else {
      start = timedValue(`${date} ${startClock}`, timezone);
      end = timedValue(`${date} ${endClock}`, timezone);
    }
    if (!start || !end) {
      out.push(refusal("unreadable-time", `${prefix}.libcal:${!start ? "start" : "end"}`, title ?? undefined));
      continue;
    }
    if (!dateInWindow(date, window)) continue;
    const location = xmlTag(item, "libcal:location");
    const campus = xmlTag(item, "libcal:campus");
    out.push(eventResult({
      id,
      title,
      start,
      end,
      allDay,
      venue: location ?? campus,
      link: xmlTag(item, "link"),
      startDate: date,
      endDate: end.slice(0, 10),
      locators: {
        id: `${prefix}.libcal:eventid`,
        title: `${prefix}.title`,
        start: `${prefix}.libcal:date`,
        end: `${prefix}.libcal:end`,
        venue: `${prefix}.libcal:${location ? "location" : "campus"}`,
        link: `${prefix}.link`,
        allDay: `${prefix}.libcal:start`,
      },
    }, context, timezone));
  }
  return out;
}

function civicDate(value: string | null) {
  if (!value) return null;
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month) return null;
  const parts = { year, month, day, hour: 0, minute: 0, second: 0 };
  return isValidCivil(parts) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

function civicTime(value: string | null) {
  if (!value) return { allDay: true as const, start: null, end: null };
  if (/^all\s*day(?:\s*event)?$/i.test(value)) return { allDay: true as const, start: null, end: null };
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value);
  if (!match) return null;
  const clock = (hourText: string, minuteText: string, meridiem: string) => {
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return `${String((hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  };
  const start = clock(match[1]!, match[2]!, match[3]!);
  const end = clock(match[4]!, match[5]!, match[6]!);
  return start && end ? { allDay: false as const, start, end } : null;
}

function civicPlusRows(raw: string, context: EventFeedContext, timezone: string, window: { start: string; end: string }) {
  const out: RoutineExtractionResult[] = [];
  const items = xmlItems(raw);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const prefix = `item[${index}]`;
    const title = xmlTag(item, "title");
    const dateSource = xmlTag(item, "calendarEvent:EventDates");
    if (!dateSource) {
      out.push(refusal("missing-date", `${prefix}.calendarEvent:EventDates`, title ?? undefined));
      continue;
    }
    const date = civicDate(dateSource);
    if (!date) {
      out.push(refusal("unreadable-date", `${prefix}.calendarEvent:EventDates`, title ?? undefined));
      continue;
    }
    if (!dateInWindow(date, window)) continue;
    const times = civicTime(xmlTag(item, "calendarEvent:EventTimes"));
    if (!times) {
      out.push(refusal("unreadable-time", `${prefix}.calendarEvent:EventTimes`, title ?? undefined));
      continue;
    }
    const link = xmlTag(item, "link");
    const eid = link ? /[?&]EID=(\d+)/i.exec(link)?.[1] ?? null : null;
    const start = times.allDay ? date : timedValue(`${date} ${times.start}`, timezone);
    const end = times.allDay ? nextDate(date) : timedValue(`${date} ${times.end}`, timezone);
    if (!start || !end) {
      out.push(refusal("unreadable-time", `${prefix}.calendarEvent:EventTimes`, title ?? undefined));
      continue;
    }
    out.push(eventResult({
      id: eid,
      title,
      start,
      end,
      allDay: times.allDay,
      venue: null,
      link,
      startDate: date,
      endDate: end.slice(0, 10),
      locators: {
        id: `${prefix}.link`,
        title: `${prefix}.title`,
        start: `${prefix}.calendarEvent:EventDates`,
        end: `${prefix}.calendarEvent:EventTimes`,
        venue: `${prefix}.OWNER_LOCALITY`,
        link: `${prefix}.link`,
        allDay: `${prefix}.calendarEvent:EventTimes`,
      },
    }, context, timezone));
  }
  return out;
}

/** Select the reader from content signatures. A plain RSS/JSON-LD page deliberately returns null. */
export function routineEventReaderKind(raw: string): EventFeedReaderKind | "ics" | null {
  if (raw.includes("BEGIN:VCALENDAR")) return "ics";
  try {
    const parsed: unknown = JSON.parse(raw);
    const value = record(parsed);
    if (
      value &&
      Array.isArray(value.events) &&
      value.events.some((item) => {
        const sample = record(item);
        return !!sample && ("start_date" in sample || "utc_start_date" in sample || "all_day" in sample);
      })
    )
      return "tribe";
    if (
      value &&
      Array.isArray(value.upcoming) &&
      value.upcoming.some((item) => {
        const sample = record(item);
        return !!sample && ("startDate" in sample || "fullUrl" in sample);
      })
    )
      return "squarespace";
  } catch {
    // Not JSON; the XML signatures below decide.
  }
  if (/xmlns:libcal\s*=/i.test(raw) && /<libcal:eventid\b/i.test(raw)) return "libcal";
  if (/xmlns:calendarEvent\s*=/i.test(raw) && /<calendarEvent:EventDates\b/i.test(raw)) return "civicplus";
  return null;
}

export function extractCommunityEventFeed(
  raw: string,
  kind: EventFeedReaderKind,
  context: EventFeedContext,
  options?: EventFeedOptions,
): RoutineExtractionResult[] {
  const timezone = options?.timezone ?? context.timezone ?? DEFAULT_TIMEZONE;
  if (!validTimeZone(timezone)) return [refusal("structurally-invalid", "timezone")];
  const window = eventWindow(options, timezone);
  if (!window) return [refusal("structurally-invalid", "window")];
  if (kind === "tribe" || kind === "squarespace") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [{ status: "refused", code: "malformed-json", locator: "document" }];
    }
    const value = record(parsed);
    if (!value) return [{ status: "refused", code: "malformed-json", locator: "document" }];
    return kind === "tribe"
      ? tribeRows(value, context, timezone, window)
      : squarespaceRows(value, context, timezone, window);
  }
  return kind === "libcal"
    ? libcalRows(raw, context, timezone, window)
    : civicPlusRows(raw, context, timezone, window);
}
