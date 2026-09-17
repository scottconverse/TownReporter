import { tickDailyScans } from "./daily-scan.server.ts";
import { tickAllDueMonitors } from "./monitors-cron.ts";

type CronWakeDeps = {
  secret?: string;
  tickDaily?: typeof tickDailyScans;
  tickMonitors?: typeof tickAllDueMonitors;
};

/** Authenticate the external wake before reserving or draining any work. */
export async function handleMonitorsCronRequest(
  request: Request,
  deps: CronWakeDeps = {},
): Promise<Response> {
  const secret = (deps.secret ?? process.env.CRON_SECRET)?.trim();
  if (!secret) return new Response("cron disabled", { status: 503 });
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${secret}`)
    return new Response("forbidden", { status: 403 });

  let dailyFailed = false;
  try {
    await (deps.tickDaily ?? tickDailyScans)();
  } catch (error) {
    dailyFailed = true;
    console.error("[townreporter] daily scan reservation tick failed:", error);
  }
  const result = await (deps.tickMonitors ?? tickAllDueMonitors)();
  return Response.json(result, { status: dailyFailed ? 500 : 200 });
}
