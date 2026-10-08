import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import type { ScanSourceCoverageEntry } from "./scan-source-coverage.ts";

export async function ensureScanSourceCoverageSchema(sqlInput?: Sql) {
  const sql = sqlInput ?? (await getSql());
  await ensureSchemaOnce(sql, "scan-source-coverage", [
    "alter table scan_runs add column if not exists source_coverage jsonb not null default '[]'::jsonb",
  ]);
}

export async function saveScanSourceCoverage(
  sql: Sql,
  newsroomId: number,
  scanRunId: number,
  entries: readonly ScanSourceCoverageEntry[],
): Promise<void> {
  await sql.query("update scan_runs set source_coverage=$1::jsonb where newsroom_id=$2 and id=$3", [
    JSON.stringify(entries),
    newsroomId,
    scanRunId,
  ]);
}
