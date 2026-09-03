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
 * QA-1 (2026-09-02): the anchor path above was built for a same-story
 * rewrite that shares a source URL plus >= 2 concrete anchors (a date, a
 * dollar amount, a proper noun...) but almost no prose. It did not guard
 * against two DIFFERENT stories on the same portal page that happen to share
 * a meeting date and a round dollar figure -- "Council votes on $250,000
 * library roof repair contract at Sept. 10 meeting" vs "Council approves
 * $250,000 park irrigation contract at Sept. 10 meeting" cleared the anchor
 * bar (shared URL, shared date, shared amount) despite naming two unrelated
 * subjects, and the matched candidate's content was silently discarded (see
 * lead-filing.ts).
 *
 * These are words a civic-agenda headline reaches for regardless of subject
 * -- true of every item on every meeting's agenda, so sharing one proves
 * nothing about whether two headlines are the SAME item. Combined with
 * PROPER_NOUN_STOPLIST and STOP_WORDS below to build the anchor path's
 * required content-word overlap (see sharesContentWord): the anchor path
 * now also requires at least one shared word that survives all three lists,
 * so "executive"/"sessions" (a real same-story match, kept) still clears the
 * bar while "roof"/"repair" vs "irrigation" (two different subjects, fixed)
 * does not.
 */
const CONTENT_STOPLIST = new Set([
  "council", "board", "boards", "meeting", "meetings", "vote", "votes", "voted",
  "approve", "approves", "approved", "contract", "contracts", "agenda", "agendas",
  "item", "items", "session", "sessions", "hearing", "hearings", "notice", "notices",
  "public", "sept", "city",
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

function headlineTokens(headline: string): Set<string> {
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
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

function headlinesOverlapEnough(a: string, b: string): boolean {
  const ta = headlineTokens(a);
  const tb = headlineTokens(b);
  return jaccard(ta, tb) >= HEADLINE_JACCARD_THRESHOLD || containment(ta, tb) >= HEADLINE_CONTAINMENT_THRESHOLD;
}

function headlinesAloneMatch(a: string, b: string): boolean {
  const ta = headlineTokens(a);
  const tb = headlineTokens(b);
  return jaccard(ta, tb) >= HEADLINE_ONLY_THRESHOLD;
}

/** Words at least 4 letters long, present in the headline, and NOT on
 * STOP_WORDS, PROPER_NOUN_STOPLIST, or CONTENT_STOPLIST -- see
 * CONTENT_STOPLIST's doc comment. This is deliberately a lower bar than
 * headlineTokens' full-overlap scoring: the anchor path only needs proof
 * the two headlines are about the same SUBJECT, not that they are a close
 * paraphrase of each other. */
function contentTokens(headline: string): Set<string> {
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !STOP_WORDS.has(w) &&
        !PROPER_NOUN_STOPLIST.has(w) &&
        !CONTENT_STOPLIST.has(w),
    );
  return new Set(words);
}

/** QA-1: required alongside the anchor count for match path 2 -- see
 * findMatchingLead and CONTENT_STOPLIST's doc comment. */
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
 * Match rule (three independent paths, any one is sufficient):
 *   1. Shares at least one normalised source URL AND headline token overlap
 *      is >= 0.6 Jaccard OR >= 0.7 containment of the shorter headline.
 *   2. Shares at least one normalised source URL AND the two headlines
 *      share >= ANCHOR_MATCH_MIN_SHARED anchors (concrete dates, dollar
 *      amounts, multi-digit numbers, or non-generic proper nouns) AND share
 *      at least one content word (>= 4 letters, not generic civic
 *      furniture -- see CONTENT_STOPLIST) -- see extractAnchors and
 *      ANCHOR_MATCH_MIN_SHARED for why this catches a same-source rewrite
 *      that shares almost no words, and CONTENT_STOPLIST for why anchors
 *      alone are not enough to tell two different agenda items apart (QA-1).
 *   3. No shared URL, but headline token overlap is >= 0.85 Jaccard alone
 *      (a portal notice re-posted under a different deep link).
 *
 * Only considers leads whose status is in MATCHABLE_STATUSES (never
 * 'published' -- a fresh development on a published story should file as
 * new) and, when `created_at` is present, within MATCH_LOOKBACK_DAYS days.
 */
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
    const shareUrl = sharesUrl(candidate.source_urls ?? [], lead.source_urls ?? []);
    if (shareUrl && headlinesOverlapEnough(headline, lead.headline)) {
      return lead.id;
    }
    if (
      shareUrl &&
      sharedAnchorCount(extractAnchors(headline), extractAnchors(lead.headline)) >= ANCHOR_MATCH_MIN_SHARED &&
      sharesContentWord(headline, lead.headline)
    ) {
      return lead.id;
    }
    if (!shareUrl && headlinesAloneMatch(headline, lead.headline)) {
      return lead.id;
    }
  }
  return null;
}
