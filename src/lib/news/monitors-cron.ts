import { getSql } from "@/lib/db";
import { runDueMonitors } from "./investigate.ts";

/** Recheck due monitors for every desk. Does not require an editor to open Dark Desk. */
export async function tickAllDueMonitors(): Promise<{
  users: number;
  checked: number;
  anomalies: number;
}> {
  const sql = await getSql();
  const users = await sql<{ user_id: string }>`
    select distinct user_id from source_monitors
    where enabled = true and next_check_at <= now()
    limit 40
  `;
  let checked = 0;
  let anomalies = 0;
  for (const u of users) {
    try {
      const r = await runDueMonitors({ userId: u.user_id, limit: 12 });
      checked += r.checked;
      anomalies += r.anomalies;
    } catch {
      /* one desk failing must not stop the others */
    }
  }
  return { users: users.length, checked, anomalies };
}
