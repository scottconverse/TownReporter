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
      return `${decodeText(f.program ?? f.branch)}: ${when(f.start ?? f.effectiveDate)}${f.location ? ` at ${decodeText(f.location)}` : ""}${f.hours ? ` · ${f.hours}` : ""}${f.closure ? ` · ${f.closure}` : ""}`;
    case "parks-recreation-notice":
      return `${decodeText(f.program)}: ${when(f.start)} at ${decodeText(f.location)}`;
    case "community-arts-event-logistics":
      return `${decodeText(f.title)}: ${when(f.start)}${f.venue ? ` at ${decodeText(f.venue)}` : f.onlineUrl ? " online" : ""}`;
    case "registration-deadline":
      return `${decodeText(f.program)}: applications close ${when(f.deadline)}`;
    case "waste-recycling-schedule":
      return `${decodeText(f.service)}: ${when(f.serviceDate)}${f.endDate ? `–${displayWhen(f.endDate, newsroomTimezone)}` : ""} · ${decodeText(f.area)}${f.scheduleChange ? ` · ${decodeText(f.scheduleChange)}` : ""}${f.collectionInstructions ? ` · ${decodeText(f.collectionInstructions)}` : ""}`;
    case "public-meeting-logistics":
      return `${decodeText(f.title)}: ${when(f.start)}${f.venue ? ` at ${decodeText(f.venue)}` : ""}`;
  }
}
export function eligibleRoutineNotices(
  notices: StructurallyValidRoutineNotice[],
  localDate: string,
  timezone = "UTC",
): { eligible: EligibleRoutineNotice[]; review: StructurallyValidRoutineNotice[] } {
  const [fri, sun] = weekendRange(localDate);
  const eligible: EligibleRoutineNotice[] = [],
    review: StructurallyValidRoutineNotice[] = [];
  for (const notice of notices) {
    const line = logisticsLine(notice, timezone);
    if (HIGH_RISK.test(line)) {
      review.push(notice);
      continue;
    }
    const f = notice.normalizedFields;
    if (
      f.cancellation ||
      (f.eventStatus && f.eventStatus !== "scheduled" && !/(?:^|\/)EventScheduled$/.test(f.eventStatus))
    ) {
      review.push(notice);
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
  return { eligible, review };
}
function fnv(value: string) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function planRoutineEditions(
  items: EligibleRoutineNotice[],
  localDate: string,
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
    const body = [
      ...rows.map((row) => `- ${row.line}`),
      "",
      ...sourceUrls.map((url) => `Source: ${url}`),
    ].join("\n");
    return [
      {
        channel,
        localDate,
        headline: `${labels[channel]} — ${localDate}`,
        body,
        sourceUrls,
        fingerprint: fnv(`${channel}\n${localDate}\n${body}`),
      },
    ];
  });
}
