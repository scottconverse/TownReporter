/**
 * The dated items behind "This week" (front page) and "Dates in this story"
 * (article page).
 *
 * Both panels print dates out of PUBLISHED STORIES ONLY -- never a meeting
 * calendar and never an unpublished lead (owner ruling, Scott, 2026-09-26).
 * The one structured date a printed story carries per source is
 * `ProvenanceItem.document_date`: the day the record itself bears, which is
 * what a captured agenda, notice or filing states, and therefore the date a
 * reader can go and check. `routine_notice_publications.issue_date` is the day
 * an edition went out, not the date inside it, so it is not read here.
 *
 * `document_date` is a free-form string on the wire -- `report.ts` coerces
 * whatever the scanner reported as `String(o.document_date ?? "")` and asks the
 * scanner for no particular format. This module used to accept only a value
 * that STARTED with an ISO `YYYY-MM-DD`, which is why a paper whose records
 * read "October 1, 2026" printed an empty "This week" beside stories that named
 * the first of October in their own headlines: the date was there, in the row,
 * in a shape this reader did not read. It now reads the written forms a
 * document bears -- `2026-10-01`, `10/1/2026`, `October 1, 2026`, `Oct. 1,
 * 2026`, `1 October 2026`, with an optional weekday and an ordinal suffix --
 * and a value that carries NO DAY ("early September", "September 2026", "last
 * week") is still skipped, because a panel that prints a date no printed story
 * reports is worse than a short panel.
 *
 * A day with no year ("Sept. 29", "10/1") is resolved to the year of the
 * reference day the caller passes -- `collectStoryDates` passes its window's
 * first day, so a front page read on 27 September 2026 reads "Sept. 29" as
 * 2026-09-29. With no reference day such a value is skipped, never guessed.
 *
 * The premise of these panels is written up in full in
 * `questions/BD-redesign-phase1-paper.md`. Nothing in this schema records a
 * cancelled event, which is why `cancelled` exists on the row and is never set
 * from data, and why an honest short panel is a real state rather than a bug.
 */

const ISO_DAY = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
/** "October 1, 2026" / "Oct. 1" / "Thursday, October 1st, 2026". */
const MONTH_DAY =
  /^(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b\s*,?\s*(\d{2}|\d{4})?\b/i;
/** "1 October 2026" / "1st Oct 2026". */
const DAY_MONTH =
  /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{2}|\d{4})?\b/i;
/** "10/1/2026" / "10/1" -- US month first, the paper's own convention. */
const NUMERIC_DAY = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?!\d)/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The month number a written month names, or 0 when the word is not one. */
function monthNumber(word: string): number {
  const index = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return index < 0 ? 0 : index + 1;
}

/** `YYYY-MM-DD` for a real calendar day, or `""` for one that does not exist. */
function dayOf(day: number, month: number, year: number): string {
  if (!year || !month || !day) return "";
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  const parts = dayParts(value);
  // The round trip is the calendar check: 31 February formats back as 3 March.
  return parts.day === String(day) && parts.dow ? value : "";
}

/**
 * The year a written date carries, or the reference day's. `""` when the value
 * names no year and the caller gave no reference to resolve it against.
 */
function yearOf(written: string | undefined, reference: string): number {
  if (written) return written.length === 2 ? 2000 + Number(written) : Number(written);
  return Number(reference.slice(0, 4)) || 0;
}

/** One printed story, reduced to the records it carries. */
export type StoryDateSource = {
  slug: string;
  section: string;
  records: { title: string; organization: string; document_date: string }[];
};

/** One dated record, on the day it bears. */
export type StoryDateItem = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** What the date is: the record's own title. */
  what: string;
  /** Who the record is from. */
  note?: string;
  /** The story it is attached to, so a printed row is traceable. */
  slug?: string;
};

/**
 * The row shape `DatesPanel` renders. Declared here as well as in the
 * component so the two stay structurally identical without the model
 * importing a component; the panel's own type is the same four fields.
 */
export type StoryDateRow = {
  dow: string;
  day: string;
  what: string;
  note?: string;
  cancelled?: boolean;
  slug?: string;
};

/**
 * `YYYY-MM-DD` for a string that names a real calendar day, or `""`.
 *
 * `reference` is the day a value with no year of its own is read against
 * (`YYYY-MM-DD`), and `""` means such a value is skipped rather than guessed
 * at. The round trip through `dayParts` rejects a day that does not exist
 * ("2026-02-31" formats back as 3 March, so its number does not match) rather
 * than rolling it forward into a date the record never bore.
 */
export function structuredDate(value: string | undefined, reference = ""): string {
  if (!value) return "";
  const text = value.trim();
  const iso = ISO_DAY.exec(text);
  if (iso) return dayOf(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  const written = MONTH_DAY.exec(text);
  if (written)
    return dayOf(Number(written[2]), monthNumber(written[1]), yearOf(written[3], reference));
  const reverse = DAY_MONTH.exec(text);
  if (reverse)
    return dayOf(Number(reverse[1]), monthNumber(reverse[2]), yearOf(reverse[3], reference));
  const numeric = NUMERIC_DAY.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    /*
      Month first, the way this paper writes a date, unless the first number
      cannot be a month at all ("17/10/2026") -- then it is the day, and the
      second is the month. Never both: a value that is ambiguous is not a value
      to invent a reading for.
    */
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    return dayOf(day, month, yearOf(numeric[3], reference));
  }
  return "";
}

/**
 * The panel's two columns: "Sat" and "26".
 *
 * Anchored at noon UTC because a date-only string is a calendar day and not an
 * instant. Parsing it at midnight would print the day before for every reader
 * west of Greenwich, which is every reader of this paper.
 */
export function dayParts(iso: string): { dow: string; day: string } {
  const at = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(at.valueOf())) return { dow: "", day: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  }).formatToParts(at);
  return {
    dow: parts.find((p) => p.type === "weekday")?.value ?? "",
    day: parts.find((p) => p.type === "day")?.value ?? "",
  };
}

/** `days` calendar days after `iso`, in the same `YYYY-MM-DD` space. */
export function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(at.valueOf())) return "";
  return new Date(at.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The domain line under an event: the host alone, when the note is a URL.
 *
 * A record's `organization` is usually already a host -- `report.ts`'s
 * `describeSourceUrl` returns `URL.hostname` with `www.` dropped, and
 * `isWeakOrg` treats that host as weak so an authored name wins over it. But an
 * authored provenance item can carry a whole URL, and what belongs under a date
 * is the domain a reader recognizes rather than a path, a query and a GUID. So
 * a URL-shaped note is reduced to its host; a name ("Longmont City Council") is
 * printed exactly as it came. A host still longer than the panel's line breaks
 * inside the word -- `.datenote` keeps `overflow-wrap: anywhere` for it -- and
 * the event text above it never does.
 */
export function hostOnly(organization: string): string {
  const value = organization.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  try {
    return new URL(value).hostname.replace(/^www\./i, "") || value;
  } catch {
    return value;
  }
}

/**
 * Every dated record in `sources` inside the window, oldest first, each once.
 *
 * `from` is the first day printed and `days` how many days the window covers --
 * "This week" is `[today, today + 7)`, on the paper's own calendar. Omit both
 * and the window is everything, which is what the article page wants: a story
 * carries the dates it carries, past and future, and the panel is about the
 * story rather than about a week.
 *
 * A record with no usable date is dropped, never guessed at, and a record whose
 * title is blank keeps its place under a plain label -- a date with no event
 * named is still a date the reader can check.
 */
export function collectStoryDates(
  sources: StoryDateSource[],
  { from, days, limit = 12 }: { from?: string; days?: number; limit?: number } = {},
): StoryDateItem[] {
  const to = from && days !== undefined ? addDays(from, days) : "";
  const items: StoryDateItem[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const record of source.records) {
      // The window's first day is also what a day with no year is read against.
      const date = structuredDate(record.document_date, from ?? "");
      if (!date) continue;
      if (from && date < from) continue;
      if (to && date >= to) continue;
      const what = record.title.trim() || "A record we kept";
      const note = hostOnly(record.organization);
      const key = `${date}|${what}|${note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item: StoryDateItem = { date, what };
      if (note) item.note = note;
      if (source.slug) item.slug = source.slug;
      items.push(item);
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items.slice(0, limit);
}

/** The same items, split into the panel's weekday and day columns. */
export function storyDateRows(items: StoryDateItem[]): StoryDateRow[] {
  return items.map((item) => {
    const { dow, day } = dayParts(item.date);
    const row: StoryDateRow = { dow, day, what: item.what };
    if (item.note) row.note = item.note;
    if (item.slug) row.slug = item.slug;
    return row;
  });
}
