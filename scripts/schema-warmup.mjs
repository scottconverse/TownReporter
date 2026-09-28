#!/usr/bin/env node
/**
 * Standalone ops entry for the boot-time schema warm-up (Unit CE, 0.6.80).
 *
 * Runs every registered `ensure*Schema` function once against `DATABASE_URL`
 * (or the PGLite fallback with none set), the same registry the built server
 * runs at boot (`server/plugins/schema-warmup.ts` / `server/middleware/`) and
 * the dev server runs from `vite.config.ts`. Exists so ops can run the
 * warm-up on demand -- e.g. a promote script could call this right after
 * `npm run db:migrate` and before restarting the app, so the app's first real
 * request never pays for a first-use ALTER. Not wired into
 * `ops/promote.ps1` by this unit -- that stays the coordinator's call, after
 * one promote has proven the warm-up in production; see
 * `townreporter-deepseek-oversight/DECISIONS.md`.
 *
 * Usage:
 *   node scripts/with-app-env.mjs node scripts/schema-warmup.mjs
 *
 * Exit code is 0 even when individual modules fail to warm (matching
 * `runSchemaWarmup`'s "never crash, log and move on" contract) -- exits 1
 * only if the warm-up itself could not run at all (e.g. no database
 * reachable). Pass `--strict` to exit 1 when any module failed.
 */
import { runSchemaWarmup } from "../src/lib/schema-warmup.ts";

const strict = process.argv.includes("--strict");

async function main() {
  const started = Date.now();
  const results = await runSchemaWarmup();
  const failed = results.filter((r) => r.status === "failed");
  const ran = results.filter((r) => r.status === "ran");
  const skipped = results.filter((r) => r.status === "skipped-by-marker");
  console.log(
    `[schema-warmup] done in ${Date.now() - started}ms — ` +
      `${results.length} module(s): ${ran.length} ran, ${skipped.length} skipped-by-marker, ${failed.length} failed`,
  );
  if (failed.length) {
    console.error(
      `[schema-warmup] failed modules (each will still run on its own first request):`,
      failed.map((r) => r.name).join(", "),
    );
    if (strict) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[schema-warmup] could not run at all:", err?.message || err);
  process.exit(1);
});
