import { getSql } from "../db.ts";
import { clampDials, type DarkDials } from "./dark-dials.ts";
import { DARK_LIMITS, type DarkLimitKey } from "./editor-dialog-logic.ts";
import {
  validateResearchPreferences,
  resolveResearchPreferences,
  type ResearchPreferences,
  type ResearchSnapshot,
} from "./dark-preferences.ts";
export type DarkRoundSettings = { dials: DarkDials; preferences: ResearchSnapshot };
/** Caller ensures the Dark Desk schema; a failed read never becomes default settings. */
export async function readDarkSettingsFor(newsroomId: number) {
  const sql = await getSql();
  const [row] = await sql<{
    dig: number;
    nerve: number;
    scope: string;
    research_preferences: string;
    default_limit_key: string;
  }>`select dig,nerve,scope,research_preferences,default_limit_key from dark_settings where newsroom_id=${newsroomId}`;
  return {
    dials: clampDials(row as Partial<DarkDials> | undefined),
    defaultLimitKey: DARK_LIMITS.find((limit) => limit.key === row?.default_limit_key)?.key ?? "standard",
    preferences: validateResearchPreferences(
      row ? JSON.parse(row.research_preferences) : undefined,
    ),
  };
}
export async function saveDarkSettingsFor(
  newsroomId: number,
  input: { dials?: Partial<DarkDials>; preferences?: ResearchPreferences; defaultLimitKey?: DarkLimitKey },
) {
  const d = input.dials ? clampDials(input.dials) : null,
    p = input.preferences ? validateResearchPreferences(input.preferences) : null,
    defaultLimitKey = input.defaultLimitKey && DARK_LIMITS.some((limit) => limit.key === input.defaultLimitKey)
      ? input.defaultLimitKey
      : null;
  const sql = await getSql();
  await sql`insert into dark_settings(newsroom_id,dig,nerve,scope,research_preferences,default_limit_key,updated_at) values(${newsroomId},${d?.dig ?? 4},${d?.nerve ?? 5},${d?.scope ?? "city"},${JSON.stringify(p ?? {})},${defaultLimitKey ?? "standard"},now()) on conflict(newsroom_id) do update set dig=case when ${d !== null} then excluded.dig else dark_settings.dig end,nerve=case when ${d !== null} then excluded.nerve else dark_settings.nerve end,scope=case when ${d !== null} then excluded.scope else dark_settings.scope end,research_preferences=case when ${p !== null} then excluded.research_preferences else dark_settings.research_preferences end,default_limit_key=case when ${defaultLimitKey !== null} then excluded.default_limit_key else dark_settings.default_limit_key end,updated_at=now()`;
  return readDarkSettingsFor(newsroomId);
}
export async function snapshotDarkSettingsFor(
  newsroomId: number,
  runId: number,
  now = new Date(),
): Promise<DarkRoundSettings> {
  const current = await readDarkSettingsFor(newsroomId);
  const snapshot = {
    dials: current.dials,
    preferences: resolveResearchPreferences(current.preferences, now),
  };
  const sql = await getSql();
  const saved =
    await sql`update dark_runs set research_preferences_json=${JSON.stringify(snapshot)} where id=${runId} and newsroom_id=${newsroomId} and research_preferences_json is null returning id`;
  if (saved.length !== 1)
    throw new Error(
      "Could not save this round’s investigative settings snapshot. The round was not started.",
    );
  return snapshot;
}
