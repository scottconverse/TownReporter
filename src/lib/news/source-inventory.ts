/**
 * WHAT ONE ACCEPTED SOURCE IS FOR, and what the desk actually knows about it.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE SCREEN. The Sources screen answers
 * "which rows does the editor watch". This answers a different question the
 * editor asks before a pass: "of the sources I am paying to check, which are
 * worth checking today, which are reference material I read when a story cites
 * them, and which have been quietly broken for weeks". That question is asked
 * by the daily rotation (adaptive-source-selection.ts) and by the inventory
 * deliverable an editor reads once to see the whole pool. Both need the same
 * facts, so the judgement lives here, pure, where a test can pin it without a
 * database and without a network.
 *
 * THE ONE HONESTY THIS MODULE EXISTS FOR: "no lead" is not "dead". A source
 * that checked cleanly and filed nothing may be a quiet institution, a static
 * roster, or a page that simply had no news; a source we could not read is a
 * retrieval failure, not a verdict on the site. The observation vocabulary below
 * keeps those apart, and `retirementCandidate` refuses to call anything dead on
 * old errors alone or on zero leads.
 *
 * NOTHING HERE FETCHES, WRITES, OR LEARNS. A "watch" versus "reference" call is
 * a conservative read of the facts already on the row; the editor can always
 * disagree, and the selection path treats their pick as final.
 */

/** What a source is FOR, as far as its stored facts support saying. */
export const SOURCE_PURPOSES = [
  /** A page that changes and is worth checking on a schedule (feeds, agendas). */
  "watch",
  /** A stable document/record read when a story cites it, not on a cadence. */
  "reference",
  /** Neither fact supports a call yet -- the desk says so rather than guessing. */
  "unknown",
] as const;

export type SourcePurpose = (typeof SOURCE_PURPOSES)[number];

/**
 * WHAT THE LAST CHECK ACTUALLY SHOWED. These are deliberately distinct because
 * the editor's next move is different for each one, and lumping them under
 * "inactive" is the mistake this vocabulary prevents.
 */
export const SOURCE_OBSERVATIONS = [
  /**
   * Read cleanly AND the stored content version differs from the last one we
   * saw. This is the ONLY "changed" this vocabulary allows: it needs a content
   * fact (a hash), not a lead count.
   */
  "changed-content",
  /**
   * Read cleanly AND the stored content version is the same as last time. The
   * page is identical; it is quiet, not broken. Also needs a content fact.
   */
  "unchanged-content",
  /**
   * Read cleanly, produced no new items, and the desk has NO content version to
   * compare. The honest state for "we fetched it and nothing new came out, and
   * we cannot say whether the bytes moved" -- a quiet school page on a fetcher
   * that does not store a hash. It is NOT "no-change": nothing here claims the
   * page is byte-identical, only that no item was produced.
   */
  "no-new-items",
  /**
   * Read cleanly and produced new items, but the desk has no content version to
   * compare, so it cannot say whether the page CHANGED or simply yielded items
   * it had not yielded before. Separate from `changed-content` on purpose: a
   * lead count is evidence of items, not of bytes.
   */
  "new-items-unknown-content",
  /** We never reached the page: timeout, DNS, connection refused. */
  "retrieval-error",
  /** We reached the page but could not turn it into text/leads. */
  "extraction-failure",
  /** The host asked us to come back later (429/503). A wait, not a fault. */
  "asked-to-wait",
  /** The host refused us (401/403). A block we should back off, not a dead site. */
  "blocked",
  /** Never checked since it was accepted. */
  "never-checked",
] as const;

export type SourceObservation = (typeof SOURCE_OBSERVATIONS)[number];

/** The stored facts about one source this module reasons over. Every field is
 *  optional because a caller may select a narrower row; a missing field reads as
 *  "unknown", never as a value. */
export type SourceHealthFacts = {
  id: number;
  url: string;
  title: string;
  kind?: string | null;
  tier?: string | null;
  status?: string | null;
  /** Snapshots this source's row counts as "new items since the last pass". */
  new_since_last_pass?: number | null;
  last_error?: string | null;
  last_fetched_at?: string | null;
  last_ok_at?: string | null;
  /**
   * The content version the fetcher stored for this source, when it keeps one.
   * This is the ONLY fact that can support a "changed" versus "unchanged"
   * claim: a lead count is about leads read, not about whether the bytes on
   * the page moved. Absent means the desk does not know whether the content
   * changed, and the observation says so instead of guessing.
   */
  last_hash?: string | null;
  /**
   * Set by the caller ONLY when it compared this fetch's content against the
   * PRIOR stored content version. `true` means the bytes differ, `false` means
   * they are identical, and `undefined` means the desk did not compare and must
   * not claim either. A lead count is never a substitute for this fact.
   */
  content_version_changed?: boolean | null;
  /**
   * The purpose the editor recorded for this source, if any. Their call
   * outranks every heuristic here (the same way their selection outranks the
   * rotation), because the desk exists to serve their judgement, not replace
   * it.
   */
  purpose_preference?: SourcePurpose | null;
  /**
   * A previously recorded, actually-observed purpose for this source, if the
   * desk stored one (for example from an accepted observation history). This is
   * the "historical actual observations" signal: a page seen to change is a
   * watch even when its address looks static. A bare "we read it once" is NOT
   * this fact and must not be mistaken for it.
   */
  observed_purpose?: SourcePurpose | null;
  consecutive_failures?: number | null;
  failure_streak_started_at?: string | null;
  retry_after?: string | null;
  blocked_at?: string | null;
  blocked_attempts?: number | null;
  /** When the row was created (accepted), when the API can supply it. */
  created_at?: string | null;
  /** The section keys this source is filed under, when the caller has them. */
  beats?: readonly string[] | null;
};

/**
 * WHAT A URL LOOKS LIKE IT IS, before any fetch. This is the only signal
 * available for a source that has never been checked, and it is a hint the
 * editor confirms, not a fact: a `.pdf` is usually a document, a feed path is
 * usually a feed.
 */
const FEED = /\/(feed|rss|atom|rss\.xml|feed\.xml|index\.xml)\b|\?[^#]*\bformat=rss\b/i;
const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt)([?#]|$)/i;
const SITEMAP = /sitemap/i;
const CALENDAR = /\/(calendar|events?|ical|\.ics)\b|webcal:/i;
const AGENDA = /(agenda|minutes|packet|notice|ordinance|resolution|meeting|staff-report)/i;

export type UrlShape =
  | "feed"
  | "document"
  | "sitemap"
  | "calendar"
  | "agenda-like"
  | "page";

export function urlShape(url: string): UrlShape {
  const value = String(url ?? "").trim();
  if (FEED.test(value)) return "feed";
  if (SITEMAP.test(value)) return "sitemap";
  if (CALENDAR.test(value)) return "calendar";
  if (DOCUMENT.test(value)) return "document";
  if (AGENDA.test(value)) return "agenda-like";
  return "page";
}

/**
 * THE PURPOSE CALL, and the reason it errs toward "unknown" rather than
 * "reference".
 *
 * WHAT A SUCCESSFUL READ PROVES: that the desk reached the page. It does NOT
 * prove the page is static. A school page with no news this week, a board that
 * meets monthly, and a document that never changes all read cleanly and file
 * nothing -- so "read fine, no new leads" cannot be turned into "reference".
 * This function used to do exactly that (`last_ok_at` set => reference), which
 * turned 168 of 201 accepted sources into reference on the strength of one
 * quiet read. A quiet source must not be retired into reference by its own
 * silence.
 *
 * WHAT IT USES, IN ORDER, and each is a real fact rather than a guess:
 *
 *   1. THE EDITOR'S RECORDED PURPOSE. `purpose_preference` is their call and
 *      wins outright; the desk never overrules it.
 *   2. A RECORDED, ACTUALLY-OBSERVED PURPOSE. `observed_purpose` is what the
 *      desk saw happen (this page changed, so it is a watch). History beats the
 *      address shape.
 *   3. A CHANGED PAGE IS A WATCH. A source with a stored content version that
 *      differs from what a lead-count cannot tell us about -- but an explicit
 *      `new_since_last_pass > 0` at least once is still evidence the page
 *      carries items; treat that as a watch, because a page that has produced
 *      items is a page worth re-checking.
 *   4. THE ADDRESS SHAPE, but only for shapes that carry a real cadence or
 *      staticness signal: a feed/calendar/agenda path is a watch; a document or
 *      sitemap is reference material WITH A REASON (a PDF agenda is read when a
 *      story cites it; that is a fact about the address, not an assumption from
 *      silence).
 *   5. OTHERWISE "unknown" -- which is the honest answer for a bare page whose
 *      only fact is that it was read once, and which the rotation still treats
 *      as a trial read rather than a settled reference row.
 */
export function classifyPurpose(facts: SourceHealthFacts): SourcePurpose {
  // 1. The editor's own recorded call is final.
  if (facts.purpose_preference) return facts.purpose_preference;
  // 2. A recorded observation of what actually happened beats the address shape.
  if (facts.observed_purpose) return facts.observed_purpose;
  // 3. A page that has produced items is a page worth re-checking.
  if ((facts.new_since_last_pass ?? 0) > 0) return "watch";
  const shape = urlShape(facts.url);
  // 4. Shapes that genuinely signal a cadence or a document.
  if (shape === "feed" || shape === "calendar" || shape === "agenda-like") return "watch";
  if (shape === "document" || shape === "sitemap") return "reference";
  // 5. A read we cannot turn into a cadence claim is unknown, not reference.
  return "unknown";
}

/**
 * WHY a row reads the way it does. Purpose is a judgement, and a judgement the
 * editor cannot audit is a guess wearing a label. `purposeReason` names the
 * single fact that decided the call, so the CSV and the screen can print it and
 * the editor can disagree with the exact input rather than the whole row.
 */
export type PurposeReason =
  | "editor-set"
  | "observed-history"
  | "has-produced-items"
  | "feed-or-calendar"
  | "document-or-sitemap"
  | "no-cadence-signal";

export function purposeReason(facts: SourceHealthFacts): PurposeReason {
  if (facts.purpose_preference) return "editor-set";
  if (facts.observed_purpose) return "observed-history";
  if ((facts.new_since_last_pass ?? 0) > 0) return "has-produced-items";
  const shape = urlShape(facts.url);
  if (shape === "feed" || shape === "calendar" || shape === "agenda-like") return "feed-or-calendar";
  if (shape === "document" || shape === "sitemap") return "document-or-sitemap";
  return "no-cadence-signal";
}

/**
 * WHAT THE LAST CHECK SHOWED, from the row's own columns and nothing else.
 *
 * ORDER MATTERS. A parked or blocked row is reported as such even if it also
 * carries a `last_error`, because the wait/block is the more specific fact and
 * the one the editor acts on ("come back at 3:40 PM" beats "could not check").
 *
 * THE HONESTY THIS FUNCTION NOW KEEPS. A successful read is `last_ok_at` set at
 * least as recently as the last attempt; that much is a fact. But whether the
 * CONTENT changed is a DIFFERENT fact, and this row usually does not carry it.
 * So:
 *
 *   - with a stored content version (`last_hash`) compared against the prior
 *     fetch, a clean read is `changed-content` or `unchanged-content`;
 *   - with NO content version, a clean read that yielded no items is
 *     `no-new-items`, and one that yielded items is `new-items-unknown-content`.
 *     Neither claims the bytes moved or stayed put -- the desk does not know.
 *
 * This replaces the old `new_since_last_pass > 0 ? "changed" : "no-change"`,
 * which asserted a byte-level fact from a lead count. A lead count is about
 * items, not bytes.
 *
 * `contentKnown` on the result says whether the content-comparison branch
 * applied, so a caller can phrase the row without re-deriving it.
 */
export function classifyObservation(
  facts: SourceHealthFacts,
  nowMs = Date.now(),
): SourceObservation {
  // A block is the more specific fact and outranks a wait: the host refused us,
  // where a wait says it asked us back later. Both are backed off, but they read
  // differently to the editor and the rotation defers them with different reasons.
  if (facts.blocked_at) return "blocked";
  if (facts.retry_after && Date.parse(facts.retry_after) > nowMs) return "asked-to-wait";
  const lastOk = facts.last_ok_at ? Date.parse(facts.last_ok_at) : null;
  const lastTry = facts.last_fetched_at ? Date.parse(facts.last_fetched_at) : null;
  if (lastOk != null && (lastTry == null || lastOk >= lastTry)) {
    const hasContentFact = facts.last_hash != null && String(facts.last_hash).length > 0;
    const producedItems = (facts.new_since_last_pass ?? 0) > 0;
    /*
      A content version is per-fetch state, not a history: the row holds the
      CURRENT hash, and a comparison needs the PRIOR one. `contentVersionChanged`
      is therefore an explicit, optional fact the caller sets when it compared
      this fetch's bytes against the stored prior hash. When the caller has not
      compared, we must not manufacture the answer, so a present-but-uncompared
      hash still reads as the honest "items, content unknown" states.
    */
    const changed = facts.content_version_changed;
    if (hasContentFact && typeof changed === "boolean") {
      if (changed) return "changed-content";
      return producedItems ? "new-items-unknown-content" : "unchanged-content";
    }
    return producedItems ? "new-items-unknown-content" : "no-new-items";
  }
  if (facts.last_error) {
    // A message that names a fetch-level failure is a retrieval problem; one
    // that got bytes back but could not use them is extraction. The strings are
    // the ones `fetch-politeness.ts` and the fetcher write.
    return /extract|parse|readab|empty page|had almost no|no text/i.test(facts.last_error)
      ? "extraction-failure"
      : "retrieval-error";
  }
  /*
    A last attempt more recent than the last successful read, with no recorded
    error, is not a clean read and not a failure: the desk does not know what
    came back. "no-new-items" is the honest closest state -- we are not claiming
    the content changed or stayed the same.
  */
  if (lastTry != null) return "no-new-items";
  return "never-checked";
}

/**
 * A quiet source is one the desk READ and that yielded nothing to act on. The
 * state not to punish. It covers an unchanged page, a page whose content we
 * could not compare but that produced no items, and a page that produced items
 * from content we could not compare -- in every case the desk reached it and
 * nothing here is a fault. Errors, waits and blocks are explicitly NOT quiet.
 */
export function isQuiet(observation: SourceObservation): boolean {
  return (
    observation === "unchanged-content" ||
    observation === "changed-content" ||
    observation === "no-new-items" ||
    observation === "new-items-unknown-content"
  );
}

/** A source the desk could not read at all: a retrieval/extraction problem. */
export function isUnreadable(observation: SourceObservation): boolean {
  return observation === "retrieval-error" || observation === "extraction-failure";
}

/** The whole judgement for one row, ready for the inventory and the rotation. */
export type SourceHealth = {
  id: number;
  url: string;
  title: string;
  host: string | null;
  purpose: SourcePurpose;
  /** The single fact that decided `purpose`, so the row can be audited. */
  purposeReason: PurposeReason;
  observation: SourceObservation;
  /** True when the source has never produced a change the desk could see. */
  everChanged: boolean;
  /**
   * True when `observation` rests on a real content comparison (a stored prior
   * hash) rather than on a lead count. Callers that phrase the row must consult
   * this before saying anything about "the page changed".
   */
  contentCompared: boolean;
  /** Whole days since the last successful read, or null when never read. */
  daysSinceRead: number | null;
  /** True when the row is parked by the host or blocked, so not due yet. */
  parked: boolean;
};

export function hostOf(url: string): string | null {
  try {
    const u = new URL(String(url ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function healthOf(facts: SourceHealthFacts, nowMs = Date.now()): SourceHealth {
  const observation = classifyObservation(facts, nowMs);
  const lastOk = facts.last_ok_at ? Date.parse(facts.last_ok_at) : null;
  return {
    id: facts.id,
    url: facts.url,
    title: facts.title,
    host: hostOf(facts.url),
    purpose: classifyPurpose(facts),
    purposeReason: purposeReason(facts),
    observation,
    everChanged: (facts.new_since_last_pass ?? 0) > 0,
    contentCompared:
      facts.last_hash != null &&
      String(facts.last_hash).length > 0 &&
      typeof facts.content_version_changed === "boolean",
    daysSinceRead: lastOk != null && Number.isFinite(lastOk)
      ? Math.floor((nowMs - lastOk) / 86_400_000)
      : null,
    parked:
      (facts.retry_after != null && Date.parse(facts.retry_after) > nowMs) ||
      Boolean(facts.blocked_at),
  };
}

/**
 * DUPLICATES AND REPLACEMENTS, at the address level only.
 *
 * The desk has two ways to watch the same thing: the same URL twice (blocked by
 * the table's unique constraint, so only across differing query strings), or two
 * addresses that resolve to the same document (www vs apex, http vs https, a
 * trailing slash, a tracking parameter). This is deliberately conservative: it
 * flags a pair only when the normalized URLs are equal, and never calls two
 * different paths on one host a duplicate just because they share a host.
 */

/** A URL reduced to what makes two addresses the same document. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(String(url ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return String(url ?? "").trim();
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    // Drop the tracking parameters that never change identity; keep the rest
    // sorted so ?a=1&b=2 and ?b=2&a=1 compare equal.
    const keep = [...u.searchParams.entries()]
      .filter(([key]) => !/^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const search = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${host}${path}${search}`;
  } catch {
    return String(url ?? "").trim();
  }
}

export type DuplicatePair = {
  /** The row the editor should keep, by convention the lower id (oldest). */
  keepId: number;
  /** The row that repeats it. */
  repeatId: number;
  normalized: string;
  reason: "same-address" | "same-document";
};

/**
 * Find duplicate pairs across accepted sources. Two rows with the SAME
 * normalized address are `same-address`; two rows with the same host AND the
 * same final path segment that is a document or feed are `same-document`. The
 * lower id is kept so the decision is stable and the older citation history is
 * the one preserved.
 */
export function duplicatePairs(sources: readonly SourceHealthFacts[]): DuplicatePair[] {
  const byKey = new Map<string, number>();
  const pairs: DuplicatePair[] = [];
  for (const source of [...sources].sort((a, b) => a.id - b.id)) {
    const normalized = normalizeUrl(source.url);
    const key = normalized;
    const prior = byKey.get(key);
    if (prior != null) {
      pairs.push({ keepId: prior, repeatId: source.id, normalized, reason: "same-address" });
      continue;
    }
    byKey.set(key, source.id);
    // A second key on the last path segment, so /minutes.pdf and
    // /docs/minutes.pdf on one host are caught as the same document.
    const tail = key.split("/").pop() ?? "";
    if (tail && (/(\.pdf|\.docx?|\.xlsx?)$/i.test(tail) || (source.kind ?? "") === "feed")) {
      const docKey = `doc:${hostOf(source.url) ?? ""}/${tail}`;
      const priorDoc = byKey.get(docKey);
      if (priorDoc != null) {
        pairs.push({
          keepId: priorDoc,
          repeatId: source.id,
          normalized,
          reason: "same-document",
        });
      } else byKey.set(docKey, source.id);
    }
  }
  return pairs;
}

/**
 * RETIREMENT IS A REVERSIBLE EDITOR DECISION, so this only ever SUGGESTS.
 *
 * THE TWO THINGS IT REFUSES TO DO, and they are the point:
 *
 *   1. It will not call a URL dead on old errors alone. A source whose last
 *      successful read was months ago but whose LAST ATTEMPT is recent is a
 *      retrieval problem we should look at, not a dead site; only a recent,
 *      repeated, retrieval-level failure with no successful read at all is a
 *      replacement candidate.
 *   2. It will not cull on zero leads. A quiet source that reads cleanly, a
 *      reference document read on citation, and an institution that publishes
 *      seasonally are all doing their job with `new_since_last_pass = 0`.
 *
 * The thresholds are exported constants so a screen can show the exact rule.
 */

/** Days without a successful read before a repeatedly failing row is a
 *  replacement candidate. Conservative: over a month. */
export const STALE_AFTER_DAYS = 45;
/** Consecutive failed attempts before the desk treats failure as a pattern. */
export const FAILING_AFTER = 3;

export type ReviewStatus =
  | "healthy"
  | "quiet"
  | "reference"
  /** An unclassified page on trial: read on a cadence, but not settled. */
  | "trial"
  | "needs-check"
  | "replacement-candidate"
  | "unverified";

export type SourceReview = {
  health: SourceHealth;
  reviewStatus: ReviewStatus;
  /** An exact, plain sentence a screen can print next to the row. */
  note: string;
  /** True only when the row's facts justify considering a replacement. */
  replaceable: boolean;
};

/**
 * One row's review status, with its sentence. This is the function the
 * inventory CSV and the editor screen both read, so the two never disagree.
 */
export function reviewSource(
  facts: SourceHealthFacts,
  nowMs = Date.now(),
  duplicateOf: number | null = null,
): SourceReview {
  const health = healthOf(facts, nowMs);
  if (duplicateOf != null)
    return {
      health,
      reviewStatus: "needs-check",
      note: `Repeats source ${duplicateOf} at the same address.`,
      replaceable: false,
    };
  const neverRead = health.daysSinceRead == null;
  const failing =
    (facts.consecutive_failures ?? 0) >= FAILING_AFTER && isUnreadable(health.observation);
  if (failing && (neverRead || (health.daysSinceRead ?? 0) >= STALE_AFTER_DAYS))
    return {
      health,
      reviewStatus: "replacement-candidate",
      note: neverRead
        ? `Could not be read on the last ${facts.consecutive_failures} attempts and has never read.`
        : `Could not be read on the last ${facts.consecutive_failures} attempts; last read ${health.daysSinceRead} days ago.`,
      replaceable: true,
    };
  if (isUnreadable(health.observation))
    return {
      health,
      reviewStatus: "needs-check",
      note:
        health.observation === "extraction-failure"
          ? "Reached the page but could not turn it into text."
          : "The last check could not reach the page.",
      replaceable: false,
    };
  if (health.parked)
    return {
      health,
      reviewStatus: "needs-check",
      note:
        health.observation === "blocked"
          ? "The site refused us; the desk is backing off before trying again."
          : "The site asked us to come back later; the desk is waiting for that time.",
      replaceable: false,
    };
  if (health.observation === "never-checked")
    return {
      health,
      reviewStatus: "unverified",
      note: "Accepted but not checked yet.",
      replaceable: false,
    };
  if (health.purpose === "reference")
    return {
      health,
      reviewStatus: "reference",
      note: referenceNote(health.purposeReason),
      replaceable: false,
    };
  /*
    AN UNKNOWN PURPOSE IS A TRIAL, NOT A SETTLED ROW. A bare page the desk has
    read once, whose address carries no cadence signal and whose content it
    could not compare, is exactly the case the old code called "reference". It
    reads as `trial` instead: the rotation will keep including it until a real
    fact (it produced items, the editor set a purpose, or history recorded one)
    settles it. No auto-retirement from quietness -- it stays in the pool.
  */
  if (health.purpose === "unknown")
    return {
      health,
      reviewStatus: "trial",
      note:
        health.everChanged
          ? "Unclassified page that has produced items; watching on trial."
          : health.observation === "unchanged-content"
            ? "Unclassified page; content is unchanged since the last read, watching on trial."
            : "Unclassified page with no cadence signal yet; watching on trial, not retired.",
      replaceable: false,
    };
  if (health.everChanged)
    return { health, reviewStatus: "healthy", note: "Reading cleanly and has changed before.", replaceable: false };
  if (health.observation === "unchanged-content")
    return {
      health,
      reviewStatus: "quiet",
      note: "Reading cleanly; the page is unchanged since the last read.",
      replaceable: false,
    };
  if (health.observation === "no-new-items")
    return {
      health,
      reviewStatus: "quiet",
      note: "Reading cleanly; nothing new the last time it was read. Content change not compared.",
      replaceable: false,
    };
  return {
    health,
    reviewStatus: "quiet",
    note: "Reading cleanly; nothing new the last time it was read.",
    replaceable: false,
  };
}

/** The exact sentence for a `reference` row, naming the fact behind the call. */
export function referenceNote(reason: PurposeReason): string {
  if (reason === "editor-set") return "You set this as reference material.";
  if (reason === "observed-history")
    return "History recorded this as reference material: read when a story cites it.";
  return "Reference material by address (a document or sitemap): read when a story cites it, not on a cadence.";
}

/**
 * THE INVENTORY ROW, and the CSV an editor reads once.
 *
 * COLUMNS ARE THE EDITOR'S QUESTIONS, in order: which source, where it lives,
 * what it is for, what the desk actually knows, when it last read, how to reach
 * it again, and what remains unverified. `provenance` names where the row came
 * from (`kind` and `tier` as the desk stored them); `unverified` names the facts
 * the desk has NOT confirmed, so a blank in another column is not read as "no".
 */
export type InventoryRow = {
  id: number;
  title: string;
  url: string;
  host: string;
  kind: string;
  tier: string;
  status: string;
  purpose: SourcePurpose;
  /** The single fact that decided `purpose` -- the row's provenance for the call. */
  purposeReason: PurposeReason;
  observation: SourceObservation;
  reviewStatus: ReviewStatus;
  /** True when the observation rests on a real content comparison, not a lead count. */
  contentCompared: boolean;
  lastReadAt: string;
  lastAttemptAt: string;
  failureStreak: number;
  beats: string;
  duplicateOf: string;
  note: string;
  /** Facts this row does NOT establish, joined with "; ". */
  unverified: string;
  /** True when this row was actually checked live during THIS inventory. */
  checkedLive: boolean;
};

function iso(value: string | null | undefined): string {
  if (!value) return "";
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

/** The facts a row does not establish, said in words rather than left blank. */
export function unverifiedFor(facts: SourceHealthFacts): string[] {
  const out: string[] = [];
  if (!facts.last_ok_at) out.push("never read successfully");
  if (!facts.last_fetched_at) out.push("never checked");
  /*
    THE HONEST CONTENT GAP. A row that read cleanly but carries no stored content
    version cannot say whether the page's bytes changed; the desk says so rather
    than letting the observation column read as a settled "no-change".
  */
  if (
    !(facts.last_hash != null && String(facts.last_hash).length > 0) ||
    typeof facts.content_version_changed !== "boolean"
  )
    out.push("content change not compared (no stored content version for this fetch)");
  if (facts.kind == null) out.push("kind not recorded");
  if (facts.tier == null) out.push("tier not recorded");
  if (facts.beats == null) out.push("section not recorded");
  out.push("current live state not verified for this inventory");
  return out;
}

export function inventoryRows(
  sources: readonly SourceHealthFacts[],
  options: { nowMs?: number; checkedLive?: ReadonlySet<number> } = {},
): InventoryRow[] {
  const nowMs = options.nowMs ?? Date.now();
  const dups = duplicatePairs(sources);
  const duplicateOf = new Map<number, number>();
  for (const pair of dups) duplicateOf.set(pair.repeatId, pair.keepId);
  return [...sources]
    .sort((a, b) => a.id - b.id)
    .map((facts) => {
      const review = reviewSource(facts, nowMs, duplicateOf.get(facts.id) ?? null);
      return {
        id: facts.id,
        title: facts.title,
        url: facts.url,
        host: review.health.host ?? "",
        kind: facts.kind ?? "",
        tier: facts.tier ?? "",
        status: facts.status ?? "",
        purpose: review.health.purpose,
        purposeReason: review.health.purposeReason,
        observation: review.health.observation,
        reviewStatus: review.reviewStatus,
        contentCompared: review.health.contentCompared,
        lastReadAt: iso(facts.last_ok_at),
        lastAttemptAt: iso(facts.last_fetched_at),
        failureStreak: facts.consecutive_failures ?? 0,
        beats: (facts.beats ?? []).join(" "),
        duplicateOf: duplicateOf.has(facts.id) ? String(duplicateOf.get(facts.id)) : "",
        note: review.note,
        unverified: unverifiedFor(facts).join("; "),
        checkedLive: options.checkedLive?.has(facts.id) ?? false,
      };
    });
}

export const INVENTORY_COLUMNS = [
  "id",
  "title",
  "url",
  "host",
  "kind",
  "tier",
  "status",
  "purpose",
  "purpose_reason",
  "observation",
  "review_status",
  "content_compared",
  "last_read_at",
  "last_attempt_at",
  "failure_streak",
  "beats",
  "duplicate_of",
  "note",
  "unverified",
  "checked_live",
] as const;

/** RFC 4180: wrap a field when it holds a comma, quote, or newline. */
export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly InventoryRow[]): string {
  const lines = [INVENTORY_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.title,
        row.url,
        row.host,
        row.kind,
        row.tier,
        row.status,
        row.purpose,
        row.purposeReason,
        row.observation,
        row.reviewStatus,
        String(row.contentCompared),
        row.lastReadAt,
        row.lastAttemptAt,
        row.failureStreak,
        row.beats,
        row.duplicateOf,
        row.note,
        row.unverified,
        String(row.checkedLive),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
