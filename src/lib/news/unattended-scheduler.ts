import { tickAllDueMonitors } from "./monitors-cron.ts";
import { drainQueuedJobs, reattachDurableJobsOnStartup } from "./jobs.ts";
import { tickDailyScans } from "./daily-scan.server.ts";
import { tickRoutineNoticeEditions } from "./routine-notice-worker.server.ts";
import { tickStatsReports } from "./stats-reports.server.ts";
import { foldSmallPlaces, pruneLocationDaily } from "./reading.server.ts";
import { tickFollowUps } from "./follow-up-scheduler.ts";

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
 *  shape as server/plugins/schema-warmup.ts, the server-plugin pattern this
 *  repo has proven in the built output. Nothing client-reachable imports it.
 *  (The file this comment used to name, the Grok app builder's
 *  server/middleware/grok-pwa.ts, is long gone.)
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
      await tickDailyScans();
      await tickRoutineNoticeEditions();
      /*
        Follow-ups last, and on this same five-minute clock rather than the
        twenty-second job drain: one is started per newsroom per tick, and the
        job it enqueues is picked up by `tickJobs` below within twenty seconds.
        Putting the tick on the fast clock would re-run the two fences every
        twenty seconds to learn the same answer.
      */
      await tickFollowUps();
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

  let statsTicking = false;
  const tickStats = async () => {
    if (statsTicking) return;
    statsTicking = true;
    try {
      /*
        THREE INDEPENDENT JOBS ON ONE HOURLY CLOCK, and each gets its own
        try/catch (unit U17d). They used to share one: `tickStatsReports()` sat
        in the same `try` as the fold and the prune, so a report tick that threw
        -- its own `getSql()` or its per-newsroom query is enough -- skipped the
        other two entirely, which is the opposite of what the comment beside
        them promised. A failed report must not cost the day's retention work,
        and a failed fold must not cost the prune.
      */
      try {
        await tickStatsReports();
      } catch (err) {
        console.error("[townreporter] stats report tick failed:", err);
      }

      /*
        Retention (unit U17b/U17c). `location_daily` is the one Stats table with
        a finite life -- twelve months, the longest range the Stats screen
        offers -- and the one that describes a place a reader was in rather than
        a page, so it is also the one that folds its small places away.

        The fold runs BEFORE the prune, and both are idempotent, so the order is
        only about not doing wasted work: a place old enough to be pruned is
        never also folded. Fold first and the prune sees fewer rows; prune first
        and the fold would fold rows the prune was about to delete. Neither
        order is wrong, and neither loses a visit -- a folded row is carried by
        a row that lives as long as the rows it came from.

        Both are cheap and quiet: a query each on an hour when there is nothing
        to do, and a row count to log when there is.
      */
      try {
        await foldSmallPlaces();
      } catch (err) {
        console.error("[townreporter] stats location fold failed:", err);
      }
      try {
        await pruneLocationDaily();
      } catch (err) {
        console.error("[townreporter] stats location prune failed:", err);
      }
    } finally {
      statsTicking = false;
    }
  };

  /*
    Reattach durable work immediately at process start. The ordinary job
    clock below still handles later kicks and stale reclaim; this first sweep
    is what prevents a restarted server from leaving already-durable
    queued/running work stranded until a human click or the 8-second tick.

    It is idempotent and safe under concurrent starts: reattachment goes
    through the existing claim-token conditional update, so only one process
    can claim any row. It never signals a persisted PID (ENG-06).
  */
  void reattachDurableJobsOnStartup().catch((err) => {
    console.error("[townreporter] startup job reattachment failed:", err);
  });

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
  setTimeout(() => {
    void tickStats();
  }, 60_000).unref?.();
  setInterval(
    () => {
      void tickStats();
    },
    60 * 60 * 1000,
  ).unref?.();
}
