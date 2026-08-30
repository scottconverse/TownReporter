import { startUnattendedScheduler } from "../../src/lib/news/unattended-scheduler.ts";

/**
 * Start the built server's unattended clock at boot (ENG-202).
 *
 * The import above is STATIC and RELATIVE on purpose -- the same shape as
 * server/middleware/grok-pwa.ts, the one pattern this repo has proven for
 * server files reaching app code in the built output. A previous version of
 * this plugin used a dynamic "@/" alias import, which Linux builds emitted
 * as a chunk that was never written; see unattended-scheduler.ts for the
 * full account.
 *
 * No dev/prod gate: server/plugins/* only load in the built server at all
 * (vite.config.ts registers nitro() on build/preview only), and the dev
 * cadence is owned by the Vite plugin there. NODE_ENV is not consulted --
 * this deployment never sets it.
 */
export default function unattendedClock() {
  startUnattendedScheduler();
}
