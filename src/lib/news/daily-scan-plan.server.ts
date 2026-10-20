import { orderAcceptedSources } from "./scan-supply.ts";
import type { Sql } from "../db.ts";
import { ensureDailyScanPolicySchema, planDailySourceRotation } from "./daily-scan.ts";
import { loadSourceScanPreferences } from "./source-scan-preferences.server.ts";
import { scheduledScanCoverage } from "./scan-source-coverage.ts";
import { siteOf } from "./source-intake.ts";
import { yieldScore, type YieldRow } from "./source-yield.ts";

/**
 * Spec 5a: a source's score for ordering, with the website fallback. A source
 * with fewer than 3 reads has no score of its own and uses the best score of
 * the other sources on its website (`siteOf`, max of `yieldScore` per site).
 * A source with its own score keeps it, even a score of 0.
 */
export function yieldScoresByWebsite(
  pool: ReadonlyArray<{ id: number; url: string }>,
  yields: ReadonlyArray<YieldRow>,
): Map<number, number | null> {
  const urlById = new Map(pool.map((source) => [source.id, source.url]));
  const own = new Map<number, number | null>();
  const bestBySite = new Map<string, number>();
  for (const row of yields) {
    const score = yieldScore(row);
    own.set(row.source_id, score);
    if (score == null) continue;
    const site = siteOf(urlById.get(row.source_id) ?? "");
    if (!site) continue;
    const best = bestBySite.get(site);
    if (best == null || score > best) bestBySite.set(site, score);
  }
  const scores = new Map<number, number | null>();
  for (const source of pool) {
    const site = siteOf(source.url);
    scores.set(source.id, own.get(source.id) ?? (site ? bestBySite.get(site) ?? null : null));
  }
  return scores;
}

/** Both scheduled and editor-started daily scans use this saved policy plan. */
export async function dailyScanPlan(sql: Sql, newsroomId: number, policy?: any, allAccepted = false) {
  await ensureDailyScanPolicySchema(sql);
  const p = policy ?? (await sql.query<any>(
    "select * from daily_scan_policies where newsroom_id=$1", [newsroomId],
  ))[0];
  if (!p) throw new Error("Save the daily scan settings before running a daily scan.");
  const pool = await sql.query<any>(
    "select id,url,title,kind,tier,status,last_hash,last_fetched_at,last_error,last_ok_at,retry_after,retry_after_note,blocked_at,blocked_attempts,consecutive_failures,next_due_at from sources where newsroom_id=$1 and status='accepted' order by id",
    [newsroomId],
  );
  // Dynamic sources unit 5 (D169): each source's news score from the nightly source_yield.
  const yields = await sql.query<YieldRow>(
    "select source_id,reads_90,leads_per_read,published_per_read,bad_source_kills_90 from source_yield where newsroom_id=$1",
    [newsroomId],
  );
  const scoreById = yieldScoresByWebsite(pool, yields);
  const preferences = await loadSourceScanPreferences(sql, newsroomId);
  const preferenceById = new Map(preferences.map((preference) => [preference.sourceId, preference]));
  const rotation = planDailySourceRotation({
    facts: pool.map((source: any) => ({
      ...source,
      next_due_at: source.next_due_at ? new Date(source.next_due_at).toISOString() : null,
      yield_score: scoreById.get(source.id) ?? null,
      purpose_preference: preferenceById.get(source.id)?.purpose ?? null,
    })),
    selectedSourceIds: p.selected_source_ids ?? [],
    everyDayCount: p.every_day_source_count ?? 8,
    preferences,
    cap: (p.source_cap_override ?? p.source_cap),
  });
  const prioritySources = rotation.sourceIds.map((id: number) => pool.find((source: any) => source.id === id)).filter(Boolean);
  const sources = allAccepted ? orderAcceptedSources(pool, (p.selected_source_ids ?? []).slice(0, p.every_day_source_count ?? 8)) :
    rotation.sourceIds.length === pool.length
      ? pool
      : rotation.sourceIds
    .map((id: number) => pool.find((row: { id: number }) => row.id === id))
    .filter(Boolean);
  return {
    sources,
    prioritySources,
    coverage: scheduledScanCoverage(pool, allAccepted ? sources.map((source: any) => source.id) : rotation.sourceIds, allAccepted ? [] : rotation.deferrals),
    policy: {
      daily: true,
      // The priority snapshot stays compatible; execution carries the complete pinned pool.
      ...(allAccepted ? { acceptedSources: sources } : {}),
      revision: p.revision,
      sourceCap: (p.source_cap_override ?? p.source_cap),
      everyDaySourceCount: p.every_day_source_count ?? 8,
      rotatingSourceCount: Math.max(0, (p.source_cap_override ?? p.source_cap) - (p.every_day_source_count ?? 8)),
    },
  };
}
