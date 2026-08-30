import type { NitroApp } from "nitro/types";

/**
 * Built-server twin of the dev Vite plugin `darkDeskMonitorPlugin`
 * (vite.config.ts, `apply: "serve"`).
 *
 * That plugin only runs under `vite dev` -- it hangs its interval off the
 * dev server's `configureServer` hook, which the built node-server never
 * calls. A default self-hosted install (no CRON_SECRET, no external
 * scheduler) has no other unattended path: GET /api/cron/monitors returns
 * 503 without CRON_SECRET (src/routes/api/cron.monitors.ts), and job/monitor
 * recovery after a crash or restart would otherwise wait for the next
 * enqueue. This plugin gives the built server the same in-process drain,
 * on the same cadence, so dev and prod behave identically without any
 * operator setup.
 *
 * No dev/prod flag guards this, on purpose. The first draft returned early
 * unless NODE_ENV was "production" -- and nothing in this deployment sets
 * that: grep across ops/*.ps1 and .env.example found no NODE_ENV anywhere,
 * so the guard would have disabled the fix in the exact environment it was
 * written for. No guard is needed anyway: vite.config.ts only registers
 * nitro() (and with it server/plugins/*) on build/preview, so this file
 * simply never loads under `npm run dev` -- the double-drain it feared
 * cannot happen.
 */
export default function darkDeskScheduler(nitroApp?: NitroApp) {

  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const mod = await import("@/lib/news/monitors-cron");
      await mod.tickAllDueMonitors();
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
      const mod = await import("@/lib/news/jobs");
      await mod.drainQueuedJobs();
    } catch (err) {
      console.error("[townreporter] job drain failed:", err);
    } finally {
      jobsTicking = false;
    }
  };

  const intervalMs = 5 * 60 * 1000;
  const first = setTimeout(() => {
    void tick();
  }, 45_000);
  const id = setInterval(() => {
    void tick();
  }, intervalMs);
  const jobsFirst = setTimeout(() => {
    void tickJobs();
  }, 8_000);
  const jobsId = setInterval(() => {
    void tickJobs();
  }, 20_000);

  const stop = () => {
    clearTimeout(first);
    clearInterval(id);
    clearTimeout(jobsFirst);
    clearInterval(jobsId);
  };

  if (nitroApp?.hooks) {
    nitroApp.hooks.hook("close", stop);
  }
}
