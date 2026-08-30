import { getSql } from "../db.ts";
import { runDueMonitors } from "./investigate.ts";
import { drainQueuedJobs } from "./jobs.ts";
import { purgeAllOldTrash } from "./trash-store.ts";
import { audit } from "./ops.ts";

/** Recheck due monitors, finish waiting desk jobs, and expire old trash. Does not require an editor to be signed in. */
export async function tickAllDueMonitors(): Promise<{
  users: number;
  checked: number;
  anomalies: number;
  jobs: number;
  purged: number;
  purgeError: string | null;
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
  let jobs = 0;
  try {
    jobs = (await drainQueuedJobs()).ran;
  } catch {
    /* monitors still count even if a job drain throws */
  }
  // The trash sweep is the unattended half of ENG-106: without this, "kept
  // for thirty days" only came true for a newsroom whose Trash panel someone
  // opened. Its own try/catch, separate from the two above, because a schema
  // change that breaks this DELETE must show up as a loud, logged failure —
  // not as monitors silently stopping, and not as the purge silently no-op'ing
  // forever the way the original bug did.
  let purged = 0;
  let purgeError: string | null = null;
  try {
    purged = await purgeAllOldTrash(sql);
    if (purged > 0) {
      await audit("system", "trash-purge", `${purged} item${purged === 1 ? "" : "s"} past the retention window`);
    }
  } catch (err) {
    purgeError = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    // Best-effort: if audit_events itself is unreachable, the caught error
    // above is still returned to whoever invoked this tick.
    await audit("system", "trash-purge-failed", purgeError).catch(() => undefined);
  }
  return { users: users.length, checked, anomalies, jobs, purged, purgeError };
}
