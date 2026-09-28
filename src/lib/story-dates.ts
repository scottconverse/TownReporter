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
 * rolls to the next year, and a written year always wins over both. Every item
 * links to the story it was read out of.
 *
 * THE EVENT NAME (unit CV, item 2). A row's text has to name the event in plain
 * words. Until this unit it was "the words around the date when those words are
 * clean", which is what produced the entries the design review could not use:
 * "Applications Close", "Brighton event", "funding hearing packet", "instrument
 * collection drive". The name is now the first of three answers that reads as a
 * complete phrase -- the headline's own clause for the date (rule a), then the
 * clause the date sits in (rule b), then the story's headline (rule c). A phrase
 * that is a scrap -- one that opens mid-sentence or on a day number, ends on a
 * function word, or carries no capital word at all -- is REFUSED rather than
 * trimmed, and a day no rule can name is dropped rather than printed as scraps.
 * A clock time the story gives next to the date ("6 p.m.") is carried with the
 * name, written the way the design writes it (unit CV, item 3).
 *
 * The body is deliberately NOT read. A body names the dates of the reporting
 * ("a Sept. 12 staff report") as often as it names the date of an event, and
 * nothing in the sentence marks which is which; the headline and the dek are
 * where a story names the date it is about. See the unit report.
 *
 * UNIT BZ, ITEM 5. The headline is the last answer a row falls to, and it is not
 * always about the day the row is on. The live front page's Thu Oct. 1 row
 * printed "Longmont Housing Board Cancels Oct. 8 Regular Meeting; Funding
 * Hearings Still On", because the story named Oct. 1 in its dek and Oct. 8 in
 * its headline, and the dek's own words for the 1st were not clean enough to
 * print. A reader could take that row for a cancellation on the 1st. So a row
 * prints the headline only for a day the headline names -- or for a story whose
 * headline names no day at all, where it is still the story's own words -- and a
 * day the headline is not about is answered by its own clause or dropped. A
 * missing row is worth more than a row that sends the reader to the wrong day.
 *
 * UNIT CV, ITEM 1. A story prints one row per calendar day, and one row per
 * event however many stories name it. Two rows that name the same day from the
 * same story collapse to the more specific of the two, and two rows whose text
 * reads the same once punctuation and case are set aside are one event and print
 * once (`collectStoryDates`).
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

/**
 * The tail of a date EXPRESSION that follows the day `WORDED_DAY` matched: the
 * second day of a range ("Oct. 1-2"), and each further day of a list ("Oct. 1
 * and 8", "Oct. 1, 8").
 *
 * Unit BX3. The reader used to stop at the first day, so the rest of the
 * expression was left in the sentence and read as the event line: the live
 * front page printed "-2 instrument collection drive" under Oct. 1 and "8
 * regular meeting" under the same day, each of them the tail of a date range or
 * list the headline had written. A range names its first day (a two-day drive
 * that opens on the 1st is printed on the 1st) and a list names a day per
 * number, which is why the range tail is consumed and thrown away while the
 * list tail is consumed and kept.
 *
 * A number with a meridiem after it is a CLOCK, not the next day of the list:
 * "the hearing is Oct. 6, 6 p.m." names one day. Read as a list it extended the
 * expression over the clock's hour, which left the row printing the stump "p"
 * where the time had been (unit CV, item 3, measured).
 */
const RANGE_TAIL = /^\s*[-–—]\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?/;
const LIST_TAIL =
  /^\s*(?:,|and\b|&)\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?!\s*(?::\d{2})?\s*[ap]\.?\s?m\b)/;
/**
 * How many words a row's event name may run (unit CV, item 2).
 *
 * The brief's own bound: "a phrase ... within ~12 words around the date". A
 * phrase longer than this is a sentence the panel would be reprinting, and the
 * row falls to the story's headline instead.
 */
const NAME_WORDS = 12;
/**
 * How far from the date a clock may sit and still be the date's own time (unit
 * CV, item 3).
 */
const TIME_WORDS = 12;
/**
 * How far behind its own story a worded day with no year may sit before it is
 * read as the coming year's. A story filed in December that says "Jan. 5"
 * cannot mean a January ten months gone; a story filed in September that says
 * "Aug. 1" plainly does mean this year's August.
 */
const ROLL_DAYS = 62;
/** Where a clause stops: the punctuation a printed sentence breaks on. */
const CLAUSE_BREAK = /[;:.—–!?,]/;
/**
 * Short forms whose full stop is not the end of a clause. 0.6.82: the live
 * front page printed "Vrain lists upcoming school open houses" because the
 * stop in "St. Vrain" was read as a sentence break.
 */
const ABBREVIATIONS = new Set([
  "st",
  "mt",
  "ft",
  "mr",
  "mrs",
  "ms",
  "dr",
  "jr",
  "sr",
  "no",
  "ave",
  "blvd",
  "rd",
  "co",
  "inc",
  "corp",
  "gov",
  "sen",
  "rep",
  "hwy",
  "u.s",
  "u.s.a",
]);
/** Titles that always sit before a name: their stop never ends a sentence. */
const TITLES = new Set(["mr", "mrs", "ms", "dr", "sen", "rep", "gov", "no"]);
/**
 * True when the "." at `i` closes a short form ("St.") or an initial ("J.")
 * inside a sentence. A short form can also end a sentence ("on Main St. The
 * hearing..."): when the next word is capitalised, a street-type short form
 * that follows a capitalised word ("Main St.", "Hover Ave.") is read as the
 * sentence's end, while one that opens a name ("St. Vrain", "the St. Vrain
 * district") is not.
 */
function abbreviationStop(text: string, i: number): boolean {
  if (text[i] !== ".") return false;
  const word = /([A-Za-z.]+)$/.exec(text.slice(Math.max(0, i - 8), i))?.[1] ?? "";
  if (!word) return false;
  if (/^[A-Z]$/.test(word)) return true;
  const key = word.toLowerCase().replace(/^\.+/, "");
  if (!ABBREVIATIONS.has(key)) return false;
  if (TITLES.has(key)) return true;
  const nextIsCapital = /^\s+[A-Z]/.test(text.slice(i + 1, i + 4));
  if (!nextIsCapital) return true;
  const before = text.slice(Math.max(0, i - word.length - 30), i - word.length);
  const previousWord = /([A-Za-z]+)\W*$/.exec(before)?.[1] ?? "";
  const opensName = ["st", "mt", "ft"].includes(key) && !/^[A-Z]/.test(previousWord);
  return opensName;
}
/** The first clause break in `text` that is not a short form's stop. */
function clauseStop(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (CLAUSE_BREAK.test(text[i]) && !abbreviationStop(text, i)) return i;
  }
  return -1;
}
/** Words a name never begins or ends on: it would be hanging off a sentence. */
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
  // A name never ends on the word that introduced its date ("open houses
  // beginning Oct. 1" prints "open houses", not "open houses beginning").
  "after",
  "before",
  "beginning",
  "ending",
  "starting",
  "through",
  "until",
]);
/** A word as this module compares it: lowercase, with its punctuation off. */
function plain(word: string): string {
  return word.toLowerCase().replace(/[^\w'-]/g, "");
}

/**
 * A clock time in a story's words: "6 p.m.", "6:30 p.m.", "7am".
 *
 * Unit CV, item 3. The design prints a time beside the name when the story
 * gives one ("Free senior meal pickups begin, 3 p.m."), and the story is the
 * only place the time can come from. Only the shapes this paper writes are read
 * -- an hour, an optional minute, a meridiem -- because a bare number near a
 * date is a day, a year or a street number far more often than a time.
 */
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![\w.])/gi;

/** The clock as the design writes it: "6 p.m.", "6:30 p.m.". */
function clockOf(match: RegExpMatchArray): string {
  return `${Number(match[1])}${match[2] ? `:${match[2]}` : ""} ${match[3].toLowerCase()}.m.`;
}

/**
 * The clock time the story gives for a date, or `""`.
 *
 * The clock has to sit in the date's own sentence -- no `.`, `!` or `?` between
 * them -- and within `TIME_WORDS` words of the date expression, on either side.
 * "Pickups begin at 3 p.m. and run through the winter", printed under a
 * headline that names Oct. 2, is that date's time (the headline carries no full
 * stop, so the two are one sentence); a clock in the paragraph after the date's
 * sentence is some other event's. Of the clocks that qualify, the nearest wins.
 */
function clockNear(text: string, start: number, end: number): string {
  let best = "";
  let bestGap = Number.POSITIVE_INFINITY;
  for (const match of text.matchAll(CLOCK)) {
    const at = match.index ?? 0;
    const between = at >= end ? text.slice(end, at) : text.slice(at, start);
    if (/[.!?]/.test(between)) continue;
    const gap = between.split(/\s+/).filter(Boolean).length;
    if (gap > TIME_WORDS || gap >= bestGap) continue;
    bestGap = gap;
    best = clockOf(match);
  }
  return best;
}

/** Where the sentence or clause the date sits in begins. */
function clauseStart(text: string, start: number): number {
  for (let i = start - 1; i >= 0; i -= 1) {
    if (";:.—–!?.".includes(text[i]) && !abbreviationStop(text, i)) return i + 1;
  }
  return 0;
}

/** One date expression, as `scanDates` found it, with its two neighbours. */
type DateHit = { start: number; end: number; prev: number; next: number; days: string[] };

/**
 * The clause a date sits in, with the date expression itself taken out.
 *
 * Unit CV, item 2, rule (b). The clause is bounded by the punctuation
 * `CLAUSE_BREAK` names and by the neighbouring date expressions: it stops at
 * whichever comes first, so it can never run across a semicolon into what the
 * story says next, and it can never swallow a second date's own words. A date
 * that follows another date in the same clause has no words of its own on its
 * left -- the words in between are the earlier date's, as in "...schedules
 * Sept. 26 canvassing day and Oct. 3 Brighton event...", where the 26th owns
 * "canvassing day" and the 3rd owns "Brighton event" -- so `prev` cuts `left`
 * away in that case, and the name is what the story says AFTER the date.
 *
 * The panel prints the day in its own column, which is why the date expression
 * is what comes out. What remains is mended at the join (an article left
 * disagreeing with the word the date was keeping it from: "posted an Oct. 1 ...
 * packet" reads "posted a ... packet"), loses a trailing function word and --
 * unless it is the sentence's own opening -- a leading joiner, and may still be
 * a scrap: `phraseName` is the test for that, kept separate so a scrap costs the
 * row its words rather than the day.
 */
function clauseName(text: string, hit: DateHit): string {
  const clause = clauseStart(text, hit.start);
  /*
    The clock the story gives for this date is printed by the row itself (unit
    CV, item 3: "free meal pickups, 3 p.m."), so its own words are not part of
    the clause. Left in, "the hearing for education agencies is set for Oct. 6 at
    6 p.m." printed "…is set for at 6 p, 6 p.m." -- the time twice, and a stump of
    it where the clause was cut. The clock comes out of the tail BEFORE the
    clause's end is looked for, because the full stops inside "p.m." are
    themselves a clause break; taking the clock out first also makes the word
    before it the clause's own end, so the "for" the date was the object of is
    dropped by the joiner test below rather than stranded.
  */
  const tail = text.slice(hit.end, hit.next).replace(CLOCK, " ");
  const stop = clauseStop(tail);
  const left =
    clause >= hit.prev
      ? text.slice(clause, hit.start).replace(CLOCK, " ").split(/\s+/).filter(Boolean)
      : [];
  const right = tail
    .slice(0, stop < 0 ? tail.length : stop)
    .split(/\s+/)
    .filter(Boolean);
  const words = [...left, ...right];
  if (left.length && right.length) {
    const at = left.length - 1;
    if (plain(words[at]) === "a" || plain(words[at]) === "an") {
      words[at] = /^[aeiou]/i.test(right[0]) ? "an" : "a";
    }
  }
  while (words.length > 1 && JOINERS.has(plain(words[words.length - 1]))) words.pop();
  /*
    The leading joiner is dropped only when the clause was CUT out of a sentence
    and the word in front of it is the joint to words the row is not printing
    ("...schedules Sept. 26 canvassing day and Oct. 3 Brighton event" -- the 26th
    must not inherit the "and"). A clause whose first word is the sentence's own
    first word keeps it even when it is an article: "The board has posted an Oct.
    1 funding hearing packet" is the complete sentence rule (b) is looking for,
    and taking its "The" away leaves a line that opens lower-case, which
    `phraseName` then refuses as a fragment -- costing the day its own words for
    no reason a reader could see.
  */
  const opensSentence = clause === 0 && hit.start > 0;
  if (!opensSentence) {
    while (words.length > 1 && JOINERS.has(plain(words[0]))) words.shift();
  }
  return words
    .join(" ")
    .replace(/[\s,;:.!?–—-]+$/, "")
    .trim();
}

/**
 * `clause` as a row's name, or `""` when it is not one.
 *
 * The text a reader sees has to read as a complete phrase (unit CV, item 2:
 * "never output a fragment"). It starts at a word boundary with a capital --
 * the clause's own first word, or the nearest name inside it, since a clause
 * read out of the middle of a sentence carries the words before the name too --
 * and it is refused outright when what is left is a scrap. `isBareFragment` is
 * the judgement: it opens lower-case or on a digit, or ends on a function word,
 * or is too short to stand without a verb of its own. The word bound is the
 * brief's own "~12 words around the date"; a clause longer than that is a
 * sentence the panel would be reprinting, and the row falls to the headline.
 */
function phraseName(clause: string): string {
  const words = clause.split(/\s+/).filter(Boolean);
  const opening = words.findIndex((word) => /^[A-Z]/.test(word));
  if (opening < 0) return "";
  if (words.length - opening > NAME_WORDS) return "";
  const line = words.slice(opening).join(" ");
  return isBareFragment(line) ? "" : line;
}

/**
 * A curated set of verbs that show up in this paper's event lines. Not a POS
 * tagger -- a short list good enough to tell "Council sets the budget
 * adoption vote" (a clause with a verb) from "funding hearing packet" (a bare
 * noun phrase) without one.
 */
const KNOWN_VERBS = new Set([
  "advance",
  "advances",
  "approve",
  "approves",
  "begin",
  "begins",
  "cancel",
  "cancels",
  "convene",
  "convenes",
  "delay",
  "delays",
  "end",
  "ends",
  "extend",
  "extends",
  "hold",
  "holds",
  "host",
  "hosts",
  "launch",
  "launches",
  "meet",
  "meets",
  "open",
  "opens",
  "post",
  "posts",
  "reopen",
  "reopens",
  "resume",
  "resumes",
  "reschedule",
  "reschedules",
  "return",
  "returns",
  "revisit",
  "revisits",
  "sets",
  "set",
  "start",
  "starts",
  "vote",
  "votes",
  "weigh",
  "weighs",
]);

/** How few words make a line too short to stand alone without a verb. */
const BARE_FRAGMENT_WORDS = 4;

/**
 * The words a name cannot END on: an article, a conjunction, or a preposition.
 *
 * A name that stops on one of these stops on the joint to the next word -- "the
 * meeting is cancelled, while agency funding hearings remain listed for" is not
 * a sentence that ran out, it is a sentence cut off -- which is what a clause
 * lifted out of a longer one looks like when the cut is made by punctuation and
 * a word cap rather than by grammar (unit CN, item 2: the staged 0.6.80 row
 * "8 regular meeting is cancelled, while agency funding hearings remain listed
 * for"). `clauseName` drops a trailing `JOINERS` word itself, so this list is
 * what catches the rest of them -- "and", "while" and the other conjunctions a
 * clause can stop on, which no list of joiners carries.
 */
const TRAILING_FUNCTION_WORDS = new Set([
  // Articles.
  "a",
  "an",
  "the",
  // Conjunctions. A clause the desk wrote can stop on one of these when the cut
  // is made by a word cap rather than by grammar, and "Public Hearing Set while"
  // reads as a sentence that was cut off.
  "and",
  "or",
  "but",
  "nor",
  "yet",
  "so",
  "plus",
  "while",
  "when",
  "as",
  "because",
  "if",
  "that",
  "than",
  "though",
  "unless",
  "until",
  "whether",
  // Prepositions that cannot also be the particle a phrasal verb ends on. "up",
  // "out", "off", "down", "over" and "through" are deliberately absent: "the
  // instrument drive kicks off" and "applications close out" are lines that END
  // there and read as lines, and refusing one costs a row its own text.
  "about",
  "above",
  "across",
  "after",
  "against",
  "along",
  "among",
  "around",
  "at",
  "before",
  "behind",
  "below",
  "beneath",
  "beside",
  "between",
  "beyond",
  "by",
  "despite",
  "during",
  "except",
  "for",
  "from",
  "inside",
  "into",
  "near",
  "of",
  "on",
  "outside",
  "past",
  "since",
  "to",
  "toward",
  "towards",
  "under",
  "upon",
  "with",
  "within",
  "without",
]);

/**
 * Is `line` a bare scrap rather than something that reads as a name?
 *
 * Unit BZ, item 6 (owner review, 2026-09-27, "This week" at 1790px): rows
 * printed fragments lifted verbatim out of a clause -- "funding hearing
 * packet", "instrument collection drive", "Brighton event", "Applications
 * Close" -- lower-case scraps and short bare nouns with no verb of their own.
 * What they are not is a HEADLINE: a reader who has not read the story cannot
 * tell what "Brighton event" is an event FOR. A line that opens lower-case
 * reads as torn out of a sentence (that is the whole reason `clauseName` strips
 * leading joiners); a short line with no verb of its own is a label, not a
 * sentence.
 *
 * Unit BZ, item 6 also refused the two-word clause "Applications Close Sept.
 * 29": it reads as a clause, but a two-word phrase is still too short to stand
 * alone as a row's only text.
 *
 * Unit CN, item 2 (owner review, 2026-09-27) adds the two shapes a line takes
 * when it is CUT OUT of a longer sentence rather than lifted from it, neither
 * of which the tests above catch because a cut line can still open on a capital
 * and can still be long:
 *
 *  - it opens on a digit. The panel prints the day in its own column, so a line
 *    that opens on a day number is a line that starts in the middle of a date
 *    expression -- the live row began "8 regular meeting is cancelled", which is
 *    the tail of "cancelled Oct. 8 regular meeting" with the "Oct." left behind
 *    by the punctuation cut.
 *  - it ends on a function word -- an article, a conjunction, a preposition --
 *    because a sentence does not end there. See `TRAILING_FUNCTION_WORDS`.
 *
 * Unit CV, item 2 keeps this as the final test on every name the three rules
 * produce (`phraseName`): the brief's "never output a fragment" is this
 * function, applied after the date has been taken out of the clause.
 *
 * Tried and removed, unit CV: refusing a short line that ENDS on a word in
 * `KNOWN_VERBS`, on the reading that the date was the verb's object and the line
 * has lost it ("Council meets Oct. 1"). It refuses a shape it cannot see. "Oct.
 * 1 Funding Hearing Packet Posted" ends on the participle of a line whose object
 * sits in front of it, so the whole Oct. 1 row of a story that names two days
 * disappeared from the panel -- measured, not theorised: `story-dates.test.ts`,
 * "gives a day the headline is not about the dek's own clause for it". The same
 * test refuses "Council sets the budget adoption vote", whose last word is the
 * noun "vote". Telling those from "Council meets" needs the part of speech, and
 * a line with a subject and a verb is not the fragment the brief forbids -- the
 * live fragment was "Applications Close", which has no subject at all and is
 * caught below by the word count.
 */
function isBareFragment(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (/^[a-z]/.test(words[0])) return true;
  if (/^\d/.test(words[0])) return true;
  const last = plain(words[words.length - 1]);
  if (TRAILING_FUNCTION_WORDS.has(last)) return true;
  if (words.length >= BARE_FRAGMENT_WORDS) return false;
  return !words.some((word) => KNOWN_VERBS.has(plain(word)));
}

/**
 * How far a date expression runs past the day `WORDED_DAY` matched, and the
 * further days it names: `{ end }` is where the expression stops and `more` is
 * every listed day after the first (a range names none -- see `RANGE_TAIL`).
 *
 * The scan is anchored at the day itself, so it moves only over a dash, a
 * comma, an "and"/"&" and the number after it. A month name is none of those,
 * which is what keeps "Sept. 26 canvassing day and Oct. 3" two dates rather
 * than one.
 */
function readDayTail(text: string, from: number): { end: number; more: number[] } {
  let end = from;
  const more: number[] = [];
  for (;;) {
    const range = RANGE_TAIL.exec(text.slice(end));
    if (range) {
      end += range[0].length;
      continue;
    }
    const list = LIST_TAIL.exec(text.slice(end));
    if (list) {
      more.push(Number(list[1]));
      end += list[0].length;
      continue;
    }
    return { end, more };
  }
}

/** One day of a date expression, on the year the expression names or implies. */
function dayOn(
  day: number,
  month: number,
  writtenYear: string | undefined,
  publishedOn: string,
): string {
  // A written year is the date's own and is never second-guessed.
  if (writtenYear) return dayOf(day, month, Number(writtenYear));
  const year = Number(publishedOn.slice(0, 4));
  const candidate = dayOf(day, month, year);
  return candidate && candidate < addDays(publishedOn, -ROLL_DAYS)
    ? dayOf(day, month, year + 1)
    : candidate;
}

/**
 * Every month-name date expression in `text`, with the days it names resolved
 * against `publishedOn`.
 *
 * `days` is every day the expression names, in the order it names them: a list
 * ("Oct. 1 and 8") is two, a range ("Oct. 1-2") is one, because a range names
 * its first day. `start` and `end` bound the expression itself, `prev` and
 * `next` the expressions either side of it, which is what the words around a
 * date -- its clause -- are read from. A text with no month-name date in it is
 * no expressions at all.
 */
function scanDates(text: string, publishedOn: string): DateHit[] {
  if (!text || !publishedOn) return [];
  const matches = [...text.matchAll(WORDED_DAY)];
  /* The whole expression, not just its first day: "Oct. 1-2" ends after the 2
     and "Oct. 1 and 8" after the 8, so neither tail is read as the words. */
  const ends = matches.map((match) => readDayTail(text, (match.index ?? 0) + match[0].length).end);
  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const tail = readDayTail(text, start + match[0].length);
    const month = monthNumber(match[1]);
    // The day the expression does not name is the calendar's to refuse
    // ("Oct. 1 and 32"), and it is dropped here rather than carried on.
    const days = [Number(match[2]), ...tail.more]
      .map((day) => dayOn(day, month, match[3], publishedOn))
      .filter(Boolean);
    return {
      start,
      end: tail.end,
      prev: i > 0 ? ends[i - 1] : 0,
      next: i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length,
      days,
    };
  });
}

/**
 * The dates a printed story names in its own words, with a name for each.
 *
 * `publishedOn` is the story's own calendar day and resolves a date that names
 * no year. `ctx` is the story as a whole, which is what the three rules are
 * answered from (unit CV, item 2), in order:
 *
 *  (a) the headline names this day: the name is the headline's own clause for
 *      it, with the date taken out ("...Cancels Oct. 8 Regular Meeting..." reads
 *      "Longmont Housing Board Cancels Regular Meeting"); and if that clause is
 *      a scrap, the whole headline is the answer instead, because the day came
 *      out of it and it is about this day by construction;
 *  (b) otherwise the clause the date sits in -- the headline's or the dek's --
 *      with the date taken out ("The board has posted a funding hearing packet
 *      ahead of the meeting");
 *  (c) otherwise the story's headline, and only when the headline is about this
 *      day or names no day at all (unit BZ, item 5: a day the headline is not
 *      about is answered by its own clause or dropped, never by the wrong day's
 *      headline).
 *
 * A day none of the three can name is dropped rather than printed as a scrap --
 * the brief's own "never output a fragment" -- and a clock the story gives for
 * the day is carried with the name (unit CV, item 3).
 *
 * Nothing here reads a value the story does not carry: a text with no
 * month-name date in it returns nothing at all, and a day whose row has nothing
 * to print returns no row.
 */
function wordedDates(
  text: string,
  fromHeadline: boolean,
  publishedOn: string,
  ctx: { headline: string; headlineHits: DateHit[]; whole: string; offset: number },
): { date: string; what: string }[] {
  const found: { date: string; what: string }[] = [];
  for (const hit of scanDates(text, publishedOn)) {
    /* The name is answered per day, not per expression: one expression may name
       several days ("Oct. 1 and 8"), and whether the headline is about a day is
       a question about that day. */
    for (const date of hit.days) {
      const inHeadline = ctx.headlineHits.find((named) => named.days.includes(date));
      // Rule (a), then rule (b) -- which is the same clause again when the text
      // IS the headline and the headline named this day, and would only refuse
      // itself a second time.
      let what = inHeadline ? phraseName(clauseName(ctx.headline, inHeadline)) : "";
      if (!what && !(fromHeadline && inHeadline)) what = phraseName(clauseName(text, hit));
      if (!what) {
        // Rule (c). A headline that names some OTHER day is not this row's to
        // print (unit BZ, item 5).
        const said = ctx.headline.trim();
        const names = ctx.headlineHits.length > 0;
        what = said && (!names || inHeadline) ? said : "";
      }
      if (!what) continue;
      const clock = clockNear(ctx.whole, ctx.offset + hit.start, ctx.offset + hit.end);
      found.push({ date, what: clock ? `${what}, ${clock}` : what });
    }
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
 * BX2). One calendar day is printed once per story, and one event once for the
 * whole paper (unit CV, item 1). A story whose headline and record both name
 * Oct. 1 gives the day to its record -- a record is a dated thing the newsroom
 * kept, which is the more specific answer for that day -- and a story that
 * names the same day twice in its headline and its dek, or two stories that name
 * the same event, print it once. Where two rows collide the more specific one is
 * the row that stays.
 */

/** How specific a row is: a record the newsroom kept, then a story's words. */
const RECORD_RANK = 2;
const WORDED_RANK = 1;

/** A row's text as an event key: case and punctuation set aside. */
function eventKey(what: string): string {
  return what
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectStoryDates(
  sources: StoryDateSource[],
  { from, days, limit = 12 }: { from?: string; days?: number; limit?: number } = {},
): StoryDateItem[] {
  const to = from && days !== undefined ? addDays(from, days) : "";
  const items: StoryDateItem[] = [];
  /** The row holding each day of each story, and each event of the paper. */
  const heldDays = new Map<string, { at: number; rank: number }>();
  const heldEvents = new Map<string, { at: number; rank: number }>();
  /** The rows a more specific row has displaced, by their place in `items`. */
  const displaced = new Set<number>();
  const take = (
    source: StoryDateSource,
    date: string,
    what: string,
    note: string,
    rank: number,
  ) => {
    if (!date || !what) return;
    if (from && date < from) return;
    if (to && date >= to) return;
    const day = heldDays.get(`${source.slug}|${date}`);
    if (day && day.rank >= rank && !displaced.has(day.at)) return;
    const event = heldEvents.get(`${date}|${eventKey(what)}`);
    if (event && event.rank >= rank && !displaced.has(event.at)) return;
    const at = items.length;
    const item: StoryDateItem = { date, what };
    if (note) item.note = note;
    if (source.slug) item.slug = source.slug;
    items.push(item);
    if (day) displaced.add(day.at);
    if (event) displaced.add(event.at);
    heldDays.set(`${source.slug}|${date}`, { at, rank });
    heldEvents.set(`${date}|${eventKey(what)}`, { at, rank });
  };
  for (const source of sources) {
    for (const record of source.records) {
      // The window's first day is also what a day with no year is read against.
      take(
        source,
        structuredDate(record.document_date, from ?? ""),
        record.title.trim() || "A record we kept",
        hostOnly(record.organization),
        RECORD_RANK,
      );
    }
    // The story's own words, read against its own publish day. The headline is
    // scanned once for the story: it is what rule (a) takes a name from, and
    // what decides whether rule (c) may print it at all.
    const publishedOn = source.published_on ?? "";
    const headline = source.headline ?? "";
    const dek = source.dek ?? "";
    const ctx = {
      headline,
      headlineHits: scanDates(headline, publishedOn),
      whole: dek ? `${headline} ${dek}` : headline,
      offset: 0,
    };
    for (const worded of [
      ...wordedDates(headline, true, publishedOn, ctx),
      ...wordedDates(dek, false, publishedOn, { ...ctx, offset: headline.length + 1 }),
    ]) {
      take(source, worded.date, worded.what, "", WORDED_RANK);
    }
  }
  return items
    .filter((_, at) => !displaced.has(at))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, limit);
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
