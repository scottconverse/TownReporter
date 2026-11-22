/**
 * The robot recheck's plain rules (Scott's Nov 20 2026 order).
 *
 * Nothing here touches the database or the network, so the desk, the scan and
 * the tests can all ask the same question of the same arithmetic:
 *
 *  - how many published entries tonight's batch should recheck, so that every
 *    one is opened again within a month (about a thirtieth a night);
 *  - which entries those are (crisis services first and every week, then the
 *    ones whose last robot recheck is oldest);
 *  - when a failure is "the source is gone" (two failures in a row, at least
 *    three days apart) rather than one bad night;
 *  - what the desk and the public page call each result.
 */

/** Every published entry is rechecked within a month. */
export const RECHECK_EVERY_DAYS = 30;
/** A crisis service is rechecked every week. */
export const CRISIS_RECHECK_EVERY_DAYS = 7;
/** No night runs more than this many rechecks, whatever the registry size. */
export const RECHECK_NIGHTLY_CAP = 200;
/** Two failures this far apart, in a row, mean the source page is gone. */
export const SOURCE_GONE_GAP_DAYS = 3;

const DAY_MS = 86_400_000;

/** The most entries one night should recheck for a registry this size. */
export function nightlyRecheckQuota(
  publishedCount: number,
  cap: number = RECHECK_NIGHTLY_CAP,
): number {
  if (!Number.isFinite(publishedCount) || publishedCount <= 0) return 0;
  return Math.min(cap, Math.ceil(publishedCount / RECHECK_EVERY_DAYS));
}

export interface RecheckCandidate {
  serviceId: number;
  crisis: boolean;
  /** The last robot recheck, or null when it has never been rechecked. */
  robotCheckedAt: string | Date | null;
}

function timeOf(when: string | Date | null): number | null {
  if (when == null) return null;
  const value = when instanceof Date ? when.getTime() : Date.parse(when);
  return Number.isFinite(value) ? value : null;
}

/** Never-checked first, then the oldest check; row id breaks an exact tie. */
function oldestFirst(a: RecheckCandidate, b: RecheckCandidate): number {
  const left = timeOf(a.robotCheckedAt);
  const right = timeOf(b.robotCheckedAt);
  if (left === null && right !== null) return -1;
  if (left !== null && right === null) return 1;
  if (left !== null && right !== null && left !== right) return left - right;
  return a.serviceId - b.serviceId;
}

/**
 * Tonight's recheck list, in the order to run it.
 *
 * Crisis services that are due (never rechecked, or rechecked more than a week
 * ago) go first, because a wrong crisis number is the one mistake the registry
 * cannot afford to leave a month. The rest of the quota is filled with the
 * entries whose last robot recheck is oldest, which is what makes a registry of
 * N entries settle into a 30-day cycle. A single night never exceeds the cap.
 */
export function planRecheckSelection(
  candidates: readonly RecheckCandidate[],
  now: Date | number,
  options: { cap?: number } = {},
): number[] {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const cap = options.cap ?? RECHECK_NIGHTLY_CAP;
  const quota = nightlyRecheckQuota(candidates.length, cap);
  if (quota === 0) return [];

  const crisisGap = CRISIS_RECHECK_EVERY_DAYS * DAY_MS;
  const crisis = candidates
    .filter((candidate) => {
      if (!candidate.crisis) return false;
      const checked = timeOf(candidate.robotCheckedAt);
      return checked === null || nowMs - checked >= crisisGap;
    })
    .sort(oldestFirst);

  const chosen = crisis.slice(0, cap);
  const taken = new Set(chosen.map((candidate) => candidate.serviceId));
  if (chosen.length < quota) {
    const rest = candidates
      .filter((candidate) => !taken.has(candidate.serviceId))
      .sort(oldestFirst);
    for (const candidate of rest) {
      if (chosen.length >= quota) break;
      chosen.push(candidate);
    }
  }
  return chosen.map((candidate) => candidate.serviceId);
}

/** What a failed fetch means. Only a missing page counts toward "source gone". */
export type RecheckFailureKind = "gone" | "other";

/**
 * A 404 or 410, or a name that no longer resolves, means the page is gone. Any
 * other failure (a timeout, a 500, a block) is a bad night, not a dead source.
 */
export function classifyRecheckFailure(message: string): RecheckFailureKind {
  const text = String(message ?? "");
  if (/fetch failed\s*\(\s*(?:404|410)\s*\)/i.test(text)) return "gone";
  if (/\b(?:ENOTFOUND|EAI_AGAIN|EAI_FAIL|ESERVFAIL)\b|getaddrinfo|\bDNS\b/i.test(text)) {
    return "gone";
  }
  return "other";
}

export interface RecheckFailureState {
  /** Consecutive "source gone" failures already recorded. */
  failures: number;
  /** When that run of failures started. */
  firstFailureAt: string | Date | null;
}

export interface RecheckFailureOutcome {
  failures: number;
  firstFailureAt: string;
  /**
   * True on the second failure in a row when it is at least three days after
   * the first: the entry is unpublished and listed as "Source gone".
   */
  sourceGone: boolean;
}

/**
 * Fold one more "source gone"-shaped failure into the run already recorded.
 * A failure less than three days after the first still extends the run but is
 * not yet the second one that takes the entry down.
 */
export function nextRecheckFailure(
  state: RecheckFailureState,
  now: Date | number,
): RecheckFailureOutcome {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const first = timeOf(state.firstFailureAt);
  if (state.failures > 0 && first !== null) {
    const gap = nowMs - first;
    return {
      failures: state.failures + 1,
      firstFailureAt: new Date(first).toISOString(),
      sourceGone: gap >= SOURCE_GONE_GAP_DAYS * DAY_MS,
    };
  }
  return {
    failures: 1,
    firstFailureAt: new Date(nowMs).toISOString(),
    sourceGone: false,
  };
}

export type RecheckResult = "same" | "changed" | "source_gone" | "failed";

const RESULT_WORDS: Record<RecheckResult, string> = {
  same: "the facts still match",
  changed: "the facts changed",
  source_gone: "the source page is gone",
  failed: "the page could not be read this time",
};

/** Plain words for a recheck result, for the desk. */
export function recheckResultWords(result: string): string {
  return RESULT_WORDS[result as RecheckResult] ?? "the result was not recorded";
}
