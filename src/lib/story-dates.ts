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
 * UNIT BZ, ITEM 5. The headline is the last line a row falls back to, and it is
 * not always about the day the row is on. The live front page's Thu Oct. 1 row
 * printed "Longmont Housing Board Cancels Oct. 8 Regular Meeting; Funding
 * Hearings Still On", because the story named Oct. 1 in its dek and Oct. 8 in
 * its headline, and the dek's own clause for the 1st was not clean enough to
 * print as a line. A reader could take that row for a cancellation on the 1st.
 * So a row prints the headline only for a day the headline names -- or for a
 * story whose headline names no day at all, where it is still the story's own
 * words -- and a day the headline is not about takes the dek's own clause for
 * that day instead, with the date taken out of it. A day the dek gives no such
 * clause for is dropped: a missing row is worth more than a row that sends the
 * reader to the wrong day.
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
 */
const RANGE_TAIL = /^\s*[-–—]\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?/;
const LIST_TAIL = /^\s*(?:,|and\b|&)\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?/;
/** Words that never OPEN a line: they join it to something already said. */
const CONJUNCTIONS = new Set(["and", "or", "but", "nor", "yet", "so", "plus"]);

/** How many words an event line carries before it stops. */
const EVENT_WORDS = 6;
/** How many words a line written BEFORE its date may run; longer is a headline. */
const BEFORE_WORDS = 6;
/** How many words a dek clause may run when it is the row's last resort. */
const CLAUSE_WORDS = 12;
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

/** Every word of `line` opens on a capital letter ("Clark Centennial Park"). */
function allCapitalized(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((word) => /^[A-Z]/.test(word));
}

/**
 * The words around a date, cut down to one line a panel can print.
 *
 * `raw` is the piece of the sentence the date sits in; the line ends at the
 * first punctuation mark, drops a leading joiner ("to an Oct. 6 hearing" reads
 * "hearing"), stops before a word that opens a trailing phrase or a new clause
 * ("Brighton event for 3C and 3D" reads "Brighton event") and drops a trailing
 * joiner ("canvassing day and Oct. 3" reads "canvassing day").
 *
 * A line that is left as a single joiner, that opens on a verb, or that is a
 * fragment of one -- what is left of a longer sentence -- is no line at all.
 * Unit BX3 sharpened this: the live front page printed "-2 instrument
 * collection drive" and "8 regular meeting", each the tail of a date the reader
 * had stopped short of reading, so a line that opens on a digit, a dash, a
 * comma or a conjunction is refused, and so is one of fewer than two words.
 *
 * `fromHeadline` is where `raw` was cut from, and it decides one case: a line
 * whose every word opens on a capital letter reads as a NAME -- a place, a
 * building, a body -- and not as what happens there ("at the Longmont Senior
 * Center", "Oct. 3 at Clark Centennial Park" both print the story's headline
 * now). The exception is a headline's own title case, which is the desk's
 * style rather than a signal: "Applications Close Sept. 29" is a clause about
 * what happens, every word capital only because a headline is written that way,
 * and it stays.
 *
 * Unit BX3 sharpened the exception to the exception. It used to be an all-cap
 * line cut from a headline, full stop, and that kept the live paper's worst
 * line: the real headline "Longmont Senior Center to begin free meal pickups
 * Oct. 2" printed the venue on Fri 2, because the STOP_WORDS loop cut the
 * sentence at "to" and left a bare subject behind. An all-cap line is now kept
 * only when nothing was cut off it -- "Applications Close" is the whole clause,
 * while "Longmont Senior Center" is what is left of one whose verb phrase was
 * cut away, which is a NAME. A line we reached by stripping a preposition is a
 * place whatever it was cut from -- the phrase is the preposition's object.
 */
function cleanLine(raw: string, maxWords: number, fromHeadline: boolean): string {
  const stop = raw.search(CLAUSE_BREAK);
  let words = (stop < 0 ? raw : raw.slice(0, stop)).trim().split(/\s+/).filter(Boolean);
  let stripped = false;
  while (words.length > 1 && JOINERS.has(plain(words[0]))) {
    words = words.slice(1);
    stripped = true;
  }
  if (words.length > 0 && AUXILIARIES.has(plain(words[0]))) return "";
  let truncated = false;
  for (let i = 1; i < words.length; i += 1) {
    if (STOP_WORDS.has(plain(words[i]))) {
      words = words.slice(0, i);
      truncated = true;
      break;
    }
  }
  while (words.length > 1 && JOINERS.has(plain(words[words.length - 1]))) words.pop();
  const line = words.slice(0, maxWords).join(" ").replace(/[\s,;:.—–!?-]+$/, "").trim();
  if (words.length < 2) return "";
  if (/^[\d\-,;:.–—]/.test(line)) return "";
  if (CONJUNCTIONS.has(plain(words[0]))) return "";
  if (allCapitalized(line) && !(fromHeadline && !stripped && !truncated)) return "";
  return line;
}

/** Where the sentence or clause the date sits in begins. */
function clauseStart(text: string, start: number): number {
  for (let i = start - 1; i >= 0; i -= 1) {
    if (";:.—–!?.".includes(text[i])) return i + 1;
  }
  return 0;
}

/**
 * The event line for one date: the words around it when they are clean, and
 * nothing at all when they are not.
 *
 * `next` is where the following date in the same text begins, so a line never
 * runs into the next date's own words ("canvassing day and Oct. 3" gives the
 * 26th its line and the 3rd its own). A line written BEFORE the date is used
 * only when it is short and whole ("Applications Close Sept. 29"); a long one
 * is just the headline with the date taken out of it, and the headline is what
 * gets printed.
 *
 * What a row with no line of its own prints is the caller's question, not this
 * function's: `fallbackLine` answers it, and the answer depends on the day the
 * row is on (unit BZ, item 5).
 */
function eventLine(
  text: string,
  start: number,
  end: number,
  next: number,
  fromHeadline: boolean,
): string {
  const after = cleanLine(text.slice(end, next), EVENT_WORDS, fromHeadline);
  if (after) return after;
  const before = cleanLine(text.slice(clauseStart(text, start), start), BEFORE_WORDS + 99, fromHeadline);
  if (before && before.split(" ").length <= BEFORE_WORDS) return before;
  return "";
}

/**
 * The dek's own clause for a day, with the date expression taken out of it.
 *
 * Unit BZ, item 5. This is what a row prints when the story's words around the
 * date were not clean enough to be a line and the headline is about another
 * day: the clause the day sits in, as the desk wrote it for that day.
 *
 * The clause is bounded the way a line is -- by the punctuation `CLAUSE_BREAK`
 * names, on both sides of the date -- so it can never run across a semicolon
 * into what the dek says next, and it cannot swallow a second date's own clause.
 * What is taken off is the date expression itself: the panel prints the day in
 * its own column, and the line is what the day is about.
 *
 * The words are deliberately NOT put through `cleanLine`. The only reason this
 * path exists is that the clean-line test refused them; asking it again would
 * refuse them again and leave the row with nothing, which is the outcome this
 * path is here to avoid. The one test kept is `cleanLine`'s own floor -- fewer
 * than two words is a fragment, not a line -- so a clause that is nothing but
 * the date and one word gives `""`, and the row is dropped. The word cap is a
 * bound on the panel rather than a reading: a clause longer than it is cut at a
 * word boundary.
 */
function dekClause(dek: string, start: number, end: number): string {
  const from = clauseStart(dek, start);
  const stop = dek.slice(end).search(CLAUSE_BREAK);
  const words = `${dek.slice(from, start)} ${dek.slice(end, stop < 0 ? dek.length : end + stop)}`
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s,;:.!?–—-]+/, "")
    .replace(/[\s,;:.!?–—-]+$/, "")
    .split(" ")
    .filter(Boolean);
  if (words.length < 2) return "";
  return words.slice(0, CLAUSE_WORDS).join(" ");
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
 * The words a line cannot END on: an article, a conjunction, or a preposition.
 *
 * A line that stops on one of these stops on the joint to the next word -- "the
 * meeting is cancelled, while agency funding hearings remain listed for" is not
 * a sentence that ran out, it is a sentence cut off -- which is what a line
 * lifted out of a longer one looks like when the cut is made by punctuation and
 * a word cap rather than by grammar (unit CN, item 2: the staged 0.6.80 row
 * "8 regular meeting is cancelled, while agency funding hearings remain listed
 * for"). `cleanLine` already refuses such a line for the clause it extracts,
 * because it truncates at `STOP_WORDS` and strips trailing `JOINERS`; the list
 * is repeated here for the lines that never went through it (`dekClause`, and
 * `own` for the conjunctions `STOP_WORDS` does not carry -- "and", "while").
 */
const TRAILING_FUNCTION_WORDS = new Set([
  // Articles.
  "a",
  "an",
  "the",
  // Conjunctions. These are the words that matter for a line `cleanLine`
  // produced: it truncates at `STOP_WORDS` (the prepositions and the
  // auxiliaries) and strips the trailing `JOINERS` ("and", "or"), but it
  // carries no conjunction, so "Public Hearing Set while" is a line only this
  // list can catch.
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
 * Is `line` a bare scrap rather than something that reads as a headline?
 *
 * Unit BZ, item 6 (owner review, 2026-09-27, "This week" at 1790px): rows
 * printed fragments lifted verbatim out of a clause -- "funding hearing
 * packet", "instrument collection drive", "Brighton event", "Applications
 * Close" -- lower-case scraps and short bare nouns with no verb of their own.
 * `cleanLine` and its exceptions (title case, the "not a name" carve-out) were
 * built to keep a clause that reads as an event; they still let these four
 * through because each is grammatically a clause (a subject and, for
 * "Applications Close", even a verb). What they are not is a HEADLINE: a
 * reader who has not read the story cannot tell what "Brighton event" is an
 * event FOR. A line that opens lower-case reads as torn out of a sentence
 * (that is the whole reason `cleanLine` strips leading joiners); a short line
 * with no verb of its own is a label, not a sentence.
 *
 * This supersedes the title-case exception `cleanLine` documents for
 * "Applications Close Sept. 29": that exception was about telling a NAME
 * (venue, building) from a clause, and it is still right about that -- but a
 * two-word clause is still too short to stand alone as a row's only text.
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
 *    by the punctuation cut `dekClause` makes. (`cleanLine` already refuses this
 *    shape for `own`; this is the same rule for the lines it never saw.)
 *  - it ends on a function word -- an article, a conjunction, a preposition --
 *    because a sentence does not end there. See `TRAILING_FUNCTION_WORDS`.
 */
function isBareFragment(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (/^[a-z]/.test(words[0])) return true;
  if (/^\d/.test(words[0])) return true;
  if (TRAILING_FUNCTION_WORDS.has(plain(words[words.length - 1]))) return true;
  if (words.length >= BARE_FRAGMENT_WORDS) return false;
  return !words.some((word) => KNOWN_VERBS.has(plain(word)));
}

/**
 * What a row prints when the story's own words around the date said nothing.
 *
 * A row read out of the headline itself always keeps the headline: the day came
 * from the headline, so the headline is about it by construction. A row read
 * out of the dek keeps the headline only when the headline names this day too,
 * or names no day at all (unit BZ, item 5). A headline that names only OTHER
 * days is refused, and the day falls back to the dek's own clause for it --
 * `""` when the dek has none, which drops the row.
 *
 * `text` is the words the row was read out of, which is the dek for every row
 * that can reach the last branch.
 *
 * Unit CN, item 2. The dek's own clause is the last text a row can fall to, and
 * it is cut out of the dek by punctuation alone (`dekClause`, deliberately
 * without the clean-line test), so it can be exactly the shape unit CN adds to
 * `isBareFragment`: the staged 0.6.80 page's Thu Oct. 1 row read "8 regular
 * meeting is cancelled, while agency funding hearings remain listed for" -- the
 * clause for the 1st cut at the word cap, with the day number of the 8th left
 * in front of it. The headline is refused for that day (it is about the 8th),
 * so the row has nothing that is about the 1st to print: it is dropped, the
 * same outcome unit BZ item 5 gives a day the dek has no clause for, rather than
 * printing a sentence cut in half. A row whose headline IS about this day -- or
 * names no day at all -- never reaches this test; it keeps the headline.
 */
function fallbackLine(
  date: string,
  text: string,
  start: number,
  end: number,
  headline: string,
  publishedOn: string,
): string {
  const said = headline.trim();
  if (!said) return "A date this story names";
  const named = daysNamed(said, publishedOn);
  if (named.length === 0 || named.includes(date)) return said;
  const clause = dekClause(text, start, end);
  return isBareFragment(clause) ? "" : clause;
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
 * its first day. `start` and `end` bound the expression itself, which is what
 * the words around it -- and the row's fallback line -- are read from. A text
 * with no month-name date in it is no expressions at all.
 */
function scanDates(
  text: string,
  publishedOn: string,
): { start: number; end: number; next: number; days: string[] }[] {
  if (!text || !publishedOn) return [];
  const matches = [...text.matchAll(WORDED_DAY)];
  return matches.map((match, i) => {
    const start = match.index ?? 0;
    /* The whole expression, not just its first day: "Oct. 1-2" ends after the
       2 and "Oct. 1 and 8" after the 8, so neither tail is read as the line. */
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
      next: i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length,
      days,
    };
  });
}

/** The days a text names in its own words, resolved the way its rows are. */
function daysNamed(text: string, publishedOn: string): string[] {
  return scanDates(text, publishedOn).flatMap((hit) => hit.days);
}

/**
 * The dates a printed story names in its own words, with a line for each.
 *
 * `publishedOn` is the story's own calendar day and resolves a date that names
 * no year; `headline` is what a row with no line of its own falls back to, for
 * this day only. Nothing here reads a value the story does not carry: a text
 * with no month-name date in it returns nothing at all, and a day whose row has
 * nothing to print returns no row.
 */
function wordedDates(
  text: string,
  publishedOn: string,
  headline: string,
  fromHeadline: boolean,
): { date: string; what: string }[] {
  const found: { date: string; what: string }[] = [];
  for (const hit of scanDates(text, publishedOn)) {
    /* The line is answered once per expression and then per day: one expression
       may name several days ("Oct. 1 and 8") and the fallback is about the day,
       so the 1st and the 8th can read differently. */
    const own = eventLine(text, hit.start, hit.end, hit.next, fromHeadline);
    for (const date of hit.days) {
      /*
        A clause that reads as a bare scrap ("funding hearing packet",
        "Brighton event") is no better than no clause at all: it is routed
        through the same fallback an empty `own` already gets, which is what
        keeps this safe for a story whose headline is about a DIFFERENT day
        (unit BZ, item 5) -- `fallbackLine` prints the headline only when it
        names this date or names none at all, and otherwise falls to the
        dek's own clause for the day, never a scrap AND never the wrong day's
        headline.
      */
      const usable = own && !isBareFragment(own) ? own : "";
      const what = usable || fallbackLine(date, text, hit.start, hit.end, headline, publishedOn);
      if (what) found.push({ date, what });
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
      ...wordedDates(headline, publishedOn, headline, true),
      ...wordedDates(source.dek ?? "", publishedOn, headline, false),
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
