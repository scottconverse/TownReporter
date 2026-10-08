/**
 * WHICH SOURCES A PASS SHOULD READ, when there are more sources than a pass
 * should spend on one day.
 *
 * WHY THIS IS NOT "RAISE THE CAP". The scheduled policy has a stored
 * `source_cap` of at most 12 (`migrations/0050_daily_scan.sql`), and the daily
 * scan reads exactly the editor's stored selection each day. With 201 accepted
 * sources, a fixed 12 means a full pass over the pool takes at least 17 days,
 * and reserving the same daily dozen forever means the rest are never read at
 * all. Raising the number changes the cost of every pass; it does not make the
 * RIGHT sources get read. What is missing is ORDER: a pass should spend its
 * budget on the sources that are due, that the editor cares about, and that
 * have waited longest, and it should be able to say which it skipped and why.
 *
 * WHAT THIS MODULE IS. A pure, deterministic orderer. It takes the accepted
 * sources the run may read, the editor's own selections and priorities, a
 * budget, and the current time, and it returns the source IDs to read in order,
 * plus the IDs it deferred and a one-word reason each. It fetches nothing,
 * writes nothing, and remembers nothing between calls -- the "learning" is the
 * observations the caller persists (source-observations.ts), not a hidden
 * model.
 *
 * THE RULES, and why each exists:
 *
 *   1. EDITOR CONTROL IS ABSOLUTE. Any source the editor explicitly selected is
 *      read first, in the editor's own order, before anything else. Selection is
 *      not a suggestion this module may outvote.
 *   2. DEADLINE AND HIGH PRIORITY COME NEXT. Meeting/packet sources and the ones
 *      the editor marked high-priority are read before ordinary watches.
 *   3. RETRY ELIGIBILITY IS HONOURED. A row parked by `retry_after` or blocked is
 *      not read until its time; it is reported as deferred with `parked`.
 *   4. LONGEST-WAITING WINS AMONG EQUALS. Among sources with no explicit claim,
 *      the one whose last successful read is oldest goes first, so nothing
 *      starves.
 *   5. QUIET SOURCES ARE NOT PUNISHED, BUT THEY ARE ALSO NOT FAVOURED. A source
 *      that reads cleanly and changes rarely earns no bonus and no penalty: it
 *      sits in the longest-waiting pool like everything else.
 *
 * NOTHING IS REMOVED. This returns an ORDER and a set of DEFERRALS; it never
 * mutates the accepted list, and a deferred source is deferred for this pass
 * only. The caller keeps the editor's stored selection exactly as it is.
 */

import {
  type SourceHealthFacts,
  classifyObservation,
  classifyPurpose,
  isQuiet,
  hostOf,
} from "./source-inventory.ts";
import type { SourcePurpose } from "./source-inventory.ts";

export type SourceCadence = "daily" | "weekly" | "monthly" | "as-needed";

/** What the editor asked for, if anything, for one source. The screen stores
 *  this; a desk that stores nothing passes none of it and gets rule 3 onward. */
export type SourcePreference = {
  sourceId: number;
  purpose?: SourcePurpose | null;
  cadence?: SourceCadence | null;
  deadline?: string | null;
  /** The editor's explicit selection: read before anything else. */
  selected?: boolean;
  /** The editor marked this as high priority (deadline, or a beat they watch). */
  highPriority?: boolean;
  /** A deadline (ISO) before which the source is worth a read. */
  urgency?: string | null;
};

export type RotationInput = {
  sources: readonly SourceHealthFacts[];
  preferences?: readonly SourcePreference[];
  /** How many sources this pass may read. Call it the budget, not the ceiling:
   *  the run reads at most this many and reports the rest as deferred. */
  budget: number;
  nowMs?: number;
};

export type RotationDecision = {
  sourceId: number;
  /** The one reason this source is where it is in the order. */
  reason:
    | "editor-selected"
    | "high-priority"
    | "due-now"
    | "cadence-due"
    | "deadline-soon"
    | "longest-waiting"
    | "never-checked"
    | "trial";
};

export type RotationDeferral = {
  sourceId: number;
  /** Why this source was not read this pass. */
  reason: "over-budget" | "parked" | "blocked";
};

export type Rotation = {
  /** The IDs to read, in the order to read them. At most `budget`. */
  read: RotationDecision[];
  /** The IDs the pass will not read, each with its reason. Never a deletion. */
  deferred: RotationDeferral[];
  /** How many accepted sources exist, read or not, so the caller can report
   *  coverage truthfully instead of implying the read set is the pool. */
  poolSize: number;
};

/**
 * The whole selection, deterministic and side-effect free.
 *
 * Order: editor-selected (in the caller's order), then high-priority, then
 * deadline-due, then never-checked, then longest-waiting; parked and blocked
 * rows are pulled out as deferred before any budget is spent on them.
 */
export function selectRotation(input: RotationInput): Rotation {
  const nowMs = input.nowMs ?? Date.now();
  const prefs = new Map<number, SourcePreference>();
  for (const p of input.preferences ?? []) prefs.set(p.sourceId, p);

  const parked: RotationDeferral[] = [];
  const readable: SourceHealthFacts[] = [];
  for (const source of input.sources) {
    const retryAt = source.retry_after ? Date.parse(source.retry_after) : Number.NaN;
    const retryPending = Number.isFinite(retryAt) && retryAt > nowMs;
    // `blocked_at` records the first refusal and remains for the editor's
    // history. Eligibility comes from its saved backoff: once that time passes,
    // a failed source returns to the rotation instead of staying parked forever.
    if (source.blocked_at && retryPending)
      parked.push({ sourceId: source.id, reason: "blocked" });
    else if (retryPending)
      parked.push({ sourceId: source.id, reason: "parked" });
    else readable.push(source);
  }

  const selected: SourceHealthFacts[] = [];
  const rest: SourceHealthFacts[] = [];
  for (const source of readable) (prefs.get(source.id)?.selected ? selected : rest).push(source);

  const waitingMs = (source: SourceHealthFacts): number => {
    const at = source.last_ok_at ? Date.parse(source.last_ok_at) : Number.NaN;
    return Number.isFinite(at) ? nowMs - at : Number.POSITIVE_INFINITY;
  };
  const byPriority = (a: SourceHealthFacts, b: SourceHealthFacts): number => {
    const ap = prefs.get(a.id)?.highPriority ? 0 : 1;
    const bp = prefs.get(b.id)?.highPriority ? 0 : 1;
    if (ap !== bp) return ap - bp;
    /*
      DEADLINE COMES FROM THE PREFERENCE, NOT THE HEALTH ROW. `isDue` used to
      read `source.urgency`, a field `SourceHealthFacts` does not define, so the
      deadline branch never fired and `SourcePreference.urgency` -- the editor's
      own deadline for a source -- was ignored. The urgency lives on the
      preference; the health row has no opinion about it.
    */
    const au = isDue(a, prefs.get(a.id), nowMs) ? 0 : 1;
    const bu = isDue(b, prefs.get(b.id), nowMs) ? 0 : 1;
    if (au !== bu) return au - bu;
    const an = a.last_ok_at ? 1 : 0;
    const bn = b.last_ok_at ? 1 : 0;
    if (an !== bn) return an - bn;
    const aw = waitingMs(a);
    const bw = waitingMs(b);
    if (aw !== bw) return bw - aw;
    return a.id - b.id;
  };
  rest.sort(byPriority);

  const ordered = [
    ...selected.map((s) => ({ source: s, reason: "editor-selected" as const })),
    ...rest.map((s) => ({ source: s, reason: reasonFor(s, prefs.get(s.id), nowMs) })),
  ];

  const budget = Math.max(0, Math.floor(input.budget));
  const read = ordered.slice(0, budget).map((entry) => ({
    sourceId: entry.source.id,
    reason: entry.reason,
  }));
  const deferred: RotationDeferral[] = [
    ...ordered.slice(budget).map((entry) => ({
      sourceId: entry.source.id,
      reason: "over-budget" as const,
    })),
    ...parked,
  ];
  return { read, deferred, poolSize: input.sources.length };
}

/**
 * DUE-NOW, from the editor's own deadline for the source.
 *
 * The deadline is `SourcePreference.urgency` (ISO): an editor can say "this
 * packet matters before Thursday". A source is due when that time has arrived.
 * When the preference carries no urgency, the source is not due -- this module
 * does not invent deadlines from a row's shape or silence.
 */
function isDue(
  source: SourceHealthFacts,
  pref: SourcePreference | undefined,
  nowMs: number,
): boolean {
  const urgency = pref?.urgency;
  if (typeof urgency === "string" && urgency) {
    const at = Date.parse(urgency);
    if (Number.isFinite(at) && at <= nowMs) return true;
  }
  if (pref?.deadline) {
    const rawDeadline = pref.deadline;
    const deadlineAt = /^\d{4}-\d{2}-\d{2}$/.test(rawDeadline)
      ? Date.parse(`${rawDeadline}T23:59:59.999Z`)
      : Date.parse(rawDeadline);
    if (Number.isFinite(deadlineAt) && deadlineAt >= nowMs && deadlineAt <= nowMs + 7 * 86_400_000)
      return true;
  }
  const cadenceDays =
    pref?.cadence === "daily" ? 1 : pref?.cadence === "weekly" ? 7 : pref?.cadence === "monthly" ? 30 : null;
  if (cadenceDays != null) {
    const lastRead = source.last_ok_at ? Date.parse(source.last_ok_at) : Number.NaN;
    if (!Number.isFinite(lastRead) || nowMs - lastRead >= cadenceDays * 86_400_000) return true;
  }
  return false;
}

function reasonFor(
  source: SourceHealthFacts,
  pref: SourcePreference | undefined,
  nowMs: number,
): RotationDecision["reason"] {
  if (pref?.highPriority) return "high-priority";
  if (pref?.urgency && Number.isFinite(Date.parse(pref.urgency)) && Date.parse(pref.urgency) <= nowMs)
    return "due-now";
  if (pref?.deadline) {
    const deadlineAt = /^\d{4}-\d{2}-\d{2}$/.test(pref.deadline)
      ? Date.parse(`${pref.deadline}T23:59:59.999Z`)
      : Date.parse(pref.deadline);
    if (Number.isFinite(deadlineAt) && deadlineAt >= nowMs && deadlineAt <= nowMs + 7 * 86_400_000)
      return "deadline-soon";
  }
  if (isDue(source, pref, nowMs)) return "cadence-due";
  if (!source.last_ok_at && !source.last_fetched_at) return "never-checked";
  return "longest-waiting";
}

/**
 * THE FRESHNESS THE READ SET ACTUALLY BUYS, in days, and the gaps it leaves.
 *
 * This is here so a screen can print the truth instead of a promise: with a
 * budget of B and a pool of N, a full pass takes ceil(N / B) days, and the
 * oldest last-read fact in the pool is the age of the stalest source this pass
 * did NOT read. `coverageGaps` names the sources deferred this pass, so
 * "not covered today" is a list, not a silence.
 */
export type Freshness = {
  /** Sources in the pool. */
  poolSize: number;
  /** Sources this pass reads. */
  readCount: number;
  /** Whole days a full rotation takes at this budget, floor 1. */
  fullPassDays: number;
  /** Age in days of the stalest deferred source, or null when none deferred. */
  stalestDeferredDays: number | null;
  /** Sources deferred this pass. */
  deferredIds: number[];
};

export function freshnessOf(
  rotation: Rotation,
  sources: readonly SourceHealthFacts[],
  nowMs = Date.now(),
): Freshness {
  const byId = new Map(sources.map((s) => [s.id, s]));
  let stalest: number | null = null;
  for (const d of rotation.deferred) {
    const source = byId.get(d.sourceId);
    if (!source) continue;
    const at = source.last_ok_at ? Date.parse(source.last_ok_at) : Number.NaN;
    if (!Number.isFinite(at)) continue;
    const days = Math.floor((nowMs - at) / 86_400_000);
    if (stalest == null || days > stalest) stalest = days;
  }
  return {
    poolSize: rotation.poolSize,
    readCount: rotation.read.length,
    fullPassDays: rotation.read.length
      ? Math.max(1, Math.ceil(rotation.poolSize / rotation.read.length))
      : Number.POSITIVE_INFINITY,
    stalestDeferredDays: stalest,
    deferredIds: rotation.deferred.map((d) => d.sourceId),
  };
}

/**
 * ESSENTIAL-QUIET GUARD. Institutions that publish rarely are the ones a
 * longest-waiting rotation would starve last. The editor marks them
 * high-priority, and this names the sources that are quiet AND unmarked, so a
 * screen can say "these quiet institutions have no priority flag" rather than
 * letting the rotation quietly ignore them.
 */
export function unmarkedQuietInstitutions(
  sources: readonly SourceHealthFacts[],
  preferences: readonly SourcePreference[],
  nowMs = Date.now(),
): number[] {
  const marked = new Set(
    preferences
      .filter((p) => p.selected || p.highPriority || p.purpose || p.cadence || p.deadline)
      .map((p) => p.sourceId),
  );
  return sources
    .filter((s) => !marked.has(s.id))
    .filter((s) => classifyPurpose(s) === "watch")
    .filter((s) => isQuiet(classifyObservation(s, nowMs)))
    .map((s) => s.id)
    .sort((a, b) => a - b);
}

/** Kept so callers do not have to re-derive the host; the observation module
 *  owns the real rule. */
export { hostOf };
