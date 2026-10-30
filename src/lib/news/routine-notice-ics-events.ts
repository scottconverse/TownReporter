import {
  validateRoutineNotice,
  type RoutineField,
  type UnverifiedRoutineNoticeProvenance,
} from "./routine-notice-types.ts";
import type {
  RoutineExtractionRefusalCode,
  RoutineExtractionResult,
} from "./routine-notice-extract.ts";

type Base = Omit<UnverifiedRoutineNoticeProvenance, "externalId">;

export type IcsEventOptions = {
  /** Fixed clock for callers and tests. Defaults to the real current time. */
  now?: Date;
  /** Inclusive local start date. Date values are converted to this calendar date. */
  windowStart?: Date | string;
  /** Exclusive local end date. Date values are converted to this calendar date. */
  windowEnd?: Date | string;
  /** Alternate spelling for a start/end pair. */
  window?: { start: Date | string; end: Date | string };
  /** Calendar used for the default window. Defaults to America/Denver. */
  timezone?: string;
};

type IcsEventContext = {
  provenance: Base;
  issuer: string;
  locality: string;
  timezone?: string;
};

const MAX_EVENT_ICS_BYTES = 4 * 1024 * 1024;
const MAX_RECURRENCE_DAYS = 100_000;
const DEFAULT_TIMEZONE = "America/Denver";
const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type Param = { name: string; value: string };
type Entry = { name: string; params: Param[]; value: string };

type DateValue = {
  allDay: boolean;
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  instant: number | null;
  zone: string | null;
  utc: boolean;
};

type DaySpec = { weekday: number; ordinal: number | null };
type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: DateValue | null;
  byDay: DaySpec[];
  byMonthDay: number[];
  byMonth: number[];
  wkst: number;
};

type ParsedEvent = {
  locator: string;
  uid: string;
  summary: string;
  start: DateValue;
  end: DateValue | null;
  rrule: RecurrenceRule | null;
  rdates: DateValue[];
  exdates: Set<string>;
  recurrenceId: DateValue | null;
  status: string;
  location: string | null;
  onlineUrl: string | null;
  timezone: string;
  cancelled: boolean;
};

type Occurrence = { start: DateValue; end: DateValue | null; key: string; idDate: string };

type ParsedCalendar = {
  events: ParsedEvent[];
  method: string;
  refusals: RoutineExtractionResult[];
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const compact = (fields: Record<string, RoutineField | undefined>) =>
  Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, RoutineField] => !!entry[1]),
  );
const field = (value: string | null, locator: string): RoutineField | undefined =>
  value ? { value, locator } : undefined;
const refused = (
  code: RoutineExtractionRefusalCode,
  locator: string,
  label?: string,
  validation?: RoutineExtractionResult["validation"],
): RoutineExtractionResult => ({
  status: "refused",
  code,
  locator,
  ...(label ? { label } : {}),
  ...(validation ? { validation } : {}),
});

function unfold(raw: string) {
  return raw.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeText(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function entry(line: string): Entry | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const [name, ...rawParams] = head.split(";");
  const params = rawParams.map((raw): Param => {
    const equals = raw.indexOf("=");
    return equals < 0
      ? { name: raw.toUpperCase(), value: "" }
      : {
          name: raw.slice(0, equals).toUpperCase(),
          value: raw.slice(equals + 1).replace(/^"|"$/g, ""),
        };
  });
  return { name: name!.toUpperCase(), params, value: unescapeText(line.slice(colon + 1)) };
}

function param(entry: Entry, name: string): string | null {
  return entry.params.find((item) => item.name === name)?.value ?? null;
}

function validCivil(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  )
    return false;
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(year, month, 0);
  return day <= check.getUTCDate();
}

function localParts(instant: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second] as const;
}

function zonedWallToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number | null {
  if (!validCivil(year, month, day, hour, minute, second)) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    return null;
  }
  const center = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set<number>();
  for (let delta = -48; delta <= 48; delta += 3) {
    const sample = center + delta * 3_600_000;
    const [sampleYear, sampleMonth, sampleDay, sampleHour, sampleMinute, sampleSecond] = localParts(
      sample,
      timezone,
    );
    offsets.add(
      Date.UTC(sampleYear, sampleMonth - 1, sampleDay, sampleHour, sampleMinute, sampleSecond) -
        sample,
    );
  }
  const matches = [...offsets]
    .map((offset) => center - offset)
    .filter((instant) => {
      const parts = localParts(instant, timezone);
      return parts.every((part, index) => part === [year, month, day, hour, minute, second][index]);
    });
  return matches.length === 1 ? matches[0]! : null;
}

function zoneOffset(instant: number, timezone: string) {
  const [year, month, day, hour, minute, second] = localParts(instant, timezone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - instant;
}

function offsetText(offset: number) {
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset) / 60_000;
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dateInZone(instant: number, timezone: string) {
  const [year, month, day] = localParts(instant, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(entry: Entry, defaultTimezone: string): DateValue | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(entry.value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const allDay = param(entry, "VALUE")?.toUpperCase() === "DATE" || match[4] === undefined;
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  if (!validCivil(year, month, day, hour, minute, second)) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (allDay) {
    return {
      allDay,
      date,
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      instant: null,
      zone: null,
      utc: false,
    };
  }
  const utc = !!match[7];
  const zone = utc ? "UTC" : (param(entry, "TZID") ?? defaultTimezone);
  let instant: number | null;
  if (utc) instant = Date.UTC(year, month - 1, day, hour, minute, second);
  else instant = zonedWallToInstant(year, month, day, hour, minute, second, zone);
  if (instant === null) return null;
  return { allDay, date, year, month, day, hour, minute, second, instant, zone, utc };
}

function dateNumber(value: DateValue) {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / DAY_MS);
}

function dateFromNumber(value: number) {
  const date = new Date(value * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    date: date.toISOString().slice(0, 10),
  };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeek(dayNumber: number, wkst: number) {
  const weekday = (((dayNumber + 4) % 7) + 7) % 7;
  return dayNumber - ((weekday - wkst + 7) % 7);
}

function matchesOrdinal(value: DateValue, spec: DaySpec, scope: "month" | "year") {
  if ((((dateNumber(value) + 4) % 7) + 7) % 7 !== spec.weekday) return false;
  if (spec.ordinal === null) return true;
  const first =
    scope === "month"
      ? dateNumber({ ...value, month: value.month, day: 1 })
      : Math.floor(Date.UTC(value.year, 0, 1) / DAY_MS);
  const last =
    scope === "month"
      ? dateNumber({ ...value, month: value.month, day: lastDayOfMonth(value.year, value.month) })
      : Math.floor(Date.UTC(value.year, 11, 31) / DAY_MS);
  const current = dateNumber(value);
  const position =
    spec.ordinal > 0
      ? Math.floor((current - first) / 7) + 1
      : -(Math.floor((last - current) / 7) + 1);
  return position === spec.ordinal;
}

function matchesRule(value: DateValue, start: DateValue, rule: RecurrenceRule) {
  if (rule.byMonth.length && !rule.byMonth.includes(value.month)) return false;
  if (rule.byMonthDay.length) {
    const last = lastDayOfMonth(value.year, value.month);
    const negative = value.day - last - 1;
    if (!rule.byMonthDay.some((day) => day === value.day || day === negative)) return false;
  }
  if (rule.byDay.length) {
    const ordinal = rule.freq === "MONTHLY" || (rule.freq === "YEARLY" && rule.byMonth.length > 0);
    if (!rule.byDay.some((spec) => matchesOrdinal(value, spec, ordinal ? "month" : "year")))
      return false;
  }

  const dayDiff = dateNumber(value) - dateNumber(start);
  const monthDiff = (value.year - start.year) * 12 + value.month - start.month;
  const yearDiff = value.year - start.year;
  switch (rule.freq) {
    case "DAILY":
      return dayDiff >= 0 && dayDiff % rule.interval === 0;
    case "WEEKLY": {
      if (dayDiff < 0) return false;
      const weeks =
        (startOfWeek(dateNumber(value), rule.wkst) - startOfWeek(dateNumber(start), rule.wkst)) / 7;
      const weekdays = rule.byDay.length
        ? rule.byDay.map((day) => day.weekday)
        : [(((dateNumber(start) + 4) % 7) + 7) % 7];
      return (
        weeks % rule.interval === 0 && weekdays.includes((((dateNumber(value) + 4) % 7) + 7) % 7)
      );
    }
    case "MONTHLY": {
      if (monthDiff < 0 || monthDiff % rule.interval !== 0) return false;
      if (!rule.byDay.length && !rule.byMonthDay.length) return value.day === start.day;
      return true;
    }
    case "YEARLY": {
      if (yearDiff < 0 || yearDiff % rule.interval !== 0) return false;
      if (!rule.byDay.length && !rule.byMonthDay.length) {
        return (
          value.day === start.day &&
          (rule.byMonth.length ? rule.byMonth.includes(value.month) : value.month === start.month)
        );
      }
      return true;
    }
  }
}

function parseRule(value: string, timezone: string): RecurrenceRule | null {
  const parts = new Map<string, string>();
  for (const raw of value.split(";")) {
    if (!raw) continue;
    const equals = raw.indexOf("=");
    if (equals <= 0) return null;
    const name = raw.slice(0, equals).toUpperCase();
    const item = raw
      .slice(equals + 1)
      .trim()
      .toUpperCase();
    if (!item || parts.has(name)) return null;
    parts.set(name, item);
  }
  const supported = new Set([
    "FREQ",
    "INTERVAL",
    "COUNT",
    "UNTIL",
    "BYDAY",
    "BYMONTHDAY",
    "BYMONTH",
    "WKST",
  ]);
  if ([...parts.keys()].some((name) => !supported.has(name))) return null;
  const freq = parts.get("FREQ");
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isSafeInteger(interval) || interval < 1) return null;
  const countText = parts.get("COUNT");
  const count = countText === undefined ? null : Number(countText);
  if (count !== null && (!Number.isSafeInteger(count) || count < 1)) return null;
  let until: DateValue | null = null;
  const untilRaw = parts.get("UNTIL");
  if (untilRaw !== undefined) {
    until = parseDate({ name: "UNTIL", params: [], value: untilRaw }, timezone);
    if (!until) return null;
  }
  if (count !== null && until) return null;

  const byDay: DaySpec[] = [];
  for (const raw of parts.get("BYDAY")?.split(",") ?? []) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(raw);
    if (!match) return null;
    const ordinal = match[1] === undefined ? null : Number(match[1]);
    if (ordinal === 0 || (ordinal !== null && freq !== "MONTHLY" && freq !== "YEARLY")) return null;
    byDay.push({ weekday: WEEKDAYS[match[2]!]!, ordinal });
  }
  const byMonthDay = (parts.get("BYMONTHDAY")?.split(",") ?? []).map(Number);
  if (byMonthDay.some((day) => !Number.isSafeInteger(day) || day === 0 || day < -31 || day > 31))
    return null;
  const byMonth = (parts.get("BYMONTH")?.split(",") ?? []).map(Number);
  if (byMonth.some((month) => !Number.isSafeInteger(month) || month < 1 || month > 12)) return null;
  const wkstText = parts.get("WKST");
  const wkst = wkstText === undefined ? WEEKDAYS.MO! : WEEKDAYS[wkstText];
  if (wkst === undefined) return null;
  return {
    freq: freq as RecurrenceRule["freq"],
    interval,
    count,
    until,
    byDay,
    byMonthDay,
    byMonth,
    wkst,
  };
}

function occurrenceKey(start: DateValue) {
  return start.allDay ? `date:${start.date}` : `instant:${start.instant}`;
}

function instantForDate(
  base: DateValue,
  date: { year: number; month: number; day: number; date: string },
): DateValue | null {
  if (base.allDay) {
    return {
      ...base,
      ...date,
      date: date.date,
      hour: 0,
      minute: 0,
      second: 0,
      instant: null,
      zone: null,
      utc: false,
    };
  }
  if (base.utc) {
    const instant = Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      base.hour,
      base.minute,
      base.second,
    );
    return { ...base, ...date, date: date.date, instant, zone: "UTC", utc: true };
  }
  const zone = base.zone ?? DEFAULT_TIMEZONE;
  const instant = zonedWallToInstant(
    date.year,
    date.month,
    date.day,
    base.hour,
    base.minute,
    base.second,
    zone,
  );
  return instant === null ? null : { ...base, ...date, date: date.date, instant, zone, utc: false };
}

function addDaysToDate(
  value: { year: number; month: number; day: number; date: string },
  days: number,
) {
  return dateFromNumber(
    Math.floor(Date.UTC(value.year, value.month - 1, value.day) / DAY_MS) + days,
  );
}

function endForOccurrence(start: DateValue, master: ParsedEvent): DateValue | null {
  if (!master.end) return null;
  if (master.start.allDay) {
    const days = dateNumber(master.end) - dateNumber(master.start);
    if (days <= 0) return null;
    const endDate = addDaysToDate(start, days);
    return { ...master.end, ...endDate, date: endDate.date, instant: null, zone: null, utc: false };
  }
  if (master.start.instant === null || master.end.instant === null) return null;
  const duration = master.end.instant - master.start.instant;
  if (duration <= 0 || start.instant === null) return null;
  const startZone = start.zone ?? master.timezone;
  if (startZone === "UTC") {
    const instant = start.instant + duration;
    return { ...master.end, instant, zone: "UTC", utc: true, date: dateInZone(instant, "UTC") };
  }
  const instant = start.instant + duration;
  const [year, month, day, hour, minute, second] = localParts(instant, startZone);
  return {
    ...master.end,
    year,
    month,
    day,
    date: dateInZone(instant, startZone),
    hour,
    minute,
    second,
    instant,
    zone: startZone,
    utc: false,
  };
}

function formatDate(value: DateValue) {
  if (value.allDay) return value.date;
  if (value.instant === null) return null;
  if (value.utc || value.zone === "UTC")
    return new Date(value.instant).toISOString().replace(/\.000Z$/, "Z");
  const zone = value.zone ?? DEFAULT_TIMEZONE;
  try {
    const [year, month, day, hour, minute, second] = localParts(value.instant, zone);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${offsetText(zoneOffset(value.instant, zone))}`;
  } catch {
    return null;
  }
}

function windowDate(value: Date | string, timezone: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  try {
    return dateInZone(instant, timezone);
  } catch {
    return null;
  }
}

function windowFor(options: IcsEventOptions | undefined, timezone: string) {
  const now =
    options?.now instanceof Date && Number.isFinite(options.now.valueOf())
      ? options.now
      : new Date();
  const startValue = options?.window?.start ?? options?.windowStart;
  const endValue = options?.window?.end ?? options?.windowEnd;
  let start: string | null;
  try {
    start =
      startValue === undefined
        ? dateInZone(now.valueOf(), timezone)
        : windowDate(startValue, timezone);
  } catch {
    return null;
  }
  if (!start) return null;
  const startDay = Math.floor(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))) /
      DAY_MS,
  );
  if (!Number.isFinite(startDay)) return null;
  const defaultEnd = dateFromNumber(startDay + 7).date;
  const end = endValue === undefined ? defaultEnd : windowDate(endValue, timezone);
  return end && start < end ? { start, end } : null;
}

function inWindow(value: DateValue, window: { start: string; end: string }, timezone: string) {
  const date = value.allDay
    ? value.date
    : value.instant === null
      ? null
      : dateInZone(value.instant, timezone);
  return !!date && date >= window.start && date < window.end;
}

function parseRuleDate(raw: string, params: Param[], timezone: string) {
  const entryValue: Entry = { name: "RDATE", params, value: raw };
  return parseDate(entryValue, timezone);
}

function recurrenceDays(
  master: ParsedEvent,
  window: { start: string; end: string },
  timezone: string,
) {
  const starts: DateValue[] = [];
  if (master.start.allDay) starts.push(master.start);
  else {
    const occurrence = instantForDate(master.start, master.start);
    if (occurrence) starts.push(occurrence);
  }
  if (!master.rrule) return starts;
  const rule = master.rrule;
  const startDay = dateNumber(master.start);
  const endDay =
    Math.floor(
      Date.UTC(
        Number(window.end.slice(0, 4)),
        Number(window.end.slice(5, 7)) - 1,
        Number(window.end.slice(8, 10)),
      ) / DAY_MS,
    ) + 2;
  let matched = 0;
  let day = startDay;
  for (let steps = 0; day <= endDay; steps += 1, day += 1) {
    if (steps > MAX_RECURRENCE_DAYS) return null;
    const civil = dateFromNumber(day);
    const value: DateValue = {
      ...master.start,
      ...civil,
      date: civil.date,
      hour: master.start.allDay ? 0 : master.start.hour,
      minute: master.start.allDay ? 0 : master.start.minute,
      second: master.start.allDay ? 0 : master.start.second,
      instant: null,
      zone: master.start.allDay ? null : master.start.zone,
      utc: master.start.allDay ? false : master.start.utc,
    };
    const isStart = day === startDay;
    if (!isStart && !matchesRule(value, master.start, rule)) continue;
    const occurrence = instantForDate(master.start, civil);
    if (!occurrence) return null;
    if (rule.until) {
      if (
        rule.until.allDay
          ? occurrence.date > rule.until.date
          : occurrence.instant! > rule.until.instant!
      )
        break;
    }
    matched += 1;
    if (rule.count !== null && matched > rule.count) break;
    if (inWindow(occurrence, window, timezone)) starts.push(occurrence);
  }
  return starts;
}

function parseCalendar(raw: string): ParsedCalendar {
  const lines = unfold(raw);
  const stack: string[] = [];
  const rawEvents: Array<{ lines: string[]; malformed: boolean; locator: string }> = [];
  const refusals: RoutineExtractionResult[] = [];
  let current: { lines: string[]; malformed: boolean; locator: string } | null = null;
  let eventOrdinal = 0;
  let method = "";
  for (const line of lines) {
    const begin = /^BEGIN:(.+)$/i.exec(line);
    const end = /^END:(.+)$/i.exec(line);
    if (begin) {
      const name = begin[1]!.toUpperCase();
      stack.push(name);
      if (name === "VEVENT") {
        if (current) refusals.push(refused("structurally-invalid", "VEVENT[duplicate]"));
        current = { lines: [], malformed: false, locator: `VEVENT[${eventOrdinal++}]` };
      } else if (current && name !== "VALARM") current.malformed = true;
      continue;
    }
    if (end) {
      const name = end[1]!.toUpperCase();
      if (stack.pop() !== name) {
        if (current) current.malformed = true;
        continue;
      }
      if (name === "VEVENT" && current) {
        rawEvents.push(current);
        current = null;
      }
      continue;
    }
    if (stack.length === 1 && /^METHOD:/i.test(line)) {
      method = (entry(line)?.value ?? "").toUpperCase();
    }
    if (current && stack.at(-1) === "VEVENT") current.lines.push(line);
  }
  if (stack.length || current) refusals.push(refused("structurally-invalid", "document"));

  const events: ParsedEvent[] = [];
  for (const rawEvent of rawEvents) {
    if (rawEvent.malformed) {
      refusals.push(refused("structurally-invalid", rawEvent.locator));
      continue;
    }
    const entries = rawEvent.lines.map(entry).filter((item): item is Entry => !!item);
    const names = ["UID", "DTSTART", "SUMMARY", "RRULE", "RECURRENCE-ID", "STATUS"];
    if (names.some((name) => entries.filter((item) => item.name === name).length > 1)) {
      refusals.push(refused("structurally-invalid", rawEvent.locator));
      continue;
    }
    const get = (name: string) => entries.find((item) => item.name === name) ?? null;
    const uid = text(get("UID")?.value);
    const startEntry = get("DTSTART");
    const summary = text(get("SUMMARY")?.value);
    if (!uid) {
      refusals.push(refused("missing-stable-identity", rawEvent.locator));
      continue;
    }
    if (!startEntry || !summary) {
      refusals.push(refused("structurally-invalid", rawEvent.locator, summary ?? uid));
      continue;
    }
    const timezone = param(startEntry, "TZID") ?? DEFAULT_TIMEZONE;
    const start = parseDate(startEntry, timezone);
    const endEntry = get("DTEND");
    const end = endEntry ? parseDate(endEntry, timezone) : null;
    if (!start || (endEntry && !end)) {
      refusals.push(refused("structurally-invalid", `${rawEvent.locator}.DTSTART`, summary));
      continue;
    }
    const rawRule = get("RRULE");
    const rrule = rawRule ? parseRule(rawRule.value, timezone) : null;
    if (rawRule && !rrule) {
      refusals.push(refused("unsupported-recurrence", `${rawEvent.locator}.RRULE`, summary));
      continue;
    }
    const recurrenceEntry = get("RECURRENCE-ID");
    const recurrenceId = recurrenceEntry ? parseDate(recurrenceEntry, timezone) : null;
    if (recurrenceEntry && !recurrenceId) {
      refusals.push(refused("structurally-invalid", `${rawEvent.locator}.RECURRENCE-ID`, summary));
      continue;
    }
    const rdates: DateValue[] = [];
    let unsupportedRdate = false;
    for (const item of entries.filter((item) => item.name === "RDATE")) {
      for (const rawValue of item.value.split(",")) {
        if (rawValue.includes("/")) {
          unsupportedRdate = true;
          continue;
        }
        const date = parseRuleDate(rawValue, item.params, timezone);
        if (date) rdates.push(date);
        else unsupportedRdate = true;
      }
    }
    if (unsupportedRdate) {
      refusals.push(refused("unsupported-recurrence", `${rawEvent.locator}.RDATE`, summary));
      continue;
    }
    const exdates = new Set<string>();
    let unsupportedExdate = false;
    for (const item of entries.filter((item) => item.name === "EXDATE")) {
      for (const rawValue of item.value.split(",")) {
        const date = parseRuleDate(rawValue, item.params, timezone);
        if (date) exdates.add(occurrenceKey(date));
        else unsupportedExdate = true;
      }
    }
    if (unsupportedExdate) {
      refusals.push(refused("structurally-invalid", `${rawEvent.locator}.EXDATE`, summary));
      continue;
    }
    const status = (get("STATUS")?.value ?? "").toUpperCase();
    const event: ParsedEvent = {
      locator: rawEvent.locator,
      uid,
      summary,
      start,
      end,
      rrule,
      rdates,
      exdates,
      recurrenceId,
      status,
      location: text(get("LOCATION")?.value),
      onlineUrl: text(get("X-GOOGLE-CONFERENCE")?.value),
      timezone,
      cancelled: status === "CANCELLED",
    };
    events.push(event);
  }
  return { events, method, refusals };
}

function eventResult(
  master: ParsedEvent,
  start: DateValue,
  end: DateValue | null,
  override: ParsedEvent | null,
  context: IcsEventContext,
  idDate: string,
): RoutineExtractionResult {
  const source = override ?? master;
  const startText = formatDate(start);
  const endText = end ? formatDate(end) : null;
  const titleLocator = `${source.locator}.SUMMARY`;
  const venue = source.location ?? master.location ?? context.locality;
  const venueLocator =
    source.location || master.location
      ? `${source.locator}.LOCATION`
      : `${source.locator}.OWNER_LOCALITY`;
  const onlineUrl =
    source.onlineUrl && /^https?:\/\//i.test(source.onlineUrl) ? source.onlineUrl : null;
  const timezone = start.allDay
    ? undefined
    : field(start.zone ?? master.timezone, `${source.locator}.DTSTART.TZID`);
  const validation = validateRoutineNotice({
    formatKey: "community-arts-event-logistics",
    variant: "event",
    provenance: {
      ...context.provenance,
      externalId: `${master.uid}#${idDate}`,
    },
    fields: compact({
      issuer: field(context.issuer, `${source.locator}.OWNER_ISSUER`),
      title: field(text(source.summary), titleLocator),
      start: field(startText, `${source.locator}.DTSTART`),
      end: field(endText, `${source.locator}.DTEND`),
      allDay: start.allDay ? field("true", `${source.locator}.DTSTART.VALUE`) : undefined,
      venue: field(text(venue), venueLocator),
      onlineUrl: field(onlineUrl, `${source.locator}.X-GOOGLE-CONFERENCE`),
      timezone,
    }),
  });
  if (!validation.valid) {
    return refused(
      "structurally-invalid",
      source.locator,
      `${source.summary}, ${startText ?? ""}`,
      validation,
    );
  }
  return { status: "parsed", locator: `${source.locator}@${idDate}`, validation };
}

export function extractIcsEvents(
  raw: string,
  context: IcsEventContext,
  options?: IcsEventOptions,
): RoutineExtractionResult[] {
  if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_ICS_BYTES) {
    return [refused("content-too-large", "document")];
  }
  const timezone = options?.timezone ?? context.timezone ?? DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    return [refused("structurally-invalid", "timezone")];
  }
  const window = windowFor(options, timezone);
  if (!window) return [refused("structurally-invalid", "window")];
  const parsed = parseCalendar(raw);
  if (parsed.method === "CANCEL") return parsed.refusals;
  const byUid = new Map<string, { masters: ParsedEvent[]; overrides: ParsedEvent[] }>();
  for (const event of parsed.events) {
    const group = byUid.get(event.uid) ?? { masters: [], overrides: [] };
    if (event.recurrenceId) group.overrides.push(event);
    else group.masters.push(event);
    byUid.set(event.uid, group);
  }
  const out: RoutineExtractionResult[] = [...parsed.refusals];
  for (const group of byUid.values()) {
    if (group.masters.length !== 1) {
      const event = group.masters[0] ?? group.overrides[0];
      if (event) out.push(refused("structurally-invalid", event.locator, event.summary));
      continue;
    }
    const master = group.masters[0]!;
    if (master.cancelled) continue;
    const occurrences = recurrenceDays(master, window, timezone);
    if (!occurrences) {
      out.push(refused("unsupported-recurrence", `${master.locator}.RRULE`, master.summary));
      continue;
    }
    const candidates = new Map<string, Occurrence>();
    for (const start of occurrences) {
      const end = endForOccurrence(start, master);
      const key = occurrenceKey(start);
      const idDate = start.allDay
        ? start.date
        : dateInZone(start.instant!, start.zone ?? master.timezone);
      candidates.set(key, { start, end, key, idDate });
    }
    for (const rdate of master.rdates) {
      const end = endForOccurrence(rdate, master);
      const key = occurrenceKey(rdate);
      const idDate = rdate.allDay
        ? rdate.date
        : dateInZone(rdate.instant!, rdate.zone ?? master.timezone);
      candidates.set(key, { start: rdate, end, key, idDate });
    }
    for (const exdate of master.exdates) candidates.delete(exdate);
    const overrides = new Map<string, ParsedEvent>();
    for (const override of group.overrides) {
      if (!override.recurrenceId) continue;
      overrides.set(occurrenceKey(override.recurrenceId), override);
      if (!override.cancelled && inWindow(override.start, window, timezone)) {
        const key = occurrenceKey(override.recurrenceId);
        if (!candidates.has(key))
          candidates.set(key, {
            start: override.recurrenceId,
            end: null,
            key,
            idDate: override.recurrenceId.allDay
              ? override.recurrenceId.date
              : dateInZone(
                  override.recurrenceId.instant!,
                  override.recurrenceId.zone ?? master.timezone,
                ),
          });
      }
    }
    const emitted = new Set<string>();
    for (const occurrence of [...candidates.values()].sort((left, right) => {
      const leftInstant = left.start.instant ?? Date.parse(`${left.start.date}T00:00:00Z`);
      const rightInstant = right.start.instant ?? Date.parse(`${right.start.date}T00:00:00Z`);
      return leftInstant - rightInstant || left.idDate.localeCompare(right.idDate);
    })) {
      const override = overrides.get(occurrence.key) ?? null;
      if (override?.cancelled) continue;
      const start = override?.start ?? occurrence.start;
      const end = override ? endForOccurrence(override.start, override) : occurrence.end;
      if (!inWindow(start, window, timezone)) continue;
      const idDate = override?.recurrenceId
        ? override.recurrenceId.allDay
          ? override.recurrenceId.date
          : dateInZone(
              override.recurrenceId.instant!,
              override.recurrenceId.zone ?? master.timezone,
            )
        : occurrence.idDate;
      const dedupe = `${master.uid}#${idDate}`;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      out.push(eventResult(master, start, end, override, context, idDate));
    }
  }
  return out;
}
