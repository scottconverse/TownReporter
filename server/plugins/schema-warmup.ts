import { getMigrationGuardPromise } from "../../src/lib/migration-status.ts";
import { getSchemaWarmupPromise } from "../../src/lib/schema-warmup.ts";

/**
 * Kick off the boot-time schema warm-up as soon as the built server's Nitro
 * app is created (Unit CE, release 0.6.80).
 *
 * Static, relative import -- the same shape as `unattended-clock.ts` in this
 * directory, and for the same reason: a dynamic "@/" alias import here has
 * previously shipped a Linux build whose chunk was never written (see
 * `unattended-scheduler.ts`'s account of that failure). `server/plugins/*`
 * only load in the built server (`vite.config.ts` registers `nitro()` on
 * build/preview only); dev's equivalent warm-up runs from the Vite
 * `configureServer` hook in `vite.config.ts` instead.
 *
 * IMPORTANT: Nitro's `initNitroPlugins` calls each plugin without awaiting it
 * (`node_modules/nitro/dist/runtime/internal/app.mjs`), and the node-server
 * preset starts `serve()` immediately after -- so returning a promise from
 * this plugin does NOT delay the port opening or the first accepted
 * connection. The actual "before it accepts requests" guarantee comes from
 * `server/middleware/00-schema-warmup.ts`, which awaits the same shared
 * promise (`getSchemaWarmupPromise`) before letting any request reach a
 * route handler. This plugin only starts that promise as early as possible,
 * so it has the most possible time to finish before the middleware needs it.
 */
export default function schemaWarmup() {
  void getSchemaWarmupPromise();
  // The migration-ledger check (U18a-3) starts here too, for the same reason:
  // as early as possible, so its answer is waiting for the first request
  // rather than being discovered by it. `getMigrationGuardPromise` logs a
  // failure itself; `server/middleware/00-schema-current.ts` is what turns
  // that failure into a refusal to serve.
  void getMigrationGuardPromise().catch(() => undefined);
}
