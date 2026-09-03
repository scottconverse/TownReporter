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
 * proper nouns that are not generic paper/city furniture (see
 * PROPER_NOUN_STOPLIST). When a source URL is already shared, two headlines
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

/** Proper nouns that are the paper's own furniture, not a distinguishing
 * fact about the story -- excluded from anchor/proper-noun extraction here
 * and reused by desk-copy.ts's nearDuplicate() for the same reason. */
export const PROPER_NOUN_STOPLIST = new Set([
  "longmont", "city", "council", "colorado", "townreporter",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

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
 * `noun:word` for a capitalised word not on PROPER_NOUN_STOPLIST. Matched
 * spans are blanked out of the working copy as they're consumed so a date's
 * day number isn't also counted as a bare `num:` anchor and a date's month
 * name isn't also counted as a `noun:` anchor. */
export function extractAnchors(headline: string): Set<string> {
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
      anchors.add(`amount:${full.toLowerCase().replace(/[\s,]/g, "")}`);
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

  for (const m of working.matchAll(/\b[A-Z][a-zA-Z']{2,}\b/g)) {
    const w = m[0].toLowerCase();
    if (!PROPER_NOUN_STOPLIST.has(w)) anchors.add(`noun:${w}`);
  }

  return anchors;
}

/** Proper nouns from a headline, excluding PROPER_NOUN_STOPLIST -- the
 * `noun:*` subset of extractAnchors, unprefixed. Shared by desk-copy.ts's
 * nearDuplicate() so both call sites use one stoplist. */
export function nonStoplistedProperNouns(headline: string): Set<string> {
  const out = new Set<string>();
  for (const anchor of extractAnchors(headline)) {
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

function sharesUrl(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set(a.map(normalizeSourceUrl).filter(Boolean));
  for (const u of b) {
    if (setA.has(normalizeSourceUrl(u))) return true;
  }
  return false;
}

/**
 * QA-1 (round 2): both headline-overlap paths score CONTENT tokens, not
 * every surviving word -- see contentTokens and CONTENT_STOPLIST's doc
 * comment for why scoring civic-agenda furniture ("council approves ...
 * contract at ... meeting") let two different agenda items look like a
 * paraphrase of each other. sharesContentWord is also required explicitly:
 * given the thresholds below are all > 0, a nonzero Jaccard/containment
 * score already implies at least one shared content token, but the explicit
 * check keeps that invariant true even if a threshold is ever loosened.
 */
function headlinesOverlapEnough(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  return (
    (jaccard(ta, tb) >= HEADLINE_JACCARD_THRESHOLD || containment(ta, tb) >= HEADLINE_CONTAINMENT_THRESHOLD) &&
    sharesContentWord(a, b)
  );
}

function headlinesAloneMatch(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  return jaccard(ta, tb) >= HEADLINE_ONLY_THRESHOLD && sharesContentWord(a, b);
}

/** Words at least 4 letters long, present in the headline, and NOT on
 * STOP_WORDS, PROPER_NOUN_STOPLIST, or CONTENT_STOPLIST -- see
 * CONTENT_STOPLIST's doc comment -- and not a non-stoplisted proper noun
 * (nonStoplistedProperNouns) either. That last exclusion matters for match
 * path 2: a shared place name like "Twin Peaks" is already scored as an
 * anchor (noun:twin, noun:peaks), so reusing it here would let two
 * different agenda items about the same place ("Twin Peaks rezoning
 * application" vs "Twin Peaks parking variance") satisfy sharesContentWord
 * on the location alone -- the anchor path needs a *different* piece of
 * evidence that the SUBJECT, not just the place, is the same. Plural/
 * singular variants are folded together (stem) after the stoplist checks,
 * which all key on the raw word. */
function contentTokens(headline: string): Set<string> {
  const properNouns = nonStoplistedProperNouns(headline);
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !STOP_WORDS.has(w) &&
        !PROPER_NOUN_STOPLIST.has(w) &&
        !CONTENT_STOPLIST.has(w) &&
        !properNouns.has(w),
    )
    .map(stem);
  return new Set(words);
}

/** QA-1: required alongside the overlap score for every match path (1, 2,
 * and 3) -- see findMatchingLead and CONTENT_STOPLIST's doc comment. */
function sharesContentWord(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  for (const w of ta) if (tb.has(w)) return true;
  return false;
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
};

/**
 * Find an existing lead that the given AI-returned candidate is the same
 * story as. Returns the matching lead's id, or null when nothing matches.
 *
 * Match rule (three independent paths, any one is sufficient; every path
 * also requires sharesContentWord -- QA-1 round 2, see CONTENT_STOPLIST's
 * doc comment):
 *   1. Shares at least one normalised source URL AND CONTENT-token overlap
 *      (contentTokens -- furniture words and shared proper nouns stripped,
 *      >= 4 letters, plurals folded) is >= 0.6 Jaccard OR >= 0.7 containment
 *      of the shorter headline.
 *   2. Shares at least one normalised source URL AND the two headlines
 *      share >= ANCHOR_MATCH_MIN_SHARED anchors (concrete dates, dollar
 *      amounts, multi-digit numbers, or non-generic proper nouns) AND share
 *      at least one content word -- see extractAnchors and
 *      ANCHOR_MATCH_MIN_SHARED for why this catches a same-source rewrite
 *      that shares almost no words, and CONTENT_STOPLIST for why anchors
 *      alone are not enough to tell two different agenda items apart (QA-1).
 *   3. No shared URL, but CONTENT-token overlap is >= 0.85 Jaccard alone
 *      (a portal notice re-posted under a different deep link).
 *
 * Scoring every path over content tokens (not every surviving word) is what
 * keeps two different agenda items on one templated portal page ("Council
 * approves $180,000 police overtime contract at Sept. 12 meeting" vs
 * "...fire truck contract...") from clearing 0.6 Jaccard on furniture words
 * alone -- round 1 fixed this for path 2 only; round 2 (2026-09-02) closed
 * the same hole in paths 1 and 3, which QA-1's adversarial set caught
 * merging 7 of 13 pairs it should not have.
 *
 * Only considers leads whose status is in MATCHABLE_STATUSES (never
 * 'published' -- a fresh development on a published story should file as
 * new) and, when `created_at` is present, within MATCH_LOOKBACK_DAYS days.
 */
/**
 * QA-1 round 3 (2026-09-02): pulled out of findMatchingLead's loop so
 * matchStrength() below can reuse the exact same "is this even a possible
 * match" gate that findMatchingLead has always used (the three paths
 * described in findMatchingLead's doc comment) without duplicating it.
 * findMatchingLead's own behaviour is unchanged by this extraction -- same
 * three paths, same order, same early return on the first hit.
 */
function pairMatches(
  candidateHeadline: string,
  candidateUrls: string[],
  leadHeadline: string,
  leadUrls: string[],
): boolean {
  const shareUrl = sharesUrl(candidateUrls, leadUrls);
  if (shareUrl && headlinesOverlapEnough(candidateHeadline, leadHeadline)) {
    return true;
  }
  if (
    shareUrl &&
    sharedAnchorCount(extractAnchors(candidateHeadline), extractAnchors(leadHeadline)) >= ANCHOR_MATCH_MIN_SHARED &&
    sharesContentWord(candidateHeadline, leadHeadline)
  ) {
    return true;
  }
  if (!shareUrl && headlinesAloneMatch(candidateHeadline, leadHeadline)) {
    return true;
  }
  return false;
}

export function findMatchingLead(
  candidate: { headline: string; source_urls: string[] },
  existing: MatchCandidateLead[],
): number | null {
  const headline = candidate.headline ?? "";
  if (!headline.trim()) return null;
  const cutoff = Date.now() - MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  for (const lead of existing) {
    if (!MATCHABLE_STATUSES.has(lead.status)) continue;
    if (lead.created_at) {
      const t = Date.parse(lead.created_at);
      if (Number.isFinite(t) && t < cutoff) continue;
    }
    if (pairMatches(headline, candidate.source_urls ?? [], lead.headline, lead.source_urls ?? [])) {
      return lead.id;
    }
  }
  return null;
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
 *     old behaviour) -- only when ALL of:
 *       1. contentTokens() Jaccard similarity is >= 0.85, AND
 *       2. every token in the symmetric difference of the two content-token
 *          sets has a variant partner on the other side (plural/possessive/
 *          hyphen forms -- see tokenVariant; contentTokens' own stem() call
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
 *     the same story, but its content-token Jaccard is far below 0.85 (the
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
): "strong" | "possible" | null {
  const candidateHeadline = candidate.headline ?? "";
  const existingHeadline = existing.headline ?? "";
  if (!candidateHeadline.trim() || !existingHeadline.trim()) return null;
  const candidateUrls = candidate.source_urls ?? [];
  const existingUrls = existing.source_urls ?? [];

  if (!pairMatches(candidateHeadline, candidateUrls, existingHeadline, existingUrls)) {
    return null;
  }

  const ca = contentTokens(candidateHeadline);
  const cb = contentTokens(existingHeadline);
  const score = jaccard(ca, cb);
  const symmetricOk = symmetricDiffAllVariants(ca, cb);

  const shareUrl = sharesUrl(candidateUrls, existingUrls);
  const bothSidesHaveUrls = candidateUrls.length > 0 && existingUrls.length > 0;
  const urlOk = shareUrl || (!bothSidesHaveUrls && score >= 0.95);

  if (score >= 0.85 && symmetricOk && urlOk) return "strong";
  return "possible";
}

/** Two content tokens count as the same subject word for matchStrength's
 * symmetric-difference check when they are plural/possessive/-es variants
 * of each other. contentTokens() already runs stem() (trailing "s" fold,
 * words > 4 letters) before matchStrength ever sees a token, and already
 * turns hyphens and apostrophes into spaces before tokenizing, so most
 * variant pairs never even reach here as a symmetric-difference entry --
 * this is the belt-and-suspenders case stem() alone does not fold (e.g. a
 * short word, or an "-ies" plural). */
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
