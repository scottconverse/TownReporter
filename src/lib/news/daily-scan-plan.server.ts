import { orderAcceptedSources } from "./scan-supply.ts";
import type { Sql } from "../db.ts";
import { ensureDailyScanPolicySchema, planDailySourceRotation } from "./daily-scan.ts";
import { loadSourceScanPreferences } from "./source-scan-preferences.server.ts";
import { scheduledScanCoverage } from "./scan-source-coverage.ts";

/** Both scheduled and editor-started daily scans use this saved policy plan. */
export async function dailyScanPlan(sql: Sql, newsroomId: number, policy?: any, allAccepted = false) {
  await ensureDailyScanPolicySchema(sql);
  const p = policy ?? (await sql.query<any>(
    "select * from daily_scan_policies where newsroom_id=$1", [newsroomId],
  ))[0];
  if (!p) throw new Error("Save the daily scan settings before running a daily scan.");
  const pool = await sql.query<any>(
    "select id,url,title,kind,tier,status,last_hash,last_fetched_at,last_error,last_ok_at,retry_after,retry_after_note,blocked_at,blocked_attempts,consecutive_failures from sources where newsroom_id=$1 and status='accepted' order by id",
    [newsroomId],
  );
  const preferences = await loadSourceScanPreferences(sql, newsroomId);
  const preferenceById = new Map(preferences.map((preference) => [preference.sourceId, preference]));
  const rotation = planDailySourceRotation({
    facts: pool.map((source: any) => ({
      ...source,
      purpose_preference: preferenceById.get(source.id)?.purpose ?? null,
    })),
    selectedSourceIds: p.selected_source_ids ?? [],
    everyDayCount: p.every_day_source_count ?? 8,
    preferences,
    cap: p.source_cap,
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
      sourceCap: p.source_cap,
      everyDaySourceCount: p.every_day_source_count ?? 8,
      rotatingSourceCount: Math.max(0, p.source_cap - (p.every_day_source_count ?? 8)),
    },
  };
}
