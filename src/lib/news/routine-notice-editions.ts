import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";
import { parseHTML } from "linkedom";

export type RoutineEditionChannel = "today" | "weekend" | "deadlines";
export type EligibleRoutineNotice = {
  channel: RoutineEditionChannel;
  notice: StructurallyValidRoutineNotice;
  occurrenceDate: string;
  line: string;
  sourceUrl: string;
};
export type RoutineEditionPlan = {
  channel: RoutineEditionChannel;
  localDate: string;
  headline: string;
  body: string;
  sourceUrls: string[];
  fingerprint: string;
  /** Only the Today in town edition sets one; the other editions keep the worker's standing line. */
  dek?: string;
};
/** What the Today in town layout needs that the notices themselves do not carry. */
export type RoutineEditionOptions = {
  /** The newsroom's time zone; clock times and the Morning/Afternoon/Evening split are read in it. */
  timezone?: string;
  /** The newsroom's town (its Paper setup city). Left out, the dek and first sentence name no town. */
  town?: string;
  /** A public source address -> the name the code already knows for that source. */
  sourceNames?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
};

const HIGH_RISK =
  /\b(alleg(?:e|ed|ation)|accus(?:e|ed|ation)|dispute|investigat(?:e|ion)|fraud|crime|lawsuit|medical|legal advice|emergency)\b/i;
function date(value: string | undefined, timezone: string) {
  if (!value) return "";
  if (!/T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 10);
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function decodeText(value: string | undefined) {
  if (!value) return "";
  const escaped = value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return parseHTML(`<span>${escaped}</span>`).document.querySelector("span")?.textContent ?? value;
}
/*
  A routine edition publishes with no editor, so nothing a source supplies may
  reach the reader as markup. `plainField` decodes the source's entities the way
  `decodeText` does, flattens its whitespace and drops the characters that
  `story-body.tsx` would otherwise turn into a link or emphasis (`[`, `]`, `(`
  and the scheme stay readable, but `](` can no longer pair up). Ordinary
  punctuation — `,` `.` `:` `-` `'` `&` `(` `)` — survives untouched.
*/
const MARKUP_CHARACTERS = /[*_`#[\]<>]/g;
export function plainField(value: string | undefined) {
  return decodeText(value).replace(MARKUP_CHARACTERS, "").replace(/\s+/g, " ").trim();
}
// Every free-text field `logisticsLine` interpolates. Values here come from the
// source, not from the owner-approved source URL that ends each edition.
const SOURCE_TEXT_FIELDS = [
  "program",
  "branch",
  "location",
  "hours",
  "closure",
  "title",
  "venue",
  "service",
  "area",
  "scheduleChange",
  "collectionInstructions",
] as const;
/*
  A web address or markdown link in source text is the one thing an editor must
  look at before it could ever be published; a very long field is the other.

  Detection runs on the raw value *and* on `plainField(raw)`, because cleaning
  is what the reader sees: `&#104;ttps://…`, `https&colon;//…`, `ht*tps://…`
  and `htt[]ps://…` all read as an ordinary field until entity decoding and
  markup removal turn them into a live `https://…` in the published line. `://`
  catches the same trick behind any other scheme.
*/
const SOURCE_WEB_ADDRESS = /https?:\/\/|www\.|\]\(/i;
const ANY_URL_SCHEME = /:\/\//;
const MAXIMUM_PLAIN_FIELD = 160;
function needsEditorForSourceText(fields: Record<string, string>) {
  return SOURCE_TEXT_FIELDS.some((field) => {
    const raw = fields[field];
    if (!raw) return false;
    const cleaned = plainField(raw);
    return (
      SOURCE_WEB_ADDRESS.test(raw) ||
      SOURCE_WEB_ADDRESS.test(cleaned) ||
      ANY_URL_SCHEME.test(cleaned) ||
      cleaned.length > MAXIMUM_PLAIN_FIELD
    );
  });
}
function displayDateOnly(value: string) {
  const instant = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(instant.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(instant);
}
function displayWhen(value: string | undefined, timezone: string, sourceTimezone?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return displayDateOnly(value);
  let instant: Date | null = null;
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) instant = parsed;
  } else if (sourceTimezone) {
    instant = namedZoneInstant(value, sourceTimezone);
  }
  if (!instant) return value;
  const rendered = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
  return rendered.replace(/, (\d{1,2}:\d{2})/, " at $1");
}
function namedZoneInstant(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const wanted = match.slice(1).map((part) => Number(part ?? 0));
  const center = Date.UTC(wanted[0]!, wanted[1]! - 1, wanted[2]!, wanted[3]!, wanted[4]!, wanted[5]!);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let delta = -14 * 60; delta <= 14 * 60; delta += 15) {
    const instant = center + delta * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    if ([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].every((part, index) => part === wanted[index])) return new Date(instant);
  }
  return null;
}
function occurrenceDate(fields: Record<string, string>, newsroomTimezone: string) {
  const value = fields.deadline ?? fields.start ?? fields.serviceDate ?? fields.effectiveDate;
  if (!value) return "";
  if (/T/.test(value) && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) && fields.timezone) {
    const instant = namedZoneInstant(value, fields.timezone);
    return instant ? date(instant.toISOString(), newsroomTimezone) : "";
  }
  return date(value, newsroomTimezone);
}
function weekendRange(localDate: string) {
  const d = new Date(`${localDate}T12:00:00Z`);
  const day = d.getUTCDay();
  const friday = new Date(d);
  friday.setUTCDate(d.getUTCDate() + ((5 - day + 7) % 7));
  const sunday = new Date(friday);
  sunday.setUTCDate(friday.getUTCDate() + 2);
  return [friday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)] as const;
}
function logisticsLine(n: StructurallyValidRoutineNotice, newsroomTimezone: string) {
  const f = n.normalizedFields;
  const when = (value: string | undefined) => `${displayWhen(value, newsroomTimezone, f.timezone)}${value?.includes("T") && f.timezone ? ` ${newsroomTimezone}` : ""}`;
  switch (n.formatKey) {
    case "library-notice":
      return `${plainField(f.program ?? f.branch)}: ${when(f.start ?? f.effectiveDate)}${f.location ? ` at ${plainField(f.location)}` : ""}${f.hours ? ` · ${plainField(f.hours)}` : ""}${f.closure ? ` · ${plainField(f.closure)}` : ""}`;
    case "parks-recreation-notice":
      return `${plainField(f.program)}: ${when(f.start)} at ${plainField(f.location)}`;
    case "community-arts-event-logistics":
      return `${plainField(f.title)}: ${when(f.start)}${f.venue ? ` at ${plainField(f.venue)}` : f.onlineUrl ? " online" : ""}`;
    case "registration-deadline":
      return `${plainField(f.program)}: applications close ${when(f.deadline)}`;
    case "waste-recycling-schedule":
      return `${plainField(f.service)}: ${when(f.serviceDate)}${f.endDate ? `–${displayWhen(f.endDate, newsroomTimezone)}` : ""} · ${plainField(f.area)}${f.scheduleChange ? ` · ${plainField(f.scheduleChange)}` : ""}${f.collectionInstructions ? ` · ${plainField(f.collectionInstructions)}` : ""}`;
    case "public-meeting-logistics":
      return `${plainField(f.title)}: ${when(f.start)}${f.venue ? ` at ${plainField(f.venue)}` : ""}`;
  }
}
/** Plain words for why a notice went to an editor instead of the paper. */
export const ROUTINE_REVIEW_WHY = {
  highRisk: "it uses a word an editor must check (for example lawsuit, crime or emergency)",
  sourceText: "its text has a web address or is very long",
  status: "it is cancelled or its status changed",
} as const;
/** A short name for a notice an editor is asked to look at: its title and start. */
export function routineNoticeLabel(n: StructurallyValidRoutineNotice, timezone = "UTC") {
  const f = n.normalizedFields;
  const name = plainField(f.program ?? f.title ?? f.service ?? f.branch ?? "");
  const value = f.deadline ?? f.start ?? f.serviceDate ?? f.effectiveDate;
  const when = value ? displayWhen(value, timezone, f.timezone) : "";
  return [name, when].filter(Boolean).join(", ").slice(0, 200);
}
export function eligibleRoutineNotices(
  notices: StructurallyValidRoutineNotice[],
  localDate: string,
  timezone = "UTC",
): {
  eligible: EligibleRoutineNotice[];
  review: StructurallyValidRoutineNotice[];
  /** One plain-words reason per `review` entry, in the same order. */
  reviewWhy: string[];
} {
  const [fri, sun] = weekendRange(localDate);
  const eligible: EligibleRoutineNotice[] = [],
    review: StructurallyValidRoutineNotice[] = [],
    reviewWhy: string[] = [];
  for (const notice of notices) {
    const line = logisticsLine(notice, timezone);
    if (HIGH_RISK.test(line)) {
      review.push(notice);
      reviewWhy.push(ROUTINE_REVIEW_WHY.highRisk);
      continue;
    }
    const f = notice.normalizedFields;
    if (needsEditorForSourceText(f)) {
      review.push(notice);
      reviewWhy.push(ROUTINE_REVIEW_WHY.sourceText);
      continue;
    }
    if (
      f.cancellation ||
      (f.eventStatus && f.eventStatus !== "scheduled" && !/(?:^|\/)EventScheduled$/.test(f.eventStatus))
    ) {
      review.push(notice);
      reviewWhy.push(ROUTINE_REVIEW_WHY.status);
      continue;
    }
    const when = occurrenceDate(f, timezone);
    if (!when) continue;
    const channels: RoutineEditionChannel[] = [];
    if (notice.formatKey === "registration-deadline") {
      const end = new Date(`${localDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 7);
      if (when < localDate || when > end.toISOString().slice(0, 10)) continue;
      channels.push("deadlines");
    } else {
      const through = notice.formatKey === "waste-recycling-schedule" && f.endDate
        ? date(f.endDate, timezone)
        : when;
      if (when <= localDate && through >= localDate) channels.push("today");
      if (when <= sun && through >= fri) channels.push("weekend");
    }
    for (const channel of channels)
      eligible.push({ channel, notice, occurrenceDate: when, line, sourceUrl: notice.provenance.sourceUrl });
  }
  return { eligible, review, reviewWhy };
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
/** "2026-10-25" -> "Sunday, Oct. 25": the date the way a reader says it. */
export function readerDate(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(instant.valueOf())) return localDate;
  return `${WEEKDAYS[instant.getUTCDay()]}, ${AP_MONTHS[instant.getUTCMonth()]} ${instant.getUTCDate()}`;
}
function fnv(value: string) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
/** A day with this many events or more is split under Morning / Afternoon / Evening. */
export const TODAY_HEADINGS_FROM = 6;
const NOON = 12 * 60;
const FIVE_PM = 17 * 60;

type LocalClock = { date: string; minutes: number };
/** The day and minute a start or end falls on in the newsroom's zone; null for a date with no time. */
function localClock(value: string | undefined, timezone: string, sourceTimezone?: string): LocalClock | null {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  let instant: Date | null = null;
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) instant = parsed;
  } else if (sourceTimezone) {
    instant = namedZoneInstant(value, sourceTimezone);
  } else {
    // A wall time with no zone of its own is already the newsroom's.
    const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
    return wall ? { date: wall[1]!, minutes: Number(wall[2]) * 60 + Number(wall[3]) } : null;
  }
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
function apClock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return {
    text: minute ? `${twelve}:${String(minute).padStart(2, "0")}` : String(twelve),
    meridiem: hour < 12 ? "a.m." : "p.m.",
  };
}
/** AP style: "2 p.m.", "2:30 to 4 p.m.", "11 a.m. to 1 p.m.". The end is shown only when the data has one. */
export function apTimeRange(startMinutes: number, endMinutes?: number | null) {
  const start = apClock(startMinutes);
  if (endMinutes === undefined || endMinutes === null || endMinutes === startMinutes)
    return `${start.text} ${start.meridiem}`;
  const end = apClock(endMinutes);
  return start.meridiem === end.meridiem
    ? `${start.text} to ${end.text} ${end.meridiem}`
    : `${start.text} ${start.meridiem} to ${end.text} ${end.meridiem}`;
}

type TodayEntry = {
  /** Minutes after midnight in the newsroom's zone; null when the data gives no start time. */
  startMinutes: number | null;
  timeLine: string;
  name: string;
  details: string[];
};
const FREE_ADMISSION = /^(?:free|free admission|free event|no charge|no cost)[.!]?$/i;
function todayEntry(row: EligibleRoutineNotice, timezone: string): TodayEntry {
  const f = row.notice.normalizedFields;
  const online = (url: string | undefined) => (url ? "Online" : "");
  let name = "";
  let place = "";
  const more: string[] = [];
  switch (row.notice.formatKey) {
    case "library-notice":
      name = plainField(f.program ?? f.branch);
      place = plainField(f.location) || online(f.participationUrl);
      if (f.hours) more.push(plainField(f.hours));
      if (f.closure) more.push(plainField(f.closure));
      break;
    case "parks-recreation-notice":
      name = plainField(f.program);
      place = plainField(f.location);
      break;
    case "community-arts-event-logistics":
      name = plainField(f.title);
      place = plainField(f.venue) || online(f.onlineUrl);
      break;
    case "public-meeting-logistics":
      name = plainField(f.title);
      place = plainField(f.venue) || online(f.attendanceUrl);
      break;
    case "waste-recycling-schedule":
      name = plainField(f.service);
      place = plainField(f.area);
      if (f.endDate) more.push(`Through ${readerDate(f.endDate.slice(0, 10))}`);
      if (f.scheduleChange) more.push(plainField(f.scheduleChange));
      if (f.collectionInstructions) more.push(plainField(f.collectionInstructions));
      break;
    case "registration-deadline":
      name = plainField(f.program);
      break;
  }
  const start = f.allDay === "true" ? null : localClock(f.start, timezone, f.timezone);
  let end: LocalClock | null = null;
  if (start) {
    end = localClock(f.end, timezone, f.timezone);
    // An end on another day, or not after the start, would print a wrong range.
    if (end && (end.date !== start.date || end.minutes <= start.minutes)) end = null;
  }
  const details = [place, ...more].filter(Boolean);
  if (f.admission && FREE_ADMISSION.test(f.admission.trim())) details.push("Free");
  if (f.registrationUrl && f.registrationRequired !== "false") details.push(`Sign up: ${f.registrationUrl}`);
  return {
    startMinutes: start ? start.minutes : null,
    timeLine: start ? `**${apTimeRange(start.minutes, end?.minutes)}**` : "",
    name,
    details,
  };
}
function sourceLabel(url: string, names: RoutineEditionOptions["sourceNames"]) {
  const known =
    names instanceof Map ? names.get(url) : names ? (names as Record<string, string>)[url] : undefined;
  const cleaned = plainField(known);
  // A "name" that is itself a web address is no better than the raw address.
  if (cleaned && !/:\/\/|^www\./i.test(cleaned)) return cleaned;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || plainField(url);
  } catch {
    return plainField(url);
  }
}
function sourceLine(url: string, names: RoutineEditionOptions["sourceNames"]) {
  const label = sourceLabel(url, names);
  if (!/^https?:\/\//i.test(url)) return `Source: ${label}`;
  return `Source: [${label}](${url.replace(/\s/g, "%20").replace(/\)/g, "%29")})`;
}
function todayEdition(
  rows: EligibleRoutineNotice[],
  localDate: string,
  sourceUrls: string[],
  options: RoutineEditionOptions,
) {
  const timezone = options.timezone ?? "UTC";
  const town = plainField(options.town);
  const entries = rows
    .map((row) => todayEntry(row, timezone))
    .sort(
      (a, b) =>
        (a.startMinutes ?? -1) - (b.startMinutes ?? -1) ||
        a.name.localeCompare(b.name) ||
        a.details.join("\n").localeCompare(b.details.join("\n")),
    );
  const block = (entry: TodayEntry) =>
    [entry.timeLine, entry.name, ...entry.details].filter(Boolean).join("\n");
  const listing: string[] = [];
  if (entries.length >= TODAY_HEADINGS_FROM) {
    const timed = (e: TodayEntry, from: number, before: number) =>
      e.startMinutes !== null && e.startMinutes >= from && e.startMinutes < before;
    const groups: [string, TodayEntry[]][] = [
      ["All day", entries.filter((e) => e.startMinutes === null)],
      ["Morning", entries.filter((e) => timed(e, 0, NOON))],
      ["Afternoon", entries.filter((e) => timed(e, NOON, FIVE_PM))],
      ["Evening", entries.filter((e) => timed(e, FIVE_PM, 24 * 60))],
    ];
    for (const [heading, group] of groups)
      if (group.length) listing.push(`## ${heading}`, ...group.map(block));
  } else {
    listing.push(...entries.map(block));
  }
  const count = `${entries.length} ${entries.length === 1 ? "event" : "events"}`;
  const calendars = town ? `${town}'s public calendars` : "the public calendars";
  return {
    dek: `${count} on ${calendars} today.`,
    body: [
      `Here is what is on ${calendars} for ${readerDate(localDate)}.`,
      ...listing,
      sourceUrls.map((url) => sourceLine(url, options.sourceNames)).join("\n"),
    ].join("\n\n"),
  };
}
export function planRoutineEditions(
  items: EligibleRoutineNotice[],
  localDate: string,
  options: RoutineEditionOptions = {},
): RoutineEditionPlan[] {
  const labels: { [K in RoutineEditionChannel]: string } = {
    today: "Today in town",
    weekend: "This weekend",
    deadlines: "Deadlines approaching",
  };
  return (["today", "weekend", "deadlines"] as const).flatMap((channel) => {
    const rows = items
      .filter((x) => x.channel === channel)
      .sort((a, b) => a.line.localeCompare(b.line));
    if (!rows.length) return [];
    const sourceUrls = [...new Set(rows.map((x) => x.sourceUrl))];
    let dek: string | undefined;
    let body: string;
    if (channel === "today") {
      ({ dek, body } = todayEdition(rows, localDate, sourceUrls, options));
    } else {
      body = [
        ...rows.map((row) => `- ${row.line}`),
        "",
        ...sourceUrls.map((url) => `Source: ${url}`),
      ].join("\n");
    }
    return [
      {
        channel,
        localDate,
        headline: `${labels[channel]} — ${readerDate(localDate)}`,
        body,
        sourceUrls,
        fingerprint: fnv(`${channel}\n${localDate}\n${body}`),
        ...(dek ? { dek } : {}),
      },
    ];
  });
}

/**
 * Receipts written from the Today in town layout on carry this prefix; the older
 * layout's receipts are the bare hash. The prefix is how a run tells a story
 * printed in the old layout from one printed in this one.
 */
export const EDITION_FINGERPRINT_PREFIX = "v2:";
export function routineEditionFingerprint(bodyHash: string) {
  return `${EDITION_FINGERPRINT_PREFIX}${bodyHash}`;
}
/**
 * What a run does about a channel that already has a story today:
 * - "unchanged": the same text is already printed; nothing to do.
 * - "layout-only": printed in the old layout (no v2 prefix) and the events are
 *   exactly the same, so only the receipt moves to the new fingerprint. A change
 *   of layout is not news, so no correction is posted.
 * - "correction": a real change (a new or removed event, or a changed text on a
 *   story already in the v2 layout); a correction is posted as always.
 */
export function routineEditionUpdateKind(input: {
  existingFingerprint: string;
  existingKeys: readonly string[];
  fingerprint: string;
  /** The bare hash of the new body, which is what an old-layout receipt holds. */
  bodyHash: string;
  /** Every event key the story holds once this run is done. */
  keysAfterRun: readonly string[];
}): "unchanged" | "layout-only" | "correction" {
  const { existingFingerprint } = input;
  if (existingFingerprint === input.fingerprint || existingFingerprint === input.bodyHash) return "unchanged";
  if (existingFingerprint.startsWith(EDITION_FINGERPRINT_PREFIX)) return "correction";
  const before = new Set(input.existingKeys);
  const after = new Set(input.keysAfterRun);
  const same = before.size === after.size && [...after].every((key) => before.has(key));
  return same ? "layout-only" : "correction";
}
