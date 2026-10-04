/**
 * Deterministic "is this the same story?" matcher for the scan lead loop.
 *
 * Today `performScanWork` inserts every AI-returned lead as a brand new row
 * with no check against what already exists, so a lead the editor already
 * killed comes back every scan and gets killed again. This matcher runs in
 * plain code -- no AI call, no token cost -- against leads already loaded
 * from Postgres, so the caller can stamp a match instead of inserting a
 * duplicate. See `findMatchingLead` below for the rule.
 *
 * Nothing here deletes or hides anything. A killed lead that matches keeps
 * every field it had; the caller (desk.ts) only adds a resurfaced stamp.
 *
 * Unit U26b (2026-09-30): the matcher's place words are the NEWSROOM's, passed
 * in by the caller (`place`), never this module's own. It used to read the
 * shipped Longmont constants, which meant a paper set up for another town got
 * Longmont's region treated as furniture and its own region treated as a fact
 * -- the same failure ENG-3 removed from the desk's searches. This module
 * imports nothing and reads no global: a caller that passes no place gets the
 * generic civic vocabulary only, and an unconfigured paper guesses nothing.
 */

/** Candidate lead statuses eligible to be matched against. A genuinely new
 * development on an already-published story is still news -- it should
 * file, not get folded into the old row -- so 'published' is excluded. */
export const MATCHABLE_STATUSES = new Set(["killed", "held", "new", "drafted"]);

/** How far back (in days) an existing lead is still considered live enough
 * to match against. A killed lead from a year ago resurfacing under a
 * near-identical headline is plausibly a new story about an old subject;
 * one from last week is almost certainly the same scan noise. */
export const MATCH_LOOKBACK_DAYS = 60;

/** Jaccard similarity of headline tokens at/above this threshold counts as
 * the same story when the two leads also share a source URL. */
const HEADLINE_JACCARD_THRESHOLD = 0.6;

/** Fraction of the *shorter* headline's tokens that must appear in the
 * other headline -- catches "council has two closed-door sessions in late
 * September" fully contained inside a longer reworded rewrite where the
 * Jaccard score (denominator inflated by the longer headline) would miss it. */
const HEADLINE_CONTAINMENT_THRESHOLD = 0.7;

/** With no shared source URL at all (e.g. a portal notice re-posted under a
 * different deep link), require a much higher headline overlap before
 * calling it the same story -- this is the sole signal at that point. */
const HEADLINE_ONLY_THRESHOLD = 0.85;

/** Unit AN (2026-10-03): how many non-furniture proper nouns two headlines
 * must share before a names-only pair counts as sharing distinguishing
 * evidence -- see sharesDistinguishingEvidence. Two, for the same reason
 * ANCHOR_MATCH_MIN_SHARED is two: one shared name is usually a PLACE
 * ("Bohn Farm", "Twin Peaks") and is not evidence of a shared subject, while
 * two independent names that survive properNounStoplist (a venue AND an
 * event, an organisation AND a person) are. */
const NAME_ONLY_MIN_SHARED = 2;

/** Unit AO (2026-10-03): the cheapest half of the candidate filter -- how
 * character-similar two normalized headlines must be before the pair is worth
 * classifying at all. See nearDuplicateSignals for the whole design; the
 * strong bar for the same signal is HEADLINE_ONLY_THRESHOLD (0.85), the same
 * number as the token-level "nothing but the wording differs" bar, because it
 * is the same argument measured on a finer instrument. */
const HEADLINE_RATIO_CANDIDATE = 0.7;

/** Unit R2, item 1 (2026-10-03): the ratio floor for the NAME-ONLY route to the
 * candidate tier -- the case where the shorter headline's every name appears in
 * the longer and there are at least four of them, but the wording overlaps less
 * than HEADLINE_RATIO_CANDIDATE. 433 "Wild Plum Center Plans 'Sweet 60'
 * Anniversary Gala for Six Decades of Head Start" against 277 "Wild Plum Center
 * marks 60 years with 'Sweet 60' anniversary gala" is 0.64 with all four names,
 * and is the same story. Lower than the general bar because the name agreement
 * is doing the work: four independent shared names at 60% of the characters is
 * not two headlines about different things. */
const NEAR_DUPLICATE_NAME_RATIO = 0.6;

/** Unit AO: a shared date:/amount: anchor, or a shared number that is not a
 * bare year -- see specificAnchors. One is enough at the classifying tier
 * where two are needed to pass the URL-sharing gate (ANCHOR_MATCH_MIN_SHARED),
 * and the difference is the name agreement both new routes require: this
 * tier's evidence is "the same specific fact AND the same subject", never a
 * fact on its own. */
const NEAR_DUPLICATE_ANCHOR_MIN_SHARED = 1;

/**
 * Real miss (2026-09-02): "Council books two executive sessions in eight
 * days -- Sept. 22 and Sept. 29 -- with packets already posted" filed as a
 * new lead while "Longmont council has two closed-door executive sessions
 * on the books for late September" (status drafted) already existed from
 * the same PrimeGov portal page. Word overlap between those two headlines
 * is low (few words survive both the stopword filter and the rewrite), so
 * neither HEADLINE_JACCARD_THRESHOLD nor HEADLINE_CONTAINMENT_THRESHOLD
 * fires even though a source URL is shared.
 *
 * "Anchors" are the concrete, hard-to-coincidentally-restate details in a
 * headline: specific dates, dollar amounts, other multi-digit numbers, and
 * proper nouns that are not the newsroom's own place or civic furniture (see
 * properNounStoplist). When a source URL is already shared, two headlines
 * that pin down >= ANCHOR_MATCH_MIN_SHARED of the same concrete details are
 * the same story even when their prose barely overlaps.
 *
 * A bare month mention with no day ("late September") is too vague to be
 * its own anchor, but it is also not *nothing*: it is compatible with any
 * specific date in that month on the other headline. sharedAnchorCount
 * credits that bare-month/specific-date pairing once per specific date it
 * covers, which is what lets this exact real pair match: "late September"
 * (existing) is consistent with both "Sept. 22" and "Sept. 29" (candidate),
 * clearing the >= 2 bar without ever requiring the vaguer headline to name
 * a day. A single shared exact date (both headlines say "Sept. 22" and
 * nothing else in common) stays at 1 and does not match -- see the matcher
 * tests for the negative case this is meant to keep excluded.
 */
export const ANCHOR_MATCH_MIN_SHARED = 2;

/**
 * The newsroom's own place: the city it covers, its state, and the county its
 * owner typed into Paper setup (`dark_settings.county`, read by
 * `getPaperPlace` in ./paper-settings.ts -- the same source `readDarkPlace`
 * and the paper identity use).
 *
 * Every field is optional and nullable on purpose. A paper that has not said
 * where it is has no region words at all, and this module never guesses one:
 * the shipped Longmont constants are one newsroom's answer, not a default.
 */
export type NewsroomPlace = {
  city?: string | null;
  state?: string | null;
  county?: string | null;
};

/**
 * The region's own words -- the words that say WHERE a story is, not WHAT it
 * is. Every word of every configured place: a place name made of two words
 * ("Boulder County", "Colorado Springs") contributes both, since either half
 * alone still names the region. Nothing configured yields nothing.
 */
function regionWords(place?: NewsroomPlace | null): string[] {
  return [place?.city, place?.state, place?.county]
    .flatMap((part) => String(part ?? "").trim().toLowerCase().split(/[^a-z]+/))
    .filter(Boolean);
}

/**
 * Generic civic vocabulary: the furniture of every government story in every
 * jurisdiction. "County", "board", "court" and "department" are compatible
 * with any city hall or county seat anywhere -- the same reason CONTENT_STOPLIST
 * exists -- so they cannot tell one story from another. These are the words a
 * paper that has named no place still gets, and they are what keeps the
 * owner's 2026-09-30 pair apart even without a configured county: "County"
 * alone is one anchor against a two-anchor bar (see below).
 *
 * Deliberately does NOT include the words that name WHO said something rather
 * than what happened ("commissioners", "officials"): those are the words two
 * unrelated items on one meeting page most often share, and QA-1's negative
 * set (NEG-4, NEG-9) depends on them still counting as content words when a
 * pair shares a real meeting date.
 */
const CIVIC_FURNITURE_WORDS = [
  "county", "state", "city", "town", "village", "board", "commission",
  "council", "district", "department", "public", "government", "office",
  "federal", "court", "townreporter",
];

/** Months and weekdays. Unlike a specific date, a month is compatible with
 * every story filed that month, so it is never a fact on its own -- see
 * extractAnchors (a `date:MM-DD` still is). */
const CALENDAR_WORDS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

/**
 * Proper nouns that are the newsroom's own place and civic furniture, not a
 * distinguishing fact about the story -- excluded from anchor/proper-noun
 * extraction in this module and reused by desk-copy.ts's nearDuplicate() for
 * the same reason.
 *
 * U26 (2026-09-30), the owner's Queue: "U.S. Supreme Court to Hear Boulder
 * County Climate Suit Oct. 5" was chipped "Looks already printed: Boulder
 * County Proclaims Hispanic and Latinx Heritage Month, Listing Longmont's
 * Oct. 24 Day of the Dead Celebration". The pair shares nothing but "Boulder
 * County" and an October date -- and the old list, which named only Longmont,
 * city, council and Colorado, let "Boulder" + "County" count as two shared
 * anchors: as much evidence, by ANCHOR_MATCH_MIN_SHARED, as a shared meeting
 * date plus a shared dollar figure. Nothing distinguishes two such headlines
 * except the region they both cover.
 *
 * U26b: the region half now comes from the caller's `place` (see
 * NewsroomPlace). Memoised by that place, because a scan matches every
 * candidate against every open lead and rebuilding a forty-word set inside
 * extractAnchors, twice per pair, is work with one answer. The set handed
 * back is the cached one -- read it, never write to it.
 */
const FURNITURE_CACHE = new Map<string, Set<string>>();

export function properNounStoplist(place?: NewsroomPlace | null): Set<string> {
  const region = regionWords(place);
  const key = [...region].sort().join(" ");
  const cached = FURNITURE_CACHE.get(key);
  if (cached) return cached;
  const set = new Set<string>([...CIVIC_FURNITURE_WORDS, ...CALENDAR_WORDS, ...region]);
  FURNITURE_CACHE.set(key, set);
  return set;
}

const MONTH_NUMBER: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/** Extract "anchors" from a headline: `date:MM-DD` for a specific date,
 * `month:MM` for a bare month mention with no day, `amount:$N` for a
 * dollar figure, `num:N` for any other number with >= 2 digits, and
 * `noun:word` for a capitalised word that is not the newsroom's own place or
 * civic furniture (properNounStoplist, fed by `place`). Matched spans are
 * blanked out of the working copy as they're consumed so a date's day number
 * isn't also counted as a bare `num:` anchor and a date's month name isn't
 * also counted as a `noun:` anchor. */
/**
 * Unit AO (2026-10-03): one dollar figure, one anchor. `$547.5M` and `$547.5
 * million` are the same amount written two ways, and the scan model writes it
 * both ways -- live, "Longmont begins review of proposed $547.5 million 2027
 * operating budget" (lead 149, killed) against "Longmont's Proposed 2027
 * Budget: $547.5M Operating Plan..." (lead 435, scan 66). Until this, the two
 * stored `amount:$547.5` and `amount:$547.5million` -- the short form kept its
 * suffix in full and the long form kept only the digits -- so a pair whose
 * whole point is that they quote the SAME figure had no shared amount anchor at
 * all and could only be matched on the bare year in both headlines: the one
 * signal that must never decide a match (see distinguishingTokens).
 *
 * The suffix is ALWAYS folded to its long form (`k`/`m`/`b` -> thousand/
 * million/billion) after whitespace and commas are dropped, and the long form
 * is left as it stands, so every spelling of one magnitude lands on one string
 * (`$547.5M` -> `$547.5million` <- `$547.5 million`). Nothing else about the
 * amount is normalized: `$547.5M` and `$548M` stay different anchors, which is
 * the point of an anchor.
 */
function normalizeAmount(full: string): string {
  const compact = full.toLowerCase().replace(/[\s,]/g, "");
  return compact.replace(
    /[kmb]$/,
    (suffix) => ({ k: "thousand", m: "million", b: "billion" })[suffix] ?? suffix,
  );
}

export function extractAnchors(headline: string, place?: NewsroomPlace | null): Set<string> {
  const anchors = new Set<string>();
  let working = headline;

  working = working.replace(
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g,
    (full, mon: string, day: string) => {
      const month = MONTH_NUMBER[mon.toLowerCase()];
      if (!month) return full;
      anchors.add(`date:${month}-${day.padStart(2, "0")}`);
      return " ".repeat(full.length);
    },
  );

  working = working.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (full, mo: string, day: string) => {
    anchors.add(`date:${mo.padStart(2, "0")}-${day.padStart(2, "0")}`);
    return " ".repeat(full.length);
  });

  working = working.replace(
    /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[kmb]\b|million|billion|thousand)?/gi,
    (full) => {
      anchors.add(`amount:${normalizeAmount(full)}`);
      return " ".repeat(full.length);
    },
  );

  working = working.replace(/\b[a-z]{3,9}\b/gi, (full) => {
    const month = MONTH_NUMBER[full.toLowerCase()];
    if (!month) return full;
    anchors.add(`month:${month}`);
    return " ".repeat(full.length);
  });

  working = working.replace(/\b\d{2,}\b/g, (full) => {
    anchors.add(`num:${full}`);
    return " ".repeat(full.length);
  });

  const furniture = properNounStoplist(place);
  for (const m of working.matchAll(/\b[A-Z][a-zA-Z']{2,}\b/g)) {
    // U26: a possessive is the same name. "Longmont's" was slipping past a
    // stoplist that names "longmont", so the paper's own city came back as a
    // distinguishing anchor (noun:longmont's) whenever a headline owned it --
    // "Boulder County, Listing Longmont's Oct. 24 Day of the Dead
    // Celebration" is exactly that shape. Folding 's also lands a possessive
    // name on the same anchor as the plain one, which is what makes it
    // comparable across two headlines.
    const w = m[0].toLowerCase().replace(/'s$/, "");
    if (!furniture.has(w)) anchors.add(`noun:${w}`);
  }

  return anchors;
}

/** Proper nouns from a headline, excluding the newsroom's own place and civic
 * furniture (properNounStoplist) -- the `noun:*` subset of extractAnchors,
 * unprefixed. */
export function nonStoplistedProperNouns(
  headline: string,
  place?: NewsroomPlace | null,
): Set<string> {
  const out = new Set<string>();
  for (const anchor of extractAnchors(headline, place)) {
    if (anchor.startsWith("noun:")) out.add(anchor.slice("noun:".length));
  }
  return out;
}

/**
 * Count of anchors two headlines share. A literal `date:`/`amount:`/`num:`/
 * `noun:` anchor present on both sides counts once. In addition, a bare
 * `month:MM` anchor on either side counts once for every distinct
 * `date:MM-DD` anchor it is compatible with on the *other* side -- see the
 * ANCHOR_MATCH_MIN_SHARED doc comment for why.
 */
export function sharedAnchorCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const anchor of a) if (b.has(anchor)) shared += 1;

  const expandMonths = (months: Set<string>, dates: Set<string>) => {
    for (const anchor of months) {
      if (!anchor.startsWith("month:")) continue;
      const mm = anchor.slice("month:".length);
      for (const other of dates) {
        if (other.startsWith(`date:${mm}-`)) shared += 1;
      }
    }
  };
  expandMonths(a, b);
  expandMonths(b, a);

  return shared;
}

/**
 * QA-1 (2026-09-02, round 1): the anchor path above was built for a
 * same-story rewrite that shares a source URL plus >= 2 concrete anchors (a
 * date, a dollar amount, a proper noun...) but almost no prose. It did not
 * guard against two DIFFERENT stories on the same portal page that happen to
 * share a meeting date and a round dollar figure -- "Council votes on
 * $250,000 library roof repair contract at Sept. 10 meeting" vs "Council
 * approves $250,000 park irrigation contract at Sept. 10 meeting" cleared
 * the anchor bar (shared URL, shared date, shared amount) despite naming two
 * unrelated subjects, and the matched candidate's content was silently
 * discarded (see lead-filing.ts). Round 1 gated the anchor path on
 * sharesContentWord and shipped it.
 *
 * QA-1 (round 2): round 1 only gated the anchor path. The headline-overlap
 * paths (shared URL + Jaccard/containment, and the no-URL Jaccard-only path)
 * still scored overlap over EVERY surviving token, civic furniture included
 * -- "Council approves $180,000 police overtime contract at Sept. 12
 * meeting" vs "...fire truck contract..." shares council/approves/contract/
 * sept/meeting and cleared 0.6 Jaccard despite "police overtime" and "fire
 * truck" having nothing in common. 7 of 13 adversarial pairs merged this
 * way. Fixed by scoring all three paths' overlap over CONTENT tokens only
 * (see contentTokens) and requiring every path to also pass
 * sharesContentWord -- see findMatchingLead's doc comment for the full rule.
 *
 * These are words a civic-agenda headline reaches for regardless of subject
 * -- true of every item on every meeting's agenda (or, for "million"/
 * "billion"/"grant", generic magnitude/funding words that ride along with an
 * amount without naming what it's for), so sharing one proves nothing about
 * whether two headlines are the SAME item. "closed"/"door" were judged NOT
 * furniture -- open-vs-closed session is a real distinguishing fact, not
 * boilerplate, and it's load-bearing for the live 0.6.2 match. "executive"
 * is deliberately not on this list either, for the same reason. "session"/
 * "sessions" were removed from this list in round 2: they were furniture in
 * round 1's list but round 1's own doc comment claimed they were "kept" as
 * content, which was never true of the code -- round 2 makes the code match
 * the stated intent, and no adversarial pair depends on "session" being
 * furniture.
 */
const CONTENT_STOPLIST = new Set([
  "council", "board", "boards", "meeting", "meetings", "vote", "votes", "voted",
  "approve", "approves", "approved", "contract", "contracts", "agenda", "agendas",
  "item", "items", "hearing", "hearings", "notice", "notices",
  "public", "sept", "city",
  "ordinance", "ordinances", "application", "applications", "variance", "variances",
  "county", "regular", "special", "packet", "packets", "posted",
  "million", "billion", "thousand", "grant", "grants",
  "planning", "review", "reviews", "reviewed",
  "debate", "debates", "debated",
]);

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "will",
  "are", "was", "were", "been", "being", "into", "over", "after", "before",
  "about", "against", "during", "while", "than", "then", "them", "their",
  "there", "here", "which", "who", "whom", "what", "when", "where", "why",
  "how", "its", "it's", "not", "but", "you", "your", "our", "his", "her",
  "would", "could", "should", "may", "might", "can", "does", "did", "done",
  "new", "two", "one", "three", "set", "book", "books", "late", "on", "in",
  "at", "to", "of", "a", "an", "is", "as", "by", "up",
]);

/** Strip a trailing "s" so plural/singular variants ("session"/"sessions",
 * "grants"/"grant") land on the same token. Deliberately conservative: only
 * words longer than 4 letters, and never a double-s ending ("congress"),
 * to avoid mangling short words that happen to end in "s". Applied AFTER a
 * word has already cleared the stoplist/proper-noun checks below, which all
 * key on the raw word -- see contentTokens. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shorter = a.size <= b.size ? a : b;
  const other = shorter === a ? b : a;
  let shared = 0;
  for (const w of shorter) if (other.has(w)) shared += 1;
  return shared / shorter.size;
}

/** Normalise a source URL for comparison: strip scheme, `www.`, trailing
 * slash, query string, and fragment; compare case-insensitively. */
export function normalizeSourceUrl(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^www\./, "");
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf("?");
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.replace(/\/+$/, "");
  return s;
}

/**
 * Unit AK item 3 (2026-09-26): the words a URL can END at and still be a
 * section front rather than a story. `/news`, `/local-news`, `/sports` and
 * the Daily Camera and Times-Call crime fronts are all one such word.
 */
const SECTION_FRONT_WORDS = new Set([
  "news",
  "newsroom",
  "local-news",
  "stories",
  "latest",
  "section",
  "sections",
  "category",
  "categories",
  "topic",
  "topics",
  "tag",
  "tags",
  "author",
  "authors",
  "search",
  "archive",
  "archives",
  "index",
  "feed",
  "feeds",
  "rss",
  "sitemap",
  "crime",
  "crime-public-safety",
  "public-safety",
  "sports",
  "obituaries",
  "classifieds",
  "meetings",
  "events",
  "calendar",
]);

/**
 * A word that can be followed by exactly one short section slug and still be
 * the section rather than a story: `/category/longmont`,
 * `/news/crime-public-safety`, `/sports/high-school-sports`,
 * `/author/jane-doe`.
 */
const SECTION_CONTAINER_WORDS = new Set([
  "news",
  "newsroom",
  "local-news",
  "stories",
  "section",
  "sections",
  "category",
  "categories",
  "topic",
  "topics",
  "tag",
  "tags",
  "author",
  "authors",
  "sports",
  "crime",
  "crime-public-safety",
  "public-safety",
  "archive",
  "archives",
  "search",
  "meetings",
  "events",
  "calendar",
]);

/** Feeds: an .rss/.atom/.xml document is a list of everything, never one
 * story. */
const FEED_EXTENSION = /\.(rss|atom|xml)$/;

/** A section slug carries no date and reads as a place or a beat. Digits (a
 * year in `/news/2026-...`), a file extension, or a long slug all mean the
 * URL addresses one document. */
const SECTION_SLUG = /^[a-z][a-z-]*$/;
const SECTION_SLUG_MAX = 24;

/**
 * Is this URL a section, listing or index page rather than one story?
 *
 * Unit AK item 3, from the real queue: leads 218 (held, a Loomiller Park
 * stabbing) and 209 (killed, a "juvenile altercation") both cited the Daily
 * Camera's crime front -- `/news/crime-public-safety/` -- and the matcher
 * read that shared URL as "same source". An index page carries every crime
 * in the county, so sharing one says nothing about whether two leads are the
 * same story; it is the weakest possible evidence, and it was linking
 * unrelated leads as duplicates of each other.
 *
 * The rule is a closed, enumerated list of shapes rather than a general
 * "looks short" heuristic, deliberately: the matcher must never demote a URL
 * it cannot classify, because a false "not the same source" verdict re-files
 * a lead an editor already killed or held. So only these count as index
 * pages --
 *
 *   - a site root (`https://www.dailycamera.com/`, `https://bouldercounty.gov`);
 *   - a feed (`https://www.reddit.com/r/longmont/.rss`, `.../feed.xml`);
 *   - a path ENDING at a section word (`/news`, `/local-news`, `/sports`,
 *     `/news/crime-public-safety`, `/meetings`, `/events`);
 *   - a section container followed by one short dateless slug
 *     (`/category/longmont`, `/tag/carbon-valley`, `/author/jane-doe`).
 *
 * Everything else keeps its full weight as a shared source, including every
 * document-shaped URL the local sources publish:
 * `timescall.com/2026/08/12/longmont-council-ranked-choice-voting/`,
 * `longmontleader.com/agenda/sept-council`,
 * `longmont.primegov.com/portal/meeting/12345`,
 * `longmontcitycouncil.org/meetings/2026-09-15/`,
 * `longmontcolorado.gov/agendas/2026-08-25-packet.pdf`. "agenda", "portal",
 * "meeting" and "council" are therefore NOT section words, and neither is
 * "notices" or "election-information" -- those name records, not lists,
 * in this newsroom's sources table (see src/lib/paper.ts and
 * src/lib/news/extract.ts's dropListingUrls, which keeps them for the same
 * reason).
 *
 * This is intentionally NOT report.ts's isIndexUrl (that one asks whether a
 * source is a bare front worth skipping during extraction) and NOT
 * extract.ts's looksLikeSectionFront (that one is gated on a watched host --
 * `isWatchedSectionFront` -- and without the gate it flags
 * `longmontleader.com/agenda/sept-council`, a real story page the matcher's
 * own tests share; see src/lib/news/lead-match.test.ts).
 */
export function isIndexPageUrl(raw: string): boolean {
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return false;
  const slash = normalized.indexOf("/");
  const path = slash < 0 ? "" : normalized.slice(slash).replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  const last = segments[segments.length - 1]!;
  if (FEED_EXTENSION.test(last)) return true;
  if (SECTION_FRONT_WORDS.has(last)) return true;
  if (segments.length === 2 && SECTION_CONTAINER_WORDS.has(segments[0]!)) {
    return SECTION_SLUG.test(last) && last.length <= SECTION_SLUG_MAX;
  }
  return false;
}

/** The URLs of this lead that address one story. Index, section and feed
 * URLs are dropped: two leads citing the Daily Camera's crime front are not
 * citing the same source (see isIndexPageUrl). */
function storyUrls(urls: string[]): string[] {
  return urls.filter((u) => !isIndexPageUrl(u));
}

/** Hosts that publish meeting records -- agendas, packets, minutes -- and
 * nothing that is a single story. A PrimeGov `/portal/meeting/12345` or a
 * Legistar `/Calendar.aspx` is a container of items, not one item, so two
 * leads citing it are not citing the same story. The list is the
 * meeting-record vendor family from src/lib/news/render-detect.ts's JS_HOST
 * (which exists for the opposite question: does this host need rendering
 * before extraction), restricted to the vendors that serve AGENDAS -- the
 * municipal-code hosts on that list are left out, no source in this
 * newsroom's sources table uses one. The leading `(^|\.)` and the trailing
 * `.` are both deliberate: they match `longmont.primegov.com` and the repo's
 * own `primegov.example.com` test fixture, but not a host that merely ends
 * in the vendor's domain without being it. */
const CIVIC_MEETING_HOST = /(^|\.)(primegov|legistar|civicclerk|granicus|granicusondemand|granicusideas|boarddocs|civicplus)\./i;

/** Path segments that name a document holding many items rather than one
 * story -- `/agendas/`, `/packets/`, `/minutes/`, `/meetings/`,
 * `/DocumentCenter/`. Compared as a WHOLE segment, never as a substring:
 * `/2026/09/25/longmont-council-minutes-released/` is a headline slug about
 * minutes, not a minutes document. */
const MULTI_ITEM_PATH_SEGMENTS = new Set([
  "agenda", "agendas", "packet", "packets", "minutes", "minute",
  "meeting", "meetings", "compileddocument", "documentcenter", "calendar",
]);

/**
 * Unit AK2 item 2 (2026-09-26): is this URL a document that holds MANY items
 * rather than one story?
 *
 * This is the exception to AK2's same-run merge rule. The real 207/212 pair
 * shares an ARTICLE page -- one city news release -- and a shared article
 * page is as good as it gets for "these two sightings are one story". An
 * agenda, packet or minutes document is the opposite: it carries every item
 * on a meeting, so two leads citing it tell you nothing about whether they
 * are about the same item. QA-1's negatives are exactly that shape: NEG-4
 * (jail expansion vs staff pay raises) and NEG-7 (rural east vs west county
 * schools) both cite `longmont.primegov.com/portal/meeting/12345` --
 * different items at one meeting -- and both are "possible", so without this
 * exception a same-run merge would swallow the second story.
 *
 * Recognised (real shapes, all from this repo's code and tests):
 *   - any `.pdf` -- `assets.bouldercounty.gov/.../2022-048-...-o.100pct.pdf`,
 *     `civicclerk.example/agenda.pdf`, `example.gov/packet.pdf`;
 *   - a meeting-record host -- `longmont.primegov.com/portal/meeting/12345`,
 *     `longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823`,
 *     `longmont.legistar.com/Calendar.aspx`;
 *   - a path segment naming the container --
 *     `longmontcolorado.gov/agendas/ordinance-o-2026-63/`,
 *     `longmontcitycouncil.org/meetings/2026-09-15/`,
 *     `longmontleader.com/agenda/sept-council`,
 *     `civic.example/DocumentCenter/View/1234/agenda`.
 *
 * NOT a multi-item document, and therefore still full evidence of one story:
 * `longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/` (the
 * real 207/212 page), `timescall.com/2026/08/12/longmont-council-ranked-choice-voting/`.
 *
 * The bias is one-directional on purpose. Calling a URL a multi-item document
 * that turns out to be a story page leaves two linked leads for an editor to
 * resolve in one press -- today's behaviour. Missing one that really is a
 * document merges two different stories with no way back, which is the
 * failure QA-1 spent three rounds closing. So a shape this function cannot
 * classify stays a story page.
 */
export function isMultiItemDocumentUrl(raw: string): boolean {
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return false;
  const slash = normalized.indexOf("/");
  const host = slash < 0 ? normalized : normalized.slice(0, slash);
  const path = slash < 0 ? "" : normalized.slice(slash);
  // A bare host is isIndexPageUrl's business, not this function's.
  if (!path) return false;
  if (/\.pdf(\/|$)/i.test(path)) return true;
  const segments = path
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    // "minutes.html" and "calendar.aspx" name the same container as
    // "minutes" and "calendar" -- the extension is a format, not a subject.
    .map((s) => s.replace(/\.(html?|aspx|asp|php|jsp)$/i, ""));
  if (segments.some((s) => MULTI_ITEM_PATH_SEGMENTS.has(s))) return true;
  return CIVIC_MEETING_HOST.test(host);
}

/** A URL that addresses ONE story: not a list (isIndexPageUrl) and not a
 * document holding many items (isMultiItemDocumentUrl). */
function isStoryPageUrl(url: string): boolean {
  return !isIndexPageUrl(url) && !isMultiItemDocumentUrl(url);
}

function sharesUrlWith(a: string[], b: string[], keep: (url: string) => boolean): boolean {
  const realA = a.filter(keep);
  const realB = b.filter(keep);
  if (realA.length === 0 || realB.length === 0) return false;
  const setA = new Set(realA.map(normalizeSourceUrl).filter(Boolean));
  for (const u of realB) {
    if (setA.has(normalizeSourceUrl(u))) return true;
  }
  return false;
}

function sharesUrl(a: string[], b: string[]): boolean {
  return sharesUrlWith(a, b, (u) => !isIndexPageUrl(u));
}

/** Unit AK2 item 2: do both leads cite the same page that addresses ONE
 * story? This is the extra evidence that promotes a same-run "possible" pair
 * to a merge -- see sameStoryForMerge. */
export function sharesStoryPageUrl(a: string[], b: string[]): boolean {
  return sharesUrlWith(a, b, isStoryPageUrl);
}

/**
 * QA-1 (round 2): both headline-overlap paths score CONTENT tokens, not
 * every surviving word -- see contentTokens and CONTENT_STOPLIST's doc
 * comment for why scoring civic-agenda furniture ("council approves ...
 * contract at ... meeting") let two different agenda items look like a
 * paraphrase of each other. sharesDistinguishingEvidence is also required explicitly:
 * given the thresholds below are all > 0, a nonzero Jaccard/containment
 * score already implies at least one shared content token, but the explicit
 * check keeps that invariant true even if a threshold is ever loosened.
 *
 * Unit AN (2026-10-03): the tokens scored are distinguishingTokens, not raw
 * contentTokens -- see that function for the names-only headline that made
 * every path here score 0.0.
 */
function headlinesOverlapEnough(a: string, b: string, place?: NewsroomPlace | null): boolean {
  const ta = distinguishingTokens(a, b, place);
  const tb = distinguishingTokens(b, a, place);
  return (
    (jaccard(ta, tb) >= HEADLINE_JACCARD_THRESHOLD || containment(ta, tb) >= HEADLINE_CONTAINMENT_THRESHOLD) &&
    sharesDistinguishingEvidence(a, b, place)
  );
}

function headlinesAloneMatch(a: string, b: string, place?: NewsroomPlace | null): boolean {
  const ta = distinguishingTokens(a, b, place);
  const tb = distinguishingTokens(b, a, place);
  return jaccard(ta, tb) >= HEADLINE_ONLY_THRESHOLD && sharesDistinguishingEvidence(a, b, place);
}

/** Words at least 4 letters long, present in the headline, and NOT on
 * STOP_WORDS, the newsroom's own place/civic furniture (properNounStoplist),
 * or CONTENT_STOPLIST -- see CONTENT_STOPLIST's doc comment -- and not a
 * non-stoplisted proper noun (nonStoplistedProperNouns) either. That last
 * exclusion matters for match path 2: a shared place name like "Twin Peaks"
 * is already scored as an anchor (noun:twin, noun:peaks), so reusing it here
 * would let two different agenda items about the same place ("Twin Peaks
 * rezoning application" vs "Twin Peaks parking variance") satisfy
 * sharesDistinguishingEvidence on the location alone -- the anchor path needs a
 * *different* piece of evidence that the SUBJECT, not just the place, is the
 * same. Plural/singular variants are folded together (stem) after the
 * stoplist checks, which all key on the raw word. */
function contentTokens(headline: string, place?: NewsroomPlace | null): Set<string> {
  const properNouns = nonStoplistedProperNouns(headline, place);
  const furniture = properNounStoplist(place);
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !STOP_WORDS.has(w) &&
        !furniture.has(w) &&
        !CONTENT_STOPLIST.has(w) &&
        !properNouns.has(w),
    )
    .map(stem);
  return new Set(words);
}

/**
 * Unit AO (2026-10-03): contentTokens minus the numbers, which is what the
 * headline-overlap paths now score -- a bare year (or any 4+ digit number) is
 * never distinguishing evidence that two headlines are the same story.
 *
 * The live bug. Measured on the real matcher before this: a headline whose
 * only surviving content word is a year scored a Jaccard of 1.0 against every
 * other headline containing that year, and `matchStrength` returned "strong"
 * on the year alone -- the tier that DISCARDS the finding (lead-filing.ts:111,
 * only `resurfaced_count` moves). Two shapes from scan 66 and its 30-day
 * neighbours:
 *
 *   - "St. Vrain Valley Schools Opens 2027-28 School Choice Window Dec. 1-15"
 *     (killed, 332) against "Longmont's Proposed 2027 Budget: $547.5M
 *     Operating Plan, With Modifications Hinged to Nov. 3 Tax Votes" (435) --
 *     two different stories that share nothing but 2027, linked as
 *     `dup_kind='developing'` on the live queue.
 *   - "Longmont Public Media posts Museum and Library advisory board meetings
 *     for September 2026" (223) against every calendar listing that month
 *     ("City Council Regular Session - September 22, 2026"), linked as
 *     possible duplicates of each other.
 *
 * A number is still an ANCHOR -- see extractAnchors and
 * sharedAnchorCount, which is where a shared date or a shared street number
 * (the real "8979 Nelson Road" repeat, leads 66 and 147) is supposed to be
 * scored, with the >= ANCHOR_MATCH_MIN_SHARED bar and a shared source URL
 * behind it. What it must not do is satisfy the token-overlap score.
 */
function subjectTokens(headline: string, place?: NewsroomPlace | null): Set<string> {
  const out = new Set<string>();
  for (const word of contentTokens(headline, place)) {
    if (!/^\d+$/.test(word)) out.add(word);
  }
  return out;
}
/**
 * Unit AN (2026-10-03): the words a headline is SCORED on -- contentTokens,
 * unless there are none, in which case its own proper nouns.
 *
 * The live bug this closes. Every headline-overlap path below scores content
 * tokens, and contentTokens deliberately drops every proper noun (see its own
 * doc comment). A headline whose every word of four letters or more is a
 * capitalised name therefore has NO content tokens at all: the sets are empty,
 * jaccard/containment return 0 by definition, sharesDistinguishingEvidence can
 * never fire, and all three of findMatchingLead's paths fail however identical
 * the two headlines are. Scan run 66 (2026-10-03, Longmont) filed 20 leads of
 * which at least 16 repeated earlier leads, and not one of them was even
 * flagged, because of this. Measured on the real matcher, before this change:
 *
 *   lead 418 "Callahan House Video Release Party Set for Oct. 8 at Tend Studio"
 *     vs lead 349 -- byte-identical headline, byte-identical EVENT page URL,
 *     both sightings of one event -- scored null.
 *   lead 430 vs lead 412 -- byte-identical headline (both "North Pace Street
 *     Entrance at Fox Creek Village and King Soopers Reopens"), one with only
 *     the /news/ index between them -- scored null.
 *   leads 416, 422 (same scan, same city news story, one article page) -- no
 *     same-run merge, so two rows for one story.
 *
 * The fallback is the headline's proper nouns, and it is switched on by BOTH
 * sides having no content tokens, never by either side. As long as one
 * headline carries subject vocabulary the existing subject-word rule decides,
 * which is what keeps every QA-1/U26 negative where it is today ("library roof
 * repair" vs "park irrigation", "Twin Peaks rezoning" vs "Twin Peaks parking
 * variance", "commissioners ... jail expansion" vs "... staff pay raises"): in
 * each of those, at least one side has content tokens, so nothing here fires.
 *
 * Names are weaker evidence than subjects (see distinguishingOverlap), which
 * is why they are only ever reached for a headline that has nothing else, and
 * why the pair still has to clear the same Jaccard/containment bars and a
 * shared URL or >= ANCHOR_MATCH_MIN_SHARED anchors. Two DIFFERENT stories that
 * both happen to be all-names still do not merge: their name sets are mostly
 * disjoint ("Longmont Library to Close All Day Oct. 6 for Staff Training" vs
 * "Longmont Seeks Residents for New Technology Policy Advisory Board" share
 * only the newsroom's own furniture, which is stripped, so 0.0).
 *
 * Unit AO (2026-10-03): the subject half is subjectTokens, not raw
 * contentTokens -- a number is an anchor, never a subject word. A headline
 * whose only content word is a year is therefore in exactly the same position
 * as the all-names headline above and falls back to its own proper nouns; see
 * subjectTokens for the two live pairs that made that the difference between
 * "strong" (discarded) and no match at all.
 */
function distinguishingTokens(
  headline: string,
  otherHeadline: string,
  place?: NewsroomPlace | null,
): Set<string> {
  const own = subjectTokens(headline, place);
  if (own.size > 0) return own;
  if (subjectTokens(otherHeadline, place).size > 0) return own;
  return nonStoplistedProperNouns(headline, place);
}

/**
 * The words two headlines share that say WHAT a story is about, split in two:
 *
 *   - `subjects` -- shared content tokens (see contentTokens): furniture and
 *     proper nouns are already stripped, so what is left is the subject
 *     vocabulary, "climate", "Heritage", "rezoning".
 *   - `names` -- shared proper nouns that are NOT the newsroom's own place or
 *     civic furniture (nonStoplistedProperNouns): "ExxonMobil", "Bohn Farm",
 *     "SVVSD". Real names, but names are weaker evidence than subjects: two
 *     headlines can share a PLACE and nothing else.
 *
 * U26 (2026-09-30): exported for desk-copy.ts's nearDuplicate(), which shows
 * the Queue's "Looks already printed" chip. That chip used to be decided on
 * raw title overlap, which counts "Boulder" and "County" as evidence exactly
 * as this matcher's own anchor path did -- see properNounStoplist.
 *
 * `place` is the newsroom's own city/state/county, which is what decides
 * whether a name is one of ITS places (see NewsroomPlace). A caller that
 * passes nothing gets the generic civic words only.
 */
export function distinguishingOverlap(
  a: string,
  b: string,
  place?: NewsroomPlace | null,
): { subjects: number; names: number } {
  return {
    subjects: sharedWordCount(contentTokens(a, place), contentTokens(b, place)),
    names: sharedWordCount(nonStoplistedProperNouns(a, place), nonStoplistedProperNouns(b, place)),
  };
}

function sharedWordCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared;
}

/** QA-1: required alongside the overlap score for every match path (1, 2,
 * and 3) -- see findMatchingLead and CONTENT_STOPLIST's doc comment. The
 * "real subject overlap" requirement as one predicate: the two headlines must
 * share at least one word that survives contentTokens, i.e. a word that is
 * neither the newsroom's own place/civic furniture (properNounStoplist) nor a
 * proper noun at all. Two headlines can clear every lexical bar below on a
 * shared PLACE alone ("Boulder County" as two anchors, plus the Jaccard score
 * that shared proper nouns would otherwise contribute); a shared subject word
 * is the evidence that they are about the same THING -- "climate",
 * "Heritage", "ExxonMobil" -- and it is what the owner's 2026-09-30 false
 * positive ("...Boulder County Climate Suit Oct. 5" against "Boulder County
 * Proclaims Hispanic and Latinx Heritage Month...") never had.
 *
 * Unit AN (2026-10-03): the one exception, and it is the whole point of the
 * unit -- when NEITHER headline has a word that survives contentTokens, there
 * is no subject-word overlap available to require, and requiring it anyway is
 * what let every repeat in scan 66 through (see distinguishingTokens). The
 * fallback bar is NAME_ONLY_MIN_SHARED non-furniture names, which is a
 * strictly stronger piece of evidence than the >= 1 content word it replaces
 * (a content word can be shared by two headlines about nothing in common --
 * see CONTENT_STOPLIST's own history; two shared names that survive
 * properNounStoplist are what the anchor path already demands). */
function sharesDistinguishingEvidence(
  a: string,
  b: string,
  place?: NewsroomPlace | null,
): boolean {
  const ca = contentTokens(a, place);
  const cb = contentTokens(b, place);
  if (sharedWordCount(ca, cb) >= 1) return true;
  // Unit AN (2026-10-03): neither headline has subject vocabulary at all, so
  // the words that survive contentTokens are not the only distinguishing
  // evidence there is -- the names are the rest of it. Without this, a
  // names-only pair could never satisfy any path no matter how identical the
  // headlines were (see distinguishingTokens). The bar is >= 2 names and not
  // >= 1 for the same reason as the anchor path: one shared name is a place.
  if (ca.size > 0 || cb.size > 0) return false;
  return (
    sharedWordCount(nonStoplistedProperNouns(a, place), nonStoplistedProperNouns(b, place)) >=
    NAME_ONLY_MIN_SHARED
  );
}

/** The normalized form two headlines are compared at character level:
 * lowercased, punctuation dropped, whitespace collapsed. */
function normalizedHeadline(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Length of the longest common subsequence of two strings -- the M of
 * difflib.SequenceMatcher.ratio()'s 2M/T. Two rows of the DP table, which is
 * everything a headline-length comparison needs. */
function lcsLength(a: string, b: string): number {
  const width = b.length + 1;
  let prev = new Array<number>(width).fill(0);
  let cur = new Array<number>(width).fill(0);
  for (let i = 0; i < a.length; i++) {
    cur[0] = 0;
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(cur[j], prev[j + 1]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length];
}

/** Character-level similarity of two headlines: 2 * LCS / (len(a) + len(b))
 * over the normalized forms, Python's difflib ratio. The wide, cheap half of
 * the candidate filter -- see nearDuplicateSignals. */
function headlineCharRatio(a: string, b: string): number {
  const x = normalizedHeadline(a);
  const y = normalizedHeadline(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  return (2 * lcsLength(x, y)) / (x.length + y.length);
}

/** The specific facts a headline pins down: a date, a dollar amount, or a
 * number that is not a bare year. `num:2027` is one headline's calendar, not
 * a fact two stories share -- requirement: a bare year is never enough. */
function specificAnchors(anchors: Iterable<string>): string[] {
  return [...anchors].filter(
    (anchor) =>
      /^(date:|amount:)/.test(anchor) || (/^num:/.test(anchor) && !/^num:\d{4}$/.test(anchor)),
  );
}

/** The facts a headline pins down: anything from extractAnchors that says when,
 * how much, or how many. `noun:` is a name, and names are the subject half of
 * the signal, not the fact half. */
function factAnchorsOf(anchors: Iterable<string>): string[] {
  return [...anchors].filter((anchor) => /^(date:|amount:|month:|num:)/.test(anchor));
}

/** Unit AO (2026-10-03): do two headlines NAME A DIFFERENT VALUE for the same
 * role -- a contradiction, and therefore two different stories? The roles are
 * the kinds extractAnchors knows: when (`date:`, `month:`), how much
 * (`amount:`), how many (`num:`).
 *
 * The distinction this exists to draw is between detail and contradiction:
 *
 *   - a role ONE side fills is detail the second telling added, not a
 *     disagreement. 429 carries no deadline; 354 carries `date:10-16`. Same
 *     story, one more fact -- the tier that files it HELD and links it, exactly
 *     as a repeat that brings a new fact should be handled.
 *   - a role BOTH sides fill with nothing in common is a contradiction. 297
 *     "City Council Regular Session - September 22, 2026 (2026-09-23)" and 302
 *     "City Council Regular Session - September 8, 2026 (2026-09-09)" are the
 *     same template for two different meetings: `date:09-22` against
 *     `date:09-08`, nothing shared, and no amount of character overlap (0.88)
 *     makes them one story.
 *
 * Why not simply require that neither side adds any fact (the old `sameFacts`)?
 * Because that reads detail as disagreement, and it is the reason 429 was still
 * filed as a fresh lead against the killed 354 after every other signal agreed.
 *
 * A shared value anywhere in the role clears it: 434 names `num:542` and
 * `num:550` where 359 names `num:542`, `num:550` and `num:2026` -- the extra
 * year is detail, the shared goals are the same goals, so no conflict.
 */
function factsConflict(a: Iterable<string>, b: Iterable<string>): boolean {
  const fa = factAnchorsOf(a);
  const fb = factAnchorsOf(b);
  for (const kind of ["date:", "amount:", "month:", "num:"]) {
    const va = fa.filter((anchor) => anchor.startsWith(kind));
    const vb = fb.filter((anchor) => anchor.startsWith(kind));
    if (va.length > 0 && vb.length > 0 && !va.some((anchor) => vb.includes(anchor))) return true;
  }
  return false;
}

/**
 * Unit AO (2026-10-03): the two-stage near-duplicate signals. Stage 1 is a
 * wide, cheap candidate filter (this: any strong signal makes a pair worth
 * classifying); Stage 2 is the classifier that decides whether the pair is
 * the SAME story (nearDuplicateStrong) or only worth LINKING
 * (nearDuplicateCandidate and no more). Both stages are built from this one
 * struct so the filter and the classifier cannot drift apart -- every signal
 * the classifier uses is one the filter already looked at.
 *
 * Why a second mechanism at all, when pairMatches already has three paths. The
 * three paths score PROSE (token overlap, anchors) and are the right tool when
 * two headlines are rewrites of each other. They are blind to the shape scan
 * 66 was full of -- a repeat whose headline is the SAME sentence with the
 * subject's name spelled out differently, or the same sentence plus the
 * number the earlier one left implicit:
 *
 *   - 418 "Callahan House Video Release Party Set for Oct. 8 at Tend Studio"
 *     against 349 -- byte-identical headline, byte-identical event URL, and
 *     still null before unit AN because every word over three letters is a
 *     name (see distinguishingTokens).
 *   - 435 "Longmont's Proposed 2027 Budget: $547.5M Operating Plan, With
 *     Modifications Hinged to Nov. 3 Tax Votes" against the killed 149
 *     "Longmont begins review of proposed $547.5 million 2027 operating
 *     budget": the same budget, the same figure (once normalizeAmount folds
 *     $547.5M and $547.5 million together), and a new date.
 *   - 424 "Harvest of Hope Pantry Reports 31,260 Shopping Visits and 1,016,373
 *     Items of Food Distributed in 2025" against the killed 233, whose only
 *     shared specifics are those two numbers.
 *
 * The signals, and why each one is a guard rather than a nicety:
 *
 *   - `sharedNames` >= 1: at least one non-furniture proper noun in common.
 *     Every route requires it, and it is what keeps two template-driven agenda
 *     items apart when their number happens to match (QA-1's NEG set: "library
 *     roof repair" vs "park irrigation", "police overtime" vs "fire truck" --
 *     same date, same amount, different subjects, no shared name).
 *   - `oneSided`: one headline's distinguishing vocabulary is contained in the
 *     other's (see distinguishingTokens -- the same sets the headline-overlap
 *     paths score). A pair that each brings words the other lacks is two
 *     different stories being compared, not one story said twice. It is the one
 *     signal only the FILTER uses, and only to decide the moderate band: a pair
 *     at 0.70-0.85 of shared characters has to be one-sided to be worth
 *     classifying, while a pair at 0.85 or over needs no such corroboration.
 *     Scored on the distinguishing sets and not on raw contentTokens because
 *     for two all-names headlines contentTokens is EMPTY on both sides and the
 *     test goes vacuously true -- 416/412, seven shared names, 0.74 of shared
 *     characters, and two different retellings of the Fox Creek reopening.
 *   - `factsAgree`: the two headlines do not name a different value for the
 *     same role. A role only one side fills is detail added by a second
 *     telling (429 "Boulder County Opens Applications for Behavioral Health
 *     Funding Oversight Roles" and 354, the same headline plus "; Deadline
 *     Oct. 16") and is exactly what requirement "a repeat carrying a new fact
 *     is HELD and linked" describes. A role BOTH sides fill with nothing in
 *     common is a contradiction: the same council-session template for Sept. 22
 *     and for Sept. 8 (297 against 302), or the WOW! Children's Museum's two
 *     birthday bashes, must never be one story however few characters differ.
 *     See factsConflict.
 *   - `sharedSpecificAnchors`: see specificAnchors -- a shared date or amount,
 *     never a bare year.
 *   - `subjectsAgree`: the two headlines do not each bring their own subject
 *     vocabulary. Either neither has any (two all-names headlines -- the shared
 *     names ARE the subject, and a pair that shares most of them is the same
 *     subject said twice), or one headline's subject words are contained in the
 *     other's (the second telling refines the same subject). What it excludes
 *     is the pair where both sides name a subject the other lacks, which is the
 *     shape of every different-story pair in the QA-1 set: NEG-11 "Twin Peaks
 *     rezoning APPLICATION" against "Twin Peaks parking VARIANCE" (both share
 *     the place name and the date, and are two different agenda items), NEG-7
 *     EAST county against WEST county. A shared name cannot stand in for this:
 *     "Twin Peaks" is a place, and the anchor path already refuses to read a
 *     shared place as a shared subject (sharesDistinguishingEvidence). This is
 *     the signal that keeps the high-ratio route honest -- 429 and 354 are 0.87
 *     of shared characters and have no subject vocabulary at all, so the six
 *     names they share are the whole subject; NEG-11 is 0.86 and has one on
 *     each side, so it is not.
 *   - `charRatio`: the character-level similarity, computed lazily because it
 *     is the one signal with real cost (an LCS) and the cheap signals decide
 *     most pairs.
 *
 * What this deliberately does NOT do: relax anything for a pair whose only
 * shared evidence is a year. `num:2027` is not in sharedSpecificAnchors and not
 * a subject word (see subjectTokens), so a pair sharing nothing but the year
 * still has no name and no subject in common and no route reaches it: the two
 * most expensive failures of the live queue -- 435 linked to the school-choice
 * story 332 as "developing", and 223 "posts Museum and Library advisory board
 * meetings for September 2026" linked to every council session that month --
 * stop happening.
 */
type NearDuplicateSignals = {
  sharedNames: number;
  /** Every name one side has, the other has too (and it has at least one). */
  namesOneSided: boolean;
  oneSided: boolean;
  factsAgree: boolean;
  sharedSpecificAnchors: number;
  sharedAnchorsAreDates: boolean;
  subjectsAgree: boolean;
  charRatio: () => number;
};

function nearDuplicateSignals(
  a: string,
  b: string,
  place?: NewsroomPlace | null,
): NearDuplicateSignals {
  const sa = subjectTokens(a, place);
  const sb = subjectTokens(b, place);
  const da = distinguishingTokens(a, b, place);
  const db = distinguishingTokens(b, a, place);
  const anchorsA = extractAnchors(a, place);
  const anchorsB = extractAnchors(b, place);
  const namesA = nonStoplistedProperNouns(a, place);
  const namesB = nonStoplistedProperNouns(b, place);
  const sharedNames = sharedWordCount(namesA, namesB);
  const sharedAnchors = specificAnchors(
    [...anchorsA].filter((anchor) => anchorsB.has(anchor)),
  );
  let ratio: number | null = null;

  return {
    sharedNames,
    /*
      The name half of the same idea as `oneSided` below, and its own signal
      because the two fail apart on the headline shape this desk keeps hitting:
      an AI-written candidate is Title Case throughout, so contentTokens (which
      drops capitalised words) is EMPTY on that side while the sentence-case
      sibling it repeats is not. "Wild Plum Center Plans 'Sweet 60' Anniversary
      Gala for Six Decades of Head Start" and "Wild Plum Center marks 60 years
      with 'Sweet 60' anniversary gala" share every name the second one has
      (Wild, Plum, Center, Sweet) and no content token at all on the candidate
      side, so the token-based `oneSided` cannot see them; every name in the
      shorter list being present in the longer one can. See nearDuplicateCandidate.
    */
    namesOneSided:
      (namesA.size > 0 && [...namesA].every((name) => namesB.has(name))) ||
      (namesB.size > 0 && [...namesB].every((name) => namesA.has(name))),
    // Scored on the distinguishing sets, and only when both sides have one: for
    // two all-names headlines contentTokens is empty on BOTH sides, and reading
    // oneSided off it made the test vacuously true for every such pair -- the
    // reason 416 "…to Fox Creek Village Reopens; South Entrance Remains Closed"
    // was linked as a possible duplicate of 412 "…at Fox Creek Village and King
    // Soopers Reopens" on 0.74 of shared characters and then filed HELD instead
    // of NEW. See distinguishingTokens' doc for the same fallback.
    oneSided:
      (da.size > 0 && [...da].every((token) => db.has(token))) ||
      (db.size > 0 && [...db].every((token) => da.has(token))),
    factsAgree: !factsConflict(anchorsA, anchorsB),
    sharedSpecificAnchors: sharedAnchors.length,
    // A date is the one specific anchor a pair can share by coincidence: two
    // unrelated meetings fall on the same day. Both this and the amount/count
    // anchors are specific, but only the date needs to be told apart from "no
    // anchor at all" by the caller; see nearDuplicateCandidate.
    sharedAnchorsAreDates:
      sharedAnchors.length > 0 && sharedAnchors.every((anchor) => anchor.startsWith("date:")),
    // The subject vocabulary is subjectTokens (a number is an anchor, never a
    // subject -- see subjectTokens), and the test is containment in one
    // direction or the other, not a shared word: see the signal's doc comment
    // for why a shared name is not enough.
    //
    // An EMPTY side agrees. This is the same fix the both-empty clause always
    // made for two all-names headlines, extended to the one-empty case that the
    // Title-Case candidate produces: subjectTokens drops capitalised words, so
    // an AI candidate ("Longmont Museum Sets Oct. 17 Reopening After Expansion")
    // has no subject on its side while the sentence-case row it byte-for-byte
    // repeats ("Longmont Museum sets Oct. 17 reopening after expansion") has
    // several. Reading that as disagreement blocked the pair at charRatio 1.0;
    // a side with no subject cannot disagree with a side that has one, so it
    // must not. The gate that stays honest is the SHARED side: when both sides
    // carry subject vocabulary, one must be contained in the other.
    subjectsAgree:
      sa.size === 0 ||
      sb.size === 0 ||
      [...sa].every((token) => sb.has(token)) ||
      [...sb].every((token) => sa.has(token)),
    charRatio: () => (ratio ??= headlineCharRatio(a, b)),
  };
}

/**
 * Unit AO, stage 1: is this pair worth a second look? The filter is deliberately
 * wider than the classifier below -- every pair the classifier calls the same
 * story is a pair this accepts -- and it is the cheap signals that decide it,
 * with the expensive character-level signal asked last and only when it has to
 * be. No pair whose two headlines contradict each other on a date, an amount, a
 * month or a count ever gets this far; see factsConflict.
 *
 * Three ways in, in increasing cost:
 *
 *   - a shared specific fact (see specificAnchors -- a date or an amount, never
 *     a bare year) that is corroborated when the fact is only a date: a date is
 *     the one anchor two unrelated stories share by accident, so a shared date
 *     counts when the two also share a second name token (NAME_ONLY_MIN_SHARED,
 *     the bar path 2 already uses below) or when their wording is already close
 *     to the 0.70 one-sided bar. Without that, "Housing and Human Services
 *     Advisory Board Cancels Oct. 8 Meeting" and "Planning Division Sets Oct. 8
 *     Neighborhood Meeting" -- one day, one word ("meeting"), 0.43 of shared
 *     characters -- would be handed to the desk's AI check as a possible pair,
 *     and so would every other pair of meetings filed on the same October day.
 *     An amount or a count needs no such corroboration: 435's budget headline
 *     and 149 share $547.5 million and "2027" and nothing else at 0.49, and that
 *     is the same story told twice.
 *   - a headline that is the same characters in the same order (>= 0.85), which
 *     needs no corroboration beyond a shared name: two reporters cannot put
 *     that many characters of one sentence in one order by accident,
 *   - failing both, a moderately similar headline (>= 0.70) that is one-sided:
 *     one headline's vocabulary contained in the other's. This is the narrow,
 *     high-precision half of the ratio band, and it exists so the filter does
 *     not have to open the 0.70-0.85 band to every pair that shares a name --
 *     416 "North Pace Street Entrance to Fox Creek Village Reopens; South
 *     Entrance Remains Closed" and 412 "North Pace Street Entrance at Fox Creek
 *     Village and King Soopers Reopens" sit at 0.74 with seven names in common
 *     and are two different retellings, not one story said twice.
 *
 * Every way in also requires that the two do not each bring a subject the other
 * lacks (see subjectsAgree). The filter is wide, but not so wide that two
 * agenda items on one board's meeting page are worth the desk's AI check every
 * time they share a date -- NEG-11 "Twin Peaks rezoning application" against
 * "Twin Peaks parking variance" is null before this and stays null.
 */
function nearDuplicateCandidate(a: string, b: string, place?: NewsroomPlace | null): boolean {
  const signals = nearDuplicateSignals(a, b, place);
  if (signals.sharedNames < 1 || !signals.factsAgree || !signals.subjectsAgree) return false;
  if (signals.sharedSpecificAnchors >= NEAR_DUPLICATE_ANCHOR_MIN_SHARED) {
    if (
      !signals.sharedAnchorsAreDates ||
      signals.sharedNames >= NAME_ONLY_MIN_SHARED ||
      signals.charRatio() >= HEADLINE_RATIO_CANDIDATE
    ) {
      return true;
    }
  }
  if (signals.charRatio() >= HEADLINE_ONLY_THRESHOLD) return true;
  // A headline told again in the same NAMES, in two strengths. The routes above
  // all miss a repeat with no shared anchor and no shared URL, and the token
  // routes miss the AI's Title-Case candidate whose content tokens are empty
  // (see namesOneSided); a headline that names the same things at most of its
  // characters is worth the desk's duplicate check even so. Both routes here are
  // still only CANDIDATES -- this tier links and files; it never stamps.
  //
  //   - the narrow one: at least two shared names, most of the characters in
  //     common (>= 0.70), and one headline's names contained in the other's.
  //     This is what links 67 "Development Services counter now closed to the
  //     public every Wednesday morning" to 389 "Development Services Center
  //     Counter Closed Wednesday Mornings" and 207/212 "Longmont Senior Center
  //     ... free evening meal(s)" to 323 "… Lists Free Evening Meals".
  //   - the wider one: at least FOUR shared names at >= 60% of the characters,
  //     WITHOUT requiring containment. This is the route 417 "North Pace Street
  //     Entrance to Fox Creek Village Reopens; South Entrance Remains Closed"
  //     against the killed 412 "North Pace Street Entrance at Fox Creek Village
  //     and King Soopers Reopens" takes -- seven names in common at 0.74 of the
  //     characters -- and it is not one-sided either way: each side adds a name
  //     the other lacks (417's "South", 412's "King"/"Soopers"), which is why
  //     the narrow route above cannot see a pair that is plainly one story. The
  //     same route links the Title-Case repeat of 433 against 277, four shared
  //     names (Wild, Plum, Center, Sweet) at 0.64 of the characters.
  if (
    signals.namesOneSided &&
    signals.sharedNames >= NAME_ONLY_MIN_SHARED &&
    signals.charRatio() >= HEADLINE_RATIO_CANDIDATE
  ) {
    return true;
  }
  if (signals.sharedNames >= 4 && signals.charRatio() >= NEAR_DUPLICATE_NAME_RATIO) {
    return true;
  }
  return signals.oneSided && signals.charRatio() >= HEADLINE_RATIO_CANDIDATE;
}

/**
 * Unit AO, stage 2: is this pair the SAME story -- the tier that stamps or
 * discards (lead-filing.ts:111), so the tier held to the higher bar.
 *
 * Two ways to earn it, both requiring a shared name, agreement on the subject
 * and no contradiction between the two headlines' facts (see subjectsAgree and
 * factsConflict):
 *
 *   - a shared specific fact AND the two headlines substantially the same
 *     sentence (>= HEADLINE_RATIO_CANDIDATE), which is the 433/374 pair: the
 *     same Oct. 10 Purrs & Paws fundraiser at the Longmont Museum, one of them
 *     run by the Friends of Feral & Abandoned Cats and the other by the Longmont
 *     Cat Rescue, at 0.81 of shared characters. The ratio floor is what a shared
 *     fact is worth on its own: a fact alone says two headlines are about the
 *     same THING, not that they are the same STORY, and 282 "Budget presentation
 *     flags Public Safety Sales and Use Tax and Property Tax on Nov. 3 ballot"
 *     shares Nov. 3 with 435's budget headline at 0.41 -- related, and not the
 *     same event.
 *   - a headline that is the same characters in the same order: byte-identical
 *     for 418/349, and 0.87 for 429 against the killed 354 -- the same Boulder
 *     County funding-oversight story, 429 naming the roles and 354 the
 *     volunteers, 354 carrying a deadline 429 does not. That last pair is why
 *     this route reads agreement-on-facts and not identical-facts: a second
 *     telling that ADDS a date is the same story, and requirement 3 files it
 *     HELD and linked. A second telling that CONTRADICTS one -- a different
 *     session date on the same template -- is not, which is what stops 297
 *     (Sept. 22) matching 302 (Sept. 8) at 0.88 characters.
 *
 * subjectsAgree is what keeps the 0.85 route from reading a shared date, a
 * shared amount and a shared place name as a shared story: NEG-11 shares
 * "Twin Peaks", Sept. 18, and 0.86 of its characters with the parking-variance
 * item and is a different agenda item; NEG-7 shares SVVSD, $850,000 and 0.99 of
 * its characters with the west-county item and is the other side of the county.
 * Both name a subject the other does not, and neither can be "strong".
 *
 * The grey zone between this and nearDuplicateCandidate is the file-and-link
 * tier, which is where a repeat that does not clear these bars goes: still
 * filed, still linked, never silently folded into the old row -- and handed to
 * the desk's own duplicate check (dup-check.ts) when a scan has one, which is
 * the model the grey zone was always for.
 */
function nearDuplicateStrong(a: string, b: string, place?: NewsroomPlace | null): boolean {
  const signals = nearDuplicateSignals(a, b, place);
  if (signals.sharedNames < 1 || !signals.factsAgree || !signals.subjectsAgree) return false;
  if (signals.charRatio() >= HEADLINE_ONLY_THRESHOLD) return true;
  return (
    signals.sharedSpecificAnchors >= NEAR_DUPLICATE_ANCHOR_MIN_SHARED &&
    signals.charRatio() >= HEADLINE_RATIO_CANDIDATE
  );
}

export type MatchCandidateLead = {
  id: number;
  status: string;
  headline: string;
  source_urls: string[];
  /** ISO timestamp. Omit (or leave undefined) to skip the lookback check --
   * callers that already filtered to the last 60 days by SQL can pass rows
   * without this field. */
  created_at?: string;
  /** Unit AK item 2: the lead's own words, used by newFactsIn to decide
   * whether a strong match against a KILLED lead carries facts that lead did
   * not have. Optional: callers that only match (and never compare facts) can
   * leave them out. An absent value means "this side recorded no facts", so a
   * lead with nothing recorded is never treated as already knowing something a
   * candidate says -- the candidate has to bring facts of its own before the
   * comparison can fire at all (see newFactsIn). */
  why?: string | null;
  evidence?: string | null;
  /** Unit AK item 2: when the lead was killed, and why, in the editor's
   * words (migration 0094). Read only so a new finding filed against a killed
   * lead can show the old reason; never used in matching. */
  killed_at?: string | null;
  kill_reason?: string | null;
};

/**
 * Find an existing lead that the given AI-returned candidate is the same
 * story as. Returns the matching lead's id, or null when nothing matches.
 *
 * Match rule (three independent paths, any one is sufficient; every path
 * also requires sharesDistinguishingEvidence -- QA-1 round 2, see CONTENT_STOPLIST's
 * doc comment):
 *   1. Shares at least one normalised source URL AND distinguishing-token
 *      overlap (distinguishingTokens -- contentTokens: furniture words and
 *      shared proper nouns stripped, >= 4 letters, plurals folded; and, for a
 *      headline with NO content tokens at all, its own proper nouns instead)
 *      is >= 0.6 Jaccard OR >= 0.7 containment of the shorter headline.
 *   2. Shares at least one normalised source URL AND the two headlines
 *      share >= ANCHOR_MATCH_MIN_SHARED anchors (concrete dates, dollar
 *      amounts, multi-digit numbers, or non-generic proper nouns) AND share
 *      at least one content word -- see extractAnchors and
 *      ANCHOR_MATCH_MIN_SHARED for why this catches a same-source rewrite
 *      that shares almost no words, and CONTENT_STOPLIST for why anchors
 *      alone are not enough to tell two different agenda items apart (QA-1).
 *   3. No shared URL, but distinguishing-token overlap is >= 0.85 Jaccard
 *      alone (a portal notice re-posted under a different deep link).
 *   4. Unit AO (2026-10-03): the near-duplicate candidate filter
 *      (nearDuplicateCandidate) -- a shared subject plus a shared specific
 *      anchor or a very high headline character ratio, with no shared URL
 *      required. See pairMatches, which is the one gate both callers use.
 *
 * Scoring every path over content tokens (not every surviving word) is what
 * keeps two different agenda items on one templated portal page ("Council
 * approves $180,000 police overtime contract at Sept. 12 meeting" vs
 * "...fire truck contract...") from clearing 0.6 Jaccard on furniture words
 * alone -- round 1 fixed this for path 2 only; round 2 (2026-09-02) closed
 * the same hole in paths 1 and 3, which QA-1's adversarial set caught
 * merging 7 of 13 pairs it should not have.
 *
 * Unit AN (2026-10-03): scoring content tokens only is also what made all
 * three paths unreachable for a headline whose every word of four letters or
 * more is a capitalised name -- the live scan-66 repeats. Those headlines now
 * score their own proper nouns; see distinguishingTokens for why the fallback
 * is on both sides being nameless and not either, and why no QA-1/U26 negative
 * moves.
 *
 * Only considers leads whose status is in MATCHABLE_STATUSES (never
 * 'published' -- a fresh development on a published story should file as
 * new) and, when `created_at` is present, within MATCH_LOOKBACK_DAYS days.
 *
 * `place` is the newsroom's own city/state/county (see NewsroomPlace), and it
 * decides which names count as the paper's own furniture rather than as facts
 * about a story. Every exported entry point takes it; a caller that passes
 * nothing gets the generic civic words only. Server callers read it with
 * `getPaperPlace` (./paper-settings.ts), the client from the paper identity it
 * already renders -- one source, so a match cannot mean two things on two
 * screens.
 */
/**
 * QA-1 round 3 (2026-09-02): pulled out of findMatchingLead's loop so
 * matchStrength() below can reuse the exact same "is this even a possible
 * match" gate that findMatchingLead has always used (the three paths
 * described in findMatchingLead's doc comment) without duplicating it.
 * Matching uses these same three paths. Selection prefers a strong match
 * over an earlier possible match so row order cannot hide an exact repeat.
 *
 * Unit AO (2026-10-03) added a fourth: the near-duplicate candidate filter
 * (nearDuplicateCandidate), which the three prose paths above cannot express.
 * It is still one gate for both callers -- findMatchingLead and matchStrength
 * call this function and nothing else -- so a pair can never be "strong" for
 * the tiering without having passed the same gate the selection used.
 */
function pairMatches(
  candidateHeadline: string,
  candidateUrls: string[],
  leadHeadline: string,
  leadUrls: string[],
  place?: NewsroomPlace | null,
): boolean {
  const shareUrl = sharesUrl(candidateUrls, leadUrls);
  if (shareUrl && headlinesOverlapEnough(candidateHeadline, leadHeadline, place)) {
    return true;
  }
  if (
    shareUrl &&
    sharedAnchorCount(
      extractAnchors(candidateHeadline, place),
      extractAnchors(leadHeadline, place),
    ) >= ANCHOR_MATCH_MIN_SHARED &&
    sharesDistinguishingEvidence(candidateHeadline, leadHeadline, place)
  ) {
    return true;
  }
  if (!shareUrl && headlinesAloneMatch(candidateHeadline, leadHeadline, place)) {
    return true;
  }
  // Unit AO (2026-10-03): the near-duplicate candidate filter -- see
  // nearDuplicateSignals. It is deliberately independent of `shareUrl`: 429
  // "Boulder County Opens Applications for Behavioral Health Funding Oversight
  // Roles" and the killed 354 cite no URL in common at all, and a headline that
  // is the same sentence twice needs no URL to be worth classifying.
  if (nearDuplicateCandidate(candidateHeadline, leadHeadline, place)) {
    return true;
  }
  return false;
}

/**
 * Unit AK items 1 and AK2 item 2 (2026-09-26): is this candidate the same
 * story as a lead THIS SAME SCAN RUN just filed? If so the two become one
 * lead (their source URLs merged) rather than two rows for one story.
 *
 * The real case: leads 207 and 212, same city page, same second, one of them
 * later published while the other sat on the Queue with a "≈ PRINTED" badge.
 * The scan batches de-duplicate leads by byte-identical headline only
 * (scan-batches.ts:109), and fileScanLeads discarded a repeat only at the
 * "strong" tier (lead-filing.ts:111), so a pair the matcher flagged as
 * "possible" -- and it does flag them, findMatchingLead has already returned
 * the match id -- fell through to the insert and both were filed.
 *
 * Two ways to be the same story, in order of how much they prove:
 *
 *  1. matchStrength says "strong". That tier is already trusted to DISCARD a
 *     finding outright (lead-filing.ts:111, `continue`, only a counter moves),
 *     so saying "these two are one lead, keep both source URLs" is strictly
 *     less destructive than what that tier already does. Nothing here changes
 *     that.
 *
 *  2. matchStrength says "possible" AND the two share a page that addresses
 *     ONE story (`sharesStoryPageUrl` -- not a section front, not a
 *     multi-item document; see isMultiItemDocumentUrl). Unit AK2 item 2: the
 *     real 207/212 pair is exactly this. Their content-token Jaccard is 0.43
 *     ("begin free evening meal program" vs "offer free evening meals
 *     beginning"), far below the 0.85 strong bar, so AK item 1 left them as
 *     two rows -- but both cite
 *     longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/,
 *     one news release about one story, and that shared article page is
 *     decisive in a way prose overlap is not.
 *
 * Why the "possible" tier could not simply be merged on prose, and why the URL
 * gate is the whole point: every lexical bar below "strong" merges pairs QA-1
 * (2026-09-02) proved are different stories, and those pairs are locked in by
 * tests in ./lead-match.test.ts. Two real ones, both flagged "possible" and
 * both clearing content-token overlap: NEG-7 ("...broadband expansion for
 * rural EAST county schools" vs "WEST county schools") scores 0.71 Jaccard,
 * and NEG-4 (closed-door session on "jail expansion" vs "staff pay raises")
 * clears it too. Both cite the SAME meeting page --
 * longmont.primegov.com/portal/meeting/12345 -- which is precisely the
 * multi-item document isMultiItemDocumentUrl excludes, so both still file two
 * leads, linked, exactly as before. A shared ARTICLE page does not have that
 * problem: one article URL addresses one story, so two sightings of it are
 * two sightings of that story. What is left for the excluded pairs is to keep
 * both rows and make the link unmissable and one-press resolvable, which is
 * what the Queue's "Looks already printed" chip, "Kill as duplicate" and the
 * Compare view do (unit AK items 4, 5 and 7).
 *
 * CONSEQUENCE, stated plainly so it is not mistaken for a complete fix: a
 * same-run "possible" pair with NO shared story page -- prose-only overlap
 * (path 3 of findMatchingLead), or a shared section front or shared meeting
 * document -- still files two rows. That is the deliberate trade: a false
 * "same story" here silently swallows the second story, which is the failure
 * the owner asked about ("Do I miss the real 2nd story?").
 */
export function sameStoryForMerge(
  candidate: { headline: string; source_urls?: string[] },
  existing: { headline: string; source_urls?: string[] },
  place?: NewsroomPlace | null,
): boolean {
  const candidateHeadline = candidate.headline ?? "";
  const existingHeadline = existing.headline ?? "";
  if (!candidateHeadline.trim() || !existingHeadline.trim()) return false;
  const candidateUrls = candidate.source_urls ?? [];
  const existingUrls = existing.source_urls ?? [];
  const strength = matchStrength(
    { headline: candidateHeadline, source_urls: candidateUrls },
    { headline: existingHeadline, source_urls: existingUrls },
    place,
  );
  if (strength === "strong") return true;
  if (strength !== "possible") return false;
  return sharesStoryPageUrl(candidateUrls, existingUrls);
}

/**
 * Unit AK item 2 (2026-09-26): does this finding carry facts the OTHER lead
 * does not have?
 *
 * The real case: a strong match against a KILLED lead is discarded today --
 * only `resurfaced_count` moves (lead-filing.ts:173). That is right when the
 * finding is the same story with nothing new ("same headline and no new
 * facts"). It is wrong when the new finding says something the killed lead
 * never said: the owner's question is exactly "Do I miss the real 2nd story?",
 * and a killed lead plus a new fact is the case where dropping it loses one.
 *
 * What counts as a fact: a concrete ANCHOR -- a date, a dollar amount, or a
 * number -- in the two leads' own words. See NEW_FACT_ANCHOR_KINDS.
 *
 * R2, item 1 (2026-10-03): the HEADLINE is counted too, on both sides. It used
 * to be excluded, on the reasoning that the caller had already established the
 * two are the same story, so letting headline wording count would make every
 * paraphrase look like a new fact. That was wrong about the instrument: a
 * paraphrase re-words a fact, it does not produce a NEW anchor, and the anchors
 * are dates/amounts/counts, which are the same token however they are spelled
 * (`Oct. 6`, `October 6th`, `2026-10-06` all fold to `date:20261006`). What the
 * exclusion DID do was let a repeat through whenever the OLD row's `why` and
 * `evidence` were thin or empty -- which is the rule the live run tripped: 429
 * "Longmont Library Closed Oct. 6 for All-Staff Training Day" carries "Oct. 6",
 * and the killed 367 it repeats "Longmont Library Closed All Day Oct. 6 for
 * Staff Training" carries the same "Oct. 6" in its own HEADLINE, but with a
 * blank `why` the old side saw no anchor at all and the repeat was filed as a
 * development. Counting the headline closes the case the exclusion was there
 * for: a date the old lead already states is not a new fact. A genuinely
 * changed fact still is -- 435 against the budget row 149 adds a date/amount
 * 149 never states anywhere, and still files as developing.
 *
 * The bar was once "one new anchor OR two new content tokens" (0.6.69 unit AK
 * as first written). The token half was wrong, and the Postgres end-to-end
 * test caught it: the scan model REWORDS `why` on every sighting -- the live
 * pair read "Testing a resurfaced kill" against "Same closed-session story,
 * reworded by the scan." -- so a plain reword of a killed lead's own words
 * cleared two new content tokens and was refiled as a development. That is the
 * exact opposite of what this bar is for: counting new WORDS refiles almost
 * every killed repeat, which is the noise the "possible" tier already exists to
 * avoid. Only a new concrete anchor is a fact somebody added.
 *
 * A new name does not clear it either, and that is deliberate: extractAnchors()
 * reads any capitalised word as a proper noun, so `noun:` cannot tell a name
 * from a sentence-initial capital -- "Officials said ..." against "Police said
 * ..." would refile every reworded duplicate. NEW_FACT_ANCHOR_KINDS lists the
 * kinds that do count.
 */
/** The anchor kinds that count as a new fact. `noun:` and `month:` are
 * deliberately absent -- see newFactsIn's doc comment (`month:` is a bare
 * month mention with no day, so "in September" vs "in October" is not the kind
 * of concrete new fact this bar is for). */
const NEW_FACT_ANCHOR_KINDS = ["date:", "amount:", "num:"] as const;

/** The concrete anchors in a lead's own words (its headline included), and
 * nothing else. */
function factAnchors(
  headline?: string | null,
  why?: string | null,
  evidence?: string | null,
  place?: NewsroomPlace | null,
): Set<string> {
  const text = `${headline ?? ""} ${why ?? ""} ${evidence ?? ""}`;
  const anchors = new Set<string>();
  for (const anchor of extractAnchors(text, place)) {
    if (NEW_FACT_ANCHOR_KINDS.some((kind) => anchor.startsWith(kind))) anchors.add(anchor);
  }
  return anchors;
}

export function newFactsIn(
  candidate: { headline?: string | null; why?: string | null; evidence?: string | null },
  existing: { headline?: string | null; why?: string | null; evidence?: string | null },
  place?: NewsroomPlace | null,
): boolean {
  const old = factAnchors(existing.headline, existing.why, existing.evidence, place);
  for (const anchor of factAnchors(candidate.headline, candidate.why, candidate.evidence, place)) {
    if (!old.has(anchor)) return true;
  }
  return false;
}

export function findMatchingLead(
  candidate: { headline: string; source_urls: string[] },
  existing: MatchCandidateLead[],
  place?: NewsroomPlace | null,
): number | null {
  const headline = candidate.headline ?? "";
  if (!headline.trim()) return null;
  const cutoff = Date.now() - MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  let firstPossible: number | null = null;
  let firstKilledPossible: number | null = null;

  for (const lead of existing) {
    if (!MATCHABLE_STATUSES.has(lead.status)) continue;
    if (lead.created_at) {
      const t = Date.parse(lead.created_at);
      if (Number.isFinite(t) && t < cutoff) continue;
    }
    const leadUrls = lead.source_urls ?? [];
    if (pairMatches(headline, candidate.source_urls ?? [], lead.headline, leadUrls, place)) {
      if (matchStrength(candidate, lead, place) === "strong") return lead.id;
      firstPossible ??= lead.id;
      if (lead.status === "killed") firstKilledPossible ??= lead.id;
    }
  }
  // Without an exact match, keep a prior kill visible to the filing policy.
  // Otherwise row order could turn another ambiguous rewrite back into NEW.
  return firstKilledPossible ?? firstPossible;
}
/**
 * GauntletGate QA-1, round 3 fix (2026-09-02): findMatchingLead's binary
 * discard-or-not decision cannot tell "same story reworded" apart from
 * "same agenda template, different item" from lexical overlap alone -- the
 * round-3 adversarial set found 6 false merges (two different agenda items
 * on the same boilerplate treated as one story) and 1 missed duplicate.
 * matchStrength replaces the binary decision with two tiers for any pair
 * pairMatches() already considers "the same story" at all:
 *
 *   - "strong": stamp the existing lead (findMatchingLead/fileScanLeads's
 *     old behaviour) -- when the near-duplicate classifier says so (see
 *     nearDuplicateStrong: a shared specific fact plus subject agreement, or
 *     the same headline character-for-character with no one-sided fact), or
 *     when ALL of:
 *       1. distinguishingTokens() Jaccard similarity is >= 0.85, AND
 *       2. every token in the symmetric difference of the two
 *          distinguishing-token sets has a variant partner on the other side
 *          (plural/possessive/hyphen forms -- see tokenVariant; the stem()
 *          call inside contentTokens, which distinguishingTokens builds on,
 *          already folds most of these before matchStrength ever sees them,
 *          so this is almost always trivially satisfied by an empty
 *          symmetric difference, but a real variant that stem() does not
 *          catch does not block "strong" either), AND
 *       3. the two leads share a normalised source URL, OR neither side has
 *          a URL to compare and the Jaccard score is >= 0.95.
 *   - "possible": pairMatches() found overlap, but not strong enough by the
 *     rule above -- file the candidate as a new lead linked to the existing
 *     one (possible_duplicate_of) instead of silently discarding it. This
 *     is what the 6 round-3 false merges become, and it is also what the
 *     live 0.6.2 rewrite pair (POS-2) becomes: it is a genuine rewrite of
 *     the same story, but its token Jaccard is far below 0.85 (the
 *     two headlines share almost no words beyond "executive session"), so
 *     it is filed and linked rather than silently folded into the old row --
 *     intentional, not a regression.
 *   - null: pairMatches() found no overlap at all -- do nothing.
 *
 * Only decides the STRENGTH of a pair findMatchingLead-style matching
 * already flagged; it does not change which pairs count as a match at all
 * (see pairMatches, shared by both).
 */
export function matchStrength(
  candidate: { headline: string; source_urls?: string[] },
  existing: { headline: string; source_urls?: string[] },
  place?: NewsroomPlace | null,
): "strong" | "possible" | null {
  const candidateHeadline = candidate.headline ?? "";
  const existingHeadline = existing.headline ?? "";
  if (!candidateHeadline.trim() || !existingHeadline.trim()) return null;
  const candidateUrls = candidate.source_urls ?? [];
  const existingUrls = existing.source_urls ?? [];

  if (!pairMatches(candidateHeadline, candidateUrls, existingHeadline, existingUrls, place)) {
    return null;
  }

  // Unit AO (2026-10-03): the near-duplicate classifier's strong tier, before
  // the prose score below, which is blind to a pair of headlines that say the
  // same thing in different names -- see nearDuplicateStrong. Both tiers of
  // this pair's decision come from the one signal struct (nearDuplicateSignals)
  // so the gate above and this cannot disagree about what they are looking at.
  if (nearDuplicateStrong(candidateHeadline, existingHeadline, place)) return "strong";

  const ca = distinguishingTokens(candidateHeadline, existingHeadline, place);
  const cb = distinguishingTokens(existingHeadline, candidateHeadline, place);
  const score = jaccard(ca, cb);
  const symmetricOk = symmetricDiffAllVariants(ca, cb);

  const shareUrl = sharesUrl(candidateUrls, existingUrls);
  // Unit AK item 3: a lead whose only URLs are index pages has not really
  // cited a source for this story, so it falls into the no-URL branch here
  // exactly as a lead that was filed with no URLs at all -- two leads with an
  // identical headline and only the crime front between them can still be
  // "strong" at score >= 0.95, but a shared section front can no longer make
  // two different stories "strong" by itself.
  const bothSidesHaveUrls =
    storyUrls(candidateUrls).length > 0 && storyUrls(existingUrls).length > 0;
  const urlOk = shareUrl || (!bothSidesHaveUrls && score >= 0.95);

  if (score >= 0.85 && symmetricOk && urlOk) return "strong";
  return "possible";
}

/** Two distinguishing tokens count as the same subject word for
 * matchStrength's symmetric-difference check when they are plural/possessive/
 * -es variants of each other. contentTokens() -- what distinguishingTokens
 * falls back through -- already runs stem() (trailing "s" fold, words > 4
 * letters) before matchStrength ever sees a token, and already turns hyphens
 * and apostrophes into spaces before tokenizing, so most variant pairs never
 * even reach here as a symmetric-difference entry -- this is the
 * belt-and-suspenders case stem() alone does not fold (e.g. a short word, or
 * an "-ies" plural). */
function tokenVariant(a: string, b: string): boolean {
  if (a === b) return true;
  const norm = (w: string) => w.replace(/ies$/, "y").replace(/(es|s)$/, "");
  return norm(a) === norm(b);
}

/** True when every token present on only one side of a and b's content-
 * token sets has a tokenVariant() partner somewhere on the other side.
 * Vacuously true when the symmetric difference is empty. */
function symmetricDiffAllVariants(a: Set<string>, b: Set<string>): boolean {
  const onlyA = [...a].filter((t) => !b.has(t));
  const onlyB = [...b].filter((t) => !a.has(t));
  return (
    onlyA.every((x) => [...b].some((y) => tokenVariant(x, y))) &&
    onlyB.every((x) => [...a].some((y) => tokenVariant(x, y)))
  );
}
