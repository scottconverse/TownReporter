import { tickAllDueMonitors } from "./monitors-cron.ts";
import { drainQueuedJobs } from "./jobs.ts";

/**
 * The built server's unattended clock: monitors recapture, job reclaim, and
 * (via the monitors tick) trash purge, with no CRON_SECRET and no operator
 * setup (ENG-202).
 *
 * Where this lives, and why, is the whole story:
 *
 *  - A Nitro plugin that dynamically imported "@/lib/news/jobs" built fine on
 *    Windows; on CI's Linux runner the build emitted the import as a chunk it
 *    never wrote. Every tick logged ERR_MODULE_NOT_FOUND and the damaged
 *    chunk graph silently emptied the archive search's server function too.
 *  - Starting it from src/lib/db.ts instead pulled this module toward the
 *    CLIENT build (db.ts is client-reachable) and tripped TanStack's
 *    import-protection three hops later.
 *
 *  So: every import in this file is STATIC and RELATIVE, and the ONLY thing
 *  that imports this file is server/plugins/unattended-clock.ts -- the same
 *  shape as server/middleware/grok-pwa.ts, the one server-plugin pattern this
 *  repo has proven in the built output. Nothing client-reachable imports it.
 *
 * Cadence mirrors the dev Vite plugin exactly (which owns dev --
 * `apply: "serve"` -- so the two can never double-drain): monitors first tick
 * 45s then every 5 minutes; job drain first tick 8s then every 20 seconds.
 * One clock per process, guarded on globalThis.
 */

const globalClock = globalThis as typeof globalThis & {
  __unattendedSchedulerStarted__?: boolean;
};

export function startUnattendedScheduler(): void {
  if (typeof window !== "undefined") return;
  if (globalClock.__unattendedSchedulerStarted__) return;
  globalClock.__unattendedSchedulerStarted__ = true;

  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tickAllDueMonitors();
    } catch (err) {
      console.error("[townreporter] monitor tick failed:", err);
    } finally {
      ticking = false;
    }
  };

  let jobsTicking = false;
  const tickJobs = async () => {
    if (jobsTicking) return;
    jobsTicking = true;
    try {
      await drainQueuedJobs();
    } catch (err) {
      console.error("[townreporter] job drain failed:", err);
    } finally {
      jobsTicking = false;
    }
  };

  const intervalMs = 5 * 60 * 1000;
  // unref: a background clock must never hold the process open on its own
  // (a test that imports the server would otherwise hang at exit).
  setTimeout(() => {
    void tick();
  }, 45_000).unref?.();
  setInterval(() => {
    void tick();
  }, intervalMs).unref?.();
  setTimeout(() => {
    void tickJobs();
  }, 8_000).unref?.();
  setInterval(() => {
    void tickJobs();
  }, 20_000).unref?.();
}
