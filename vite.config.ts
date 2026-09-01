import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
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
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          // Never 302 the live-preview iframe itself to the broker — that
          // paints Chrome's broken-document icon. Pop-up windows are document dest.
          const fetchDest = String(req.headers["sec-fetch-dest"] ?? "");
          if (fetchDest === "iframe") {
            res.statusCode = 200;
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(
              '<!doctype html><meta http-equiv="refresh" content="0;url=/login"><title>Sign in</title><p><a href="/login">Open editor sign-in</a></p><script>location.replace("/login")</script>',
            );
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

/**
 * Dark Desk monitors recapture due URLs even if no editor is signed in.
 * Desk jobs drain here too if the click's process would have gone to sleep.
 * Ticks after boot, then on an interval. Production: GET /api/cron/monitors.
 */
function darkDeskMonitorPlugin(): Plugin {
  return {
    name: "townreporter:dark-desk-monitors",
    apply: "serve",
    configureServer(server) {
      let ticking = false;
      const tick = async () => {
        if (ticking) return;
        ticking = true;
        try {
          const mod = (await server.ssrLoadModule("/src/lib/news/monitors-cron.ts")) as {
            tickAllDueMonitors?: () => Promise<unknown>;
          };
          if (typeof mod.tickAllDueMonitors === "function") {
            await mod.tickAllDueMonitors();
          }
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
      server.httpServer?.once("close", stop);
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
  return {
    name: "stub-server-only-on-client",
    enforce: "pre",
    resolveId(id, _importer, options) {
      if (options?.ssr) return;
      if (isPlaywright(id)) return "\0stub-playwright";
      // Keep "pglite" out of the emitted public filename too. The payload
      // gate deliberately treats any browser asset with that name as a leak.
      if (isPglite(id)) return "\0server-db-stub";
    },
    load(id) {
      if (id === "\0stub-playwright") {
        return "export const chromium = { launch: async () => null }; export default {};";
      }
      if (id === "\0server-db-stub") {
        // The browser must never reach this. Throwing rather than returning a
        // fake keeps a real client-side use from failing silently.
        return 'export class PGlite { constructor() { throw new Error("PGlite is server-only"); } }; export default {};';
      }
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
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
  plugins: [
    pgliteBootstrapPlugin(),
    darkDeskMonitorPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
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
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
