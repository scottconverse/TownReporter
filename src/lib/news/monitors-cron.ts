import { getSql } from "@/lib/db";
import { runDueMonitors } from "./investigate.ts";
import { drainQueuedJobs } from "./jobs.ts";

/** Recheck due monitors and finish waiting desk jobs. Does not require an editor to be signed in. */
export async function tickAllDueMonitors(): Promise<{
  users: number;
  checked: number;
  anomalies: number;
  jobs: number;
}> {
  const sql = await getSql();
  const rooms = await sql<{ newsroom_id: number }>`
    select distinct newsroom_id from source_monitors
    where enabled = true and next_check_at <= now()
    limit 40
  `;
  let checked = 0;
  let anomalies = 0;
  for (const r of rooms) {
    try {
      const result = await runDueMonitors({
        userId: "cron",
        newsroomId: r.newsroom_id,
        limit: 12,
      });
      checked += result.checked;
      anomalies += result.anomalies;
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
  return { users: rooms.length, checked, anomalies, jobs };
}

/** Production HTTP handler. Empty CRON_SECRET fails closed. */
export async function handleMonitorsCron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return new Response("cron disabled", { status: 503 });
  }
  const hdr = request.headers.get("authorization") ?? "";
  if (hdr !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  const result = await tickAllDueMonitors();
  return Response.json(result);
}
