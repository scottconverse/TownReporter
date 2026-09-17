import type { Sql } from "../db.ts";
import type { RetainedSource } from "./report.ts";

/** Reuse the check the editor filed, even if a later URL fetch failed. */
export async function retainedWatchSources(sql: Sql, newsroomId: number, leadId: number, urls: string[]): Promise<RetainedSource[]> {
  if (!urls.length) return [];
  const rows = await sql<{
    url: string; title: string; full_text: string; version_id: number;
    capture_event_id: number; captured_at: string; extraction_method: string;
  }>`select av.url,av.title,av.full_text,av.id as version_id,ce.id as capture_event_id,
      ce.observed_at::text as captured_at,ce.extraction_method
    from manual_watch_actions a
    join manual_watch_checks c on c.id=a.check_id and c.newsroom_id=a.newsroom_id
    join capture_events ce on ce.id=c.capture_event_id and ce.newsroom_id=c.newsroom_id and ce.monitor_id=c.monitor_id
    join artifact_versions av on av.id=ce.version_id and av.newsroom_id=ce.newsroom_id
      and av.url=ce.source_url and av.content_hash=ce.content_hash
    where a.newsroom_id=${newsroomId} and a.result_id=${leadId} and a.action='lead'
      and ce.fetch_outcome in ('fetched','unchanged','changed') and length(trim(av.full_text))>0`;
  return rows.filter(row => urls.includes(row.url)).map(row => ({
    url: row.url, title: row.title, text: row.full_text, extras: [],
    version_id: row.version_id, capture_event_id: row.capture_event_id,
    captured_at: row.captured_at, extraction_method: row.extraction_method,
  }));
}
