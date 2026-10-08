import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import type { SourcePreference } from "./adaptive-source-selection.ts";

const CREATE_SOURCE_SCAN_PREFERENCES = `create table if not exists source_scan_preferences (
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  purpose text check (purpose is null or purpose in ('watch', 'reference', 'unknown')),
  cadence text check (cadence is null or cadence in ('daily', 'weekly', 'monthly', 'as-needed')),
  deadline date,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (newsroom_id, source_id)
)`;

export async function ensureSourceScanPreferencesSchema(sqlInput?: Sql) {
  const sql = sqlInput ?? await getSql();
  await ensureSchemaOnce(sql, "source-scan-preferences", [CREATE_SOURCE_SCAN_PREFERENCES]);
}

export async function loadSourceScanPreferences(
  sql: Sql,
  newsroomId: number,
): Promise<SourcePreference[]> {
  return sql.query<SourcePreference>(
    `select source_id as "sourceId",purpose,cadence,deadline::text as deadline
       from source_scan_preferences
      where newsroom_id=$1
      order by source_id`,
    [newsroomId],
  );
}
