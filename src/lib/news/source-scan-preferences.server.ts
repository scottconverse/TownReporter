import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import type { SourceCadence, SourcePreference } from "./adaptive-source-selection.ts";
import type { SourcePurpose } from "./source-inventory.ts";
import { SOURCE_SCAN_PREFERENCE_COPY } from "./desk-copy.ts";

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
  const sql = sqlInput ?? (await getSql());
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

export type SourceScanPreferenceInput = {
  sourceId: number;
  purpose: SourcePurpose | null;
  cadence: SourceCadence | null;
  deadline: string | null;
};

export type CleanSourceScanPreferenceInput = SourceScanPreferenceInput & {
  invalidError?: string;
};

export function cleanSourceScanPreferenceInput(raw: unknown): CleanSourceScanPreferenceInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const purpose =
    value.purpose === "watch" || value.purpose === "reference" || value.purpose === "unknown"
      ? value.purpose
      : value.purpose === null || value.purpose === "" || value.purpose === undefined
        ? null
        : undefined;
  const cadence =
    value.cadence === "daily" ||
    value.cadence === "weekly" ||
    value.cadence === "monthly" ||
    value.cadence === "as-needed"
      ? value.cadence
      : value.cadence === null || value.cadence === "" || value.cadence === undefined
        ? null
        : undefined;
  const deadline =
    value.deadline === null || value.deadline === "" || value.deadline === undefined
      ? null
      : typeof value.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.deadline)
        ? value.deadline
        : undefined;
  const input: CleanSourceScanPreferenceInput = {
    sourceId: typeof value.sourceId === "number" ? value.sourceId : Number.NaN,
    purpose: purpose ?? null,
    cadence: cadence ?? null,
    deadline: deadline ?? null,
  };
  if (
    !Number.isInteger(input.sourceId) ||
    input.sourceId < 1 ||
    purpose === undefined ||
    cadence === undefined ||
    deadline === undefined ||
    (deadline !== null &&
      (Number.isNaN(Date.parse(`${deadline}T00:00:00Z`)) ||
        new Date(`${deadline}T00:00:00Z`).toISOString().slice(0, 10) !== deadline))
  )
    input.invalidError = SOURCE_SCAN_PREFERENCE_COPY.invalid;
  return input;
}

export async function persistSourceScanPreference(
  sql: Sql,
  newsroomId: number,
  userId: string,
  input: SourceScanPreferenceInput,
): Promise<boolean> {
  const [source] = await sql.query<{ id: number }>(
    "select id from sources where newsroom_id=$1 and id=$2 and status='accepted'",
    [newsroomId, input.sourceId],
  );
  if (!source) return false;
  if (input.purpose == null && input.cadence == null && input.deadline == null) {
    await sql.query("delete from source_scan_preferences where newsroom_id=$1 and source_id=$2", [
      newsroomId,
      input.sourceId,
    ]);
    return true;
  }
  await sql.query(
    `insert into source_scan_preferences(newsroom_id,source_id,purpose,cadence,deadline,updated_by,updated_at)
     values($1,$2,$3,$4,$5::date,$6,now())
     on conflict(newsroom_id,source_id) do update set
       purpose=excluded.purpose,cadence=excluded.cadence,deadline=excluded.deadline,
       updated_by=excluded.updated_by,updated_at=now()`,
    [newsroomId, input.sourceId, input.purpose, input.cadence, input.deadline, userId],
  );
  return true;
}
