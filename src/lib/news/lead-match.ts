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
 * Match rule (two independent paths, either is sufficient):
 *   1. Shares at least one normalised source URL AND headline token overlap
 *      is >= 0.6 Jaccard OR >= 0.7 containment of the shorter headline.
 *   2. No shared URL, but headline token overlap is >= 0.85 Jaccard alone
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
    if (!shareUrl && headlinesAloneMatch(headline, lead.headline)) {
      return lead.id;
    }
  }
  return null;
}
