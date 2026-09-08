import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";

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
function weekendRange(localDate: string) {
  const d = new Date(`${localDate}T12:00:00Z`);
  const day = d.getUTCDay();
  const friday = new Date(d);
  friday.setUTCDate(d.getUTCDate() + ((5 - day + 7) % 7));
  const sunday = new Date(friday);
  sunday.setUTCDate(friday.getUTCDate() + 2);
  return [friday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)] as const;
}
function logisticsLine(n: StructurallyValidRoutineNotice) {
  const f = n.normalizedFields;
  switch (n.formatKey) {
    case "library-notice":
      return `${f.program ?? f.branch}: ${f.start ?? f.effectiveDate}${f.location ? ` at ${f.location}` : ""}${f.hours ? ` · ${f.hours}` : ""}${f.closure ? ` · ${f.closure}` : ""}`;
    case "parks-recreation-notice":
      return `${f.program}: ${f.start} at ${f.location}`;
    case "community-arts-event-logistics":
      return `${f.title}: ${f.start}${f.venue ? ` at ${f.venue}` : f.onlineUrl ? " online" : ""}`;
    case "registration-deadline":
      return `${f.program}: applications close ${f.deadline}`;
    case "waste-recycling-schedule":
      return `${f.service}: ${f.serviceDate} · ${f.area}${f.scheduleChange ? ` · ${f.scheduleChange}` : ""}`;
    case "public-meeting-logistics":
      return `${f.title}: ${f.start}${f.venue ? ` at ${f.venue}` : ""}`;
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
    const line = logisticsLine(notice);
    if (HIGH_RISK.test(line)) {
      review.push(notice);
      continue;
    }
    const f = notice.normalizedFields;
    const when = date(f.deadline ?? f.start ?? f.serviceDate ?? f.effectiveDate, timezone);
    if (!when) continue;
    const channel: RoutineEditionChannel =
      notice.formatKey === "registration-deadline"
        ? "deadlines"
        : when === localDate
          ? "today"
          : when >= fri && when <= sun
            ? "weekend"
            : "today";
    if (channel === "today" && when !== localDate) continue;
    if (channel === "deadlines") {
      const end = new Date(`${localDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 7);
      if (when < localDate || when > end.toISOString().slice(0, 10)) continue;
    }
    eligible.push({
      channel,
      notice,
      occurrenceDate: when,
      line,
      sourceUrl: notice.provenance.sourceUrl,
    });
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
