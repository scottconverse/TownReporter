import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { appPwaPlugin } from "./scripts/app-chrome-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Warm every `ensure*Schema` module before the dev server serves its first
 * request (Unit CE, release 0.6.80 — the built-server equivalent is
 * `server/plugins/schema-warmup.ts` plus the request-gating
 * `server/middleware/00-schema-warmup.ts`).
 *
 * Runs after `pgliteBootstrapPlugin` in the `plugins` array below: the
 * `ensure*Schema` functions ALTER tables that `migrations/*.sql` creates, so
 * PGLite bootstrap (which applies those migrations) must finish first. Vite
 * awaits `configureServer` hooks in array order, so listing this plugin after
 * `pgliteBootstrapPlugin()` is sufficient — no extra synchronization needed.
 */
function schemaWarmupDevPlugin(): Plugin {
  return {
    name: "app-builder:schema-warmup",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/schema-warmup.ts")) as {
          runSchemaWarmup?: () => Promise<unknown>;
        };
        if (typeof mod.runSchemaWarmup === "function") {
          await mod.runSchemaWarmup();
        }
      } catch (err) {
        // Matches runSchemaWarmup's own contract (never crash the server on
        // one module's failure) — but a *dev*-server bootstrap module load
        // failure is not that; surfacing it here would otherwise be silent.
        console.error("[app-builder] schema warm-up failed to run at all:", err);
      }
    },
  };
}

/**
 * Dark Desk monitors recapture due URLs even if no editor is signed in.
 * Desk jobs drain here too if the click's process would have gone to sleep.
 * Ticks after boot, then on an interval. Production: GET /api/cron/monitors.
 */
function darkDeskMonitorPlugin(): Plugin {
  let stopScheduler: (() => void) | undefined;
  return {
    name: "townreporter:dark-desk-monitors",
    apply: "serve",
    configureServer(server) {
      let ticking = false;
      const tick = async () => {
        if (ticking) return;
        ticking = true;
        try {
          try {
            const newsletters = await server.ssrLoadModule("/src/lib/news/newsletter-poll.server.ts");
            await newsletters.tickNewsletterMailboxes();
          } catch { console.error("[townreporter] newsletter mailbox check could not run."); }
          const retries = await server.ssrLoadModule("/src/lib/news/meeting-capture.ts");
          await retries.tickYoutubeCaptureRetries();
          const mod = (await server.ssrLoadModule("/src/lib/news/monitors-cron.ts")) as {
            tickAllDueMonitors?: () => Promise<unknown>;
          };
          if (typeof mod.tickAllDueMonitors === "function") {
            await mod.tickAllDueMonitors();
          }
          const daily = (await server.ssrLoadModule("/src/lib/news/daily-scan.server.ts")) as {
            tickDailyScans?: () => Promise<unknown>;
          };
          if (typeof daily.tickDailyScans === "function") await daily.tickDailyScans();
          const routine = (await server.ssrLoadModule(
            "/src/lib/news/routine-notice-worker.server.ts",
          )) as { tickRoutineNoticeEditions?: () => Promise<unknown> };
          if (typeof routine.tickRoutineNoticeEditions === "function")
            await routine.tickRoutineNoticeEditions();
          const followUps = (await server.ssrLoadModule("/src/lib/news/follow-up-scheduler.ts")) as {
            tickFollowUps?: () => Promise<unknown>;
          };
          if (typeof followUps.tickFollowUps === "function") await followUps.tickFollowUps();
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
          const mod = (await server.ssrLoadModule("/src/lib/news/jobs.ts")) as {
            drainQueuedJobs?: () => Promise<unknown>;
          };
          if (typeof mod.drainQueuedJobs === "function") {
            await mod.drainQueuedJobs();
          }
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
          const mod = (await server.ssrLoadModule("/src/lib/news/stats-reports.server.ts")) as {
            tickStatsReports?: () => Promise<unknown>;
          };
          if (typeof mod.tickStatsReports === "function") await mod.tickStatsReports();
        } catch (err) {
          console.error("[townreporter] stats report tick failed:", err);
        } finally {
          statsTicking = false;
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
      const statsFirst = setTimeout(() => {
        void tickStats();
      }, 60_000);
      const statsId = setInterval(
        () => {
          void tickStats();
        },
        60 * 60 * 1000,
      );
      const stop = () => {
        clearTimeout(first);
        clearInterval(id);
        clearTimeout(jobsFirst);
        clearInterval(jobsId);
        clearTimeout(statsFirst);
        clearInterval(statsId);
      };
      stopScheduler = stop;
      server.httpServer?.once("close", stop);
    },
    closeBundle() {
      stopScheduler?.();
      stopScheduler = undefined;
    },
  };
}

/**
 * Keep server-only modules out of the browser bundle.
 *
 * Two of them reach the client graph through a dynamic import and, left alone,
 * drag their whole payload into `.output/public`:
 *
 *  - Playwright, whose launch the client never calls.
 *  - PGLite, the server-side fallback database (`src/lib/db.ts`, behind an
 *    `await import` and used only when DATABASE_URL is unset). A gate audit
 *    found its WebAssembly published to the reader-facing asset directory: a
 *    10 MB .wasm, a 6 MB .data and a 0.4 MB initdb -- 16.4 MB, 93% of the
 *    public assets, referenced by no client script and served to every reader
 *    anonymously. The server keeps its own copy under `.output/server`, which
 *    is the only one that is ever used.
 *
 * On the client build (`options.ssr` false) these resolve to an inert stub; on
 * the server build the real modules load untouched. Nothing the app runs is
 * affected -- only what a browser is asked to download.
 */
function stubServerOnlyOnClient(): Plugin {
  const isPglite = (id: string) =>
    id === "@electric-sql/pglite" || id.startsWith("@electric-sql/pglite/");
  const isPlaywright = (id: string) =>
    id === "playwright" ||
    id === "playwright-core" ||
    id.startsWith("playwright/") ||
    id.startsWith("playwright-core/") ||
    id === "chromium-bidi" ||
    id.startsWith("chromium-bidi/");
  const isCanvas = (id: string) => id === "@napi-rs/canvas" || id.startsWith("@napi-rs/canvas/");
  return {
    name: "stub-server-only-on-client",
    enforce: "pre",
    resolveId(id, _importer, options) {
      if (options?.ssr) return;
      if (isPlaywright(id)) return "\0stub-playwright";
      if (isCanvas(id)) return "\0stub-canvas";
      // Keep "pglite" out of the emitted public filename too. The payload
      // gate deliberately treats any browser asset with that name as a leak.
      if (isPglite(id)) return "\0server-db-stub";
    },
    load(id) {
      if (id === "\0stub-playwright") {
        return "export const chromium = { launch: async () => null }; export default {};";
      }
      if (id === "\0stub-canvas") {
        // OCR is server-only. Keep the native Skia package (and its .node
        // binding) out of browser assets; a client-side call must fail loudly.
        return 'throw new Error("Canvas OCR is server-only");';
      }
      if (id === "\0server-db-stub") {
        // The browser must never reach this. Throwing rather than returning a
        // fake keeps a real client-side use from failing silently.
        return 'export class PGlite { constructor() { throw new Error("PGlite is server-only"); } }; export default {};';
      }
    },
  };
}

// Port 8080 is the live-preview contract — don't change it.
// Host defaults to 127.0.0.1 (this PC only); `npm run dev:lan` passes
// --host 0.0.0.0 for phone/LAN testing. Keep this in sync with the
// `dev`/`dev:lan` scripts in package.json — the CLI --host flag overrides
// this value, but they should always agree.
// The dev server starts once `src/router.tsx` and `src/routes/` exist.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  // @napi-rs/canvas loads a platform-specific .node binding through its JS
  // loader. Leave that package external to Vite's SSR graph so Nitro/runtime
  // can retain the installed native package instead of parsing the binary as
  // UTF-8. The client-side resolver above supplies a loud inert stub.
  ssr: { external: ["@napi-rs/canvas"] },
  plugins: [
    pgliteBootstrapPlugin(),
    schemaWarmupDevPlugin(),
    darkDeskMonitorPlugin(),
    // App head chrome (manifest, touch icon, share-card metas); runs before Start/Nitro.
    appPwaPlugin(),
    stubServerOnlyOnClient(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // Self-hosted by default: `node-server` emits a standalone Node
            // server (.output/server/index.mjs) that runs anywhere — the home
            // box, a VPS, a container. Unlike the Vercel preset this keeps a
            // long-lived process, so Playwright rendering and the desk job
            // drain actually work (see src/lib/news/render-fetch.ts, which
            // disables Chromium whenever it sees a VERCEL env var).
            // Set NITRO_PRESET=vercel to build for Vercel again.
            preset: process.env.NITRO_PRESET || "node-server",
            // Auto-registers server/middleware/* (the PWA manifest route and
            // the head-tag middleware). Nitro v3 defaults serverDir to false,
            // so removing this silently unwires both on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
