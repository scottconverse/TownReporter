/**
 * Dynamic sources unit 2 (D169; Goals\TownReporter-SPEC-DYNAMIC-SOURCES-2026-10-20.md
 * sections 4c, 5a, 10a): how much news each source gives, over the last 90 days.
 *
 * One row per source in `source_yield` (migration 0153), recomputed about once a
 * day by the hourly stats clock (`tickSourceYield`). It only WRITES numbers;
 * nothing reads them yet (unit 5 orders the scan by them, unit 8 shows them).
 *
 *   reads_90      scans whose `source_coverage` says this source was "read".
 *   leads_90      leads filed in the window that came from this source:
 *                 `leads.source_id` (unit 1), or for older rows the same URL
 *                 match the scan uses now (`leadSourceId`).
 *   published_90  of those, leads with status "published".
 *   killed_90     of those, leads with status "killed".
 *   bad_source_kills_90  of the killed, the ones whose reason is a bad source
 *                 (`isBadSourceReason`, kill-reasons.ts). Spec 10a: this starts
 *                 near zero; the score must not depend on it.
 *
 * Declared with the narrow tagged-template SQL type, like lead-filing.ts, so a
 * test can run it under plain `node --test`.
 */
import { leadSourceId, type SqlTag } from "./lead-filing.ts";
import { isBadSourceReason } from "./kill-reasons.ts";

export const YIELD_WINDOW_DAYS = 90;
/** Recompute when the newest row is older than this (the clock is hourly). */
export const YIELD_REFRESH_HOURS = 20;

export type YieldRow = {
  source_id: number;
  reads_90: number;
  leads_per_read: number | null;
  published_per_read: number | null;
  bad_source_kills_90: number;
};

/**
 * Spec 5a: the score the scan orders due sources by.
 * 0.7 x leads per read + 0.3 x 3 x published per read - bad-source kills per read.
 * Null under 3 reads (not enough to judge). The weights are the spec's
 * placeholders, to tune once real numbers exist.
 */
export function yieldScore(row: YieldRow): number | null {
  if (row.reads_90 < 3) return null;
  const leads = Number(row.leads_per_read ?? 0);
  const published = Number(row.published_per_read ?? 0);
  return 0.7 * leads + 0.9 * published - row.bad_source_kills_90 / row.reads_90;
}

type LeadRow = {
  id: number;
  source_id: number | null;
  source_urls: string | null;
  status: string | null;
  kill_reason: string | null;
  created_at: string | Date;
};

type Tally = {
  reads: number;
  leads: number;
  published: number;
  killed: number;
  badKills: number;
  lastLeadAt: Date | null;
  lastPublishedAt: Date | null;
};

function parseUrls(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Recompute `source_yield` for one newsroom. Returns the number of rows written. */
export async function computeSourceYield(sql: SqlTag, newsroomId: number): Promise<number> {
  // Rejected and proposed rows are not read by the scan; they get no score.
  const sources = await sql<{ id: number; url: string }>`
    select id, url from sources
    where newsroom_id = ${newsroomId} and status in ('accepted', 'trial', 'dormant')
    order by id`;
  if (!sources.length) return 0;
  const tally = new Map<number, Tally>(
    sources.map((s) => [s.id, { reads: 0, leads: 0, published: 0, killed: 0, badKills: 0, lastLeadAt: null, lastPublishedAt: null }]),
  );

  const reads = await sql<{ source_id: number; reads: number }>`
    select (entry->>'sourceId')::int as source_id, count(*)::int as reads
    from scan_runs, jsonb_array_elements(coalesce(source_coverage, '[]'::jsonb)) as entry
    where newsroom_id = ${newsroomId}
      and started_at > now() - make_interval(days => ${YIELD_WINDOW_DAYS})
      and entry->>'status' = 'read'
      and (entry->>'sourceId') ~ '^[0-9]+$'
    group by 1`;
  for (const row of reads) {
    const at = tally.get(row.source_id);
    if (at) at.reads = row.reads;
  }

  const leads = await sql<LeadRow>`
    select id, source_id, source_urls, status, kill_reason, created_at from leads
    where newsroom_id = ${newsroomId}
      and created_at > now() - make_interval(days => ${YIELD_WINDOW_DAYS})`;
  const published = await sql<{ lead_id: number; published_at: string | Date }>`
    select lead_id, max(published_at) as published_at from articles
    where newsroom_id = ${newsroomId} and lead_id is not null and published_at is not null
    group by lead_id`;
  const publishedAt = new Map(published.map((row) => [row.lead_id, new Date(row.published_at)]));

  for (const lead of leads) {
    const sourceId =
      lead.source_id != null && tally.has(lead.source_id)
        ? lead.source_id
        : leadSourceId(parseUrls(lead.source_urls), sources);
    const at = sourceId == null ? undefined : tally.get(sourceId);
    if (!at) continue;
    at.leads += 1;
    at.lastLeadAt = later(at.lastLeadAt, new Date(lead.created_at));
    if (lead.status === "published") {
      at.published += 1;
      at.lastPublishedAt = later(at.lastPublishedAt, publishedAt.get(lead.id) ?? null);
    }
    if (lead.status === "killed") {
      at.killed += 1;
      if (isBadSourceReason(lead.kill_reason)) at.badKills += 1;
    }
  }

  for (const [sourceId, at] of tally) {
    const perRead = (n: number) => (at.reads > 0 ? n / at.reads : null);
    await sql`
      insert into source_yield (source_id, newsroom_id, reads_90, leads_90, published_90, killed_90,
        bad_source_kills_90, leads_per_read, published_per_read, last_lead_at, last_published_at, computed_at)
      values (${sourceId}, ${newsroomId}, ${at.reads}, ${at.leads}, ${at.published}, ${at.killed},
        ${at.badKills}, ${perRead(at.leads)}, ${perRead(at.published)},
        ${at.lastLeadAt?.toISOString() ?? null}, ${at.lastPublishedAt?.toISOString() ?? null}, now())
      on conflict (source_id) do update set
        newsroom_id = excluded.newsroom_id, reads_90 = excluded.reads_90, leads_90 = excluded.leads_90,
        published_90 = excluded.published_90, killed_90 = excluded.killed_90,
        bad_source_kills_90 = excluded.bad_source_kills_90, leads_per_read = excluded.leads_per_read,
        published_per_read = excluded.published_per_read, last_lead_at = excluded.last_lead_at,
        last_published_at = excluded.last_published_at, computed_at = excluded.computed_at`;
  }
  return tally.size;
}

/** The hourly clock's hook: recompute each newsroom whose rows are a day old. */
export async function tickSourceYield(sql: SqlTag): Promise<void> {
  const due = await sql<{ id: number }>`
    select n.id from newsrooms n
    where coalesce((select max(computed_at) from source_yield y where y.newsroom_id = n.id), 'epoch')
      < now() - make_interval(hours => ${YIELD_REFRESH_HOURS})
    order by n.id`;
  for (const newsroom of due) {
    try {
      await computeSourceYield(sql, newsroom.id);
    } catch (error) {
      console.error(`[townreporter] source yield failed for newsroom ${newsroom.id}:`, error);
    }
  }
}
