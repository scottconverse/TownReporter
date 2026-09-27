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
 * THE SECOND SOURCE (unit BX2). On the live paper every provenance item's
 * `document_date` is empty -- the coordinator measured all twelve newest
 * published articles and every record in them carried `''` -- so the panel
 * stayed empty beside stories that named their own dates out loud: "Applications
 * Close Sept. 29", "a posted Oct. 1 funding hearing packet", "an Oct. 6 public
 * hearing and second reading". The reading of the records was correct and had
 * nothing to read. So a story's own printed words are now read as well: its
 * headline and its dek, for a month name followed by a day of the month
 * ("Sept. 29", "October 6", "Oct. 8, 2026"). The month name is what makes this
 * precise -- it is why "Section 8", "Prop 123" and "3C" cannot be read as dates,
 * and why a bare "10/1" in a headline is not read at all.
 *
 * The year of a worded date comes from the story's own publish day, not from
 * the window: a story published in December that says "Jan. 5" means the coming
 * January, so a day more than ~two months behind the story it was printed in
 * rolls to the next year, and a written year always wins over both. Each item
 * carries a short event line -- the words around the date when those words are
 * clean ("Applications close", "public hearing and second reading", "Brighton
 * event") and the story's headline when they are not -- and every item links to
 * the story it was read out of.
 *
 * The body is deliberately NOT read. A body names the dates of the reporting
 * ("a Sept. 12 staff report") as often as it names the date of an event, and
 * nothing in the sentence marks which is which; the headline and the dek are
 * where a story names the date it is about. See the unit report.
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

/** One printed story, reduced to the records it carries and the words it was printed with. */
export type StoryDateSource = {
  slug: string;
  section: string;
  records: { title: string; organization: string; document_date: string }[];
  /**
   * The story's own headline and dek -- where a story names the date it is
   * about when no captured record bears one. Read for month-name dates only.
   */
  headline?: string;
  dek?: string;
  /**
   * The paper's own calendar day the story went out, as `YYYY-MM-DD`. It is
   * what a worded date with no year of its own is read against; a story whose
   * publish day is unknown contributes no worded dates rather than a guess.
   */
  published_on?: string;
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

/* ---------------------------------------------------------------------------
   The story's own words.
   --------------------------------------------------------------------------- */

/**
 * A month name and the day of the month after it -- "Sept. 29", "October 6",
 * "Oct. 8, 2026".
 *
 * Every alternative is a whole month name (spelled out or abbreviated) and a
 * `\b`, so "Mar" cannot be read out of "Market" and "May" cannot be read out of
 * "Mayor". The alternative list is longest-first so "sept" is tried before
 * "sep" and "september" before both. The year is four digits or nothing: a bare
 * two-digit number after a month name in a headline is as likely to be a count
 * as a year.
 */
const WORDED_DAY =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|sept|sep|jan|feb|mar|apr|jun|jul|aug|oct|nov|dec)\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4})(?!\d))?/gi;

/** How many words an event line carries before it stops. */
const EVENT_WORDS = 6;
/** How many words a line written BEFORE its date may run; longer is a headline. */
const BEFORE_WORDS = 6;
/**
 * How far behind its own story a worded day with no year may sit before it is
 * read as the coming year's. A story filed in December that says "Jan. 5"
 * cannot mean a January ten months gone; a story filed in September that says
 * "Aug. 1" plainly does mean this year's August.
 */
const ROLL_DAYS = 62;
/** Where an event line stops: the punctuation a printed sentence breaks on. */
const CLAUSE_BREAK = /[;:.—–!?,]/;
/** Words that never begin or end an event line on their own. */
const JOINERS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "its",
  "of",
  "on",
  "or",
  "the",
  "their",
  "to",
  "with",
]);
/**
 * A verb an event line cannot open with -- "are posted" is not a line about
 * anything, so a line that opens with one is no line at all.
 */
const AUXILIARIES = new Set([
  "are",
  "be",
  "been",
  "being",
  "can",
  "could",
  "had",
  "has",
  "have",
  "is",
  "may",
  "might",
  "must",
  "should",
  "was",
  "were",
  "will",
  "would",
]);
/**
 * A word that opens a trailing phrase or a new clause, past which an event line
 * does not run: "Brighton event for 3C and 3D" is the Brighton event, and "the
 * Oct. 8, 2026 hearing are posted" is the hearing.
 */
const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "ahead",
  "as",
  "at",
  "before",
  "behind",
  "by",
  "during",
  "for",
  "from",
  "in",
  "into",
  "near",
  "of",
  "on",
  "over",
  "through",
  "to",
  "under",
  "until",
  "with",
  ...AUXILIARIES,
]);

/** A word as an event line compares it: lowercase, with its punctuation off. */
function plain(word: string): string {
  return word.toLowerCase().replace(/[^\w'-]/g, "");
}

/**
 * The words around a date, cut down to one line a panel can print.
 *
 * `raw` is the piece of the sentence the date sits in; the line ends at the
 * first punctuation mark, drops a leading joiner ("to an Oct. 6 hearing" reads
 * "hearing"), stops before a word that opens a trailing phrase or a new clause
 * ("Brighton event for 3C and 3D" reads "Brighton event") and drops a trailing
 * joiner ("canvassing day and Oct. 3" reads "canvassing day"). A line that is
 * left as a single joiner, or that opens on a verb, is no line at all.
 */
function cleanLine(raw: string, maxWords: number): string {
  const stop = raw.search(CLAUSE_BREAK);
  let words = (stop < 0 ? raw : raw.slice(0, stop)).trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && JOINERS.has(plain(words[0]))) words = words.slice(1);
  if (words.length > 0 && AUXILIARIES.has(plain(words[0]))) return "";
  for (let i = 1; i < words.length; i += 1) {
    if (STOP_WORDS.has(plain(words[i]))) {
      words = words.slice(0, i);
      break;
    }
  }
  while (words.length > 1 && JOINERS.has(plain(words[words.length - 1]))) words.pop();
  const line = words.slice(0, maxWords).join(" ").replace(/[\s,;:.—–!?-]+$/, "").trim();
  return words.length === 1 && JOINERS.has(plain(line)) ? "" : line;
}

/** Where the sentence or clause the date sits in begins. */
function clauseStart(text: string, start: number): number {
  for (let i = start - 1; i >= 0; i -= 1) {
    if (";:.—–!?.".includes(text[i])) return i + 1;
  }
  return 0;
}

/**
 * The event line for one date: the words around it when they are clean, and the
 * story's headline when they are not.
 *
 * `next` is where the following date in the same text begins, so a line never
 * runs into the next date's own words ("canvassing day and Oct. 3" gives the
 * 26th its line and the 3rd its own). A line written BEFORE the date is used
 * only when it is short and whole ("Applications Close Sept. 29"); a long one
 * is just the headline with the date taken out of it, and the headline is what
 * gets printed.
 */
function eventLine(
  text: string,
  start: number,
  end: number,
  next: number,
  headline: string,
): string {
  const after = cleanLine(text.slice(end, next), EVENT_WORDS);
  if (after) return after;
  const before = cleanLine(text.slice(clauseStart(text, start), start), BEFORE_WORDS + 99);
  if (before && before.split(" ").length <= BEFORE_WORDS) return before;
  return headline.trim() || "A date this story names";
}

/**
 * The dates a printed story names in its own words, with a line for each.
 *
 * `publishedOn` is the story's own calendar day and resolves a date that names
 * no year; `headline` is what an event line falls back to. Nothing here reads a
 * value the story does not carry: a text with no month-name date in it returns
 * nothing at all.
 */
function wordedDates(
  text: string,
  publishedOn: string,
  headline: string,
): { date: string; what: string }[] {
  if (!text || !publishedOn) return [];
  const matches = [...text.matchAll(WORDED_DAY)];
  const found: { date: string; what: string }[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const next = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const day = Number(match[2]);
    const month = monthNumber(match[1]);
    let date = "";
    if (match[3]) {
      // A written year is the date's own and is never second-guessed.
      date = dayOf(day, month, Number(match[3]));
    } else {
      const year = Number(publishedOn.slice(0, 4));
      const candidate = dayOf(day, month, year);
      date =
        candidate && candidate < addDays(publishedOn, -ROLL_DAYS)
          ? dayOf(day, month, year + 1)
          : candidate;
    }
    if (!date) continue;
    found.push({ date, what: eventLine(text, start, end, next, headline) });
  }
  return found;
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
 *
 * A story is read twice: its records first, then its own printed words (unit
 * BX2). One calendar day is printed once per story, so a story whose headline
 * and record both name Oct. 1 gives the day to its record -- the record's own
 * title is the better line -- and a story that names the same day twice in its
 * headline and its dek gives it once.
 */
export function collectStoryDates(
  sources: StoryDateSource[],
  { from, days, limit = 12 }: { from?: string; days?: number; limit?: number } = {},
): StoryDateItem[] {
  const to = from && days !== undefined ? addDays(from, days) : "";
  const items: StoryDateItem[] = [];
  /** The rows already printed, wherever they came from. */
  const seenRows = new Set<string>();
  /** The days already printed for one story. */
  const seenDays = new Set<string>();
  const take = (source: StoryDateSource, date: string, what: string, note: string) => {
    if (!date) return;
    if (from && date < from) return;
    if (to && date >= to) return;
    const day = `${source.slug}|${date}`;
    if (seenDays.has(day)) return;
    seenDays.add(day);
    const key = `${date}|${what}|${note}`;
    if (seenRows.has(key)) return;
    seenRows.add(key);
    const item: StoryDateItem = { date, what };
    if (note) item.note = note;
    if (source.slug) item.slug = source.slug;
    items.push(item);
  };
  for (const source of sources) {
    for (const record of source.records) {
      // The window's first day is also what a day with no year is read against.
      take(
        source,
        structuredDate(record.document_date, from ?? ""),
        record.title.trim() || "A record we kept",
        hostOnly(record.organization),
      );
    }
    // The story's own words, read against its own publish day.
    const publishedOn = source.published_on ?? "";
    const headline = source.headline ?? "";
    for (const worded of [
      ...wordedDates(headline, publishedOn, headline),
      ...wordedDates(source.dek ?? "", publishedOn, headline),
    ]) {
      take(source, worded.date, worded.what, "");
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items.slice(0, limit);
}

/**
 * The same items, split into the panel's weekday and day columns.
 *
 * `selfSlug` is the story the reader is already on (unit BX2). The article
 * page's panel reads the same source the front page does, and every item from a
 * story's own words carries that story's slug -- so on the article page each
 * row would link back to the page it is printed on. A link to where the reader
 * already is tells them nothing; the row stays plain text there.
 */
export function storyDateRows(items: StoryDateItem[], selfSlug = ""): StoryDateRow[] {
  return items.map((item) => {
    const { dow, day } = dayParts(item.date);
    const row: StoryDateRow = { dow, day, what: item.what };
    if (item.note) row.note = item.note;
    if (item.slug && item.slug !== selfSlug) row.slug = item.slug;
    return row;
  });
}
