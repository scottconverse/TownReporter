const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Read an explicitly dated meeting title; never treat a video post date as the meeting date. */
export function meetingDateFromTitle(title: string | null | undefined): string | null {
  if (!title?.trim()) return null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(title);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const monthDay = new RegExp(
    `\\b(${MONTHS.join("|")}|sept|sep|jan|feb|mar|apr|jun|jul|aug|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    "i",
  ).exec(title);
  if (!monthDay?.[3]) return null;
  const monthName = monthDay[1]!.toLowerCase().replace(/\.$/, "");
  const month = MONTHS.findIndex((name) => name.startsWith(monthName.slice(0, 3))) + 1;
  return validDate(Number(monthDay[3]), month, Number(monthDay[2]));
}

/** Format a date-only value without applying the viewer's local time zone. */
export function formatTranscriptDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateMatch) return null;
  const canonical = validDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
  if (!canonical) return null;
  const date = new Date(`${canonical}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Format an artifact timestamp in UTC so it is clear which moment was recorded. */
export function formatTranscriptTimestamp(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let normalized = value.trim().replace(" ", "T");
  normalized = normalized.replace(/(\.\d{3})\d+/, "$1");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}
