/**
 * Dynamic sources unit 4 (D169; Goals\TownReporter-SPEC-DYNAMIC-SOURCES-2026-10-20.md
 * sections 5c and 5d): how often each source is due for a read.
 *
 * After every read that came back "changed" or "quiet", the source's
 * `interval_minutes` moves (shorter after news, longer after silence) and
 * `next_due_at` is set. A source whose changes fall on one weekday (or one week
 * of the month) gets a `rhythm`, and the rhythm sets the due time instead.
 * Failures (retrieval-error, blocked, asked-to-wait) do not touch any of this:
 * the existing `retry_after` backoff handles them.
 *
 * Nothing reads `next_due_at` yet; unit 5 orders the scan by it.
 */
import type { SqlTag } from "./lead-filing.ts";

export const START_INTERVAL = 1440;
const STEP_DOWN = 360;
const STEP_UP_RECENT_LEAD = 360;
const STEP_UP_NO_LEAD = 1440;
const FLOOR_OFFICIAL = 360;
const FLOOR_OTHER = 720;
const CEILING_ACTIVE = 10_080;
const CEILING_DORMANT = 43_200;
const RHYTHM_MIN_CHANGES = 4;
const RHYTHM_MIN_SHARE = 0.7;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type CadenceSource = {
  /** sources.kind, e.g. "official" or "page". */
  kind: string | null;
  tier: string | null;
  status: string | null;
  interval_minutes: number | null;
};

/** Official or tier-A sources may be read every 6 hours; others every 12. */
function floorFor(source: CadenceSource): number {
  return source.kind === "official" || source.tier === "A" ? FLOOR_OFFICIAL : FLOOR_OTHER;
}

/** Spec 5c: the new interval after one read. */
export function nextInterval(
  source: CadenceSource,
  outcome: "changed" | "quiet",
  hadLeadInLast31Days: boolean,
): number {
  const floor = floorFor(source);
  const ceiling = source.status === "dormant" ? CEILING_DORMANT : CEILING_ACTIVE;
  const current = source.interval_minutes ?? START_INTERVAL;
  const next =
    outcome === "changed"
      ? current - STEP_DOWN
      : current + (hadLeadInLast31Days ? STEP_UP_RECENT_LEAD : STEP_UP_NO_LEAD);
  return Math.min(ceiling, Math.max(floor, next));
}

export type Rhythm = { rhythm: string; confidence: number };

/**
 * Spec 5d: a posting rhythm from the dates of "changed" reads (last 90 days).
 * Weekly when 70% or more fall on one weekday; else monthly when 70% or more
 * fall in one week of the month (days 1-7, 8-14, 15-21, 22-28, 29-31).
 * Fewer than 4 changes: no rhythm. Days are read in the server's local time.
 */
export function detectRhythm(changedAt: readonly Date[]): Rhythm | null {
  if (changedAt.length < RHYTHM_MIN_CHANGES) return null;
  const best = (keys: number[]) => {
    const counts = new Map<number, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    let top = -1;
    let n = 0;
    for (const [key, count] of counts) if (count > n) [top, n] = [key, count];
    return { key: top, share: n / keys.length };
  };
  const weekday = best(changedAt.map((d) => d.getDay()));
  if (weekday.share >= RHYTHM_MIN_SHARE) {
    return { rhythm: `weekly:${DAYS[weekday.key]}`, confidence: round2(weekday.share) };
  }
  const week = best(changedAt.map((d) => Math.floor((d.getDate() - 1) / 7)));
  if (week.share >= RHYTHM_MIN_SHARE) {
    return { rhythm: `monthly:${week.key + 1}`, confidence: round2(week.share) };
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Up to 60 minutes either way, fixed per source so reads spread out but tests stay exact. */
export function jitterMinutes(sourceId: number): number {
  return ((sourceId * 37) % 121) - 60;
}

/**
 * Spec 5c/5d: when the source is next due. A rhythm wins: weekly -> the next
 * such weekday at the hour of this read; monthly:N -> the day after week N
 * starts (day 7N-5), this month if still ahead, else next month. Otherwise
 * this read plus the interval. Jitter is added in every case.
 */
export function nextDueAt(readAt: Date, intervalMinutes: number, rhythm: string | null, sourceId: number): Date {
  const jitter = jitterMinutes(sourceId) * 60_000;
  const weekly = rhythm?.match(/^weekly:(sun|mon|tue|wed|thu|fri|sat)$/);
  if (weekly) {
    const target = DAYS.indexOf(weekly[1] as (typeof DAYS)[number]);
    const due = new Date(readAt);
    let ahead = (target - due.getDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    due.setDate(due.getDate() + ahead);
    return new Date(due.getTime() + jitter);
  }
  const monthly = rhythm?.match(/^monthly:([1-5])$/);
  if (monthly) {
    const day = 7 * Number(monthly[1]) - 5;
    const due = new Date(readAt);
    due.setDate(day);
    if (due <= readAt) {
      due.setDate(1);
      due.setMonth(due.getMonth() + 1);
      due.setDate(day);
    }
    return new Date(due.getTime() + jitter);
  }
  return new Date(readAt.getTime() + intervalMinutes * 60_000 + jitter);
}

/**
 * Apply one read's outcome to the source row. Call it after the read's
 * observation is written, so the rhythm sees this read too. Only "changed"
 * and "quiet" move the cadence.
 */
export async function applyReadCadence(
  sql: SqlTag,
  input: { newsroomId: number; sourceId: number; kind: string; now?: Date },
): Promise<void> {
  if (input.kind !== "changed" && input.kind !== "quiet") return;
  const now = input.now ?? new Date();
  const [source] = await sql<CadenceSource>`
    select kind, tier, status, interval_minutes from sources
    where id = ${input.sourceId} and newsroom_id = ${input.newsroomId}`;
  if (!source) return;
  const [recent] = await sql<{ n: number }>`
    select count(*)::int as n from leads
    where newsroom_id = ${input.newsroomId} and source_id = ${input.sourceId}
      and created_at > now() - interval '31 days'`;
  const changed = await sql<{ created_at: string | Date }>`
    select created_at from source_observations
    where newsroom_id = ${input.newsroomId} and source_id = ${input.sourceId}
      and kind = 'changed' and created_at > now() - interval '90 days'`;
  const interval = nextInterval(source, input.kind, (recent?.n ?? 0) > 0);
  const rhythm = detectRhythm(changed.map((row) => new Date(row.created_at)));
  const due = nextDueAt(now, interval, rhythm?.rhythm ?? null, input.sourceId);
  await sql`
    update sources set interval_minutes = ${interval}, next_due_at = ${due.toISOString()},
      rhythm = ${rhythm?.rhythm ?? null}, rhythm_confidence = ${rhythm?.confidence ?? null}
    where id = ${input.sourceId} and newsroom_id = ${input.newsroomId}`;
}
